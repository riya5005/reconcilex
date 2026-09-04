export type PaymentStatus = "PENDING" | "SUCCESS" | "FAILED" | "REFUNDED";
export type PaymentMethod = "Credit Card" | "Debit Card" | "UPI" | "Net Banking" | "Wallet";

export interface Customer {
  customer_id: string;
  name: string;
}

export interface Order {
  order_id: string;
  customer_id: string;
  service: string;
  amount: number;
  status: string;
}

export type PaymentSource = "SIMULATION" | "RAZORPAY_TEST";

export interface Payment {
  payment_id: string;
  customer_id: string;
  order_id: string | null;
  amount: number;
  method: PaymentMethod;
  initial_status: PaymentStatus;
  current_status: PaymentStatus;
  created_at: string;
  updated_at: string;
  source: PaymentSource;
  razorpay_payment_id: string | null;
  razorpay_order_id: string | null;
}

export type CaseType = "DUPLICATE_PAYMENT" | "ORDER_PAYMENT_MISMATCH" | "STUCK_REFUND";

export type ConfidenceBand = "HIGH" | "MEDIUM" | "LOW";

export type CaseStatus =
  | "DETECTED"
  | "INVESTIGATING"
  | "RECOMMENDATION_CREATED"
  | "AWAITING_APPROVAL"
  | "APPROVED"
  | "REFUND_INITIATED"
  | "REFUND_COMPLETED"
  | "RESOLVED"
  | "REJECTED"
  | "MANUAL_REVIEW";

export interface EvidenceItem {
  label: string;
  detail: string;
  points: number;
  matched: boolean;
}

export interface ResolutionCase {
  case_id: string;
  case_type: CaseType;
  customer_id: string;
  order_id: string | null;
  payment_ids: string; // JSON array string
  confidence: number;
  confidence_band: ConfidenceBand;
  evidence: string; // JSON EvidenceItem[]
  recommendation: string | null;
  recommended_amount: number | null;
  status: CaseStatus;
  created_at: string;
  updated_at: string;
}

export type RiskLevel = "LOW" | "MEDIUM" | "HIGH";
export type InvestigationStatus = "COMPLETED" | "UNAVAILABLE";

export interface AIInvestigation {
  case_id: string;
  status: InvestigationStatus;
  summary: string | null;
  root_cause: string | null;
  reasoning: string | null;
  recommended_action: string | null;
  payment_to_refund: string | null;
  risk_level: RiskLevel | null;
  requires_human_approval: number | null; // stored as 0/1
  model: string | null;
  error: string | null;
  created_at: string;
  updated_at: string;
}

export type RefundStatus = "PROCESSING" | "COMPLETED" | "FAILED";

export interface RefundRecord {
  refund_id: string;
  case_id: string;
  payment_id: string;
  razorpay_refund_id: string | null;
  amount: number;
  source: PaymentSource;
  status: RefundStatus;
  error: string | null;
  created_at: string;
  updated_at: string;
}

export interface RazorpayOrderRecord {
  razorpay_order_id: string;
  internal_order_id: string | null;
  amount: number;
  currency: string;
  receipt: string | null;
  status: string;
  created_at: string;
}

export interface AuditEvent {
  event_id: string;
  case_id: string | null;
  payment_id: string | null;
  event_type: string;
  actor: string;
  timestamp: string;
  reason: string | null;
  previous_state: string | null;
  new_state: string | null;
  action: string | null;
  outcome: string | null;
  metadata: string | null; // JSON string
}
