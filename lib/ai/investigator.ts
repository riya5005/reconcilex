import { EvidenceItem, Payment, Order, RiskLevel } from "@/lib/types";

/**
 * ReconcileX AI Investigation Layer
 * ----------------------------------
 * IMPORTANT PRODUCT PRINCIPLE: the LLM never determines financial facts.
 *
 * Everything in `InvestigationInput` is read from the database by the
 * deterministic detection engine (lib/detection.ts) BEFORE this module is
 * ever called. The LLM only receives that structured evidence — it cannot
 * see raw tables, cannot invent a payment ID or amount, and its output is
 * validated against the case's actual payment_ids/amount before anything
 * is shown to an operator. Refund amounts and payment IDs used for the
 * actual approval flow (lib/caseActions.ts) always come from the
 * deterministic engine, never from this module's output.
 */

export interface InvestigationInput {
  case_id: string;
  case_type: string;
  customer_id: string;
  order_id: string | null;
  expected_amount: number | null;
  payments: Pick<
    Payment,
    "payment_id" | "amount" | "method" | "initial_status" | "current_status" | "created_at" | "updated_at"
  >[];
  order: Pick<Order, "order_id" | "service" | "amount" | "status"> | null;
  deterministic_confidence: number;
  deterministic_band: string;
  evidence: EvidenceItem[];
  deterministic_recommendation: string | null;
  deterministic_recommended_amount: number | null;
}

export interface InvestigationResult {
  status: "COMPLETED" | "UNAVAILABLE";
  summary: string | null;
  root_cause: string | null;
  reasoning: string | null;
  recommended_action: string | null;
  payment_to_refund: string | null;
  risk_level: RiskLevel | null;
  requires_human_approval: boolean;
  model: string | null;
  error: string | null;
}

// Default model served via Hugging Face's Inference Providers router (OpenAI-compatible
// /v1/chat/completions). Override with HF_MODEL if you want a different free-tier model.
const DEFAULT_MODEL = "meta-llama/Llama-3.3-70B-Instruct";
const HF_ROUTER_URL = "https://router.huggingface.co/v1/chat/completions";
const VALID_RISK: RiskLevel[] = ["LOW", "MEDIUM", "HIGH"];

function buildSystemPrompt() {
  return `You are the AI investigation layer inside ReconcileX, a payment operations control center.

You are given ONLY deterministic evidence that has already been established by a rule-based
reconciliation engine reading directly from the payments database. You must never invent,
guess, or restate a different transaction fact (amounts, payment IDs, timestamps, statuses)
than what is provided to you — treat every field in the input as ground truth.

Your job is purely interpretive:
- explain in plain operational language what most likely happened
- identify the likely root cause
- summarize the incident for a payments-ops reviewer
- recommend the next operational action
- assign a risk level (LOW, MEDIUM, or HIGH) for taking that action
- state whether human approval is required before any money moves (it almost always is for
  refunds — only say false if you are recommending no financial action at all)

If the evidence does not support a duplicate/anomaly (e.g. one payment genuinely failed, or the
payments are for different orders), say so plainly and do NOT recommend a refund.

Respond with ONLY a single JSON object, no markdown fences, no prose outside the JSON, matching
exactly this shape:
{
  "summary": string,
  "root_cause": string,
  "reasoning": string,
  "recommended_action": string,
  "payment_to_refund": string | null,
  "risk_level": "LOW" | "MEDIUM" | "HIGH",
  "requires_human_approval": boolean
}

"payment_to_refund" must be exactly one of the payment_id values given in the input, or null if
you are not recommending a refund.`;
}

function buildUserPrompt(input: InvestigationInput) {
  return JSON.stringify(input, null, 2);
}

function unavailable(error: string): InvestigationResult {
  return {
    status: "UNAVAILABLE",
    summary: null,
    root_cause: null,
    reasoning: null,
    recommended_action: null,
    payment_to_refund: null,
    risk_level: null,
    requires_human_approval: true,
    model: null,
    error,
  };
}

function extractJson(text: string): unknown {
  // Models occasionally wrap JSON in fences despite instructions — strip defensively.
  const cleaned = text.replace(/```json/gi, "").replace(/```/g, "").trim();
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  if (start === -1 || end === -1 || end < start) {
    throw new Error("No JSON object found in model response");
  }
  return JSON.parse(cleaned.slice(start, end + 1));
}

function validate(raw: unknown, input: InvestigationInput, model: string): InvestigationResult {
  if (typeof raw !== "object" || raw === null) {
    throw new Error("Model response was not a JSON object");
  }
  const r = raw as Record<string, unknown>;

  const summary = typeof r.summary === "string" ? r.summary : null;
  const root_cause = typeof r.root_cause === "string" ? r.root_cause : null;
  const reasoning = typeof r.reasoning === "string" ? r.reasoning : null;
  const recommended_action = typeof r.recommended_action === "string" ? r.recommended_action : null;

  if (!summary || !root_cause || !recommended_action) {
    throw new Error("Model response missing required fields");
  }

  let risk_level: RiskLevel | null = null;
  if (typeof r.risk_level === "string" && VALID_RISK.includes(r.risk_level as RiskLevel)) {
    risk_level = r.risk_level as RiskLevel;
  } else {
    risk_level = "MEDIUM"; // safe default if the model omits/garbles this field
  }

  // GUARDRAIL: payment_to_refund must reference an actual payment on this case.
  // The LLM cannot introduce a payment ID that doesn't exist in the evidence we gave it.
  let payment_to_refund: string | null = null;
  if (typeof r.payment_to_refund === "string") {
    const known = input.payments.some((p) => p.payment_id === r.payment_to_refund);
    payment_to_refund = known ? r.payment_to_refund : input.deterministic_recommendation
      ? input.deterministic_recommendation.replace("Refund ", "").trim()
      : null;
  }

  const requires_human_approval =
    typeof r.requires_human_approval === "boolean" ? r.requires_human_approval : true;

  return {
    status: "COMPLETED",
    summary,
    root_cause,
    reasoning,
    recommended_action,
    payment_to_refund,
    risk_level,
    requires_human_approval,
    model,
    error: null,
  };
}

/**
 * Run the AI investigation for a case. Never throws — on any failure
 * (missing token, network error, malformed response) it returns a
 * status: "UNAVAILABLE" result so the caller can fall back to the
 * deterministic evidence alone.
 *
 * Uses Hugging Face's Inference Providers router, which exposes an
 * OpenAI-compatible /v1/chat/completions endpoint backed by a free-tier
 * token (huggingface.co/settings/tokens) — no billing required to start.
 */
export async function investigate(input: InvestigationInput): Promise<InvestigationResult> {
  const token = process.env.HF_TOKEN;
  if (!token) {
    return unavailable("HF_TOKEN is not configured on the server.");
  }
  const model = process.env.HF_MODEL || DEFAULT_MODEL;

  try {
    const res = await fetch(HF_ROUTER_URL, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        model,
        max_tokens: 700,
        messages: [
          { role: "system", content: buildSystemPrompt() },
          { role: "user", content: buildUserPrompt(input) },
        ],
      }),
    });

    if (!res.ok) {
      const body = await res.text().catch(() => "");
      return unavailable(`AI service returned ${res.status}: ${body.slice(0, 300)}`);
    }

    const data = await res.json();
    const content = data?.choices?.[0]?.message?.content;
    if (typeof content !== "string" || !content.trim()) {
      return unavailable("AI service response contained no text content.");
    }

    const parsed = extractJson(content);
    return validate(parsed, input, model);
  } catch (err) {
    return unavailable(err instanceof Error ? err.message : "Unknown AI investigation error");
  }
}
