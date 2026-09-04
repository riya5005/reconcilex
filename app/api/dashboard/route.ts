import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";

export async function GET() {
  try {
    const db = getDb();

    const totalTransactions = (
      db.prepare(`SELECT COUNT(*) as c FROM payments`).get() as { c: number }
    ).c;

    const duplicateCases = (
      db
        .prepare(`SELECT COUNT(*) as c FROM resolution_cases WHERE case_type = 'DUPLICATE_PAYMENT'`)
        .get() as { c: number }
    ).c;

    const potentialDuplicateAmount = (
      db
        .prepare(
          `SELECT COALESCE(SUM(recommended_amount),0) as s FROM resolution_cases
           WHERE case_type = 'DUPLICATE_PAYMENT' AND recommended_amount IS NOT NULL`
        )
        .get() as { s: number }
    ).s;

    const openCases = (
      db
        .prepare(
          `SELECT COUNT(*) as c FROM resolution_cases
           WHERE status NOT IN ('RESOLVED','REJECTED')`
        )
        .get() as { c: number }
    ).c;

    const awaitingApproval = (
      db
        .prepare(`SELECT COUNT(*) as c FROM resolution_cases WHERE status = 'AWAITING_APPROVAL'`)
        .get() as { c: number }
    ).c;

    const refundsInitiated = (
      db
        .prepare(
          `SELECT COUNT(*) as c FROM resolution_cases
           WHERE status IN ('REFUND_INITIATED','REFUND_COMPLETED','RESOLVED')`
        )
        .get() as { c: number }
    ).c;

    const moneyRecovered = (
      db
        .prepare(
          `SELECT COALESCE(SUM(recommended_amount),0) as s FROM resolution_cases
           WHERE status IN ('REFUND_COMPLETED','RESOLVED') AND recommended_amount IS NOT NULL`
        )
        .get() as { s: number }
    ).s;

    const casesResolved = (
      db.prepare(`SELECT COUNT(*) as c FROM resolution_cases WHERE status = 'RESOLVED'`).get() as {
        c: number;
      }
    ).c;

    const manualReviewCases = (
      db
        .prepare(`SELECT COUNT(*) as c FROM resolution_cases WHERE status = 'MANUAL_REVIEW'`)
        .get() as { c: number }
    ).c;

    const stuckRefunds = (
      db
        .prepare(
          `SELECT COUNT(*) as c FROM resolution_cases WHERE case_type = 'STUCK_REFUND' AND status NOT IN ('RESOLVED','REJECTED')`
        )
        .get() as { c: number }
    ).c;

    const mismatchCases = (
      db
        .prepare(`SELECT COUNT(*) as c FROM resolution_cases WHERE case_type = 'ORDER_PAYMENT_MISMATCH'`)
        .get() as { c: number }
    ).c;

    const recentCases = db
      .prepare(`SELECT * FROM resolution_cases ORDER BY created_at DESC LIMIT 8`)
      .all();

    return NextResponse.json({
      totalTransactions,
      duplicateCases,
      potentialDuplicateAmount,
      openCases,
      awaitingApproval,
      refundsInitiated,
      moneyRecovered,
      casesResolved,
      manualReviewCases,
      stuckRefunds,
      mismatchCases,
      recentCases,
    });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "Failed to load dashboard" }, { status: 500 });
  }
}
