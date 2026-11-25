import { describe, expect, it } from 'vitest';
import { MODULE_KEYS, legacyConfiguration, type ModuleKey } from '@/core/global-config';
import { ALL_ON } from '@/lib/inventory-settings';
import { gearItems, gearModule } from '@/lib/module-settings';
import en from '@/i18n/en.json';
import ar from '@/i18n/ar.json';
import { sectionKey } from './_nav-ocean';
import { SETTINGS_SECTIONS, visibleSettingsSections, type SettingsAccess } from './_nav';

const paths = (enabled?: readonly ModuleKey[]) => visibleSettingsSections(enabled).flatMap((s) => s.items.map((i) => i.to));

describe('Settings navigation (Global v1)', () => {
  it('Business Configuration is hidden while the Global flag is off (the test and production default)', () => {
    expect(SETTINGS_SECTIONS.flatMap((s) => s.items).some((i) => i.to === '/settings/business-configuration')).toBe(true);
    expect(paths()).not.toContain('/settings/business-configuration');
  });

  it('a legacy company sees every Settings entry it has today', () => {
    const legacy = legacyConfiguration({ country_code: 'AE', projects_enabled: true }).modules;
    expect(legacy).toEqual([...MODULE_KEYS]);
    expect(paths(legacy)).toEqual(paths());
  });

  it('drops entries owned by a disabled module and keeps the rest', () => {
    const on = MODULE_KEYS.filter((k) => !['api_access', 'multi_currency', 'automotive_catalog'].includes(k));
    const p = paths(on);
    expect(p).not.toContain('/settings/developer');
    expect(p).not.toContain('/settings/exchange-rates');
    expect(p).not.toContain('/settings/vehicles');
    for (const keep of ['/settings/company', '/settings/users', '/settings/tax-rates', '/settings/system-health']) expect(p).toContain(keep);
  });

  it('never leaves an empty section behind', () => {
    const essentialsOnly: ModuleKey[] = ['accounting', 'contacts', 'banking'];
    for (const s of visibleSettingsSections(essentialsOnly)) expect(s.items.length).toBeGreaterThan(0);
  });
});

describe('Settings groups and rights', () => {
  const access = (perms: string[], over: Partial<SettingsAccess> = {}): SettingsAccess =>
    ({ can: (p) => perms.includes(p), isAdmin: false, hasPriceLevels: true, ...over });
  const seen = (a: SettingsAccess) => visibleSettingsSections(undefined, ALL_ON, a).flatMap((s) => s.items.map((i) => i.to));

  it('keeps every entry once, in six groups', () => {
    const all = SETTINGS_SECTIONS.flatMap((s) => s.items.map((i) => i.to));
    expect(SETTINGS_SECTIONS).toHaveLength(6);
    expect(all).toHaveLength(28);
    expect(new Set(all).size).toBe(28);
  });

  it('every group has its name in both languages', () => {
    for (const s of SETTINGS_SECTIONS) {
      expect(en.settingsNav.sections).toHaveProperty(sectionKey(s));
      expect(ar.settingsNav.sections).toHaveProperty(sectionKey(s));
    }
  });

  it('hides what the user may not open', () => {
    const accountant = seen(access(['settings.read', 'accounting.read']));
    for (const no of ['/settings/users', '/settings/approvals', '/settings/developer', '/settings/reset-data']) expect(accountant).not.toContain(no);
    for (const yes of ['/settings/company', '/settings/chart-of-accounts', '/settings/tax-rates']) expect(accountant).toContain(yes);
    expect(seen(access(['settings.read']))).not.toContain('/settings/period-lock');
  });

  it('an admin sees everything; Price Levels only once the company has some', () => {
    const admin = access([], { can: () => true, isAdmin: true });
    expect(seen(admin)).toEqual(visibleSettingsSections().flatMap((s) => s.items.map((i) => i.to)));
    expect(seen({ ...admin, hasPriceLevels: false })).not.toContain('/settings/price-levels');
  });
});

describe('Module gear', () => {
  it('knows the module of a list or report page', () => {
    expect(gearModule('/sales/invoices')).toBe('sales');
    expect(gearModule('/pos')).toBe('pos');
    expect(gearModule('/products')).toBe('inventory');
    expect(gearModule('/products/brands')).toBe('inventory');
    expect(gearModule('/reports/trial-balance/')).toBe('reports');
  });

  it('is not on records, forms or other pages', () => {
    for (const p of ['/sales/invoices/new', '/sales/invoices/abc', '/products/new', '/products/abc', '/settings/units', '/dashboard', '/']) {
      expect(gearModule(p)).toBeNull();
    }
  });

  it('lists real Settings pages, without the one on screen', () => {
    const known = new Set([...SETTINGS_SECTIONS.flatMap((s) => s.items.map((i) => i.to)), '/banking/bank-accounts']);
    for (const m of ['sales', 'pos', 'purchasing', 'inventory', 'accounting', 'banking', 'payroll', 'contacts', 'reports'] as const) {
      const items = gearItems(m, '/x');
      expect(items.length).toBeGreaterThan(0);
      for (const to of items) expect(known.has(to)).toBe(true);
    }
    expect(gearItems('banking', '/banking/bank-accounts')).not.toContain('/banking/bank-accounts');
    expect(gearItems('inventory', '/products/brands')).not.toContain('/settings/brands');
  });
});
