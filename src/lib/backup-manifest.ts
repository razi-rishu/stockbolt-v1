/**
 * What a company backup contains — and, just as importantly, what it does not.
 *
 * THE TRAP THIS MANIFEST EXISTS TO AVOID
 * The obvious way to build "export everything" is to list the tables that have
 * a `company_id` and loop over them. That would be wrong, and wrong silently:
 * every line-item table (`invoice_items`, `vendor_bill_items`, and eleven
 * siblings) has NO `company_id` — it is scoped through its parent document.
 * A backup built that way saves every invoice header without a single line on
 * it. It downloads, it opens, it looks complete, and it is worthless.
 *
 * So the list is explicit and auditable rather than derived, and a regression
 * test compares it against the live schema so a NEW table cannot quietly be
 * left out of everyone's backup.
 *
 * TENANT SAFETY
 * Every table here has RLS enabled (verified against the live database), and
 * the export runs as the signed-in user through the ordinary authenticated
 * client — never the service key. The rows a user can export are exactly the
 * rows they could already read in the app; the backup adds reach, not access.
 */

/** Tables the backup reads, in dependency order (parents before children) so
 *  the file reads sensibly and a future importer can walk it top to bottom. */
export const BACKUP_TABLES: readonly string[] = [
  // ── Identity & configuration ──────────────────────────────────────────
  'companies',
  'profiles',
  'roles',
  'role_permissions',
  'user_permission_overrides',
  'company_invites',
  'document_sequences',
  'print_templates',
  'print_template_defaults',
  'notifications',

  // ── Master data ───────────────────────────────────────────────────────
  'chart_of_accounts',
  'tax_rates',
  'tax_profiles',
  'exchange_rates',
  'payment_methods',
  'price_levels',
  'units_of_measure',
  'categories',
  'brands',
  'warehouses',
  'salespeople',
  'geographic_regions',
  'geographic_areas',
  'contacts',
  'billing_addresses',

  // ── Catalogue ─────────────────────────────────────────────────────────
  'products',
  'product_price_levels',
  'product_compatibility',
  'product_serials',
  'product_supplier_codes',
  'vehicle_makes',
  'vehicle_engines',

  // ── Sales ─────────────────────────────────────────────────────────────
  'sales_quotes',        'sales_quote_items',
  'sales_orders',        'sales_order_items',
  'invoices',            'invoice_items',
  'credit_notes',        'credit_note_items',
  'sales_returns',       'sales_return_items',
  'payments',
  'payment_allocations',
  'pos_sessions',

  // ── Purchasing ────────────────────────────────────────────────────────
  'purchase_orders',     'purchase_order_items',
  'goods_receipts',      'goods_receipt_items',
  'vendor_bills',        'vendor_bill_items',
  'vendor_bill_landed_costs',
  'debit_notes',         'debit_note_items',
  'purchase_returns',    'purchase_return_items',
  'expenses',            'expense_items',

  // ── Inventory ─────────────────────────────────────────────────────────
  'stock_ledger',
  'stock_transfers',     'stock_transfer_items',
  'inventory_adjustments', 'inventory_adjustment_items',
  'deferred_cogs_queue',

  // ── Accounting ────────────────────────────────────────────────────────
  'journal_entries',
  'general_ledger',
  'bank_accounts',
  'bank_transfers',
  'bank_reconciliations',
  'pdc_cheques',
  'fiscal_year_closes',
  'fixed_assets',
  'depreciation_entries',
  'amortization_schedules',
  'amortization_entries',

  // ── Tax & compliance ──────────────────────────────────────────────────
  'tax_filings',
  'tds_sections',
  'tds_deductions',
  'e_invoice_documents',

  // ── Payroll ───────────────────────────────────────────────────────────
  'employees',
  'employee_loans',
  'payroll_runs',
  'payroll_run_items',
  'leave_salary_payments',

  // ── Subscription & records ────────────────────────────────────────────
  'subscriptions',
  'subscription_payments',
  'subscription_history',
  'attachments',
  'audit_logs',
] as const;

/**
 * The backed-up tables that have NO `company_id` column — they are scoped
 * through a parent row instead (a line item through its document, a company
 * through its own id).
 *
 * The export relies on RLS for tenant scoping either way. For the tables that
 * DO carry `company_id` it also adds an explicit `.eq('company_id', ...)` as
 * defence in depth, so a future RLS mistake degrades to "empty backup" rather
 * than "someone else's books". These are the ones that filter cannot be
 * applied to, listed rather than discovered so the adapter does not have to
 * probe the schema at runtime.
 */
export const BACKUP_UNSCOPED: ReadonlySet<string> = new Set([
  'companies',
  'user_permission_overrides',
  'tax_profiles',
  'product_price_levels',
  'product_compatibility',
  'sales_quote_items',
  'sales_order_items',
  'invoice_items',
  'credit_note_items',
  'sales_return_items',
  'purchase_order_items',
  'goods_receipt_items',
  'vendor_bill_items',
  'debit_note_items',
  'purchase_return_items',
  'expense_items',
  'stock_transfer_items',
  'inventory_adjustment_items',
]);

/**
 * Deliberately excluded, each with the reason. Kept as data rather than prose
 * so the regression test can assert that every live table is either backed up
 * or listed here — "we forgot it" and "we decided against it" must not look
 * the same.
 */
export const BACKUP_EXCLUSIONS: Readonly<Record<string, string>> = {
  // Platform-owned, not the tenant's data.
  platform_admins:         'platform staff list, not tenant data',
  subscription_plans:      'the price list is ours, identical for every tenant',
  payment_provider_configs:'our PayPal credentials, not the tenant\'s',
  api_rate_buckets:        'transient rate-limiter state, meaningless once exported',
  webhook_logs:            'delivery diagnostics, not business records',

  // Shared reference data that belongs to no tenant.
  vehicle_generations:     'shared vehicle catalogue, not tenant-owned',
  vehicle_models:          'shared vehicle catalogue, not tenant-owned',
  vehicle_variants:        'shared vehicle catalogue, not tenant-owned',

  // Secrets hygiene: the row holds a SHA-256 of a key the user can never see
  // again anyway. Exporting hashes gives the owner nothing and puts credential
  // material in a file that will be emailed around.
  api_keys:                'contains key hashes; useless to restore, unwise to circulate',

  // A request log, not a business record; can dwarf the real data.
  api_request_log:         'API access log, not business data',
} as const;
