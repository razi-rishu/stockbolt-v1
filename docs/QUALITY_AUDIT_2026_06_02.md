# StockBolt v1 — Quality Audit (mid-Phase 14.14)

**Date:** 2026-06-02
**Scope:** Full codebase + Supabase migrations + RLS + RPC contracts
**Methodology:** Senior-dev pattern audit — focused on structural / runtime issues, not cosmetics.

## A. Schema ↔ RPC drift

- **supabase/migrations/20260523000001_phase14_09c (line 249–254)** — `void_opening_balance` re-queries `company_id` using `v_je_id` instead of `p_doc_id`. Works today but can silently return NULL under RLS. Failures on void of bank opening would leave doc + GL out of sync. **MEDIUM**
- **migrations/20260522000004 (line 285–292)** — `post_opening_balance` for `customer_credit` inserts a payment with `bank_account_id=NULL`. Verify against `payments` table — if NOT NULL, opening customer-credit rows fail at insert. **HIGH (verify)**
- **migrations/20260530000001_phase14_14g** — CHECK whitelist includes `pdc_bank_post`, `pdc_clear`, `pdc_bounce`, `advance_refund`, but no RPC writes those four. Either the whitelist has dead values or RPCs are silently missing. **LOW**
- **`_guard_no_double_post` (migrations/20260517000001)** — only blocks double-post on `sales_invoice`, `vendor_bill`, `sales_credit_note`, `vendor_debit_note`. Misses `expense`, `bank_transfer`, `pos_*`, `pdc_*`. A re-confirm after a transient error duplicates the JE. **HIGH**

## B. Dual sources of truth

- **bank_accounts.opening_balance (mitigated 14.14h)** — but `void_opening_balance` (14.09c line 294) resets the column to 0 regardless of whether a separate bank-opening JE still exists. Voiding one of two stacked bank openings zeroes the column while GL still carries the other. **HIGH**
- **reports/trial-balance reads GL; bank_accounts.opening_balance is a parallel mirror** — already known; mention because the mirror is read by `bank-accounts.tsx:204` (the "Opening (posted)" column) and the bank-recon page. Any drift surfaces visibly. **MEDIUM**
- No other `_balance` / `_total` cached columns found on master tables.

## C. Silent failure modes

- **Every editor form** calls `handleSubmit(onSubmit)` with NO `onInvalid` second argument. Only `setup-wizard.tsx` has it. Zod failures silently no-op the submit button — exactly the Phase 14.13i bug, generalized. Affected: `invoice-editor.tsx`, `vendor-bill-editor.tsx`, `payment-editor.tsx`, `credit-note-editor.tsx`, `debit-note-editor.tsx`, `quote-editor.tsx`, `po-editor.tsx`, `grn-editor.tsx`, `transfer-editor.tsx`, `adjustment-editor.tsx`, `bank-transfer-editor.tsx`, both `expense-editor.tsx` files, `bank-accounts.tsx`, all of `modules/settings/*`. **CRITICAL**
- **`audit_logs` EXCEPTION WHEN OTHERS THEN NULL** — fine to swallow audit failures, but no `RAISE WARNING` means an RLS/schema-drift bug silently disables auditing for hours. **LOW**
- **opening-balances.tsx:240–256** — `voidRow` catches errors but partial success (JE reversed, doc still confirmed) is undetectable. **MEDIUM**

## D. Cache invalidation gaps — the **CRITICAL** cluster

- **invoice-editor.tsx:341–413** — confirm / void / edit-repost invalidates only `invoices` / `invoice_items`. Missing: `trial_balance`, `balance_sheet`, `general_ledger`, `ar_aging`, `dashboard_cards`, `daily_sales`. **CRITICAL**
- **payment-editor.tsx:345–369** — same. Payment confirm doesn't invalidate TB/BS/AR-aging. **CRITICAL**
- **vendor-bill-editor.tsx:342–357** — same: missing TB/BS/AP-aging. **CRITICAL**
- **expense-editor.tsx, bank-transfer-editor.tsx, pdc-issued.tsx, pdc-received.tsx** — same pattern. PDC creation/clear/bounce moves cash but TB/BS not invalidated. **HIGH**
- **vendor-payment-editor.tsx, grn-editor.tsx, sales-return-editor.tsx, credit-note-editor.tsx, debit-note-editor.tsx, inventory/adjustment-editor.tsx, inventory/transfer-editor.tsx** — same gap. **HIGH**
- **opening-balances.tsx:243–253** is COMPLETE and CORRECT. Use as the canonical pattern. (reference)

## E. RPC ↔ adapter contract mismatch

