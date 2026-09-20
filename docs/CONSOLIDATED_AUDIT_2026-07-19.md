# StockBolt ERP — Consolidated Prioritized Audit

### One backlog, all domains, one severity ranking

| | |
|---|---|
| **Date** | 2026-07-19 |
| **Method** | Skill-driven review across architecture, accounting, inventory, database, reports, security, API, performance, business rules. Read-only; no code modified. |
| **Consolidates** | `SECURITY_AUDIT_2026-07-19.md`, `ERP_ENTERPRISE_ASSESSMENT_2026-07-19.md`, `PRODUCTION_CERTIFICATION_2026-07-19.md`, `MULTICURRENCY_AUDIT.md` into one prioritized, per-issue backlog. |
| **Provenance** | ✅ *live* = verified against the live DB earlier this session · 📄 *source* = read from code/migrations. No fixes have landed since, so live findings remain current. |

**Verdict:** the accounting/inventory *engine* is strong; the risk is concentrated in a handful of silent-wrongness and operational-maturity gaps. **Two Criticals block responsible operation**, and one of them (C1) is a live, unauthenticated, cross-tenant data breach. Everything below C1 is secondary to closing it.

The unifying failure mode across the serious items is **silent wrongness** — a confident wrong number or an invisible breach, not a crash. That is why they rank above cosmetic or feature gaps.

---

## 🔴 CRITICAL

### C1 — Arbitrary-SQL RPC callable by `anon` (live cross-tenant breach) ✅ live
- **Root cause:** `public._regression_test_query(text)` is a `SECURITY DEFINER` function executing arbitrary SQL, with `EXECUTE` granted to `anon` + `authenticated`. A fresh `CREATE FUNCTION` default-grants to PUBLIC; the intended REVOKE never took effect live. It's a test helper that reached production (root cause: tests run on the prod DB — H4).
- **Affected files:** live DB object; defined in `tests/integration/regressions.test.ts` (~line 77).
- **Business impact:** **Catastrophic.** The anon key ships in the browser bundle, so anyone on the internet can run `SELECT` across every tenant's data — all financials, PII, `auth.users`, `api_keys` hashes — bypassing RLS entirely. Total confidentiality loss for all customers.
- **Recommended fix:** `REVOKE ALL ON FUNCTION public._regression_test_query(text) FROM PUBLIC, anon, authenticated;` immediately; then `DROP FUNCTION` it from prod entirely (belongs only in a test DB — see H4).
- **Dependencies:** the regression suite uses it via `service_role` (unaffected by the revoke). Full removal depends on H4 (separate test DB).
- **Regression test:** assert no `public` `SECURITY DEFINER` function grants EXECUTE to `anon`/`authenticated` without an internal auth gate (would have caught this at commit). See `security-guardian` → threat-model probe 1.

### C2 — Currency picker + non-converting posting = silent GL misstatement 📄 source (data ✅ clean)
- **Root cause:** ~15 posting RPCs record `exchange_rate` on the JE header but never multiply by it, while the document currency dropdown is fully enabled offering all world currencies. A foreign-currency document posts its raw amount to the GL. Documented as intentionally deferred in `MULTICURRENCY_AUDIT.md` §2 — but the UI gate was never applied.
- **Affected files:** `src/modules/sales/invoice-editor.tsx` (~L972), `src/modules/sales/quote-editor.tsx`, `src/modules/purchasing/vendor-bill-editor.tsx`, `src/modules/purchasing/po-editor.tsx`; `src/lib/currencies.ts` (`currencyOptions` returns all currencies); the ~15 confirm/edit RPCs.
- **Business impact:** **Severe, silent.** A 1,000 USD invoice posts as 1,000 AED. The JE still balances (1000=1000), so `je_must_balance`, the regression suite, and every guard pass with no error. AR, VAT return, P&L and Balance Sheet all silently wrong → wrong tax filing. **Live data is currently clean** (0 non-base-currency documents, all rates = 1) — a loaded gun not yet fired.
- **Recommended fix:** lock the currency field to the company base currency in all four editors (and any import/API path); optionally a `CHECK (currency = base_currency)` as backstop. Do **not** "fix" by converting — either finish the engine per `MULTICURRENCY_AUDIT.md` §6 acceptance gates or remove the picker. No middle state.
- **Dependencies:** none for the UI lock. Full multi-currency = a scoped engine project.
- **Regression test:** assert no document row exists with `currency <> base_currency OR exchange_rate <> 1` across invoices/bills/quotes/POs/CN/DN (`accounting-engine` → verification query 7).

---

## 🟠 HIGH

