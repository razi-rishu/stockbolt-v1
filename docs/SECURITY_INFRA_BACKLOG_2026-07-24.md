# StockBolt — Security & Infrastructure Backlog

**Created:** 2026-07-24 · **Owner:** Rashid · **Status:** living document

This backlog consolidates every item that was **analyzed and verified during the
2026-07-19 audit cycle but intentionally deferred**, plus the remaining audit
items that were never started. Each item was re-investigated against live code/DB
before deferral, so the descriptions reflect the *actual* system, not the audit's
original wording.

Legend — **Effort:** S ≤ 1 day · M 2–4 days · L 1–2 weeks · XL multi-week.
**Priority:** High / Medium / Low. **Staging first?** = should be built/verified on
a non-prod copy before touching production.

## At-a-glance

| ID | Item | Category | Priority | Effort | Downtime | Staging first |
|----|------|----------|----------|--------|----------|---------------|
| INFRA-1 | Staging environment (H4 P1–P7) | Infrastructure | **High** | L | No | N/A (is staging) |
| INFRA-2 | Backup / PITR / restore drill + DR runbook (H6-P3) | Infrastructure | **High** | M | No | Drill on non-prod |
| INFRA-3 | Server-side aggregation + pagination (H1 / M6) | Infrastructure | Medium | L | No | Yes |
| SEC-1 | Content-Security-Policy (M1-P2) | Security | **High** | M | No | Recommended |
| SEC-2 | Replace vulnerable `xlsx` + Web Worker parse (H8-P1b/P1c) | Security | **High** | M | No | Yes |
| SEC-3 | Auto-revoke API keys on downgrade (H7-P3) | Security | Medium | S | No | Yes |
| SEC-4 | Dependency advisories (`ws`, dev-tooling, react-router) | Security | Medium | S–M | No | Yes (majors) |
| SEC-5 | Order idempotency unique index (L5) | Security | Medium | S | No | Recommended |
| SEC-6 | CORS allow-list / storage buckets / localStorage note (L3/L4/L6) | Security | Low | S | No | No |
| OPS-1 | Error tracker wiring + uptime monitoring (H6-P2) | Operational | **High** | M | No | No |
| OPS-2 | Rate-bucket pruning + fail-closed decision (M2-P2) | Operational | Medium | S | No | Recommended |
| OPS-3 | Per-company entitlement cache (H7-P2) | Operational | Low | S | No | Recommended |
| OPS-4 | Orphaned phase test suites (L1) | Operational | Low | S | No | Needs H4 |
| ENH-1 | Year-end close (M4) | Enhancement | Medium | M | No | Yes |
| ENH-2 | Period-end FX revaluation (M5) | Enhancement | Low | M | No | Yes |
| ENH-3 | Accessibility pass (M7) | Enhancement | Medium | M | No | No |
| ENH-4 | Approval workflow / segregation of duties (L2) | Enhancement | Low | L | No | Yes |

---

## 1. Infrastructure

### INFRA-1 — Staging environment (Audit H4, phases P1–P7)
- **Description:** Provision a second Supabase project; achieve schema parity (prefer a prod schema-dump over migration-file replay, which drifts); seed a test tenant; add `.env.test`; **split the test suite** (behavioural → staging; the live-data integrity invariants → a separate read-only prod monitor); repoint the pre-commit hook off prod; add a CI test job on staging; then drop the C1 `_regression_test_query` helper from prod.
- **Reason deferred:** Larger programme; the P0 safety net (guard + residue monitor) already removed the acute risk of accidental prod mutation.
- **Business impact:** Removes the root cause of C1; unblocks behavioural accounting tests (the class that would catch COGS/MAC/E1 drift), a real CI test gate, and safe load/restore testing. Currently every test run reads (and the phase suites would write) production.
- **Technical complexity:** High — multi-step; the schema-parity + suite-split steps carry the risk of silently losing prod-integrity coverage if done naively.
- **Estimated effort:** L (1–2 weeks across the phases).
- **Priority:** **High** — keystone; unblocks INFRA-2, OPS-4, SEC/ENH staging needs, and the H5 CI test job.
- **Prerequisites:** A second Supabase project (cost decision); a seed strategy.
- **Downtime:** No (net-new environment).
- **Staging first?:** N/A — this *is* standing up staging.

