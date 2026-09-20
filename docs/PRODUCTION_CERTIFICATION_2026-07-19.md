# StockBolt v1 — Production Certification Review

### Final go/no-go assessment before general release to paying customers

| | |
|---|---|
| **Document** | `PRODUCTION_CERTIFICATION_2026-07-19.md` |
| **Date** | 2026-07-19 |
| **Review phase** | **Third and final pass** — certification |
| **Reviewer roles** | Chief ERP Auditor · Principal QA Engineer · Product Owner · CFO · External Auditor · Enterprise Customer · ERP Consultant · Production Certification Lead |
| **Prior reports read** | `SECURITY_AUDIT_2026-07-19.md` · `ERP_ENTERPRISE_ASSESSMENT_2026-07-19.md` · `MULTICURRENCY_AUDIT.md` (Phase 17) |
| **Live project** | `gzpkuaioibqrdppjdbwz` — read-only queries only |
| **Code / DB changed** | **None** |

**Method & honesty statement.** This review combined source inspection, live read-only data queries, and cross-referencing the three prior reports. The UI layer was **systematically sampled** — pattern-level coverage across all modules (loading states, empty states, destructive-action guards, responsive breakpoints, currency handling) rather than a literal click-through of all ~198 interactive controls. Where a finding is pattern-derived rather than individually verified, it is marked. Findings already documented in the three prior reports are **referenced, not repeated**.

---

# Executive Summary

The three prior reports established that StockBolt has an **unusually strong accounting core** and a **weak operational envelope**. This certification pass adds the missing dimension — the real business user — and surfaces **one new defect more serious than anything in the previous two reports combined**.

**The headline finding (CERT-1):** four document editors expose a fully-enabled dropdown offering **every world currency**, while the posting engine — by explicit design, documented in `MULTICURRENCY_AUDIT.md` §2 — **does not multiply by the exchange rate**. A user can select "USD" on an invoice in two clicks and confirm it. The general ledger then records a 1,000 USD invoice as **1,000 AED** instead of ~3,673 AED. The journal entry still balances, so every guard passes: `je_must_balance` passes, the 91-test regression suite passes, no warning is shown, and no error is logged. The customer's AR, VAT return, P&L and Balance Sheet are all silently wrong.

**The good news, verified against live data:** **zero** documents and **zero** contacts currently use a non-base currency, and every exchange rate in the database is exactly `1`. No customer's books are wrong today. This is a loaded weapon that has not yet been fired — which is precisely why it must be disarmed before release rather than after.

Combined with the two previously-identified silent-failure modes — report truncation at 1,000 GL rows (E-1) and the double-post race (E-2) — StockBolt currently has **three distinct paths to silently incorrect financial statements**. None of them crash. All of them produce confident, plausible, wrong numbers. For an accounting system of record, this is the defining risk class, and all three are cheap to fix.

**The counterweight, stated plainly:** the inventory, costing and posting engines are genuinely excellent; the UX layer is in materially better shape than the prior reports implied (281 loading-state references, 151 empty-state strings, destructive actions broadly guarded, 121 responsive breakpoints, EN/AR RTL); and the whole defect set is measured in days of work, not months.

---

# Product Quality Score

## **68 / 100 — "Strong product, not yet a certifiable release"**

| Band | Meaning | StockBolt |
|---|---|---|
| 90–100 | Certify immediately | |
| 75–89 | Certify with conditions | |
| **60–74** | **Fix blockers, then re-certify** | **← 68** |
| 40–59 | Substantial rework | |
| <40 | Not viable | |

The score is dominated by three fixable silent-correctness defects. With CERT-1, E-1, E-2 and the Phase-1 P0s closed, this product scores **83–85** and certifies with conditions.

---

# Module-by-Module Ratings

