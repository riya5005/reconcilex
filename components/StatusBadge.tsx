const STATUS_STYLES: Record<string, { bg: string; fg: string; label: string }> = {
  DETECTED: { bg: "#eef0ea", fg: "#5b6472", label: "Detected" },
  INVESTIGATING: { bg: "#eef0ea", fg: "#5b6472", label: "Investigating" },
  RECOMMENDATION_CREATED: { bg: "var(--seal-amber-soft)", fg: "var(--seal-amber)", label: "Recommendation ready" },
  AWAITING_APPROVAL: { bg: "var(--seal-amber-soft)", fg: "var(--seal-amber)", label: "Awaiting approval" },
  APPROVED: { bg: "var(--ledger-green-soft)", fg: "var(--ledger-green)", label: "Approved" },
  REFUND_INITIATED: { bg: "var(--ledger-green-soft)", fg: "var(--ledger-green)", label: "Refund initiated" },
  REFUND_COMPLETED: { bg: "var(--ledger-green-soft)", fg: "var(--ledger-green)", label: "Refund completed" },
  RESOLVED: { bg: "var(--ledger-green-soft)", fg: "var(--ledger-green)", label: "Resolved" },
  REJECTED: { bg: "var(--alert-red-soft)", fg: "var(--alert-red)", label: "Rejected" },
  MANUAL_REVIEW: { bg: "var(--seal-amber-soft)", fg: "var(--seal-amber)", label: "Manual review" },
};

export default function StatusBadge({ status }: { status: string }) {
  const s = STATUS_STYLES[status] ?? { bg: "#eef0ea", fg: "#5b6472", label: status };
  return (
    <span
      className="inline-flex items-center px-2.5 py-1 rounded-full text-[11px] font-mono uppercase tracking-wide"
      style={{ background: s.bg, color: s.fg }}
    >
      {s.label}
    </span>
  );
}

export function ConfidenceBadge({ band }: { band: "HIGH" | "MEDIUM" | "LOW" }) {
  const map = {
    HIGH: { bg: "var(--alert-red-soft)", fg: "var(--alert-red)", label: "High confidence" },
    MEDIUM: { bg: "var(--seal-amber-soft)", fg: "var(--seal-amber)", label: "Medium confidence" },
    LOW: { bg: "#eef0ea", fg: "#5b6472", label: "Low confidence" },
  } as const;
  const s = map[band];
  return (
    <span
      className="inline-flex items-center px-2.5 py-1 rounded-full text-[11px] font-mono uppercase tracking-wide"
      style={{ background: s.bg, color: s.fg }}
    >
      {s.label}
    </span>
  );
}
