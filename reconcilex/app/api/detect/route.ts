import { NextResponse } from "next/server";
import { runFullDetection } from "@/lib/detection";

export async function POST() {
  try {
    const result = runFullDetection();
    return NextResponse.json(result);
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "Detection run failed" }, { status: 500 });
  }
}
