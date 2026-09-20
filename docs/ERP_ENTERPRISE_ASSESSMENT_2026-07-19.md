# StockBolt v1 — Enterprise ERP Assessment (Phase 2)

### Architecture · Accounting · Performance · Scalability · Operations

| | |
|---|---|
| **Document** | `ERP_ENTERPRISE_ASSESSMENT_2026-07-19.md` |
| **Date** | 2026-07-19 |
| **Audit phase** | **Second pass** — complements, does not repeat, `SECURITY_AUDIT_2026-07-19.md` |
| **Auditor roles** | Principal Security Engineer · ERP Architect · Senior QA Engineer · Performance Engineer · Database Architect · DevOps Engineer · Enterprise Software Auditor |
| **Scope** | ERP business workflows, accounting correctness, database design, performance, scalability, UI/UX, code quality, test coverage, DevOps/DR, maintainability, enterprise feature gap analysis |
| **Live project verified** | `gzpkuaioibqrdppjdbwz` (read-only queries only) |
| **Code / DB changed** | **None** |

---

## 1. Relationship to the Phase-1 Security Audit

The Phase-1 report (`SECURITY_AUDIT_2026-07-19.md`) established the security posture and is **not repeated here**. Its findings remain open and are treated as prerequisites:

| Ref | Phase-1 finding | Status | Referenced here because |
|---|---|---|---|
| C-1 | Arbitrary-SQL RPC exposed to `anon` | **Open — P0** | Blocks any go-live decision below |
| H-1 | `audit_logs` mutable by ordinary users | **Open** | Directly drives the *auditor rejection* analysis in §9 |
| H-2 | API paid-tier gate not enforced at runtime | Open | Feeds subscription/billing integrity |
| H-4 | No environment separation | Open | Compounds the DevOps findings in §6 |

Two earlier documents also exist in `docs/` — `MULTICURRENCY_AUDIT.md` and `QUALITY_AUDIT_2026_06_02.md`. This assessment was derived independently from source and live data; where it overlaps those documents, treat this as the current reading.

---

## 2. Executive Summary

StockBolt is a **genuinely well-engineered accounting core wrapped in an operationally immature delivery pipeline**. The double-entry posting engine, moving-average costing, deferred-COGS handling, voucher-date reversal discipline and the 91-test live regression gate are of a standard well above typical SMB ERP products — several patterns here (balance-by-construction, `je_must_balance` deferred trigger, `seq`-ordered stock replay) are what a senior ERP architect would actually prescribe.

The risk is **not** in the accounting logic. It is in three other places:

1. **A latent reporting-correctness time-bomb.** Financial reports are computed in the browser over *unbounded* row fetches. PostgREST caps responses at 1,000 rows. Today every tenant is far below that cap (largest: 121 GL rows), so reports are correct. At roughly **170–250 invoices**, a tenant silently crosses the cap and the **Balance Sheet, Trial Balance and P&L begin returning materially wrong numbers with no error shown**. This is months away for an active customer, not years.
2. **No operational safety net.** No CI/CD, no error monitoring, no alerting, no documented backup/restore or disaster-recovery drill. Production issues are discovered by customers, not by systems.
3. **Enterprise-grade table stakes are absent** — year-end close, FX revaluation, approval workflows, SSO/SCIM, accessibility conformance, and (for the GCC target market) e-invoicing compliance.

**The single most valuable action in this report is a one-line fix** (server-side aggregation or explicit pagination on report queries) that converts a future silent-data-corruption incident into a non-event.

---

## 3. Overall Verdict

> **For its actual target market (GCC/India SMB auto-parts, 1–20 users per tenant):**
> **Conditionally deployable** — after Phase-1 C-1/H-1 and this report's E-1/E-2 are closed.
>
> **For a multinational enterprise procurement evaluation:**
> **Would be rejected** at the vendor-assessment stage — not on accounting quality, but on operational maturity, compliance, and governance evidence (§9).

It is important to separate these. The product is much closer to "good SMB ERP" than the enterprise score implies; it is nowhere near "enterprise ERP," and it does not need to be to succeed commercially.

---

## 4. Severity Summary

