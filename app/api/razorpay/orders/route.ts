import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { createRazorpayOrder, isRazorpayConfigured, toPaise, RazorpayApiError } from "@/lib/razorpay";
import { randomUUID } from "crypto";

/**
 * POST /api/razorpay/orders
 * body: { customerId, customerName, service, amount, internalOrderId? }
 *
 * If `internalOrderId` refers to an existing order, we attach the new
 * Razorpay order to it. Otherwise we create a small demo business order so
 * the Razorpay Test Demo page has something real to reconcile against —
 * this still goes through the exact same `orders` table the deterministic
 * engine already reads, per the integration requirement.
 */
interface CreateOrderBody {
  customerId?: string;
  customerName?: string;
  service?: string;
  amount?: number;
  internalOrderId?: string;
}

export async function POST(req: Request) {
  if (!isRazorpayConfigured()) {
    return NextResponse.json(
      { error: "Razorpay is not configured on the server (RAZORPAY_KEY_ID / RAZORPAY_KEY_SECRET missing)." },
      { status: 503 }
    );
  }

  try {
    const body = (await req.json().catch(() => ({}))) as CreateOrderBody;
    const { customerId, customerName, service, internalOrderId } = body;
    const amount = typeof body.amount === "number" ? body.amount : Number(body.amount);

    if (!customerId || !amount || amount <= 0) {
      return NextResponse.json({ error: "customerId and a positive amount are required." }, { status: 400 });
    }

    const db = getDb();
    const now = new Date().toISOString();

    // Ensure the customer exists (idempotent).
    db.prepare(`INSERT OR IGNORE INTO customers (customer_id, name) VALUES (?, ?)`).run(
      customerId,
      customerName || customerId
    );

    // Resolve or create the business order this payment is for. `orderId` is
    // deliberately typed `string | undefined` until every branch below has
    // definitely assigned it — this is what surfaces a real compile error if
    // a future edit forgets a branch, instead of silently passing `undefined`
    // through to the SQL insert (which better-sqlite3 would happily bind as
    // NULL, corrupting the row rather than failing loudly).
    let orderId: string | undefined;

    if (internalOrderId) {
      const existing = db.prepare(`SELECT order_id FROM orders WHERE order_id = ?`).get(internalOrderId);
      if (!existing) {
        return NextResponse.json({ error: `Order ${internalOrderId} does not exist.` }, { status: 404 });
      }
      orderId = internalOrderId;
    } else {
      orderId = "ORD-RZP-" + randomUUID().slice(0, 6).toUpperCase();
      db.prepare(
        `INSERT INTO orders (order_id, customer_id, service, amount, status) VALUES (?, ?, ?, ?, ?)`
      ).run(orderId, customerId, service || "Razorpay Test Demo", amount, "PENDING");
    }

    const amountPaise = toPaise(amount);
    const receipt = `RC-${orderId}-${Date.now()}`;

    const rzpOrder = await createRazorpayOrder({
      amountPaise,
      currency: "INR",
      receipt,
      notes: { internal_order_id: orderId, customer_id: customerId },
    });

    db.prepare(
      `INSERT INTO razorpay_orders (razorpay_order_id, internal_order_id, amount, currency, receipt, status, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    ).run(rzpOrder.id, orderId, amount, rzpOrder.currency, receipt, rzpOrder.status, now);

    return NextResponse.json({
      razorpayOrderId: rzpOrder.id,
      amountPaise: rzpOrder.amount,
      currency: rzpOrder.currency,
      keyId: process.env.RAZORPAY_KEY_ID,
      internalOrderId: orderId,
      customerId,
    });
  } catch (err) {
    console.error(err);
    if (err instanceof RazorpayApiError) {
      return NextResponse.json({ error: err.message }, { status: 502 });
    }
    return NextResponse.json({ error: "Failed to create Razorpay order." }, { status: 500 });
  }
}
