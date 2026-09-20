# StockBolt — Accounting Module: Review & Phased Roadmap

**Created:** 2026-07-24 · **Type:** analysis + proposal (nothing implemented) · **Context:** auto-parts ERP for GCC + India SMBs, moving-average cost, single-entity.

Grounded in the live code (`src/modules/accounting`, `src/modules/banking`, `src/modules/reports`, `src/data/*Adapter.ts`, posting RPCs), not memory. This proposes a plan for your approval; no code will change until you pick phases.

---

## Part A — What's already implemented (and solid)

The accounting core is mature. Current capabilities:

**Ledger & posting engine**
- Double-entry GL, balance-by-construction, `je_must_balance` deferred trigger, voucher-date reversals, `seq`-ordered stock replay, round-off discipline, tax-inclusive posting deriving revenue from total−tax.
- **Manual journal entries** — full create / reverse / reverse-to-edit (`journal-entry-editor.tsx`, `postJournalEntry` / `reverseJournalEntry`), Manual vs System-auto-posted tabs.
- **Recurring journal entries** — a single Post generates the whole scheduled series (already built).

**Chart of accounts**
- Parent/sub accounts, tree-indented pickers, auto-coding, inline edit, EN/AR names, import/export.

**Opening balances**
- AR/AP owed, customer/vendor credit, GL openings (fixed-asset, capital, retained-earnings *accounts*), per-bank openings, opening stock; bulk CSV import; void/edit via reverse-then-repost.

**Period control & banking**
- Period lock (VAT-filing-aware), bank reconciliation, bank transfers, PDC (post-dated cheques) issued & received.

**Sub-ledgers & valuation**
- Moving-average cost, deferred-COGS (sell-before-buy), negative-stock guard, customer/vendor advances + apply-credit.

**Financial reporting (~30 reports, period-picker + Print/Excel + drill-down)**
- Trial Balance, Balance Sheet, P&L, **Cash Flow** (indirect, VAT working-capital aware), **VAT/GST Return**, AR/AP Aging, customer/supplier statements, General Ledger, Reversal Trail, Audit Log, Daily Cash, Bank Reconciliation.

**Verdict on the base:** the transactional accounting engine and standard statements are complete and correct. The gaps are in **compliance filing**, **asset/period-end automation**, and **management accounting** — not in the core ledger.

---

## Part B — Gaps vs a modern ERP (what's missing)

Grouped by nature; region-relevance called out (GCC + India is the target market).

### Compliance & tax (region-critical)
1. **E-invoicing** — no ZATCA/Fatoora (KSA), UAE e-invoicing (mandated 2026), or India GST e-invoice/IRN + QR. This is becoming **mandatory** in the target markets; the biggest strategic gap.
2. **VAT/GST filing workflow** — a VAT/GST *return report* exists, but no formal return generation/e-filing (GCC VAT return file, India **GSTR-1 / GSTR-3B**), no filed-period locking tied to the return.
3. **India TDS / withholding tax** — no tax-deducted-at-source on vendor payments (a hard India requirement for many B2B flows).

### Core accounting completeness
4. **Year-end close** — no `close_fiscal_year()`; income/expense never zeroed into retained earnings; Balance Sheet uses a synthetic current-period-earnings line. *(= backlog M4.)*
5. **Fixed-asset register + depreciation** — the *accounts* exist (accumulated depreciation in openings) but there is **no asset register and no depreciation schedule/auto-posting**. Relevant for an auto-parts business (vehicles, racking, equipment).
6. **Prepaid/accrual/deferred-revenue automation** — only payroll gratuity accrues automatically; no prepaid-expense amortization or deferred-revenue schedules.
7. **Multi-currency period-end FX revaluation** — realized FX on receipts only; no unrealized revaluation of open FC AR/AP. *(= backlog M5, gated behind real multi-currency / C2.)*

### Management & statement quality
8. **Comparative / period-over-period statements** — BS/P&L are single-period (`as_of_date` / `from–to`); no prior-period or budget columns, no % change.
9. **Budgeting / budget-vs-actual** — none.
10. **Cost centers / dimensions / project / departmental accounting** — GL is single-dimension (account + contact only); no tagging for branch/department/project P&L.
11. **Statement notes / customization / financial ratios (KPIs)** — fixed statement layouts; no notes or ratio pack.

### Enterprise (lower priority for SMB)
12. **Multi-entity / consolidation / intercompany** — single-entity only.
13. **Bank feeds / auto-reconciliation** — reconciliation is manual (no statement import / auto-match).
14. **JE approval / segregation of duties (maker-checker)** — capability-based RBAC only. *(= backlog L2.)*

---

## Part C — Prioritization (for a GCC + India SMB auto-parts ERP)

| Priority | Item | Why |
|---|---|---|
| **HIGH** | E-invoicing (KSA/UAE/India IRN) | Becoming legally mandatory; a sales blocker without it |
| **HIGH** | VAT/GST return generation + filing lock (incl. India GSTR) | Every tenant files periodically; report ≠ return |
| **HIGH** | Year-end close (backlog M4) | Accountant-expected; produces clean books & comparatives |
| **MEDIUM** | Fixed assets + depreciation | Real for auto-parts (vehicles/equipment); currently manual JEs |
| **MEDIUM** | Comparative statements (prior-period columns) | Low effort, high perceived value on existing reports |
| **MEDIUM** | India TDS / withholding | Hard requirement for India B2B; scoped to India tenants |
| **MEDIUM** | Prepaid / accrual / deferred-revenue schedules | Removes month-end manual JE toil |
| **LOW** | Budgeting / budget-vs-actual | Valued but not blocking |
| **LOW** | Cost centers / dimensions | Enterprise-leaning; big schema impact for SMB payoff |
| **LOW** | Bank feeds, multi-entity, JE approval (L2), ratios | Enterprise / later-stage |

