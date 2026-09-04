"use client";

import { useEffect, useState } from "react";
import { formatINR, formatDateTime } from "@/lib/format";

interface PaymentRow {
  payment_id: string;
  customer_id: string;
  order_id: string | null;
  order_service: string | null;
  amount: number;
  method: string;
  initial_status: string;
  current_status: string;
  created_at: string;
}

function statusColor(status: string) {
  if (status === "SUCCESS") return "var(--ledger-green)";
  if (status === "PENDING") return "var(--seal-amber)";
  if (status === "FAILED") return "var(--alert-red)";
  if (status === "REFUNDED") return "var(--text-faint)";
  return "var(--text-soft)";
}

export default function PaymentsPage() {
  const [payments, setPayments] = useState<PaymentRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState("");

  useEffect(() => {
    fetch("/api/payments")
      .then((r) => r.json())
      .then((json) => {
        setPayments(json.payments ?? []);
        setLoading(false);
      });
  }, []);

  const filtered = payments.filter((p) => {
    if (!query) return true;
    const q = query.toLowerCase();
    return (
      p.payment_id.toLowerCase().includes(q) ||
      p.customer_id.toLowerCase().includes(q) ||
      (p.order_id ?? "").toLowerCase().includes(q) ||
      (p.order_service ?? "").toLowerCase().includes(q)
    );
  });

  return (
    <main className="p-8 max-w-6xl">
      <header className="mb-6">
        <p className="text-[11px] font-mono uppercase tracking-wide mb-1" style={{ color: "var(--text-faint)" }}>
          Payment Records
        </p>
        <h1 className="font-display text-3xl font-semibold">Payment Ledger</h1>
        <p className="text-sm mt-1" style={{ color: "var(--text-soft)" }}>
          The raw source of truth ReconcileX reads from — every payment event, unmodified.
        </p>
      </header>

      <input
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Search by payment ID, customer, order, or service…"
        className="w-full max-w-md text-sm px-3 py-2 rounded-md mb-4"
        style={{ border: "1px solid var(--line)", background: "var(--surface)" }}
      />

      <div className="rounded-lg overflow-hidden" style={{ border: "1px solid var(--line)" }}>
        <table className="w-full text-sm">
          <thead>
            <tr style={{ background: "var(--surface)" }}>
              {["Payment", "Customer", "Order / Service", "Amount", "Method", "Status", "Time"].map((h) => (
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
              filtered.slice(0, 200).map((p) => (
                <tr key={p.payment_id} className="rule-soft hover:bg-black/[0.02]">
                  <td className="px-4 py-2.5 font-mono text-xs">{p.payment_id}</td>
                  <td className="px-4 py-2.5 font-mono text-xs">{p.customer_id}</td>
                  <td className="px-4 py-2.5 text-xs">
                    {p.order_service ?? "—"}
                    {p.order_id ? <span style={{ color: "var(--text-faint)" }}> ({p.order_id})</span> : ""}
                  </td>
                  <td className="px-4 py-2.5 text-xs">{formatINR(p.amount)}</td>
                  <td className="px-4 py-2.5 text-xs">{p.method}</td>
                  <td className="px-4 py-2.5 text-xs">
                    <span className="font-mono" style={{ color: statusColor(p.current_status) }}>
                      {p.initial_status !== p.current_status
                        ? `${p.initial_status} → ${p.current_status}`
                        : p.current_status}
                    </span>
                  </td>
                  <td className="px-4 py-2.5 text-xs" style={{ color: "var(--text-faint)" }}>
                    {formatDateTime(p.created_at)}
                  </td>
                </tr>
              ))}
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
      {!loading && filtered.length > 200 && (
        <p className="text-xs mt-2" style={{ color: "var(--text-faint)" }}>
          Showing first 200 of {filtered.length} results. Refine your search to narrow this down.
        </p>
      )}
    </main>
  );
}