| Module | Rating | Why |
|---|---|---|
| **Inventory & Stock Movement** | ★★★★★ | Moving-average costing, `seq`-ordered replay (fixes uuid-tie drift), negative-stock guard, deferred-COGS queue for sell-before-buy, services correctly excluded. Best-in-class for this market segment. |
| **Accounting / GL / Journal Entries** | ★★★★★ | Balance-by-construction, `je_must_balance` deferred trigger, voucher-date reversals, GL as sole truth with no cached aggregates. Correctness enforced by the database, not hoped for in code. |
| **Sales & Invoicing** | ★★★★ | Excellent flow, view-first mode, credit-limit surfacing, drill-down. **Downgraded from ★★★★★ solely by CERT-1** (currency picker). |
| **Purchasing / Vendor Bills / PO / GRN** | ★★★★ | PO→Bill conversion, itemized landed costs with own GL legs. Same CERT-1 exposure. |
| **Payments & Receipts** | ★★★★ | Advance handling, allocation, apply-credit UX, FX-aware receipts. Vendor-side FX parity unverified. |
| **Returns / Credit & Debit Notes** | ★★★★ | Proper posting engine reuse; sales returns post via the credit-note engine; salesperson commission base preserved. |
| **User Management & RBAC** | ★★★★ | Custom roles, per-user overrides, `has_perm`, last-admin guard, restrictive RLS lockdown. Missing: segregation of duties / approval limits. |
| **Settings & Company Setup** | ★★★★ | Two-pane layout, comprehensive coverage, onboarding wizard, opening-balance wizard. |
| **Dashboard** | ★★★★ | Meaningful KPIs, period toggle, drill-down, error surfacing on cards. |
| **Print / PDF** | ★★★★ | Signature template system across 12 document types; print-scope leak previously fixed. |
| **Localization (EN/AR + RTL)** | ★★★★ | Real RTL implementation, not an afterthought. Gap: Developer/API page is English-only. |
| **Public API** | ★★★★ | Hash-only key storage, tenant scoping, idempotency, rate limiting, field allow-lists. Gaps: paid-gate not enforced at runtime (H-2), no published docs/OpenAPI. |
| **Reports** | ★★★ | Comprehensive coverage, period picker, print/export everywhere — but **client-side aggregation with a silent 1,000-row truncation ceiling** (E-1). |
| **Banking & Reconciliation** | ★★★ | Functional; not deeply exercised in this review. No bank-feed import; manual reconciliation only. |
| **Import / Export** | ★★★ | Broad master-data coverage — but `xlsx` carries an unfixed HIGH prototype-pollution advisory and parses untrusted uploads (H-3). |
| **Subscriptions / Billing** | ★★★ | PayPal integrated, plans seeded, grandfathering handled. Runtime entitlement gate missing (H-2). |
| **Mobile experience** | ★★★ | 121 responsive breakpoints, 59 files with horizontal-scroll table containers, mobile drawer. Data-dense ERP grids remain hard on phones. |
| **Audit Logs** | ★★ | Comprehensive capture — but **any ordinary user can UPDATE or DELETE their company's audit rows** (Phase-1 H-1). Fails IT general controls. |
| **Multi-Currency** | ★★ | Schema, rate table, FX accounts and receipt-side gain/loss all exist — but the engine doesn't convert while the UI invites users to pick a currency. **The most dangerous half-built feature in the product.** |
| **Accessibility** | ★★ | 54 `aria-*` attributes against 198 buttons; no automated a11y check; no VPAT. |

---

# Workflow Validation

