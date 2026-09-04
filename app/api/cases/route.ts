import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const status = searchParams.get("status");
    const type = searchParams.get("type");

    const db = getDb();
    let query = `SELECT * FROM resolution_cases`;
    const clauses: string[] = [];
    const params: string[] = [];
    if (status) {
      clauses.push(`status = ?`);
      params.push(status);
    }
    if (type) {
      clauses.push(`case_type = ?`);
      params.push(type);
    }
    if (clauses.length) query += ` WHERE ` + clauses.join(" AND ");
    query += ` ORDER BY created_at DESC`;

    const cases = db.prepare(query).all(...params);
    return NextResponse.json({ cases });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "Failed to load cases" }, { status: 500 });
  }
}