| ID | Severity | Finding | Area | Effort |
|---|---|---|---|---|
| **E-1** | 🔴 **High** | Report queries silently truncate at 1,000 rows → wrong financial statements at scale | Reporting / Data correctness | S |
| **E-2** | 🟠 **High** | Double-post guard is TOCTOU-racy — concurrent confirm can double-post the GL | Concurrency / Accounting | S |
| **E-3** | 🟠 **High** | No CI/CD; sole quality gate is a locally bypassable pre-commit hook | DevOps | M |
| **E-4** | 🟠 **High** | No error monitoring, alerting, backup verification or DR plan | Operations | M |
| **E-5** | 🟡 Medium | All reporting computed client-side over unbounded fetches; no pagination or virtualization | Performance / Scalability | L |
| **E-6** | 🟡 Medium | Year-end close not implemented | Accounting | M |
| **E-7** | 🟡 Medium | FX realized gain/loss on receipts only; no period-end revaluation of open FC balances | Accounting / Multi-currency | M |
| **E-8** | 🟡 Medium | Accessibility below enterprise procurement threshold (no VPAT/WCAG evidence) | UI/UX | M |
| **E-9** | 🔵 Low | Orphaned phase-verification test suites create false coverage confidence | QA | S |
| **E-10** | 🔵 Low | No approval workflows / segregation of duties on financial documents | ERP process | M |

*Effort: S ≤ 1 day · M = 2–5 days · L > 1 week*

---

## 5. Detailed Findings

### 🔴 E-1 — Financial reports silently truncate at 1,000 rows

**Severity:** High (data correctness) · **Priority:** P1 — before the next customer grows · **Effort:** S

**Screens/files affected:** `src/data/supabaseAdapter.ts:1998` (`getBalanceSheet`), and the same pattern across Trial Balance, P&L, Cash Flow, VAT Return, GL and Statement report paths. Surfaces: Reports → Balance Sheet, Trial Balance, Profit & Loss, Cash Flow, VAT Return.

**Evidence.** The Balance Sheet fetches every GL row for the company with **no `.limit()` and no `.range()`**, then aggregates in JavaScript:

```ts
// src/data/supabaseAdapter.ts:2004
const { data, error } = await client
  .from('general_ledger')
  .select('account_code, debit, credit, chart_of_accounts!inner(name, type, sub_type)')
  .eq('company_id', company_id)
  .lte('date', as_of_date);          // ← unbounded
```

PostgREST caps every response. The project config sets:

```toml
# supabase/config.toml:18
max_rows = 1000
```

Live data (read-only count, 2026-07-19):

| Tenant | GL rows |
|---|---:|
| Pro_Parts | 121 |
| IMBD123 | 15 |
| all others | 0 |
| **whole database** | **601** |

**Impact.** Today the reports are **correct** — every tenant is an order of magnitude below the cap. The failure is latent and silent. A confirmed invoice writes roughly 4–6 GL rows (AR, revenue, VAT, COGS, inventory, round-off). The 1,000-row cap is therefore reached at **≈170–250 invoices**. At that point the Balance Sheet, Trial Balance and P&L begin computing over a **truncated subset** and report **understated, wrong figures with no error, no warning, and no visual cue**. A business would file VAT returns off these numbers.

This is the most dangerous class of defect in accounting software: it does not crash, it lies.

**Root cause.** Reporting was implemented as client-side aggregation over raw GL rows — architecturally convenient early on, but it inherits the API row cap as an invisible correctness boundary. The Balance Sheet's own `balanced` check (`balance-sheet.tsx:252`, tolerance 0.02) would begin failing, but it renders as a soft indicator rather than blocking the report.

**Recommended fix (in order of preference).**

1. **Server-side aggregation (correct fix).** Move each report to a SQL aggregate RPC returning grouped totals rather than raw rows — a Balance Sheet should return ~30 rows regardless of ledger size:
   ```sql
   CREATE OR REPLACE FUNCTION public.get_balance_sheet(p_company_id uuid, p_as_of date)
   RETURNS TABLE(account_code text, account_name text, account_type text,
                 sub_type text, balance numeric)
   LANGUAGE sql STABLE SECURITY INVOKER SET search_path = public AS $$
     SELECT gl.account_code, coa.name, coa.type, coa.sub_type,
            SUM(CASE WHEN coa.type = 'asset' THEN gl.debit - gl.credit
                     ELSE gl.credit - gl.debit END)
     FROM public.general_ledger gl
     JOIN public.chart_of_accounts coa ON coa.code = gl.account_code
                                      AND coa.company_id = gl.company_id
     WHERE gl.company_id = p_company_id AND gl.date <= p_as_of
     GROUP BY 1,2,3,4;
   $$;
   ```
   This also removes the memory and transfer cost entirely, and respects RLS via `SECURITY INVOKER`.
