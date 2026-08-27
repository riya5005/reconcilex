# ReconcileX

**AI-Powered Payment Reconciliation & Resolution Agent**

## Problem

Payment gateways don't always report status consistently or instantly. A card
payment can sit in `PENDING` for minutes while the customer, assuming it
failed, pays again by another method. When the first payment later settles,
the merchant has two successful payments for one purchase — and reconciling
that mess today means someone manually cross-referencing transaction logs.

## Solution

ReconcileX is **not** a payment gateway and does not replace one. It's an AI
decision and resolution layer that sits on top of your existing payment
infrastructure: it watches payment/order events, investigates anomalies using
multiple contextual signals (not just a matching order ID), explains its
reasoning in plain terms, and drives the anomaly through a controlled,
auditable resolution workflow — with a human always in the loop before any
refund happens.

Payments can enter ReconcileX two ways, and both flow through the **same**
detection engine, ledger, and audit trail:

- **Simulation Mode** — seeded/synthetic payments for demoing detection
  scenarios on demand, with instantly-simulated refunds. No gateway involved.
- **Razorpay Test Mode** — real Razorpay Test Mode payments (real Checkout,
  real webhooks, real Test Mode refunds) — see "Razorpay Test Mode
  integration" below. No real money moves in either mode.

## Architecture

```
                 RECONCILEX AGENT
                       │
       ┌───────────────┼───────────────┐
       ↓               ↓               ↓
  Duplicate        Order/Payment    Stuck Refund
   Payment           Mismatch        (seeded)
       │               │               │
       └───────────────┼───────────────┘
                       ↓
          DETERMINISTIC RECONCILIATION ENGINE
          (lib/detection.ts — multi-signal scoring,
           grounded entirely in DB records)
                       ↓
                Evidence + Confidence
                       ↓
                Resolution Case
                       ↓
              Recommendation (if HIGH)
                       ↓
        AI INVESTIGATION LAYER (optional, additive)
        (lib/ai/investigator.ts — explains the case,
         never determines the facts)
                       ↓
                Human Approval
                       ↓
     Refund — SIMULATED (instant) or RAZORPAY TEST MODE
     (real Refund API call, async; see below) — idempotent
                       ↓
                 Audit Trail
```

**Stack:** Next.js 16 (App Router, API routes) + SQLite (`better-sqlite3`) +
React. No Razorpay SDK dependency — the integration calls Razorpay's REST API
directly with `fetch`. No external services required except the optional
Hugging Face API call for the investigation layer and the optional Razorpay
Test Mode credentials.

## AI architecture — why deterministic + AI

ReconcileX deliberately uses **two layers** instead of asking an LLM to decide
what happened:

1. **Deterministic reconciliation engine** (`lib/detection.ts`) establishes
   every fact — customer, order, payment IDs, amounts, methods, timestamps,
   statuses, and the confidence score — by reading the SQLite tables
   directly. This is the only layer allowed to produce numbers that a refund
   is based on.
2. **AI investigation layer** (`lib/ai/investigator.ts`) receives *only* the
   structured evidence the deterministic engine already produced (see the
   `InvestigationInput` shape in that file) and returns a plain-English
   summary, root cause, recommended action, and a risk level. It calls
   Hugging Face's Inference Providers router (an OpenAI-compatible
   `/v1/chat/completions` endpoint, default model
   `meta-llama/Llama-3.3-70B-Instruct`, overridable via `HF_MODEL`) using a
   free-tier token — no billing required. It is invoked from `POST
   /api/cases/:id/investigate`, which also logs each real backend step
   (retrieved order, compared amounts, compared timestamps, checked refund
   history, etc.) to the audit trail as "agent activity" — these are actual
   queries against the database, not a scripted animation.

**Guardrails enforced in code, not just in the prompt:**

- The AI is never given raw table/query access — only the JSON evidence
  object built by the route handler.
- Its `payment_to_refund` field is validated against the case's actual
  `payment_ids` before being shown anywhere; an unrecognized value is
  discarded and replaced with the deterministic recommendation.
- The refund amount and payment ID actually used by `POST
  /api/cases/:id/approve` always come from `resolution_cases.recommendation`
  / `recommended_amount` — columns written by the deterministic engine only.
  The AI's output is stored separately in the `ai_investigations` table and
  is never read by the approval code path.
- If `HF_TOKEN` is missing, the API call fails, or the model's response
  doesn't parse as valid JSON with the required fields, the investigation is
  marked `status: "UNAVAILABLE"` and the UI falls back to the deterministic
  evidence card — nothing in the resolution workflow depends on the AI layer
  succeeding.

## Razorpay Test Mode integration

