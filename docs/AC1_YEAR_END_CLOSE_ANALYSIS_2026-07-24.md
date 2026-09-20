# StockBolt — AC-1: Fiscal Year-End Close — Analysis (spec for approval)

**Created:** 2026-07-24 · **Type:** analysis only, nothing implemented · **Scope:** what a proper year-end close requires, grounded in live code + live DB.

Convention: **[VERIFIED]** = read from live code/DB. **[INFERENCE]** = reasoned/design judgement.

---

## 1. Current year-end behaviour
- **[VERIFIED]** There is **no close RPC** and **no `year_end_close` JE has ever been posted** (0 rows live). Income and expense accounts accumulate **indefinitely** — nothing zeroes them.
- **[VERIFIED]** `getBalanceSheet` (supabaseAdapter.ts:1998) pulls all GL up to `as_of_date` and folds **all-time** income−expense into a **synthetic `__CPE__` "Current Period Earnings"** equity line so `Assets = Liabilities + Equity` holds. `3100 Retained Earnings` holds only opening amounts.
- **[VERIFIED]** The BS code is **explicitly designed for close to exist** — its own comment: *"Year-end close JEs zero out the income/expense accounts and push into retained earnings, so this sum naturally tracks the un-closed period's earnings only."*
- **[VERIFIED]** `companies.fiscal_year_start` (set at onboarding — GCC Jan 1, India Apr 1) and `companies.period_lock_date` (single DATE) exist. Equity accounts: **3010 Opening Balance Equity, 3100 Retained Earnings, 3200 Owner's Equity**.

Net: mid-period the BS **balances and is numerically correct**, but there is no crystallized retained earnings, no closing entry, and "Current Period Earnings" actually lumps **every un-closed year** into one line.

## 2. Gap analysis vs a commercial ERP
- **[INFERENCE]** Commercial ERPs take one of two approaches: **(a) hard close** — post an explicit closing entry that zeros income/expense into retained earnings (SAP, Tally, older systems); or **(b) soft close** — never post a physical entry, compute retained earnings dynamically per fiscal year and show "current year earnings" separately (Xero, QuickBooks Online).
- StockBolt today is a **partial soft close that isn't fiscal-year-aware**: `__CPE__` approximates current-year earnings but lumps all un-closed years, and RE never crystallizes.
- **Recommendation [INFERENCE]: implement a HARD close.** Rationale: `year_end_close` is already whitelisted as a source_type; the BS is already written to expect it; and a hard close yields the **auditable closing entry an accountant can point to** (the stated M4 goal). A soft-close refactor (make `__CPE__` fiscal-year-aware, compute prior-year RE dynamically) is the alternative but changes report math more invasively and yields no closing entry.

