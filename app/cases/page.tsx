"use client";

import { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import StatusBadge, { ConfidenceBadge } from "@/components/StatusBadge";
import { formatDateTime, formatINR, caseTypeLabel } from "@/lib/format";

interface CaseRow {
  case_id: string;
  case_type: string;
  customer_id: string;
  confidence: number;
  confidence_band: "HIGH" | "MEDIUM" | "LOW";
  status: string;
  recommended_amount: number | null;
  created_at: string;
}

const STATUS_FILTERS = [
  { value: "", label: "All statuses" },
  { value: "AWAITING_APPROVAL", label: "Awaiting approval" },
  { value: "MANUAL_REVIEW", label: "Manual review" },
  { value: "REFUND_INITIATED", label: "Refund initiated" },
  { value: "RESOLVED", label: "Resolved" },
  { value: "REJECTED", label: "Rejected" },
];

const TYPE_FILTERS = [
  { value: "", label: "All types" },
  { value: "DUPLICATE_PAYMENT", label: "Duplicate payment" },
  { value: "ORDER_PAYMENT_MISMATCH", label: "Order/payment mismatch" },
  { value: "STUCK_REFUND", label: "Stuck refund" },
];

export default function CasesPage() {
  const [cases, setCases] = useState<CaseRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [status, setStatus] = useState("");
  const [type, setType] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    const params = new URLSearchParams();
    if (status) params.set("status", status);
    if (type) params.set("type", type);
    const res = await fetch(`/api/cases?${params.toString()}`);
    const json = await res.json();
    setCases(json.cases ?? []);
    setLoading(false);
  }, [status, type]);

      useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
  }, [load]);

  return (
    <main className="p-8 max-w-6xl">
      <header className="mb-6">
        <p className="text-[11px] font-mono uppercase tracking-wide mb-1" style={{ color: "var(--text-faint)" }}>
          Case Management
        </p>
        <h1 className="font-display text-3xl font-semibold">Resolution Cases</h1>
        <p className="text-sm mt-1" style={{ color: "var(--text-soft)" }}>
          Every anomaly ReconcileX has investigated, with its confidence, recommendation, and
          current stage in the approval workflow.
        </p>
      </header>

      <div className="flex gap-3 mb-4">
        <select
          value={status}
          onChange={(e) => setStatus(e.target.value)}
          className="text-sm px-3 py-2 rounded-md"
          style={{ border: "1px solid var(--line)", background: "var(--surface)" }}
        >
          {STATUS_FILTERS.map((f) => (
            <option key={f.value} value={f.value}>
              {f.label}
            </option>
          ))}
        </select>
        <select
          value={type}
          onChange={(e) => setType(e.target.value)}
          className="text-sm px-3 py-2 rounded-md"
          style={{ border: "1px solid var(--line)", background: "var(--surface)" }}
        >
          {TYPE_FILTERS.map((f) => (
            <option key={f.value} value={f.value}>
              {f.label}
            </option>
          ))}
        </select>
      </div>

      <div className="rounded-lg overflow-hidden" style={{ border: "1px solid var(--line)" }}>
        <table className="w-full text-sm">
          <thead>
            <tr style={{ background: "var(--surface)" }}>
              {["Case", "Type", "Customer", "Confidence", "Amount", "Status", "Created"].map((h) => (
                <th
                  key={h}
                  className="rule-soft text-left px-4 py-2.5 font-mono text-[11px] uppercase tracking-wide"
                  style={{ color: "var(--text-faint)" }}
                >
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {!loading &&
              cases.map((c) => (
                <tr key={c.case_id} className="rule-soft hover:bg-black/[0.02]">
                  <td className="px-4 py-3">
                    <Link href={`/cases/${c.case_id}`} className="font-mono" style={{ color: "var(--text)" }}>
                      {c.case_id}
                    </Link>
                  </td>
                  <td className="px-4 py-3">{caseTypeLabel(c.case_type)}</td>
                  <td className="px-4 py-3 font-mono">{c.customer_id}</td>
                  <td className="px-4 py-3">
                    <ConfidenceBadge band={c.confidence_band} />{" "}
                    <span className="text-xs ml-1" style={{ color: "var(--text-faint)" }}>
                      {c.confidence}%
                    </span>
                  </td>
                  <td className="px-4 py-3">{c.recommended_amount ? formatINR(c.recommended_amount) : "—"}</td>
                  <td className="px-4 py-3">
                    <StatusBadge status={c.status} />
                  </td>
                  <td className="px-4 py-3 text-xs" style={{ color: "var(--text-faint)" }}>
                    {formatDateTime(c.created_at)}
                  </td>
                </tr>
              ))}
            {!loading && cases.length === 0 && (
              <tr>
                <td colSpan={7} className="px-4 py-10 text-center text-sm" style={{ color: "var(--text-faint)" }}>
                  No cases match these filters.
                </td>
              </tr>
            )}
            {loading && (
              <tr>
                <td colSpan={7} className="px-4 py-10 text-center text-sm" style={{ color: "var(--text-faint)" }}>
                  Loading…
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </main>
  );
}
