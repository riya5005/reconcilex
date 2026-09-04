import { NextResponse } from "next/server";
import { sendToManualReview, CaseActionError } from "@/lib/caseActions";

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    let reason: string | undefined;
    try {
      const body = await req.json();
      reason = body?.reason;
    } catch {
      /* no body provided */
    }
    const result = sendToManualReview(id, "Merchant Ops", reason);
    return NextResponse.json(result);
  } catch (err) {
    if (err instanceof CaseActionError) {
      return NextResponse.json({ error: err.message, code: err.code }, { status: 400 });
    }
    console.error(err);
    return NextResponse.json({ error: "Failed to send case to manual review" }, { status: 500 });
  }
}