ReconcileX includes a real integration with **Razorpay Test Mode only**
(never live keys). It is fully additive — Simulation Mode is unchanged and
still works with zero configuration.

**Flow:** `POST /api/razorpay/orders` creates a Razorpay Test order + a
linked ReconcileX business order → the browser opens real Razorpay Checkout
(`components/RazorpayCheckoutButton.tsx`) → on success, `POST
/api/razorpay/payments/confirm` verifies the Checkout signature
server-side and re-fetches the payment from Razorpay's API (never trusting
the browser's report of amount/status) → the payment is written into the
**same** `payments` table the detection engine already reads, tagged
`source: 'RAZORPAY_TEST'` → the same deterministic engine, AI layer, case
workflow, and ledger run exactly as they do for simulated payments. Try it
on the **Razorpay Test Demo** page (`/razorpay-demo`).

**Webhooks** (`POST /api/webhooks/razorpay`) handle `payment.captured`,
`payment.failed`, `refund.processed`, and `refund.failed`, with:
- Signature verification (HMAC-SHA256 over the raw body, `RAZORPAY_WEBHOOK_SECRET`) — a missing/invalid signature is rejected before any data is touched.
- Idempotency via a `webhook_events` table keyed on Razorpay's event ID (or a hash of the payload if that header is absent) — a redelivered event is a no-op, never a duplicate incident or duplicate refund completion.

**Refunds**: approving a case whose recommended payment has
`source: 'RAZORPAY_TEST'` calls Razorpay's real Test Mode Refund API
(`lib/caseActions.ts` → `approveCaseViaRazorpay`), with:
- The refund amount and payment ID coming **only** from
  `resolution_cases.recommendation` / `recommended_amount` — the same
  DB-only guarantee as the simulated path. The AI layer is never consulted.
- Razorpay's documented idempotency header, `X-Refund-Idempotency`, set to
  ReconcileX's own internal `refund_id` — a retried approval can never create
  a second refund on Razorpay's side, in addition to the app's own
  `refunds` table check.
- Refunds tracked as `PROCESSING` until confirmed `COMPLETED` (via webhook,
  or via the manual **Check Refund Status** button — see caveat below) —
  ReconcileX never claims a refund completed before Razorpay confirms it.

**⚠️ Local development caveat (read before testing):** Razorpay's servers
cannot reach `http://localhost:3000` — a webhook registered against a
localhost URL will simply never fire. To exercise the real webhook path
locally you need a tunnel (e.g. `ngrok http 3000`) and to register the
tunnel's `https://` URL + a webhook secret in the Razorpay Test Mode
dashboard. Without a tunnel, use:
- `POST /api/razorpay/payments/confirm` (automatic — this is what
  `RazorpayCheckoutButton` calls after Checkout succeeds) to get payments
  in, and
- the **Check Refund Status** button on a case's detail page to poll
  Razorpay directly for a refund's status, instead of waiting on a webhook
  that can't arrive.

Set `RAZORPAY_KEY_ID` / `RAZORPAY_KEY_SECRET` / `RAZORPAY_WEBHOOK_SECRET` in
`.env.local` (see `.env.example`) to enable this. Without them, the
`/razorpay-demo` page and the `IntegrationStatus` panel report "Not
configured" and every other part of the app (Simulation Mode) is unaffected.



- **Context-aware duplicate detection** — never relies solely on matching
  `order_id`. Evaluates customer identity, amount, service/order, payment
  method, transaction timing, initial vs. current status, and whether both
  payments actually settled.
- **Explainable confidence scoring** — a transparent, rule-based
  *Duplicate Confidence Score* (0-100), not an ML probability. Every point is
  shown with the evidence that earned it.
- **Three-tier workflow** — `HIGH` (>=90%) generates an automatic refund
  recommendation awaiting merchant approval; `MEDIUM` (60-89%) is routed to
  manual review with no automatic action; `LOW` (<60%) is left alone.
- **Human-in-the-loop approval** — ReconcileX never moves money on its own.
  Every high-confidence case requires an explicit **Approve Refund**,
  **Reject**, or **Send to Manual Review** decision.
- **Idempotent refund workflow** — approving an already-resolved case is a
  no-op; it can never trigger a second refund.
- **Immutable audit trail** — every detection, investigation step,
  recommendation, approval, and refund transition is logged with actor,
  reason, and before/after state.
- **Order/payment mismatch detection** and a **stuck refund** example,
  demonstrating the architecture is broader than one detector.
- **Operations dashboard** with the metrics a payments team actually cares
  about: potential duplicate amount, money recovered, cases awaiting
  approval, manual review queue.
