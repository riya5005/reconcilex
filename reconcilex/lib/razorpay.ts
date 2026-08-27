import crypto from "crypto";

/**
 * Thin wrapper around Razorpay's REST API using plain `fetch` — no SDK
 * dependency added. Every function here runs server-side only; the secret
 * key and webhook secret never leave this file's scope.
 *
 * IMPORTANT: this project only ever uses Razorpay TEST MODE keys (they start
 * with rzp_test_). Nothing here distinguishes test vs live beyond "whatever
 * key you put in the environment" — it is the operator's responsibility to
 * only ever place rzp_test_ credentials in this app. See README security
 * notes for why we don't try to auto-detect/enforce this from the key prefix
 * alone (Razorpay does not guarantee that check is forward-compatible).
 */

const RAZORPAY_API_BASE = "https://api.razorpay.com/v1";

export interface RazorpayConfig {
  keyId: string;
  keySecret: string;
  webhookSecret: string | null;
}

export function getRazorpayConfig(): RazorpayConfig | null {
  const keyId = process.env.RAZORPAY_KEY_ID;
  const keySecret = process.env.RAZORPAY_KEY_SECRET;
  if (!keyId || !keySecret) return null;
  return {
    keyId,
    keySecret,
    webhookSecret: process.env.RAZORPAY_WEBHOOK_SECRET || null,
  };
}

export function isRazorpayConfigured(): boolean {
  return getRazorpayConfig() !== null;
}

export function isWebhookConfigured(): boolean {
  return !!getRazorpayConfig()?.webhookSecret;
}

function authHeader(config: RazorpayConfig) {
  const token = Buffer.from(`${config.keyId}:${config.keySecret}`).toString("base64");
  return `Basic ${token}`;
}

export class RazorpayApiError extends Error {
  status: number;
  body: unknown;
  constructor(message: string, status: number, body: unknown) {
    super(message);
    this.status = status;
    this.body = body;
  }
}

/**
 * Create a Razorpay Test Mode order. Amount must already be in the smallest
 * currency unit (paise for INR) — the caller is responsible for that
 * conversion; this function does not guess.
 */
export async function createRazorpayOrder(params: {
  amountPaise: number;
  currency?: string;
  receipt?: string;
  notes?: Record<string, string>;
}): Promise<{ id: string; amount: number; currency: string; status: string }> {
  const config = getRazorpayConfig();
  if (!config) throw new Error("Razorpay is not configured (RAZORPAY_KEY_ID/RAZORPAY_KEY_SECRET missing).");

  const res = await fetch(`${RAZORPAY_API_BASE}/orders`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: authHeader(config),
    },
    body: JSON.stringify({
      amount: params.amountPaise,
      currency: params.currency || "INR",
      receipt: params.receipt,
      notes: params.notes,
    }),
  });

  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new RazorpayApiError(
      body?.error?.description || `Razorpay order creation failed (${res.status})`,
      res.status,
      body
    );
  }
  return body;
}

/**
 * Fetch a payment's details directly from Razorpay — used to verify a
 * payment server-side instead of trusting whatever the browser reports
 * after Checkout closes.
 */
