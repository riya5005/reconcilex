import { NextResponse } from "next/server";
import { getAuditForCase } from "@/lib/audit";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    const audit = getAuditForCase(id);
    return NextResponse.json({ audit });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "Failed to load audit trail" }, { status: 500 });
  }
}
