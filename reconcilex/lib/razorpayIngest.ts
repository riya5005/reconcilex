import { getDb } from "@/lib/db";
import { recordAudit } from "@/lib/audit";
import { randomUUID } from "crypto";
import { Payment, PaymentStatus } from "@/lib/types";

export interface IngestParams {
  customerId: string;
  orderId: string | null;
  razorpayPaymentId: string;
  razorpayOrderId: string | null;
  amountRupees: number;
  method: string;
  status: PaymentStatus;
  actor: string; // "Razorpay Webhook" | "Razorpay Checkout Confirmation"
  source: "webhook" | "client-confirm";
}

/**
 * Idempotently write a Razorpay-sourced payment into the SAME `payments`
 * table the deterministic detection engine already reads — per the
 * integration requirement that Razorpay payments must not live in a
 * separate "demo" table. Idempotency key is `razorpay_payment_id`: if this
 * payment has already been recorded (e.g. webhook fired twice, or both the
 * webhook AND the client confirmation arrived), we only ever update its
 * status — we never insert a second row and never create a second incident
 * for the same real-world payment.
 */
export function ingestRazorpayPayment(params: IngestParams): { payment: Payment; created: boolean } {
  const db = getDb();

  const existing = db
    .prepare(`SELECT * FROM payments WHERE razorpay_payment_id = ?`)
    .get(params.razorpayPaymentId) as Payment | undefined;

  const now = new Date().toISOString();

  if (existing) {
    if (existing.current_status !== params.status) {
      db.prepare(`UPDATE payments SET current_status = ?, updated_at = ? WHERE payment_id = ?`).run(
        params.status,
        now,
        existing.payment_id
      );
      recordAudit({
        paymentId: existing.payment_id,
        eventType: "RAZORPAY_PAYMENT_STATUS_UPDATED",
        actor: params.actor,
        reason: `Razorpay payment ${params.razorpayPaymentId} status changed`,
        previousState: existing.current_status,
        newState: params.status,
      });
    }
    const updated = db.prepare(`SELECT * FROM payments WHERE payment_id = ?`).get(existing.payment_id) as Payment;
    return { payment: updated, created: false };
  }

  const paymentId = "PAY-RZP-" + randomUUID().slice(0, 6).toUpperCase();
  db.prepare(
    `INSERT INTO payments
      (payment_id, customer_id, order_id, amount, method, initial_status, current_status, created_at, updated_at, source, razorpay_payment_id, razorpay_order_id)
     VALUES (@payment_id, @customer_id, @order_id, @amount, @method, @initial_status, @current_status, @created_at, @updated_at, @source, @razorpay_payment_id, @razorpay_order_id)`
  ).run({
    payment_id: paymentId,
    customer_id: params.customerId,
    order_id: params.orderId,
    amount: params.amountRupees,
    method: params.method,
    initial_status: params.status,
    current_status: params.status,
    created_at: now,
    updated_at: now,
    source: "RAZORPAY_TEST",
    razorpay_payment_id: params.razorpayPaymentId,
    razorpay_order_id: params.razorpayOrderId,
  });

  recordAudit({
    paymentId,
    eventType: params.source === "webhook" ? "RAZORPAY_WEBHOOK_PAYMENT_RECEIVED" : "RAZORPAY_PAYMENT_CONFIRMED",
    actor: params.actor,
    reason: `Razorpay Test Mode payment ${params.razorpayPaymentId} recorded (${params.status}) via ${
      params.source === "webhook" ? "webhook" : "client confirmation"
    }`,
    newState: params.status,
    metadata: { razorpay_order_id: params.razorpayOrderId, amount: params.amountRupees, method: params.method },
  });

  const created = db.prepare(`SELECT * FROM payments WHERE payment_id = ?`).get(paymentId) as Payment;
  return { payment: created, created: true };
}
