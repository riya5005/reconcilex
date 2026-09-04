import { formatINR } from "@/lib/format";

export default function LedgerSummary({
  expected,
  collected,
}: {
  expected: number;
  collected: number;
}) {
  const difference = collected - expected;
  const reconciled = difference === 0;

  return (
    <div className="grid grid-cols-4 gap-4 items-end">
      <div>
        <p className="text-[11px] font-mono uppercase tracking-wide mb-1" style={{ color: "var(--text-faint)" }}>
          Expected
        </p>
        <p className="font-display text-xl font-semibold">{formatINR(expected)}</p>
      </div>
      <div>
        <p className="text-[11px] font-mono uppercase tracking-wide mb-1" style={{ color: "var(--text-faint)" }}>
          Collected
        </p>
        <p className="font-display text-xl font-semibold">{formatINR(collected)}</p>
      </div>
      <div>
        <p className="text-[11px] font-mono uppercase tracking-wide mb-1" style={{ color: "var(--text-faint)" }}>
          Difference
        </p>
        <p
          className="font-display text-xl font-semibold"
          style={{ color: difference === 0 ? "var(--text)" : difference > 0 ? "var(--alert-red)" : "var(--seal-amber)" }}
        >
          {difference > 0 ? "+" : ""}
          {formatINR(difference)}
        </p>
        {difference > 0 && (
          <p className="text-[10px] mt-0.5" style={{ color: "var(--text-faint)" }}>
            Potential overcollection
          </p>
        )}
      </div>
      <div>
        <span
          className="inline-flex items-center px-2.5 py-1 rounded-full text-[11px] font-mono uppercase tracking-wide"
          style={{
            background: reconciled ? "var(--ledger-green-soft)" : "var(--alert-red-soft)",
            color: reconciled ? "var(--ledger-green)" : "var(--alert-red)",
          }}
        >
          {reconciled ? "Reconciled" : "Unreconciled"}
        </span>
      </div>
    </div>
  );
}