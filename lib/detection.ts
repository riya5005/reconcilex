import { getDb } from "./db";
import { recordAudit } from "./audit";
import { randomUUID } from "crypto";
import { Payment, Order, EvidenceItem, ConfidenceBand } from "./types";

const HIGH_THRESHOLD = 90;
const MEDIUM_THRESHOLD = 60;

export function confidenceBand(score: number): ConfidenceBand {
  if (score >= HIGH_THRESHOLD) return "HIGH";
  if (score >= MEDIUM_THRESHOLD) return "MEDIUM";
  return "LOW";
}

function minutesBetween(a: string, b: string) {
  return Math.abs(new Date(a).getTime() - new Date(b).getTime()) / 60000;
}

/**
 * Score a candidate pair of payments for duplicate likelihood.
 * Every point is grounded in the two payment records passed in — nothing invented.
 */
export function scorePair(p1: Payment, p2: Payment, order1?: Order | null, order2?: Order | null) {
  const evidence: EvidenceItem[] = [];
  let score = 0;

  // Same customer
  const sameCustomer = p1.customer_id === p2.customer_id;
  evidence.push({
    label: "Same customer",
    detail: sameCustomer ? `Both payments belong to ${p1.customer_id}` : `Different customers (${p1.customer_id} vs ${p2.customer_id})`,
    points: sameCustomer ? 20 : 0,
    matched: sameCustomer,
  });
  if (sameCustomer) score += 20;

  // Same amount
  const sameAmount = p1.amount === p2.amount;
  evidence.push({
    label: "Same amount",
    detail: sameAmount ? `Both payments are for \u20b9${p1.amount.toLocaleString("en-IN")}` : `Amounts differ (\u20b9${p1.amount} vs \u20b9${p2.amount})`,
    points: sameAmount ? 20 : 0,
    matched: sameAmount,
  });
  if (sameAmount) score += 20;

  // Same order/service
  const sameOrder = !!p1.order_id && p1.order_id === p2.order_id;
  const svc1 = order1?.service;
  const svc2 = order2?.service;
  evidence.push({
    label: "Same service/order",
    detail: sameOrder
      ? `Both linked to order ${p1.order_id}${svc1 ? ` (${svc1})` : ""}`
      : svc1 && svc2 && svc1 !== svc2
      ? `Different services (${svc1} vs ${svc2})`
      : `Payments reference different or missing orders`,
    points: sameOrder ? 20 : 0,
    matched: sameOrder,
  });
  if (sameOrder) score += 20;

  // Close transaction time
  const diffMinutes = minutesBetween(p1.created_at, p2.created_at);
  let timePoints = 0;
  if (diffMinutes <= 30) timePoints = 15;
  else if (diffMinutes <= 120) timePoints = 8;
  else if (diffMinutes <= 1440) timePoints = 3;
  evidence.push({
    label: "Close transaction time",
    detail: `Payments occurred ${formatMinutes(diffMinutes)} apart`,
    points: timePoints,
    matched: timePoints > 0,
  });
  score += timePoints;

  // Different payment methods
  const diffMethod = p1.method !== p2.method;
  evidence.push({
    label: "Different payment methods",
    detail: diffMethod ? `${p1.method} \u2192 ${p2.method}` : `Same method used both times (${p1.method})`,
    points: diffMethod ? 5 : 0,
    matched: diffMethod,
  });
  if (diffMethod) score += 5;

  // Ordering by time to identify "first" and "second" payment
  const [earlier, later] = new Date(p1.created_at) <= new Date(p2.created_at) ? [p1, p2] : [p2, p1];

  // First payment initially pending/failed
  const firstWasPendingOrFailed = earlier.initial_status === "PENDING" || earlier.initial_status === "FAILED";
  evidence.push({
    label: "First payment was initially pending or failed",
    detail: firstWasPendingOrFailed
      ? `${earlier.payment_id} started as ${earlier.initial_status}, prompting a retry`
      : `${earlier.payment_id} started as ${earlier.initial_status}`,
    points: firstWasPendingOrFailed ? 10 : 0,
    matched: firstWasPendingOrFailed,
  });
  if (firstWasPendingOrFailed) score += 10;

  // Both eventually succeeded
  const bothSucceeded = p1.current_status === "SUCCESS" && p2.current_status === "SUCCESS";
  evidence.push({
    label: "Both payments ultimately settled",
    detail: bothSucceeded
      ? `Both ${p1.payment_id} and ${p2.payment_id} are now SUCCESS`
      : `Not both payments are currently SUCCESS`,
    points: bothSucceeded ? 10 : 0,
    matched: bothSucceeded,
  });
  if (bothSucceeded) score += 10;

  return { score: Math.min(score, 100), evidence, earlier, later };
}

