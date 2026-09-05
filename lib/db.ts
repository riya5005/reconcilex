import Database from "better-sqlite3";
import path from "path";
import fs from "fs";

const DATA_DIR = path.join(process.cwd(), "data");
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

const DB_PATH = path.join(DATA_DIR, "reconcilex.db");

declare global {
  var __reconcilex_db__: Database.Database | undefined;
}

function createConnection(): Database.Database {
  const db = new Database(DB_PATH);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  initSchema(db);
  return db;
}

function initSchema(db: Database.Database) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS customers (
      customer_id TEXT PRIMARY KEY,
      name TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS orders (
      order_id TEXT PRIMARY KEY,
      customer_id TEXT NOT NULL,
      service TEXT NOT NULL,
      amount REAL NOT NULL,
      status TEXT NOT NULL,
      FOREIGN KEY (customer_id) REFERENCES customers(customer_id)
    );

    CREATE TABLE IF NOT EXISTS payments (
      payment_id TEXT PRIMARY KEY,
      customer_id TEXT NOT NULL,
      order_id TEXT,
      amount REAL NOT NULL,
      method TEXT NOT NULL,
      initial_status TEXT NOT NULL,
      current_status TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (customer_id) REFERENCES customers(customer_id),
      FOREIGN KEY (order_id) REFERENCES orders(order_id)
    );

    CREATE TABLE IF NOT EXISTS resolution_cases (
      case_id TEXT PRIMARY KEY,
      case_type TEXT NOT NULL,
      customer_id TEXT NOT NULL,
      order_id TEXT,
      payment_ids TEXT NOT NULL,
      confidence INTEGER NOT NULL,
      confidence_band TEXT NOT NULL,
      evidence TEXT NOT NULL,
      recommendation TEXT,
      recommended_amount REAL,
      status TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS audit_events (
      event_id TEXT PRIMARY KEY,
      case_id TEXT,
      payment_id TEXT,
      event_type TEXT NOT NULL,
      actor TEXT NOT NULL,
      timestamp TEXT NOT NULL,
      reason TEXT,
      previous_state TEXT,
      new_state TEXT,
      action TEXT,
      outcome TEXT,
      metadata TEXT
    );

    CREATE TABLE IF NOT EXISTS ai_investigations (
      case_id TEXT PRIMARY KEY,
      status TEXT NOT NULL,
      summary TEXT,
      root_cause TEXT,
      reasoning TEXT,
      recommended_action TEXT,
      payment_to_refund TEXT,
      risk_level TEXT,
      requires_human_approval INTEGER,
      model TEXT,
      error TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (case_id) REFERENCES resolution_cases(case_id)
    );

    -- Razorpay Test Mode order tracking (one row per Razorpay order created).
    CREATE TABLE IF NOT EXISTS razorpay_orders (
      razorpay_order_id TEXT PRIMARY KEY,
      internal_order_id TEXT,
      amount REAL NOT NULL,
      currency TEXT NOT NULL DEFAULT 'INR',
      receipt TEXT,
      status TEXT NOT NULL DEFAULT 'CREATED',
      created_at TEXT NOT NULL
    );

    -- Idempotency ledger for both webhooks and client-side payment confirmations.
    -- Nothing that reaches the payments table skips this table first.
    CREATE TABLE IF NOT EXISTS webhook_events (
      event_id TEXT PRIMARY KEY,
      event_type TEXT NOT NULL,
      payload_hash TEXT,
      received_at TEXT NOT NULL,
      processed_at TEXT,
      status TEXT NOT NULL DEFAULT 'RECEIVED'
    );

    -- Refunds are tracked separately from the simulated instant-refund path so a
    -- real Razorpay Test Mode refund (which is asynchronous) can be in PROCESSING
    -- state without ReconcileX ever claiming REFUND_COMPLETED prematurely.
    CREATE TABLE IF NOT EXISTS refunds (
      refund_id TEXT PRIMARY KEY,
      case_id TEXT NOT NULL,
      payment_id TEXT NOT NULL,
      razorpay_refund_id TEXT,
      amount REAL NOT NULL,
      source TEXT NOT NULL DEFAULT 'SIMULATION',
      status TEXT NOT NULL DEFAULT 'PROCESSING',
      error TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (case_id) REFERENCES resolution_cases(case_id)
    );

    CREATE INDEX IF NOT EXISTS idx_payments_customer ON payments(customer_id);
    CREATE INDEX IF NOT EXISTS idx_payments_order ON payments(order_id);
    CREATE INDEX IF NOT EXISTS idx_cases_status ON resolution_cases(status);
    CREATE INDEX IF NOT EXISTS idx_audit_case ON audit_events(case_id);
    CREATE INDEX IF NOT EXISTS idx_refunds_case ON refunds(case_id);
  `);

  migrateColumns(db);
}


function migrateColumns(db: Database.Database) {
  const columns = db.prepare(`PRAGMA table_info(payments)`).all() as { name: string }[];
  const has = (name: string) => columns.some((c) => c.name === name);

  if (!has("source")) {
    db.exec(`ALTER TABLE payments ADD COLUMN source TEXT NOT NULL DEFAULT 'SIMULATION'`);
  }
  if (!has("razorpay_payment_id")) {
    db.exec(`ALTER TABLE payments ADD COLUMN razorpay_payment_id TEXT`);
  }
  if (!has("razorpay_order_id")) {
    db.exec(`ALTER TABLE payments ADD COLUMN razorpay_order_id TEXT`);
  }
}

export function getDb(): Database.Database {
  if (!global.__reconcilex_db__) {
    global.__reconcilex_db__ = createConnection();
  }
  return global.__reconcilex_db__;
}

export function resetDatabase() {
  const db = getDb();
  db.exec(`
    DELETE FROM refunds;
    DELETE FROM webhook_events;
    DELETE FROM razorpay_orders;
    DELETE FROM ai_investigations;
    DELETE FROM audit_events;
    DELETE FROM resolution_cases;
    DELETE FROM payments;
    DELETE FROM orders;
    DELETE FROM customers;
  `);
}
