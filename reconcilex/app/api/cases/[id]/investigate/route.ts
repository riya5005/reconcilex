import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { recordAudit } from "@/lib/audit";
import { investigate, InvestigationInput } from "@/lib/ai/investigator";
import { Payment, Order, Customer, ResolutionCase } from "@/lib/types";

interface ActivityStep {
  label: string;
  detail: string;
}

export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const db = getDb();

    const c = db.prepare(`SELECT * FROM resolution_cases WHERE case_id = ?`).get(id) as
      | ResolutionCase
      | undefined;
    if (!c) {
      return NextResponse.json({ error: "Case not found" }, { status: 404 });
    }

    const paymentIds: string[] = JSON.parse(c.payment_ids);
    const placeholders = paymentIds.map(() => "?").join(",");
    const payments = (paymentIds.length
      ? (db.prepare(`SELECT * FROM payments WHERE payment_id IN (${placeholders})`).all(...paymentIds) as Payment[])
      : []
    ).sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());

    const order = c.order_id
      ? (db.prepare(`SELECT * FROM orders WHERE order_id = ?`).get(c.order_id) as Order | undefined) ?? null
      : null;
    const customer = db
      .prepare(`SELECT * FROM customers WHERE customer_id = ?`)
      .get(c.customer_id) as Customer | undefined;

    const evidence = JSON.parse(c.evidence);

    // ---- Agent activity: these are real steps executed against real DB state ----
    const activity: ActivityStep[] = [];
    const record = (eventType: string, label: string, detail: string) => {
      activity.push({ label, detail });
      recordAudit({ caseId: id, eventType, actor: "ReconcileX Agent", reason: detail });
    };

    record(
      "AGENT_RETRIEVED_ORDER",
      "Retrieved order",
      order ? `Loaded order ${order.order_id} (${order.service}, expected \u20b9${order.amount})` : `Case ${id} has no linked order`
    );
    record(
      "AGENT_FOUND_PAYMENTS",
      `Found ${payments.length} related payment(s)`,
      payments.map((p) => p.payment_id).join(", ") || "No payments linked to this case"
    );
    if (payments.length >= 2) {
      const [p1, p2] = payments;
      record(
        "AGENT_COMPARED_AMOUNTS",
        "Compared transaction amounts",
        `${p1.payment_id}: \u20b9${p1.amount} vs ${p2.payment_id}: \u20b9${p2.amount}`
      );
      const diffMs = Math.abs(new Date(p2.created_at).getTime() - new Date(p1.created_at).getTime());
      record(
        "AGENT_COMPARED_TIMESTAMPS",
        "Compared timestamps",
        `${Math.round(diffMs / 1000)} seconds apart (${p1.created_at} vs ${p2.created_at})`
      );
      record(
        "AGENT_CHECKED_INITIAL_STATE",
        "Checked initial payment state",
        `${p1.payment_id} started ${p1.initial_status}, ${p2.payment_id} started ${p2.initial_status}`
      );
      record(
        "AGENT_CHECKED_FINAL_STATE",
        "Checked final payment state",
        `${p1.payment_id} is now ${p1.current_status}, ${p2.payment_id} is now ${p2.current_status}`
      );
    }
    const refunded = payments.filter((p) => p.current_status === "REFUNDED");
    record(
      "AGENT_CHECKED_REFUND_HISTORY",
      "Checked refund history",
      refunded.length ? `${refunded.map((p) => p.payment_id).join(", ")} already refunded` : "No prior refunds on these payments"
    );
    record(
      "AGENT_CALCULATED_CONFIDENCE",
      "Calculated duplicate confidence",
      `Deterministic engine scored this case at ${c.confidence}% (${c.confidence_band})`
    );

    // ---- AI investigation: structured evidence only, no raw DB access ----
    const input: InvestigationInput = {
      case_id: c.case_id,
      case_type: c.case_type,
      customer_id: c.customer_id,
      order_id: c.order_id,
      expected_amount: order?.amount ?? null,
      payments: payments.map((p) => ({
        payment_id: p.payment_id,
        amount: p.amount,
        method: p.method,
        initial_status: p.initial_status,
        current_status: p.current_status,
        created_at: p.created_at,
        updated_at: p.updated_at,
      })),
      order: order ? { order_id: order.order_id, service: order.service, amount: order.amount, status: order.status } : null,
      deterministic_confidence: c.confidence,
      deterministic_band: c.confidence_band,
      evidence,
      deterministic_recommendation: c.recommendation,
      deterministic_recommended_amount: c.recommended_amount,
    };

    recordAudit({
      caseId: id,
      eventType: "AI_INVESTIGATION_STARTED",
      actor: "ReconcileX AI",
      reason: "Sending structured evidence (no raw table access) to the AI investigation layer",
    });

    const result = await investigate(input);

    const now = new Date().toISOString();
    db.prepare(
      `INSERT INTO ai_investigations
        (case_id, status, summary, root_cause, reasoning, recommended_action, payment_to_refund, risk_level, requires_human_approval, model, error, created_at, updated_at)
       VALUES (@case_id, @status, @summary, @root_cause, @reasoning, @recommended_action, @payment_to_refund, @risk_level, @requires_human_approval, @model, @error, @created_at, @updated_at)
       ON CONFLICT(case_id) DO UPDATE SET
         status=excluded.status, summary=excluded.summary, root_cause=excluded.root_cause,
         reasoning=excluded.reasoning, recommended_action=excluded.recommended_action,
         payment_to_refund=excluded.payment_to_refund, risk_level=excluded.risk_level,
         requires_human_approval=excluded.requires_human_approval, model=excluded.model,
         error=excluded.error, updated_at=excluded.updated_at`
    ).run({
      case_id: id,
      status: result.status,
      summary: result.summary,
      root_cause: result.root_cause,
      reasoning: result.reasoning,
      recommended_action: result.recommended_action,
      payment_to_refund: result.payment_to_refund,
      risk_level: result.risk_level,
      requires_human_approval: result.requires_human_approval ? 1 : 0,
      model: result.model,
      error: result.error,
      created_at: now,
      updated_at: now,
    });

    if (result.status === "COMPLETED") {
      activity.push({ label: "AI investigation completed", detail: `Model: ${result.model}` });
      recordAudit({
        caseId: id,
        eventType: "AI_INVESTIGATION_COMPLETED",
        actor: "ReconcileX AI",
        reason: result.summary ?? undefined,
        outcome: `Risk: ${result.risk_level}`,
      });
      activity.push({
        label: "Resolution recommendation generated",
        detail: result.recommended_action ?? "No action recommended",
      });
      recordAudit({
        caseId: id,
        eventType: "RESOLUTION_RECOMMENDATION_GENERATED",
        actor: "ReconcileX AI",
        reason: result.recommended_action ?? undefined,
        action: result.payment_to_refund ? `Refund ${result.payment_to_refund}` : null,
      });
    } else {
      activity.push({ label: "AI investigation unavailable", detail: result.error ?? "Unknown error" });
      recordAudit({
        caseId: id,
        eventType: "AI_INVESTIGATION_UNAVAILABLE",
        actor: "ReconcileX AI",
        reason: result.error ?? "AI service unavailable",
        outcome: "Falling back to deterministic evidence only",
      });
    }

    return NextResponse.json({ activity, result, customer: customer ?? null });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "Investigation failed" }, { status: 500 });
  }
}
