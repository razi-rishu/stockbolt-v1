---
name: release-guardian
description: The go/no-go gate before StockBolt changes reach production — how to decide a change is actually shippable, how deployment really works here (git push → Vercel for code, hand-applied SQL for the DB), the stop conditions that block a release, and the post-deploy smoke check. Use this skill when finishing a change and deciding whether it's ready, before committing or asking Rashid to push, when planning how a change reaches production, or when asked "is this ready to ship / deploy / release?". It sequences the other guardians into a final gate rather than repeating them.
---

# Release guardian — the final gate before production

This skill is the **checkpoint**, not the work. The actual verification lives in
the domain guardians — this skill sequences them into a single go/no-go decision
and owns the part none of them do: how a change actually reaches production here,
and when to refuse to ship.

- Correctness verification → `test-engine`, `accounting-engine`, `inventory-engine`
- Change process + risk tiers → `erp-guardian`
- DB apply/verify → `migration-guardian`
- Security posture + open findings → `security-guardian`
- API contract safety → `api-guardian`

Don't re-derive their checks; call them, collect the results, and make the call.

## How releasing actually works here (not a pipeline)

Forget staged enterprise pipelines with release trains and approval boards. This
is a solo-built product with a two-part, mostly-manual path to production. Being
honest about it is the whole point — a checklist that assumes machinery that
doesn't exist gives false confidence.

- **Code ships by `git push` → Vercel auto-deploys.** There is no staging
  environment, no CI gate (the only gate is the local husky pre-commit hook),
  and no separate "release" step. A merged push is live in minutes.
- **You commit when approved; Rashid pushes.** Never push yourself. Commits end
  with the Co-Authored-By line.
- **Database changes ship separately, by hand.** A migration is not "released"
  by the push — Rashid pastes the SQL into the Supabase editor
  (`migration-guardian`). Code and its migration therefore go live at *different
  moments*, which creates an ordering hazard (below).
- **There is no per-release backup ritual and no tested restore.** Supabase has
  automated backups, but a restore has never been drilled (security-guardian
  E-4). So "we can roll back the data if this goes wrong" is **not true** —
  plan as if a bad data change is forward-fix-only.

## Rollback, honestly

The draft this skill grew from assumed every release has a tested rollback
script. Here it does not, and pretending otherwise is dangerous. What "undo"
actually is:

- **Code:** `git revert` the commit and push again → Vercel redeploys the prior
  build. Fast and reliable. This is your real safety net, so keep commits small
  and coherent enough to revert cleanly.
- **A replaced function:** ship a new migration restoring the prior definition
  (taken from the live DB via `pg_get_functiondef`, never an old file).
- **A data change / backfill:** usually **no clean undo**. This is exactly why
  `migration-guardian` says count the rows and agree the plan *before* applying.
  If a data change can't be reversed, that is a reason to slow down, not a line
  in a rollback template.

The ordering hazard: because code and migration deploy at different times, a
push that depends on an unapplied migration will error in production. Sequence
deliberately — additive migration applied *first*, then the code that uses it;
and write code that degrades gracefully if the migration isn't there yet
(soft-skip, feature-flag, or null-check) rather than assuming.

## Scale the gate to the change

A one-line label fix and a posting-RPC change do not get the same gate. Applying
the full battery to trivia trains everyone to treat the gate as noise, so it
erodes when it matters. Use `erp-guardian`'s risk tiers:

- **LOW** (copy, CSS, icons): `tsc` + build green. Commit. That's the release.
- **MEDIUM** (forms, filters, lists): + drive it in the browser (states, a bad
  input rejected), + the regression suite. Commit.
- **HIGH** (reports, API, permissions): + verify the *numbers* against a
  known-good source, + a cross-tenant check, + confirm no API contract break.
- **CRITICAL** (posting, migrations, GL/stock, RLS, tax): + generate from the
  live def, + a locking regression test, + numeric post→assert→reverse→net-zero,
  + hand-apply steps written, + the migration verified live after Rashid applies.

