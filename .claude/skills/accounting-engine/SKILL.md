---
name: accounting-engine
description: The accounting correctness rulebook for StockBolt ERP — the identities that must always hold (Trial Balance nets to zero, Assets = Liabilities + Equity, statements reconcile to the GL, stock ties to the Inventory control account), which of them the database actually enforces versus which are conventions you can silently break, and how to verify each one. Use this skill for ANY accounting work in StockBolt: posting logic, journal entries, the GL, Trial Balance, Balance Sheet, P&L, Cash Flow, COGS, inventory valuation, VAT/GST, customer or vendor statements, opening balances, period close, and currency. Also use it for diagnostic questions like "why doesn't my balance sheet balance?" or "is this posting correct?" — even when no code is being changed.
---

# Accounting engine — correctness rules for StockBolt

**Where the knowledge lives.** `docs/Document_3_Accounting_Rulebook.md` is the
canonical source for the chart of accounts and the exact debit/credit recipe
for every transaction type (A1–A11 sales, B1–B6 purchases, and so on). When you
need to know *what to post*, read it there — do not reconstruct a treatment
from memory or by copying a nearby function.

This skill covers what that document does not: **the identities that must hold
across the whole system, how strongly each is enforced, and how to prove they
still hold after a change.**

Related skills: `stockbolt` (how the system works), `erp-guardian` (how to
change it safely — risk tiers, impact analysis, regression gate).

## The identities

Everything below is downstream of five statements that must be true at all
times, for every company, at every date:

1. **Every journal entry balances.** `SUM(debit) = SUM(credit)`.
2. **The Trial Balance nets to zero** for each company.
3. **Assets = Liabilities + Equity** at any as-of date.
4. **Subledgers reconcile to their control accounts.** Customer statements to
   AR, vendor statements to AP, stock valuation to Inventory (1300).
5. **Every report reconciles to the GL.** No report may compute a financial
   figure from source documents when the GL already holds the answer.

If any of these fails, stop and diagnose. Do not build on top of an unbalanced
book — every subsequent number inherits the error, and the longer it runs the
harder the repair.

## Know how strongly each rule is enforced

This is the part that matters most, and the part most easily got wrong. A rule
you *assume* is enforced but isn't is worse than no rule, because you stop
checking. StockBolt enforces its accounting rules at three very different
strengths:

### Tier 1 — Enforced by the database. You cannot violate these.

- **`je_must_balance`** — a deferred constraint trigger rejecting any unbalanced
  journal entry at commit.
- **Negative-stock guard** — `stock_ledger_block_negative`, subject to the
  company's backorder setting.
- **Foreign keys** — many use `ON DELETE RESTRICT`, which is what actually
  prevents deleting master records that have transactions.

You can rely on these. If one fires, the change is wrong — fix the arithmetic,
never work around the guard.

### Tier 2 — Convention upheld by the posting engine. New code can silently break these.

- **The GL is the only financial truth** — no cached balance columns anywhere.
- **Balance by construction** — amounts derive from `total_amount − tax_amount`
  (plus discount under the gross method), never from a stored header subtotal.
  This is the only formulation that survives tax-inclusive pricing.
- **Voucher-date reversals** — voids, reopens, edits and reposts use the
  original document's date, never `CURRENT_DATE`, so an edit can never move
  money into an already-filed period.
- **Stock reads order by `stock_ledger.seq`** — never `created_at, id`; uuid
  tiebreaks caused real valuation drift.
- **COGS comes from inventory**, computed by the costing engine at moving
  average cost — never recomputed independently from prices.
- **Base currency only** (see below).

Nothing stops you breaking these except knowing them. When writing a new
posting path, walk this list explicitly.

### Tier 3 — Not built. Do not assume these exist.

- **Year-end close does not exist.** `year_end_close` is a valid `source_type`
  value, but no closing RPC has been written. Income and expense accounts are
  never zeroed; retained earnings are never crystallised. The Balance Sheet
  compensates with a synthetic "Current Period Earnings" equity line so the
  books still balance — which is correct, but it is not a close.
- **No unrealized FX revaluation.** Open foreign-currency balances are not
  retranslated at period end.
- **Multi-currency conversion is not implemented in posting** (see below).
- **No segregation of duties or approval thresholds.** Permissions are
  capability-based; anyone with write access can create and confirm.

If a task depends on any of these, say so plainly rather than writing code that
assumes the machinery is there.

## Currency — the hard rule

**Only base-currency transactions are valid today.** Roughly fifteen posting
RPCs record `exchange_rate` on the journal header but never multiply by it, so
a foreign-currency document posts its raw transaction amount into the ledger. A
1,000 USD invoice becomes 1,000 AED.

This is dangerous precisely because it is quiet: the entry still balances
(1000 = 1000), so `je_must_balance` passes, the regression suite passes, and no
error appears anywhere. Only the numbers are wrong.

