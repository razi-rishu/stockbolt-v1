---
name: business-rules
description: StockBolt's ERP business logic — the real document lifecycle (draft → confirmed → void, with edits done by reverse-and-repost), how one action ripples across modules (an invoice touches revenue, tax, AR, the GL, stock and COGS at once), and the master-data and period rules that must hold. Use this skill when implementing or changing any business workflow (sales, purchasing, payments, returns, credit/debit notes, inventory, master data), when reasoning about what a document does across the system, or when deciding whether an action is allowed for a document in a given state. Use it whenever a change touches how a business document behaves, because in an ERP a change that looks local almost never is.
---

# Business rules — how StockBolt's documents behave

This skill owns the **cross-module business logic**: the document lifecycle, and
how one action ripples through the system. The *correctness* of each effect
lives in the engines — `accounting-engine` (the GL identities, balancing,
statements), `inventory-engine` (MAC, COGS, stock), `security-guardian`
(tenant isolation, audit immutability). Don't restate their invariants here;
this skill is about *which document triggers which effects* and *what's allowed
when*.

## The one idea: nothing is local

The defining property of an ERP is that a single user action fans out into many
modules at once. Confirming one sales invoice simultaneously: recognises
revenue, records VAT, increases the customer's receivable, writes balanced GL
rows, issues stock, and recognises COGS at moving-average cost. Six effects, one
click. So the instinct that serves you in a normal app — "I'm changing the
invoice screen, that's the invoice module" — is actively wrong here. Before
touching any document behaviour, ask **what else moves when this document
moves**, and verify all of it (`references/module-map.md` maps the ripples).

A change that looks like it touches one thing and actually touches six is the
most common way an ERP change goes wrong.

## The document lifecycle — as it actually is

Forget elaborate multi-state pipelines. StockBolt documents have **three**
states, enforced by a status check on each table (`draft`, `confirmed`, `void`):

```
draft ──confirm──▶ confirmed ──void──▶ void
  ▲                    │
  └──── edit = reverse + repost ───┘   (edits go through the posting engine)
```

