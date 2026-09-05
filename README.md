# ReconcileX

### AI-assisted payment reconciliation and resolution

![Build](https://github.com/riya5005/reconcilex/actions/workflows/build.yml/badge.svg)

![License](https://img.shields.io/github/license/riya5005/reconcilex)
![Razorpay Test Mode](https://img.shields.io/badge/Razorpay-Test%20Mode-3395FF)

ReconcileX is a payment operations tool built around a simple problem:

**What happens when a customer pays twice for the same order?**

Sometimes a payment looks stuck, so the customer tries again with another payment method. Later, both payments succeed.

The problem isn't just detecting two transactions. The real question is:

**What actually happened, and should one of the payments be refunded?**

---

## The Problem

Imagine an order worth ₹2,500.

The customer first pays using a card. The payment appears to be pending, so they try again using UPI.

Later, both payments become successful.

```text
Order amount       ₹2,500

Payment 1          ₹2,500   Card
Payment 2          ₹2,500   UPI

Total collected    ₹5,000
Expected           ₹2,500

Difference         +₹2,500
```

Someone from the payment operations team now has to investigate the transactions and decide what should happen.

Doing this manually for a large number of payment incidents can take time.

That's the problem ReconcileX tries to simplify.

---

# What ReconcileX Does

ReconcileX takes payment and order information and turns it into an investigation case.

It checks things such as:

- Same customer
- Same order
- Same payment amount
- Payment method
- Payment status
- Payment status history
- Time between payments
- Refund history
- Final payment state
- Ledger difference

It then calculates a confidence score and creates a resolution recommendation.

The overall flow is:

```text
Payment Data
     ↓
Duplicate Detection
     ↓
Evidence Collection
     ↓
Confidence Score
     ↓
AI Investigation
     ↓
Resolution Recommendation
     ↓
Human Approval
     ↓
Resolution
     ↓
Ledger Reconciliation
     ↓
Audit Trail
```

---

# Why AI?

The AI is not used to directly control money.

The deterministic part of the system first collects the payment facts and calculates the evidence.

The AI receives that structured evidence and helps explain the incident.

For example:

```text
Two successful payments of ₹2,500 were found
for the same order within 13 minutes.

The first payment was already successful before
the second payment was made.

Recommendation:
Send the case for manual review.
```

So the basic idea is:

**The backend provides the facts. AI helps explain them.**

If the AI service is unavailable, the core investigation can still work using the deterministic logic.

---

# Three Cases We Handle

## 1. High-Confidence Duplicate

Example:

```text
Payment 1    ₹2,500    Card    Pending → Success
Payment 2    ₹2,500    UPI     Success

Same customer
Same order
Same amount
Short time gap
Both payments successful
```

The evidence strongly suggests that the customer was charged twice.

### Result

```text
Refund Recommended
```

A human still needs to approve the action.

---

## 2. Ambiguous Payment

Example:

```text
Payment 1    ₹2,500    Card          Success
Payment 2    ₹2,500    Net Banking   Success

Same customer
Same order
13 minutes apart
```

Here, the first payment was already successful before the second payment.

We should not automatically assume that the second payment was accidental.

### Result

```text
Manual Review
```

This is important because an incorrect refund can create another financial problem.

---

## 3. Legitimate Retry

Example:

```text
Payment 1    ₹2,500    Card    Failed
Payment 2    ₹2,500    UPI     Success
```

Only one payment succeeded.

This is a normal retry rather than a duplicate successful payment.

### Result

```text
No Refund
```

---

# Evidence-Based Detection

ReconcileX does not depend only on an AI response to decide whether something looks suspicious.

The duplicate confidence score is calculated using payment evidence.

Example:

```text
Same customer                 +20
Same amount                   +20
Same order                    +20
Close transaction time        +15
Different payment methods     +05
Both payments settled         +10
                               ---
Total                         90%
```

The operator can see why the case was flagged instead of simply seeing:

```text
Duplicate: YES
```

The scoring rules can also be adjusted as the system evolves.

---

# Resolution Cases

When a suspicious payment is found, ReconcileX creates a resolution case.

Example:

```text
Case              RC-10212
Customer          C1024
Order             ORD_9044

Expected          ₹2,500
Collected         ₹5,000
Difference        +₹2,500

Confidence        90%
Risk              Medium

Recommendation    Refund PAY149
```

The operator can then choose:

```text
Approve Resolution
Reject
Escalate to Manual Review
```

The decision is recorded as part of the case.

---

# Human Approval

One of the important design decisions in ReconcileX is keeping AI away from direct financial actions.

The AI should not be able to say:

```text
Refund ₹2,500
```

and immediately move money.

Instead:

```text
AI Investigation
       ↓
Recommendation
       ↓
Backend Validation
       ↓
Human Approval
       ↓
Resolution
```

The payment ID and refund amount used by the resolution flow come from the backend payment records.

For the prototype, the refund action is simulated.

**No real money is moved.**

---

# Ledger Reconciliation

The ledger shows the financial difference before and after a resolution.

### Before Resolution

```text
Expected       ₹2,500
Collected      ₹5,000
Difference     +₹2,500

Status         UNRECONCILED
```

### After Resolving the Duplicate

```text
Expected       ₹2,500
Collected      ₹2,500
Difference     ₹0

Status         RECONCILED
```

This gives the operations team a simple view of whether the incident has actually been resolved.

---

# Audit Trail

Every important action is recorded.

For example:

```text
Duplicate Detection Triggered
          ↓
Investigation Started
          ↓
Order Retrieved
          ↓
Payments Compared
          ↓
Evidence Calculated
          ↓
AI Investigation
          ↓
Recommendation Created
          ↓
Manual Review
          ↓
Resolution
          ↓
Ledger Reconciled
```

The purpose is simple:

If someone asks:

**"Why did the system recommend this?"**

the operator can go back through the case and see the evidence and actions that led to the decision.

---

# Example Investigation

One of the demo cases is:

```text
Order:        ORD_9044
Customer:     C1024
Amount:       ₹2,500

Payment 1:    PAY148
Method:       Debit Card
Status:       SUCCESS
Time:         01:11 AM

Payment 2:    PAY149
Method:       Net Banking
Status:       PENDING → SUCCESS
Time:         01:24 AM
```

The system finds:

```text
Same customer             ✓
Same order                ✓
Same amount               ✓
13 minute gap             ✓
Different methods         ✓
Both settled              ✓
No previous refund        ✓
```

The ledger shows:

```text
Expected:     ₹2,500
Collected:    ₹5,000
Difference:   +₹2,500
```

The system creates a case and recommends investigating the second payment.

The operator can see the payment information, evidence, AI explanation, recommendation and audit history from the incident page.

---

# AI Investigation and Fallback

The AI layer is an additional investigation layer.

It receives structured evidence such as:

```text
Customer
Order
Payment IDs
Amounts
Payment methods
Payment states
Timestamps
Refund history
Confidence score
```

It does not have unrestricted database access.

If the AI provider is unavailable, the deterministic evidence and confidence score can still be displayed.

For example:

```text
AI Investigation
Unavailable

Reason:
AI provider could not be reached.

Fallback:
Deterministic evidence and confidence score
are still available for manual review.
```

The application should never claim that an AI investigation happened when the AI provider actually failed.

---

# Architecture

```text
                    ┌───────────────────┐
                    │   Payment Data    │
                    └─────────┬─────────┘
                              │
                              ↓
                    ┌───────────────────┐
                    │ Detection Engine   │
                    └─────────┬─────────┘
                              │
                              ↓
                    ┌───────────────────┐
                    │ Evidence + Score   │
                    └─────────┬─────────┘
                              │
                              ↓
                    ┌───────────────────┐
                    │  AI Investigation  │
                    └─────────┬─────────┘
                              │
                              ↓
                    ┌───────────────────┐
                    │  Resolution Case   │
                    └─────────┬─────────┘
                              │
                              ↓
                    ┌───────────────────┐
                    │  Human Approval    │
                    └─────────┬─────────┘
                              │
                              ↓
                    ┌───────────────────┐
                    │     Resolution     │
                    └─────────┬─────────┘
                              │
                    ┌─────────┴─────────┐
                    ↓                   ↓
             Ledger Update        Audit Trail
```

---

# Tech Stack

### Frontend

- Next.js
- React
- TypeScript
- Tailwind CSS

### Backend

- Next.js server-side APIs
- Payment reconciliation logic
- Resolution workflow
- Audit logging

### Data

The prototype works with:

- Customer records
- Order records
- Payment records
- Incident records
- Refund records
- Audit events

### AI

- LLM-based investigation
- Structured evidence as input
- AI-generated explanation
- AI-generated recommendation
- Deterministic fallback when AI is unavailable

---

# Project Structure

```text
reconcilex-razorpay-audited/
│
├── README.md
│
└── reconcilex/
    │
    ├── README.md
    ├── app/
    ├── components/
    ├── lib/
    ├── public/
    ├── package.json
    └── ...
```

The main application is inside the `reconcilex` directory.

---

# Running Locally

Go into the application directory:

```bash
cd reconcilex
```

Install dependencies:

```bash
npm install
```

Create your local environment file:

```bash
cp .env.example .env.local
```

Add the required environment variables.

Start the application:

```bash
npm run dev
```

Then open:

```text
http://localhost:3000
```

On Windows, `.env.local` can also be created manually from `.env.example`.

---

# Environment Variables

The required variables are listed in:

```text
.env.example
```

Do not commit:

```text
.env
.env.local
```

or any API keys and credentials.

---

# Demo

The application includes simulated payment scenarios so the complete workflow can be demonstrated without using real financial data.

The demo covers:

```text
Duplicate Payment
        ↓
Investigation
        ↓
Evidence
        ↓
AI Explanation
        ↓
Recommendation
        ↓
Human Decision
        ↓
Resolution
        ↓
Audit Trail
```

---

# What We Wanted to Demonstrate

The main idea behind ReconcileX is not simply:

**"Use AI to find duplicate payments."**

It is:

**"Use AI to help payment operations teams investigate exceptions while keeping financial decisions explainable and controlled."**

The system separates:

```text
Financial Facts
      +
Deterministic Rules
      +
AI Investigation
      +
Human Approval
```

This makes the final decision easier to understand and audit.

---

# Why This Matters

A payment issue usually starts with a simple question:

**"Why does this payment look wrong?"**

For a payment operations team, answering that question may require checking several pieces of information.

ReconcileX brings those pieces together into one investigation.

Instead of just showing:

```text
Duplicate Payment Detected
```

it tries to show:

```text
What happened?
      ↓
What evidence do we have?
      ↓
How confident are we?
      ↓
What does the AI think happened?
      ↓
What should happen next?
      ↓
Who approved it?
      ↓
Is the ledger reconciled?
```

That is the problem we are trying to solve.

---

# Limitations

This is a hackathon prototype.

The payment, refund and customer data used in the demo are simulated.

The application is not connected to real customer accounts or real banking transactions.

A production implementation would require additional work around:

- Authentication
- Authorization
- Security
- Compliance
- Monitoring
- Rate limiting
- Production payment integrations
- Real refund APIs
- Failure handling
- Data privacy

---

# Future Improvements

If this were taken further, some areas we would explore are:

- More payment failure and retry patterns
- Better duplicate detection using historical data
- Merchant-level reconciliation dashboards
- Automated notifications for unresolved cases
- More detailed operational metrics
- Role-based access for payment operations teams
- Integration with real payment and refund systems
- Feedback from operators to improve investigation quality

---

# Final Thought

The idea behind ReconcileX is simple:

**When money moves twice, don't just flag it. Investigate it.**

ReconcileX tries to turn a suspicious payment into a structured case with:

- Evidence
- Confidence
- Explanation
- Recommendation
- Human approval
- Resolution
- Audit trail

The goal is to make payment investigation faster without removing human control from financial decisions.

---

### Note

ReconcileX is a hackathon prototype. All payment and refund operations shown in the demo are simulated and no real customer money is moved.
