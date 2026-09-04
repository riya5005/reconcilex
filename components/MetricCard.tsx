export default function MetricCard({
  label,
  value,
  sublabel,
  accent,
}: {
  label: string;
  value: string;
  sublabel?: string;
  accent?: "green" | "amber" | "red" | "neutral";
}) {
  const accentColor =
    accent === "green"
      ? "var(--ledger-green)"
      : accent === "amber"
      ? "var(--seal-amber)"
      : accent === "red"
      ? "var(--alert-red)"
      : "var(--text)";

  return (
    <div
      className="rounded-lg p-5 flex flex-col gap-1"
      style={{ background: "var(--surface)", border: "1px solid var(--line)" }}
    >
      <span className="text-[11px] font-mono uppercase tracking-wide" style={{ color: "var(--text-faint)" }}>
        {label}
      </span>
      <span className="font-display text-3xl font-semibold" style={{ color: accentColor }}>
        {value}
      </span>
      {sublabel && (
        <span className="text-xs" style={{ color: "var(--text-soft)" }}>
          {sublabel}
        </span>
      )}
    </div>
  );
}
