import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const db = getDb();
    const c = db.prepare(`SELECT * FROM resolution_cases WHERE case_id = ?`).get(id) as
      | Record<string, unknown>
      | undefined;

    if (!c) {
      return NextResponse.json({ error: "Case not found" }, { status: 404 });
    }

    const paymentIds: string[] = JSON.parse(c.payment_ids as string);
    const placeholders = paymentIds.map(() => "?").join(",");
    const payments = paymentIds.length
      ? db.prepare(`SELECT * FROM payments WHERE payment_id IN (${placeholders})`).all(...paymentIds)
      : [];

    const customer = db
      .prepare(`SELECT * FROM customers WHERE customer_id = ?`)
      .get(c.customer_id as string);

    const order = c.order_id
      ? (db.prepare(`SELECT * FROM orders WHERE order_id = ?`).get(c.order_id as string) as
          | { order_id: string; amount: number }
          | undefined)
      : null;

    const audit = db
      .prepare(`SELECT * FROM audit_events WHERE case_id = ? ORDER BY timestamp ASC`)
      .all(id);

    const investigation = db
      .prepare(`SELECT * FROM ai_investigations WHERE case_id = ?`)
      .get(id);

    const refund = db.prepare(`SELECT * FROM refunds WHERE case_id = ?`).get(id);

    // The ledger must reflect ALL payments actually tied to this order, not
    // just the (possibly narrower) set of payment_ids this particular case
    // happened to flag as duplicates. Computing "collected" from the case's
    // own payment_ids was the bug: it's fragile to exactly which payments a
    // given detection run linked, and drifts from true DB state. This is
    // computed fresh, server-side, every time the case is loaded — never
    // cached, never client-derived.
    let ledger: { expected: number; collected: number; reconciled: boolean } | null = null;
    if (order) {
      const orderPayments = db
        .prepare(`SELECT current_status, amount FROM payments WHERE order_id = ?`)
        .all(order.order_id) as { current_status: string; amount: number }[];
      const collected = orderPayments
        .filter((p) => p.current_status === "SUCCESS")
        .reduce((sum, p) => sum + p.amount, 0);
      ledger = { expected: order.amount, collected, reconciled: collected === order.amount };
    }

    return NextResponse.json({
      case: c,
      payments,
      customer,
      order,
      audit,
      investigation: investigation ?? null,
      refund: refund ?? null,
      ledger,
    });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "Failed to load case" }, { status: 500 });
  }
}