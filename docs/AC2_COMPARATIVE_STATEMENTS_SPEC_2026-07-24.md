# StockBolt — AC-2: Comparative Financial Statements — Specification

**Created:** 2026-07-24 · Analysis + spec only, no implementation. Reuses the existing report engine; **no posting changes, no schema changes.**

Convention: **[REUSE]** = existing primitive used as-is · **[NEW]** = net-new (all presentation/date-math layer).

---

## 0. Core idea (one paragraph)
A comparative statement is the **same report, run for two periods, shown side by side with variance**. StockBolt already has the accounting engine for each statement — `reports.getProfitAndLoss(company, from, to)`, `reports.getBalanceSheet(company, asOf)`, `accounting.getTrialBalance(company, asOf)`. AC-2 calls each of those **once per period** (current + previous), then **merges the two results by `account_code` on the client** and computes variance. No new SQL, no duplicated accounting logic, no re-derivation of a single number. The current-period call reuses the **same TanStack Query key** the normal report already uses, so switching a report into "compare" mode adds exactly **one** extra query (the previous period) and reuses everything else.

## 1. Surface — in-place "Compare" toggle (recommended)
Add a **"Compare with previous period"** toggle to the three existing report pages (`profit-loss.tsx`, `balance-sheet.tsx`, `trial-balance.tsx`), beside the `PeriodPicker`/`ReportActions` in the `PageHeader` actions. [REUSE the pages, the picker, the actions bar]
- **Off** → the report renders exactly as today (zero behaviour change).
- **On** → the table gains **Previous** + **Variance** + **Variance %** (P&L, BS) / **Difference** (TB) columns.
- A **"Compare to"** basis selector appears next to the toggle: **Previous period** (default) · **Same period last year**.

*Alternative considered:* dedicated `/reports/comparative/*` pages. Rejected — duplicates each page's layout + drill-down and adds nav weight, for no gain over an in-place toggle. (Open decision #1.)

## 2. Previous-period resolution — the one new piece of date logic [NEW, pure]
A pure, unit-tested helper computes the previous window from the current one + the company's fiscal year + the basis:

```ts
type CompareBasis = 'previous_period' | 'previous_year';
// range reports (P&L):
resolveComparativeRange(cur: {from,to}, preset, basis, fiscalYearStart)
  → { current: {from,to}, previous: {from,to} }
// as-of reports (BS, TB):
resolveComparativeAsOf(curAsOf, preset, basis, fiscalYearStart)
  → { current: asOf, previous: asOf }
```

**Rules**
| Current selection | Previous period | Same period last year |
|---|---|---|
| This / Last **Month** | preceding calendar month | same month, −1 year |
| This / Last **Quarter** | preceding calendar quarter | same quarter, −1 year |
| This / Last **Year** | **prior fiscal year** (via `fiscal_year_start`) | prior fiscal year (same thing) |
| **Custom** `[from,to]` | equal-length range ending the day **before** `from` | `[from−1y, to−1y]` |
| **As-of** (BS/TB) | end of the prior period | `asOf − 1 year` |

