# Engine status — what is actually built

Read when scoping accounting work, before promising anything.

The purpose of this file is to prevent a specific and expensive mistake:
**assuming machinery exists because a rule describes it.** A rulebook that says
"year-end closing must transfer profit to retained earnings" reads like a
description of the system. It is in fact a description of the *target*. Code
written on that assumption fails in ways that are hard to trace.

Status as of 2026-07. Update this file whenever an area moves between tiers —
a stale status file is worse than none, because it is trusted.

| Area | Status | What this means for your work |
|---|---|---|
| Double-entry posting | ✅ **Built, DB-enforced** | `je_must_balance` deferred trigger. Rely on it. |
| Chart of accounts | ✅ Built | Standard COA seeded; parent/sub accounts supported. See Document 3. |
| Sales posting (invoice, POS, credit note, return) | ✅ Built | Recipes A1–A11. Reuse, don't rewrite. |
| Purchase posting (PO, GRN, bill, debit note, expense) | ✅ Built | Recipes B1–B6. Landed costs post their own legs. |
| Payments, receipts, advances, allocation | ✅ Built | Advance apply is balance-neutral on statements. |
| Moving-average costing | ✅ Built | `seq`-ordered replay. Do not reorder by timestamp. |
| Deferred COGS (sell-before-buy) | ✅ Built | Queue flushed at the next purchase's cost. |
| Negative-stock guard | ✅ **Built, DB-enforced** | Trigger honours the company backorder setting. |
| Services excluded from inventory | ✅ Built | Service products never touch the stock ledger. |
| Round-off handling | ✅ Built | Posts to 5900; header identity preserved. |
| Voucher-date reversals | ✅ Built (convention) | All void/reopen/edit paths. New paths must follow. |
| Tax / VAT posting | ✅ Built | Dedicated tax accounts; returns derive from the GL. |
| Tax-inclusive pricing | ✅ Built | Amounts derive from `total − tax`. |
| Opening balances | ✅ Built | Wizard + GL openings + per-bank + CSV import. |
| Period lock | ⚠️ **Partial** | `companies.period_lock_date` exists and is checked on the voucher date — but it is **manual**. Nothing prompts the user to set it after filing. |
| Trial Balance / Balance Sheet / P&L / Cash Flow | ⚠️ **Partial** | Correct today, but aggregated **client-side over unbounded fetches**. Silently truncates past the API row cap (~1,000 GL rows). Treat any report work as an opportunity to move aggregation into SQL. |
| Balance Sheet equity | ⚠️ Partial by design | Current-period earnings folded in as a synthetic `__CPE__` line so the equation holds. Correct — but it is a substitute for a close, not a close. |
| FX realized gain/loss | ⚠️ **Partial** | Implemented on **customer receipts** (4400 gain / 6900 loss). Vendor-payment symmetry is specified but unverified — check before relying on it. |
| Multi-currency conversion in posting | ❌ **Not built** | ~15 posting RPCs record `exchange_rate` but never multiply by it. **Base currency only.** See SKILL.md § Currency. |
| Unrealized FX revaluation | ❌ Not built | Open FC balances are not retranslated at period end. |
| Year-end close | ❌ **Not built** | `year_end_close` is a valid `source_type`, but no closing RPC exists. Income/expense are never zeroed; retained earnings never crystallised; no fiscal-year lock. |
| Prior-year comparatives from a closed baseline | ❌ Not built | Follows from the above. |
| Approval workflows / segregation of duties | ❌ Not built | Permissions are capability-based. Anyone with write access can create *and* confirm, at any value. |
| Fixed assets & depreciation | ❌ Not built | No asset register, no depreciation schedule. |
| Budgets vs actuals | ❌ Not built | |
| Bank feed import | ❌ Not built | Reconciliation is manual. |
| Recurring invoices | ❌ Not built | |
| Dunning / automated statements | ❌ Not built | |
| E-invoicing (ZATCA / UAE Peppol / India IRN) | ❌ Not built | Compliance obligations vary by country and change — **verify current requirements for the target market** rather than assuming this is optional. |

## How to answer "can we do X?"

Find the row. Then:

- **✅ Built** — reuse the existing engine. Do not write a parallel path; every
  duplicate is a second place for the rules to drift, and they always do.
- **⚠️ Partial** — say precisely which part exists and which does not. "Period
  lock exists but is manual" is actionable; "we have period locking" is
  misleading and will be discovered at the worst moment.
- **❌ Not built** — say so before writing code. Estimate it as new work.
  Silently building a minimal version inside an unrelated task is how half-built
  financial features get created, and a half-built financial feature reachable
  by users produces wrong numbers rather than missing ones.

## The pattern to watch for

Every ❌ row above is a place where a plausible-sounding request ("just add a
year-end close", "let them pick a currency", "add an approval step") is
substantially larger than it sounds, because the surrounding machinery assumes
it does not exist.

When a request touches a ❌ row, the useful response is not to start coding. It
is to name the gap, size it honestly, and let the owner decide whether to fund
it properly or defer it. That conversation takes a minute and prevents the
class of defect that took three audits to find.
