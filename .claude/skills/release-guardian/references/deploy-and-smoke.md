### Deploying and smoke-checking a change

Read when actually shipping something. The mechanics are simple but the
*ordering* is where production breaks, because code and database go live at
different moments.

## The deploy sequence

**Code-only change (no migration):**
1. You commit on approval (Co-Authored-By line; small, coherent, revertible).
2. Rashid runs `git push`. Vercel builds and deploys — live in a few minutes.
3. Smoke-check the change in production (below).

**Change that needs a migration — order matters:**
1. Deliver the migration file **and** literal hand-apply steps.
2. **Rashid applies the migration first**, in the Supabase SQL editor
   (`migration-guardian`). Verify its end state live before moving on.
3. *Then* commit + push the code that uses it.

Why this order: an additive migration is invisible to the old code, so applying
it early is safe. But pushing code that reads a not-yet-created column/function
errors in production. Migration first, then code.

Corollary: **write the code to tolerate the migration being absent** — soft-skip,
null-check, or feature-flag — so a mis-ordering degrades to "feature not visible
yet" instead of "app throws." The regression suite already uses this soft-skip
pattern; mirror it in the app where a new column/RPC is read.

## Rollback — the real steps

There is no rollback framework. What you actually do:

**Code went bad:**
```
git revert <commit-sha>     # creates an inverse commit
# Rashid pushes → Vercel redeploys the prior working build
```
Fast and reliable — which is exactly why commits should be small and coherent
enough to revert without collateral. A giant commit that mixed a fix with a
refactor cannot be cleanly reverted; that's a reason to keep them separate
(`coding-standards`).

**A function migration went bad:**
Ship a *new* migration that restores the previous definition — taken from the
live database with `pg_get_functiondef` before you changed it, never from an old
migration file (`migration-guardian`).

**A data change / backfill went bad:**
There is usually **no clean undo**. This is why the plan and row-count are
agreed *before* applying. If a repair is genuinely irreversible and it turns out
wrong, you are into careful, case-by-case forward correction on live customer
data — slow and risky. The lesson is upstream: never apply an unreviewed data
change.

**Never** hand-edit production data to make it match what a broken release was
supposed to produce. That hides the defect and usually creates a worse one.

## Post-deploy smoke check, by change type

A push is live in minutes and there is **no error monitoring**
(security-guardian E-4), so this manual look is the only signal that reality
matches intent. Match depth to the change.

**Any non-trivial change:**
- App boots; a known page loads (no white screen, no bad-bootstrap-to-setup).
- The specific thing you changed behaves correctly in production.
- Browser console / Vercel function logs show nothing new throwing.

**UI change:** the screen renders correctly, including empty/loading/error
states and (if touched) RTL/Arabic.

**Report or posting change:** open the affected report/document and **spot-check
one real number** against what it should be. This is the check that catches the
silent-wrongness class the structural suite misses (`test-engine`,
`accounting-engine`). If the number is off, revert immediately — a wrong number
in a customer's books is the worst outcome in this product.

**Migration:** re-run its verification query against live and confirm the end
state exists (`migration-guardian` → validation). "No error at apply time" is
not confirmation.

**API change:** exercise the affected endpoint with a real key — auth wall
(no key → 401), the happy path, and one negative (wrong scope → 403, or another
tenant's id → 404). Confirm no existing response shape changed
(`api-guardian`).

**Security-relevant change:** re-run the relevant probe from
`security-guardian` (e.g. the anon-grant enumeration) and confirm nothing
widened.

## A quick note on the current state

Two things worth carrying into any release decision right now, because they
change the honest answer:

- **SEC-1 is open** (arbitrary-SQL RPC callable by `anon`). Until it's closed
  (one `REVOKE`), the product is carrying a live cross-tenant breach — factor
  that into "is it responsible to ship new surface." It does not block a pure
  bug-fix revert, but it does mean the headline security posture is red.
- **No CI, tests run on prod, no tested restore** (security-guardian E-3/E-4/H-4).
  So the smoke check *is* the safety net — there is no automated system watching
  after you. Do it, don't assume it.
