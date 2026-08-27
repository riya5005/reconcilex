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
      ? db.prepare(`SELECT * FROM orders WHERE order_id = ?`).get(c.order_id as string)
      : null;

    const audit = db
      .prepare(`SELECT * FROM audit_events WHERE case_id = ? ORDER BY timestamp ASC`)
      .all(id);

    const investigation = db
      .prepare(`SELECT * FROM ai_investigations WHERE case_id = ?`)
      .get(id);

    const refund = db.prepare(`SELECT * FROM refunds WHERE case_id = ?`).get(id);

    return NextResponse.json({
      case: c,
      payments,
      customer,
      order,
      audit,
      investigation: investigation ?? null,
      refund: refund ?? null,
    });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "Failed to load case" }, { status: 500 });
  }
}