Therefore:

- Never enable, widen, or reintroduce a user-facing currency selector on a
  document while the posting engine is unconverted.
- Any new document-creation path (UI, import, or API) forces the company's
  base currency.
- When asked to "add multi-currency", treat it as the full engine project
  defined in `docs/MULTICURRENCY_AUDIT.md` §3 and §6 — all posting RPCs
  converting to base, symmetric realized gain/loss on receipts *and* payments,
  and the §5 test matrix passing. Partial enablement is not a smaller version
  of this work; it is a defect.

A half-built financial feature that users can reach is not a limitation. It is
a bug that produces wrong tax filings.

## Domain rules worth stating explicitly

**The GL is append-only in spirit.** Never edit or delete historical entries.
Corrections happen through reversal, adjustment, credit note or debit note, so
the audit trail shows what happened and what corrected it. Rewriting history
destroys the evidence an auditor needs.

**Payments never modify invoices.** A receipt settles an outstanding balance;
it does not reach back and change the document. Allocation records the link.
This keeps the invoice a faithful record of what was billed.

**Outstanding is derived, never stored.**
`Customer outstanding = invoices − receipts − credit notes`, computed from the
ledger. The same shape applies to vendors with bills, payments and debit notes.

**Opening balances are entered once.** Correct them with adjustment entries,
not by editing the opening. An edited opening silently changes every period
that follows it.

**Tax posts to dedicated tax accounts** and is never hardcoded into a revenue
or expense line. VAT/GST reports derive from posted journals, so anything not
posted through a tax account is invisible to the return.

**Stock transfers do not change valuation.** Moving stock between warehouses
relocates quantity and cost; it does not create or destroy value.

**Master records with transactions are never deleted** — deactivate instead.
Several foreign keys enforce this with `ON DELETE RESTRICT`, but coverage is
not uniform, so check the specific constraint rather than assuming.

**Period lock is respected on the voucher date.** A locked period rejects new
postings *dated* inside it, regardless of when the action is taken.

## Verifying — prove it, don't eyeball it

A rendered report that looks reasonable proves nothing. The defects that matter
produce plausible numbers. Assert the identities directly.

`references/verification-queries.md` has ready SQL for each identity: per-entry
balance, per-company trial balance, the accounting equation, statement-to-
control-account reconciliation, and stock-to-GL. Run them through the
regression helper RPC rather than a console against production.

Two traps worth internalising:

- **A balanced entry is not a correct entry.** Balance proves debits equal
  credits; it says nothing about whether the amounts are right.
- **A green regression suite is not proof of correctness.** The suite is largely
  structural — it asserts functions, policies and columns exist in the right
  shape. It does not assert that posting produces the right *numbers*. For any
  accounting change, verify the numbers yourself.

The strongest evidence a posting change is safe is that it changes **nothing**
for existing documents. Capture the GL for a sample of confirmed documents
before the change, re-derive after, and diff. Any movement in a historical
document is a retroactive change to a customer's filed books — stop there.

## When to stop and ask

Stopping costs a message. Wrong books cost trust, and sometimes a tax penalty.

Stop and ask when:

- You are inferring a debit/credit treatment rather than reading it from
  Document 3 or an existing posting function. **Never guess accounting.**
- A change would alter numbers on already-confirmed documents.
- An identity above currently fails — diagnose the cause before building on it.
- The work needs Tier 3 machinery that does not exist.
- You cannot tell whether a suspected defect is latent or already corrupting
  data. Find out first with a read-only probe; the answer changes everything
  about the correct response.

State what you know, what you don't, and what you would do under each answer.

## Reporting accounting work

For anything touching posting, valuation, tax or the statements, close with:

```
Impact analysis     — what changes, and which identities it could disturb
Accounting risk     — how this could produce a wrong number, and what prevents it
Modules affected
Database impact     — tables, RPCs, migration (additive? idempotent? data repair?)
Verification        — what you ran and what it actually returned
Rollback            — how to undo this if it turns out wrong in production
Confidence          — high / medium / low, and what would raise it
```

The rollback line matters more than it looks: accounting changes land in a live
ledger, and "how do we get back?" is much easier to answer before deploying
than after. If the honest answer is "we cannot cleanly undo this", that is
itself a reason to slow down.

Report confidence honestly. "Medium — verified against two tenants but the
sell-before-buy path is untested" is far more useful than an unqualified
"done", and it tells the reader exactly where to look if something surfaces.

## References

- **`references/verification-queries.md`** — SQL proving each identity, plus
  before/after comparison for posting changes. Read at verification time.
- **`references/engine-status.md`** — honest implemented / partial / not-built
  status per accounting area, so you never assume machinery that isn't there.
  Read when scoping accounting work.
- **`docs/Document_3_Accounting_Rulebook.md`** — canonical COA and per-
  transaction posting recipes. Read when you need to know what to post.
