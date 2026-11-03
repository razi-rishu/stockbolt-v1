import { describe, expect, it } from 'vitest';
import {
  ACTIVITY_COUNT, BUSINESS_ACTIVITIES, COUNTRY_PACKS, INDUSTRY_FAMILIES, MODULES, MODULE_KEYS, WIZARD_STEPS,
  TAXONOMY_VERSION, activitiesOf, buildConfiguration, dependencyClosure, effectiveConfiguration, getCountryPack, legacyConfiguration, toStoredConfiguration,
  recommendModules, resolveModules, validateActivities,
} from './index';

const keysOf = (recs: { module: string }[]) => recs.map((r) => r.module);

describe('industry taxonomy', () => {
  it('has exactly the 18 approved families, in the approved order', () => {
    expect(INDUSTRY_FAMILIES.map((f) => f.name)).toEqual([
      'Trading & Commerce', 'Automotive', 'Manufacturing', 'Construction', 'Professional Services',
      'Technology & IT', 'Food & Hospitality', 'Healthcare', 'Education', 'Real Estate',
      'Logistics & Transport', 'Events & Entertainment', 'Agriculture', 'Energy & Utilities',
      'Finance & Insurance', 'Nonprofit & Community', 'Government & Public Sector', 'Other Industries',
    ]);
    expect(INDUSTRY_FAMILIES.map((f) => f.order)).toEqual([...Array(18)].map((_, i) => i + 1));
  });

  it('every family has at least one activity, with an Arabic name', () => {
    for (const f of INDUSTRY_FAMILIES) {
      expect(activitiesOf(f.key).length, f.key).toBeGreaterThan(0);
      expect(f.name_ar.length).toBeGreaterThan(0);
    }
    for (const a of BUSINESS_ACTIVITIES) expect(a.name_ar.length, a.key).toBeGreaterThan(0);
  });

  it('activity keys are unique snake_case, and only recommend registered non-essential modules', () => {
    const keys = BUSINESS_ACTIVITIES.map((a) => a.key);
    expect(new Set(keys).size).toBe(keys.length);
    for (const a of BUSINESS_ACTIVITIES) {
      expect(a.key).toMatch(/^[a-z][a-z0-9_]*$/);
      for (const m of a.recommends) {
        expect(MODULE_KEYS, `${a.key} -> ${m}`).toContain(m);
        expect(MODULES.find((x) => x.key === m)!.essential, `${a.key} lists essential ${m}`).toBe(false);
      }
    }
    expect(ACTIVITY_COUNT).toBe(BUSINESS_ACTIVITIES.length);
  });
});

describe('module registry', () => {
  it('dependencies point at registered modules and contain no cycle', () => {
    for (const m of MODULES) {
      for (const d of m.depends_on) expect(MODULE_KEYS).toContain(d);
      expect(dependencyClosure(m.key)).not.toContain(m.key);
    }
  });

  it('the ledger, contacts and banking are essential and depend only on each other', () => {
    expect(MODULES.filter((m) => m.essential).map((m) => m.key).sort()).toEqual(['accounting', 'banking', 'contacts']);
    for (const m of MODULES.filter((x) => x.essential)) for (const d of dependencyClosure(m.key)) expect(['accounting', 'banking', 'contacts']).toContain(d);
  });

  it('only the Projects module maps to an existing per-company switch', () => {
    expect(MODULES.filter((m) => m.legacy_flag).map((m) => [m.key, m.legacy_flag])).toEqual([['projects', 'projects_enabled']]);
  });
});

describe('country packs', () => {
  it('covers the 7 countries the database accepts today, and only those can be activated', () => {
    expect(COUNTRY_PACKS.map((p) => p.code).sort()).toEqual(['AE', 'BH', 'IN', 'KW', 'OM', 'QA', 'SA']);
    expect(COUNTRY_PACKS.every((p) => p.activation_supported)).toBe(true);
  });

  it('claims statutory compliance only for AE and IN', () => {
    expect(COUNTRY_PACKS.filter((p) => p.compliance === 'statutory').map((p) => p.code).sort()).toEqual(['AE', 'IN']);
    expect(getCountryPack('AE').features.e_invoicing).toBe('partial'); // no live ASP yet
    expect(getCountryPack('IN').features.tds).toBe('supported');
  });

  it('any other country is generic: user-defined tax, no claims, not activatable yet', () => {
    const fr = getCountryPack('fr');
    expect(fr).toMatchObject({ code: 'FR', compliance: 'generic', tax_system: 'user_defined', activation_supported: false, features: {} });
    expect(() => getCountryPack('France')).toThrow(/alpha-2/);
  });

  it('India starts its financial year in April, everyone else in January', () => {
    expect(getCountryPack('IN').fiscal_year_start_month).toBe(4);
    for (const c of ['AE', 'SA', 'KW', 'BH', 'OM', 'QA']) expect(getCountryPack(c).fiscal_year_start_month).toBe(1);
  });

  it('rates that differ from what onboarding seeds today are flagged for review, not used', () => {
    for (const c of ['SA', 'BH', 'OM', 'KW', 'QA']) expect(getCountryPack(c).rate_status).toBe('needs_review');
  });
});

