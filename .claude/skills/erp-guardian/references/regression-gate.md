# Regression gate

Read at verification time. The goal is evidence, not reassurance — report what
the commands actually printed, including failures.

## Commands

```bash
# Always (every tier)
npx tsc --noEmit
npm run build

# HIGH / CRITICAL — the live-DB regression suite (~35s, 91+ tests)
npm run test:regressions
```

The regression suite runs automatically via the husky pre-commit hook. Never
reach for `--no-verify` to get past a red suite: the suite is the only thing
standing between a posting change and a customer's books. If it fails, either
the change is wrong or the test is wrong — determine which, and say which.

For UI changes, drive the app in the preview browser rather than asserting it
works. Auth-gated pages cannot be driven without credentials; in that case
verify compile + boot and ask Rashid to eyeball it (his dev server hot-reloads
your edits).

## Tiered checklist

**LOW** — `tsc` green, build green. Visually correct if it is visible.

**MEDIUM** — the above, plus:
- Validation still rejects bad input (empty, negative, overlong, wrong type)
- List queries are bounded — no unbounded `.select()` on a growing table
- Empty state, loading state and error state all render
- Existing filters/sort/pagination still behave

**HIGH** — the above, plus:
- `npm run test:regressions` green
- Numbers verified against a known-good source (below)
- Company isolation intact — the query is scoped to one tenant
- Reports: opening balance, transactions, running balance and totals all agree
- Print and export still produce correct output
- No new N+1 or unbounded fetch introduced

**CRITICAL** — the above, plus:
- Generated from the **live** function definition, not a migration file
- Migration is additive and idempotent (see traps below)
- Existing confirmed documents reproduce **identically** — assert this
- Trial Balance balances; Balance Sheet balances; P&L ties to GL movement
- Stock subledger ties to the Inventory control account
- A new regression test locks the fix, soft-skipping until the migration is
  applied (tenant-data checks WARN, never fail)
- Hand-apply instructions written for Rashid

## Verifying accounting numerically

Eyeballing a report is not verification — the defects that matter produce
plausible numbers. Assert the identities instead.

```sql
-- Every JE balances (should return zero rows)
SELECT je.id, SUM(gl.debit) AS dr, SUM(gl.credit) AS cr
FROM journal_entries je
JOIN general_ledger gl ON gl.journal_entry_id = je.id
GROUP BY je.id
HAVING ROUND(SUM(gl.debit) - SUM(gl.credit), 2) <> 0;

-- Trial balance nets to zero, per company
SELECT company_id, ROUND(SUM(debit) - SUM(credit), 2) AS net
FROM general_ledger GROUP BY company_id HAVING ROUND(SUM(debit) - SUM(credit), 2) <> 0;

-- Stock subledger vs Inventory control account (E1)
-- Drift is reported per tenant and is warn-only in the suite; investigate,
-- do not silently accept a growing number.
```

Run these through the regression helper RPC (see `stockbolt` skill) rather
than opening a SQL console against production.

### Before/after comparison for posting changes

The strongest evidence that a posting change is safe is that it changes
**nothing** for existing documents. Capture the GL for a sample of confirmed
documents before the change, apply it, re-derive, and diff. If any historical
document moves, stop — that is a retroactive change to filed books.

## Things that look verified but are not

**A passing test suite.** The suite is largely structural — it asserts that
functions, policies and columns *exist* with the right shape. It does not
assert that posting produces correct **numbers**. A change can be green and
still be wrong. For accounting changes, verify the numbers directly.

**A balanced journal entry.** `je_must_balance` proves debits equal credits.
It does not prove the amounts are right. A 1,000 USD invoice posted as 1,000
AED balances perfectly.

**A report that renders.** Rendering proves the query returned; it does not
prove the query returned *everything*. Check bounds when the source table
grows without limit.

**A successful migration run.** A script can abort partway and roll back while
still looking like it "ran" — this happened in production. Verify the intended
end state directly (query `pg_get_functiondef`, `pg_policies`, `information_
schema`) rather than trusting the absence of an error message.