- **Real Razorpay Test Mode integration** — actual Checkout, actual
  webhooks, actual Test Mode refunds — flowing through the exact same
  detection/case/ledger/audit pipeline as Simulation Mode. See "Razorpay
  Test Mode integration" above.
- **AI investigation layer** — on demand, per case, sends only the
  structured deterministic evidence to a free-tier LLM (via Hugging Face's
  Inference Providers router) and gets back a plain-English summary, root
  cause, recommended action, and risk level. Gracefully reports itself as
  unavailable (rather than failing the page) if no token is configured or
  the call fails.
- **Agent activity log** — the steps shown when you click "Investigate"
  (retrieve order, compare amounts, compare timestamps, check refund
  history, etc.) are real queries against the current case's data, each
  written to the audit trail as it runs.
- **Ledger / reconciliation view** on the case detail page — expected vs.
  currently collected amount for the order, with a live
  RECONCILED / UNRECONCILED status that updates the moment a refund
  completes.

## Demo

The flagship scenario, reproduced exactly in the seed data:

```
10:02 AM  PAY001  Rs.1,000  Credit Card  -> PENDING
10:11 AM  PAY002  Rs.1,000  UPI          -> SUCCESS   (customer retries, assuming PAY001 failed)
10:20 AM  PAY001  PENDING -> SUCCESS                  (delayed gateway confirmation)
```

The customer has now paid Rs.2,000 for a Rs.1,000 service. Open the
dashboard, click **Run Reconciliation**, and open the resulting case
(customer `C1024`, order `EXAM_7782`) to see:

1. The transaction comparison (PAY001 vs PAY002, side by side)
2. The full evidence breakdown behind the confidence score
3. The AI's recommendation: *Refund PAY002*
4. **Approve Refund** -> watch the case move through
   `APPROVED -> REFUND_INITIATED -> REFUND_COMPLETED -> RESOLVED`
5. The complete audit timeline, from `PAYMENT_RECEIVED` to `CASE_RESOLVED`

Other seeded cases demonstrate the system isn't trigger-happy:

| Case | Scenario | Outcome |
|---|---|---|
| C1024 / EXAM_7782 | Card pending -> UPI retry -> card settles | **HIGH** — refund recommended |
| C1031 / EXAM_9911 | Card genuinely `FAILED`, then UPI succeeds | **No case** — only one payment ever succeeded, so this isn't an overpayment |
| C1045 | Same customer, same amount, two *different* courses | **No case** — different orders |
| C1052 / ORD_6633 | Same order, same method, ~25 hours apart | **MEDIUM** — ambiguous, sent to manual review, no auto-recommendation |
| C1067 / ORD_7701 | Refund approved 3 days ago, never completed | Seeded `STUCK_REFUND` case for operator follow-up |
| C1078 / ORD_8809 | Order marked `COMPLETED` but only partially paid | `ORDER_PAYMENT_MISMATCH` case |

## Running it

```bash
npm install
cp .env.example .env.local   # optional — add a free HF_TOKEN to enable the AI layer
npm run dev
```

Open `http://localhost:3000`. The database (`data/reconcilex.db`, SQLite) is
seeded automatically on first run via `instrumentation.ts`. Use **Reset Demo
Data** on the dashboard (or `POST /api/reset`) to restore the seeded scenario
at any time during development. The reset endpoint refuses to run in
production unless `ALLOW_DEMO_RESET=true` is set.

The app runs fully without `HF_TOKEN` — detection, scoring, approval, refund
simulation, ledger, and audit trail are all deterministic and don't depend
on it. Without a token, clicking **Investigate** on a case will show the
agent's real backend activity and then report the AI summary
as unavailable, which is itself a demonstration of the fallback guardrail.

