import { getDb, resetDatabase } from "./db";
import { recordAudit } from "./audit";
import { runDuplicateDetection, runOrderPaymentMismatchDetection } from "./detection";

const METHODS = ["Credit Card", "Debit Card", "UPI", "Net Banking", "Wallet"] as const;
const SERVICES = ["Exam Fee", "Course A", "Course B", "Certification", "Subscription", "Workshop Pass"];

function iso(base: Date, minutesOffset: number) {
  return new Date(base.getTime() + minutesOffset * 60000).toISOString();
}

function randomChoice<T>(arr: readonly T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

export function seedDatabase() {
  const db = getDb();
  resetDatabase();

  const insertCustomer = db.prepare(`INSERT OR IGNORE INTO customers (customer_id, name) VALUES (?, ?)`);
  const insertOrder = db.prepare(
    `INSERT INTO orders (order_id, customer_id, service, amount, status) VALUES (?, ?, ?, ?, ?)`
  );
  const insertPayment = db.prepare(`
    INSERT INTO payments (payment_id, customer_id, order_id, amount, method, initial_status, current_status, created_at, updated_at)
    VALUES (@payment_id, @customer_id, @order_id, @amount, @method, @initial_status, @current_status, @created_at, @updated_at)
  `);

  const names = [
    "Aarav Sharma", "Diya Patel", "Vihaan Reddy", "Ananya Iyer", "Kabir Singh",
    "Ishaan Gupta", "Myra Nair", "Advait Rao", "Saanvi Menon", "Reyansh Verma",
  ];
  names.forEach((name, i) => insertCustomer.run(`C10${(20 + i)}`, name));

  // ---- CASE 1: HIGH CONFIDENCE DUPLICATE (the flagship demo scenario) ----
  const base = new Date("2026-08-24T10:02:00Z");
  insertOrder.run("EXAM_7782", "C1024", "Exam Fee", 1000, "COMPLETED");
  insertCustomer.run("C1024", "Aarav Sharma");

  insertPayment.run({
    payment_id: "PAY001",
    customer_id: "C1024",
    order_id: "EXAM_7782",
    amount: 1000,
    method: "Credit Card",
    initial_status: "PENDING",
    current_status: "PENDING", // will flip to SUCCESS below, mirroring the real timeline
    created_at: iso(base, 0),
    updated_at: iso(base, 0),
  });
  recordAudit({
    paymentId: "PAY001",
    eventType: "PAYMENT_RECEIVED",
    actor: "Payment Gateway",
    reason: "Card payment initiated",
    newState: "PENDING",
    timestamp: iso(base, 0),
  });

  insertPayment.run({
    payment_id: "PAY002",
    customer_id: "C1024",
    order_id: "EXAM_7782",
    amount: 1000,
    method: "UPI",
    initial_status: "SUCCESS",
    current_status: "SUCCESS",
    created_at: iso(base, 9),
    updated_at: iso(base, 9),
  });
  recordAudit({
    paymentId: "PAY002",
    eventType: "PAYMENT_RECEIVED",
    actor: "Payment Gateway",
    reason: "Customer retried via UPI, believing the card payment had failed",
    newState: "SUCCESS",
    timestamp: iso(base, 9),
  });

  // Delayed success on PAY001
  db.prepare(`UPDATE payments SET current_status = 'SUCCESS', updated_at = ? WHERE payment_id = 'PAY001'`).run(
    iso(base, 18)
  );
  recordAudit({
    paymentId: "PAY001",
    eventType: "PAYMENT_STATUS_CHANGED",
    actor: "Payment Gateway",
    reason: "Card issuer confirmed settlement (delayed webhook)",
    previousState: "PENDING",
    newState: "SUCCESS",
    timestamp: iso(base, 18),
  });

  // ---- CASE 2: LEGITIMATE RETRY (first attempt genuinely failed) ----
  insertCustomer.run("C1031", "Diya Patel");
  insertOrder.run("EXAM_9911", "C1031", "Exam Fee", 1000, "COMPLETED");
  insertPayment.run({
    payment_id: "PAY003",
    customer_id: "C1031",
    order_id: "EXAM_9911",
    amount: 1000,
    method: "Credit Card",
    initial_status: "FAILED",
    current_status: "FAILED",
    created_at: iso(base, 5),
    updated_at: iso(base, 5),
  });
  insertPayment.run({
    payment_id: "PAY004",
    customer_id: "C1031",
    order_id: "EXAM_9911",
    amount: 1000,
    method: "UPI",
    initial_status: "SUCCESS",
    current_status: "SUCCESS",
    created_at: iso(base, 14),
    updated_at: iso(base, 14),
  });
  recordAudit({ paymentId: "PAY003", eventType: "PAYMENT_RECEIVED", actor: "Payment Gateway", newState: "FAILED", timestamp: iso(base, 5) });
  recordAudit({ paymentId: "PAY004", eventType: "PAYMENT_RECEIVED", actor: "Payment Gateway", newState: "SUCCESS", timestamp: iso(base, 14) });
  // Note: PAY003 never succeeded, so "both eventually succeed" fails and this scores below HIGH.

  // ---- CASE 3: DIFFERENT PURCHASES (same customer, same amount, different service) ----
  insertCustomer.run("C1045", "Vihaan Reddy");
  insertOrder.run("ORD_5501", "C1045", "Course A", 1000, "COMPLETED");
  insertOrder.run("ORD_5502", "C1045", "Course B", 1000, "COMPLETED");
  insertPayment.run({
    payment_id: "PAY005",
    customer_id: "C1045",
    order_id: "ORD_5501",
    amount: 1000,
    method: "UPI",
    initial_status: "SUCCESS",
    current_status: "SUCCESS",
    created_at: iso(base, -600),
    updated_at: iso(base, -600),
  });
  insertPayment.run({
    payment_id: "PAY006",
    customer_id: "C1045",
    order_id: "ORD_5502",
    amount: 1000,
    method: "UPI",
    initial_status: "SUCCESS",
    current_status: "SUCCESS",
    created_at: iso(base, -540),
    updated_at: iso(base, -540),
  });
  recordAudit({ paymentId: "PAY005", eventType: "PAYMENT_RECEIVED", actor: "Payment Gateway", newState: "SUCCESS", timestamp: iso(base, -600) });
  recordAudit({ paymentId: "PAY006", eventType: "PAYMENT_RECEIVED", actor: "Payment Gateway", newState: "SUCCESS", timestamp: iso(base, -540) });

  // ---- CASE 4: MEDIUM CONFIDENCE / AMBIGUOUS (same customer/amount/service, large time gap) ----
  insertCustomer.run("C1052", "Ananya Iyer");
  insertOrder.run("ORD_6633", "C1052", "Subscription", 1000, "COMPLETED");
  insertPayment.run({
    payment_id: "PAY007",
    customer_id: "C1052",
    order_id: "ORD_6633",
    amount: 1000,
    method: "Net Banking",
    initial_status: "PENDING",
    current_status: "SUCCESS",
    created_at: iso(base, -4000),
    updated_at: iso(base, -3990),
  });
  insertPayment.run({
    payment_id: "PAY008",
    customer_id: "C1052",
    order_id: "ORD_6633",
    amount: 1000,
    method: "Net Banking",
    initial_status: "SUCCESS",
    current_status: "SUCCESS",
    created_at: iso(base, -2500), // ~25 hours later — same method, ambiguous: could be a renewal
    updated_at: iso(base, -2500),
  });
  recordAudit({ paymentId: "PAY007", eventType: "PAYMENT_RECEIVED", actor: "Payment Gateway", newState: "PENDING", timestamp: iso(base, -4000) });
  recordAudit({ paymentId: "PAY007", eventType: "PAYMENT_STATUS_CHANGED", actor: "Payment Gateway", previousState: "PENDING", newState: "SUCCESS", timestamp: iso(base, -3990) });
  recordAudit({ paymentId: "PAY008", eventType: "PAYMENT_RECEIVED", actor: "Payment Gateway", newState: "SUCCESS", timestamp: iso(base, -2500) });

  // ---- CASE 5: STUCK REFUND (seeded directly — pre-existing unresolved refund) ----
  insertCustomer.run("C1067", "Kabir Singh");
  insertOrder.run("ORD_7701", "C1067", "Workshop Pass", 1500, "COMPLETED");
  insertPayment.run({
    payment_id: "PAY009",
    customer_id: "C1067",
    order_id: "ORD_7701",
    amount: 1500,
    method: "Wallet",
    initial_status: "SUCCESS",
    current_status: "SUCCESS",
    created_at: iso(base, -8000),
    updated_at: iso(base, -8000),
  });
  insertPayment.run({
    payment_id: "PAY010",
    customer_id: "C1067",
    order_id: "ORD_7701",
    amount: 1500,
    method: "UPI",
    initial_status: "SUCCESS",
    current_status: "SUCCESS",
    created_at: iso(base, -7990),
    updated_at: iso(base, -7990),
  });
  const stuckCaseId = "RC-19204";
  db.prepare(`
    INSERT INTO resolution_cases
      (case_id, case_type, customer_id, order_id, payment_ids, confidence, confidence_band, evidence, recommendation, recommended_amount, status, created_at, updated_at)
    VALUES (?, 'STUCK_REFUND', 'C1067', 'ORD_7701', ?, 95, 'HIGH', ?, 'Refund PAY010', 1500, 'REFUND_INITIATED', ?, ?)
  `).run(
    stuckCaseId,
    JSON.stringify(["PAY009", "PAY010"]),
    JSON.stringify([
      { label: "Same customer", detail: "Both payments belong to C1067", points: 20, matched: true },
      { label: "Same amount", detail: "Both payments are for \u20b91,500", points: 20, matched: true },
      { label: "Same service/order", detail: "Both linked to order ORD_7701 (Workshop Pass)", points: 20, matched: true },
      { label: "Close transaction time", detail: "Payments occurred 10 minutes apart", points: 15, matched: true },
      { label: "Different payment methods", detail: "Wallet \u2192 UPI", points: 5, matched: true },
      { label: "Refund not completing", detail: "Refund was initiated 3 days ago and has not reached REFUND_COMPLETED", points: 15, matched: true },
    ]),
    iso(base, -4320),
    iso(base, -4300)
  );
  recordAudit({ caseId: stuckCaseId, paymentId: "PAY009", eventType: "PAYMENT_RECEIVED", actor: "Payment Gateway", newState: "SUCCESS", timestamp: iso(base, -8000) });
  recordAudit({ caseId: stuckCaseId, paymentId: "PAY010", eventType: "PAYMENT_RECEIVED", actor: "Payment Gateway", newState: "SUCCESS", timestamp: iso(base, -7990) });
  recordAudit({ caseId: stuckCaseId, eventType: "DUPLICATE_DETECTION_TRIGGERED", actor: "ReconcileX Agent", reason: "Evaluated PAY009 and PAY010", newState: "DETECTED", timestamp: iso(base, -7980) });
  recordAudit({ caseId: stuckCaseId, eventType: "MERCHANT_APPROVED_REFUND", actor: "Merchant Ops", reason: "Approved refund of PAY010", previousState: "AWAITING_APPROVAL", newState: "APPROVED", timestamp: iso(base, -4330) });
  recordAudit({ caseId: stuckCaseId, paymentId: "PAY010", eventType: "REFUND_INITIATED", actor: "ReconcileX Agent", reason: "Refund handed off to payment gateway (simulated)", previousState: "APPROVED", newState: "REFUND_INITIATED", timestamp: iso(base, -4320) });
  recordAudit({ caseId: stuckCaseId, eventType: "REFUND_STUCK_FLAGGED", actor: "ReconcileX Agent", reason: "No completion webhook received after 3 days — flagged for operator follow-up", timestamp: iso(base, -4300) });

  // ---- CASE 6: ORDER/PAYMENT MISMATCH ----
  insertCustomer.run("C1078", "Myra Nair");
  insertOrder.run("ORD_8809", "C1078", "Certification", 2000, "COMPLETED");
  insertPayment.run({
    payment_id: "PAY011",
    customer_id: "C1078",
    order_id: "ORD_8809",
    amount: 1200,
    method: "Debit Card",
    initial_status: "SUCCESS",
    current_status: "SUCCESS",
    created_at: iso(base, -6000),
    updated_at: iso(base, -6000),
  });
  recordAudit({ paymentId: "PAY011", eventType: "PAYMENT_RECEIVED", actor: "Payment Gateway", newState: "SUCCESS", timestamp: iso(base, -6000) });
  recordAudit({ eventType: "ORDER_MARKED_COMPLETED", actor: "Merchant System", reason: "Order ORD_8809 marked COMPLETED despite partial payment of \u20b91,200 against \u20b92,000 order value", timestamp: iso(base, -5990) });

  // ---- BULK FILLER DATA: realistic volume for dashboard metrics ----
  let counter = 100;
  for (let i = 0; i < 60; i++) {
    const custIdx = 20 + (i % names.length);
    const custId = `C10${custIdx}`;
    const service = randomChoice(SERVICES);
    const amount = randomChoice([500, 750, 1000, 1200, 1500, 2000, 2500]);
    const orderId = `ORD_${9000 + i}`;
    insertOrder.run(orderId, custId, service, amount, "COMPLETED");

    const payId = `PAY${(counter++).toString().padStart(3, "0")}`;
    const createdAt = iso(base, -Math.floor(Math.random() * 10000) - 100);
    insertPayment.run({
      payment_id: payId,
      customer_id: custId,
      order_id: orderId,
      amount,
      method: randomChoice(METHODS),
      initial_status: "SUCCESS",
      current_status: "SUCCESS",
      created_at: createdAt,
      updated_at: createdAt,
    });
    recordAudit({ paymentId: payId, eventType: "PAYMENT_RECEIVED", actor: "Payment Gateway", newState: "SUCCESS", timestamp: createdAt });

    // Sprinkle in a handful more genuine accidental duplicates for realistic dashboard volume
    if (i % 11 === 0) {
      const dupId = `PAY${(counter++).toString().padStart(3, "0")}`;
      const dupTime = iso(new Date(createdAt), 6 + Math.floor(Math.random() * 20));
      insertPayment.run({
        payment_id: dupId,
        customer_id: custId,
        order_id: orderId,
        amount,
        method: randomChoice(METHODS.filter((m) => m !== "UPI")),
        initial_status: "PENDING",
        current_status: "SUCCESS",
        created_at: dupTime,
        updated_at: dupTime,
      });
      recordAudit({ paymentId: dupId, eventType: "PAYMENT_RECEIVED", actor: "Payment Gateway", newState: "SUCCESS", timestamp: dupTime });
    }
  }

  return { message: "Seed complete" };
}

export function seedAndDetect() {
  seedDatabase();
  const dupResult = runDuplicateDetection();
  const mismatches = runOrderPaymentMismatchDetection();
  return { dupResult, mismatches };
}
