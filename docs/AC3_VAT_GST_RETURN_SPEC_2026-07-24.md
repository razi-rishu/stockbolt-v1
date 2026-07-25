# StockBolt — AC-3: VAT/GST Return & Filing — Specification

**Created:** 2026-07-24 · Analysis + spec only. Reuses the existing tax/accounting engine; **one small additive migration** (hand-applied). No posting-logic change.

Convention: **[REUSE]** existing · **[NEW]** net-new · **[DEFER]** larger follow-on, flagged not assumed.

---

## 0. Current state (what already exists)
- **`reports.getVATReturn(company_id, from, to)`** [REUSE] — reads the **General Ledger** for the period: Output VAT (2200, credits−debits), Input VAT (1500, debits−credits), sales (4100), expenses (5100); emits UAE VAT201 boxes 1/4/5/9 + an emirate place-wise split (1a–1g via `contacts.region_id` + `geographic_regions`); `net_vat_payable = output − input`. Because it reads **GL, it is posted-only by construction** — drafts never post, voids are reversed to net zero. It performs **no tax recomputation** (amounts are already posted).
- **Limits today:** UAE-only (hardcoded 2200/1500); **India GST not computed** (a GST company's return shows zeros); zero-rated/exempt/reverse-charge/imports/exports are **not split** (boxes 4/5 are hardcoded 0); there is **no filing lifecycle** (no saved return, no lock-on-file, no amendments, no reconciliation, no filing history).
- **Tax data model:** `tax_rates {name, rate, tax_type: 'VAT'|'GST'|'IGST', coa_input_account_id, coa_output_account_id}`; documents carry line `tax_rate`, `tax_amount`, `line_subtotal` and header `tax_amount`. Tax **accounts** — UAE: 1500 input / 2200 output; India: 1510/1520/1530 input CGST/SGST/IGST, 2210/2220/2230 output. `companies {country_code, is_tax_registered, tax_id, fiscal_year_start}` — **no filing-frequency field**. `contacts {tax_id (TRN/GSTIN), region_id}`. **Not modeled:** per-line tax *treatment* (zero vs exempt vs RCM vs export/import), HSN codes, place-of-supply state, B2B/B2C flag.
- **Period lock:** single `companies.period_lock_date`; every posting RPC already rejects `date ≤ lock`. **Audit:** `audit_logs`. **Export/print:** `ReportActions` (Excel + Print→PDF), `downloadCSV`.

## 1. Architecture — three layers, maximal reuse
1. **Return engine [REUSE + extend, read-only].** Make `getVATReturn` **jurisdiction-aware** off `company.country_code`: UAE → aggregate 2200/1500; India → aggregate output GST (2210+2220+2230) and input GST/ITC (1510+1520+1530). Same GL-reading, posted-only approach; **no new accounting logic, no recompute**. Rename/alias to `getTaxReturn` returning a jurisdiction-tagged structure (keep `getVATReturn` as a thin wrapper for the existing report → no breakage).
2. **Filing lifecycle [NEW, mirrors AC-1 year-end close].** A `tax_filings` table + `file_tax_return` / `reopen_tax_return` RPCs (SECURITY DEFINER, `auth_require`). Filing **snapshots** the computed return and **advances `period_lock_date`** to the period end — reusing the *existing* lock so "filed periods become locked" needs **no posting-logic change**; reopen restores the prior lock and re-opens the period (exactly the AC-1 pattern).
3. **Reconciliation [NEW, read-only].** Compare the **GL tax-account movement** for the period against the **tax derived from posted source documents** (`Σ invoices.tax_amount` for sales, `Σ vendor_bills.tax_amount` for purchases). Equal by design unless a manual JE hit a tax account, or a document's posted tax ≠ its header — exactly the mismatches to surface (same spirit as `verify_invariants`' AR/AP checks). Reuses document tax data; recomputes nothing.

## 2. Schema — minimal, additive, hand-applied
Only two additions (one table, one column). One migration, idempotent, applied by hand in the Supabase SQL editor (the phase56 pattern).