### H1 — Financial reports silently truncate at the 1,000-row API cap 📄 source
- **Root cause:** reports fetch all GL rows into the browser with unbounded `.select()` and aggregate in JS; PostgREST caps responses at `max_rows` (1000, `supabase/config.toml`). Past the cap the query **truncates without error**.
- **Affected files:** `src/data/supabaseAdapter.ts` (`getBalanceSheet` ~L1998, plus TB/P&L/Cash Flow/VAT/GL/statement paths); `supabase/config.toml:18`.
- **Business impact:** correct today (whole DB ~601 GL rows), but at ~170–250 invoices per tenant the Balance Sheet / TB / P&L begin computing over a truncated subset and **understate silently**. Decisions and VAT filings on wrong data.
- **Recommended fix:** move aggregation into SQL RPCs (`SECURITY INVOKER`, ~30 rows returned regardless of ledger size); interim, add a fail-loud row-count guard that throws rather than renders a partial total.
- **Dependencies:** touches every statement report; do the Balance Sheet first as the template.
- **Regression test:** seed a scratch company with >1,000 GL rows and assert the Balance Sheet still balances (`database-guardian` → query-and-index).

### H2 — Double-post guard is a TOCTOU read-check (concurrent confirm duplicates the GL) 📄 source
- **Root cause:** `_guard_no_double_post()` is a `BEFORE INSERT` trigger that `SELECT`s for a conflicting JE; no posting RPC takes a `FOR UPDATE` lock and there is no unique index. Under READ COMMITTED two concurrent confirms don't see each other's uncommitted insert.
- **Affected files:** `supabase/migrations/20260606000002_phase14_14o_extend_double_post_guard.sql`; all confirm RPCs.
- **Business impact:** a double-clicked Confirm, a client retry, two users, or (once auto-confirm exists) an API retry can post revenue, VAT, COGS and stock **twice**. High severity, low-but-real frequency.
- **Recommended fix:** partial unique index `journal_entries (company_id, source_type, source_id) WHERE reversal_of_id IS NULL AND reversed_by_id IS NULL`; keep the trigger for the friendly message. Add `SELECT … FOR UPDATE` on the document at the top of each confirm RPC.
- **Dependencies:** check for existing duplicates before building the index (it fails if any exist — itself a useful audit).
- **Regression test:** assert the unique index exists; assert zero source docs have >1 live canonical JE (`accounting-engine` → verification query 8).

### H3 — Audit logs are editable/deletable by ordinary users ✅ live
- **Root cause:** `audit_logs` carries a single `FOR ALL` policy (`tenant_isolation`), which covers UPDATE and DELETE. Absent from the write-lockdown list; no immutability trigger.
- **Affected files:** `supabase/migrations/20260430121600_phase0_17_rls_policies.sql:44`.
- **Business impact:** any authenticated user can rewrite or delete their own company's audit trail — the one table that must be immutable. Fails IT general controls; enables fraud cover-up.
- **Recommended fix:** `FORCE ROW LEVEL SECURITY`; replace with a SELECT-only read policy + `INSERT WITH CHECK (false)` (definer posting fns bypass RLS); omit UPDATE/DELETE policies so both are denied.
- **Dependencies:** none.
- **Regression test:** assert `audit_logs` has no policy with `cmd = 'ALL'` (`security-guardian` → open-findings SEC-2).

### H4 — No environment separation: tests run against the production database ✅ live (config)
- **Root cause:** `.env.local` and the husky pre-commit suite point at the live project; no staging.
- **Affected files:** `.env.local`, `package.json` (`test:regressions`), `.husky/pre-commit`.
- **Business impact:** root cause behind C1 reaching prod and behind the posting-drift incident going unnoticed. Every test run touches customer data.
- **Recommended fix:** stand up a separate Supabase project for dev/test; point `.env.local` + CI at it; keep prod migration-only.
- **Dependencies:** unblocks the full removal of C1's helper and enables H5 (CI) and behavioural accounting tests.
- **Regression test:** N/A (process); verify CI uses the staging URL.

### H5 — No CI; the only gate is a locally bypassable pre-commit hook 📄 source
- **Root cause:** `.github/workflows/` does not exist. `git push` → Vercel deploys with no typecheck/build/test gate; the hook is bypassable with `--no-verify` (and was, once).
- **Affected files:** absent `.github/workflows/ci.yml`.
- **Business impact:** nothing independent validates a change before production.
- **Recommended fix:** minimal CI (`tsc --noEmit`, `npm run build`, `test:regressions` against staging); enable Vercel "deploy only on passing checks."
- **Dependencies:** H4 (staging DB for the test job).
- **Regression test:** N/A (process).