## 3. Accounting rules to follow
- **[INFERENCE, standard GAAP/IFRS]**
  - Close as of the **fiscal year-end** (the day before `fiscal_year_start`'s month/day — e.g. Dec 31 or Mar 31), **per company**.
  - **Zero every income and expense LEAF account** for the fiscal year: `Dr` income (to clear its credit balance), `Cr` expense (to clear its debit balance).
  - The balancing amount goes to **Retained Earnings (3100)**: `Cr 3100` on a net profit, `Dr 3100` on a net loss.
  - The closing JE **must balance** (`je_must_balance`); it touches **only** income/expense and 3100 — never asset/liability/other-equity.
  - **Idempotent:** exactly one active close per `(company, fiscal_year)`.
  - Post to **posting (leaf) accounts**, never parent/summary accounts.
  - Dividends/drawings are **not** modeled as a close step today; treat them as separate manual JEs to 3100/3200 (note for later).

## 4. Required journal entries
- **[INFERENCE]** One `year_end_close` JE dated at fiscal year-end:
  - For each income leaf account with FY movement: `Dr <income> = net credit movement`.
  - For each expense leaf account with FY movement: `Cr <expense> = net debit movement`.
  - Net: `Cr 3100` (profit) or `Dr 3100` (loss) for the balancing figure.
- **Amounts = each account's NET MOVEMENT DURING the fiscal year being closed** (`fiscal_year_start … fiscal_year_end`), not its all-time balance — so **sequential year-by-year closes** compose correctly (closing FY1 zeros FY1; the BS as-of a date in FY2 then shows only FY2).
- `source_type = 'year_end_close'` **[VERIFIED already in the CHECK constraint]**, `source_id` = the new `fiscal_year_closes` record id (for drill-down + idempotency).

## 5. Retained-earnings workflow
- **[VERIFIED + INFERENCE]** `3100 Retained Earnings` accumulates: opening RE (bookkeeper clears `3010 → 3100` post-migration) **+ each closed year's net income**. The close posts net income to 3100; thereafter the BS's `__CPE__` shows only the **current open year**, and 3100 shows the crystallized prior-year total — the correct equity split.

## 6. Period-locking interaction
- **[VERIFIED]** Every posting RPC rejects `date <= companies.period_lock_date`. The close JE is dated at year-end, so:
  - **[INFERENCE]** `close_fiscal_year()` (SECURITY DEFINER) posts the closing JE **then advances `period_lock_date` to the fiscal-year-end**, locking the closed year against back-dated changes.
  - Guard: refuse to close a year that is **already closed**; require the target year not already lock-blocked for the close JE (the RPC posts before advancing the lock; if a prior lock already covers year-end, either the definer RPC bypasses its own guard for the close JE only, or the caller unlocks first — **design decision to confirm**).
  - **Reopen** moves `period_lock_date` back before year-end **and** voids the close JE.

## 7. Multi-company implications
- **[VERIFIED]** Single-entity, fully `company_id`-scoped + RLS-isolated. Each company closes **its own** fiscal year (own `fiscal_year_start`, `period_lock_date`, 3100). The RPC operates on `current_user_company_id()`; the new tracking table is `company_id`-scoped. **No consolidation/intercompany** (that's a separate enterprise item, parked). Sub-account structures close at leaf level.

## 8. Edge cases
- **[INFERENCE]**
  - **Re-close / idempotency:** unique `(company_id, fiscal_year)` where not reversed → double-close blocked.
  - **Reopen / rollback:** void the close JE (restores income/expense to pre-close balances), move `period_lock_date` back, mark the record reversed → then adjust and re-close.
  - **Adjustments after close:** a locked year blocks back-dating. Material fixes → reopen → adjust → re-close; immaterial → post to the current open year (standard prior-period handling).
  - **First close with multiple un-closed years:** close each fiscal year **in sequence** (FY1, then FY2 …).
  - **Stub first year:** a mid-year company start closes a partial first period (company start → first year-end).
  - **Net loss:** `Dr 3100` (RE can go negative — accumulated deficit).
  - **Zero-activity year:** no income/expense movement → no JE to post (skip; `je_must_balance` would reject an empty JE).
  - **Multi-currency:** close is in base currency; open FC AR/AP revaluation is out of scope here (ties to M5, gated behind C2).

## 9. Database changes
- **[VERIFIED]** `year_end_close` **is already in the `journal_entries.source_type` CHECK constraint** → **no CHECK change needed**.
- **[INFERENCE — additive]** NEW `fiscal_year_closes(company_id, fiscal_year, year_end_date, je_id, closed_at, closed_by, reversed_by_id, reversed_at)` with a partial unique index on `(company_id, fiscal_year)` where not reversed (idempotency + audit + reopen).
- **[INFERENCE]** NEW RPCs: `close_fiscal_year(p_fiscal_year)` and `reopen_fiscal_year(p_fiscal_year)` (SECURITY DEFINER, per-company). A read-only `preview_year_end_close(p_fiscal_year)` (or client-side compute) to show the entry before posting.
- **[VERIFIED]** No change to existing posting RPCs. `year_end_close` is **not** in the `_guard_no_double_post` whitelist (4 doc types), so idempotency comes from the new table's unique index, not that trigger.

## 10. API / UI changes
- **[INFERENCE]** Adapter: `closeFiscalYear`, `reopenFiscalYear`, `listFiscalYearCloses`, `previewYearEndClose`.
- UI: a new **Accounting → Year-End Close** page — select the fiscal year, **preview** the closing entry (income/expense → zero, net → RE), confirm + post; list closed years with reopen. Surfaces the closing JE via the existing `<DocLink>` drill-down.
- **No change to the public Edge API** (internal accounting only).

## 11. Reports affected
- **[VERIFIED — REQUIRED CHANGE] P&L (`getProfitAndLoss`, line 1941) must EXCLUDE `year_end_close`.** It currently sums income/expense GL rows in the date range with **no source-type filter**, so a closed year's P&L (whose range includes the year-end close date) would include the closing JE and show **~zero profit**. Fix: join `general_ledger → journal_entries` and filter `source_type <> 'year_end_close'` (or a `related_doc_type` filter). Same exclusion for any **income/expense analytics** and the **Cash Flow** net-income basis.
- **[VERIFIED — NO CHANGE] Balance Sheet must INCLUDE `year_end_close`** — the close JE correctly moves the amount from `__CPE__` into 3100; total equity unchanged, split corrected. Already handled.
- **[INFERENCE] Trial Balance: include** — a post-close TB correctly shows income/expense = 0 and RE accumulated, and still balances.
- **[INFERENCE] GL / Audit Log / Reversal Trail:** the close JE appears as a system entry (correct).

## 12. Rollback strategy
- **[INFERENCE]** `reopen_fiscal_year()` voids the close JE + moves `period_lock_date` back + marks the record reversed — fully reversible, no data loss. Migration rollback = `DROP` the new table + RPCs (additive). No tenant books altered irreversibly.

## 13. Regression tests
- **[INFERENCE]** After close: (a) each income/expense **leaf** account nets to **zero** for the closed FY; (b) **3100 moved by exactly net income**; (c) **TB still balances**; (d) **BS: A = L + E** and `__CPE__` = **current-year-only**; (e) **P&L for the closed year still shows real activity** (excludes the close JE) — the key report tripwire; (f) **idempotency:** a second close of the same FY is blocked; (g) **reopen** restores income/expense and unlocks; (h) the close JE satisfies `je_must_balance`.

## 14. Recommended implementation phases
- **AC-1.0 — Report guard (do FIRST, small, report-layer only):** make `getProfitAndLoss` (and cash-flow net-income basis / income-expense analytics) **exclude `year_end_close`**. Ships safely *before* any close exists and prevents the closed-year-P&L-shows-zero bug the moment closes begin. No posting/schema change.
- **AC-1.1 — Close engine (migration, hand-applied):** `fiscal_year_closes` table + `close_fiscal_year` / `reopen_fiscal_year` RPCs (post the JE, record the close, advance/rewind `period_lock_date`). Patched from live definitions; a regression tripwire per new posting path.
- **AC-1.2 — Adapter + UI:** the Year-End Close screen (preview → confirm → closed-years list → reopen) + adapter methods.
- **AC-1.3 — Regression tests:** lock the §13 invariants.

**Sequence:** AC-1.0 → AC-1.1 → AC-1.2 → AC-1.3. AC-1.0 is a cheap correctness prerequisite; the engine and UI follow; tests lock it.

---

### Open decisions for you to confirm before implementation
1. **Hard close (recommended)** vs soft close (dynamic RE). I recommend hard close.
2. **Post the close to `3100 Retained Earnings`** (recommended) vs a dedicated "current-year earnings" account.
3. **Period-lock on close:** auto-advance `period_lock_date` to year-end on close (recommended), and whether the close RPC may post at/before an existing lock (definer bypass) or requires a prior unlock.
4. **Multi-year first close:** support closing several past years sequentially in one flow, or one year at a time.

_Awaiting your review and approval before implementing AC-1.0._
