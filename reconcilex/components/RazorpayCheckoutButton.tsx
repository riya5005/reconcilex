"use client";

import { useState } from "react";

declare global {
  interface Window {
    Razorpay?: new (options: Record<string, unknown>) => { open: () => void };
  }
}

let scriptPromise: Promise<void> | null = null;
function loadCheckoutScript(): Promise<void> {
  if (window.Razorpay) return Promise.resolve();
  if (!scriptPromise) {
    scriptPromise = new Promise((resolve, reject) => {
      const script = document.createElement("script");
      script.src = "https://checkout.razorpay.com/v1/checkout.js";
      script.onload = () => resolve();
      script.onerror = () => reject(new Error("Failed to load Razorpay Checkout script."));
      document.body.appendChild(script);
    });
  }
  return scriptPromise;
}

interface Props {
  customerId: string;
  customerName?: string;
  service: string;
  amount: number; // rupees
  internalOrderId?: string; // attach to an existing ReconcileX order, if any
  label?: string;
  onSuccess?: (result: { internalOrderId: string; created: boolean }) => void;
  onError?: (message: string) => void;
}

export default function RazorpayCheckoutButton({
  customerId,
  customerName,
  service,
  amount,
  internalOrderId,
  label = "Create Razorpay Test Payment",
  onSuccess,
  onError,
}: Props) {
  const [loading, setLoading] = useState(false);

  async function handleClick() {
    setLoading(true);
    try {
      const orderRes = await fetch("/api/razorpay/orders", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ customerId, customerName, service, amount, internalOrderId }),
      });
      const order = await orderRes.json();
      if (!orderRes.ok) throw new Error(order.error || "Failed to create Razorpay order.");

      await loadCheckoutScript();

      const RazorpayCtor = window.Razorpay;
      if (!RazorpayCtor) {
        throw new Error("Razorpay Checkout script did not load correctly.");
      }

      const rzp = new RazorpayCtor({
        key: order.keyId,
        amount: order.amountPaise,
        currency: order.currency,
        order_id: order.razorpayOrderId,
        name: "ReconcileX (Razorpay Test Mode)",
        description: service,
        prefill: { name: customerName || customerId },
        theme: { color: "#1F2A20" },
        handler: async (response: {
          razorpay_order_id: string;
          razorpay_payment_id: string;
          razorpay_signature: string;
        }) => {
          try {
            const confirmRes = await fetch("/api/razorpay/payments/confirm", {
              method: "POST",
              headers: { "content-type": "application/json" },
              body: JSON.stringify(response),
            });
            const confirmed = await confirmRes.json();
            if (!confirmRes.ok) throw new Error(confirmed.error || "Payment confirmation failed.");
            onSuccess?.({ internalOrderId: order.internalOrderId, created: confirmed.created });
          } catch (err) {
            onError?.(err instanceof Error ? err.message : "Payment confirmation failed.");
          }
        },
        modal: {
          ondismiss: () => setLoading(false),
        },
      });
      rzp.open();
    } catch (err) {
      onError?.(err instanceof Error ? err.message : "Could not start Razorpay Checkout.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <button
      onClick={handleClick}
      disabled={loading}
      className="px-4 py-2.5 rounded-md text-sm font-medium text-white transition-opacity disabled:opacity-60"
      style={{ background: "var(--ink)" }}
    >
      {loading ? "Opening Checkout…" : label}
    </button>
  );
}