describe('activity validation (wizard step 2)', () => {
  it('accepts several activities across families', () => {
    expect(validateActivities({ activity_keys: ['retail_store', 'vehicle_workshop', 'consulting'], primary_activity_key: 'retail_store' })).toEqual([]);
  });
  it.each([
    [{ activity_keys: [] }, 'no_activities'],
    [{ activity_keys: ['made_up'] }, 'unknown_activity'],
    [{ activity_keys: ['retail_store', 'retail_store'] }, 'duplicate_activity'],
    [{ activity_keys: ['retail_store'], primary_activity_key: 'pharmacy' }, 'primary_not_selected'],
    [{ activity_keys: BUSINESS_ACTIVITIES.slice(0, 11).map((a) => a.key) }, 'too_many_activities'],
  ])('rejects %j with %s', (sel, code) => {
    expect(validateActivities(sel).map((i) => i.code)).toContain(code);
  });
});

describe('module recommendations', () => {
  it('always includes the essential modules, even with no activity', () => {
    expect(keysOf(recommendModules([], 'AE'))).toEqual(expect.arrayContaining(['accounting', 'contacts', 'banking']));
  });

  it('a retail store gets POS and everything POS needs, with reasons', () => {
    const recs = recommendModules(['retail_store'], 'AE');
    const pos = recs.find((r) => r.module === 'pos')!;
    expect(pos.reasons).toEqual(['retail_store']);
    expect(keysOf(recs)).toEqual(expect.arrayContaining(['sales', 'inventory', 'items', 'banking']));
    expect(recs.find((r) => r.module === 'tax_returns')!.reasons).toEqual(['country:AE']);
  });

  it('a consultancy gets projects but no inventory or POS', () => {
    const k = keysOf(recommendModules(['consulting'], 'AE'));
    expect(k).toContain('projects');
    expect(k).not.toContain('inventory');
    expect(k).not.toContain('pos');
  });

  it('combines activities from different families', () => {
    const k = keysOf(recommendModules(['automotive_parts_trading', 'software_development'], 'AE'));
    expect(k).toEqual(expect.arrayContaining(['automotive_catalog', 'pos', 'projects', 'amortization']));
  });

  it('recommends TDS only in India, and only with purchasing', () => {
    expect(keysOf(recommendModules(['wholesale_trading'], 'IN'))).toContain('tds');
    expect(keysOf(recommendModules(['wholesale_trading'], 'AE'))).not.toContain('tds');
    expect(keysOf(recommendModules(['accounting_legal'], 'IN'))).not.toContain('tds');
  });

  it('no tax returns where the country levies no VAT', () => {
    expect(keysOf(recommendModules(['retail_store'], 'KW'))).not.toContain('tax_returns');
  });
});

describe('user customization (wizard step 5)', () => {
  const base = keysOf(recommendModules(['consulting'], 'AE')) as ReturnType<typeof keysOf> as never[];

  it('enabling a module brings its dependencies', () => {
    const r = resolveModules(base, { enable: ['pos'] }, 'AE');
    expect(r.enabled).toEqual(expect.arrayContaining(['pos', 'inventory', 'sales']));
    expect(r.added_dependencies).toContain('inventory');
    expect(r.rejected).toEqual([]);
  });

  it('essential modules cannot be switched off', () => {
    const r = resolveModules(base, { disable: ['accounting', 'banking'] }, 'AE');
    expect(r.enabled).toEqual(expect.arrayContaining(['accounting', 'banking']));
    expect(r.rejected.map((i) => [i.code, i.subject])).toEqual([['essential_module', 'accounting'], ['essential_module', 'banking']]);
  });

  it('a module another enabled module needs stays on, and says why', () => {
    const r = resolveModules(base, { disable: ['sales'] }, 'AE');
    expect(r.enabled).toContain('sales');
    expect(r.rejected).toContainEqual({ code: 'required_by', subject: 'sales', detail: 'projects' });
  });

  it('switching off the dependent first lets the dependency go too', () => {
    const r = resolveModules(base, { disable: ['projects', 'sales'] }, 'AE');
    expect(r.enabled).not.toContain('projects');
    expect(r.enabled).not.toContain('sales');
    expect(r.rejected).toEqual([]);
  });

  it('country-only modules are refused elsewhere, and unknown modules are reported', () => {
    const r = resolveModules(base, { enable: ['tds', 'teleport'] }, 'AE');
    expect(r.enabled).not.toContain('tds');
    expect(r.rejected.map((i) => i.code)).toEqual(['not_available_in_country', 'unknown_module']);
  });
});