- **`draft`** — a work-in-progress. Freely editable, freely deletable, and
  **inert**: no GL rows, no stock movement, no VAT. Nothing has happened
  financially. (The public API's `POST /v1/orders` deliberately lands here.)
- **`confirmed`** — the document is **posted**. Confirm *is* the posting event;
  there is no separate "posted" state. At this moment all the module effects
  fire (GL, stock, tax, subledger). A confirmed document is now part of the
  books.
- **`void`** — the document has been reversed. The reversal posts at the
  **original voucher date** (never today), so voiding never disturbs a period
  that's already been reported (`accounting-engine`).

**Confirmed documents are not frozen — they are edited by reverse-and-repost.**
"Edit a confirmed invoice" does not mutate the posted rows in place; it reverses
the original posting (at its own date) and posts a fresh one. This is why the
GL stays a truthful, append-only history and why an edit can't silently rewrite
a filed period. Never add a path that edits a confirmed document's GL or stock
rows directly — always go through the reverse-and-repost engine.

There is **no** separate "closed" or "archived" document state, and **no
approval workflow** (see below). If a task assumes either, it's assuming
machinery that doesn't exist.

## What each document does when confirmed

The value of knowing this is that when you change one, you must preserve all of
it. Details and account codes: `accounting-engine` (Document 3 recipes) and
`references/module-map.md`.

| Document | Fires, on confirm |
|---|---|
| Sales invoice | Revenue, VAT, AR ↑, GL, stock issue, COGS at MAC |
| POS sale | Same, settled to cash/card instead of AR |
| Purchase / vendor bill | AP ↑, inventory ↑ (MAC recalculated), VAT, GL |
| Goods receipt | Inventory ↑, MAC recalculated |
| Customer receipt | AR ↓, cash/bank ↑, GL (+ FX gain/loss if foreign) |
| Vendor payment | AP ↓, cash/bank ↓, GL |
| Credit note (sales) | Revenue ↓, VAT ↓, AR ↓, stock ↑ + COGS reversed *if restocked* |
| Debit note (purchase) | AP ↓ (or receivable adjust), VAT, GL |
| Expense | Expense ↑, cash/AP, VAT, GL |
| Stock transfer | Quantity moves warehouse→warehouse; **no** value/GL change |
| Stock adjustment | Quantity ±, GL to a variance account, reason required |

Two rules that hold across all of them: **payments never modify the invoice
they settle** (a receipt reduces the balance via allocation; it doesn't reach
back and change the document), and **corrections are new documents** (reversal,
credit note, debit note) — never edits to posted history.

## Rules that are actually enforced vs. rules that are aspirations

Be honest about which is which — asserting a guard exists when it doesn't is
how a "rule" becomes a bug.

**Enforced by the database (rely on these):**
- Every journal entry balances (`je_must_balance` trigger).
- Negative stock is blocked unless the company enables backorders
  (`stock_ledger_block_negative`).
- Master records with transactions can't be hard-deleted (FK `ON DELETE
  RESTRICT` on many relationships) — deactivate instead.

**Convention, upheld by the posting engine (new code can break these):**
- Confirm/void/edit go through the engine; nothing writes GL or stock directly.
- COGS and MAC come from the costing engine, never hand-set
  (`inventory-engine`).
- Reversals use the voucher date; period lock is checked on that date.

**NOT built — do not assume (verify before relying, or flag as new work):**
- **No approval workflow / segregation of duties.** Anyone with the write
  permission can create *and* confirm, at any value. The draft's "confirmed
  documents must follow an approval workflow" and "users cannot approve their
  own documents" describe a system that does not exist here. If a task needs
  approvals, that is a feature to build, not a rule to invoke.
- **No return-quantity guard is guaranteed.** "A sales return can't exceed the
  sold quantity" is a correct *business* rule, but don't assume it's enforced —
  check whether a guard exists before relying on it, and if not, treat adding
  one as real work.
- **Multi-currency is not functional.** The rule "preserve the exchange rate
  used at posting" is right in principle, but today the posting engine records
  `exchange_rate` without multiplying by it, and the document currency picker is
  a live defect (a foreign-currency document misstates the GL — the CERT-1
  finding). **Only base-currency documents are safe.** Never present
  multi-currency as working, and never widen the currency picker while the
  engine is unconverted (`accounting-engine` § Currency).

## Period lock

A closed period (`companies.period_lock_date`, set manually after VAT filing)
rejects any posting *dated* inside it — including a reversal or edit whose
voucher date falls in the locked range. So an edit to an old document can be
legitimately refused; that's the rule working, not a bug. It is manual: nothing
forces a lock, so don't assume one is set.

## When to stop and ask

- A change would edit or delete a **confirmed** document's posted rows directly,
  instead of reverse-and-repost.
- A task assumes an approval workflow, a "closed/archived" document state, or
  working multi-currency — none exist; surface it.
- You're about to touch one document's behaviour and haven't traced what else
  moves with it (`references/module-map.md`).
- A "rule" is needed but you can't confirm it's enforced — say whether you'd be
  adding a guard vs. relying on one.

## Reporting business-logic work

```
Documents/states  — which documents and lifecycle transitions are affected
Modules rippled   — everything that moves when this moves (GL, stock, tax, subledger)
Enforced vs conv. — which affected rules are DB-enforced vs. engine-convention
Accounting/inv.   — the effects, verified via accounting-engine / inventory-engine
Not-built touched — any approval/currency/return-guard assumption surfaced
Risk              — LOW / MEDIUM / HIGH / CRITICAL (erp-guardian tiers)
```

## References

- **`references/module-map.md`** — the ripple map: for each business action,
  every module and ledger it touches, so you can trace "what else moves" before
  changing a document's behaviour. Read before touching any posting-side
  workflow.