2. **Interim guard (ship today).** Add an explicit high `.range(0, 99999)` **and** a row-count assertion that throws a visible error if the returned count hits the ceiling — *fail loudly rather than report wrongly*.
3. **Add a regression tripwire** that seeds >1,000 GL rows for a scratch company and asserts the Balance Sheet still balances.

---

### 🟠 E-2 — Double-post guard is a TOCTOU race; concurrent confirm can double-post the GL

**Severity:** High · **Priority:** P1 · **Effort:** S

**Screens/files affected:** `supabase/migrations/20260606000002_phase14_14o_extend_double_post_guard.sql:40`; every confirm path (Invoice, Vendor Bill, Credit/Debit Note, POS, Payment, Expense, PDC).

**Evidence.** `_guard_no_double_post()` is a `BEFORE INSERT` trigger that performs a **read** to detect an existing canonical JE:

```sql
SELECT entry_number INTO v_existing
FROM public.journal_entries
WHERE company_id = NEW.company_id
  AND source_type = NEW.source_type
  AND source_id   = NEW.source_id
  AND reversed_by_id IS NULL
  AND reversal_of_id IS NULL
  AND id <> NEW.id
LIMIT 1;
```

A repository-wide search for row-level locking in posting functions (`FOR UPDATE`, `pg_advisory_lock`) returns **no hits in any posting RPC** — the only matches are in RLS policy text and storage migrations.

**Impact.** Under PostgreSQL's default `READ COMMITTED` isolation, two concurrent transactions confirming the same document **cannot see each other's uncommitted insert**. Both pass the guard; both commit. Result: **two canonical journal entries for one invoice** — duplicated revenue, duplicated VAT, duplicated COGS and duplicated stock movement. Realistic triggers: a double-clicked Confirm button, a client retry after a timeout, two users acting on the same document, or an API retry once `POST /v1/orders` gains an auto-confirm option.

The same TOCTOU pattern applies to status checks (`IF v_inv.status = 'confirmed' THEN RAISE …`) which read without locking the document row.

**Root cause.** Correctness was enforced in application/trigger logic rather than by a database constraint. A read-check is advisory; only a constraint is atomic.

**Recommended fix.** Add a partial unique index — this makes double-posting **structurally impossible** regardless of concurrency, and the existing trigger remains as the friendly error message:

```sql
CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS
  journal_entries_one_canonical_per_source
ON public.journal_entries (company_id, source_type, source_id)
WHERE reversal_of_id IS NULL AND reversed_by_id IS NULL;
```

Additionally, take a row lock at the top of each confirm RPC:
```sql
SELECT * INTO v_inv FROM public.invoices WHERE id = p_invoice_id FOR UPDATE;
```

⚠️ Before creating the index, check live data for pre-existing duplicates (the index build will fail if any exist) — that check doubles as a valuable integrity audit.

---

### 🟠 E-3 — No CI/CD; the only quality gate is locally bypassable

**Severity:** High · **Priority:** P1 · **Effort:** M

**Evidence.** `.github/workflows/` **does not exist**. The sole automated gate is the husky pre-commit hook running the live-DB regression suite — which runs only on the developer's machine and is bypassable with `--no-verify` (and *was* bypassed for commit `a244745` earlier in this project's history).

**Impact.** Nothing validates a change before it reaches production. A `git push` deploys via Vercel with **zero** typecheck, build, lint, or test verification in the pipeline. Combined with Phase-1 H-4 (tests run against the production database), the quality system is: one developer, one machine, one database, no independent verification. This is also precisely the class of gap that allowed the posting-function drift incident to go undetected.

**Root cause.** Solo-developer workflow that never needed a shared pipeline.

