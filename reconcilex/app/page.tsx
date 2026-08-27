"use client";

import { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import MetricCard from "@/components/MetricCard";
import StatusBadge, { ConfidenceBadge } from "@/components/StatusBadge";
import IntegrationStatus from "@/components/IntegrationStatus";
import { formatINR, caseTypeLabel } from "@/lib/format";

interface DashboardData {
  totalTransactions: number;
  duplicateCases: number;
  potentialDuplicateAmount: number;
  openCases: number;
  awaitingApproval: number;
  refundsInitiated: number;
  moneyRecovered: number;
  casesResolved: number;
  manualReviewCases: number;
  stuckRefunds: number;
  mismatchCases: number;
  recentCases: Array<{
    case_id: string;
    case_type: string;
    customer_id: string;
    confidence: number;
    confidence_band: "HIGH" | "MEDIUM" | "LOW";
    status: string;
    created_at: string;
    recommended_amount: number | null;
  }>;
}

export default function DashboardPage() {
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState(false);
  const [resetting, setResetting] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const load = useCallback(async () => {
    const res = await fetch("/api/dashboard");
    const json = await res.json();
    setData(json);
    setLoading(false);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function runDetection() {
    setRunning(true);
    setMessage(null);
    const res = await fetch("/api/detect", { method: "POST" });
    const json = await res.json();
    const created = (json.casesCreated?.length ?? 0) + (json.mismatchCasesCreated?.length ?? 0);
    setMessage(
      created > 0
        ? `Reconciliation run complete — ${created} new case${created === 1 ? "" : "s"} created.`
        : "Reconciliation run complete — no new anomalies found."
    );
    await load();
    setRunning(false);
  }

  async function resetDemo() {
    setResetting(true);
    setMessage(null);
    await fetch("/api/reset", { method: "POST" });
    await load();
    setMessage("Demo data reset to the seeded scenario.");
    setResetting(false);
  }

  return (
    <main className="p-8 max-w-6xl">
      <header className="flex items-start justify-between mb-8">
        <div>
          <p className="text-[11px] font-mono uppercase tracking-wide mb-1" style={{ color: "var(--text-faint)" }}>
            Operations Overview
          </p>
          <h1 className="font-display text-3xl font-semibold">Reconciliation Dashboard</h1>
          <p className="text-sm mt-1 max-w-xl" style={{ color: "var(--text-soft)" }}>
            ReconcileX is an AI decision and resolution layer that investigates payment
            anomalies, explains the evidence, and routes them through controlled, auditable
            approval before any money moves.
          </p>
        </div>
        <div className="flex flex-col items-end gap-2 shrink-0">
          <div className="flex gap-2">
            <button
              onClick={runDetection}
              disabled={running}
              className="px-4 py-2 rounded-md text-sm font-medium text-white transition-opacity disabled:opacity-60"
              style={{ background: "var(--ledger-green)" }}
            >
              {running ? "Running reconciliation…" : "Run Reconciliation"}
            </button>
            <button
              onClick={resetDemo}
              disabled={resetting}
              className="px-4 py-2 rounded-md text-sm font-medium disabled:opacity-60"
              style={{ border: "1px solid var(--line)", color: "var(--text-soft)" }}
            >
              {resetting ? "Resetting…" : "Reset Demo Data"}
            </button>
          </div>
          {message && (
            <p className="text-xs" style={{ color: "var(--ledger-green)" }}>
              {message}
            </p>
          )}
        </div>
      </header>

      {loading || !data ? (
        <p className="text-sm" style={{ color: "var(--text-soft)" }}>
          Loading dashboard…
        </p>
      ) : (
        <>
          <div className="grid grid-cols-4 gap-4 mb-4">
            <MetricCard label="Total Transactions" value={data.totalTransactions.toLocaleString("en-IN")} />
            <MetricCard
              label="Potential Duplicate Payments"
              value={data.duplicateCases.toLocaleString("en-IN")}
              accent="amber"
            />
            <MetricCard
              label="Potential Duplicate Amount"
              value={formatINR(data.potentialDuplicateAmount)}
              accent="amber"
            />
            <MetricCard label="Open Resolution Cases" value={data.openCases.toLocaleString("en-IN")} />
          </div>
          <div className="grid grid-cols-4 gap-4 mb-8">
            <MetricCard
              label="Awaiting Approval"
              value={data.awaitingApproval.toLocaleString("en-IN")}
              accent="amber"
            />
            <MetricCard label="Refunds Initiated" value={data.refundsInitiated.toLocaleString("en-IN")} />
            <MetricCard
              label="Money Recovered"
              value={formatINR(data.moneyRecovered)}
              accent="green"
            />
            <MetricCard
              label="Cases Resolved"
              value={data.casesResolved.toLocaleString("en-IN")}
              accent="green"
            />
          </div>

          <div className="grid grid-cols-3 gap-4 mb-8">
            <MetricCard
              label="Manual Review Cases"
              value={data.manualReviewCases.toLocaleString("en-IN")}
              sublabel="Medium confidence — needs a human look"
            />
            <MetricCard
              label="Stuck Refunds"
              value={data.stuckRefunds.toLocaleString("en-IN")}
              sublabel="Initiated but not yet completed"
              accent={data.stuckRefunds > 0 ? "red" : "neutral"}
            />
            <MetricCard
              label="Order/Payment Mismatches"
              value={data.mismatchCases.toLocaleString("en-IN")}
              sublabel="Order status inconsistent with payments"
            />
          </div>

          <div className="grid grid-cols-3 gap-8">
            <section className="col-span-2">
              <div className="flex items-center justify-between mb-3">
                <h2 className="font-display text-lg font-semibold">Recent Cases</h2>
                <Link href="/cases" className="text-sm" style={{ color: "var(--ledger-green)" }}>
                  View all cases →
                </Link>
              </div>
              <div className="rounded-lg overflow-hidden" style={{ border: "1px solid var(--line)" }}>
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left" style={{ background: "var(--surface)" }}>
                      <th className="rule-soft px-4 py-2.5 font-mono text-[11px] uppercase tracking-wide" style={{ color: "var(--text-faint)" }}>Case</th>
                      <th className="rule-soft px-4 py-2.5 font-mono text-[11px] uppercase tracking-wide" style={{ color: "var(--text-faint)" }}>Type</th>
                      <th className="rule-soft px-4 py-2.5 font-mono text-[11px] uppercase tracking-wide" style={{ color: "var(--text-faint)" }}>Customer</th>
                      <th className="rule-soft px-4 py-2.5 font-mono text-[11px] uppercase tracking-wide" style={{ color: "var(--text-faint)" }}>Confidence</th>
                      <th className="rule-soft px-4 py-2.5 font-mono text-[11px] uppercase tracking-wide" style={{ color: "var(--text-faint)" }}>Amount</th>
                      <th className="rule-soft px-4 py-2.5 font-mono text-[11px] uppercase tracking-wide" style={{ color: "var(--text-faint)" }}>Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.recentCases.map((c) => (
                      <tr key={c.case_id} className="rule-soft hover:bg-black/[0.02] cursor-pointer">
                        <td className="px-4 py-3">
                          <Link href={`/cases/${c.case_id}`} className="font-mono text-sm" style={{ color: "var(--text)" }}>
                            {c.case_id}
                          </Link>
                        </td>
                        <td className="px-4 py-3 text-sm">{caseTypeLabel(c.case_type)}</td>
                        <td className="px-4 py-3 font-mono text-sm">{c.customer_id}</td>
                        <td className="px-4 py-3">
                          <ConfidenceBadge band={c.confidence_band} /> <span className="text-xs ml-1" style={{ color: "var(--text-faint)" }}>{c.confidence}%</span>
                        </td>
                        <td className="px-4 py-3 text-sm">{c.recommended_amount ? formatINR(c.recommended_amount) : "—"}</td>
                        <td className="px-4 py-3">
                          <StatusBadge status={c.status} />
                        </td>
                      </tr>
                    ))}
                    {data.recentCases.length === 0 && (
                      <tr>
                        <td colSpan={6} className="px-4 py-8 text-center text-sm" style={{ color: "var(--text-faint)" }}>
                          No cases yet. Click &ldquo;Run Reconciliation&rdquo; to scan payments for anomalies.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </section>
            <section>
              <h2 className="font-display text-lg font-semibold mb-3">System Status</h2>
              <IntegrationStatus />
              <p className="text-xs mt-3" style={{ color: "var(--text-faint)" }}>
                Try a real Razorpay Test Mode payment on the{" "}
                <Link href="/razorpay-demo" style={{ color: "var(--ledger-green)" }}>
                  Razorpay Test Demo
                </Link>{" "}
                page.
              </p>
            </section>
          </div>
        </>
      )}
    </main>
  );
}