export async function fetchRazorpayPayment(paymentId: string): Promise<Record<string, unknown>> {
  const config = getRazorpayConfig();
  if (!config) throw new Error("Razorpay is not configured.");

  const res = await fetch(`${RAZORPAY_API_BASE}/payments/${paymentId}`, {
    headers: { authorization: authHeader(config) },
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new RazorpayApiError(
      (body as { error?: { description?: string } })?.error?.description ||
        `Failed to fetch Razorpay payment ${paymentId} (${res.status})`,
      res.status,
      body
    );
  }
  return body;
}

/**
 * Create a Test Mode refund for a captured payment. amountPaise omitted =
 * full refund. Razorpay refunds are asynchronous even in test mode — a
 * 200 response here means "refund accepted", not "money returned"; the
 * `status` field on the response (and later the refund.processed webhook,
 * where reachable) is what actually confirms completion.
 */
export async function createRazorpayRefund(
  paymentId: string,
  amountPaise?: number,
  idempotencyKey?: string
): Promise<{ id: string; status: string; amount: number }> {
  const config = getRazorpayConfig();
  if (!config) throw new Error("Razorpay is not configured.");

  const res = await fetch(`${RAZORPAY_API_BASE}/payments/${paymentId}/refund`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: authHeader(config),
      // Razorpay's documented idempotency mechanism for the Refunds API uses
      // the X-Refund-Idempotency header (NOT a generic "X-Razorpay-..." name —
      // that was wrong in an earlier version of this file). Per Razorpay's
      // docs this key must be a UNIQUE string per logical refund attempt, at
      // least 10 characters, using only letters/numbers/hyphens/underscores.
      // Retrying with the SAME key + SAME body returns the original result
      // instead of creating a second refund; a different body with the same
      // key is rejected as BAD_REQUEST. We pass our own internal refund_id
      // (format "RFD-XXXXXXXX", 12 chars) which satisfies all of that and is
      // stable for the lifetime of a given case's refund attempt.
      ...(idempotencyKey ? { "X-Refund-Idempotency": idempotencyKey } : {}),
    },
    body: JSON.stringify(amountPaise ? { amount: amountPaise } : {}),
  });

  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new RazorpayApiError(
      (body as { error?: { description?: string } })?.error?.description ||
        `Razorpay refund failed (${res.status})`,
      res.status,
      body
    );
  }
  return body;
}

export async function fetchRazorpayRefund(refundId: string): Promise<Record<string, unknown>> {
  const config = getRazorpayConfig();
  if (!config) throw new Error("Razorpay is not configured.");

  const res = await fetch(`${RAZORPAY_API_BASE}/refunds/${refundId}`, {
    headers: { authorization: authHeader(config) },
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new RazorpayApiError(
      (body as { error?: { description?: string } })?.error?.description ||
        `Failed to fetch Razorpay refund ${refundId} (${res.status})`,
      res.status,
      body
    );
  }
  return body;
}

/**
 * Verify the signature Razorpay Checkout returns after a successful payment:
 * HMAC-SHA256(order_id + "|" + payment_id, key_secret) must equal the
 * signature the frontend received. Never trust a client-reported "payment
 * succeeded" without this check.
 */
export function verifyCheckoutSignature(
  razorpayOrderId: string,
  razorpayPaymentId: string,
  signature: string
): boolean {
  const config = getRazorpayConfig();
  if (!config) return false;
  const expected = crypto
    .createHmac("sha256", config.keySecret)
    .update(`${razorpayOrderId}|${razorpayPaymentId}`)
    .digest("hex");
  return timingSafeEqualHex(expected, signature);
}

/**
 * Verify an incoming webhook's X-Razorpay-Signature header against the raw
 * request body using the separate webhook secret (never the key secret).
 * Must be called with the UNPARSED raw body string — signatures are
 * computed over exact bytes, not the re-serialized JSON.
 */
export function verifyWebhookSignature(rawBody: string, signature: string | null): boolean {
  const config = getRazorpayConfig();
  if (!config || !config.webhookSecret || !signature) return false;
  const expected = crypto.createHmac("sha256", config.webhookSecret).update(rawBody).digest("hex");
  return timingSafeEqualHex(expected, signature);
}

function timingSafeEqualHex(a: string, b: string): boolean {
  const bufA = Buffer.from(a, "hex");
  const bufB = Buffer.from(b, "hex");
  if (bufA.length !== bufB.length) return false;
  try {
    return crypto.timingSafeEqual(bufA, bufB);
  } catch {
    return false;
  }
}

/** Map Razorpay's payment method string to ReconcileX's PaymentMethod union. */
export function mapRazorpayMethod(method: string | undefined, cardType?: string | undefined): string {
  switch (method) {
    case "card":
      return cardType === "debit" ? "Debit Card" : "Credit Card";
    case "upi":
      return "UPI";
    case "netbanking":
      return "Net Banking";
    case "wallet":
      return "Wallet";
    default:
      return "UPI"; // safest common default when Razorpay sends a method we haven't mapped
  }
}

/** Convert a rupee amount to paise for Razorpay's smallest-unit requirement. */
export function toPaise(rupees: number): number {
  return Math.round(rupees * 100);
}

/** Convert paise back to rupees for storage in ReconcileX's own tables. */
export function fromPaise(paise: number): number {
  return Math.round(paise) / 100;
}
