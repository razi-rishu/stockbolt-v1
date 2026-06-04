/**
 * useInvalidateBooks — Phase 14.14k.
 *
 * Single source of truth for cache invalidation after any operation that
 * touches the general ledger, stock ledger, or aging.
 *
 * The senior-dev audit (2026-06-02) found that every editor module
 * (invoice, payment, vendor bill, GRN, expense, transfer, PDC, etc.)
 * invalidated ONLY its own list/detail key after a successful confirm /
 * void / edit. So:
 *
 *   - Operator confirms invoice → TB still shows old numbers
 *   - Operator confirms payment → AR aging still stale
 *   - Operator posts a stock transfer → stock_valuation stale
 *
 * The opening-balances page already does this correctly. This hook
 * lifts that pattern into a shared helper so every editor stays in
 * sync without copy-pasting a 15-line invalidation block.
 *
 * Usage:
 *
 *   const invalidateBooks = useInvalidateBooks();
 *
 *   const confirmMutation = useMutation({
 *     mutationFn: (...) => adapter.invoices.confirm(...),
 *     onSuccess: async () => {
 *       await invalidateBooks();           // sweeps GL/TB/BS/aging/etc.
 *       qc.invalidateQueries({ queryKey: ['invoices', company_id] });
 *       // …plus any other module-local keys
 *     },
 *   });
 *
 * Cost: invalidation only marks queries stale — actual refetch happens
 * lazily when each query is next observed. Calling this on every
 * mutation is essentially free.
 */
import { useCallback } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useAuthStore } from '@/store/auth';

/** Top-level keys that any GL- or stock-touching operation invalidates.
 *  Listed explicitly (not via predicate) so the file is greppable when
 *  someone adds a new report or list and wonders where to register it. */
const BOOKS_DOWNSTREAM_KEYS = [
  // ── Accounting reports ───────────────────────────────────────────────
  'general_ledger', 'gl_ledger',
  'trial_balance',
  'balance_sheet',
  'profit_and_loss',
  'cash_flow',
  'vat_return',
  'control_account_breakdown',

  // ── Aging & statements ───────────────────────────────────────────────
  'ar_aging',
  'ap_aging',
  'customer_statement',
  'supplier_statement',
  'supplier_statement_report',
  'advance_balance',

  // ── Dashboards / summaries ───────────────────────────────────────────
  'dashboard_cards',
  'daily-sales-summary',
  'report_daily_cash',

  // ── Open-document caches (depend on payments / allocations) ──────────
  'open_invoices',
  'open_bills',
  'open_bills_for_supplier',
  'open_bills_for_supplier_insight',
  'invoices_confirmed',
  'vendor_bills_confirmed',

  // ── Journal entries (the source) ─────────────────────────────────────
  'journal_entries',
  'je', 'je_lines',

  // ── Bank & reconciliation ────────────────────────────────────────────
  'bank_accounts', 'bankAccounts',
  'bank_recons', 'bank_recon_gl_lines',
  'report_bank_recon',

  // ── Inventory ledger & valuations ────────────────────────────────────
  'stock_movement',
  'stock_valuation',
  'current_stock_map',
  'products_stock_map',
  'product_stock_movement',
  'report_stock_movement',
  'report_reorder',
  'report_slow_moving',
  'report_stock_aging',
  'report_inv_adjustment',

  // ── Opening balances (3010 plug + posted list) ───────────────────────
  'opening_balances_posted',
  'ob_3010_balance',
] as const;

export function useInvalidateBooks() {
  const qc = useQueryClient();
  const company_id = useAuthStore((s) => s.company_id);

  return useCallback(async () => {
    // Mark every books-downstream cache stale. React Query refetches
    // lazily, so this is cheap regardless of how much is open.
    await Promise.all(
      BOOKS_DOWNSTREAM_KEYS.map((k) =>
        qc.invalidateQueries({ queryKey: [k] }),
      ),
    );

    // Some keys are nested per-company; the bare-key invalidation above
    // catches them via prefix-matching in React Query v5, but force the
    // common per-company variants explicitly for safety.
    if (company_id) {
      await Promise.all([
        qc.invalidateQueries({ queryKey: ['bank_accounts', company_id] }),
        qc.invalidateQueries({ queryKey: ['bank_accounts', company_id, 'all'] }),
        qc.invalidateQueries({ queryKey: ['bankAccounts', company_id] }),
        qc.invalidateQueries({ queryKey: ['dashboard_cards', company_id] }),
      ]);
    }
  }, [qc, company_id]);
}
