import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { recordAudit } from "@/lib/audit";
import { runFullDetection } from "@/lib/detection";
import { verifyWebhookSignature, mapRazorpayMethod, fromPaise, isWebhookConfigured } from "@/lib/razorpay";
import { ingestRazorpayPayment } from "@/lib/razorpayIngest";
import { PaymentStatus, Payment } from "@/lib/types";
import crypto from "crypto";

/**
 * POST /api/webhooks/razorpay
 *
 * SECURITY NOTE (read before relying on this in any real deployment):
 * Razorpay must be able to reach this URL over the public internet — a
 * webhook configured against http://localhost:3000/... will never actually
 * fire, because Razorpay's servers cannot connect to your machine. To test
 * this locally you need a tunnel (e.g. `ngrok http 3000`) and to register
 * the tunnel's https URL + a webhook secret in the Razorpay Test Mode
 * dashboard. Without that, use POST /api/razorpay/payments/confirm (the
 * client-confirmation path) to exercise the same ingestion logic — it is
 * reachable from your own browser and requires no public URL.
 *
 * We deliberately read the RAW body (not `req.json()`) because Razorpay's
 * signature is computed over the exact bytes sent, not a re-serialized copy.
 */
export async function POST(req: Request) {
  const rawBody = await req.text();
  const signature = req.headers.get("x-razorpay-signature");

  if (!isWebhookConfigured()) {
    return NextResponse.json(
      { error: "Webhook secret not configured (RAZORPAY_WEBHOOK_SECRET missing). Rejecting for safety." },
      { status: 503 }
    );
  }

  if (!verifyWebhookSignature(rawBody, signature)) {
    recordAudit({
      eventType: "RAZORPAY_WEBHOOK_SIGNATURE_INVALID",
      actor: "Razorpay Webhook",
      reason: "Rejected an incoming webhook with an invalid or missing signature",
    });
    return NextResponse.json({ error: "Invalid webhook signature." }, { status: 400 });
  }

  let payload: {
    event: string;
    payload?: { payment?: { entity?: Record<string, unknown> }; refund?: { entity?: Record<string, unknown> } };
  };
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const db = getDb();

  // --- Idempotency: Razorpay may deliver the same event more than once. ---
  // Prefer Razorpay's own event id header if present; otherwise derive a
  // stable id from a hash of the raw payload so a true duplicate delivery
  // is always recognized even without that header.
  const eventId =
    req.headers.get("x-razorpay-event-id") ||
    "HASH-" + crypto.createHash("sha256").update(rawBody).digest("hex").slice(0, 24);

  const already = db.prepare(`SELECT status FROM webhook_events WHERE event_id = ?`).get(eventId) as
    | { status: string }
    | undefined;
  if (already) {
    return NextResponse.json({ message: "Event already processed (idempotent no-op).", eventId }, { status: 200 });
  }

  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO webhook_events (event_id, event_type, payload_hash, received_at, status)
     VALUES (?, ?, ?, ?, 'RECEIVED')`
  ).run(eventId, payload.event, crypto.createHash("sha256").update(rawBody).digest("hex"), now);

  try {
    if (payload.event === "payment.captured" || payload.event === "payment.failed") {
      const entity = payload.payload?.payment?.entity;
      if (!entity) throw new Error("Webhook missing payment entity");

      const razorpayOrderId = entity.order_id as string | undefined;
      const orderRow = razorpayOrderId
        ? (db.prepare(`SELECT * FROM razorpay_orders WHERE razorpay_order_id = ?`).get(razorpayOrderId) as
            | { internal_order_id: string | null }
            | undefined)
        : undefined;
      const internalOrder = orderRow?.internal_order_id
        ? (db.prepare(`SELECT * FROM orders WHERE order_id = ?`).get(orderRow.internal_order_id) as
            | { customer_id: string }
            | undefined)
        : undefined;

      const status: PaymentStatus = payload.event === "payment.captured" ? "SUCCESS" : "FAILED";
      const method = mapRazorpayMethod(
        entity.method as string | undefined,
        (entity.card as { type?: string } | undefined)?.type
      );

      ingestRazorpayPayment({
        customerId: internalOrder?.customer_id || (entity.notes as { customer_id?: string })?.customer_id || "UNKNOWN",
        orderId: orderRow?.internal_order_id ?? null,
        razorpayPaymentId: entity.id as string,
        razorpayOrderId: razorpayOrderId ?? null,
        amountRupees: fromPaise(Number(entity.amount)),
        method,
        status,
        actor: "Razorpay Webhook",
        source: "webhook",
      });

      // Same detection engine used everywhere else — Razorpay payments are
      // evaluated by the identical duplicate/mismatch logic as simulated ones.
      runFullDetection();
    } else if (payload.event === "refund.processed" || payload.event === "refund.failed") {
      const entity = payload.payload?.refund?.entity;
      if (!entity) throw new Error("Webhook missing refund entity");

      const razorpayPaymentId = entity.payment_id as string;
      const razorpayRefundId = entity.id as string;
      const payment = db
        .prepare(`SELECT * FROM payments WHERE razorpay_payment_id = ?`)
        .get(razorpayPaymentId) as Payment | undefined;

      const refundRow = db
        .prepare(`SELECT * FROM refunds WHERE razorpay_refund_id = ?`)
        .get(razorpayRefundId) as { refund_id: string; case_id: string } | undefined;

      if (refundRow) {
        const newStatus = payload.event === "refund.processed" ? "COMPLETED" : "FAILED";
        db.prepare(`UPDATE refunds SET status = ?, updated_at = ? WHERE refund_id = ?`).run(
          newStatus,
          now,
          refundRow.refund_id
        );

        recordAudit({
          caseId: refundRow.case_id,
          paymentId: payment?.payment_id,
          eventType: "RAZORPAY_REFUND_WEBHOOK",
          actor: "Razorpay Webhook",
          reason: `Razorpay refund ${razorpayRefundId} reported ${newStatus.toLowerCase()}`,
          newState: newStatus,
        });

        if (newStatus === "COMPLETED" && payment) {
          db.prepare(`UPDATE payments SET current_status = 'REFUNDED', updated_at = ? WHERE payment_id = ?`).run(
            now,
            payment.payment_id
          );
          db.prepare(`UPDATE resolution_cases SET status = 'REFUND_COMPLETED', updated_at = ? WHERE case_id = ?`).run(
            now,
            refundRow.case_id
          );
          recordAudit({
            caseId: refundRow.case_id,
            paymentId: payment.payment_id,
            eventType: "REFUND_COMPLETED",
            actor: "Razorpay Webhook",
            reason: "Razorpay confirmed the refund completed",
            newState: "REFUND_COMPLETED",
          });
          db.prepare(`UPDATE resolution_cases SET status = 'RESOLVED', updated_at = ? WHERE case_id = ?`).run(
            now,
            refundRow.case_id
          );
          recordAudit({
            caseId: refundRow.case_id,
            eventType: "CASE_RESOLVED",
            actor: "ReconcileX Agent",
            reason: "Refund verified complete via Razorpay webhook; case closed",
            newState: "RESOLVED",
          });
        }
      }
    }

    db.prepare(`UPDATE webhook_events SET status = 'PROCESSED', processed_at = ? WHERE event_id = ?`).run(now, eventId);
    return NextResponse.json({ message: "Webhook processed.", eventId, event: payload.event });
  } catch (err) {
    console.error(err);
    db.prepare(`UPDATE webhook_events SET status = 'FAILED', processed_at = ? WHERE event_id = ?`).run(now, eventId);
    return NextResponse.json({ error: "Webhook processing failed." }, { status: 500 });
  }
}
