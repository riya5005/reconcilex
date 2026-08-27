"use client";

import { useEffect, useState, useCallback, use } from "react";
import Link from "next/link";
import StatusBadge, { ConfidenceBadge } from "@/components/StatusBadge";
import ConfidenceStamp from "@/components/ConfidenceStamp";
import TransactionComparison from "@/components/TransactionComparison";
import EvidenceList from "@/components/EvidenceList";
import AuditTimeline from "@/components/AuditTimeline";
import AgentActivityPanel from "@/components/AgentActivityPanel";
import RiskBadge from "@/components/RiskBadge";
import LedgerSummary from "@/components/LedgerSummary";
import { formatINR, caseTypeLabel } from "@/lib/format";

interface CaseData {
  case_id: string;
  case_type: string;
  customer_id: string;
  order_id: string | null;
  confidence: number;
  confidence_band: "HIGH" | "MEDIUM" | "LOW";
  evidence: string;
  recommendation: string | null;
  recommended_amount: number | null;
  status: string;
}

interface Investigation {
  status: "COMPLETED" | "UNAVAILABLE";
  summary: string | null;
  root_cause: string | null;
  reasoning: string | null;
  recommended_action: string | null;
  payment_to_refund: string | null;
  risk_level: "LOW" | "MEDIUM" | "HIGH" | null;
  requires_human_approval: number | boolean | null;
  model: string | null;
  error: string | null;
}

interface RefundRecord {
  refund_id: string;
  case_id: string;
  payment_id: string;
  razorpay_refund_id: string | null;
  amount: number;
  source: string;
  status: "PROCESSING" | "COMPLETED" | "FAILED";
  error: string | null;
}

interface ActivityStep {
  label: string;
  detail: string;
}

