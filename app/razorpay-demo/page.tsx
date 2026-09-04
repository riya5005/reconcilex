"use client";

import { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import IntegrationStatus from "@/components/IntegrationStatus";
import RazorpayCheckoutButton from "@/components/RazorpayCheckoutButton";
import { formatINR } from "@/lib/format";

interface DemoPayment {
  payment_id: string;
  amount: number;
  method: string;
  current_status: string;
  source: string;
  razorpay_payment_id: string | null;
  created_at: string;
}

const DEMO_CUSTOMER_ID = "C-RZP-DEMO";
const DEMO_CUSTOMER_NAME = "Razorpay Demo Customer";
const DEMO_SERVICE = "Razorpay Test Demo Course";
const DEMO_AMOUNT = 1000; // ₹1,000, matching the flagship simulation scenario's amount

export default function RazorpayDemoPage() {
  const [razorpayConfigured, setRazorpayConfigured] = useState<boolean | null>(null);
  const [internalOrderId, setInternalOrderId] = useState<string | null>(null);
  const [payments, setPayments] = useState<DemoPayment[]>([]);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [detectedCaseId, setDetectedCaseId] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/integrations/status")
      .then((r) => r.json())
      .then((s) => setRazorpayConfigured(s.razorpay))
      .catch(() => setRazorpayConfigured(false));
  }, []);

  const refreshPayments = useCallback(async (orderId: string) => {
    const res = await fetch("/api/payments");
    const json = await res.json();
    const all: (DemoPayment & { order_id: string | null })[] = json.payments ?? [];
    setPayments(all.filter((p) => p.order_id === orderId));
  }, []);

  const refreshCaseLink = useCallback(async (orderId: string) => {
    const res = await fetch("/api/dashboard");
    const json = await res.json();
    const match = (json.recentCases ?? []).find(
      (c: { order_id?: string }) => c.order_id === orderId
    );
    if (match) setDetectedCaseId(match.case_id);
  }, []);

  async function handleSuccess(result: { internalOrderId: string; created: boolean }) {
    setError(null);
    setInternalOrderId(result.internalOrderId);
    setMessage(
      result.created
        ? "Payment confirmed and recorded in ReconcileX. Detection ran automatically."
        : "Payment already recorded (idempotent — no duplicate row created)."
    );
    // Pass the freshly-received orderId directly rather than reading it back
    // from state — setInternalOrderId above hasn't committed within this
    // same function body yet, so closing over the `internalOrderId` state
    // variable here would still see its previous (possibly null) value.
    await refreshPayments(result.internalOrderId);
    await refreshCaseLink(result.internalOrderId);
  }

  function handleError(msg: string) {
    setError(msg);
  }

  return (
    <main className="p-8 max-w-4xl">
      <p className="text-[11px] font-mono uppercase tracking-wide mb-1" style={{ color: "var(--text-faint)" }}>
        Real Payment Gateway
      </p>
      <h1 className="font-display text-3xl font-semibold mb-2">Razorpay Test Demo</h1>
      <p className="text-sm max-w-2xl mb-6" style={{ color: "var(--text-soft)" }}>
        This page uses <strong>Razorpay Test Mode only</strong> — no real money moves. It walks
        through the same duplicate-payment story as the simulation scenarios, but with two real
        Razorpay Test Mode payments flowing through the exact same detection engine, ledger, and
        audit trail.
      </p>

      <div className="mb-6">
        <IntegrationStatus />
      </div>

      {razorpayConfigured === false && (
        <div
          className="rounded-lg p-5 mb-6"
          style={{ background: "var(--seal-amber-soft)", border: "1px solid var(--seal-amber)" }}
        >
          <p className="text-sm font-medium mb-1">Razorpay Test Mode is not configured</p>
          <p className="text-sm" style={{ color: "var(--text-soft)" }}>
            Set <code>RAZORPAY_KEY_ID</code> and <code>RAZORPAY_KEY_SECRET</code> in{" "}
            <code>.env.local</code> to enable this page. In the meantime, the{" "}
            <Link href="/" style={{ color: "var(--ledger-green)" }}>
              Simulation Mode
            </Link>{" "}
            demonstrates the identical detection → investigation → approval → refund → ledger flow
            without a gateway.
          </p>
        </div>
      )}

      {error && (
        <div className="rounded-lg p-4 mb-6" style={{ background: "var(--alert-red-soft)" }}>
          <p className="text-sm" style={{ color: "var(--alert-red)" }}>{error}</p>
        </div>
      )}
      {message && (
        <div className="rounded-lg p-4 mb-6" style={{ background: "var(--ledger-green-soft)" }}>
          <p className="text-sm" style={{ color: "var(--ledger-green)" }}>{message}</p>
        </div>
      )}

      <section className="rounded-lg p-5 mb-6" style={{ background: "var(--surface)", border: "1px solid var(--line)" }}>
        <h2 className="font-display text-lg font-semibold mb-1">Step 1 — First Test Payment</h2>
        <p className="text-sm mb-4" style={{ color: "var(--text-soft)" }}>
          Creates a new business order for {formatINR(DEMO_AMOUNT)} and opens Razorpay Test
          Checkout. Use any{" "}
          <a
            href="https://razorpay.com/docs/payments/payments/test-card-upi-details/"
            target="_blank"
            rel="noreferrer"
            style={{ color: "var(--ledger-green)" }}
          >
            Razorpay test card or UPI ID
          </a>{" "}
          to complete it — no real card is charged.
        </p>
        <RazorpayCheckoutButton
          customerId={DEMO_CUSTOMER_ID}
          customerName={DEMO_CUSTOMER_NAME}
          service={DEMO_SERVICE}
          amount={DEMO_AMOUNT}
          label={razorpayConfigured ? "Create First Test Payment" : "Razorpay not configured"}
          onSuccess={handleSuccess}
          onError={handleError}
        />
      </section>

      <section
        className="rounded-lg p-5 mb-6"
        style={{
          background: "var(--surface)",
          border: "1px solid var(--line)",
          opacity: internalOrderId ? 1 : 0.5,
        }}
      >
        <h2 className="font-display text-lg font-semibold mb-1">Step 2 — Second Test Payment (Same Order)</h2>
        <p className="text-sm mb-4" style={{ color: "var(--text-soft)" }}>
          Pays the same order again for the same amount — recreating the &quot;customer retried
          after the first attempt looked stuck&quot; scenario, but with two real captured Razorpay
          Test payments. Collected will become {formatINR(DEMO_AMOUNT * 2)} against an expected{" "}
          {formatINR(DEMO_AMOUNT)}.
        </p>
        {internalOrderId ? (
          <RazorpayCheckoutButton
            customerId={DEMO_CUSTOMER_ID}
            customerName={DEMO_CUSTOMER_NAME}
            service={DEMO_SERVICE}
            amount={DEMO_AMOUNT}
            internalOrderId={internalOrderId}
            label="Create Second Test Payment"
            onSuccess={handleSuccess}
            onError={handleError}
          />
        ) : (
          <button disabled className="px-4 py-2.5 rounded-md text-sm font-medium opacity-50" style={{ border: "1px solid var(--line)" }}>
            Complete Step 1 first
          </button>
        )}
      </section>

      {payments.length > 0 && (
        <section className="rounded-lg p-5 mb-6" style={{ background: "var(--surface)", border: "1px solid var(--line)" }}>
          <h2 className="font-display text-lg font-semibold mb-3">Payments on order {internalOrderId}</h2>
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left">
                <th className="rule-soft pb-2 font-mono text-[11px] uppercase" style={{ color: "var(--text-faint)" }}>Payment</th>
                <th className="rule-soft pb-2 font-mono text-[11px] uppercase" style={{ color: "var(--text-faint)" }}>Source</th>
                <th className="rule-soft pb-2 font-mono text-[11px] uppercase" style={{ color: "var(--text-faint)" }}>Method</th>
                <th className="rule-soft pb-2 font-mono text-[11px] uppercase" style={{ color: "var(--text-faint)" }}>Amount</th>
                <th className="rule-soft pb-2 font-mono text-[11px] uppercase" style={{ color: "var(--text-faint)" }}>Status</th>
              </tr>
            </thead>
            <tbody>
              {payments.map((p) => (
                <tr key={p.payment_id} className="rule-soft">
                  <td className="py-2 font-mono text-xs">{p.payment_id}</td>
                  <td className="py-2 text-xs">
                    {p.source === "RAZORPAY_TEST" ? "● Razorpay Test" : "○ Simulation"}
                  </td>
                  <td className="py-2 text-xs">{p.method}</td>
                  <td className="py-2 text-xs">{formatINR(p.amount)}</td>
                  <td className="py-2 text-xs">{p.current_status}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}

      {detectedCaseId && (
        <section className="rounded-lg p-5" style={{ background: "var(--ledger-green-soft)" }}>
          <p className="text-sm font-medium mb-1">Anomaly detected</p>
          <p className="text-sm mb-3" style={{ color: "var(--text-soft)" }}>
            ReconcileX&apos;s deterministic engine evaluated these two real Razorpay Test payments
            and opened a resolution case.
          </p>
          <Link href={`/cases/${detectedCaseId}`} className="text-sm font-medium" style={{ color: "var(--ledger-green)" }}>
            Open case {detectedCaseId} →
          </Link>
        </section>
      )}
    </main>
  );
}