| Lifecycle | Verdict | Notes |
|---|---|---|
| Customer / Supplier | ✅ Pass | Create → transact → statement → advance/credit apply. Coherent. |
| Product | ✅ Pass | Wizard, categories/brands, compatibility, opening stock, service flag. |
| Inventory | ✅ Pass | Receipt → valuation → issue → adjustment → transfer. MAC integrity strong. |
| Quotation → Sales Order → Invoice | ⚠️ Conditional | Flow correct; **CERT-1 applies at the quote and invoice steps**. |
| Purchase → GRN → Bill → Payment | ⚠️ Conditional | Flow correct; **CERT-1 applies at PO and bill steps**. |
| Payment & allocation | ✅ Pass | Partial payments, advances, credit application all handled. |
| Returns / CN / DN | ✅ Pass | Posting engine reuse; reverse-and-edit supported. |
| Opening balances | ✅ Pass | Wizard + GL openings + per-bank openings + CSV import. |
| Bank reconciliation | ⚠️ Sampled only | Not exercised end-to-end in this pass. |
| Period close (month) | ⚠️ Partial | Manual `period_lock_date` only; no guided close checklist. |
| **Year-end close** | ❌ **Missing** | Not implemented (E-6). Balance Sheet compensates via synthetic "Current Period Earnings". |
| Reporting | ⚠️ Conditional | Correct today; silently wrong past ~1,000 GL rows (E-1). |
| API order intake | ✅ Pass | Draft-invoice model with human confirm is the right design. |

---

# Missing Features

**Release-critical:** year-end close · report aggregation at scale · audit-log immutability · verified backup/restore · currency lockdown (CERT-1).

**Business-critical (near-term):** approval workflows & segregation of duties · fixed assets & depreciation · budgets vs actuals · recurring invoices · dunning/reminder automation · bank-feed import · FX period-end revaluation · **e-invoicing compliance for GCC (KSA ZATCA Phase 2 is mandatory; UAE is phasing in a Peppol-based mandate — verify current obligations for your target countries, as this can become market access rather than a feature).**

**Competitive:** bin locations · cycle counting · batch/expiry tracking · customer portal · advanced pricing rules · CRM pipeline · mobile stock-take.

**Roadmap:** BI workspace · demand forecasting · multi-entity consolidation · SSO/SCIM · IFRS packs · EDI.

---

# UX Improvements

1. **No toast/notification library is installed.** Success and failure feedback is therefore ad-hoc per screen. Users need consistent, unmissable confirmation that a document saved, confirmed, or failed — this is the single highest-leverage UX addition. *(Pattern-derived.)*
2. **Currency field must be removed or locked** (CERT-1) — showing a control that produces silently wrong accounting is the worst possible UX outcome.
3. **Report truncation must fail loudly**, not silently — a visible banner beats a wrong number.
4. Add a **guided month-end close checklist** (unposted documents, unreconciled bank lines, negative stock, draft invoices) — accountants expect this and it prevents filing errors.
5. Make the Balance Sheet's `balanced` indicator (`balance-sheet.tsx:252`) a **blocking, prominent warning** rather than a soft flag.
6. Add **keyboard shortcuts** for high-frequency counter work (new invoice, save, confirm, product search) — a cashier does hundreds of these daily.
7. Standardise terminology audit across EN/AR — Receipts vs Payments was fixed; sweep for others.

---

# Business Risks

| Risk | Likelihood | Impact | Net |
|---|---|---|---|
| Foreign-currency invoice misstates GL (CERT-1) | **High** once any user explores the dropdown | **Severe** — wrong VAT filing, wrong books | 🔴 Critical |
| Reports silently truncate as customers grow (E-1) | **High** within months | **Severe** — decisions and filings on wrong data | 🔴 Critical |
| Double-posted document from retry/double-click (E-2) | Medium | Severe — duplicated revenue/VAT/stock | 🟠 High |
| Tax filing based on any of the above | Medium | **Regulatory penalty exposure** | 🔴 Critical |
| Customer discovers audit log was altered (H-1) | Low | Severe — trust and audit failure | 🟠 High |
| Data breach via anon SQL RPC (Phase-1 C-1) | **High — live now** | **Catastrophic** | 🔴 Critical |

---

# Operational Risks