**Recommended fix.** Minimum viable pipeline:
```yaml
# .github/workflows/ci.yml
name: CI
on: [push, pull_request]
jobs:
  verify:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: 20, cache: npm }
      - run: npm ci
      - run: npx tsc --noEmit
      - run: npm run build
      - run: npm run test:regressions      # against the STAGING db (Phase-1 H-4)
        env:
          VITE_SUPABASE_URL: ${{ secrets.STAGING_SUPABASE_URL }}
          SUPABASE_SECRET_KEY: ${{ secrets.STAGING_SUPABASE_SECRET }}
```
Then enable Vercel's "only deploy on passing checks."

---

### 🟠 E-4 — No monitoring, alerting, backup verification or disaster-recovery plan

**Severity:** High · **Priority:** P1 · **Effort:** M

**Evidence.** No error-tracking dependency (`sentry` / `datadog` / `logrocket` / `posthog` all absent from `package.json`). No document in `docs/` covers backup, restore, disaster recovery, monitoring or alerting — the 18 files there are architecture, phase and audit documents only.

**Positive:** a React `ErrorBoundary` exists (`src/components/error-boundary.tsx`, wired in `App.tsx`), so the UI fails gracefully — but **nothing reports the failure to anyone**.

**Impact.** For a financial system of record holding real businesses' books:
- A production exception is only known if a customer reports it.
- Supabase's automated backups exist on paid plans, but an **untested backup is not a backup** — there is no evidence of a restore drill, and no documented RPO/RTO.
- No alerting on posting failures, API error spikes, or auth anomalies.
- Enterprise buyers and auditors ask for RPO/RTO commitments in writing; there is currently no answer.

**Recommended fix.**
1. Add Sentry (or equivalent) to the React app and the Edge Function; alert on error-rate spikes.
2. Confirm Supabase PITR is enabled on the plan; **perform and document a restore drill** into a scratch project.
3. Write `docs/DISASTER_RECOVERY.md` with stated RPO/RTO, restore runbook, and last-drill date.
4. Add uptime monitoring on the app and the `/v1/me` API endpoint.

---

### 🟡 E-5 — Client-side reporting architecture caps scalability

**Severity:** Medium · **Priority:** P2 · **Effort:** L

**Evidence.** 261 `.select(` calls in `supabaseAdapter.ts`; only 10 carry any `.limit()` (`10000`, `5000`, `500`×2, `50`, `5`, `1`×4). No server-side pagination on list screens; no list virtualization (`react-window` / `@tanstack/react-virtual` / `virtuoso` all absent). Reports aggregate in JavaScript (see E-1).

**Impact.** The pattern "fetch everything, compute in the browser" has a hard ceiling:

