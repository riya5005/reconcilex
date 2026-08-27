# ReconcileX — Application

This folder contains the main ReconcileX application.

## What it does

ReconcileX investigates payment incidents and helps decide whether a payment should be refunded, manually reviewed, or left unchanged.

The application checks:

- Customer
- Order
- Payment amount
- Payment method
- Payment status
- Payment timing
- Refund history
- Settlement status

It then creates an evidence-based confidence score and an investigation case.

## Main flow

```text
Payment
   ↓
Detection
   ↓
Evidence
   ↓
AI Investigation
   ↓
Decision
   ↓
Human Approval
   ↓
Resolution
   ↓
Ledger Reconciliation
   ↓
Audit Trail
