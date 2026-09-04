import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";

export async function GET() {
  try {
    const db = getDb();
    const payments = db
      .prepare(
        `SELECT p.*, o.service as order_service
         FROM payments p
         LEFT JOIN orders o ON o.order_id = p.order_id
         ORDER BY p.created_at DESC`
      )
      .all();
    return NextResponse.json({ payments });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "Failed to load payments" }, { status: 500 });
  }
}