**Deliberately parked:** multi-entity/consolidation/intercompany and dimensional accounting — high complexity, low SMB payoff; revisit only on customer demand.

---

## Part D — Proposed phased roadmap

Each phase is independently shippable and follows the standard workflow (analysis → your approval → minimal implementation → verification → commit-ready). Migrations are hand-applied files; posting changes are patched from the live `pg_get_functiondef`, never old migration files. Effort: S ≤ 1 day · M 2–4 days · L 1–2 weeks.

### Phase AC-1 — Year-end close (backlog M4) · Effort M · Priority High
`close_fiscal_year()` RPC posting a `year_end_close` JE (zero income/expense → retained earnings), period-lock-guarded, idempotent per year; a Close screen + reopen path. **Why first:** small, self-contained, produces the clean-books foundation comparatives and audits rely on. **Prereq:** period lock (exists). **Staging:** yes (posting-engine change). **No downtime.**

### Phase AC-2 — Comparative financial statements · Effort S–M · Priority Medium (quick win)
Add prior-period (and optional YoY) columns + % change to Balance Sheet and P&L, reusing the existing report methods with a second date range. **Why:** high perceived value, no schema change, no posting change — a fast, visible upgrade. **Prereq:** none. **Staging:** recommended (numeric spot-check). **No downtime.**

### Phase AC-3 — VAT/GST return & filing workflow · Effort L · Priority High
Turn the VAT/GST *report* into a *return*: generate the GCC VAT return figures (and India **GSTR-1 / GSTR-3B** summaries) for a period, produce the filing export, and lock the filed period. **Why:** every tenant files; today it stops at a report. **Prereq:** period lock (exists); confirm the GST account mapping (India accounts already seeded). **Staging:** yes. **No downtime** (additive report/RPC + a lock).

### Phase AC-4 — E-invoicing foundation (region-phased) · Effort L (XL across regions) · Priority High
The strategic compliance play, phased by jurisdiction: (a) an invoice-payload + hashing/QR layer; (b) KSA ZATCA/Fatoora first (clear spec) or India IRN/e-invoice, per your first market; (c) a per-tenant toggle + credential store. **Why:** increasingly mandatory. **Prereq:** external provider/API decision (ZATCA, GSP for India) — a research spike precedes coding. **Staging:** yes (external integration). **Note:** touches the public API contract only if we expose e-invoice status — surface for review. **No downtime.**

### Phase AC-5 — Fixed assets + depreciation · Effort L · Priority Medium
An asset register (cost, category, useful life, method), scheduled depreciation, and a period depreciation run posting `year_end_close`-style JEs to the existing accumulated-depreciation accounts; disposal handling. **Why:** removes manual depreciation JEs; real for auto-parts. **Prereq:** the accum-dep accounts exist. **Staging:** yes (posting). **No downtime** (new tables + RPC, additive).

### Phase AC-6 — Prepaid / accrual / deferred-revenue schedules · Effort M · Priority Medium
Generalize the recurring-JE engine into amortization schedules (prepaid expense, deferred revenue) that auto-post each period with a reversal-safe design. **Why:** eliminates month-end manual JE toil; builds on the existing recurring-JE feature. **Prereq:** recurring JE engine (exists). **Staging:** yes. **No downtime.**

### Phase AC-7 — India TDS / withholding · Effort M · Priority Medium (India tenants)
TDS on vendor payments: rate tables, deduction at payment, a TDS-payable ledger, and a challan/return summary — gated to India tenants. **Why:** hard India B2B requirement. **Prereq:** India tax profile (exists). **Staging:** yes. **No downtime.**

### Later / on-demand (parked, not scheduled)
Budget-vs-actual · cost centers/dimensions · bank feeds & auto-reconciliation · JE approval workflow (backlog L2) · financial ratios/KPIs · multi-entity/consolidation. Pull forward only on explicit request or customer demand.

---

## Recommended sequence & rationale

**AC-1 → AC-2 → AC-3 → AC-4**, then AC-5/AC-6/AC-7 as capacity allows.
- Start with **AC-1 (year-end close)** and **AC-2 (comparatives)** — both small, high-value, low-risk, and they make the books and statements "complete" for an accountant's eye.
- Then the **compliance pair (AC-3 VAT/GST return, AC-4 e-invoicing)** — the highest strategic value for the GCC/India market and the likeliest sales blockers, but larger and needing external-provider decisions, so they follow the quick wins.
- **AC-5/6/7** are automation/region features that reduce manual effort; schedule per demand.

**Cross-cutting guardrails (every phase):** preserve double-entry integrity (`je_must_balance`), keep TB balanced, respect period locks, patch posting RPCs from live definitions, add a regression tripwire per new posting path, and keep existing report/API shapes backward-compatible.

**Overlap with the Security & Infra backlog:** AC-1 = M4, AC-6/FX-revaluation relates to M5 (multi-currency, still gated behind C2). These are being pulled into the *accounting product roadmap* at your request; the security backlog otherwise remains future-only.

---

_Awaiting your review: confirm scope/priorities, or pick the first phase to spec in detail._
