### The module ripple map

Read before changing any document's behaviour. Its one job is to answer "what
else moves when this moves" — because in an ERP the answer is always "more than
you think," and the effect you forget is the one that produces a wrong number.

For the *exact* debit/credit of each effect, use `accounting-engine`
(Document 3 recipes). For costing effects, `inventory-engine`. This map is the
index: it tells you which of those to check for a given action.

## How to use it

1. Identify the action you're changing (confirm invoice, edit bill, void
   receipt…).
2. Read every module it touches below.
3. Verify each one still behaves correctly after your change — not just the one
   you meant to change. A change to invoice confirmation that you only checked
   against the GL, but which also shifted stock, is half-verified.

## Sales side

**Confirm sales invoice** touches:
- **GL** — AR (Dr), Revenue (Cr), VAT output (Cr); round-off leg if any.
- **AR subledger** — the customer's balance and statement.
- **Stock ledger** — an issue (out) for each stock line (services excluded).
- **COGS / inventory** — COGS (Dr), Inventory 1300 (Cr) at MAC; deferred-COGS
  queue if selling before buying.
- **Reports** — Trial Balance, P&L (revenue + COGS), Balance Sheet (AR,
  inventory), VAT return, AR aging, dashboard.
- **Commission** — salesperson base, if set.

**Edit a confirmed invoice** = reverse the above (at the original date) + repost
fresh. Everything the confirm touched, it touches again, twice. Verify the net
effect on a *historical* document is zero unless the edit intends a change.

**Void invoice** = the reversal half only, at the voucher date.

**Customer receipt** touches: cash/bank (Dr), AR (Cr); allocation to specific
invoices; FX gain/loss (4400/6900) if the invoice was foreign; AR aging;
cash-flow. Does **not** modify the invoice — only its outstanding via allocation.

**Sales credit note** touches: Revenue ↓, VAT ↓, AR ↓; **and if restocked**,
stock ↑ and COGS reversed at the *original* cost. A non-restock credit note
skips the inventory legs. Getting the restock/no-restock branch wrong is a
classic silent inventory error.

## Purchase side

**Confirm vendor bill** touches: AP (Cr), Inventory or expense (Dr), VAT input
(Dr); **MAC recalculated** on each stock line; landed-cost legs if present;
AP subledger; TB / BS / P&L / VAT / AP aging / dashboard.

**Goods receipt** touches: stock ledger (in), MAC recalculation. May precede the
bill (three-way match).

**Vendor payment** touches: AP (Dr), cash/bank (Cr); allocation to bills; AP
aging; cash-flow.

**Debit note (purchase)** touches: AP adjustment / receivable, VAT, GL.

## Inventory side

**Stock transfer** — quantity leaves one warehouse, enters another. **No GL, no
value change, no MAC change.** If a transfer ever posts to the GL or shifts
valuation, that's a bug.

**Stock adjustment** — quantity ± with a reason code (`stock_count`, `damage`,
`shrinkage`, `found`, `other`); posts to inventory and a variance account;
audit-logged. Never a silent quantity change.

**Opening stock** — establishes initial quantity and cost; feeds MAC; posts the
opening inventory value.

## Master data (create/edit/delete)

Changing a master record ripples into every document that references it — which
is exactly why deletion is restricted:

- **Customer / vendor / product with transactions** — cannot be hard-deleted
  (FK restrict); deactivate. Editing a name/price affects new documents only;
  it must **not** retroactively change posted documents (those captured their
  values at post time — e.g. `cost_at_sale`, line prices).
- **Chart of accounts** — an account with GL activity can't be removed;
  reclassifying an account type moves it on every report.
- **Tax rate** — changing a rate affects future postings only; historical VAT is
  captured on the posted document and must not shift.

The through-line: **master edits are prospective; posted documents are
immutable snapshots.** A change that makes editing a product retroactively alter
old invoices is a serious defect.

## Currency (the caveat on every row above)

Every "GL" effect above assumes a base-currency document, because that is the
only kind that posts correctly today. A foreign-currency document records a rate
but posts unconverted amounts (the CERT-1 defect). So when tracing effects,
treat any non-base-currency document as *unsafe*, not as "the same effects at a
converted amount." See `accounting-engine` § Currency.

## The verification habit

After changing any action above, re-check the *whole* row, not the cell you
edited:
- GL still balances and the numbers are right (`accounting-engine`).
- Stock and MAC moved correctly, or correctly didn't (`inventory-engine`).
- The subledger (AR/AP) and the aging reconcile.
- The affected reports still tie to the GL.

The bug you're most likely to ship is in the effect you didn't think you were
touching.
