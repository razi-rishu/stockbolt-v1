# StockBolt — AC-1.1: Fiscal Year Close Engine — Final Implementation Specification

**Created:** 2026-07-24 · Reflects the built artifact: `supabase/migrations/20260724000002_phase56_ac1_1_fiscal_year_close.sql` (+ a structural tripwire in `tests/integration/regressions.test.ts`). Decisions baked in: **hard close · closed/reopened only (draft reserved) · RE fixed 3100 · sequential close · LIFO reopen · reuse `accounting.write` · explicit status · AC-1.0 already shipped.**

Convention: **[VERIFIED]** = confirmed live. **[INFERENCE]** = design.

## 1. Final `fiscal_year_closes` schema
`id` (uuid PK) · `company_id` (FK companies, ON DELETE CASCADE) · `fiscal_year` (int) · `fiscal_year_start` / `fiscal_year_end` (date, snapshot) · `status` (text, CHECK `draft|closed|reopened`, default `draft`) · `je_id` (FK journal_entries; NULL for zero-activity/reopened) · `net_income` (numeric(15,2)) · `retained_earnings_code` (text, default `'3100'`) · `prior_lock_date` (date; the lock before this close) · audit: `created_at/by`, `closed_at/by`, `reopened_at/by`, `updated_at`.

## 2. Final indexes & constraints
- **`UNIQUE (company_id, fiscal_year)`** — one lifecycle row per company/year; status cycles. Idempotency backbone.
- `INDEX (company_id, status)`.
- `status` CHECK `IN ('draft','closed','reopened')`.
- RLS **enabled**; policy `fiscal_year_closes_read` = `SELECT USING company_id = current_user_company_id()`. `REVOKE ALL FROM anon, authenticated; GRANT SELECT TO authenticated`. No client writes — RPCs only.

## 3. Final RPC signatures
- `public.close_fiscal_year(p_fiscal_year integer) RETURNS jsonb` — SECURITY DEFINER, `search_path=public`. Returns `{fiscal_year, status:'closed', net_income, journal_entry_id, entry_number, fiscal_year_end}`.
- `public.reopen_fiscal_year(p_fiscal_year integer) RETURNS jsonb` — SECURITY DEFINER. Returns `{fiscal_year, status:'reopened', reversal}`.
- Grants: `REVOKE FROM PUBLIC, anon; GRANT EXECUTE TO authenticated`. Both call `auth_require('accounting.write')`. [VERIFIED `auth_require`/`has_perm`/`accounting.write` exist]

## 4. Complete `close_fiscal_year()` algorithm
1. Auth: `auth.uid()` + `current_user_company_id()` non-null; `auth_require('accounting.write')`.
2. FY window: `fy_start = make_date(p_fiscal_year, month(fiscal_year_start), day(fiscal_year_start))`; `fy_end = fy_start + 1yr − 1day`. [VERIFIED live]
3. Reject if `fy_end > CURRENT_DATE` (year not ended).
4. `SELECT … FOR UPDATE` the lifecycle row; if `status='closed'` → raise (idempotent).
5. Sequential guard: require FY(N−1) `closed`, else require it to have **no** income/expense activity (excl `year_end_close`); else raise "close prior year first".
6. Resolve RE `3100` → `account_id`; raise if missing.
7. `net_income = SUM(credit − debit)` over income+expense GL in `[fy_start, fy_end]` excluding `year_end_close`. Determine `has_legs` (any account with `SUM(debit) ≠ SUM(credit)`).
8. Upsert the row → `status='closed'`, `net_income`, snapshots, `prior_lock_date = current lock`, `closed_at/by`, clears `reopened_*`, `je_id=NULL` (handles reopened→closed).
9. If `has_legs`: sequence → JE header (`date=fy_end`, `source_type='year_end_close'`, `source_id=row.id`); loop posting accounts (`Dr=GREATEST(Σcr−Σdr,0)`, `Cr=GREATEST(Σdr−Σcr,0)` — zeroes any account incl. contra/archived, by `account_id`); RE leg (`Cr 3100=net_income` if profit, `Dr 3100=|net_income|` if loss, none if 0); update header totals; set `row.je_id`.
10. `period_lock_date = GREATEST(COALESCE(lock, fy_end), fy_end)` (never backward).
11. Best-effort `audit_logs`.

