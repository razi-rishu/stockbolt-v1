/**
 * What the website advertises, tied to the app's own registries so the page
 * cannot drift from the product:
 *  - feature cards each name the module they describe (module-registry.ts);
 *  - industries come from INDUSTRY_FAMILIES / BUSINESS_ACTIVITIES
 *    (industry-taxonomy.ts) — no separate list is kept here.
 * Only shipped, switched-on capabilities are listed. Branch-restricted
 * access (off in production) and certified e-invoicing are deliberately
 * absent.
 */
import {
  FileText, ShoppingCart, Receipt, Boxes, Landmark, BarChart3, Users, HandCoins,
  FolderKanban, SlidersHorizontal, Store, Car, Briefcase, PartyPopper,
  UtensilsCrossed, HardHat, Cpu, Factory, Truck, type LucideIcon,
} from 'lucide-react';
import type { ModuleKey } from '@/core/global-config/module-registry';
import type { IndustryFamilyKey } from '@/core/global-config/industry-taxonomy';

export interface LandingFeature { key: string; icon: LucideIcon; module: ModuleKey | null }

/** i18n: landing.features.<key>_title / <key>_text */
export const FEATURES: LandingFeature[] = [
  { key: 'sales',      icon: FileText,          module: 'sales' },
  { key: 'purchasing', icon: ShoppingCart,      module: 'purchasing' },
  { key: 'expenses',   icon: Receipt,           module: 'expenses' },
  { key: 'inventory',  icon: Boxes,             module: 'inventory' },
  { key: 'banking',    icon: Landmark,          module: 'banking' },
  { key: 'accounting', icon: BarChart3,         module: 'accounting' },
  { key: 'contacts',   icon: Users,             module: 'contacts' },
  { key: 'payments',   icon: HandCoins,         module: null },   // part of sales + purchasing
  { key: 'projects',   icon: FolderKanban,      module: 'projects' },
  { key: 'config',     icon: SlidersHorizontal, module: null },   // the Global setup itself
];

/** Further shipped modules shown as chips, named from the module registry. */
export const ALSO_MODULES: ModuleKey[] = ['pos', 'payroll', 'fixed_assets', 'amortization', 'tax_returns', 'multi_currency'];

/** The nine industry groups featured on the page; the other nine are listed as chips. */
export const FEATURED_FAMILIES: { key: IndustryFamilyKey; icon: LucideIcon }[] = [
  { key: 'trading_commerce',      icon: Store },
  { key: 'automotive',            icon: Car },
  { key: 'professional_services', icon: Briefcase },
  { key: 'events_entertainment',  icon: PartyPopper },
  { key: 'food_hospitality',      icon: UtensilsCrossed },
  { key: 'construction',          icon: HardHat },
  { key: 'technology_it',         icon: Cpu },
  { key: 'manufacturing',         icon: Factory },
  { key: 'logistics_transport',   icon: Truck },
];

/** Real screenshots from a local demo company (public/landing). Sizes avoid layout shift. */
export const SHOTS = {
  dashboard:  { src: '/landing/app-dashboard.webp',           w: 1600, h: 922 },
  phone:      { src: '/landing/app-dashboard-phone.webp',     w: 520,  h: 1000 },
  invoices:   { src: '/landing/app-invoices.webp',            w: 1400, h: 700 },
  activities: { src: '/landing/app-business-activities.webp', w: 1100, h: 568 },
} as const;
