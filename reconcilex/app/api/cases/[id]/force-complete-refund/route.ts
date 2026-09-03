import { NextResponse } from "next/server";
import { forceCompleteRazorpayRefund, CaseActionError } from "@/lib/caseActions";

/**
 * POST /api/cases/:id/force-complete-refund
 *
 * Manual override for a known Razorpay Test Mode limitation: Instant
 * Refunds fall back to normal-speed refunds when there's no real bank rail
 * to route through (effectively always, in a sandbox), and a normal-speed
 * refund then has nothing left to report — it can sit in PROCESSING
 * forever, with no webhook or poll ever seeing it complete. See
 * lib/caseActions.ts's forceCompleteRazorpayRefund for the full explanation
 * and exactly what gets written to the audit trail (never a claim that
 * Razorpay itself confirmed anything).
 */
export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    const result = forceCompleteRazorpayRefund(id);
    return NextResponse.json(result);
  } catch (err) {
    if (err instanceof CaseActionError) {
      return NextResponse.json({ error: err.message, code: err.code }, { status: 400 });
    }
    console.error(err);
    return NextResponse.json({ error: "Failed to manually complete refund" }, { status: 500 });
  }
}