export default function CaseDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const [data, setData] = useState<{
    case: CaseData;
    payments: Array<{
      payment_id: string;
      amount: number;
      method: string;
      initial_status: string;
      current_status: string;
      created_at: string;
      source?: string;
      razorpay_payment_id?: string | null;
    }>;
    customer: { customer_id: string; name: string } | null;
    order: { order_id: string; service: string; amount: number; status: string } | null;
    audit: Array<{
      event_id: string;
      event_type: string;
      actor: string;
      timestamp: string;
      reason: string | null;
      previous_state: string | null;
      new_state: string | null;
      action: string | null;
      outcome: string | null;
      payment_id: string | null;
    }>;
    investigation: Investigation | null;
    refund: RefundRecord | null;
  } | null>(null);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [investigating, setInvestigating] = useState(false);
  const [activity, setActivity] = useState<ActivityStep[]>([]);
  const [checkingRefund, setCheckingRefund] = useState(false);
  const [showEscalateReason, setShowEscalateReason] = useState(false);
  const [escalateReason, setEscalateReason] = useState("");

  const load = useCallback(async () => {
    const res = await fetch(`/api/cases/${id}`);
    if (res.status === 404) {
      setNotFound(true);
      setLoading(false);
      return;
    }
    const json = await res.json();
    setData(json);
    setLoading(false);
  }, [id]);

  useEffect(() => {
    load();
  }, [load]);

  async function doAction(action: "approve" | "reject" | "manual-review", reason?: string) {
    setActionLoading(action);
    setError(null);
    const res = await fetch(`/api/cases/${id}/${action}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: reason ? JSON.stringify({ reason }) : undefined,
    });
    const json = await res.json();
    if (!res.ok) {
      setError(json.error ?? "Action failed");
    } else if (action === "manual-review") {
      setShowEscalateReason(false);
      setEscalateReason("");
    }
    await load();
    setActionLoading(null);
  }

  async function checkRefundStatus() {
    if (!data?.refund) return;
    setCheckingRefund(true);
    setError(null);
    const res = await fetch(`/api/razorpay/refunds/${data.refund.refund_id}/status`, { method: "POST" });
    const json = await res.json();
    if (!res.ok) {
      setError(json.error ?? "Failed to check refund status");
    }
    await load();
    setCheckingRefund(false);
  }

  async function runInvestigation() {
    setInvestigating(true);
    setError(null);
    const res = await fetch(`/api/cases/${id}/investigate`, { method: "POST" });
    const json = await res.json();
    if (res.ok) {
      setActivity(json.activity ?? []);
    } else {
      setError(json.error ?? "Investigation failed");
    }
    await load();
    setInvestigating(false);
  }

  if (loading) {
    return (
      <main className="p-8 max-w-5xl">
        <p className="text-sm" style={{ color: "var(--text-soft)" }}>Loading case…</p>
      </main>
    );
  }

  if (notFound || !data) {
    return (
      <main className="p-8 max-w-5xl">
        <p className="text-sm" style={{ color: "var(--alert-red)" }}>
          Case {id} could not be found.
        </p>
        <Link href="/cases" className="text-sm mt-2 inline-block" style={{ color: "var(--ledger-green)" }}>
          ← Back to cases
        </Link>
      </main>
    );
  }

  const c = data.case;
  const evidence = JSON.parse(c.evidence);
  const canApprove = c.status === "AWAITING_APPROVAL";
  const canReject = !["REFUND_COMPLETED", "RESOLVED", "REJECTED"].includes(c.status);
  const canManualReview = !["REFUND_COMPLETED", "RESOLVED", "REJECTED", "MANUAL_REVIEW"].includes(c.status);
  const inv = data.investigation;

  const collected = data.payments
    .filter((p) => p.current_status === "SUCCESS")
    .reduce((sum, p) => sum + p.amount, 0);

  return (
    <main className="p-8 max-w-5xl">
      <Link href="/cases" className="text-xs" style={{ color: "var(--text-faint)" }}>
        ← All cases
      </Link>

      {/* Case Header */}
      <div className="flex items-start justify-between mt-3 mb-8">
        <div>
          <div className="flex items-center gap-3 mb-2">
            <h1 className="font-display text-2xl font-semibold">{c.case_id}</h1>
            <ConfidenceBadge band={c.confidence_band} />
            <StatusBadge status={c.status} />
          </div>
          <p className="text-sm" style={{ color: "var(--text-soft)" }}>
            {caseTypeLabel(c.case_type)} · Customer {c.customer_id}
            {data.customer ? ` (${data.customer.name})` : ""}
            {data.order ? ` · ${data.order.service}` : ""}
          </p>
          {c.recommended_amount != null && (
            <p className="font-display text-3xl font-semibold mt-3">{formatINR(c.recommended_amount)}</p>
          )}
        </div>
        <div className="flex flex-col items-end gap-2">
          <ConfidenceStamp score={c.confidence} band={c.confidence_band} />
          <button
            onClick={runInvestigation}
            disabled={investigating}
            className="px-4 py-2 rounded-md text-sm font-medium text-white transition-opacity disabled:opacity-60"
            style={{ background: "var(--ink)" }}
          >
            {investigating ? "Investigating…" : inv ? "Re-run Investigation" : "Investigate"}
          </button>
        </div>
      </div>

      {/* Transaction Comparison */}
      {data.payments.length >= 2 && (
        <section className="mb-8">
          <h2 className="font-display text-lg font-semibold mb-3">Transaction Comparison</h2>
          <TransactionComparison payments={data.payments} />
        </section>
      )}

      {/* Ledger / Reconciliation view */}
      {data.order && (
        <section className="mb-8">
          <h2 className="font-display text-lg font-semibold mb-3">Ledger — Order {data.order.order_id}</h2>
          <div className="rounded-lg p-5" style={{ background: "var(--surface)", border: "1px solid var(--line)" }}>
            <LedgerSummary expected={data.order.amount} collected={collected} />
          </div>
        </section>
      )}

      {/* Agent Activity + AI Investigation Result */}
      {(activity.length > 0 || inv) && (
        <section className="mb-8">
          <h2 className="font-display text-lg font-semibold mb-3">Agent Activity &amp; AI Investigation</h2>
          <div className="grid grid-cols-2 gap-8">
            <div className="rounded-lg p-5" style={{ background: "var(--surface)", border: "1px solid var(--line)" }}>
              <p className="text-xs mb-4" style={{ color: "var(--text-soft)" }}>
                RECONCILEX INVESTIGATION — real backend steps executed against this case.
              </p>
              <AgentActivityPanel steps={activity} />
            </div>
            <div className="rounded-lg p-5" style={{ background: "var(--surface)", border: "1px solid var(--line)" }}>
              {inv && inv.status === "COMPLETED" ? (
                <>
                  <div className="flex items-center justify-between mb-3">
                    <p className="text-xs" style={{ color: "var(--text-soft)" }}>
                      AI classification &amp; reasoning
                    </p>
                    {inv.risk_level && <RiskBadge risk={inv.risk_level} />}
                  </div>
                  <p className="text-sm font-medium mb-1">Summary</p>
                  <p className="text-sm mb-3" style={{ color: "var(--text-soft)" }}>{inv.summary}</p>
                  <p className="text-sm font-medium mb-1">Root cause</p>
                  <p className="text-sm mb-3" style={{ color: "var(--text-soft)" }}>{inv.root_cause}</p>
                  <p className="text-sm font-medium mb-1">Recommended action</p>
                  <p className="text-sm mb-3" style={{ color: "var(--text-soft)" }}>{inv.recommended_action}</p>
                  <div className="rule-soft pt-3 flex items-center justify-between">
                    <span className="text-xs" style={{ color: "var(--text-faint)" }}>
                      Model: {inv.model}
                    </span>
                    <span className="text-xs font-mono" style={{ color: "var(--text-faint)" }}>
                      {inv.requires_human_approval ? "HUMAN APPROVAL REQUIRED" : "No financial action recommended"}
                    </span>
                  </div>
                </>
              ) : inv && inv.status === "UNAVAILABLE" ? (
                <>
                  <p className="text-sm font-medium mb-1" style={{ color: "var(--alert-red)" }}>
                    AI investigation unavailable
                  </p>
                  <p className="text-xs mb-3" style={{ color: "var(--text-soft)" }}>{inv.error}</p>
                  <p className="text-xs" style={{ color: "var(--text-faint)" }}>
                    Falling back to the deterministic evidence and confidence score below — no
                    financial facts depend on the AI layer being available.
                  </p>
                </>
              ) : (
                <p className="text-sm" style={{ color: "var(--text-soft)" }}>Running investigation…</p>
              )}
            </div>
          </div>
        </section>
      )}

      <div className="grid grid-cols-2 gap-8 mb-8">
        {/* Deterministic evidence */}
        <section>
          <h2 className="font-display text-lg font-semibold mb-3">Why This Incident Was Flagged</h2>
          <div className="rounded-lg p-5" style={{ background: "var(--surface)", border: "1px solid var(--line)" }}>
            <p className="text-xs mb-4" style={{ color: "var(--text-soft)" }}>
              Every signal below is read directly from the payment and order records — nothing
              is inferred beyond the stored data. This is the deterministic engine's evidence,
              independent of the AI layer above.
            </p>
            <EvidenceList evidence={evidence} />
            <div className="rule-soft mt-4 pt-4">
              <p className="text-sm">
                <span className="font-medium">Conclusion: </span>
                {c.confidence_band === "HIGH" &&
                  "The transactions are highly likely to represent the same underlying purchase."}
                {c.confidence_band === "MEDIUM" &&
                  "Evidence is suggestive but not conclusive. This requires a human decision before any action is taken."}
                {c.confidence_band === "LOW" &&
                  "Evidence does not support treating these as duplicate payments."}
              </p>
            </div>
          </div>
        </section>

        {/* Recommendation + Actions */}
        <section>
          <h2 className="font-display text-lg font-semibold mb-3">Resolution</h2>
          <div className="rounded-lg p-5" style={{ background: "var(--surface)", border: "1px solid var(--line)" }}>
            {c.recommendation ? (
              <>
                <p className="text-sm mb-1" style={{ color: "var(--text-soft)" }}>Recommended action (deterministic)</p>
                <p className="font-display text-xl font-semibold mb-1">{c.recommendation}</p>
                <p className="text-sm mb-4" style={{ color: "var(--text-soft)" }}>
                  {c.recommended_amount != null ? formatINR(c.recommended_amount) : ""} ·{" "}
                  {c.confidence}% confidence
                </p>
              </>
            ) : (
              <p className="text-sm mb-4" style={{ color: "var(--text-soft)" }}>
                No automatic recommendation. This case needs manual review before any resolution
                is proposed.
              </p>
            )}

            <div className="flex flex-col gap-2">
              <button
                onClick={() => doAction("approve")}
                disabled={!canApprove || actionLoading !== null}
                className="px-4 py-2.5 rounded-md text-sm font-medium text-white transition-opacity disabled:opacity-40"
                style={{ background: "var(--ledger-green)" }}
              >
                {actionLoading === "approve" ? "Approving…" : "Approve Resolution"}
              </button>
              <button
                onClick={() => doAction("reject")}
                disabled={!canReject || actionLoading !== null}
                className="px-4 py-2.5 rounded-md text-sm font-medium disabled:opacity-40"
                style={{ border: "1px solid var(--alert-red)", color: "var(--alert-red)" }}
              >
                {actionLoading === "reject" ? "Rejecting…" : "Reject"}
              </button>

              {!showEscalateReason ? (
                <button
                  onClick={() => setShowEscalateReason(true)}
                  disabled={!canManualReview || actionLoading !== null}
                  className="px-4 py-2.5 rounded-md text-sm font-medium disabled:opacity-40"
                  style={{ border: "1px solid var(--line)", color: "var(--text-soft)" }}
                >
                  Escalate to Manual Review
                </button>
              ) : (
                <div className="rounded-md p-3" style={{ border: "1px solid var(--line)" }}>
                  <p className="text-xs font-medium mb-2">Escalate to Manual Review</p>
                  <textarea
                    value={escalateReason}
                    onChange={(e) => setEscalateReason(e.target.value)}
                    placeholder="Optional — why does this need human review? (e.g. evidence is ambiguous, amount is unusually large)"
                    className="w-full text-sm rounded-md p-2 mb-2"
                    style={{ border: "1px solid var(--line)", background: "var(--surface)" }}
                    rows={3}
                  />
                  <div className="flex gap-2">
                    <button
                      onClick={() => doAction("manual-review", escalateReason || undefined)}
                      disabled={actionLoading !== null}
                      className="px-3 py-2 rounded-md text-xs font-medium text-white disabled:opacity-40"
                      style={{ background: "var(--ink)" }}
                    >
                      {actionLoading === "manual-review" ? "Sending…" : "Confirm Escalation"}
                    </button>
                    <button
                      onClick={() => {
                        setShowEscalateReason(false);
                        setEscalateReason("");
                      }}
                      disabled={actionLoading !== null}
                      className="px-3 py-2 rounded-md text-xs font-medium"
                      style={{ color: "var(--text-faint)" }}
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              )}
            </div>

            {data.refund && (
              <div className="rule-soft mt-4 pt-4">
                <p className="text-xs font-mono uppercase tracking-wide mb-2" style={{ color: "var(--text-faint)" }}>
                  Refund {data.refund.source === "RAZORPAY_TEST" ? "(Razorpay Test Mode)" : "(Simulated)"}
                </p>
                <div className="flex items-center justify-between text-sm mb-1">
                  <span style={{ color: "var(--text-soft)" }}>Payment</span>
                  <span className="font-mono">{data.refund.payment_id}</span>
                </div>
                {data.refund.razorpay_refund_id && (
                  <div className="flex items-center justify-between text-sm mb-1">
                    <span style={{ color: "var(--text-soft)" }}>Razorpay Refund</span>
                    <span className="font-mono">{data.refund.razorpay_refund_id}</span>
                  </div>
                )}
                <div className="flex items-center justify-between text-sm mb-2">
                  <span style={{ color: "var(--text-soft)" }}>Status</span>
                  <span
                    className="font-mono font-medium"
                    style={{
                      color:
                        data.refund.status === "COMPLETED"
                          ? "var(--ledger-green)"
                          : data.refund.status === "FAILED"
                          ? "var(--alert-red)"
                          : "var(--seal-amber)",
                    }}
                  >
                    {data.refund.status}
                  </span>
                </div>
                {data.refund.error && (
                  <p className="text-xs mb-2" style={{ color: "var(--alert-red)" }}>{data.refund.error}</p>
                )}
                {data.refund.status === "PROCESSING" && data.refund.source === "RAZORPAY_TEST" && (
                  <>
                    <button
                      onClick={checkRefundStatus}
                      disabled={checkingRefund}
                      className="px-3 py-2 rounded-md text-xs font-medium w-full disabled:opacity-60"
                      style={{ border: "1px solid var(--line)", color: "var(--text-soft)" }}
                    >
                      {checkingRefund ? "Checking…" : "Check Refund Status"}
                    </button>
                    <p className="text-[11px] mt-2" style={{ color: "var(--text-faint)" }}>
                      Razorpay refunds are asynchronous. On localhost the confirmation webhook
                      can&apos;t reach this app — use this button to ask Razorpay directly instead
                      of waiting.
                    </p>
                  </>
                )}
              </div>
            )}

            {error && (
              <p className="text-xs mt-3" style={{ color: "var(--alert-red)" }}>
                {error}
              </p>
            )}
            {!canApprove && !canReject && !canManualReview && (
              <p className="text-xs mt-3" style={{ color: "var(--text-faint)" }}>
                This case is closed — no further action is available.
              </p>
            )}
            <p className="text-[11px] mt-3" style={{ color: "var(--text-faint)" }}>
              The refund amount and payment ID above always come from the database — the AI layer
              never supplies the number that gets approved.
            </p>
          </div>
        </section>
      </div>

      {/* Audit Timeline */}
      <section>
        <h2 className="font-display text-lg font-semibold mb-3">Audit Timeline</h2>
        <div className="rounded-lg p-5" style={{ background: "var(--surface)", border: "1px solid var(--line)" }}>
          <AuditTimeline events={data.audit} />
        </div>
      </section>
    </main>
  );
}
