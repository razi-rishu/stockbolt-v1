import { describe, expect, it } from 'vitest';
import { MODULE_KEYS, legacyConfiguration, moduleForPath, navLinkEnabled, pathAccess, type ModuleKey } from './index';

const ID = '0b7c6f3e-1d2a-4c5b-9e8f-7a6b5c4d3e2f';
const only = (...keys: ModuleKey[]) => keys;

describe('moduleForPath', () => {
  it('maps a path to the module whose area is its longest prefix', () => {
    expect(moduleForPath('/products')?.module).toBe('items');
    expect(moduleForPath('/products/vehicles')?.module).toBe('automotive_catalog');
    expect(moduleForPath('/purchasing/expenses/new')?.module).toBe('expenses');
    expect(moduleForPath('/purchasing/bills/new')?.module).toBe('purchasing');
    expect(moduleForPath('/accounting/tds')?.module).toBe('tds');
  });

  it('does not claim a path that only shares a prefix string', () => {
    expect(moduleForPath('/productsfoo')).toBeNull();
    expect(moduleForPath('/pos-session')).toBeNull();
  });

  it('leaves dashboard, settings and unclaimed reports to no module', () => {
    for (const p of ['/', '/dashboard', '/settings/company', '/reports/ar-aging', '/reports/stock-valuation', '/reports/ap-aging'])
      expect(moduleForPath(p), p).toBeNull();
  });

  it('ignores trailing slashes, queries and fragments', () => {
    expect(moduleForPath('/pos/?x=1')?.module).toBe('pos');
    expect(moduleForPath('/projects#top')?.module).toBe('projects');
  });
});

describe('pathAccess', () => {
  it('always allows essential modules and unclaimed paths', () => {
    expect(pathAccess('/accounting/journal-entries', only())).toBe('allowed');
    expect(pathAccess('/banking/bank-accounts', only())).toBe('allowed');
    expect(pathAccess('/contacts/customers', only())).toBe('allowed');
    expect(pathAccess('/reports/trial-balance', only())).toBe('allowed');
    expect(pathAccess('/dashboard', only())).toBe('allowed');
  });

  it('blocks the lists and new screens of a disabled module', () => {
    expect(pathAccess('/pos', only('sales'))).toBe('module_disabled');
    expect(pathAccess('/sales/invoices', only('pos'))).toBe('module_disabled');
    expect(pathAccess('/sales/invoices/new', only())).toBe('module_disabled');
    expect(pathAccess('/payroll/runs', only())).toBe('module_disabled');
  });

  it('keeps an existing record of a disabled module readable', () => {
    expect(pathAccess(`/sales/invoices/${ID}`, only())).toBe('record_view');
    expect(pathAccess(`/purchasing/bills/${ID}`, only())).toBe('record_view');
    // but not its edit screen or a non-id segment
    expect(pathAccess(`/sales/invoices/${ID}/edit`, only())).toBe('module_disabled');
    expect(pathAccess('/sales/invoices/abc', only())).toBe('module_disabled');
  });

  it('allows everything an enabled module owns', () => {
    expect(pathAccess('/sales/invoices/new', only('sales'))).toBe('allowed');
    expect(pathAccess(`/sales/invoices/${ID}`, only('sales'))).toBe('allowed');
  });
});

describe('navLinkEnabled', () => {
  it('hides links into a disabled module, including record views', () => {
    expect(navLinkEnabled('/payroll/runs', only())).toBe(false);
    expect(navLinkEnabled('/reports/project-profitability', only('sales'))).toBe(false);
    expect(navLinkEnabled('/reports/project-profitability', only('projects'))).toBe(true);
  });

  it('a legacy company (no saved configuration) keeps every link it has today', () => {
    const legacy = legacyConfiguration({ country_code: 'AE', projects_enabled: true });
    expect(legacy.modules).toEqual([...MODULE_KEYS]);
    for (const p of ['/pos', '/payroll/runs', '/accounting/tds', '/projects', '/products/vehicles', '/settings/developer'])
      expect(navLinkEnabled(p, legacy.modules), p).toBe(true);
  });

  it('a legacy company without projects keeps projects hidden, as today', () => {
    const legacy = legacyConfiguration({ country_code: 'AE', projects_enabled: false });
    expect(navLinkEnabled('/projects', legacy.modules)).toBe(false);
    expect(navLinkEnabled('/sales/invoices', legacy.modules)).toBe(true);
  });
});