Take the higher tier when unsure.

## The go/no-go gate

Before you call a change shippable, confirm — at the depth its tier demands:

1. **Builds clean.** `tsc --noEmit` + `npm run build`, no errors.
2. **The suite is green** (for MEDIUM+), run — not assumed. Never `--no-verify`
   past a red suite to ship (`test-engine`).
3. **The numbers are unchanged** where money is involved — existing confirmed
   documents reproduce identically; trial balance still nets to zero
   (`accounting-engine`). A faster or cleaner change that moves a total is a
   failed release, not a win.
4. **Tenant isolation holds** — no query lost its `company_id` scope; no new
   `anon`/`authenticated` grant on a definer function (`security-guardian`).
5. **No API contract break** — additive only, or a `/v2` (`api-guardian`).
6. **The migration is real and ordered** — additive, idempotent, hand-apply
   steps written, and sequenced before the code that needs it
   (`migration-guardian`).
7. **The change is minimal** — no unrelated refactor riding along
   (`coding-standards`).

## Stop conditions — refuse to ship if any hold

These block a release outright. Say so plainly rather than shipping anyway:

- Build or the regression suite fails.
- A posting/report change moves the numbers on existing documents.
- A cross-tenant read is possible.
- **A known live security vulnerability is open.** ⚠️ **This is currently the
  case: SEC-1 (the arbitrary-SQL RPC callable by `anon`) is open on the live DB**
  (`security-guardian` → open-findings). By this gate, the honest posture is that
  the app is in a *do-not-ship-new-surface* state for anything that widens
  exposure until SEC-1 is closed — and closing it is one `REVOKE`.
- A migration can't be applied cleanly, or a data change has no undo and hasn't
  been explicitly agreed.
- A critical regression exists.

A stop condition is not a nag — it is the skill doing its one job. Surface it,
name the fix, and let Rashid decide; don't quietly ship around it.

## After Rashid deploys — smoke check

A push is live in minutes; confirm reality matches intent. Match depth to the
change, but for anything non-trivial:

- The app boots and a known page loads (no white screen / bad-bootstrap).
- The specific thing you changed does what it should, in production.
- For a posting/report change: spot-check one real number against expectation.
- For a migration: re-run its verification query against live and confirm the
  end state (`migration-guardian` → validation).
- Nothing new is throwing (browser console / Vercel logs) — noting there is no
  error monitoring, so this manual look is the only signal (security-guardian
  E-4).

If something's wrong: `git revert` + push for code; a forward-fix migration for
the DB. Don't try to hand-edit production data to match what the release should
have produced.

## Reporting a release decision

```
Change            — what's shipping, one line
Risk tier         — LOW / MEDIUM / HIGH / CRITICAL
Verified          — what you actually ran, with real results (not "looks fine")
Numbers           — for money/report changes: confirmed unchanged, or the intended delta
Migration         — file + ordered hand-apply steps, or "none"
Deploy path       — commit (I do, on approval) → Rashid pushes → Vercel; migration applied when
Undo path         — git revert (code) / forward-fix (DB); honest about data with no undo
Stop conditions   — none, OR the ones blocking and their fix
Go / No-go        — the actual call, and confidence
```

The go/no-go line is the deliverable. "Green, ship it" and "not yet — SEC-1 open
/ numbers unverified / migration unordered" are both complete answers; a vague
"should be fine" is not.

## When to stop and ask

- A stop condition holds — surface it, don't ship around it.
- The change needs a migration and code push in an order that could break
  production if reversed — spell out the sequence and confirm.
- You cannot verify the numbers on a financial change — say so; do not report a
  green structural suite as if it were proof (`test-engine`).
- The change widens exposure while SEC-1 is open — flag the interaction.

## References

- **`references/deploy-and-smoke.md`** — the concrete deploy sequence (commit →
  push → migration ordering), the git-revert rollback steps, and a per-change-type
  post-deploy smoke checklist. Read when actually shipping something.