The app also runs fully without any `RAZORPAY_*` variables — Simulation Mode
is the default and needs no configuration. To try the real Razorpay Test
Mode path, set `RAZORPAY_KEY_ID` / `RAZORPAY_KEY_SECRET` (and
`RAZORPAY_WEBHOOK_SECRET` if you're testing webhooks via a tunnel) in
`.env.local`, then visit `/razorpay-demo`.

## API

| Method | Path | Purpose |
|---|---|---|
| GET | `/api/payments` | List all payment records |
| GET | `/api/cases` | List resolution cases (`?status=`, `?type=`) |
| GET | `/api/cases/:id` | Case detail — payments, order, customer, evidence, audit |
| POST | `/api/detect` | Run the detection engine over current payment data |
| POST | `/api/cases/:id/approve` | Approve the recommended refund (idempotent) |
| POST | `/api/cases/:id/reject` | Reject the recommendation |
| POST | `/api/cases/:id/manual-review` | Route the case to manual review |
| GET | `/api/cases/:id/audit` | Full audit trail for a case |
| POST | `/api/cases/:id/investigate` | Run agent activity + AI investigation for a case |
| GET | `/api/dashboard` | Aggregate operations metrics |
| POST | `/api/reset` | Restore the seeded demo scenario (dev only) |
| POST | `/api/razorpay/orders` | Create a Razorpay Test Mode order + linked business order |
| POST | `/api/razorpay/payments/confirm` | Server-side verified ingestion of a Checkout success |
| POST | `/api/webhooks/razorpay` | Razorpay webhook receiver (signature-verified, idempotent) |
| POST | `/api/razorpay/refunds/:id/status` | Manually poll Razorpay for a refund's current status |
| GET | `/api/integrations/status` | Which integrations (Razorpay/webhook/AI) are configured |

## Data model additions

`ai_investigations` (one row per case, upserted on each re-investigation):
`case_id`, `status` (`COMPLETED` / `UNAVAILABLE`), `summary`, `root_cause`,
`reasoning`, `recommended_action`, `payment_to_refund`, `risk_level`,
`requires_human_approval`, `model`, `error`, `created_at`, `updated_at`. This
table is purely explanatory — nothing in the approval/refund code path reads
from it.

`payments` (new columns): `source` (`SIMULATION` | `RAZORPAY_TEST`),
`razorpay_payment_id`, `razorpay_order_id` — added via a safe migration
(`PRAGMA table_info` check + `ALTER TABLE`) that doesn't touch existing rows.

`razorpay_orders`: `razorpay_order_id` (PK), `internal_order_id`, `amount`,
`currency`, `receipt`, `status`, `created_at` — one row per Razorpay Test
order created.

`webhook_events`: `event_id` (PK), `event_type`, `payload_hash`,
`received_at`, `processed_at`, `status` — the idempotency ledger described
above.

`refunds`: `refund_id` (PK), `case_id`, `payment_id`, `razorpay_refund_id`,
`amount`, `source`, `status` (`PROCESSING`/`COMPLETED`/`FAILED`), `error`,
`created_at`, `updated_at` — tracks both simulated and real refunds
separately from the case's own status, so a Razorpay refund can sit in
`PROCESSING` without the case falsely claiming completion.

## Confidence scoring

Each signal is grounded in the actual payment/order rows — nothing is
inferred or invented:

| Signal | Points |
|---|---|
| Same customer | +20 |
| Same amount | +20 |
| Same order/service | +20 |
| Close transaction time (<=30 min full credit, tapering to 24h) | up to +15 |
| Different payment methods | +5 |
| First payment initially pending/failed | +10 |
| Both payments ultimately succeeded | +10 |

A pair is only ever scored if **both payments currently show `SUCCESS`** —
if one attempt genuinely failed and was never charged, there is no
overpayment to resolve, so it's excluded before scoring rather than merely
down-weighted.

## Important disclaimers / limitations

- **No real money ever moves, in either mode.** Simulation Mode refunds are
  instant and entirely internal (no gateway call at all). Razorpay Test Mode
  refunds call Razorpay's real Refund API, but strictly against Razorpay
  **Test Mode** credentials (`rzp_test_...`) — Razorpay's own test
  environment, not a live account. `REFUND_INITIATED` and `REFUND_COMPLETED`
  reflect the actual state of the corresponding refund path in each case.
- The **Duplicate Confidence Score** is a transparent, rule-based score, not
  a machine-learning probability.
- The **AI investigation layer is explanatory, not authoritative** — it can
  be unavailable (no key, rate limit, network error, malformed response)
  without affecting detection, scoring, or the approval workflow at all.
- **Razorpay webhooks require a public URL.** They will not fire against
  `localhost` without a tunnel (e.g. `ngrok`) — see "Razorpay Test Mode
  integration" above for the practical local-dev workaround.
- ReconcileX is designed as a decision and resolution layer *on top of*
  payment infrastructure such as Razorpay — it does not claim to replace
  payment processing, and it never moves money without merchant approval.
- Analytics (precision/recall against labeled scenarios) and a dedicated
  per-scenario "Run Scenario" UI are not yet built; the seeded scenarios in
  the table above cover the same ground manually via **Run Reconciliation**.
- This integration has been reviewed for structure/type-correctness but has
  **not been exercised against a live Razorpay Test account** by the author
  of this README section — see the note on testing in the project history.
  Treat the Razorpay path as code-reviewed, not field-tested, until you've
  run it against your own Razorpay Test keys.

## Future scope

- A dedicated Analytics screen computing detection precision/recall against
  the labeled seed scenarios.
- A payment-event simulator UI for creating synthetic payments/status
  transitions from the browser instead of via seed data.
- Streaming the AI investigation response instead of waiting for the full
  JSON object.