function formatMinutes(mins: number) {
  if (mins < 60) return `${Math.round(mins)} minute${Math.round(mins) === 1 ? "" : "s"}`;
  if (mins < 1440) return `${(mins / 60).toFixed(1)} hours`;
  return `${(mins / 1440).toFixed(1)} days`;
}

function existingCasePaymentIds(db: ReturnType<typeof getDb>): Set<string> {
  const rows = db.prepare(`SELECT payment_ids FROM resolution_cases`).all() as { payment_ids: string }[];
  const set = new Set<string>();
  for (const r of rows) {
    try {
      const ids = JSON.parse(r.payment_ids) as string[];
      ids.forEach((id) => set.add(id));
    } catch {
      /* ignore */
    }
  }
  return set;
}

/**
 * Core detection routine: scans all payments, groups by customer, evaluates every
 * plausible pair (same amount, not already covered by a case), and creates
 * resolution cases for anything at or above the MEDIUM threshold.
 */
export function runDuplicateDetection() {
  const db = getDb();
  const payments = db.prepare(`SELECT * FROM payments ORDER BY created_at ASC`).all() as Payment[];
  const orders = db.prepare(`SELECT * FROM orders`).all() as Order[];
  const orderMap = new Map(orders.map((o) => [o.order_id, o]));
  const covered = existingCasePaymentIds(db);

  const byCustomer = new Map<string, Payment[]>();
  for (const p of payments) {
    if (!byCustomer.has(p.customer_id)) byCustomer.set(p.customer_id, []);
    byCustomer.get(p.customer_id)!.push(p);
  }

  const results: { caseId: string; score: number; band: ConfidenceBand; paymentIds: string[] }[] = [];
  const consideredButLow: { paymentIds: string[]; score: number }[] = [];

  const insertCase = db.prepare(`
    INSERT INTO resolution_cases
      (case_id, case_type, customer_id, order_id, payment_ids, confidence, confidence_band, evidence, recommendation, recommended_amount, status, created_at, updated_at)
    VALUES
      (@case_id, @case_type, @customer_id, @order_id, @payment_ids, @confidence, @confidence_band, @evidence, @recommendation, @recommended_amount, @status, @created_at, @updated_at)
  `);

  for (const [customerId, list] of byCustomer) {
    for (let i = 0; i < list.length; i++) {
      for (let j = i + 1; j < list.length; j++) {
        const p1 = list[i];
        const p2 = list[j];
        if (p1.amount !== p2.amount) continue; // different amounts are never duplicates here
        if (covered.has(p1.payment_id) && covered.has(p2.payment_id)) continue;
        if (covered.has(p1.payment_id) || covered.has(p2.payment_id)) continue;
        // A "duplicate payment" case only exists if the customer was actually
        // charged twice. If either payment never reached SUCCESS, this is a
        // legitimate retry (the first attempt genuinely failed/is pending) —
        // not an overpayment — so it's excluded before scoring, not merely
        // down-weighted.
        if (p1.current_status !== "SUCCESS" || p2.current_status !== "SUCCESS") continue;

        const order1 = p1.order_id ? orderMap.get(p1.order_id) ?? null : null;
        const order2 = p2.order_id ? orderMap.get(p2.order_id) ?? null : null;
        const { score, evidence, earlier, later } = scorePair(p1, p2, order1, order2);

        if (score < MEDIUM_THRESHOLD) {
          consideredButLow.push({ paymentIds: [p1.payment_id, p2.payment_id], score });
          continue;
        }

        const band = confidenceBand(score);
        const now = new Date().toISOString();
        const caseId = "RC-" + (10000 + Math.floor(Math.random() * 89999));
        const orderId = p1.order_id === p2.order_id ? p1.order_id : null;

        const isHigh = band === "HIGH";
        const status = isHigh ? "AWAITING_APPROVAL" : "MANUAL_REVIEW";
        const recommendation = isHigh ? `Refund ${later.payment_id}` : null;
        const recommendedAmount = isHigh ? later.amount : null;

        insertCase.run({
          case_id: caseId,
          case_type: "DUPLICATE_PAYMENT",
          customer_id: customerId,
          order_id: orderId,
          payment_ids: JSON.stringify([p1.payment_id, p2.payment_id]),
          confidence: score,
          confidence_band: band,
          evidence: JSON.stringify(evidence),
          recommendation,
          recommended_amount: recommendedAmount,
          status,
          created_at: now,
          updated_at: now,
        });

        covered.add(p1.payment_id);
        covered.add(p2.payment_id);

        // Audit trail: reconstruct the pipeline stages for this case
        recordAudit({
          caseId,
          eventType: "DUPLICATE_DETECTION_TRIGGERED",
          actor: "ReconcileX Agent",
          reason: `Evaluated ${p1.payment_id} and ${p2.payment_id} across ${evidence.length} signals`,
          newState: "DETECTED",
          metadata: { confidence: score, band },
        });
        recordAudit({
          caseId,
          eventType: "INVESTIGATION_STARTED",
          actor: "ReconcileX Agent",
          reason: "Reconstructing payment timeline and comparing transaction context",
          previousState: "DETECTED",
          newState: "INVESTIGATING",
        });

        if (isHigh) {
          recordAudit({
            caseId,
            eventType: "RESOLUTION_CASE_CREATED",
            actor: "ReconcileX Agent",
            reason: `High confidence duplicate (${score}%)`,
            previousState: "INVESTIGATING",
            newState: "RECOMMENDATION_CREATED",
          });
          recordAudit({
            caseId,
            eventType: "RECOMMENDATION_GENERATED",
            actor: "ReconcileX Agent",
            reason: `Recommend refunding ${later.payment_id} (\u20b9${later.amount}) as the duplicate of ${earlier.payment_id}`,
            previousState: "RECOMMENDATION_CREATED",
            newState: "AWAITING_APPROVAL",
            action: recommendation,
          });
        } else {
          recordAudit({
            caseId,
            eventType: "SENT_TO_MANUAL_REVIEW",
            actor: "ReconcileX Agent",
            reason: `Medium confidence (${score}%) — evidence is ambiguous, routed to manual review instead of an automatic recommendation`,
            previousState: "INVESTIGATING",
            newState: "MANUAL_REVIEW",
          });
        }

        results.push({ caseId, score, band, paymentIds: [p1.payment_id, p2.payment_id] });
      }
    }
  }

  return { casesCreated: results, consideredButLow };
}

