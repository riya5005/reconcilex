interface ActivityStep {
  label: string;
  detail: string;
}

export default function AgentActivityPanel({ steps }: { steps: ActivityStep[] }) {
  if (!steps.length) return null;
  return (
    <ul className="flex flex-col gap-2.5">
      {steps.map((s, i) => (
        <li key={i} className="flex items-start gap-3">
          <span
            className="mt-0.5 shrink-0 inline-flex items-center justify-center w-4 h-4 rounded-full text-[10px]"
            style={{ background: "var(--ledger-green-soft)", color: "var(--ledger-green)" }}
          >
            ✓
          </span>
          <div className="min-w-0">
            <p className="text-sm font-medium">{s.label}</p>
            <p className="text-xs mt-0.5 break-words" style={{ color: "var(--text-soft)" }}>
              {s.detail}
            </p>
          </div>
        </li>
      ))}
    </ul>
  );
}