- **supabaseAdapter.ts:579 `reverse_journal_entry`** — adapter passes 2-arg signature; migration is `(p_journal_entry_id UUID, p_reason TEXT)`. Confirm arg names match. **MEDIUM (verify)**
- **supabaseAdapter.ts:3303 `confirm_pos_sale`** — sends `p_sale_id` per editor; migration uses `p_session_id` + line payload. Spot-check signature. **MEDIUM (verify)**

## F. RLS coverage gaps

No multi-tenant tables found without RLS. `bank_reconciliations`, `salespeople`, `expense_items` all have policies. **OK**

- **audit_logs RLS interaction** — RPCs writing audit_logs use `SECURITY INVOKER`. If `auth.uid()` is null inside a SECURITY DEFINER caller chain, audit insert fails silently inside the EXCEPTION handler. Explains sparse audit trails. **LOW**

## G. Validation gaps

- **bank-accounts.tsx schema** — `name_ar`, `bank_name`, `account_number`, `iban`, `swift_code`, `branch` are bare `z.string()`. Defaults supply `''` so it works today, but reset/edit paths that produce `undefined` will fail silently because of (C). Same pattern likely repeats across settings forms. **HIGH**
- **opening-balances.tsx** — no max-rows guard. Pasting 1000 rows posts serially with no batch progress. **LOW**
- **No form defines `mode: 'onBlur'` or `'onChange'`** — users see no inline errors until first submit attempt; with (C) above they see *nothing*. **MEDIUM**

## H. Hard-coded magic values

- **opening-balances.tsx:104–111** — `CONTROL_ACCOUNT_CODES` hard-codes `'1200','2100','2400','1400','1300','3010'` outside `src/core/seeds/`. If a tenant edits a CoA code, the wizard mis-classifies. **MEDIUM**
- **`'AED'` literal in 24 files** including most editors. India / Saudi tenants silently get their payments tagged AED. **HIGH**
- **`post_gl_opening_balance` (14.09b:124)** and **`post_bank_opening_balance` (14.09c:115)** hard-code `'AED'` for JE currency regardless of company base currency. **HIGH**
- **Fiscal-year-start defaults to Jan 1 in `document_sequences`** — Indian tenants use Apr 1. **MEDIUM**

## I. Other smells

- **Three opening-balance RPCs reserve JE numbers via `INSERT … ON CONFLICT DO UPDATE … current_value + 1` with hard-coded initial value 1001** — if a tenant already has a JE sequence row at 5000 (existing transactions), first opening conflicts and jumps. Order-of-operations bug. **MEDIUM**
- **opening-balances.tsx saveEdit (Phase 14.14i)** — void-then-repost is TWO separate RPC calls. If repost fails after void succeeds, the original is already voided and the operator sees error with no row visible. No client-side compensating action. **HIGH**
- **reverse_journal_entry** errors propagate generically. UX shows raw Postgres error — can't distinguish "period locked" from "JE not found". **MEDIUM**
- **bank-reconciliation.tsx:115–132** — invalidates recon keys but not `bank_accounts` (which carries opening_balance mirror). Stale opening shown after recon. **MEDIUM**
- **reset_company_data has been patched 4 times** (12.13, 12.13b, 14.13e, 14.13f). Suggest a single full re-read against the latest table inventory. **MEDIUM**
- **No pagination on list queries** — `invoices.list`, `vendor_bills.list`, `payments.list`, `general_ledger.list` all return full tables. Will degrade at 10k+ JEs. **MEDIUM (scale risk)**
- **tsc.out + db-push-error.log** present at repo root — should be `.gitignore`d. **LOW**

---

## Recommended fix order (highest leverage first)

1. **(D) Cache invalidation** — copy the opening-balances `onSuccess` pattern into every editor's mutations. Single batched commit. This alone eliminates "I confirmed but report didn't update" complaints across the entire ERP.
2. **(C) Add `onInvalid` to every `handleSubmit`** — either via a shared `useFormWithErrors` hook or `@tanstack/react-form` wrapper. Removes the silent-submit-button class of bugs forever.
3. **(H) Replace hard-coded `'AED'` with company base currency** — pull from `useAuthStore` or a `useCompany()` hook. India / Saudi / Kuwait tenants get correct currency.
4. **(I) Bundle void+repost into one RPC** — adds atomicity to opening-balance edit (14.14i).
5. **(A) Extend `_guard_no_double_post`** — cover expense/transfer/PDC source_types.

Items 1–3 each take 2–4 hours and remove whole classes of bugs. Items 4–5 are more surgical, do them after the broad sweeps.
