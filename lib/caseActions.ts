import { getDb } from "./db";
import { recordAudit } from "./audit";
import { ResolutionCase, Payment } from "./types";
import { randomUUID } from "crypto";
import { createRazorpayRefund, isRazorpayConfigured, toPaise, RazorpayApiError } from "./razorpay";

export class CaseActionError extends Error {
  code: string;
  constructor(code: string, message: string) {
    super(message);
    this.code = code;
  }
}

export function getCase(caseId: string): ResolutionCase | undefined {
  const db = getDb();
  return db.prepare(`SELECT * FROM resolution_cases WHERE case_id = ?`).get(caseId) as
    | ResolutionCase
    | undefined;
}

function touch(caseId: string, status: string) {
  const db = getDb();
  db.prepare(`UPDATE resolution_cases SET status = ?, updated_at = ? WHERE case_id = ?`).run(
    status,
    new Date().toISOString(),
    caseId
  );
}

function setPaymentStatus(paymentId: string, status: string) {
  const db = getDb();
  db.prepare(`UPDATE payments SET current_status = ?, updated_at = ? WHERE payment_id = ?`).run(
    status,
    new Date().toISOString(),
    paymentId
  );
}

/**
 * Approve a case's recommended refund. Idempotent: re-approving an already
 * resolved/refunded/in-flight case never triggers a second refund.
 *
 * Branches on the recommended payment's `source`:
 *  - SIMULATION (the original prototype behavior, unchanged): refund is
 *    simulated instantly, case goes straight to RESOLVED.
 *  - RAZORPAY_TEST (only if Razorpay is configured): calls Razorpay's real
 *    Test Mode Refund API. This is asynchronous even in test mode, so the
 *    case stops at REFUND_INITIATED until a webhook or a manual status
 *    check (POST /api/razorpay/refunds/:id/status) confirms completion —
 *    we never claim REFUND_COMPLETED before Razorpay actually confirms it.
 */
export async function approveCase(caseId: string, actor = "Merchant Ops") {
  const c = getCase(caseId);
  if (!c) throw new CaseActionError("NOT_FOUND", `Case ${caseId} does not exist`);

  if (["REFUND_COMPLETED", "RESOLVED"].includes(c.status)) {
    return { alreadyProcessed: true, message: "Refund already completed. No further action taken.", case: c };
  }
  if (c.status === "REFUND_INITIATED" || c.status === "APPROVED") {
    return { alreadyProcessed: true, message: "Refund is already in progress for this case.", case: c };
  }
  if (c.status === "REJECTED") {
    throw new CaseActionError("INVALID_TRANSITION", "This case was rejected and cannot be approved.");
  }
  if (c.status !== "AWAITING_APPROVAL") {
    throw new CaseActionError(
      "INVALID_TRANSITION",
      `Case is in status ${c.status} and is not awaiting approval.`
    );
  }
  if (!c.recommendation || !c.recommended_amount) {
    throw new CaseActionError("NO_RECOMMENDATION", "This case has no refund recommendation to approve.");
  }
  // Bind to a local const immediately after the guard so the non-null type
  // is certain for the rest of this function, regardless of how far the
  // narrowing on `c.recommended_amount` would otherwise be trusted to
  // survive across the intervening statements below.
  const recommendation = c.recommendation;
  const recommendedAmount = c.recommended_amount;

  const db = getDb();
  const paymentIds: string[] = JSON.parse(c.payment_ids);
  const refundPaymentId = recommendation.replace("Refund ", "").trim();
  if (!paymentIds.includes(refundPaymentId)) {
    throw new CaseActionError("INVALID_PAYMENT", "Recommended refund payment is not part of this case.");
  }

  // Refund-level idempotency: if a refund row already exists for this case,
  // never create a second one — even if this function somehow got called
  // twice concurrently (e.g. a double-click that raced past the status
  // check above).
  const existingRefund = db.prepare(`SELECT * FROM refunds WHERE case_id = ?`).get(caseId) as
    | { refund_id: string; status: string }
    | undefined;
  if (existingRefund) {
    return {
      alreadyProcessed: true,
      message: `A refund is already ${existingRefund.status.toLowerCase()} for this case.`,
      case: c,
    };
  }

  const payment = db.prepare(`SELECT * FROM payments WHERE payment_id = ?`).get(refundPaymentId) as
    | Payment
    | undefined;
  if (!payment) {
    throw new CaseActionError("INVALID_PAYMENT", `Payment ${refundPaymentId} not found.`);
  }
  if (payment.current_status === "REFUNDED") {
    throw new CaseActionError("ALREADY_REFUNDED", "This payment has already been refunded.");
  }

  recordAudit({
    caseId,
    paymentId: refundPaymentId,
    eventType: "MERCHANT_APPROVED_REFUND",
    actor,
    reason: `Merchant approved AI recommendation: ${recommendation}`,
    previousState: "AWAITING_APPROVAL",
    newState: "APPROVED",
  });
  touch(caseId, "APPROVED");

  const useRealGateway = payment.source === "RAZORPAY_TEST" && isRazorpayConfigured();

  if (useRealGateway) {
    return approveCaseViaRazorpay(caseId, payment, recommendedAmount);
  }
  return approveCaseSimulated(caseId, refundPaymentId, recommendedAmount, c.customer_id);
}

