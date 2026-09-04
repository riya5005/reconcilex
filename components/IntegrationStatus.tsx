"use client";

import { useEffect, useState } from "react";

interface Status {
  razorpay: boolean;
  webhook: boolean;
  ai: boolean;
  database: boolean;
}

function Row({ label, ok }: { label: string; ok: boolean }) {
  return (
    <div className="flex items-center justify-between py-1.5">
      <span className="text-sm" style={{ color: "var(--text-soft)" }}>
        {label}
      </span>
      <span
        className="inline-flex items-center gap-1.5 text-xs font-mono"
        style={{ color: ok ? "var(--ledger-green)" : "var(--text-faint)" }}
      >
        <span
          className="w-1.5 h-1.5 rounded-full"
          style={{ background: ok ? "var(--ledger-green)" : "var(--text-faint)" }}
        />
        {ok ? "Connected" : "Not configured"}
      </span>
    </div>
  );
}

export default function IntegrationStatus() {
  const [status, setStatus] = useState<Status | null>(null);

  useEffect(() => {
    fetch("/api/integrations/status")
      .then((r) => r.json())
      .then(setStatus)
      .catch(() => setStatus(null));
  }, []);

  if (!status) return null;

  return (
    <div className="rounded-lg p-5" style={{ background: "var(--surface)", border: "1px solid var(--line)" }}>
      <p className="text-xs font-mono uppercase tracking-wide mb-3" style={{ color: "var(--text-faint)" }}>
        Integrations
      </p>
      <Row label="Razorpay Test Mode" ok={status.razorpay} />
      <Row label="Webhook" ok={status.webhook} />
      <Row label="AI Provider (Hugging Face)" ok={status.ai} />
      <Row label="Database" ok={status.database} />
    </div>
  );
}