| Scale | Behaviour |
|---|---|
| 100 companies, small ledgers | Fine (today's reality) |
| 1 company × 10k GL rows | Reports wrong (E-1) unless fixed; multi-MB transfers |
| 1 company × 1M GL rows | Architecturally infeasible in the browser |
| 100M records overall | Requires server-side aggregation + partitioning |

Mitigating factors: 117 lazily-loaded routes (good code splitting), TanStack Query with a sane 30s `staleTime` and `retry: 1`, and **no realtime subscriptions** — the last is a genuinely good decision that avoids a common multi-tenant scaling trap.

**Recommended fix.** Same direction as E-1 — push aggregation into SQL; add keyset pagination to document lists; introduce virtualization only where a list is legitimately long (stock ledger, GL).

---

### 🟡 E-6 — Year-end close is not implemented

**Severity:** Medium · **Priority:** P2 · **Effort:** M

**Evidence.** `year_end_close` exists as a `journal_entries.source_type` enum value (`20260430121200_phase0_13_…:31`) but **no closing RPC exists**. The Balance Sheet compensates with a synthetic equity line:

```ts
// src/data/supabaseAdapter.ts:2054
if (Math.abs(incomeMinusExpense) > 0.005) {
  lines.push({ account_code: '__CPE__', account_name: 'Current Period Earnings',
               account_type: 'equity', sub_type: null, balance: incomeMinusExpense });
}
```

**Impact.** Credit where due: this is a correct and thoughtful design — the accounting identity **holds today** because current-period earnings are folded into equity dynamically. The gaps are downstream:
- P&L accounts are never zeroed; retained earnings are never crystallised into a real equity account.
- No prior-year lock beyond the manual `companies.period_lock_date`.
- No audit-ready "closing entry" an external accountant can point to.
- Comparative prior-year reporting has no closed baseline.

An accountant will accept the current model for a first year; by year two they will ask where the closing entry is.

**Recommended fix.** Implement `close_fiscal_year(p_company_id, p_fy_end)` posting a `year_end_close` JE that zeroes income/expense into a retained-earnings equity account, guarded by period lock and idempotent per fiscal year. The `__CPE__` line then naturally goes to zero, exactly as the existing code comment anticipates.

---

### 🟡 E-7 — Multi-currency: realized FX on receipts only; no period-end revaluation

**Severity:** Medium · **Priority:** P2 · **Effort:** M

**Evidence.** `20260506000024_phase12_01_fx_gain_loss.sql` implements realized FX gain/loss on **customer receipts**, posting to `4400` (FX Gain) / `6900` (FX Loss) — correctly computed from the rate differential between invoice and receipt. No equivalent revaluation logic was found for period-end open balances (search for `revaluation` / `unrealized` returns nothing).

**Impact.**
- **Unrealized FX is not recognised.** Open foreign-currency AR/AP at period end are carried at historical rate, not closing rate. Under both IFRS (IAS 21) and local GCC practice, monetary items must be retranslated at the closing rate — so the Balance Sheet is misstated whenever material FC balances are open at period end.
- Vendor-side realized FX parity should be confirmed (receipts path is implemented; the payments path was not verified in this pass).

**Recommended fix.** Add a period-end revaluation routine posting unrealized gain/loss on open FC AR/AP, reversed at the start of the next period. Confirm vendor-payment FX symmetry. Note `docs/MULTICURRENCY_AUDIT.md` may already track part of this — reconcile the two.

---

### 🟡 E-8 — Accessibility below enterprise procurement threshold

**Severity:** Medium · **Priority:** P3 · **Effort:** M

**Evidence.** 54 `aria-*` attributes across the codebase against 198 `<button>` elements. No axe/lighthouse CI check. No VPAT or WCAG conformance statement.

**Impact.** Icon-only controls without accessible names are unusable by screen readers; keyboard-only navigation through data grids and modals is unverified. Enterprise and public-sector procurement routinely requires a **VPAT / WCAG 2.1 AA** statement — its absence is a hard disqualifier in those channels, and a legal exposure in some jurisdictions. Positive: RTL/Arabic support is already implemented, which is a meaningful accessibility investment.

**Recommended fix.** Add `eslint-plugin-jsx-a11y` and an axe pass in CI; give every icon-only button an `aria-label`; verify focus trapping in modals and visible focus rings.

---

### 🔵 E-9 — Orphaned phase-verification suites create false coverage confidence

**Severity:** Low · **Priority:** P3 · **Effort:** S

**Evidence.** `tests/integration/` contains `phase0-rls` through `phase11-verification` (12 files) alongside `regressions.test.ts`. Only the regression suite runs in the pre-commit hook. The phase suites' current pass/fail state is unknown.

**Impact.** A test file that never runs is documentation that may be lying. Coverage looks broader than the enforced reality (one suite, 91 assertions, all live-DB structural checks).

**Recommended fix.** Either wire them into CI (E-3) or archive them under `tests/_archive/` with a README explaining they are historical phase acceptance records. Also note the enforced suite is **structural** (does the function/policy exist) rather than **behavioural** (does posting produce correct numbers) — the highest-value test investment is transactional accounting tests on a scratch tenant: post → assert GL → reverse → assert net zero.

---

### 🔵 E-10 — No approval workflows or segregation of duties

**Severity:** Low (for SMB) / High (for enterprise) · **Priority:** P3 · **Effort:** M

**Evidence.** RBAC is well built (custom roles, per-user overrides, `has_perm`), but permissions are **capability-based, not workflow-based**: a user with `purchasing.write` can create *and* confirm a purchase of any value. No approval thresholds, no maker-checker, no delegation.

**Impact.** Segregation of duties is a standard internal-control requirement and a recurring audit finding. For SMB customers this is acceptable and often preferred; for any regulated or larger customer it is a blocker.

**Recommended fix.** Roadmap item: approval limits per role, maker-checker on documents above a threshold, and an approvals inbox.

---

## 6. Architecture Notes

**What is architecturally sound and should be preserved:**

- **GL as single financial truth**, with no cached aggregate balances — eliminates an entire class of reconciliation bugs that plague SMB ERPs.
- **Balance-by-construction** posting (amounts derived from `total − tax`) plus the `je_must_balance` deferred constraint trigger. Correctness is enforced at the database, not hoped for in the application.
- **`seq`-ordered stock replay** — the fix for uuid-tiebreak valuation drift shows real diagnostic maturity.
- **Adapter pattern** (`adapter.ts` / `supabaseAdapter.ts` / `selfHostedAdapter.ts`) keeps a self-hosted path viable and isolates the data layer.
- **`get_next_document_number` is genuinely concurrency-safe** — `INSERT … ON CONFLICT DO UPDATE SET current_value = current_value + 1` serialises correctly under contention. (Verified; contrast with E-2.)
- **No realtime subscriptions** — a deliberate-looking omission that avoids a serious multi-tenant scaling trap.

**The central architectural tension:** business logic correctly lives in the database (posting RPCs, triggers, RLS), but **reporting logic lives in the browser**. That asymmetry is the root of E-1 and E-5. Moving aggregation server-side would align reporting with the rest of the architecture and resolve both.

**Migration process risk:** migrations are applied by hand, which already caused one production drift incident and one silent half-applied migration (Phase-1 context). The `DROP POLICY IF EXISTS` lesson was learned; the underlying manual process remains the weak link and should move to CI-driven `supabase db push` against staging, then production.

---

## 7. ERP Feature Gap Analysis

### Critical (blocks credible ERP positioning)
| Gap | Note |
|---|---|
| Year-end close | E-6 |
| Server-side reporting at scale | E-1 / E-5 |
| Audit-log immutability | Phase-1 H-1 |
| Backup/restore drill + documented DR | E-4 |
| **E-invoicing compliance (GCC)** | KSA ZATCA Phase 2 is mandatory; UAE is phasing in a Peppol-based mandate. **Verify current obligations for your target countries** — for a GCC-focused ERP this can become a market-access blocker rather than a feature request. India GST e-invoicing/IRN applies above turnover thresholds. |

### Recommended (expected by mid-market buyers)
Fixed assets & depreciation · Budgets vs actuals · Recurring invoices & subscriptions billing · Automated dunning / reminder statements · Bank feed import & assisted reconciliation · FX period-end revaluation (E-7) · Multi-warehouse transfer approvals · Batch/expiry tracking · Consolidated multi-company reporting · Approval workflows (E-10)

### Optional (competitive differentiators)
Bin/location management · Cycle counting · Label & barcode printing (partially present) · CRM pipeline · Customer/supplier portal · Mobile stock-take app · Advanced pricing rules & promotions

### Future roadmap
BI/analytics workspace · Demand forecasting & reorder suggestions · EDI/supplier integration · IFRS reporting packs · Multi-entity consolidation with intercompany elimination · SSO (SAML/OIDC) + SCIM provisioning

---

## 8. Production Readiness

| Dimension | State | Blocking? |
|---|---|---|
| Accounting engine correctness | Strong | No |
| Reporting correctness at current scale | Correct today | No |
| Reporting correctness at 250+ invoices | **Silently wrong** | **Yes — E-1** |
| Concurrency safety | Racy on confirm | **Yes — E-2** |
| Security posture | P0 open | **Yes — Phase-1 C-1** |
| Audit trail integrity | Mutable | **Yes — Phase-1 H-1** |
| CI/CD | Absent | Yes — E-3 |
| Monitoring & alerting | Absent | Yes — E-4 |
| Backup / DR evidence | Absent | Yes — E-4 |
| Accessibility conformance | Partial | Enterprise only |
| Scalability beyond ~50 tenants | Requires rework | Not yet |

---

## 9. Enterprise Evaluation — "Would a multinational approve this?"

**No — it would not pass vendor assessment.** Specifically:

**What Procurement would reject:** no SOC 2 / ISO 27001, no DR plan with stated RPO/RTO, no SLA, no penetration-test report, no SSO/SCIM, no VPAT, single-developer bus factor, no escrow.

**What IT Security would reject:** the Phase-1 P0 (anon arbitrary-SQL), no environment separation, no CI/CD gating, no monitoring, no incident-response process.

**What External Auditors would reject:** **mutable audit logs (Phase-1 H-1)** — this alone fails an IT general-controls review; no segregation of duties (E-10); no year-end close entry (E-6); no change-management evidence (E-3).

**What Accountants would question:** no unrealized FX revaluation (E-7); no closing entries; the report-truncation risk once explained (E-1) would halt sign-off immediately; no comparative prior-year statements from a closed baseline.

**What enterprise customers would expect and not find:** approval workflows, multi-entity consolidation, budget control, fixed assets, granular field-level audit history, API rate-limit SLAs, sandbox environment.

**However — reframed for the real market:** for a GCC/India SMB auto-parts business with 1–20 users, StockBolt's accounting core is **stronger than several commercial competitors in that segment**. The correct strategic reading is not "fix everything on this list," but: close E-1/E-2 and the Phase-1 P0s now, build the operational safety net (E-3/E-4) next, and treat the enterprise gap list as a deliberate market-positioning decision rather than a defect backlog.

---

## 10. Scores

| Dimension | Score | Rationale |
|---|---:|---|
| **Accounting Integrity** | **84 / 100** | Excellent engine; deductions for year-end close (E-6) and FX revaluation (E-7). |
| **Data & Reporting Correctness** | **55 / 100** | Correct today, silently wrong at modest scale (E-1). Weighted for severity of silent failure. |
| **ERP Functional Completeness** | **72 / 100** | Broad module coverage; missing fixed assets, budgets, approvals, e-invoicing. |
| **Performance & Scalability** | **45 / 100** | Client-side aggregation, no pagination/virtualization. Good code splitting partially offsets. |
| **DevOps & Operational Maturity** | **30 / 100** | No CI/CD, no monitoring, no DR evidence, manual migrations, prod-as-test-DB. |
| **Code Quality & Maintainability** | **76 / 100** | Clean layering, strong typing, well-documented; heavy adapter file, orphaned tests. |
| **UI/UX & Accessibility** | **68 / 100** | Coherent design system, i18n/RTL, error boundary; a11y and large-list UX lag. |
| **Enterprise Readiness (multinational)** | **38 / 100** | Fails governance, compliance and operational-evidence gates (§9). |
| **SMB Market Readiness (actual target)** | **71 / 100** | Genuinely competitive once E-1, E-2 and Phase-1 P0s are closed. |

---

## 11. Final Deployment Recommendation

**Do not deploy to new paying customers until the following are closed, in this order:**

| # | Item | Ref | Effort |
|---|---|---|---|
| 1 | Revoke/drop the arbitrary-SQL RPC from production | Phase-1 **C-1** | minutes |
| 2 | Make `audit_logs` append-only | Phase-1 **H-1** | hours |
| 3 | Fail-loud guard on report row-count, then server-side aggregation | **E-1** | hours → days |
| 4 | Partial unique index preventing double-posted JEs | **E-2** | hours |
| 5 | Separate staging database; move tests off production | Phase-1 **H-4** | 1 day |
| 6 | Minimum CI pipeline (typecheck + build + tests) | **E-3** | 1 day |
| 7 | Error monitoring + verified restore drill + DR doc | **E-4** | 2–3 days |

**Items 1–4 are approximately one focused day of work** and convert the two highest-consequence risks — a live data breach and a future silent misstatement of customers' financial statements — into non-issues.

**Existing customers** (`IMBD123`, `Pro_Parts`) are **not currently affected by E-1** — both are far below the truncation threshold, and their reports are correct today. There is no need for alarm or customer notification on that finding, but the clock is running: at current growth, the threshold arrives within months.

The engineering judgement in this codebase is good. What is missing is not skill — it is the operational scaffolding that turns good engineering into a dependable service. That gap is smaller, and cheaper to close, than it looks.

---

*Prepared 2026-07-19. No code or database state was modified during this assessment; all live queries were read-only counts and metadata reads. Complements — does not supersede — `SECURITY_AUDIT_2026-07-19.md`, whose findings remain open.*