### INFRA-2 — Backup / PITR / restore drill + DR runbook (Audit H6, phase P3)
- **Description:** Confirm or **enable** Supabase Point-in-Time Recovery (a paid add-on — verify the current plan); perform a documented **restore drill against a non-prod copy**; write `docs/DISASTER_RECOVERY.md` with stated RPO/RTO and step-by-step restore.
- **Reason deferred:** H6-P1 delivered error-reporting first; DR is a process/plan-and-cost decision.
- **Business impact:** Highest-severity operational gap — for a system of record, "we can restore the books" is currently **unproven**. Blocks enterprise/auditor sign-off; a data-loss event has an unrehearsed recovery path.
- **Technical complexity:** Low-Medium technically; mostly process + a plan/cost decision.
- **Estimated effort:** M.
- **Priority:** **High**.
- **Prerequisites:** Supabase plan that supports PITR (or accept the cost); a non-prod project for the drill (ideally INFRA-1).
- **Downtime:** No (drill runs on a copy).
- **Staging first?:** Yes — the restore drill must target a non-prod copy, never production.

### INFRA-3 — Server-side aggregation + keyset pagination (Audit H1 + M6)
- **Description:** Move client-side GL/report aggregation into SQL (or RPCs) with an exact-count truncation guard, and add keyset pagination + list virtualization to document lists. H1 (report aggregation) and M6 (list pagination) share the same root and fix.
- **Reason deferred:** Current data is far below any risk threshold; a planned architectural improvement, not a rushed fix (H1 analysis explicitly deferred).
- **Business impact:** Prevents silent report truncation / wrong totals at scale (the "silent misstatement clock"); enables large tenants. No effect at current volumes.
- **Technical complexity:** Medium-High — touches many adapter methods and report queries; must preserve exact numbers.
- **Estimated effort:** L.
- **Priority:** Medium (rises with tenant/data growth).
- **Prerequisites:** None hard; benefits from INFRA-1 for behavioural large-dataset tests.
- **Downtime:** No (additive RPCs + query changes).
- **Staging first?:** Yes — numeric correctness of aggregation must be verified before shipping.

---

## 2. Security Hardening

### SEC-1 — Content-Security-Policy (Audit M1, phase P2)
- **Description:** Add CSP **report-only first**, shaped for this app (`script-src 'self'`; `style-src 'unsafe-inline'` + `https://fonts.googleapis.com` for the React inline styles + Google Fonts; `font-src fonts.gstatic.com`; `connect-src`/`img-src` the Supabase origin; `frame-ancestors 'none'`), exercise every flow, clear violations, then promote to enforcing. (M1-P1 already shipped HSTS + Permissions-Policy.)
- **Reason deferred:** M1-P1 shipped the two low-risk headers; CSP needs the careful report-only rollout to avoid breaking fonts/inline styles.
- **Business impact:** The primary compensating control if an XSS lands (the session JWT lives in localStorage). Blocks security-review sign-off.
- **Technical complexity:** Medium — the policy content is the hard part; report-only de-risks it.
- **Estimated effort:** M.
- **Priority:** **High**.
- **Prerequisites:** None. Intersects OPS-1: a Sentry ingest origin must be added to `connect-src` if error tracking ships first.
- **Downtime:** No (header/config; report-only is non-breaking).
- **Staging first?:** Recommended — validate the enforced policy on a preview/staging deploy before production.