- **No monitoring or alerting** — failures are discovered by customers (E-4).
- **No CI/CD** — nothing validates a deploy (E-3).
- **Tests run against the production database** (H-4).
- **Migrations applied by hand** — already caused one live drift incident and one silently half-applied migration.
- **Bus factor of one** — no runbook, no second operator, no on-call.
- **No documented RPO/RTO or tested restore** (E-4).

---

# Stakeholder Reviews

### Customer Experience Review
A shop owner would find StockBolt **pleasant and fast** — coherent design, sensible defaults, good empty and loading states, real Arabic support. They would trust it. **That trust is the risk**: nothing in the interface signals that a currency selection or a large ledger can corrupt their numbers. They would not call support, because nothing appears broken.

### Administrator Review
Strong: RBAC with custom roles and per-user overrides, invites, settings depth, company reset with name-confirmation guard. Weak: no SSO, no session/device management, no bulk user operations, and audit logs that admins themselves can delete.

### Accountant Review
**Would largely approve the engine, and reject three things:** (1) no year-end close entry; (2) unrealized FX not recognised on open FC balances; (3) once CERT-1 and E-1 are explained, they would stop work immediately and demand verification of every prior filing. They would praise the drill-down, statements, and the fact that the GL is the single source of truth.

### Auditor Review
**Fails IT general controls today**, on three independent grounds: mutable audit logs (H-1), no segregation of duties (E-10), and no change-management evidence (E-3, hand-applied migrations). The anon SQL RPC (C-1) would additionally trigger a reportable finding. The posting engine itself would receive a favourable opinion.

### Warehouse Review
**Genuinely strong.** Stock ledger with correct sequencing, negative-stock guard with a per-company backorder toggle, transfers, adjustments, GRN, serial support. Missing for larger operations: bin locations, cycle counting, batch/expiry, and a mobile stock-take flow.

### Sales Review
Fast quote→invoice path, credit-limit and outstanding surfacing at point of entry, salesperson commission base preserved through returns, POS support. Missing: pipeline/CRM, quote approval thresholds, promotions engine.

### Purchase Review
PO→GRN→Bill chain is correct, landed costs post their own GL legs, vendor advances handled. Missing: purchase approval limits (any user with `purchasing.write` can commit unlimited spend), supplier price lists, RFQ comparison.

### API Review
Well-constructed for a v1: hash-only key storage, explicit tenant scoping, idempotency via `external_ref`, rate limiting, field allow-lists excluding margin data, draft-invoice intake requiring human confirmation. Gaps: entitlement not re-checked at runtime (H-2), no OpenAPI/docs for integrators, no sandbox environment, no webhooks, rate limiter fails open (E-5/M-3).

### Reporting Review
Broad and well-presented, with period picker and print/export throughout. Undermined by the client-side aggregation ceiling (E-1) and the absence of closed-period comparatives (E-6). Reports are the product's weakest link relative to how much customers depend on them.

### Dashboard Review
Effective: real KPIs, period toggle, drill-down to source documents, per-card error surfacing. Consider adding an exceptions panel (negative stock, unposted drafts, overdue AR) — dashboards that surface problems outperform dashboards that summarise activity.

### Mobile Readiness
Usable, not optimised. 121 responsive breakpoints and 59 scroll-contained tables show real effort. Multi-column ERP grids and document editors remain difficult on phones. Recommend defining the mobile-critical subset (stock lookup, quick invoice, approvals) rather than making everything responsive.

### Print/PDF Review
A genuine strength — the Signature template system covers 12 document types with bilingual output, and the earlier global print-leak bug was correctly diagnosed and scoped. Remaining: no server-side PDF generation (browser print only), so no attach-to-email or archival PDF.

### Localization Review
EN + AR with true RTL is a serious differentiator in this market. Gaps: the Developer/API page is English-only literals; number/date formatting should be spot-checked under `ar` locale; Arabic print templates should be proofed by a native speaker before release.

