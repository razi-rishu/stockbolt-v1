/**
 * Ocean Teal (UI v1.1) helpers for the Settings hub and rail: an outline
 * icon and translated title / description for every entry in ./_nav.
 *
 * Keys are derived from the existing spec (route slug, section title), so
 * _nav.ts stays the single source of truth for which entries exist, their
 * routes and their visibility rules. The English text in _nav.ts remains the
 * fallback when a key is missing.
 */
import type { ReactNode } from 'react';
import type { TFunction } from 'i18next';
import {
  Building2, CreditCard, Warehouse, Compass, Ruler, FolderTree, Tag, Car, Coins, UserRound, Percent,
  ArrowLeftRight, Hash, BookOpen, Lock, ArrowDownToLine, FileUp, Printer, ScanBarcode, Users, Plug,
  ShieldCheck, Wrench, ClipboardList, Eraser, Settings,
} from 'lucide-react';
import type { SettingsNavItem, SettingsNavSection } from './_nav';

/** '/settings/price-levels' → 'price_levels' */
export const itemKey = (it: SettingsNavItem) => it.to.split('/').pop()!.replace(/-/g, '_');
/** 'Sales, Customers & Tax' → 'sales_customers_tax' */
export const sectionKey = (s: SettingsNavSection) => s.title.toLowerCase().replace(/[^a-z]+/g, '_').replace(/^_|_$/g, '');

const ICONS: Record<string, (size: number) => ReactNode> = {
  company: (z) => <Building2 size={z} />, billing: (z) => <CreditCard size={z} />,
  warehouses: (z) => <Warehouse size={z} />, business_configuration: (z) => <Compass size={z} />,
  units: (z) => <Ruler size={z} />, categories: (z) => <FolderTree size={z} />, brands: (z) => <Tag size={z} />,
  vehicles: (z) => <Car size={z} />, price_levels: (z) => <Coins size={z} />, salespeople: (z) => <UserRound size={z} />,
  tax_rates: (z) => <Percent size={z} />, exchange_rates: (z) => <ArrowLeftRight size={z} />, numbering: (z) => <Hash size={z} />,
  chart_of_accounts: (z) => <BookOpen size={z} />, period_lock: (z) => <Lock size={z} />,
  opening_balances: (z) => <ArrowDownToLine size={z} />, import_export: (z) => <FileUp size={z} />,
  print: (z) => <Printer size={z} />, hardware: (z) => <ScanBarcode size={z} />, users: (z) => <Users size={z} />,
  developer: (z) => <Plug size={z} />, system_health: (z) => <ShieldCheck size={z} />, maintenance: (z) => <Wrench size={z} />,
  audit_log: (z) => <ClipboardList size={z} />, reset_data: (z) => <Eraser size={z} />,
};

export const itemIcon = (it: SettingsNavItem, size = 20): ReactNode => (ICONS[itemKey(it)] ?? ((z: number) => <Settings size={z} />))(size);
export const itemTitle = (t: TFunction, it: SettingsNavItem) => t(`settingsNav.items.${itemKey(it)}.title`, { defaultValue: it.title });
export const itemDesc = (t: TFunction, it: SettingsNavItem) => t(`settingsNav.items.${itemKey(it)}.desc`, { defaultValue: it.desc });
export const sectionTitle = (t: TFunction, s: SettingsNavSection) => t(`settingsNav.sections.${sectionKey(s)}`, { defaultValue: s.title });