function approveCaseSimulated(caseId: string, refundPaymentId: string, amount: number, customerId: string) {
  // Simulate refund initiation immediately (prototype)
  recordAudit({
    caseId,
    paymentId: refundPaymentId,
    eventType: "REFUND_INITIATED",
    actor: "ReconcileX Agent",
    reason: "Refund workflow started (simulated — no live payment gateway connected)",
    previousState: "APPROVED",
    newState: "REFUND_INITIATED",
    action: `Refund ${refundPaymentId}`,
  });
  touch(caseId, "REFUND_INITIATED");

  // Simulate refund completion
  setPaymentStatus(refundPaymentId, "REFUNDED");
  recordAudit({
    caseId,
    paymentId: refundPaymentId,
    eventType: "REFUND_COMPLETED",
    actor: "ReconcileX Agent",
    reason: "Simulated refund completed successfully",
    previousState: "REFUND_INITIATED",
    newState: "REFUND_COMPLETED",
    outcome: `\u20b9${amount} refunded to customer ${customerId} (simulated)`,
  });
  touch(caseId, "REFUND_COMPLETED");

  recordAudit({
    caseId,
    eventType: "CASE_RESOLVED",
    actor: "ReconcileX Agent",
    reason: "Refund verified complete; case closed",
    previousState: "REFUND_COMPLETED",
    newState: "RESOLVED",
  });
  touch(caseId, "RESOLVED");

  return { alreadyProcessed: false, message: "Refund approved and completed (simulated).", case: getCase(caseId) };
}