### Accessibility Review
Below enterprise threshold: 54 `aria-*` attributes vs 198 buttons, no automated axe/lighthouse gate, no VPAT. Icon-only controls likely lack accessible names. Adequate for SMB self-serve; disqualifying for public-sector or large-enterprise procurement.

### Documentation Review
**Above average for a solo product.** `docs/` holds 8 architecture documents, a build-phase plan, bilingual user guides, and now three audits. Missing: operational runbook, disaster-recovery procedure, API integrator docs, and a customer-facing changelog.

---

# Final Production Checklist

| # | Item | Status |
|---|---|---|
| 1 | Anon arbitrary-SQL RPC revoked from production (C-1) | ❌ **Open — P0** |
| 2 | Currency pickers removed/locked to base (CERT-1) | ❌ **Open — P0** |
| 3 | Report row-count guard, then server-side aggregation (E-1) | ❌ Open |
| 4 | Unique index preventing double-posted JEs (E-2) | ❌ Open |
| 5 | `audit_logs` append-only (H-1) | ❌ Open |
| 6 | Staging database separated from production (H-4) | ❌ Open |
| 7 | CI pipeline: typecheck + build + tests (E-3) | ❌ Open |
| 8 | Error monitoring + alerting (E-4) | ❌ Open |
| 9 | Verified restore drill + documented RPO/RTO (E-4) | ❌ Open |
| 10 | API runtime entitlement gate (H-2) | ❌ Open |
| 11 | `npm audit fix` + `xlsx` mitigation (H-3, M-2) | ❌ Open |
| 12 | CSP + HSTS + Permissions-Policy headers (M-1) | ❌ Open |
| 13 | Toast/notification system for user feedback | ❌ Open |
| 14 | Double-entry engine integrity | ✅ **Pass** |
| 15 | Inventory valuation integrity | ✅ **Pass** |
| 16 | Tenant isolation at the table layer (RLS on 124/124) | ✅ **Pass** |
| 17 | Document numbering concurrency safety | ✅ **Pass** |
| 18 | No customer data currently corrupted | ✅ **Verified** |

---

# Release Blockers

**Must be closed before any new paying customer is onboarded:**

| # | Blocker | Ref | Effort |
|---|---|---|---|
| 1 | Anonymous arbitrary-SQL access to the entire database | C-1 | minutes |
| 2 | Currency picker enables silent GL misstatement | **CERT-1** | hours |
| 3 | Reports silently truncate at 1,000 GL rows | E-1 | hours |
| 4 | Concurrent confirm can double-post the GL | E-2 | hours |
| 5 | Audit logs are user-mutable | H-1 | hours |
| 6 | No error monitoring — failures are invisible | E-4 | 1 day |
| 7 | No CI + tests run on production DB | E-3, H-4 | 1–2 days |

**Blockers 1–5 total roughly one focused day.** They retire one live data breach and all three silent-misstatement paths.

---

# Nice-to-Have Improvements

Toast notifications · month-end close checklist · dashboard exceptions panel · keyboard shortcuts for counter work · server-side PDF · API docs/OpenAPI · bulk user management · saved report filters · CSV export on lists · dark mode · session/device management.

---

# 30-Day Roadmap

**Week 1 — Stop the bleeding.** Blockers 1–5. Verify no prior document/filing was affected (already confirmed clean for CERT-1). Add regression tests locking each fix.
**Week 2 — Operational floor.** Staging project; move tests off production; CI pipeline; Sentry; uptime monitoring.
**Week 3 — Resilience.** Restore drill + `DISASTER_RECOVERY.md` with RPO/RTO; security headers; `npm audit fix`; `xlsx` mitigation; API entitlement gate.
**Week 4 — Trust & polish.** Toast system; report aggregation moved server-side; month-end close checklist; re-run all three audits and re-certify.

# 90-Day Roadmap