- **Fiscal-year awareness (req 5):** only the **Year** case re-anchors to the fiscal year, read from `companies.fiscal_year_start` (month/day). `resolvePeriodRange` (shared by ~30 reports, calendar-based) is **left untouched** — all fiscal logic is localized to this helper. (Open decision #3.)

## 3. Merge + variance — pure functions [NEW, pure]
```ts
mergeComparativePL(cur: ProfitAndLoss, prev: ProfitAndLoss): ComparativePL
mergeComparativeBS(cur: BalanceSheet, prev: BalanceSheet): ComparativeBS
mergeComparativeTB(cur: TrialBalance, prev: TrialBalance): ComparativeTB
```
- **Join by `account_code`.** An account present in only one period gets `0` for the missing side and still appears.
- **Variance** = `current − previous` (raw signed number).
- **Variance %** = `previous === 0 ? null : (variance / |previous|) × 100`; rendered as **"—"** when `null` (previous was zero → not meaningful). `0/0` → `0%`.
- Section grouping / ordering is preserved from the current-period result (Revenue → COGS → Gross Profit → Other Income → OpEx → Net Profit for P&L; Assets/Liab/Equity for BS; type groups for TB).
- **Coloring:** numbers neutral by default; bottom-line rows (Gross Profit, Net Profit, Total Assets, Difference totals) get favorable/unfavorable color (green/red) with a ▲/▼ glyph. (Open decision #4 — neutral vs full account-type-aware favorable/unfavorable coloring.)

## 4. Per-statement layout

### 4.1 Profit & Loss (req 1)
Columns: **Account · Current · Previous · Variance · Variance %**. [REUSE `PLSection` collapsible] — each section header shows the three totals when **collapsed**; expand shows account rows with all four value columns. Drill-down (click row → GL) preserved. Bottom Net Profit row colored by sign.

### 4.2 Balance Sheet (req 2)
Two "as-of" dates (e.g. **31 Dec 2025 vs 31 Dec 2024**). Columns: **Account · Current · Previous · Variance · Variance %**. [REUSE `SubSection` collapsible + `BSRow` drill-down]. Section + grand totals (Total Assets, Total Liab+Equity) gain the same columns; the **balanced** check runs per period. Working-capital callout can show both periods (optional).

### 4.3 Trial Balance (req 3)
Columns: **Code · Account · Type · Current Dr · Current Cr · Previous Dr · Previous Cr · Difference**, where **Difference = (curDr−curCr) − (prevDr−prevCr)** (signed net change). Each period's **totals must still balance** (Σdebit = Σcredit) — shown per period in the footer. Control-account per-contact drill-down preserved for the current period. (Wide table → §8 mobile scroll; option to collapse each period to a single signed-net column for width — open decision #5.)

## 5. Date selection (req 4)
[REUSE `usePeriodPicker` + `PeriodPicker`] unchanged for the **current** period — Month / Quarter / Year / Custom already supported by the preset set (`this_month`, `this_quarter`, `this_year`, `custom`, plus the "last_*" presets). The **previous** period is derived (§2), never picked. Per-page persistence (localStorage) unchanged; a new key remembers the compare toggle + basis per report (`stockbolt.report.<key>.compare`).

## 6. Fiscal-year awareness (req 5)
The **Year** comparison uses the company fiscal year (`companies.fiscal_year_start`) so "This Year vs Last Year" means fiscal years, not calendar years, when the current selection is a year. Month/Quarter remain calendar sub-periods (accountants read monthly/quarterly comparatives on the calendar). No migration — `fiscal_year_start` already exists and is read.

## 7. Multi-company isolation (req 6)
Every query keys on `company_id` (existing pattern) and every adapter method filters by `company_id` server-side. Switching company changes the query key → clean refetch, no cross-tenant bleed. Nothing new required; covered by a regression scenario (§11).

## 8. Export (req 7), Print (req 8), Mobile (req 9)
- **Excel:** [REUSE `ReportActions` → `downloadXLSX`]. Comparative export rows carry the extra columns: `Section, Code, Account, Current, Previous, Variance, Variance%` (TB: `…, Current Dr, Current Cr, Previous Dr, Previous Cr, Difference`). One thin `map`, no new export code.
- **PDF:** the app has **no server-side PDF generator** — "PDF" = the existing **Print → Save as PDF** browser path (same mechanism AC-1.2 used). The Print button already does `window.print()`; comparative columns print as-is. *If a true generated-PDF file is required, that is a separate future item — flagged, not assumed.* (Open decision #2.)
- **Print:** [REUSE] `window.print()` + `data-print-hide` app chrome (already fixed). No new print plumbing.
- **Mobile:** comparative tables are wide (5–8 columns). [REUSE] the global `div:has(> table){overflow-x:auto}` rule so the table scrolls horizontally inside its card; prioritize Current + Variance, optionally hide **Variance %** below a breakpoint. Dark-mode + RTL inherited.

## 9. Performance (req 10)
- **Reuse engine, no duplicated logic:** comparative calls the three existing report methods only.
- **No duplicate queries:** the **current** period uses the *same* query key as the normal report (`['pl', company, from, to]` etc.) → served from cache when the toggle flips; the **previous** period is a second query, `enabled` only while compare is on. TanStack Query dedupes identical keys.
- Merge/variance is O(n) over already-fetched lines. Two GL scans (one per period) is the irreducible minimum for a comparative; both are already date+company bounded.

## 10. Required adapter methods (req 11)
**None new (recommended).** The feature is a client-side composition of the three existing methods — this is precisely how "no duplicated accounting logic" is honoured. New code is all presentation-layer:
- `useComparativePeriods` hook (wraps the §2 resolver + fires the two queries).
- `mergeComparativePL/BS/TB` pure functions (§3).
- The three comparative types (`ComparativePL/BS/TB`) in `adapter.ts` (types only, no methods).

*Alternative:* thin adapter wrappers `getComparative*` that call the existing methods twice + merge. Rejected — pushes presentation math into the data layer and risks drift; the merge belongs in the UI. (Open decision #6.)

## 11. Regression scenarios (req 12)
Comparative is pure presentation over existing methods → the right lock is **unit tests** on the pure functions (`tests/unit/`, no DB) — the exact class the structural suite can't express:
- `resolveComparative*`: month/quarter/year/custom × {previous_period, previous_year} × fiscal_year_start ∈ {Jan-1, Apr-1}; equal-length preservation for custom; quarter/leap-year boundaries; as-of −1 period vs −1 year.
- `mergeComparative*`: current==previous → variance 0 / 0% · previous 0, current≠0 → variance% "—", variance = current · account only in current (prev 0) and only in previous (cur 0) both appear · both 0 dropped/zero · section order preserved.
- **Manual/parity checklist** (not automatable in the structural suite): comparative **Current** column == the single-period report for the same range (P&L/BS/TB); each period's TB balances and BS balances; `year_end_close` stays excluded in **both** P&L periods (inherited from AC-1.0); company switch refetches with no stale rows.
- **No new DB tripwire** — nothing in the database changed.

## 12. Rollback plan (req 13)
Purely additive, presentation-only, zero data risk. To revert: remove the Compare toggle + basis selector from the three pages, delete `useComparativePeriods` + the merge helpers + the comparative types + the unit tests. No DB, schema, posting, or adapter changes to undo. (Dedicated-pages variant, if chosen instead: also remove the routes + nav entries.)

## 13. Accounting integrity
Every figure is taken **verbatim** from the existing report methods; comparative only **subtracts** (variance) and **divides** (variance %). MAC, COGS, `year_end_close` exclusion, the BS `__CPE__` fold, and TB balancing are all inherited unchanged. Integrity preserved by construction.

---

## Locked decisions (confirmed 2026-07-24)
1. **Surface:** in-place **"Compare with previous period" toggle** on the 3 existing report pages. No dedicated pages.
2. **PDF:** satisfied by the existing **Print → Save-as-PDF** browser path. No new PDF engine in AC-2.
3. **Fiscal-year scope:** fiscal-aware **Year** comparison only (reads `fiscal_year_start`); month/quarter stay calendar; the shared `resolvePeriodRange`/`usePeriodPicker` is untouched.
4. **Variance coloring:** neutral account rows; only **bottom-line totals** colored green/red with ▲/▼.
5. **TB layout:** **Dr/Cr per period + Difference** (accountant-standard), inside an `overflow-x-auto` wrapper for mobile.
6. **Adapter:** **no new adapter methods** — the previous-period resolver, the two queries, and the merge/variance live in a UI hook + pure functions.

_Spec complete. Awaiting the go-ahead to implement._
