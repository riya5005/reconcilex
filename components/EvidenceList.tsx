interface EvidenceItem {
  label: string;
  detail: string;
  points: number;
  matched: boolean;
}

export default function EvidenceList({ evidence }: { evidence: EvidenceItem[] }) {
  return (
    <ul className="flex flex-col gap-3">
      {evidence.map((e, i) => (
        <li key={i} className="flex items-start gap-3">
          <span
            className="evidence-check mt-0.5"
            style={
              !e.matched
                ? { background: "var(--line-soft)", color: "var(--text-faint)" }
                : undefined
            }
          >
            {e.matched ? "✓" : "–"}
          </span>
          <div className="flex-1 min-w-0">
            <div className="flex items-center justify-between gap-2">
              <span className="text-sm font-medium">{e.label}</span>
              <span
                className="font-mono text-xs shrink-0"
                style={{ color: e.matched ? "var(--ledger-green)" : "var(--text-faint)" }}
              >
                {e.matched ? `+${e.points}` : "+0"}
              </span>
            </div>
            <p className="text-xs mt-0.5" style={{ color: "var(--text-soft)" }}>
              {e.detail}
            </p>
          </div>
        </li>
      ))}
    </ul>
  );
}
