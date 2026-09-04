export function formatINR(amount: number) {
  return `\u20b9${amount.toLocaleString("en-IN")}`;
}

export function formatDateTime(iso: string) {
  const d = new Date(iso);
  return d.toLocaleString("en-IN", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function formatTime(iso: string) {
  const d = new Date(iso);
  return d.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" });
}

export function caseTypeLabel(type: string) {
  const map: Record<string, string> = {
    DUPLICATE_PAYMENT: "Duplicate Payment",
    ORDER_PAYMENT_MISMATCH: "Order/Payment Mismatch",
    STUCK_REFUND: "Stuck Refund",
  };
  return map[type] ?? type;
}

export function eventTypeLabel(type: string) {
  return type
    .split("_")
    .map((w) => w[0] + w.slice(1).toLowerCase())
    .join(" ");
}

/**
 * Honest, source-aware label for a payment's lifecycle status. We never say
 * "Razorpay reported pending" unless the status actually came from Razorpay's
 * API/webhook — for RAZORPAY_TEST-sourced payments, `status` is only ever
 * PENDING here if Razorpay's own payment object reported something other
 * than captured/failed (see app/api/razorpay/payments/confirm/route.ts),
 * so the label below still describes ReconcileX's own business state, not a
 * fabricated gateway claim.
 */
export function paymentLifecycleLabel(status: string, source?: string): string {
  if (status === "PENDING") {
    return source === "RAZORPAY_TEST" ? "Awaiting gateway confirmation" : "Confirmation pending";
  }
  const map: Record<string, string> = {
    SUCCESS: "Success",
    FAILED: "Failed",
    REFUNDED: "Refunded",
  };
  return map[status] ?? status;
}