import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { recordAudit } from "@/lib/audit";
import { runFullDetection } from "@/lib/detection";
import {
  verifyCheckoutSignature,
  fetchRazorpayPayment,
  isRazorpayConfigured,
  mapRazorpayMethod,
  fromPaise,
  RazorpayApiError,
} from "@/lib/razorpay";
import { ingestRazorpayPayment } from "@/lib/razorpayIngest";
import { PaymentStatus } from "@/lib/types";

/**
 * POST /api/razorpay/payments/confirm
 * body: { razorpay_order_id, razorpay_payment_id, razorpay_signature }
 *
 * This exists because Razorpay Checkout's success callback runs in the
 * browser — we never trust it directly. This endpoint:
 *   1. Verifies the HMAC signature Razorpay provides against our secret.
 *   2. Re-fetches the payment from Razorpay's API server-to-server (so the
 *      amount/method/status we store are Razorpay's own records, not
 *      whatever the browser sent).
 *   3. Writes into the SAME payments table the detection engine reads,
 *      idempotently keyed by razorpay_payment_id.
 *   4. Runs the existing deterministic detection engine.
 *
 * If your webhook is also configured and reachable (it generally is NOT on
 * localhost without a tunnel — see README), the webhook will independently
 * arrive and hit the same idempotent ingest path with no duplicate effect.
 */
interface ConfirmBody {
  razorpay_order_id?: string;
  razorpay_payment_id?: string;
  razorpay_signature?: string;
}

export async function POST(req: Request) {
  if (!isRazorpayConfigured()) {
    return NextResponse.json({ error: "Razorpay is not configured on the server." }, { status: 503 });
  }

  try {
    const body = (await req.json().catch(() => ({}))) as ConfirmBody;
    const { razorpay_order_id, razorpay_payment_id, razorpay_signature } = body;
    if (!razorpay_order_id || !razorpay_payment_id || !razorpay_signature) {
      return NextResponse.json({ error: "Missing Razorpay checkout fields." }, { status: 400 });
    }

    const validSignature = verifyCheckoutSignature(razorpay_order_id, razorpay_payment_id, razorpay_signature);
    if (!validSignature) {
      recordAudit({
        eventType: "RAZORPAY_SIGNATURE_INVALID",
        actor: "Razorpay Checkout Confirmation",
        reason: `Signature verification failed for order ${razorpay_order_id} / payment ${razorpay_payment_id}`,
      });
      return NextResponse.json({ error: "Invalid payment signature. Payment was not recorded." }, { status: 400 });
    }

    const db = getDb();
    const orderRow = db
      .prepare(`SELECT * FROM razorpay_orders WHERE razorpay_order_id = ?`)
      .get(razorpay_order_id) as { internal_order_id: string | null } | undefined;
    if (!orderRow) {
      return NextResponse.json({ error: "Unknown Razorpay order — was it created via this app?" }, { status: 404 });
    }

    // Server-to-server fetch — the source of truth for amount/method/status.
    const rzpPayment = await fetchRazorpayPayment(razorpay_payment_id);
    const amountRupees = fromPaise(Number(rzpPayment.amount));
    const method = mapRazorpayMethod(
      rzpPayment.method as string | undefined,
      (rzpPayment.card as { type?: string } | undefined)?.type
    );
    const rzpStatus = rzpPayment.status as string;
    const status: PaymentStatus = rzpStatus === "captured" ? "SUCCESS" : rzpStatus === "failed" ? "FAILED" : "PENDING";

    const internalOrder = orderRow.internal_order_id
      ? (db.prepare(`SELECT * FROM orders WHERE order_id = ?`).get(orderRow.internal_order_id) as
          | { customer_id: string }
          | undefined)
      : undefined;

    const { payment, created } = ingestRazorpayPayment({
      customerId: internalOrder?.customer_id || "UNKNOWN",
      orderId: orderRow.internal_order_id,
      razorpayPaymentId: razorpay_payment_id,
      razorpayOrderId: razorpay_order_id,
      amountRupees,
      method,
      status,
      actor: "Razorpay Checkout Confirmation",
      source: "client-confirm",
    });

    const detection = runFullDetection();

    return NextResponse.json({ payment, created, detection });
  } catch (err) {
    console.error(err);
    if (err instanceof RazorpayApiError) {
      return NextResponse.json({ error: err.message }, { status: 502 });
    }
    return NextResponse.json({ error: "Failed to confirm Razorpay payment." }, { status: 500 });
  }
}
