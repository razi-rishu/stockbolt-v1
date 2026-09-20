---
name: erp-guardian
description: Change-control discipline for the StockBolt ERP — risk tiering, impact analysis, and the regression gate that protect accounting correctness, tenant isolation, and inventory valuation. Use this skill before ANY change to StockBolt: features, bug fixes, migrations, posting RPCs, reports, API endpoints, or even "quick" UI tweaks. It is especially important when a change touches money, stock, the GL, tax, permissions, or the database — but consult it for small changes too, because the most damaging ERP defects are the ones that look trivial and produce silently wrong numbers instead of errors.
---

# ERP Guardian — safely changing StockBolt

This skill governs **how to change** StockBolt. For how the system *works* —
posting engine, stock/MAC, RBAC, billing, design system, and the working
agreement with Rashid — use the **`stockbolt`** skill. The two are designed to
be used together and deliberately do not duplicate each other.

StockBolt is a **live ERP with real paying customers** whose books, VAT filings
and stock valuations depend on it being right. That single fact drives
everything below.

## The one idea that matters: silent wrongness

Most software fails loudly. A crash gets noticed, reported, and fixed within
hours. An ERP fails **quietly**: it produces a number that is plausible,
confident, formatted to two decimals — and wrong. Nobody notices. The number
goes into a VAT return, a bank covenant, a year-end pack.

Three real StockBolt defects, all found in production audits, share this shape:

- A currency dropdown that posts a 1,000 USD invoice to the ledger as 1,000 AED.
  **The journal entry still balances**, so every guard passes.
- Reports that aggregate in the browser and silently truncate at 1,000 rows.
  Balance Sheet, Trial Balance and P&L quietly understate once a tenant grows.
- A double-post guard implemented as a read-check rather than a constraint, so
  two concurrent confirms both pass and revenue posts twice.

None of these throw. None fail a test. All of them corrupt financial reality.

**So the question to hold in your head for every change is not "does this
work?" but "if this were wrong, would anyone find out?"** If a change can
produce a wrong number without producing an error, that is the highest-priority
thing to address — before performance, before cleanliness, before the feature
itself.

Prefer failing loudly over degrading quietly. A report that refuses to render
with "ledger too large to aggregate client-side" is vastly better than one that
renders a confident wrong total.

## Priority order

When two goals conflict, resolve in this order:

1. **Data integrity** — never lose or corrupt what customers have entered
2. **Accounting integrity** — the books must be defensible to an auditor
3. **Security** — tenant isolation, permissions, secrets
4. **Stability** — existing workflows keep working
5. **Performance**
6. **UX**
7. **New features**

This ordering is what separates an ERP from an app. Shipping a feature that
makes the books wrong is strictly worse than not shipping it. Never trade
correctness for cleaner code, and never refactor working accounting logic
because it offends your taste — the ugliness is often a scar covering a real
production incident.

## Risk tiers — scale the ceremony to the stakes

Applying a heavyweight process to a label change teaches everyone (including
you) to treat the process as noise, which erodes it exactly when it matters.
Match the effort to the blast radius.

| Tier | What it covers | What it demands |
|---|---|---|
| **LOW** | Copy, labels, CSS, icons, spacing, static UI | Say what you're touching. `tsc` + build green. Done. |
| **MEDIUM** | CRUD forms, filters, list queries, import/export, non-financial settings | Brief impact note. Check query bounds and validation. Drive it in the browser. |
| **HIGH** | Reports, payments, API contracts, permissions, anything **reading** the GL or stock | Full impact analysis. Regression suite. Verify numbers against a known-good source. |
| **CRITICAL** | Posting RPCs, migrations, COGS/MAC, tax engine, RLS/policies, anything **writing** the GL or stock ledger | Full impact analysis **plus stop and confirm the plan with Rashid before writing code**. Generate from live definitions. New regression test. Hand-apply instructions. |

When a change spans tiers, it takes the **highest** tier that applies. A "small
CSS fix" to a report that also adjusts a total is CRITICAL, not LOW.

If you are unsure which tier applies, treat it as one tier higher. The cost of
over-verifying is a few minutes; the cost of under-verifying is a customer's
books.

## Process

**LOW / MEDIUM** — go straight to the work. State the tier, make the change,
verify (`npx tsc --noEmit` + `npm run build`; drive the UI if it is visible),
and report briefly.

**HIGH / CRITICAL** — work through these in order:

1. **Understand the actual problem.** Reproduce it or read enough code to
   explain it in one sentence. Diagnosing against live data with a throwaway
   read-only probe (`scripts/_probe_*.mjs`, deleted after) is usually faster
   than reasoning from source. See `stockbolt` skill for the probe pattern.
2. **Impact analysis.** Fill the template — see `references/impact-analysis.md`
   for the fields and how to trace impact properly.
