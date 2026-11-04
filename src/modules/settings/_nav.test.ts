import { describe, expect, it } from 'vitest';
import { MODULE_KEYS, legacyConfiguration, type ModuleKey } from '@/core/global-config';
import { SETTINGS_SECTIONS, visibleSettingsSections } from './_nav';

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
