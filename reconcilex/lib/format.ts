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
