/**
 * INFRA-1 — the shared tenant cleanup deletes only one synthetic company's rows,
 * in a dependency-safe order, and every mutating suite uses it.
 *
 * Static: reads repo files only.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { TENANT_DELETE_ORDER } from '../integration/_tenant-cleanup';

const ROOT = resolve(__dirname, '../..');
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8');
const helper = read('tests/integration/_tenant-cleanup.ts').replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, '');
const order = [...TENANT_DELETE_ORDER] as string[];
const pos = (t: string) => order.indexOf(t);

describe('TENANT_DELETE_ORDER', () => {
  it('lists 74 distinct company-scoped tables and never companies itself', () => {
    expect(order).toHaveLength(74);
    expect(new Set(order).size).toBe(order.length);
    expect(order).not.toContain('companies');
  });

  it('never touches global-only reference tables', () => {
    for (const t of ['subscription_plans', 'tax_profiles', 'payment_provider_configs', 'vehicle_models', 'vehicle_generations', 'vehicle_variants', 'platform_admins']) {
      expect(order, t).not.toContain(t);
    }
  });

  it('covers what onboarding, company triggers and the suites create', () => {
    for (const t of ['chart_of_accounts', 'units_of_measure', 'payment_methods', 'warehouses', 'tax_rates',
      'subscriptions', 'subscription_history', 'general_ledger', 'journal_entries', 'stock_ledger', 'audit_logs',
      'tax_filings', 'fixed_assets', 'depreciation_entries', 'amortization_schedules', 'amortization_entries',
      'tds_deductions', 'tds_sections', 'vendor_bills', 'contacts', 'fiscal_year_closes', 'deferred_cogs_queue',
      'bank_accounts', 'bank_reconciliations', 'products', 'profiles']) {
      expect(order, t).toContain(t);
    }
  });

  // Each pair: the first holds the second with ON DELETE RESTRICT, directly or through its items.
  it.each([
    ['tax_rates', 'chart_of_accounts'], ['general_ledger', 'journal_entries'], ['general_ledger', 'chart_of_accounts'],
    ['invoices', 'products'], ['vendor_bills', 'products'], ['vendor_bills', 'warehouses'], ['vendor_bills', 'chart_of_accounts'],
    ['credit_notes', 'invoices'], ['sales_returns', 'invoices'], ['debit_notes', 'vendor_bills'], ['purchase_returns', 'vendor_bills'],
    ['expenses', 'invoices'], ['expenses', 'contacts'], ['deferred_cogs_queue', 'invoices'], ['products', 'vehicle_makes'],
    ['stock_ledger', 'products'], ['goods_receipts', 'products'],
  ])('%s is deleted before %s', (child, parent) => {
    expect(pos(child)).toBeGreaterThanOrEqual(0);
    expect(pos(child)).toBeLessThan(pos(parent));
  });
});

describe('destroyTenant() can only delete one synthetic company', () => {
  it('checks the name prefix and age before any delete', () => {
    const guard = helper.indexOf('startsWith(t.namePrefix)');
    expect(guard).toBeGreaterThan(0);
    expect(guard).toBeLessThan(helper.indexOf('.delete()'));
    expect(helper).toMatch(/age > MAX_AGE_MS/);
  });

  it('every delete is filtered by that exact company id', () => {
    const deletes = [...helper.matchAll(/\.delete\(\)([^;]*);/g)].map((m) => m[1].trim());
    expect(deletes).toEqual([".eq('company_id', t.companyId)", ".eq('id', t.companyId)"]);
    expect(helper).not.toMatch(/\.(neq|in|is|like|ilike|gt|lt|or)\(/);
  });

  it('re-checks that nothing is left, and reports instead of swallowing', () => {
    expect(helper).toMatch(/still exists/);
    expect(helper).toMatch(/row\(s\) left/);
    expect(helper).not.toMatch(/\.catch\(\s*\(\)\s*=>/);
  });
});

describe('the nine mutating suites clean up through it', () => {
  const SUITES: Record<string, string> = {
    'phase0-rls.test.ts': "'Phase 0 Test Company '", 'phase1-verification.test.ts': "'Phase 1 Test Auto Parts'",
    'phase2-verification.test.ts': "'Phase 2 Test Auto'", 'tax-return-verification.test.ts': "'TAX Scratch '",
    'fixed-assets-verification.test.ts': "'FA Scratch '", 'amortization-verification.test.ts': "'AM Scratch '",
    'tds-verification.test.ts': "'TDS Scratch '", 'year-end-close-verification.test.ts': "'YEC Scratch '",
    'deferred-cogs-verification.test.ts': "'DC Scratch '",
  };
  for (const [file, prefix] of Object.entries(SUITES)) {
    const src = read(`tests/integration/${file}`).replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, '');
    it(`${file} uses the helper with its own name prefix`, () => {
      expect(src).toMatch(/from '\.\/_tenant-cleanup'/);
      expect(src).toContain(`namePrefix: ${prefix}`);
    });
    it(`${file} no longer deletes companies itself or ignores a failed user delete`, () => {
      expect(src).not.toMatch(/from\('companies'\)\s*\.delete\(\)/);
      expect(src).not.toMatch(/deleteUser\([^)]*\)\s*\.catch\(/);
    });
  }
});