**JE construction** (§6): built **directly by `account_id`** (not via `post_journal_entry`, which filters `is_active` and can't zero archived accounts), amounts as above; RE leg = exact residual → **balances to the cent** [VERIFIED by read-only simulation: `total_debit = total_credit`, `net_income = Σdr − Σcr`].

## 5. Complete `reopen_fiscal_year()` algorithm
1. Auth + `auth_require('accounting.write')`.
2. `FOR UPDATE` row; require `status='closed'`.
3. **LIFO guard**: raise if any later fiscal year is `closed`.
4. **Roll lock back first**: `period_lock_date = prior_lock_date` (required — `reverse_journal_entry` blocks reversal when `orig.date ≤ lock` [VERIFIED]).
5. If `je_id` set and not already reversed → `reverse_journal_entry(je_id, 'Reopen FY …')` (mirror dated at year-end, inherits `source_type='year_end_close'` → still excluded from P&L; original marked `reversed_by_id`).
6. Set `status='reopened'`, `reopened_at/by`. Best-effort audit. Re-close later transitions `reopened → closed` with a new `je_id`.

## 6. Exact journal entry construction — see §4.9. Profit `Cr 3100`; loss `Dr 3100`; zero-activity → no JE (`je_id NULL`, still `closed`); contra/archived accounts included by `account_id`; per-year window makes sequential closes independent.

## 7. Transaction boundaries [VERIFIED]
Each RPC = one plpgsql transaction → JE + lock + record commit atomically or roll back together. `je_must_balance` is **DEFERRABLE INITIALLY DEFERRED**, validated at commit (a large multi-line close JE is fine).

## 8. Locking strategy
Close advances `period_lock_date` to `fy_end`; reopen restores `prior_lock_date`. LIFO reopen means the restore never unlocks a still-closed later year. `status` (not the lock) is the authoritative close state.

## 9. Idempotency guarantees
`UNIQUE(company_id, fiscal_year)` + `FOR UPDATE` + the `status='closed'` check → a repeat/concurrent close of the same year fails cleanly; exactly one active `year_end_close` JE per FY.

## 10. Concurrency handling
`SELECT … FOR UPDATE` serializes existing-row callers; the unique index serializes first-close races (loser gets a unique violation / sees `closed`).

## 11. Permission checks
Both RPCs `PERFORM auth_require('accounting.write')` (raises 42501 forbidden if absent). RLS on the table = tenant read only; writes only through the definer RPCs.

## 12. Failure & rollback scenarios
- Any raise inside an RPC → whole transaction rolls back (no partial close).
- Operational undo: `reopen_fiscal_year` (JE reversal + lock rollback) — repeatable.
- Deployment rollback: `DROP FUNCTION reopen_fiscal_year, close_fiscal_year; DROP TABLE fiscal_year_closes;` (additive migration; reverse any posted close via reopen first if desired).

## 13. Regression tripwires (this phase)
Structural, **soft-until-applied** (added to `regressions.test.ts`): `fiscal_year_closes` exists; status CHECK carries draft/closed/reopened; `UNIQUE(company_id, fiscal_year)` present; both RPCs exist; RPCs **not** anon-executable. Behavioural T1–T13 (profit/loss/zero/reopen/LIFO/archived/back-dated/multi-year/concurrent) land in **AC-1.3** under a writable test tenant (H4 staging).

---

**Status:** implemented + verified (typecheck 0, suite 93/93 with the tripwire soft-skipping, close-JE simulation balances). Migration awaits hand-apply; then `verify_invariants` review + AC-1.2 (adapter + UI) + AC-1.3 (behavioural tests). **Not committed — stopped for review.**
