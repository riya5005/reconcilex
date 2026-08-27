import { NextResponse } from "next/server";
import { seedAndDetect } from "@/lib/seed";

export async function POST() {
  if (process.env.NODE_ENV === "production" && process.env.ALLOW_DEMO_RESET !== "true") {
    return NextResponse.json(
      { error: "Demo reset is disabled in production." },
      { status: 403 }
    );
  }
  try {
    const result = seedAndDetect();
    return NextResponse.json({ message: "Demo data reset.", ...result });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "Reset failed" }, { status: 500 });
  }
}