describe('buildConfiguration (wizard step 7)', () => {
  it('a mixed AE business: single legal entity, families, modules, valid', () => {
    const c = buildConfiguration({ country_code: 'AE', activities: { activity_keys: ['restaurant', 'catering'], primary_activity_key: 'restaurant' }, modules: { enable: ['payroll'] } });
    expect(c.legal_entity_mode).toBe('single');
    expect(c.families).toEqual(['food_hospitality']);
    expect(c.modules).toEqual(expect.arrayContaining(['pos', 'projects', 'payroll', 'tax_returns']));
    expect(c.country).toMatchObject({ code: 'AE', currency: 'AED', compliance: 'statutory' });
    expect(c.valid).toBe(true);
  });

  it('a refused essential switch-off is a warning, not a blocker', () => {
    const c = buildConfiguration({ country_code: 'IN', activities: { activity_keys: ['pharmacy'] }, modules: { disable: ['accounting'] } });
    expect(c.valid).toBe(true);
    expect(c.issues.map((i) => i.code)).toEqual(['essential_module']);
    expect(c.primary_activity_key).toBe('pharmacy');
  });

  it('an unsupported country builds a preview but cannot be activated', () => {
    const c = buildConfiguration({ country_code: 'GB', activities: { activity_keys: ['consulting'] } });
    expect(c.valid).toBe(false);
    expect(c.issues.map((i) => i.code)).toContain('country_not_activatable');
    expect(c.country.compliance).toBe('generic');
  });

  it('bad activities make it invalid without throwing', () => {
    expect(buildConfiguration({ country_code: 'AE', activities: { activity_keys: [] } }).valid).toBe(false);
    expect(buildConfiguration({ country_code: 'AE', activities: { activity_keys: ['nope'] } }).valid).toBe(false);
  });
});

describe('existing companies are preserved', () => {
  it('keeps every module they can open today; Projects follows its switch', () => {
    const off = legacyConfiguration({ country_code: 'AE', projects_enabled: false });
    const on = legacyConfiguration({ country_code: 'AE', projects_enabled: true });
    expect(off.modules).toEqual(MODULE_KEYS.filter((k) => k !== 'projects'));
    expect(on.modules).toEqual([...MODULE_KEYS]);
    expect(off.activity_keys).toEqual(['automotive_parts_trading']);
    expect(off.valid).toBe(true);
  });

  it('applies to every country an existing company can have', () => {
    for (const p of COUNTRY_PACKS) expect(legacyConfiguration({ country_code: p.code, projects_enabled: true }).modules).toHaveLength(MODULE_KEYS.length);
  });
});

it('the seven approved wizard steps, in order', () => {
  expect(WIZARD_STEPS.map((s) => s.key)).toEqual([
    'organization_identity', 'business_activities', 'accounting_setup', 'taxation_compliance',
    'module_configuration', 'branches_team', 'review_activation',
  ]);
});

describe('stored configuration (draft global01)', () => {
  it('no stored row = legacy: an existing company keeps everything', () => {
    const c = effectiveConfiguration(null, { country_code: 'AE', projects_enabled: true });
    expect(c.modules).toEqual([...MODULE_KEYS]);
    expect(c.activity_keys).toEqual(['automotive_parts_trading']);
  });

  it('save then read back gives the same modules and activities', () => {
    const built = buildConfiguration({ country_code: 'AE', activities: { activity_keys: ['consulting', 'retail_store'], primary_activity_key: 'consulting' }, modules: { disable: ['expenses'], enable: ['payroll'] } });
    const stored = toStoredConfiguration(built);
    expect(stored.taxonomy_version).toBe(TAXONOMY_VERSION);
    const back = effectiveConfiguration(stored, { country_code: 'AE' });
    expect(back.modules).toEqual(built.modules);
    expect(back.activity_keys).toEqual(['consulting', 'retail_store']);
    expect(back.primary_activity_key).toBe('consulting');
    expect(back.modules).not.toContain('expenses');
  });

  it('a stored row missing an essential module still runs with it', () => {
    const back = effectiveConfiguration({ taxonomy_version: TAXONOMY_VERSION, activity_keys: ['consulting'], primary_activity_key: 'consulting', enabled_modules: ['sales'] }, { country_code: 'AE' });
    expect(back.modules).toEqual(expect.arrayContaining(['accounting', 'contacts', 'banking', 'sales']));
  });

  it('refuses to save an invalid configuration', () => {
    expect(() => toStoredConfiguration(buildConfiguration({ country_code: 'GB', activities: { activity_keys: ['consulting'] } }))).toThrow(/country_not_activatable/);
  });
});
