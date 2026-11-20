/**
 * Control Center metric registry (phase142).
 *
 * Every number on the Control Center has ONE entry here: a translated label,
 * a translated plain-language definition, and its data source (tables /
 * functions, shown as-is). docs/Admin_Control_Center_Metrics.md mirrors this
 * list. A metric without a reliable source is not shown — it is listed as
 * "unavailable" in that document instead of being estimated.
 */
export interface MetricDef {
  label: string;        // i18n key
  definition: string;   // i18n key
  source: string;       // tables / function, not translated
}

export const METRICS = {
  signups:            { label: 'adminCC.m.signups',            definition: 'adminCC.d.signups',            source: 'auth.users (created_at; deleted and anonymous accounts excluded) via admin_overview_range' },
  active_people:      { label: 'adminCC.m.active_people',      definition: 'adminCC.d.active_people',      source: 'greatest(auth.users.last_sign_in_at, profiles.last_login_at)' },
  stuck:              { label: 'adminCC.m.stuck',              definition: 'adminCC.d.stuck',              source: 'auth.users without a profiles row / company_id' },
  companies:          { label: 'adminCC.m.companies',          definition: 'adminCC.d.companies',          source: 'companies.created_at' },
  active_companies:   { label: 'adminCC.m.active_companies',   definition: 'adminCC.d.active_companies',   source: 'max(journal_entries.created_at) per company' },
  paying:             { label: 'adminCC.m.paying',             definition: 'adminCC.d.paying',             source: "subscriptions (status 'active', provider razorpay/paypal) + payment_provider_configs.is_active" },
  funnel:             { label: 'adminCC.m.funnel',             definition: 'adminCC.d.funnel',             source: 'auth.users, profiles, company_configurations, subscriptions (each step ⊂ previous)' },
  business_types:     { label: 'adminCC.m.business_types',     definition: 'adminCC.d.business_types',     source: 'company_configurations.primary_activity_key' },
  plans:              { label: 'adminCC.m.plans',              definition: 'adminCC.d.plans',              source: 'subscriptions.status / provider / grandfathered' },
  owner:              { label: 'adminCC.m.owner',              definition: 'adminCC.d.owner',              source: "earliest profiles row with role 'admin' for the company" },
  last_activity:      { label: 'adminCC.m.last_activity',      definition: 'adminCC.d.last_activity',      source: 'max(journal_entries.created_at)' },
  storage:            { label: 'adminCC.m.storage',            definition: 'adminCC.d.storage',            source: 'storage.objects under {bucket}/{company_id}/ (unavailable where the storage schema is absent)' },
} as const satisfies Record<string, MetricDef>;

export type MetricKey = keyof typeof METRICS;
