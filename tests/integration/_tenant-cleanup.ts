/**
 * INFRA-1 — remove a synthetic test tenant completely, or fail loudly.
 *
 * A company is held by 46 tables with ON DELETE RESTRICT/NO ACTION. Onboarding
 * seeds some of them (chart of accounts, units, payment methods, warehouses),
 * company triggers seed others (tax_rates via tg_seed_tax_rates; a trial
 * subscription and its history via tg_new_company_subscription), and the
 * suites add documents, ledgers and masters. Deleting only the company fails,
 * and every suite used to ignore that error, so tenants piled up on staging.
 *
 * TENANT_DELETE_ORDER is every company-scoped table, children before parents.
 * It was derived on 2026-11-03 from the FK graph of the local staging schema,
 * which is fingerprint-identical to production. Item tables have no
 * company_id: they go with their header document (ON DELETE CASCADE), so a
 * header is placed before every master its items reference.
 * subscription_history has a company_id but no FK, so it is deleted
 * explicitly.
 *
 * Safety: every delete is filtered by one exact company id, which is never
 * NULL, so global reference rows (company_id NULL) can't match. The company
 * must also carry the suite's synthetic name prefix and be recent, or nothing
 * is deleted at all.
 */
import type { SupabaseClient } from '@supabase/supabase-js';

export const TENANT_DELETE_ORDER = [
  'amortization_entries', 'amortization_schedules', 'api_keys', 'api_request_log', 'attachments',
  'audit_logs', 'bank_reconciliations', 'bank_transfers', 'expenses', 'leave_salary_payments',
  'payments', 'payroll_runs', 'bank_accounts', 'billing_addresses', 'brands', 'categories',
  'general_ledger', 'credit_notes', 'debit_notes', 'deferred_cogs_queue', 'goods_receipts',
  'inventory_adjustments', 'sales_returns', 'invoices', 'product_serials', 'purchase_orders',
  'purchase_returns', 'sales_orders', 'sales_quotes', 'stock_ledger', 'stock_transfers',
  'vendor_bills', 'products', 'tax_rates', 'vendor_bill_landed_costs', 'chart_of_accounts',
  'company_invites', 'pdc_cheques', 'product_supplier_codes', 'tds_deductions', 'contacts',
  'depreciation_entries', 'document_sequences', 'e_invoice_documents', 'employee_loans',
  'payroll_run_items', 'employees', 'exchange_rates', 'fiscal_year_closes', 'fixed_assets',
  'geographic_areas', 'geographic_regions', 'journal_entries', 'notifications', 'payment_allocations',
  'payment_methods', 'pos_sessions', 'price_levels', 'print_template_defaults', 'print_templates',
  'profiles', 'projects', 'role_permissions', 'roles', 'salespeople', 'subscription_history',
  'subscription_payments', 'subscriptions', 'tax_filings', 'tds_sections', 'units_of_measure',
  'vehicle_engines', 'vehicle_makes', 'warehouses',
] as const;

/** A tenant may be destroyed only if it was created this recently (clock skew included). */
const MAX_AGE_MS = 6 * 60 * 60 * 1000;

export interface TenantToDestroy {
  companyId: string;
  /** Auth users this suite created for the tenant. */
  userIds: string[];
  /** The synthetic name every company of this suite starts with, e.g. 'TAX Scratch '. */
  namePrefix: string;
}

// The generated DB types don't list every table; deletes here are untyped on purpose.
type Untyped = { from: (t: string) => any }; // eslint-disable-line @typescript-eslint/no-explicit-any

/**
 * Deletes everything `t` owns, then the company, then its auth users, and
 * re-checks that nothing is left. Returns what went wrong; it never throws.
 */
export async function destroyTenant(admin: Pick<SupabaseClient, 'auth'>, t: TenantToDestroy): Promise<string[]> {
  const db = admin as unknown as Untyped;
  const failed: string[] = [];
  const dropUsers = async () => {
    for (const id of t.userIds) {
      const { error } = await admin.auth.admin.deleteUser(id);
      if (error && !/not found/i.test(error.message)) failed.push(`auth user ${id}: ${error.message}`);
    }
  };

  const { data: co, error: coErr } = await db.from('companies').select('id, name, created_at').eq('id', t.companyId).maybeSingle();
  if (coErr) return [`companies ${t.companyId}: ${coErr.message}`];
  if (!co) { await dropUsers(); return failed; } // company never created, or already gone
  const age = Date.now() - new Date(co.created_at).getTime();
  if (!String(co.name).startsWith(t.namePrefix) || age > MAX_AGE_MS) {
    // Not provably ours: delete nothing.
    return [`refused: company ${t.companyId} ("${co.name}", created ${co.created_at}) is not a synthetic tenant of this suite`];
  }

  for (const table of TENANT_DELETE_ORDER) {
    const { error } = await db.from(table).delete().eq('company_id', t.companyId);
    if (error) failed.push(`${table}: ${error.message}`);
  }
  const { error: delErr } = await db.from('companies').delete().eq('id', t.companyId);
  if (delErr) failed.push(`companies ${t.companyId}: ${delErr.message}`);
  await dropUsers();

  // Re-check rather than trust the deletes.
  const { count } = await db.from('companies').select('id', { count: 'exact', head: true }).eq('id', t.companyId);
  if (count) failed.push(`company ${t.companyId} still exists`);
  for (const table of TENANT_DELETE_ORDER) {
    const { count: left, error } = await db.from(table).select('company_id', { count: 'exact', head: true }).eq('company_id', t.companyId);
    if (error) failed.push(`${table} (re-check): ${error.message}`);
    else if (left) failed.push(`${table}: ${left} row(s) left`);
  }
  return failed;
}

/** destroyTenant(), but throws so the hook or test that called it fails. */
export async function destroyTenantOrThrow(admin: Pick<SupabaseClient, 'auth'>, t: TenantToDestroy): Promise<void> {
  const failed = await destroyTenant(admin, t);
  if (failed.length) throw new Error(`[cleanup] tenant ${t.companyId} left residue:\n  ${failed.join('\n  ')}`);
}
