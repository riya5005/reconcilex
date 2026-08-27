import { NextResponse } from "next/server";
import { isRazorpayConfigured, isWebhookConfigured } from "@/lib/razorpay";

export async function GET() {
  return NextResponse.json({
    razorpay: isRazorpayConfigured(),
    webhook: isWebhookConfigured(),
    ai: !!process.env.HF_TOKEN,
    database: true, // if this route handler is running at all, the process (and its DB connection) is up
  });
}