**`tax_filings`** — the filing register:
```
id uuid pk · company_id uuid fk · jurisdiction text CHECK ('AE_VAT','IN_GST')
period_type text CHECK ('monthly','quarterly') · period_start date · period_end date
status text CHECK ('draft','filed','reopened') DEFAULT 'draft'
output_tax numeric(15,2) · input_tax numeric(15,2) · net_payable numeric(15,2)
boxes jsonb                      -- the computed return snapshot (jurisdiction boxes)
reconciliation jsonb             -- snapshot of the GL-vs-documents check at filing time
prior_lock_date date             -- for reopen (restore the lock)
reference_number text            -- government acknowledgement no. (FTA / GSTN), optional
notes text · created_at/by · filed_at/by · reopened_at/by · updated_at
UNIQUE (company_id, jurisdiction, period_start, period_end)
```
RLS: tenant **read-only**; all writes via the definer RPCs (`REVOKE … ; GRANT SELECT TO authenticated`).

**`companies.tax_filing_frequency`** text `CHECK ('monthly','quarterly')` DEFAULT `'quarterly'` (UAE default quarterly; India monthly for GSTR-3B). Nullable/defaulted → backfills cleanly.

*(No change to any posting RPC, trigger, or existing table's semantics.)*

## 3. Requirements → design

**1 Jurisdictions.** `company.country_code` selects UAE VAT (`AE`, and GCC 5% VAT) vs India GST (`IN`). One engine, jurisdiction branch. [REUSE company config]

**2 Reports** (all from the one engine): Tax Summary (output, input, net), Sales/Output tax, Purchase/Input tax, Net Payable/Refundable — plus the existing place-wise split. Rendered on a new **Tax Return** page (reusing the report page shell + `PeriodPicker` + `ReportActions`).

**3 Return preparation.** Generated from **posted GL only** (reuse getTaxReturn) → drafts/voids excluded by construction. **Respects the period lock** (a read; filing then advances the lock). **Amendments:** reopen the filed period → post corrections into it (lock rolled back) → re-file (new snapshot); the `status` cycles filed→reopened→filed, mirroring AC-1.

**4 Filing periods.** `companies.tax_filing_frequency` (monthly/quarterly). The page offers period presets aligned to it (calendar month/quarter — GCC VAT quarters are calendar by law; India monthly). Reuses `usePeriodPicker`.

**5 Reconciliation.** Layer 3 above: GL tax accounts vs document-derived tax, with a summary card (matched ✓ / mismatch amount) and a drill-list of offending JEs/documents. Snapshotted into `tax_filings.reconciliation` at filing.

**6 Locking.** `file_tax_return` sets `period_lock_date = GREATEST(lock, period_end)` and `status='filed'`; posting into a filed period is then rejected by the **existing** lock guard. **Reopen** (`reopen_tax_return`) requires `accounting.write` (or the filing permission — decision #3), restores `prior_lock_date`, sets `status='reopened'`, and writes an `audit_logs` row. **Every reopen is audited.**

**7 Country-specific.**
- **UAE VAT201:** standard-rated (by emirate 1a–1g, existing), zero-rated, exempt, reverse-charge, imports, standard-rated expenses (box 9), net. Standard-rated + net are fully supported today; **zero/exempt/RCM/imports/exports split needs per-line tax-treatment metadata** → see §4 tiering [DEFER for full fidelity; core surfaces what the data supports].
- **India GSTR-1** (outward: B2B via `contacts.tax_id` present, B2C otherwise, export, RCM) **+ GSTR-3B** (summary: outward tax, ITC = input GST, net). Output/ITC/net fully supported from GL; **invoice-level GSTR-1 detail + HSN + place-of-supply state** need metadata → [DEFER].

**8 Corrections.** Credit/Debit Notes and adjustments already post to GL → the return **auto-includes** them for the period. Prior-period corrections: a CN/DN dated in a **filed (locked)** period is blocked by the lock (must reopen to amend); dated in the open period, it corrects the current return — standard VAT practice. No new correction mechanism; reuse the document engine.

**9 Audit.** `tax_filings` carries filed/reopened by+at; `file`/`reopen` write `audit_logs`. **Filing history** = the `tax_filings` list (period, status, net, filed by/on, reference no., drill to the snapshot).

**10 Export.** Excel + Print→PDF via `ReportActions` [REUSE]; **CSV** via `downloadCSV` [REUSE]. Government **e-file formats** (FTA VAT201 XML, GSTN GSTR JSON) → [DEFER] (need the §4 metadata to be schema-valid).

**11 Permissions.** View = `accounting.read`; **File/Reopen** = `accounting.write` — or a dedicated **`tax.file`** permission for segregation of duties / filing approval (decision #3). RPCs enforce via `auth_require`; UI gates the buttons.

**12 Multi-company isolation.** Every query + RPC scoped by `company_id`; `tax_filings` RLS = tenant read; unique `(company_id, jurisdiction, period)`. No cross-tenant surface.

**13 Performance.** GL reads are bounded by `company_id + account_code + [from,to]` (indexed); one aggregation per tax account; the filing snapshot means historical returns render from the stored `boxes` without re-scanning GL. Reconciliation is two bounded sums.

**14 Regression plan.** Mirror **AC-1.3A**: structural tripwires (soft-until-applied) in `regressions.test.ts` — `tax_filings` exists with the right CHECKs + unique index + RLS read-only; `file_tax_return`/`reopen_tax_return` exist, are `auth_require`-gated, not anon-executable; markers that `file` advances the lock and `reopen` restores it + audits. Read-only **data invariants** (warn-only): filed periods have `period_lock_date ≥ period_end`; net_payable = output − input in every snapshot; the reconciliation snapshot matched at filing time. Plus **pure unit tests** for the box-mapping/period math (jurisdiction account sets, monthly/quarterly boundaries). Behavioural file→lock→reopen tests → the staging-gated suite (AC-1.3B pattern).

**15 Rollback plan.** Additive only. `DROP FUNCTION reopen_tax_return, file_tax_return; DROP TABLE tax_filings; ALTER TABLE companies DROP COLUMN tax_filing_frequency;` (reverse any filed period via reopen first if desired). The engine extension to `getTaxReturn` is a code revert; the existing `getVATReturn` wrapper keeps the current report working throughout.

## 4. Scope tiering (the key call)
- **AC-3 CORE (recommended now):** jurisdiction-aware return engine (UAE + India, output/input/net) · the filing lifecycle (file→lock→reopen+audit, filing history) · reconciliation (GL vs documents) · the Tax Return page · Excel/CSV/Print · permissions · multi-company · regression + rollback. Reuses the engine + lock + audit + export; **one table + one column**. Delivers a real, lockable, auditable VAT/GST return for both countries at the fidelity the current data supports (standard-rated fully; other categories surfaced from GL where distinguishable).
- **AC-3 FULL-FIDELITY (deferred track):** complete FTA VAT201 (zero/exempt/RCM/import/export split) and GSTN GSTR-1 invoice/HSN/state detail + **government e-file output**. Requires **new classification metadata captured at document entry** (per-line tax treatment, place-of-supply, HSN, RCM flag, customer registration) — a document-model + UI change beyond the return module. Flagged as its own phase, not folded into AC-3, to honour "minimise schema changes / preserve posting integrity."

## Locked decisions (confirmed 2026-07-24)
1. **Scope:** ship **AC-3 Core** now (jurisdiction-aware output/input/net + filing lifecycle + lock + reconciliation + audit + export; one `tax_filings` table + one `companies.tax_filing_frequency` column). **Full FTA VAT201 / GSTN GSTR box-fidelity + government e-file is a separate deferred phase** (needs document-entry classification metadata — do NOT fold into AC-3).
2. **Locking:** filing **advances the existing `companies.period_lock_date`** (reuses the proven posting guard) and reopen restores `prior_lock_date` — the AC-1 Year-End Close mechanism. **No posting-logic change.**
3. **Filing permission:** reuse **`accounting.write`** for file/reopen. No new permission key.
4. **e-file output:** **deferred.** AC-3 ships Excel / CSV / Print→PDF only; FTA XML / GSTN JSON belongs to the full-fidelity phase.

_Spec complete. Awaiting the go-ahead to implement (and suggested increment plan below)._

## Suggested increments (on approval)
- **AC-3A** — migration (`tax_filings` + `tax_filing_frequency`) + the jurisdiction-aware `getTaxReturn` engine extension + adapter types/methods + unit tests for box-mapping/period math. Analysis-verified, no UI.
- **AC-3B** — the Tax Return page (report + reconciliation panel + file/reopen modals + filing history), reusing the report shell / `ReportActions` / DocLink; nav + i18n.
- **AC-3C** — regression: structural tripwires (soft-until-applied) + read-only invariants + the staging-gated behavioural file→lock→reopen suite.
