import { getDb } from "./db";
import { randomUUID } from "crypto";

export interface RecordAuditParams {
  caseId?: string | null;
  paymentId?: string | null;
  eventType: string;
  actor: string;
  reason?: string | null;
  previousState?: string | null;
  newState?: string | null;
  action?: string | null;
  outcome?: string | null;
  metadata?: Record<string, unknown> | null;
  timestamp?: string;
}

export function recordAudit(params: RecordAuditParams) {
  const db = getDb();
  const event_id = "AUD-" + randomUUID().slice(0, 8).toUpperCase();
  const timestamp = params.timestamp ?? new Date().toISOString();

  db.prepare(
    `INSERT INTO audit_events
      (event_id, case_id, payment_id, event_type, actor, timestamp, reason, previous_state, new_state, action, outcome, metadata)
     VALUES (@event_id, @case_id, @payment_id, @event_type, @actor, @timestamp, @reason, @previous_state, @new_state, @action, @outcome, @metadata)`
  ).run({
    event_id,
    case_id: params.caseId ?? null,
    payment_id: params.paymentId ?? null,
    event_type: params.eventType,
    actor: params.actor,
    timestamp,
    reason: params.reason ?? null,
    previous_state: params.previousState ?? null,
    new_state: params.newState ?? null,
    action: params.action ?? null,
    outcome: params.outcome ?? null,
    metadata: params.metadata ? JSON.stringify(params.metadata) : null,
  });

  return event_id;
}

export function getAuditForCase(caseId: string) {
  const db = getDb();
  return db
    .prepare(`SELECT * FROM audit_events WHERE case_id = ? ORDER BY timestamp ASC`)
    .all(caseId);
}

export function getAuditForPayment(paymentId: string) {
  const db = getDb();
  return db
    .prepare(`SELECT * FROM audit_events WHERE payment_id = ? ORDER BY timestamp ASC`)
    .all(paymentId);
}