### H6 — No monitoring, alerting, or tested backup/DR 📄 source
- **Root cause:** no error-tracking dependency (`sentry`/`datadog`/etc. absent); no DR doc; no evidence of a restore drill.
- **Affected files:** `package.json`; absent `docs/DISASTER_RECOVERY.md`.
- **Business impact:** production exceptions are only known when a customer reports them; "we can restore" is unproven for a system of record. Blocks enterprise/auditor sign-off.
- **Recommended fix:** add Sentry to app + Edge Function; confirm Supabase PITR; perform and document a restore drill with stated RPO/RTO; add uptime monitoring on the app and `/v1/me`.
- **Dependencies:** none.
- **Regression test:** N/A (process).

### H7 — Public API paid-gate not enforced at runtime ✅ (grep-confirmed absent)
- **Root cause:** `company_has_api_access()` is checked at key creation, never per request in the Edge Function.
- **Affected files:** `supabase/functions/api/index.ts` (`authenticate()`).
- **Business impact:** a downgraded/cancelled tenant keeps full API access via existing keys — access-control drift + revenue leakage.
- **Recommended fix:** in `authenticate()`, verify entitlement after resolving the key (join or gate helper), 402/403 if absent; cache per company ~60s.
- **Dependencies:** none.
- **Regression test:** API integration test: a key on a non-entitled company → 402/403.

### H8 — `xlsx` (SheetJS) HIGH prototype-pollution/ReDoS, parses user uploads; `ws` HIGH 📄 source
- **Root cause:** `xlsx` npm build carries an unfixed HIGH advisory; the Import feature parses attacker-supplied `.xlsx`. `ws` has a HIGH advisory with a fix.
- **Affected files:** `package.json`; `src/modules/settings/import-export/_io/`.
- **Business impact:** prototype pollution from a crafted upload → potential auth/logic bypass or DoS.
- **Recommended fix:** `npm audit fix` (handles `ws`); migrate `xlsx` to the maintained SheetJS distribution or `exceljs`; size-cap uploads; parse in a Web Worker.
- **Dependencies:** none.
- **Regression test:** N/A (dependency); add an upload size/type guard test.

---

## 🟡 MEDIUM

### M1 — Missing security headers (CSP, HSTS, Permissions-Policy) 📄 source
- **Root cause/affected:** `vercel.json` sets X-Frame-Options/X-Content-Type-Options/Referrer-Policy but not CSP/HSTS/Permissions-Policy.
- **Impact:** no compensating control if an XSS lands, and the JWT lives in localStorage (token theft). **Fix:** add the three headers; roll CSP out report-only first. **Deps:** none. **Test:** N/A (config); optional header-presence check.

### M2 — API rate limiter is fail-open and racy 📄 source
- **Root cause/affected:** `supabase/functions/api/index.ts` `rateLimited()` — counts `api_request_log` after responding, treats a query error as 0.
- **Impact:** a burst passes; an error disables the limit. Fine as a courtesy bump, wrong as a control. **Fix:** atomic per-key/per-minute counter that fails closed. **Deps:** none. **Test:** N/A.

### M3 — Order endpoint builds a PostgREST `.or()` filter by string interpolation 📄 source
- **Root cause/affected:** `createOrder()` in the Edge Function interpolates `sku` into an `.or()` string, stripping only `"`.
- **Impact:** low-risk filter injection, contained within company scope (ANDed `.eq(company_id)`), but a smell. **Fix:** parameterized `.in('sku', skuArray)`. **Deps:** none. **Test:** order create with a sku containing `,`/`)` behaves.

### M4 — Year-end close not implemented 📄 source
- **Root cause/affected:** `year_end_close` is a valid `source_type` but no closing RPC exists; Balance Sheet compensates with a synthetic `__CPE__` equity line (`supabaseAdapter.ts:2054`).
- **Impact:** correct mid-period, but income/expense never zeroed, no crystallised retained earnings, no closing entry an accountant can point to, no closed comparatives. **Fix:** `close_fiscal_year()` posting a `year_end_close` JE, period-lock-guarded, idempotent per year. **Deps:** period-lock. **Test:** post close → income/expense accounts net zero, retained earnings moved.

### M5 — Multi-currency: realized FX on receipts only; no period-end revaluation 📄 source
- **Root cause/affected:** `20260506000024_phase12_01_fx_gain_loss.sql` handles receipt-side realized FX (4400/6900); no unrealized revaluation; vendor-payment FX symmetry unverified.
- **Impact:** open FC AR/AP carried at historical rate misstate the Balance Sheet at period end (IAS 21). *(Gated behind C2 — irrelevant until multi-currency is real.)* **Fix:** period-end revaluation posting unrealized gain/loss, reversed next period; confirm vendor FX parity. **Deps:** C2. **Test:** revaluation posts and reverses; TB still balances.

