# StockBolt — AC-1.1: Fiscal Year Close Engine — Technical Specification (design review)

**Created:** 2026-07-24 · **Type:** design review only — nothing implemented, no migration, no RPC, no code. Awaiting approval.

Convention: **[VERIFIED]** = read from live code/DB. **[INFERENCE]** = design decision/reasoning.

**Anchoring facts [VERIFIED]:** `year_end_close` is already in the `journal_entries.source_type` CHECK. `je_must_balance` is a **DEFERRABLE INITIALLY DEFERRED** constraint (validated at commit). `_guard_no_double_post` only whitelists 4 doc types (not `year_end_close`). Period lock is a single `companies.period_lock_date`; every posting RPC rejects `date <= lock`. `post_journal_entry` resolves accounts by `code AND is_active=true` (can't touch archived accounts). `reverse_journal_entry` rejects when `orig.date <= lock`, dates the mirror at the **voucher date**, and the mirror **inherits `source_type`** (so a reversed close is also `year_end_close`). Equity accounts: `3100 Retained Earnings`. AC-1.0 already excludes `year_end_close` from the P&L (and cash-flow net-income basis).

---

## 1. `fiscal_year_closes` table schema

```sql
CREATE TABLE public.fiscal_year_closes (
  id                  uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id          uuid        NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  fiscal_year         integer     NOT NULL,          -- starting calendar year, e.g. 2025
  fiscal_year_start   date        NOT NULL,          -- snapshot of the FY start actually used
  fiscal_year_end     date        NOT NULL,          -- the close (voucher) date; snapshot
  status              text        NOT NULL DEFAULT 'draft'
                        CHECK (status IN ('draft','closed','reopened')),
  je_id               uuid        REFERENCES public.journal_entries(id),  -- active close JE (NULL in draft/reopened)
  net_income          numeric(15,2) NOT NULL DEFAULT 0,   -- snapshot of the closed period's net income
  retained_earnings_code text     NOT NULL DEFAULT '3100', -- RE account code used (snapshot)
  prior_lock_date     date,                          -- period_lock_date before this close (for reopen rollback)
  -- audit fields
  created_at          timestamptz NOT NULL DEFAULT now(),
  created_by          uuid,
  closed_at           timestamptz,  closed_by   uuid,
  reopened_at         timestamptz,  reopened_by uuid,
  updated_at          timestamptz NOT NULL DEFAULT now()
);
```

**Constraints & indexes [INFERENCE]:**
- **`UNIQUE (company_id, fiscal_year)`** — one lifecycle row per company per fiscal year; **status cycles** (`draft → closed → reopened → closed …`), the row is never duplicated. This is the idempotency backbone.
- Index `(company_id, status)` for the closed-years list; `(company_id, fiscal_year DESC)` for ordering.
- FK `je_id → journal_entries(id)` (no cascade; the JE audit chain lives in `journal_entries.reversed_by_id`).
- **RLS:** enable; a tenant `SELECT` policy scoped to `company_id = current_user_company_id()` (so the UI can read closed years); **no client INSERT/UPDATE/DELETE** — all writes go through the SECURITY DEFINER RPCs. Grants: SELECT to authenticated (via RLS); RPCs EXECUTE to authenticated.

**Status enum semantics [INFERENCE] — the key "independent of period lock" design:**
- **`draft`** — the close is *prepared/staged*: `net_income` computed and persisted, but **no JE posted and the period is NOT locked by this close**. A review-before-commit state.
- **`closed`** — the close JE is posted (`je_id` set) and `period_lock_date` has been advanced to `fiscal_year_end`.
- **`reopened`** — the close JE has been reversed and `period_lock_date` rolled back; the year is open for adjustment. `je_id` retained for audit (points at the now-reversed JE).

`status` is the **authoritative fiscal-close state**; `period_lock_date` is advanced/rolled-back as a *side effect* of the transitions but remains a separate mechanism the owner can also drive manually — exactly "complement, don't replace".

---

## 2. `close_fiscal_year(p_fiscal_year int)` workflow

SECURITY DEFINER, `SET search_path=public`, EXECUTE to authenticated. One RPC call = one transaction (atomic).

**2a. Validation sequence [INFERENCE]:**
1. Resolve `v_company_id` via `current_user_company_id()` (JWT); reject if null. Permission check (`accounting.write`, or a dedicated `accounting.close` — decision).
2. Compute the FY window (§2b). Reject if `fiscal_year_end > CURRENT_DATE` (can't close an unfinished year).
3. **Ordering guard [decision]:** require `fiscal_year - 1` to be `closed` (or have no activity) — close years in sequence. (Recommended; can be soft.)
4. **Idempotency:** `SELECT … FOR UPDATE` the `fiscal_year_closes` row for `(company, fiscal_year)`. If `status='closed'` → RAISE "already closed". If `draft`/`reopened`/absent → proceed. The `FOR UPDATE` + the `UNIQUE(company_id, fiscal_year)` serialize concurrent callers (§5).
5. Resolve the RE account (`retained_earnings_code`, default `3100`) → `account_id`; reject if missing.

**2b. Fiscal year calculation [VERIFIED inputs / INFERENCE formula]:**
`companies.fiscal_year_start` is a DATE whose **month+day** define the boundary (the year component is just the onboarding year). For `p_fiscal_year = Y`:
```
fy_start := make_date(Y, EXTRACT(month FROM fiscal_year_start), EXTRACT(day FROM fiscal_year_start));
fy_end   := (fy_start + INTERVAL '1 year' - INTERVAL '1 day')::date;
```
E.g. Jan-start: FY2025 = 2025-01-01 … 2025-12-31. India Apr-start: FY2025 = 2025-04-01 … 2026-03-31.

**2c. Journal-entry construction [INFERENCE — the core]:**
Aggregate the fiscal year's **real** P&L movement from `general_ledger` joined to `journal_entries`, grouped by `(account_id, account_code)` for income/expense account types, over `[fy_start, fy_end]`, **excluding `source_type='year_end_close'`** (so prior close/reversal artifacts never re-enter — makes re-close after reopen correct):
- Per income account: `Dr = SUM(credit) - SUM(debit)` (its net credit balance for the FY).
- Per expense account: `Cr = SUM(debit) - SUM(credit)` (its net debit balance for the FY).
- `net_income := Σ(income Dr) − Σ(expense Cr)`.
- Balancing RE leg: `Cr 3100 = net_income` (profit) or `Dr 3100 = |net_income|` (loss). RE leg = the exact residual, so the entry balances to the cent regardless of rounding.

Because aggregation uses **`account_id` from the GL rows**, it includes **archived/inactive** accounts that had activity — which `post_journal_entry` (code + `is_active`) could not (§5). Therefore the close **inserts the JE directly** (not via `post_journal_entry`), replicating its header/sequence/audit pattern.

**2d. Posting order (within the single transaction) [INFERENCE]:**
1. Advance `document_sequences` (`JE` prefix) → entry number.
2. Insert `journal_entries` header: `date=fy_end`, `source_type='year_end_close'`, `source_id=<this fiscal_year_closes.id>`, totals.
3. Insert `general_ledger` rows (income Dr, expense Cr, RE leg) using resolved `account_id` + `account_code`, `date=fy_end`.
4. Advance the lock: `period_lock_date := GREATEST(COALESCE(period_lock_date, fy_end), fy_end)` (never moves backward). Snapshot the pre-close value into `prior_lock_date`.
5. Upsert `fiscal_year_closes`: `status='closed'`, `je_id`, `net_income`, `fy_start/fy_end`, `closed_at=now()`, `closed_by=auth.uid()`.
6. Best-effort `audit_logs` (never fails the close).
7. `je_must_balance` validates at COMMIT.

**2e. Transaction boundaries [VERIFIED]:** a plpgsql function runs in a single transaction — JE + lock + record commit together or roll back together. No partial close.

**2f. Idempotency guarantees [INFERENCE]:** `UNIQUE(company_id, fiscal_year)` + the `FOR UPDATE` row lock + the `status='closed'` guard → a second concurrent or repeated close of the same year fails cleanly; exactly one close JE per fiscal year exists at a time.

**2g. Zero-activity [INFERENCE]:** if the FY has no income/expense movement, `net_income=0` and there are no legs — skip the JE (`je_id=NULL`), but still record `status='closed'` and advance the lock (the year is closed, just empty). Avoids an empty JE (which `je_must_balance` would reject).

**Draft path [INFERENCE, per your refinement]:** an optional `p_confirm=false` (or a separate `prepare_year_end_close`) computes `net_income`, upserts the row as `status='draft'`, posts **no** JE and **does not** lock — for staging/preview. Confirming re-runs the compute and transitions `draft → closed`.

---

## 3. `reopen_fiscal_year(p_fiscal_year int)` workflow

SECURITY DEFINER, atomic.

**3a. Validations [INFERENCE]:**
1. Resolve company; permission check.
2. `SELECT … FOR UPDATE` the row; require `status='closed'`. Else RAISE.
3. **LIFO guard:** reject if any **later** fiscal year is `closed` (can't reopen a year that sits inside a still-closed later year). Reopen proceeds newest-first.

**3b. Reversing strategy [INFERENCE — order matters]:**
Because `reverse_journal_entry` rejects when `orig.date (fy_end) <= period_lock_date`, and the close set the lock to `fy_end`:
1. **First roll the lock back** to `prior_lock_date` (the snapshot; if that is still ≥ fy_end for some reason, use `fy_end − 1 day`).
2. Then reverse the close JE (`reverse_journal_entry(je_id)` or an inline mirror): a mirror JE dated `fy_end`, `reversal_of_id=je_id`, Dr↔Cr flipped, `source_type='year_end_close'` (inherited), and the original marked `reversed_by_id`. This **restores income/expense** and **removes the amount from RE**.
- If `je_id` is NULL (zero-activity close), there is nothing to reverse — just roll back the lock.

**3c. Period-lock rollback [INFERENCE]:** `period_lock_date := prior_lock_date` (from the close snapshot). Because reopen is LIFO, this correctly reopens exactly the target year without unlocking still-closed later years.

**3d. Audit trail [INFERENCE]:** set `status='reopened'`, `reopened_at=now()`, `reopened_by=auth.uid()`; keep `je_id` pointing at the now-reversed close JE. The JE-level history (original close + its reversal mirror) lives in `journal_entries.reversed_by_id`/`reversal_of_id`; best-effort `audit_logs`. A subsequent re-close transitions `reopened → closed` with a **new** `je_id`.

---

## 4. Complete journal-entry specification

- **Account selection [INFERENCE]:** every **posting (leaf) account of type `income` or `expense`** with non-zero net movement in the FY (from GL grouped by `account_id`), excluding `year_end_close` legs. Parent/summary accounts never appear (posting is to leaves). Archived accounts **are** included (by `account_id`).
- **Amount calculation [INFERENCE]:** income leg `Dr = Σcredit − Σdebit`; expense leg `Cr = Σdebit − Σcredit`; RE leg = exact residual.
- **Profit:** `Cr 3100 = net_income` (`Σ income Dr > Σ expense Cr`).
- **Loss:** `Dr 3100 = |net_income|`.
- **Zero activity:** no JE; record closed with `net_income=0` (§2g).
- **Partial fiscal year [INFERENCE]:** a mid-year company start closes a stub (`company earliest activity → fy_end`); the formula still uses the FY window — activity simply begins after `fy_start`. No special case beyond snapshotting `fy_start/fy_end`.
- **Multiple fiscal years [INFERENCE]:** closed **one year at a time, in order** (your decision). Each close zeros that year's movement into RE; the BS's `__CPE__` shrinks year-by-year as each is crystallized. `net_income` per year is independent because each close sums only its own `[fy_start, fy_end]` window (excluding prior close JEs).

---

## 5. Edge cases

| Case | Handling [INFERENCE] |
|---|---|
| **Reopened years** | `status='reopened'`; a fresh re-close sums real activity (excludes the reversed close + its mirror, both `year_end_close`) and posts a new JE. |
| **Multiple closes / double-close** | `UNIQUE(company_id, fiscal_year)` + `FOR UPDATE` + `status='closed'` guard → blocked. |
| **Back-dated entries after close** | The closed year is lock-protected (`period_lock_date ≥ fy_end`), so posting RPCs reject back-dated activity. Material fixes → reopen → adjust → re-close; immaterial → post to the current open year. |
| **Fiscal-year changes** | The close **snapshots `fiscal_year_start/end`** used, so historical closes stay anchored. Changing `companies.fiscal_year_start` after closures affects only future FY windows; a mid-history change creating a stub is flagged as an accountant-assisted event, not auto-handled. |
| **Deleted accounts** | An income/expense account with FY activity cannot be hard-deleted (GL FK). If it were, its GL rows persist by `account_id`; the close still zeros them. |
| **Archived (inactive) accounts** | Included — the close builds legs by `account_id`, bypassing the `is_active` filter that blocks `post_journal_entry`. |
| **Rounding** | GL amounts are `numeric(15,2)`; the RE leg is the exact residual of the (already-rounded) legs, so the JE balances to the cent and `je_must_balance` passes. No tolerance needed. |
| **Concurrent requests** | The `SELECT … FOR UPDATE` on the lifecycle row (and the unique constraint) serialize concurrent close/reopen for the same year; the loser gets a clean "already closed"/lock wait. |

---

## 6. Reports affected
- **P&L / cash-flow net-income basis** — already exclude `year_end_close` (AC-1.0). No further change. **[VERIFIED]**
- **Balance Sheet** — must **include** the close JE (moves `__CPE__` → 3100); already correct. **[VERIFIED]**
- **Trial Balance** — includes the close JE; a post-close TB correctly shows income/expense = 0 for closed years and accumulated RE, and still balances. **[INFERENCE]**
- **New: Year-End Close screen** (AC-1.2) lists `fiscal_year_closes` with status + drill-down to the close JE via `<DocLink>`. **[INFERENCE]**
- **`verify_invariants` / reconciliation DB functions** — review when closes exist so their income/expense sums remain consistent (they'll see zeroed closed-year income/expense; ensure the invariant compares like-for-like). **[INFERENCE — revisit in AC-1.3, not AC-1.1]**

## 7. Posting invariants (must hold after any close/reopen)
1. The close JE balances (`Σdebit = Σcredit`) — enforced by `je_must_balance`.
2. **Trial Balance still nets to zero** across all accounts.
3. **A = L + E** on the Balance Sheet; `__CPE__` reflects only un-closed years.
4. Each **closed** fiscal year's income/expense **net movement = 0** once its close JE is included.
5. `Δ Retained Earnings (3100) = net_income` of the closed year (exactly).
6. **Closed-year P&L still shows real activity** (close JE excluded) — the AC-1.0 guarantee.
7. Exactly **one active (non-reversed) `year_end_close` JE per (company, fiscal_year)**.
8. No stock/inventory/cash effect (close touches only income/expense + equity).

## 8. Rollback strategy
- **Operational:** `reopen_fiscal_year` fully reverses a close (JE reversal + lock rollback) — no data loss; a year can be reopened, adjusted, re-closed indefinitely.
- **Deployment:** additive migration — `DROP FUNCTION close_fiscal_year / reopen_fiscal_year; DROP TABLE fiscal_year_closes;`. No existing object altered. Any already-posted `year_end_close` JEs would remain (harmless; P&L excludes them, BS includes them) — or be reversed first via reopen before dropping. **[INFERENCE]**

## 9. Regression test matrix
| # | Scenario | Assertion |
|---|---|---|
| T1 | Close a profit year | income/expense net-0 for the FY; `Cr 3100 = net_income`; TB balances; JE balances. |
| T2 | Close a loss year | `Dr 3100 = |net_income|`; invariants hold. |
| T3 | Zero-activity year | no JE (`je_id NULL`); status `closed`; lock advanced. |
| T4 | Closed-year P&L | shows real income/expense (close JE excluded) — AC-1.0 tripwire. |
| T5 | Balance Sheet post-close | `__CPE__` = current-year-only; 3100 = accumulated; A=L+E. |
| T6 | Double-close same FY | second call blocked (unique + status). |
| T7 | Reopen then re-close | reopen restores income/expense + rolls lock back; re-close posts a new JE; net effect = re-close only. |
| T8 | Reopen non-latest year | blocked by LIFO guard while a later year is closed. |
| T9 | Archived account with FY activity | included in the close JE (by account_id). |
| T10 | Back-dated posting into a closed year | rejected by the period lock. |
| T11 | Sequential multi-year close | FY1 then FY2 each crystallize independently; RE = Σ per-year net income. |
| T12 | Concurrent close of same FY | exactly one succeeds; the other errors cleanly. |
| T13 | Structural | `fiscal_year_closes` exists with the status CHECK; RPCs are service-safe & permission-gated; unique index present. |

---

### Open decisions for you to confirm before AC-1.1 implementation
1. **Permission:** reuse `accounting.write`, or add a dedicated `accounting.close` capability?
2. **Ordering guard:** hard-require FY(N−1) closed before FY(N), or allow out-of-order (soft warning)?
3. **Draft persistence:** support a persisted `draft` (stage → confirm two-step) now, or treat `draft` as reserved and ship only `closed`/`reopened` in AC-1.1?
4. **RE account:** fixed to `3100`, or a configurable company setting (`retained_earnings_code`)?

_Awaiting your review and approval before implementing AC-1.1._
