import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { SETTINGS_SECTIONS, visibleSettingsSections } from '@/modules/settings/_nav';
import { ALL_ON, INVENTORY_SWITCHES, inventoryLinkVisible, inventorySettingsFrom } from './inventory-settings';

const paths = (s = ALL_ON) => visibleSettingsSections(undefined, s).flatMap((x) => x.items.map((i) => i.to));
const MENU = ['/products', '/products/categories', '/products/brands', '/inventory/transfers', '/inventory/adjustments', '/inventory/stock-ledger', '/reports/reorder'];

describe('inventory settings (phase153)', () => {
  it('a company without a saved row sees everything, exactly as before', () => {
    for (const none of [null, undefined, {}]) expect(inventorySettingsFrom(none)).toEqual(ALL_ON);
    for (const link of MENU) expect(inventoryLinkVisible(link, ALL_ON), link).toBe(true);
    expect(paths()).toEqual(visibleSettingsSections().flatMap((x) => x.items.map((i) => i.to)));
    expect(SETTINGS_SECTIONS.flatMap((x) => x.items).some((i) => i.to === '/settings/inventory')).toBe(true);
  });

  it('only an explicit false switches a feature off', () => {
    const odd = { transfers_enabled: null, reorder_enabled: undefined, barcodes_enabled: 'no', shelf_enabled: false };
    expect(inventorySettingsFrom(odd as never)).toEqual({ ...ALL_ON, shelf_enabled: false });
  });

  it('each switch hides its own links and nothing else', () => {
    const hidden = (k: (typeof INVENTORY_SWITCHES)[number]) => MENU.filter((l) => !inventoryLinkVisible(l, { ...ALL_ON, [k]: false }));
    expect(hidden('transfers_enabled')).toEqual(['/inventory/transfers']);
    expect(hidden('reorder_enabled')).toEqual(['/reports/reorder']);
    expect(hidden('brands_enabled')).toEqual(['/products/categories', '/products/brands']);
    expect(hidden('barcodes_enabled')).toEqual([]);
    expect(hidden('shelf_enabled')).toEqual([]);
    const noBrands = paths({ ...ALL_ON, brands_enabled: false });
    expect(noBrands).not.toContain('/settings/brands');
    expect(noBrands).toContain('/settings/inventory');
  });
});

describe('phase153 migration stays additive', () => {
  const sql = readFileSync('supabase/migrations/20261124000001_phase153_inventory_settings.sql', 'utf8').replace(/--[^\n]*/g, '');
  it('creates no row for existing companies and touches no other table', () => {
    expect(sql).not.toMatch(/\bUPDATE\s+public\./i);
    expect(sql).not.toMatch(/\bDELETE\s+FROM\b|\bDROP\s+TABLE\b|\bALTER\s+TABLE\s+public\.(?!inventory_settings)/i);
    expect(sql).not.toMatch(/INSERT\s+INTO\s+public\.inventory_settings[\s\S]*?SELECT[\s\S]*?FROM\s+public\.companies/i);
  });
  it('has RLS, no anon access and a trigger that cannot stop a sign-up', () => {
    expect(sql).toMatch(/ALTER TABLE public\.inventory_settings ENABLE ROW LEVEL SECURITY/);
    expect(sql).toMatch(/REVOKE ALL ON public\.inventory_settings FROM PUBLIC, anon, authenticated/);
    expect(sql).not.toMatch(/GRANT[^;]*\bTO\b[^;]*anon/i);
    expect(sql).toMatch(/EXCEPTION WHEN OTHERS THEN\s+NULL/);
  });
});
