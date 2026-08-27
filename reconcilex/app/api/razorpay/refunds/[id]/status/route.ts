import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { recordAudit } from "@/lib/audit";
import { fetchRazorpayRefund, isRazorpayConfigured, RazorpayApiError } from "@/lib/razorpay";

/**
 * POST /api/razorpay/refunds/:id/status
 * :id is our internal refund_id (not Razorpay's rfnd_ id).
 *
 * On localhost, Razorpay's refund.processed webhook cannot reach this app
 * (see app/api/webhooks/razorpay/route.ts for why). This endpoint lets the
 * UI ask Razorpay directly "what's the status of this refund right now?"
 * instead of waiting indefinitely for a webhook that will never arrive in a
 * local dev environment. In a deployment with a real public webhook URL,
 * this button becomes optional — the webhook will update things
 * automatically — but it is never wrong to also check directly.
 */
export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!isRazorpayConfigured()) {
    return NextResponse.json({ error: "Razorpay is not configured." }, { status: 503 });
  }

  const db = getDb();
  const refund = db.prepare(`SELECT * FROM refunds WHERE refund_id = ?`).get(id) as
    | { refund_id: string; case_id: string; payment_id: string; razorpay_refund_id: string | null; status: string }
    | undefined;

  if (!refund) return NextResponse.json({ error: "Refund not found." }, { status: 404 });
  if (!refund.razorpay_refund_id) {
    return NextResponse.json({ error: "This refund has no Razorpay refund ID yet." }, { status: 400 });
  }
  if (refund.status !== "PROCESSING") {
    return NextResponse.json({ message: `Already ${refund.status}.`, refund });
  }

  try {
    const rzpRefund = await fetchRazorpayRefund(refund.razorpay_refund_id);
    const now = new Date().toISOString();
    const rzpStatus = rzpRefund.status as string; // "pending" | "processed" | "failed"

    if (rzpStatus === "processed") {
      db.prepare(`UPDATE refunds SET status = 'COMPLETED', updated_at = ? WHERE refund_id = ?`).run(now, id);
      db.prepare(`UPDATE payments SET current_status = 'REFUNDED', updated_at = ? WHERE payment_id = ?`).run(
        now,
        refund.payment_id
      );
      db.prepare(`UPDATE resolution_cases SET status = 'REFUND_COMPLETED', updated_at = ? WHERE case_id = ?`).run(
        now,
        refund.case_id
      );
      recordAudit({
        caseId: refund.case_id,
        paymentId: refund.payment_id,
        eventType: "REFUND_COMPLETED",
        actor: "Merchant Ops (manual status check)",
        reason: "Razorpay confirmed the refund as processed",
        newState: "REFUND_COMPLETED",
      });
      db.prepare(`UPDATE resolution_cases SET status = 'RESOLVED', updated_at = ? WHERE case_id = ?`).run(
        now,
        refund.case_id
      );
      recordAudit({
        caseId: refund.case_id,
        eventType: "CASE_RESOLVED",
        actor: "ReconcileX Agent",
        reason: "Refund verified complete via manual Razorpay status check; case closed",
        newState: "RESOLVED",
      });
    } else if (rzpStatus === "failed") {
      db.prepare(`UPDATE refunds SET status = 'FAILED', updated_at = ? WHERE refund_id = ?`).run(now, id);
      recordAudit({
        caseId: refund.case_id,
        paymentId: refund.payment_id,
        eventType: "REFUND_FAILED",
        actor: "Merchant Ops (manual status check)",
        reason: "Razorpay reported the refund as failed",
        newState: "FAILED",
      });
    }

    const updated = db.prepare(`SELECT * FROM refunds WHERE refund_id = ?`).get(id);
    return NextResponse.json({ razorpayStatus: rzpStatus, refund: updated });
  } catch (err) {
    console.error(err);
    if (err instanceof RazorpayApiError) {
      return NextResponse.json({ error: err.message }, { status: 502 });
    }
    return NextResponse.json({ error: "Failed to check refund status." }, { status: 500 });
  }
}
