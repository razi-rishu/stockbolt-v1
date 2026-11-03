/**
 * Global v1 — Country, Industry & Module Configuration Engine.
 *
 * Pure functions, no I/O: the wizard, settings and a future server-side
 * activation function can all call them, and they can't change a tenant by
 * themselves. Architecture decisions applied:
 * - one legal entity per workspace (legal_entity_mode is always 'single');
 * - several activities, across families, drive module recommendations;
 * - users can switch modules on or off, except essential modules and modules
 *   another enabled module depends on;
 * - tax compliance is country-aware and never claimed for unsupported packs;
 * - existing companies keep exactly what they have (legacyConfiguration).
 */
import { BUSINESS_ACTIVITIES, getActivity, type IndustryFamilyKey } from './industry-taxonomy';
import { MODULES, MODULE_KEYS, dependencyClosure, getModule, isModuleKey, type ModuleKey } from './module-registry';
import { countryAllowsModule, getCountryPack, type CountryPack } from './country-packs';

export const MAX_ACTIVITIES = 10;

export type ConfigIssueCode =
  | 'no_activities' | 'too_many_activities' | 'unknown_activity' | 'duplicate_activity'
  | 'primary_not_selected' | 'unknown_module' | 'essential_module' | 'required_by'
  | 'not_available_in_country' | 'country_not_activatable';

export interface ConfigIssue { code: ConfigIssueCode; subject: string; detail?: string }

export interface ActivitySelection { activity_keys: string[]; primary_activity_key?: string }

/** Problems with an activity selection (wizard step 2). Empty = valid. */
export function validateActivities(sel: ActivitySelection): ConfigIssue[] {
  const issues: ConfigIssue[] = [];
  if (sel.activity_keys.length === 0) issues.push({ code: 'no_activities', subject: 'activity_keys' });
  if (sel.activity_keys.length > MAX_ACTIVITIES) issues.push({ code: 'too_many_activities', subject: 'activity_keys', detail: String(MAX_ACTIVITIES) });
  const seen = new Set<string>();
  for (const k of sel.activity_keys) {
    if (!getActivity(k)) issues.push({ code: 'unknown_activity', subject: k });
    if (seen.has(k)) issues.push({ code: 'duplicate_activity', subject: k });
    seen.add(k);
  }
  if (sel.primary_activity_key && !sel.activity_keys.includes(sel.primary_activity_key)) {
    issues.push({ code: 'primary_not_selected', subject: sel.primary_activity_key });
  }
  return issues;
}

export interface Recommendation { module: ModuleKey; essential: boolean; reasons: string[] }

/**
 * Modules recommended for these activities in this country: essential modules,
 * each activity's modules and everything they depend on. `reasons` lists the
 * activity keys (or 'essential', 'dependency:<module>', 'country:<code>').
 */
export function recommendModules(activity_keys: string[], country_code: string): Recommendation[] {
  const pack = getCountryPack(country_code);
  const reasons = new Map<ModuleKey, Set<string>>();
  const add = (m: ModuleKey, why: string) => {
    if (!countryAllowsModule(pack, m, getModule(m).countries)) return;
    if (!reasons.has(m)) reasons.set(m, new Set());
    reasons.get(m)!.add(why);
  };
  for (const m of MODULES) if (m.essential) add(m.key, 'essential');
  for (const k of activity_keys) {
    for (const m of getActivity(k)?.recommends ?? []) {
      add(m, k);
      for (const d of dependencyClosure(m)) add(d, `dependency:${m}`);
    }
  }
  // Country pack: tax returns where the country levies VAT/GST, TDS for India purchasing.
  if (pack.features.tax_returns && pack.tax_system !== 'none') add('tax_returns', `country:${pack.code}`);
  if (pack.features.tds === 'supported' && reasons.has('purchasing')) add('tds', `country:${pack.code}`);
  return MODULE_KEYS.filter((k) => reasons.has(k)).map((k) => ({ module: k, essential: getModule(k).essential, reasons: [...reasons.get(k)!] }));
}

