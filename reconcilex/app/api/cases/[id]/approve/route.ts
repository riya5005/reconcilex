import { NextResponse } from "next/server";
import { approveCase, CaseActionError } from "@/lib/caseActions";

export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    const result = await approveCase(id);
    return NextResponse.json(result);
  } catch (err) {
    if (err instanceof CaseActionError) {
      return NextResponse.json({ error: err.message, code: err.code }, { status: 400 });
    }
    console.error(err);
    return NextResponse.json({ error: "Failed to approve case" }, { status: 500 });
  }
}