async function approveCaseViaRazorpay(caseId: string, payment: Payment, amount: number) {
  const db = getDb();
  const now = new Date().toISOString();
  const refundId = "RFD-" + randomUUID().slice(0, 8).toUpperCase();

  // Create the refund row BEFORE calling Razorpay, in PROCESSING state, so
  // that even if the process crashes between the API call and recording the
  // result, the case-level idempotency check above still catches a retry —
  // it will see this row and refuse to call Razorpay a second time.
  db.prepare(
    `INSERT INTO refunds (refund_id, case_id, payment_id, razorpay_refund_id, amount, source, status, created_at, updated_at)
     VALUES (?, ?, ?, NULL, ?, 'RAZORPAY_TEST', 'PROCESSING', ?, ?)`
  ).run(refundId, caseId, payment.payment_id, amount, now, now);

  recordAudit({
    caseId,
    paymentId: payment.payment_id,
    eventType: "REFUND_INITIATED",
    actor: "ReconcileX Agent",
    reason: "Calling Razorpay Test Mode Refund API",
    previousState: "APPROVED",
    newState: "REFUND_INITIATED",
    action: `Refund ${payment.payment_id}`,
  });
  touch(caseId, "REFUND_INITIATED");

  if (!payment.razorpay_payment_id) {
    db.prepare(`UPDATE refunds SET status = 'FAILED', error = ?, updated_at = ? WHERE refund_id = ?`).run(
      "Payment has no razorpay_payment_id on record",
      now,
      refundId
    );
    throw new CaseActionError("MISSING_GATEWAY_ID", "This payment has no Razorpay payment ID on record.");
  }

  try {
    const rzpRefund = await createRazorpayRefund(payment.razorpay_payment_id, toPaise(amount), refundId);
    db.prepare(
      `UPDATE refunds SET razorpay_refund_id = ?, status = ?, updated_at = ? WHERE refund_id = ?`
    ).run(rzpRefund.id, rzpRefund.status === "processed" ? "COMPLETED" : "PROCESSING", now, refundId);

    recordAudit({
      caseId,
      paymentId: payment.payment_id,
      eventType: "RAZORPAY_REFUND_CREATED",
      actor: "ReconcileX Agent",
      reason: `Razorpay refund ${rzpRefund.id} created (status: ${rzpRefund.status})`,
      outcome: `\u20b9${amount} refund submitted to Razorpay Test Mode`,
    });

    if (rzpRefund.status === "processed") {
      // Some test-mode refunds complete synchronously — finish the flow now
      // rather than waiting for a webhook that may never arrive on localhost.
      setPaymentStatus(payment.payment_id, "REFUNDED");
      touch(caseId, "REFUND_COMPLETED");
      recordAudit({
        caseId,
        paymentId: payment.payment_id,
        eventType: "REFUND_COMPLETED",
        actor: "ReconcileX Agent",
        reason: "Razorpay reported the refund as processed immediately",
        newState: "REFUND_COMPLETED",
      });
      touch(caseId, "RESOLVED");
      recordAudit({
        caseId,
        eventType: "CASE_RESOLVED",
        actor: "ReconcileX Agent",
        reason: "Refund verified complete; case closed",
        newState: "RESOLVED",
      });
      return { alreadyProcessed: false, message: "Refund created and already processed by Razorpay.", case: getCase(caseId) };
    }

    return {
      alreadyProcessed: false,
      message:
        "Refund submitted to Razorpay Test Mode and is PROCESSING. Use 'Check Refund Status' (or wait for the webhook, if publicly reachable) to confirm completion.",
      case: getCase(caseId),
      refundId,
    };
  } catch (err) {
    const message = err instanceof RazorpayApiError ? err.message : "Razorpay refund API call failed";
    db.prepare(`UPDATE refunds SET status = 'FAILED', error = ?, updated_at = ? WHERE refund_id = ?`).run(
      message,
      now,
      refundId
    );
    recordAudit({
      caseId,
      paymentId: payment.payment_id,
      eventType: "REFUND_FAILED",
      actor: "ReconcileX Agent",
      reason: message,
      newState: "APPROVED", // roll the case back to APPROVED, not stuck in limbo — merchant can retry
    });
    touch(caseId, "APPROVED");
    throw new CaseActionError("REFUND_FAILED", `Refund could not be created. Reason: ${message}`);
  }
}

/**
 * Manual, explicit override for the known Razorpay Test Mode limitation:
 * Instant Refunds (speed: "optimum") fall back to normal-speed refunds when
 * no real bank/UPI rail is available to route an instant transfer through —
 * which is effectively always, in a sandbox. A normal-speed refund then has
 * no real settlement event left to report, so it can sit in `pending`
 * forever; neither a webhook nor polling will ever see it move to
 * `processed`, because nothing is actually happening on Razorpay's side to
 * report.
 *
 * This function does NOT claim Razorpay confirmed anything. It records an
 * honest audit trail entry stating a human operator manually closed the
 * case after presumably checking the Razorpay Dashboard themselves — the
 * distinction between "Razorpay confirmed X" and "an operator manually
 * attests X" is preserved throughout, including in the actor/reason fields
 * so anyone reading the audit trail later sees exactly what happened.
 *
 * Only usable when a Razorpay-sourced refund is genuinely stuck in
 * PROCESSING — this is not a bypass for the approval step itself, which
 * already happened before this refund was ever created.
 */