### SEC-2 — Replace vulnerable `xlsx` + Web Worker parse (Audit H8, phases P1b/P1c)
- **Description:** **P1c:** migrate off the npm `xlsx@0.18.5` build (HIGH prototype-pollution + ReDoS, "no npm fix") to the SheetJS-hosted `xlsx ≥0.20.x` or `exceljs` — the only thing that clears the advisory. **P1b:** move spreadsheet parsing into a Web Worker so a ReDoS can't freeze the UI. (H8-P1 already added the upload size cap + MIME validation.)
- **Reason deferred:** P1 (size cap + MIME) closed the easy DoS leg; the library swap is the risk-carrying part (API/bundle change) and warrants its own change.
- **Business impact:** Closes the reachable HIGH advisory on a parser that consumes operator-supplied `.xlsx` (client-side prototype pollution / DoS).
- **Technical complexity:** Medium — library swap + import/export round-trip testing; worker plumbing.
- **Estimated effort:** M.
- **Priority:** **High** (only remediation that actually clears the advisory).
- **Prerequisites:** None.
- **Downtime:** No (frontend deploy).
- **Staging first?:** Yes — verify import *and* export still work after the swap.

### SEC-3 — Auto-revoke API keys on downgrade/cancel (Audit H7, phase P3)
- **Description:** On subscription downgrade/cancel (loss of `api_access`), revoke or set `expires_at` on the company's `api_keys` so access ends immediately regardless of the per-request check; add a behavioural entitlement test (entitled → 200, de-entitled → 402). (H7-P1 already added the per-request 402 gate.)
- **Reason deferred:** H7-P1's per-request check already closes the drift; auto-revoke is belt-and-suspenders.
- **Business impact:** Defense-in-depth against the paid-gate bypass; immediate cutoff even if the per-request check is ever bypassed.
- **Technical complexity:** Low — a trigger/RPC on the subscription-change path.
- **Estimated effort:** S.
- **Priority:** Medium.
- **Prerequisites:** The subscription-change RPCs (exist).
- **Downtime:** No (additive).
- **Staging first?:** Yes — revoking real keys is operationally significant; test the trigger first.

### SEC-4 — Dependency advisories (`ws`, dev-tooling, react-router)
- **Description:** `npm audit fix` (non-`--force`) to bump `ws` (HIGH, transitive, but **unreachable** — no Realtime) and other safe transitives; separately, a **tested** upgrade of the dev-tooling majors (vitest 2→4, vite 5→8 — dev/build-only, the "critical/high" that are not shipped); and `react-router-dom` (MODERATE open-redirect, a runtime dep).
- **Reason deferred:** H8 scoped to `xlsx`; `--force` would apply breaking major upgrades and was explicitly avoided.
- **Business impact:** Clears the remaining advisories; the runtime one (react-router open-redirect) matters most, the dev-tooling ones are not customer-facing.
- **Technical complexity:** Low for the safe bumps; Medium for the majors (build/test regressions).
- **Estimated effort:** S (safe bumps) / M (majors, tested).
- **Priority:** Medium (react-router first; dev-tooling lower).
- **Prerequisites:** CI (H5) makes the major upgrades safer to verify.
- **Downtime:** No.
- **Staging first?:** Yes for the majors (vitest/vite could break the build/suite).

### SEC-5 — Order idempotency unique index (Audit L5)
- **Description:** Add a partial unique index on `invoices (company_id, reference)` (where reference is not null) so two simultaneous first-time API-order retries can't double-create — same pattern as the H2 index.
- **Reason deferred:** Low likelihood; the API order path is lightly used.
- **Business impact:** Prevents duplicate documents from a retry race on the public order endpoint.
- **Technical complexity:** Low — one `CREATE UNIQUE INDEX CONCURRENTLY`; verify no existing duplicates first.
- **Estimated effort:** S.
- **Priority:** Medium.
- **Prerequisites:** Confirm 0 existing `(company_id, reference)` duplicates.
- **Downtime:** No (`CONCURRENTLY`).
- **Staging first?:** Recommended (verify the index predicate matches the intake path).

