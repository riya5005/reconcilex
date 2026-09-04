import { formatDateTime, eventTypeLabel } from "@/lib/format";

interface AuditEvent {
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
}

export default function AuditTimeline({ events }: { events: AuditEvent[] }) {
  return (
    <ol className="flex flex-col">
      {events.map((e, i) => {
        const isGatewayEvent = e.actor.toLowerCase().startsWith("razorpay");
        return (
          <li key={e.event_id} className="relative pl-6 pb-6 last:pb-0">
            {i !== events.length - 1 && (
              <span
                className="absolute left-[5px] top-3 bottom-0 w-px"
                style={{ background: "var(--line)" }}
              />
            )}
            <span
              className="absolute left-0 top-1.5 w-2.5 h-2.5 rounded-full"
              style={{ background: isGatewayEvent ? "var(--seal-amber)" : "var(--ledger-green)" }}
            />
            <div className="flex items-baseline justify-between gap-3">
              <span className="text-sm font-medium flex items-center gap-2">
                {eventTypeLabel(e.event_type)}
                {isGatewayEvent && (
                  <span
                    className="text-[9px] font-mono uppercase tracking-wide px-1.5 py-0.5 rounded"
                    style={{ background: "var(--seal-amber-soft)", color: "var(--seal-amber)" }}
                  >
                    Gateway event
                  </span>
                )}
              </span>
              <span className="font-mono text-xs shrink-0" style={{ color: "var(--text-faint)" }}>
                {formatDateTime(e.timestamp)}
              </span>
            </div>
            <p className="text-xs mt-0.5" style={{ color: "var(--text-faint)" }}>
              {e.actor}
              {e.payment_id ? ` · ${e.payment_id}` : ""}
              {e.previous_state && e.new_state ? ` · ${e.previous_state} → ${e.new_state}` : ""}
            </p>
            {e.reason && (
              <p className="text-sm mt-1" style={{ color: "var(--text-soft)" }}>
                {e.reason}
              </p>
            )}
            {e.outcome && (
              <p className="text-sm mt-1 font-medium" style={{ color: "var(--ledger-green)" }}>
                {e.outcome}
              </p>
            )}
          </li>
        );
      })}
    </ol>
  );
}