# Multi-Currency Audit & Roadmap (Phase 17)

Status of multi-currency support in StockBolt, the gaps, and the plan to finish
it safely. Written during the Phase-17 "safe foundation" work.

## 1. What already exists (schema was designed multi-currency)

| Area | State |
|------|-------|
| `companies.base_currency` | ✅ exists; onboarding sets it `= currency`. Backfilled for legacy rows in Phase 17. |
| Documents (`invoices`, `sales_quotes`, `vendor_bills`, …) | ✅ each has `currency` + `exchange_rate NUMERIC(12,6) DEFAULT 1.0`. |
| GL (`journal_entries`) | ✅ has `currency` + `exchange_rate`; debit/credit columns hold the posted amount. |
| `contacts.currency` | ✅ exists — the customer/supplier default currency (editable in the contact form). |
| CoA FX accounts | ✅ `4400` FX Gain, `6900` FX Loss seeded. |
| `confirm_payment` (customer receipts) | ✅ **FX-aware** — posts the rate difference between invoice rate and receipt rate to 4400/6900 (`phase12_01_fx_gain_loss`). |
| `exchange_rates` table + rate UI | ✅ **added in Phase 17** (this work) + `/settings/exchange-rates`. |

## 2. The gap (why it is NOT yet true multi-currency)

- **`confirm_invoice` / `confirm_vendor_bill` and ~13 other posting RPCs post
  `total_amount` directly to the GL and only *record* `exchange_rate` on the JE
  header — they never multiply by it.** So the GL receives the *transaction*
  amount. This is correct today only because every document's `currency` equals
  the base and `exchange_rate` is always `1.0`.
- A foreign-currency document would therefore post the wrong number (e.g. an
  invoice of `1000 INR` would hit AR as `1000` AED, not `≈ 45` AED).
- This makes the invoice/bill path **inconsistent** with the already-FX-aware
  `confirm_payment`, so partial enablement is unsafe.
- No UI lets a user actually pick a foreign document currency + rate yet.

**Posting RPCs that will need the conversion (≈15):** confirm_invoice,
void_and_edit_invoice, confirm_vendor_bill, edit_vendor_bill(_v2), confirm_grn,
confirm_payment (already done — reconcile), vendor_payment, apply_advance,
credit_note, debit_note, confirm_pos_sale, bank_transfer, expense, pdc,
inventory_adjustment.

## 3. Target posting model (Phase 2 — engine)

The GL is **always stated in base currency** (functional-currency principle used
by Zoho/Odoo/SAP/Dynamics):

```
base_amount = round(transaction_amount × exchange_rate, 2)   -- see convertToBase()
```

- Each posting RPC computes `base_amount` and posts THAT to debit/credit.
- The JE header keeps `currency` + `exchange_rate` for reference; sub-ledger
  rows store both the transaction amount and the base amount.
- On settlement at a different rate → realized FX gain/loss to 4400/6900.
  Receipts already do this; **mirror the same pattern to vendor payments**
  (decision locked). No period-end revaluation (unrealized) for now.
- Rounding: half-up to 2 dp at the line/posting level; the balanced-entry guard
  (`total_debit = total_credit`) must still hold after conversion.

## 4. Phase 1 (this work) — SAFE, no posting change

- `exchange_rates` table + RLS + `/settings/exchange-rates` manual entry.
- `base_currency` surfaced in Company Profile; backfill safety net.
- `convertToBase()` helper + tests (documents the conversion convention).
- **Editor currency selection + foreign posting is intentionally deferred to the
  engine phase** — enabling it before the RPCs convert would mis-state the GL.

## 5. Correctness test matrix (run in the engine phase)

Company base = AED unless noted. Verify after `confirm`:

| # | Scenario | Document | Expected GL (base) | Expected sub-ledger | Settlement |
|---|----------|----------|--------------------|---------------------|------------|
| 1 | UAE co, India customer | Invoice 1000 INR @ 0.045 | Dr AR 45 / Cr Sales 45 (+VAT) | AR shows 1000 INR **and** 45 AED | Receipt at 0.046 → FX gain to 4400 |
| 2 | UAE co, Germany supplier | Bill 1000 EUR @ 4.25 | Dr Inventory/Exp 4250 / Cr AP 4250 | AP shows 1000 EUR **and** 4250 AED | Payment at 4.20 → FX gain/loss to 4400/6900 (mirror) |
| 3 | India co (base INR), Dubai customer | Invoice 1000 AED @ 22.5 | Dr AR 22500 / Cr Sales 22500 | AR shows 1000 AED **and** 22500 INR | Receipt at 22.7 → FX gain |

Each must also: keep `total_debit = total_credit`; leave existing same-currency
documents byte-identical; pass the full husky regression suite.

## 6. Acceptance gates for the engine phase

1. Every changed RPC posts base amounts; same-currency (`rate=1`) output is
   unchanged from today (regression-locked).
2. AR/AP aging + statements reconcile in base currency.
3. FX gain/loss is symmetric across receipts and payments (4400/6900).
4. New regression tests cover the matrix above before the editor guard is lifted.