/**
 * Secondary detector: flags orders whose recorded status/amount is inconsistent
 * with the payments actually linked to them. Kept intentionally simple —
 * this prototype's primary focus is duplicate-payment resolution.
 */
export function runOrderPaymentMismatchDetection() {
  const db = getDb();
  const orders = db.prepare(`SELECT * FROM orders`).all() as Order[];
  const covered = existingCasePaymentIds(db);
  const created: string[] = [];

  const insertCase = db.prepare(`
    INSERT INTO resolution_cases
      (case_id, case_type, customer_id, order_id, payment_ids, confidence, confidence_band, evidence, recommendation, recommended_amount, status, created_at, updated_at)
    VALUES
      (@case_id, @case_type, @customer_id, @order_id, @payment_ids, @confidence, @confidence_band, @evidence, @recommendation, @recommended_amount, @status, @created_at, @updated_at)
  `);

  for (const order of orders) {
    const payments = db
      .prepare(`SELECT * FROM payments WHERE order_id = ?`)
      .all(order.order_id) as Payment[];
    if (payments.length === 0) continue;
    if (payments.some((p) => covered.has(p.payment_id))) continue;

    const successfulPayments = payments.filter((p) => p.current_status === "SUCCESS");
    const totalPaid = successfulPayments.reduce((sum, p) => sum + p.amount, 0);

    const mismatch = order.status === "COMPLETED" && totalPaid !== order.amount;
    if (!mismatch) continue;

    const evidence: EvidenceItem[] = [
      {
        label: "Order marked completed",
        detail: `Order ${order.order_id} for ${order.service} is COMPLETED, expected \u20b9${order.amount}`,
        points: 40,
        matched: true,
      },
      {
        label: "Payment total mismatch",
        detail: `Linked successful payments total \u20b9${totalPaid}, not \u20b9${order.amount}`,
        points: 40,
        matched: true,
      },
    ];

    const now = new Date().toISOString();
    const caseId = "RC-" + (10000 + Math.floor(Math.random() * 89999));
    insertCase.run({
      case_id: caseId,
      case_type: "ORDER_PAYMENT_MISMATCH",
      customer_id: order.customer_id,
      order_id: order.order_id,
      payment_ids: JSON.stringify(payments.map((p) => p.payment_id)),
      confidence: 80,
      confidence_band: "MEDIUM",
      evidence: JSON.stringify(evidence),
      recommendation: null,
      recommended_amount: null,
      status: "MANUAL_REVIEW",
      created_at: now,
      updated_at: now,
    });

    recordAudit({
      caseId,
      eventType: "ORDER_PAYMENT_MISMATCH_DETECTED",
      actor: "ReconcileX Agent",
      reason: `Order ${order.order_id} total paid (\u20b9${totalPaid}) does not match order amount (\u20b9${order.amount})`,
      newState: "MANUAL_REVIEW",
    });

    created.push(caseId);
  }

  return created;
}

