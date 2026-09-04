export default function RiskBadge({ risk }: { risk: "LOW" | "MEDIUM" | "HIGH" }) {
  const map = {
    LOW: { bg: "var(--ledger-green-soft)", fg: "var(--ledger-green)" },
    MEDIUM: { bg: "var(--seal-amber-soft)", fg: "var(--seal-amber)" },
    HIGH: { bg: "var(--alert-red-soft)", fg: "var(--alert-red)" },
  } as const;
  const s = map[risk];
  return (
    <span
      className="inline-flex items-center px-2.5 py-1 rounded-full text-[11px] font-mono uppercase tracking-wide"
      style={{ background: s.bg, color: s.fg }}
    >
      {risk} risk
    </span>
  );
}