Year-end close (E-6) · FX: either complete the engine per `MULTICURRENCY_AUDIT.md` §3 acceptance gates **or** formally remove multi-currency from the product surface — no third option · approval workflows & segregation of duties · server-side pagination on document lists · accessibility pass + axe in CI · API documentation and sandbox · bank-feed import · fixed assets & depreciation · **e-invoicing compliance assessment for target countries**.

# 1-Year Roadmap

Multi-entity consolidation · SSO/SCIM · SOC 2 readiness · BI/analytics workspace · demand forecasting & reorder suggestions · customer portal · mobile stock-take app · batch/expiry and bin locations · budgets vs actuals · EDI/supplier integration · IFRS reporting packs.

---

# Final Scores

| Dimension | Score | Movement vs prior reports |
|---|---:|---|
| **Security** | **34 / 100** | Unchanged — C-1 still open |
| **Accounting** | **70 / 100** | ▼ from 84 — CERT-1 is an accounting defect, not just a UX one |
| **Architecture** | **78 / 100** | Unchanged — sound design, reporting asymmetry |
| **Performance** | **50 / 100** | Slight ▲ — code splitting and caching better than first assessed |
| **Scalability** | **45 / 100** | Unchanged |
| **Reliability** | **40 / 100** | No monitoring, no CI, no DR, hand-applied migrations |
| **User Experience** | **72 / 100** | ▲ — UX layer materially healthier than prior reports implied |
| **Business Readiness** | **58 / 100** | Blocked by correctness defects, not by product gaps |
| **ERP Completeness** | **72 / 100** | Unchanged |
| **Production Readiness** | **45 / 100** | ▲ slightly — no data corruption found in live verification |
| **Overall Product Quality** | **68 / 100** | **Fix blockers, then re-certify** |

---

# Final Question

> ### "If I were the CTO of a software company, would I confidently launch StockBolt tomorrow for paying customers?"

## **No.**

Not because the product is weak — but because it currently has **three independent ways to produce confidently wrong financial statements without anyone noticing**, plus **one live data-breach path**. For any other class of software, several of these would be "fix it next sprint." For a system that holds real businesses' books and feeds their tax filings, silent incorrectness is the one defect class that cannot ship.

**Every remaining blocker, in priority order:**

1. **C-1** — Anonymous internet access to arbitrary SQL across all tenants. *(minutes to fix)*
2. **CERT-1** — Currency picker in 4 editors + non-converting posting engine = silent GL misstatement. *(hours)*
3. **E-1** — Financial reports silently truncate at 1,000 GL rows. *(hours)*
4. **E-2** — Concurrent confirm can double-post revenue, VAT, COGS and stock. *(hours)*
5. **H-1** — Audit logs are editable and deletable by ordinary users. *(hours)*
6. **E-4** — No error monitoring; production failures are invisible. *(1 day)*
7. **E-3 / H-4** — No CI; tests run against the production database. *(1–2 days)*

**What I would say to the board:** this is a **one-week fix list, not a re-architecture**. The engineering judgement in the accounting core is better than most products in this category, and the live verification found **no corrupted customer data** — the defects are latent, and we have caught them before a single customer was harmed. Close the seven items above, re-run all three audits, and StockBolt certifies at **83–85/100** — a confident launch for its target market.

**The one thing I would not compromise on:** multi-currency must be either **finished properly** (per `MULTICURRENCY_AUDIT.md` §6 acceptance gates) or **removed from the UI entirely**. A half-built currency feature in an accounting system is not a limitation — it is a defect that produces wrong tax filings. There is no acceptable middle state.

---

*Prepared 2026-07-19. No code or database state was modified. All live queries were read-only. This certification complements — and does not supersede — `SECURITY_AUDIT_2026-07-19.md`, `ERP_ENTERPRISE_ASSESSMENT_2026-07-19.md`, and `MULTICURRENCY_AUDIT.md`, whose findings remain open.*