### SEC-6 — CORS allow-list / storage buckets / localStorage (Audit L3, L6, L4)
- **Description:** Optional API CORS origin allow-list (currently `*`; acceptable with bearer auth, no cookies — **note only**); confirm nothing sensitive is ever written to the public `logos`/`products` storage buckets (`attachments` is private ✅); JWT-in-localStorage is **mitigated by SEC-1 (CSP)** + zero `dangerouslySetInnerHTML`.
- **Reason deferred:** All three are low-risk notes; CSP (SEC-1) is the real control for L4.
- **Business impact:** Marginal hardening; mostly documentation/hygiene.
- **Technical complexity:** Low.
- **Estimated effort:** S.
- **Priority:** Low.
- **Prerequisites:** SEC-1 covers the L4 concern.
- **Downtime:** No.
- **Staging first?:** No.

---

## 3. Operational Improvements

### OPS-1 — Error tracker wiring + uptime monitoring (Audit H6, phase P2)
- **Description:** Wire an external error tracker (e.g. Sentry) into the `setErrorReporter()` seam (browser) and the Edge Function's `reportEdgeError()` seam (both plug points already exist from H6-P1) + add uptime monitoring on the app URL and an API health target (note: `/v1/me` is API-key-gated → use a dedicated key or add a public health route).
- **Reason deferred:** H6-P1 built the reporting *layer* + seams without configuring an external service (out of that scope).
- **Business impact:** Production exceptions become visible to the team instead of only via customer reports; outages detected before customers notice.
- **Technical complexity:** Medium — SDK + DSN secret; CSP `connect-src` must allow the ingest origin (SEC-1).
- **Estimated effort:** M.
- **Priority:** **High** — the seams are ready; this activates real observability.
- **Prerequisites:** A Sentry-class account + DSN; coordinate `connect-src` with SEC-1.
- **Downtime:** No (additive).
- **Staging first?:** No (additive; can verify in a preview deploy).

### OPS-2 — Rate-bucket pruning + fail-closed decision (Audit M2, phase P2)
- **Description:** Add pruning for `api_rate_buckets` (prune-in-RPC, `pg_cron`, or TTL) so the counter table doesn't grow unbounded; and decide/implement the **fail-closed vs bounded-fail-open** policy on RPC error, made configurable. (M2-P1 shipped the atomic counter, currently bounded fail-open.)
- **Reason deferred:** M2-P1 fixed the race; pruning + the fail-closed decision were explicitly deferred.
- **Business impact:** Keeps the rate-limit counter table bounded; lets the owner choose the availability-vs-abuse tradeoff on DB error.
- **Technical complexity:** Low.
- **Estimated effort:** S.
- **Priority:** Medium (pruning becomes relevant with real API traffic).
- **Prerequisites:** M2-P1 applied + deployed.
- **Downtime:** No (additive).
- **Staging first?:** Recommended (verify pruning + the fail-closed branch).

### OPS-3 — Per-company entitlement cache (Audit H7, phase P2)
- **Description:** Cache the `company_has_api_access` result per company_id for ~60s (in-memory per Edge worker) to avoid a subscription lookup on every request.
- **Reason deferred:** H7-P1 chose per-request correctness first; the cache is a perf optimization.
- **Business impact:** Reduces one DB round-trip per API request; bounds how long a just-lapsed tenant lingers (TTL).
- **Technical complexity:** Low.
- **Estimated effort:** S.
- **Priority:** Low (current API traffic is tiny).
- **Prerequisites:** H7-P1 deployed.
- **Downtime:** No.
- **Staging first?:** Recommended.

### OPS-4 — Orphaned phase-verification test suites (Audit L1)
- **Description:** The `tests/integration/phase0–12-*.test.ts` suites exist but aren't run by the pre-commit hook (only `regressions` is). Wire the safe ones into CI once staging exists, or archive them with a README to avoid false coverage confidence.
- **Reason deferred:** The mutating ones can't run against prod (H4-P0 guard now blocks them); needs a staging target.
- **Business impact:** Removes false "we have these tests" confidence; recovers the coverage on staging.
- **Technical complexity:** Low.
- **Estimated effort:** S.
- **Priority:** Low.
- **Prerequisites:** **INFRA-1** (staging) for the mutating suites.
- **Downtime:** No.
- **Staging first?:** Yes (the mutating suites need staging by design).

