# StockBolt Working Process

The mechanics of how changes ship safely to a live product. Follow these
exactly — each exists because the shortcut version broke something once.

## Contents

1. Tenants & environments
2. Migration workflow (the generator pattern)
3. Probe scripts
4. Regression suite conventions
5. Verification & preview
6. Git protocol
7. External services
8. Backlog & known residuals

## 1. Tenants & environments

| Tenant | Who | Rules |
|---|---|---|
| Al Noor | Rashid's test company | Safe to create test documents; still never bulk-delete |
| Pro_Parts | Real customer (actively testing) | Read-only for you; data fixes only via reviewed migrations |
| IMBD123 | Real customer (nabeelayar@gmail.com) | NEVER reset or modify |

There is ONE database — localhost dev and production Vercel both point at the
live Supabase project. Treat every query as production. Dev server: Rashid
runs his own on **5173** (hot-reloads your edits); preview verification uses
**5273** via the session `.claude/launch.json`.

## 2. Migration workflow (the generator pattern)

Rashid applies every migration by hand (Supabase SQL Editor). Files go in
`supabase/migrations/YYYYMMDDNNNNNN_phaseNN_slug.sql`.

When changing an existing DB function:

1. **Dump the LIVE definition** — never trust migration files (they drift):
   throwaway `scripts/_gen_phaseNN.mjs` using `.env.local` +
   `_regression_test_query` RPC →
   `SELECT pg_get_functiondef(p.oid) FROM pg_proc p JOIN pg_namespace n …
   WHERE nspname='public' AND proname='…' AND prokind='f'`.
2. **Normalize CRLF** (`def.replace(/\r\n/g, '\n')`) — Windows line endings
   silently break multi-line replacements.
3. **Apply replacements with verified occurrence counts** — a
   `replaceCounted(src, from, to, expectedCount)` helper that HARD-FAILS on
   any mismatch. Apply longer/overlapping patterns first.
4. Assemble the migration: header comment explaining the why, the full
   `CREATE OR REPLACE FUNCTION`, any data repair/backfill (additive, NULL-safe,
   skip locked periods via `period_lock_date`), and end with
   `NOTIFY pgrst, 'reload schema';`.
5. **Delete the generator script** after the file is written.
6. Give Rashid the exact steps: which file, paste whole file, Run.

Data repairs must never rewrite customer history destructively — fill NULLs,
re-date to voucher dates, recompute derived rows; never delete.

## 3. Probe scripts

For diagnosing live data: `scripts/_probe_<topic>.mjs` — dotenv `.env.local`,
`createClient(VITE_SUPABASE_URL, SUPABASE_SECRET_KEY)`, read-only SQL via
`_regression_test_query`. Print compact JSON. **Delete the script when done.**
Never write/UPDATE from a probe. When joining across documents, always filter
by `company_id` — document numbers repeat across tenants (INV-1004 exists in
multiple companies).

## 4. Regression suite conventions

`tests/integration/regressions.test.ts` runs against the LIVE DB
(`npm run test:regressions`, also via husky pre-commit — a red suite blocks
Rashid's commits, so:

- **Feature/source markers**: assert function bodies contain the fixed
  pattern (`prosrc LIKE '%…%'`) — locks the fix against regression.
- **Soft-skip gates**: tests for not-yet-applied migrations check a marker
  first and `console.warn + return` if absent — never fail on pending
  migrations.
- **Tenant-data drift checks WARN, never fail** — customer data must not
  block dev commits. Structural invariants (GL balance, dates) may hard-fail.
- Prefer behavior markers over comment strings (comments get stripped).

## 5. Verification & preview

Every change: `npx tsc --noEmit` and `npm run build` must pass. UI changes:
verify in the preview browser on 5273 (snapshot for structure, screenshot for
look, console for errors); auth-gated pages can't be signed into — verify
compile+boot and have Rashid check visually on his 5173 server. Test Arabic
(toggle → `dir=rtl`) for any new UI text.

## 6. Git protocol

- Rashid runs `git push` himself — never push. Commit only when he approves;
  usually you hand him the exact `git add` + `git commit` commands.
- Commit style: `[PhaseNN] Imperative summary`, body optional, always ending
  `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`.
- Pre-commit runs the regression suite (live DB, needs `.env.local`).
- Edits go to the MAIN repo (`E:/stockbolt_clean/stockbolt-v1/...`) via
  absolute paths even when the session runs in a `.claude/worktrees/*`
  worktree — Rashid's dev server and git operate on the main repo.

## 7. External services

- **Vercel** deploys from GitHub on push (Rashid's push = deploy).
- **Supabase**: Auth providers (Google OAuth configured — client in Google
  Cloud project "StockBolt"), URL Configuration must allow-list
  `/auth/callback` and `/verify-email` on both prod + localhost origins.
- **PayPal** billing: `docs/PayPal_Setup_Steps.md`.
- Env: client uses `VITE_SUPABASE_URL` + publishable key;
  `SUPABASE_SERVICE_ROLE_KEY` is Vercel-server-only; local scripts/tests use
  `.env.local` (`SUPABASE_SECRET_KEY`). Never print or commit key values.

## 8. Backlog & known residuals

Parked (need fresh approval before building):
- Negative-cash posting guard; Balance Sheet RE/CPE split; re-date phase42's
  150 COGS flush JE to its sale date.
- Retroactive COGS revaluation engine (purchase-cost edits re-cost sold
  stock — the COM-001 class of drift; Stage-2 plan exists).
- RPC-internal permission gates (posting functions re-checking permissions
  server-side); GL read-lock.
- Orange app re-theme; dark mode for the landing page; Terms/Privacy pages
  (register page references them as plain text); POS salesperson picker;
  product-image thumbnails on dashboard (products have `image_urls`).
- SaaS M4+ (billing invoices/emails/admin/enforcement); C8b global search
  extension; Vendor Bill pure Void; master-detail rollout beyond Invoices.

Known data quirks: IMBD123 has ~210.59 E1 drift (deferred-COGS flush design
gap — do NOT reset); Pro_Parts shows negative cash until the customer enters
opening balances (their task).