/**
 * How long a refund can sit in PROCESSING before ReconcileX flags it for
 * operator follow-up. Razorpay Test Mode refunds are asynchronous (see the
 * comment on createRazorpayRefund in lib/razorpay.ts) — a 200 response only
 * means "accepted", not "money returned". In practice Test Mode refunds
 * usually settle within minutes, so anything still PROCESSING past this
 * window is more likely a missed webhook (e.g. no public URL registered)
 * than a refund still genuinely in flight.
 *
 * Defaults to 2 minutes so this is demo-friendly out of the box — approve
 * a refund, wait ~2 minutes, run detection again, and it flags. Set
 * STUCK_REFUND_THRESHOLD_MINUTES to something larger (e.g. 30) for a
 * deployment that isn't just a live demo.
 */
const STUCK_REFUND_THRESHOLD_MINUTES = Number(process.env.STUCK_REFUND_THRESHOLD_MINUTES) || 2;

interface StuckRefundRow {
  refund_id: string;
  case_id: string;
  payment_id: string;
  amount: number;
  status: string;
  created_at: string;
}

/**
 * Third detector: finds refunds that were initiated (simulated or via a
 * real Razorpay Test Mode call) but have sat in PROCESSING for longer than
 * STUCK_REFUND_THRESHOLD_MINUTES without ever reaching COMPLETED or FAILED.
 *
 * This does not create a brand-new case. The case already exists — created
 * by whatever originally triggered the refund (a duplicate payment, an
 * order mismatch, etc). A stuck refund re-labels that case as STUCK_REFUND
 * so it surfaces in the "Stuck Refund" filter and dashboard count, and logs
 * a single REFUND_STUCK_FLAGGED audit event explaining exactly when and why
 * it was flagged — the same event type lib/seed.ts already uses for the
 * seeded stuck-refund demo case, so seeded and live-detected cases behave
 * identically in the UI.
 *
 * Idempotent: a case that has already been flagged once is never flagged
 * again, even if this runs on every page load / polling interval.
 */
export function runStuckRefundDetection() {
  const db = getDb();
  const cutoff = new Date(Date.now() - STUCK_REFUND_THRESHOLD_MINUTES * 60_000).toISOString();

  const stuckRefunds = db
    .prepare(`SELECT * FROM refunds WHERE status = 'PROCESSING' AND created_at <= ?`)
    .all(cutoff) as StuckRefundRow[];

  const alreadyFlagged = db
    .prepare(`SELECT DISTINCT case_id FROM audit_events WHERE event_type = 'REFUND_STUCK_FLAGGED'`)
    .all() as { case_id: string }[];
  const flaggedSet = new Set(alreadyFlagged.map((r) => r.case_id));

  const updateCaseType = db.prepare(
    `UPDATE resolution_cases SET case_type = 'STUCK_REFUND', updated_at = ? WHERE case_id = ?`
  );

  const flagged: string[] = [];

  for (const refund of stuckRefunds) {
    if (flaggedSet.has(refund.case_id)) continue;

    const ageMinutes = Math.round((Date.now() - new Date(refund.created_at).getTime()) / 60000);
    const now = new Date().toISOString();

    updateCaseType.run(now, refund.case_id);

    recordAudit({
      caseId: refund.case_id,
      paymentId: refund.payment_id,
      eventType: "REFUND_STUCK_FLAGGED",
      actor: "ReconcileX Agent",
      reason: `Refund ${refund.refund_id} for \u20b9${refund.amount.toLocaleString(
        "en-IN"
      )} has been PROCESSING for ${ageMinutes} minutes (threshold: ${STUCK_REFUND_THRESHOLD_MINUTES}m) with no completion webhook received — flagged for operator follow-up`,
      newState: "REFUND_INITIATED",
    });

    flagged.push(refund.case_id);
  }

  return flagged;
}

export function runFullDetection() {
  const dup = runDuplicateDetection();
  const mismatches = runOrderPaymentMismatchDetection();
  const stuckRefunds = runStuckRefundDetection();
  return { ...dup, mismatchCasesCreated: mismatches, stuckRefundsFlagged: stuckRefunds };
}

export { randomUUID };