---

## 4. Nice-to-have Enhancements

### ENH-1 — Year-end close (Audit M4)
- **Description:** Implement `close_fiscal_year()` posting a `year_end_close` JE (zeroing income/expense into retained earnings), period-lock-guarded and idempotent per year. Today the Balance Sheet compensates with a synthetic `__CPE__` current-period-earnings line — correct mid-period but no crystallized retained earnings or closing entry.
- **Reason deferred:** Feature, not a defect; mid-period numbers are correct.
- **Business impact:** A closing entry an accountant can point to; closed comparatives; proper retained-earnings roll-forward. Expected by accountants for year-end.
- **Technical complexity:** Medium — a new posting RPC on the critical accounting path.
- **Estimated effort:** M.
- **Priority:** Medium (seasonal — before customers' first year-end).
- **Prerequisites:** Period-lock (exists).
- **Downtime:** No (additive RPC).
- **Staging first?:** Yes — posting-engine change; verify income/expense net to zero + retained earnings moved + TB balances.

### ENH-2 — Period-end FX revaluation (Audit M5)
- **Description:** Post unrealized FX gain/loss on open foreign-currency AR/AP at period end (IAS 21), reversed next period; confirm vendor-payment FX parity. Realized FX on receipts already exists (4400/6900).
- **Reason deferred:** **Gated behind C2** — multi-currency is UI-locked to base currency (the posting engine doesn't convert yet), so this is irrelevant until real multi-currency ships.
- **Business impact:** Correct Balance Sheet at period end once multi-currency is real; none today.
- **Technical complexity:** Medium.
- **Estimated effort:** M.
- **Priority:** Low (blocked by the multi-currency decision).
- **Prerequisites:** Real multi-currency (the C2 lock would be lifted first).
- **Downtime:** No.
- **Staging first?:** Yes — posting/FX correctness.

### ENH-3 — Accessibility pass (Audit M7)
- **Description:** Add `eslint-plugin-jsx-a11y` + axe in CI; `aria-label` on icon-only buttons (54 `aria-*` vs ~198 `<button>`); modal focus-trap audit. RTL/Arabic support is already real.
- **Reason deferred:** Below procurement threshold for current customers; needs the CI gate.
- **Business impact:** Icon-only controls become screen-reader usable; unblocks public-sector/enterprise procurement (VPAT).
- **Technical complexity:** Medium — broad but mechanical.
- **Estimated effort:** M.
- **Priority:** Medium (procurement-driven).
- **Prerequisites:** **H5 CI** for the axe/lint gate.
- **Downtime:** No.
- **Staging first?:** No.

### ENH-4 — Approval workflow / segregation of duties (Audit L2)
- **Description:** Add maker-checker / approval limits on top of the capability-based RBAC (today anyone with write can create + confirm at any value). A roadmap item, not a defect.
- **Reason deferred:** Acceptable for SMB; a recurring finding only for larger customers.
- **Business impact:** Unblocks larger/regulated customers; internal-control maturity.
- **Technical complexity:** High — new approval state machine across document types.
- **Estimated effort:** L.
- **Priority:** Low (customer-demand-driven).
- **Prerequisites:** RBAC (exists).
- **Downtime:** No (additive).
- **Staging first?:** Yes — touches document lifecycle across modules.

---

## Cross-cutting notes

- **Two-step deploys:** DB items are hand-applied migrations (SQL editor); Edge-Function items need a separate `supabase functions deploy api`. Neither requires app downtime.
- **The keystone is INFRA-1 (staging):** it unblocks INFRA-2's drill, OPS-4, the H5 CI test job, and safe verification for INFRA-3 / ENH-1 / ENH-2 / SEC-2. Sequencing INFRA-1 first makes the rest lower-risk.
- **Nothing here is a live-exploitable critical defect** — those (C1, C2, H2, H3, H7, M2, M3, and the header/monitoring/import P1s) were fixed in the primary audit cycle. This backlog is hardening, operations, and features.

_End of backlog._
