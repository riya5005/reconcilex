import { formatINR, paymentLifecycleLabel } from "@/lib/format";

interface Payment {
  payment_id: string;
  amount: number;
  method: string;
  initial_status: string;
  current_status: string;
  created_at: string;
  source?: string;
}

/**
 * Only renders when the data actually shows the retry pattern: exactly two
 * payments, the earlier one started PENDING or FAILED, and both are now
 * SUCCESS. This mirrors the exact condition the deterministic engine already
 * scores under "First payment was initially pending or failed" and "Both
 * payments ultimately settled" (lib/detection.ts) — this card narrates the
 * same facts already established there, it does not compute anything new.
 */
export default function WhyRetriedCard({ payments }: { payments: Payment[] }) {
  if (payments.length !== 2) return null;
  const [first, second] = [...payments].sort(
    (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
  );

  const retryPattern =
    (first.initial_status === "PENDING" || first.initial_status === "FAILED") &&
    first.current_status === "SUCCESS" &&
    second.current_status === "SUCCESS";

  if (!retryPattern) return null;

  const firstStateWord = first.initial_status === "PENDING" ? "pending" : "unsuccessful";

  return (
    <div className="mb-8 rounded-lg p-5" style={{ background: "var(--surface)", border: "1px solid var(--line)" }}>
      <p className="text-xs font-mono uppercase tracking-wide mb-2" style={{ color: "var(--text-faint)" }}>
        Why did the customer pay again?
      </p>
      <p className="text-sm mb-4" style={{ color: "var(--text-soft)" }}>
        The first payment showed as <strong>{firstStateWord}</strong> from the customer&apos;s
        side, so they retried with a different method. The original payment then went on to{" "}
        {first.current_status === "SUCCESS" ? "succeed anyway" : "settle"}, leaving two{" "}
        {second.current_status === "SUCCESS" ? "successful" : "settled"} payments against one
        order.
      </p>
      <div className="flex gap-3">
        <div className="flex-1 rounded-md p-3" style={{ background: "var(--paper)" }}>
          <p className="text-[10px] font-mono uppercase tracking-wide mb-1" style={{ color: "var(--text-faint)" }}>
            First payment
          </p>
          <p className="text-sm font-medium">
            {formatINR(first.amount)} · {first.method}
          </p>
          <p className="text-xs mt-0.5" style={{ color: "var(--text-faint)" }}>
            {paymentLifecycleLabel(first.initial_status, first.source)} {"\u2192"}{" "}
            {paymentLifecycleLabel(first.current_status, first.source)}
          </p>
        </div>
        <div className="flex-1 rounded-md p-3" style={{ background: "var(--paper)" }}>
          <p className="text-[10px] font-mono uppercase tracking-wide mb-1" style={{ color: "var(--text-faint)" }}>
            Second payment
          </p>
          <p className="text-sm font-medium">
            {formatINR(second.amount)} · {second.method}
          </p>
          <p className="text-xs mt-0.5" style={{ color: "var(--text-faint)" }}>
            {paymentLifecycleLabel(second.current_status, second.source)}
          </p>
        </div>
      </div>
    </div>
  );
}