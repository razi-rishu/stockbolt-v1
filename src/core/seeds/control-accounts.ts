/**
 * Seed CoA codes referenced by name across the codebase — Phase 14.14s.
 *
 * The audit (item H — MEDIUM) flagged hard-coded magic codes scattered
 * across the frontend, particularly `CONTROL_ACCOUNT_CODES` in the opening-
 * balances wizard. The same six codes appear hard-coded in several RPCs
 * (post_opening_balance, edit_invoice, confirm_payment, etc.) and across
 * report queries. There is no single source of truth — if the seed CoA
 * ever changes, you have to grep-and-pray.
 *
 * This module collects the codes the front-end needs into one named-
 * export bundle. The accounts themselves are still seeded by
 * `src/core/seeds/seedCOA.ts` and re-asserted by the onboarding RPC at
 * company create time. Operators can't edit code/type/is_system on a
 * system row (Phase 14.10 locks those fields), so these codes are stable
 * for the life of a tenant — but the lookup-by-code is now explicit.
 *
 * Don't add codes here that aren't part of the system seed. Custom
 * accounts the operator creates (1111 ADCB, 1112 IDBI, etc.) carry
 * is_system=false and have arbitrary codes; they don't belong here.
 */

/** Receivable / payable / advances / inventory control accounts that
 *  shouldn't be touched by direct-GL opening balances. The operator
 *  is steered to the dedicated wizard (subsidiary grid for AR/AP,
 *  inventory wizard for stock) instead. */
export const CONTROL_ACCOUNT_CODES = {
  AR:                 '1200',   // Accounts Receivable
  AP:                 '2100',   // Accounts Payable
  CUSTOMER_ADVANCES:  '2400',   // Customer Advances (liability)
  VENDOR_ADVANCES:    '1400',   // Vendor Advances / Prepaid (asset)
  INVENTORY:          '1300',   // Inventory Asset
  OPENING_EQUITY:     '3010',   // Opening Balance Equity (contra account)
} as const;

/** Set form for membership checks (`CONTROL_ACCOUNT_CODE_SET.has(...)`).
 *  Built from CONTROL_ACCOUNT_CODES so the two stay in sync. */
export const CONTROL_ACCOUNT_CODE_SET: ReadonlySet<string> = new Set(
  Object.values(CONTROL_ACCOUNT_CODES),
);

/** Bank-and-cash parent codes used by the CoA quick-create flow
 *  (Phase 14.13d) to detect when a new sub-account should also be
 *  mirrored into bank_accounts. */
export const BANK_PARENT_CODES = {
  BANK_MAIN: '1110',   // 1110 Bank Account (Main)
  CASH:      '1100',   // 1100 Cash in Hand
} as const;

export const BANK_PARENT_CODE_SET: ReadonlySet<string> = new Set(
  Object.values(BANK_PARENT_CODES),
);