export function forceCompleteRazorpayRefund(caseId: string, actor = "Merchant Ops") {
  const db = getDb();
  const c = getCase(caseId);
  if (!c) throw new CaseActionError("NOT_FOUND", `Case ${caseId} does not exist`);

  const refund = db.prepare(`SELECT * FROM refunds WHERE case_id = ?`).get(caseId) as
    | { refund_id: string; payment_id: string; source: string; status: string; amount: number }
    | undefined;

  if (!refund) {
    throw new CaseActionError("NOT_FOUND", "No refund record exists for this case.");
  }
  if (refund.source !== "RAZORPAY_TEST") {
    throw new CaseActionError(
      "INVALID_SOURCE",
      "This override is only for Razorpay Test Mode refunds stuck in PROCESSING — simulated refunds complete instantly and never need it."
    );
  }
  if (refund.status !== "PROCESSING") {
    return {
      alreadyProcessed: true,
      message: `Refund is already ${refund.status.toLowerCase()}; nothing to override.`,
      case: c,
    };
  }

  const now = new Date().toISOString();
  db.prepare(`UPDATE refunds SET status = 'COMPLETED', updated_at = ? WHERE refund_id = ?`).run(now, refund.refund_id);
  db.prepare(`UPDATE payments SET current_status = 'REFUNDED', updated_at = ? WHERE payment_id = ?`).run(
    now,
    refund.payment_id
  );

  recordAudit({
    caseId,
    paymentId: refund.payment_id,
    eventType: "REFUND_MANUALLY_CONFIRMED",
    actor,
    reason:
      "Razorpay Test Mode did not report a final settlement status (a known sandbox limitation — see README). Operator manually confirmed the refund via the Razorpay Dashboard and closed the case.",
    previousState: "PROCESSING",
    newState: "COMPLETED",
    outcome: `\u20b9${refund.amount} — manually confirmed, not gateway-confirmed`,
  });
  touch(caseId, "REFUND_COMPLETED");

  recordAudit({
    caseId,
    eventType: "CASE_RESOLVED",
    actor: "ReconcileX Agent",
    reason: "Case closed following operator's manual refund confirmation",
    previousState: "REFUND_COMPLETED",
    newState: "RESOLVED",
  });
  touch(caseId, "RESOLVED");

  return { alreadyProcessed: false, message: "Refund manually marked complete.", case: getCase(caseId) };
}

export function rejectCase(caseId: string, actor = "Merchant Ops", reason?: string) {
  const c = getCase(caseId);
  if (!c) throw new CaseActionError("NOT_FOUND", `Case ${caseId} does not exist`);
  if (["REFUND_COMPLETED", "RESOLVED", "REJECTED"].includes(c.status)) {
    return { alreadyProcessed: true, message: `Case is already ${c.status}.`, case: c };
  }

  recordAudit({
    caseId,
    eventType: "MERCHANT_REJECTED_RECOMMENDATION",
    actor,
    reason: reason || "Merchant determined this is not a duplicate payment",
    previousState: c.status,
    newState: "REJECTED",
  });
  touch(caseId, "REJECTED");
  return { alreadyProcessed: false, message: "Case rejected.", case: getCase(caseId) };
}

export function sendToManualReview(caseId: string, actor = "Merchant Ops", reason?: string) {
  const c = getCase(caseId);
  if (!c) throw new CaseActionError("NOT_FOUND", `Case ${caseId} does not exist`);
  if (["REFUND_COMPLETED", "RESOLVED", "REJECTED"].includes(c.status)) {
    throw new CaseActionError("INVALID_TRANSITION", `Case is already ${c.status} and cannot be sent to manual review.`);
  }

  recordAudit({
    caseId,
    eventType: "SENT_TO_MANUAL_REVIEW",
    actor,
    reason: reason || "Evidence was inconclusive; flagged for human review before any action",
    previousState: c.status,
    newState: "MANUAL_REVIEW",
  });
  touch(caseId, "MANUAL_REVIEW");
  return { case: getCase(caseId) };
}