export interface ModuleChoices { enable?: string[]; disable?: string[] }
export interface ResolvedModules {
  enabled: ModuleKey[];
  /** Modules switched on because an enabled module needs them. */
  added_dependencies: ModuleKey[];
  /** User choices that were refused, with the reason. */
  rejected: ConfigIssue[];
}

/**
 * Apply the user's on/off choices to a recommendation (wizard step 5 and
 * Settings). Enabling a module brings its dependencies; disabling is refused
 * for essential modules and for modules an enabled module still needs.
 */
export function resolveModules(recommended: ModuleKey[], choices: ModuleChoices, country_code: string): ResolvedModules {
  const pack = getCountryPack(country_code);
  const rejected: ConfigIssue[] = [];
  const on = new Set<ModuleKey>(recommended);
  for (const m of MODULES) if (m.essential) on.add(m.key);
  const before = new Set(on);

  for (const raw of choices.enable ?? []) {
    if (!isModuleKey(raw)) { rejected.push({ code: 'unknown_module', subject: raw }); continue; }
    if (!countryAllowsModule(pack, raw, getModule(raw).countries)) { rejected.push({ code: 'not_available_in_country', subject: raw, detail: pack.code }); continue; }
    on.add(raw);
  }
  for (const k of [...on]) for (const d of dependencyClosure(k)) on.add(d);
  const userEnabled = new Set(on);

  for (const raw of choices.disable ?? []) {
    if (!isModuleKey(raw)) { rejected.push({ code: 'unknown_module', subject: raw }); continue; }
    if (getModule(raw).essential) { rejected.push({ code: 'essential_module', subject: raw }); continue; }
    on.delete(raw);
  }
  // A disabled module that an enabled one still needs stays on: report it.
  let changed = true;
  while (changed) {
    changed = false;
    for (const k of [...on]) for (const d of getModule(k).depends_on) {
      if (!on.has(d)) {
        on.add(d); changed = true;
        rejected.push({ code: 'required_by', subject: d, detail: k });
      }
    }
  }
  const enabled = MODULE_KEYS.filter((k) => on.has(k));
  const added_dependencies = enabled.filter((k) => !before.has(k) && userEnabled.has(k) && !(choices.enable ?? []).includes(k));
  return { enabled, added_dependencies, rejected };
}

export interface ConfigurationInput {
  country_code: string;
  activities: ActivitySelection;
  modules?: ModuleChoices;
}

export interface GlobalConfiguration {
  legal_entity_mode: 'single';
  country: Pick<CountryPack, 'code' | 'currency' | 'compliance' | 'tax_system' | 'fiscal_year_start_month' | 'activation_supported'>;
  activity_keys: string[];
  primary_activity_key: string;
  families: IndustryFamilyKey[];
  modules: ModuleKey[];
  recommendations: Recommendation[];
  issues: ConfigIssue[];
  /** True when the configuration can be activated as it stands. */
  valid: boolean;
}

/** The full configuration for a new organization. Never throws on user input. */
export function buildConfiguration(input: ConfigurationInput): GlobalConfiguration {
  const pack = getCountryPack(input.country_code);
  const keys = input.activities.activity_keys;
  const issues = validateActivities(input.activities);
  if (!pack.activation_supported) issues.push({ code: 'country_not_activatable', subject: pack.code });
  const known = keys.filter((k) => getActivity(k));
  const recommendations = recommendModules(known, pack.code);
  const resolved = resolveModules(recommendations.map((r) => r.module), input.modules ?? {}, pack.code);
  issues.push(...resolved.rejected);
  const families = [...new Set(known.map((k) => getActivity(k)!.family))];
  const hardErrors = issues.filter((i) => i.code !== 'required_by' && i.code !== 'essential_module');
  return {
    legal_entity_mode: 'single',
    country: { code: pack.code, currency: pack.currency, compliance: pack.compliance, tax_system: pack.tax_system,
      fiscal_year_start_month: pack.fiscal_year_start_month, activation_supported: pack.activation_supported },
    activity_keys: keys,
    primary_activity_key: input.activities.primary_activity_key ?? keys[0] ?? '',
    families,
    modules: resolved.enabled,
    recommendations,
    issues,
    valid: hardErrors.length === 0,
  };
}

