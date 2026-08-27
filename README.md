# ReconcileX

### AI-assisted payment reconciliation and resolution

ReconcileX helps payment operations teams find and resolve payment issues such as duplicate payments and failed-payment retries.

## The problem

Sometimes a customer can be charged twice for the same order.

For example:

- Customer pays ₹2,500 by Card
- Payment appears pending
- Customer pays again using UPI
- Both payments eventually succeed

Now the merchant has collected ₹5,000 for a ₹2,500 order.

The difficult part is deciding whether the second payment is actually a duplicate and what should be done.

## What ReconcileX does

ReconcileX:

1. Detects suspicious payment patterns
2. Collects evidence from payment and order records
3. Calculates a confidence score
4. Uses AI to explain what happened
5. Recommends an action
6. Sends uncertain cases for manual review
7. Records the complete audit trail
8. Reconciles the ledger after resolution

### Example

```text
Expected     ₹2,500
Collected    ₹5,000
Difference   ₹2,500

Confidence   75%
Decision     Manual Review