3. **Plan, and for CRITICAL, get agreement before writing code.** A rejected
   plan costs a message; a rejected migration costs a data repair.
4. **Implement the minimal change.** Touch only what the fix requires.
5. **Verify** — `references/regression-gate.md` has the tiered checklist and
   the numeric verification patterns.
6. **Self-review against the invariants below**, then report.

## Invariants — and why each exists

These are not arbitrary. Each one is load-bearing, and knowing *why* lets you
protect it in situations this document never anticipated.

**The GL is the only financial truth.** Reports derive from `general_ledger`;
no cached balance columns. *Why:* the moment a cached total exists, it can
disagree with the ledger, and nobody can tell which is right. Debugging that in
a customer's live books is brutal.

**Balance by construction.** Revenue and goods amounts derive from
`total_amount − tax_amount` (plus discount for the gross method), never from a
stored header subtotal. *Why:* it is the only formulation that stays correct
under tax-inclusive pricing. The deferred `je_must_balance` trigger catches
what slips through — never work around that trigger, fix the arithmetic.

**Reversals post at the original document's date.** Every void, reopen, edit
and repost uses the voucher date, never `CURRENT_DATE`. *Why:* an edit must
never move money into a different period — especially one already filed for
VAT. Period-lock guards check the voucher date for the same reason.

**Stock reads order by `stock_ledger.seq`.** Never `created_at DESC, id DESC`.
*Why:* uuid tiebreaks produced phantom valuation drift in production. This one
was expensive to find.

**Accounting happens in the database, not the browser.** Posting, valuation and
report aggregation belong in SQL. *Why:* the client can be stale, truncated by
API row caps, or tampered with. Client-side aggregation is precisely how the
report-truncation defect became possible.

**Tenant isolation is never assumed.** RLS stays on; policies are never
bypassed. Where code legitimately runs with the service role (Edge Functions),
**it carries the isolation burden itself** — every query explicitly scoped to
the authenticated company. *Why:* service-role code has no safety net; a
missing `.eq('company_id', …)` is a cross-tenant breach.

**Old documents must reproduce identically.** A change to posting logic must
leave existing confirmed documents byte-identical. *Why:* otherwise you have
retroactively altered a customer's filed books. Regression-lock this explicitly
when touching a posting path.

**Reuse the engines.** Post through the existing posting/inventory/tax/
permission paths rather than writing a parallel one. *Why:* every duplicate
path is a second place for the rules to drift, and they always do.

**Don't rename things.** Tables, columns, RPCs, enums, types — leave names
alone unless renaming is the actual request. *Why:* live functions, saved
migrations, and the type-generation pipeline all bind to these names.

## When to stop and ask

Stopping is cheap. Wrong books are not.

Stop, explain the uncertainty, and ask when:

- You are inferring an accounting treatment rather than reading it from
  `docs/Document_3_Accounting_Rulebook.md`, the `stockbolt` skill, or an
  existing posting function. **Never guess a debit/credit.**
- A change would alter numbers on already-confirmed documents.
- A migration needs to repair or backfill existing tenant data.
- The requested change conflicts with an invariant above.
- You cannot determine whether a defect is latent or already corrupting data —
  find out first; the answer changes the urgency completely.
- A half-built feature is reachable by users. Either finish it or close the
  door; a partially-wired financial feature is a defect, not a limitation.

Say plainly what you know, what you don't, and what you'd do with each answer.

## Reporting

Match the report to the tier. For **LOW/MEDIUM**, a couple of sentences plus
what you verified is enough — do not pad it into a formal block.

For **HIGH/CRITICAL**, close with:

```
Summary          — what changed, in plain language
Files modified   — paths
Reason           — the underlying cause, not just the symptom
Risk level       — LOW / MEDIUM / HIGH / CRITICAL
Verification     — what you ran and what it showed (actual results)
Migration        — file + exactly what Rashid runs by hand, or "none"
Next             — the most valuable follow-up
```

Report verification honestly. If the suite failed, say so and show the output.
If you skipped a step, name it. A confident summary over an unverified change
is the same failure mode as a confident wrong number — it just moves the
silence from the ledger into the conversation.

## References

Read these when the situation calls for them:

- **`references/impact-analysis.md`** — the impact-analysis template, a worked
  example, and grep patterns for tracing what a change actually touches.
  Read before any HIGH/CRITICAL change.
- **`references/regression-gate.md`** — verification commands, the tiered
  checklist, and how to verify accounting numerically rather than by eye.
  Read at verification time.
- **`references/known-traps.md`** — production incidents and the traps that
  caused them (currency misstatement, report truncation, double-post race,
  `CREATE POLICY` non-idempotency, live-function drift). Read before touching
  posting RPCs, migrations, reports, or currency — these have already bitten
  once each.