/**
 * An existing StockBolt company, expressed in Global terms with NOTHING
 * changed. Every module it can open today stays on: today's navigation shows
 * all of them to every company (TDS and e-invoicing included; those screens
 * check the country themselves), and only Projects has a switch
 * (companies.projects_enabled). Its activity is automotive parts trading,
 * which every company before Global v1 was set up as.
 */
export function legacyConfiguration(company: { country_code: string; projects_enabled?: boolean | null }): GlobalConfiguration {
  const pack = getCountryPack(company.country_code);
  const modules = MODULE_KEYS.filter((k) =>
    getModule(k).legacy_flag === 'projects_enabled' ? Boolean(company.projects_enabled) : true);
  return {
    legal_entity_mode: 'single',
    country: { code: pack.code, currency: pack.currency, compliance: pack.compliance, tax_system: pack.tax_system,
      fiscal_year_start_month: pack.fiscal_year_start_month, activation_supported: pack.activation_supported },
    activity_keys: ['automotive_parts_trading'],
    primary_activity_key: 'automotive_parts_trading',
    families: ['automotive'],
    modules,
    recommendations: [],
    issues: [],
    valid: true,
  };
}

/** The approved seven-step wizard, and which engine function validates each step. */
export const WIZARD_STEPS = [
  { step: 1, key: 'organization_identity', engine: 'getCountryPack' },
  { step: 2, key: 'business_activities', engine: 'validateActivities' },
  { step: 3, key: 'accounting_setup', engine: null },
  { step: 4, key: 'taxation_compliance', engine: 'getCountryPack' },
  { step: 5, key: 'module_configuration', engine: 'resolveModules' },
  { step: 6, key: 'branches_team', engine: null },
  { step: 7, key: 'review_activation', engine: 'buildConfiguration' },
] as const;

export const ACTIVITY_COUNT = BUSINESS_ACTIVITIES.length;

/** Recorded with every saved configuration, so a later taxonomy change can be detected. */
export const TAXONOMY_VERSION = 'global-v1.0';

/** The stored shape (company_configurations) the engine reads and writes. */
export interface StoredConfiguration {
  taxonomy_version: string;
  activity_keys: string[];
  primary_activity_key: string;
  enabled_modules: string[];
}

/**
 * The configuration a company runs with. No stored row means the company was
 * set up before Global v1: it gets legacyConfiguration(), which changes
 * nothing for it. A stored row is rebuilt through the engine, so unknown keys
 * from an older taxonomy are reported instead of trusted.
 */
export function effectiveConfiguration(
  stored: StoredConfiguration | null,
  company: { country_code: string; projects_enabled?: boolean | null },
): GlobalConfiguration {
  if (!stored) return legacyConfiguration(company);
  const enable = stored.enabled_modules;
  const disable = MODULE_KEYS.filter((k) => !enable.includes(k));
  const config = buildConfiguration({
    country_code: company.country_code,
    activities: { activity_keys: stored.activity_keys, primary_activity_key: stored.primary_activity_key },
    modules: { enable, disable },
  });
  // What was saved is what runs: drop recommendations the user had switched off.
  return { ...config, modules: config.modules.filter((m) => enable.includes(m) || getModule(m).essential) };
}

/** The payload for save_company_configuration. Throws if the configuration isn't activatable. */
export function toStoredConfiguration(config: GlobalConfiguration): StoredConfiguration {
  if (!config.valid) throw new Error(`Configuration is not valid: ${config.issues.map((i) => i.code).join(', ')}`);
  return {
    taxonomy_version: TAXONOMY_VERSION,
    activity_keys: config.activity_keys,
    primary_activity_key: config.primary_activity_key,
    enabled_modules: config.modules,
  };
}