### M6 — Client-side aggregation / no pagination caps scalability 📄 source
- **Root cause/affected:** 261 `.select(` in the adapter, ~10 with limits; no keyset pagination; no list virtualization.
- **Impact:** fine now; the client-side ceiling (H1) is the first wall; large tenants need server aggregation + pagination. **Fix:** SQL aggregation (shared with H1) + keyset pagination on document lists. **Deps:** overlaps H1. **Test:** covered by H1's large-dataset test.

### M7 — Accessibility below procurement threshold 📄 source
- **Root cause/affected:** 54 `aria-*` vs 198 `<button>`; no axe/lighthouse gate; no VPAT.
- **Impact:** icon-only controls unusable by screen readers; disqualifying for public-sector/enterprise procurement. Positive: RTL/Arabic is real. **Fix:** `eslint-plugin-jsx-a11y` + axe in CI; `aria-label` on icon buttons; modal focus-trap audit. **Deps:** H5 (CI). **Test:** axe pass in CI.

---

## 🔵 LOW

| ID | Issue | Root cause / file | Impact | Fix | Test |
|---|---|---|---|---|---|
| L1 | Orphaned phase-verification test suites | `tests/integration/phase0–11-*.test.ts` exist but aren't run by the hook | False coverage confidence | Wire into CI or archive with a README | N/A |
| L2 | No approval workflow / segregation of duties | RBAC is capability-based; anyone with write can create+confirm at any value | Recurring audit finding; blocker for larger customers, acceptable for SMB | Roadmap: approval limits, maker-checker | N/A |
| L3 | API CORS `Access-Control-Allow-Origin: *` | Edge Function | Acceptable (bearer auth, no cookies); note only | Optional origin allow-list | N/A |
| L4 | JWT/session in localStorage | Supabase default | XSS-exfiltration risk; mitigated by zero `dangerouslySetInnerHTML` + React escaping; CSP (M1) is the real control | Ship M1 | N/A |
| L5 | Order idempotency race | No unique index on `invoices (company_id, reference)` | Two simultaneous first-time retries could double-create | Add partial unique index | assert index exists |
| L6 | Public storage buckets world-readable | `logos`, `products` public (by design); `attachments` private ✅ | Catalog/logo scraping; ensure nothing sensitive ever written there | Keep sensitive files in `attachments`; note only | N/A |

---

## What is genuinely solid (calibration)

- ✅ **RLS on all 124 tables; no anon table grants** (✅ live earlier this session) — the table layer is tight; the breaches are at the function-grant and policy-verb level, not RLS.
- ✅ **Double-entry engine:** balance-by-construction, `je_must_balance` deferred trigger, voucher-date reversals, `seq`-ordered stock replay, deferred-COGS, negative-stock guard, round-off discipline.
- ✅ **`get_next_document_number` is concurrency-safe** (`INSERT … ON CONFLICT DO UPDATE`) — contrast with H2.
- ✅ **API:** hash-only keys (192-bit CSPRNG), explicit tenant scoping in service-role code, idempotency by external-ref, field allow-lists excluding `cost_at_sale`, draft-invoice intake (no direct posting).
- ✅ **No `dangerouslySetInnerHTML`; service key never in `src/`; secrets gitignored.**
- ✅ **91-test live regression suite gating commits**, and a document drill-down + print system + EN/AR RTL that are ahead of the segment.

---

## Fix order (the one that matters)

| # | Item | Effort | Why now |
|---|---|---:|---|
| 1 | **C1** — revoke/drop the anon SQL RPC | minutes | Live internet-exploitable breach |
| 2 | **C2** — lock currency pickers to base | hours | Silent GL misstatement, one dropdown away |
| 3 | **H1** — report row-count guard, then SQL aggregation | hours→days | Silent misstatement clock, months out |
| 4 | **H2** — unique index preventing double-post | hours | Duplicated revenue/VAT/stock |
| 5 | **H3** — `audit_logs` append-only | hours | Tamperable audit trail |
| 6 | **H4** — staging DB; move tests off prod | 1 day | Root cause of C1; unblocks H5 |
| 7 | **H5 / H6** — CI + monitoring + restore drill | 2–3 days | The operational safety net |

**Items 1–5 are roughly one focused day and retire the live breach plus all three silent-misstatement paths.** No existing customer data is currently wrong (C2 data clean, ledgers below the H1 threshold) — the defects are latent, caught before harm.

---

*Read-only assessment; no code or database state modified. Live findings verified against project `gzpkuaioibqrdppjdbwz` earlier this session; no fixes have landed since, so they remain current. Supersedes nothing — it consolidates the four prior docs into one actionable backlog.*
