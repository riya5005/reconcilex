import { formatINR, formatDateTime } from "@/lib/format";

interface Payment {
  payment_id: string;
  amount: number;
  method: string;
  initial_status: string;
  current_status: string;
  created_at: string;
  source?: string;
  razorpay_payment_id?: string | null;
}

function PayCard({ p, role }: { p: Payment; role: string }) {
  const isRazorpay = p.source === "RAZORPAY_TEST";
  return (
    <div className="rounded-lg p-5 flex-1" style={{ background: "var(--surface)", border: "1px solid var(--line)" }}>
      <div className="flex items-center justify-between mb-2">
        <p className="text-[10px] font-mono uppercase tracking-wide" style={{ color: "var(--text-faint)" }}>
          {role}
        </p>
        {p.source && (
          <span
            className="text-[10px] font-mono uppercase tracking-wide"
            style={{ color: isRazorpay ? "var(--ledger-green)" : "var(--text-faint)" }}
          >
            {isRazorpay ? "● Razorpay Test" : "○ Simulation"}
          </span>
        )}
      </div>
      <p className="font-mono text-sm mb-3" style={{ color: "var(--text-soft)" }}>{p.payment_id}</p>
      <p className="font-display text-2xl font-semibold mb-1">{formatINR(p.amount)}</p>
      <p className="text-sm mb-3" style={{ color: "var(--text-soft)" }}>{p.method}</p>
      <div className="rule-soft pt-3 flex flex-col gap-1.5">
        <div className="flex justify-between text-xs">
          <span style={{ color: "var(--text-faint)" }}>Time</span>
          <span className="font-mono">{formatDateTime(p.created_at)}</span>
        </div>
        <div className="flex justify-between text-xs">
          <span style={{ color: "var(--text-faint)" }}>Status</span>
          <span className="font-mono">
            {p.initial_status !== p.current_status
              ? `${p.initial_status} \u2192 ${p.current_status}`
              : p.current_status}
          </span>
        </div>
        {isRazorpay && p.razorpay_payment_id && (
          <div className="flex justify-between text-xs">
            <span style={{ color: "var(--text-faint)" }}>Razorpay ID</span>
            <span className="font-mono">{p.razorpay_payment_id}</span>
          </div>
        )}
      </div>
    </div>
  );
}

export default function TransactionComparison({ payments }: { payments: Payment[] }) {
  const sorted = [...payments].sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());
  return (
    <div className="flex items-stretch gap-3">
      {sorted.map((p, i) => (
        <PayCard key={p.payment_id} p={p} role={i === 0 ? "First payment" : `Payment ${i + 1}`} />
      ))}
    </div>
  );
}
