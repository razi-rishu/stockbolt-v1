/**
 * Global v1 — industry families and business activities.
 *
 * FAMILIES are the 18 approved in StockBolt Global Architecture v1.0
 * (Phase 1, approved 2026-11-01). Their order and names are fixed.
 *
 * ACTIVITIES were first defined in this milestone (2026-11-03). The approved
 * architecture fixes the families and the rule (several activities per
 * organization, across families) but no activity list, so these are a
 * starting taxonomy for review, not previously approved names. Each lists
 * the modules it recommends; essential modules are always on and not listed.
 *
 * `automotive_parts_trading` is what every existing StockBolt company is: see
 * legacyConfiguration() in configuration-engine.ts.
 */
import type { ModuleKey } from './module-registry';

export type IndustryFamilyKey =
  | 'trading_commerce' | 'automotive' | 'manufacturing' | 'construction'
  | 'professional_services' | 'technology_it' | 'food_hospitality' | 'healthcare'
  | 'education' | 'real_estate' | 'logistics_transport' | 'events_entertainment'
  | 'agriculture' | 'energy_utilities' | 'finance_insurance' | 'nonprofit_community'
  | 'government_public' | 'other';

export interface IndustryFamily { key: IndustryFamilyKey; order: number; name: string; name_ar: string }

export const INDUSTRY_FAMILIES: readonly IndustryFamily[] = [
  { key: 'trading_commerce', order: 1, name: 'Trading & Commerce', name_ar: 'التجارة' },
  { key: 'automotive', order: 2, name: 'Automotive', name_ar: 'السيارات' },
  { key: 'manufacturing', order: 3, name: 'Manufacturing', name_ar: 'التصنيع' },
  { key: 'construction', order: 4, name: 'Construction', name_ar: 'البناء والمقاولات' },
  { key: 'professional_services', order: 5, name: 'Professional Services', name_ar: 'الخدمات المهنية' },
  { key: 'technology_it', order: 6, name: 'Technology & IT', name_ar: 'التكنولوجيا وتقنية المعلومات' },
  { key: 'food_hospitality', order: 7, name: 'Food & Hospitality', name_ar: 'الأغذية والضيافة' },
  { key: 'healthcare', order: 8, name: 'Healthcare', name_ar: 'الرعاية الصحية' },
  { key: 'education', order: 9, name: 'Education', name_ar: 'التعليم' },
  { key: 'real_estate', order: 10, name: 'Real Estate', name_ar: 'العقارات' },
  { key: 'logistics_transport', order: 11, name: 'Logistics & Transport', name_ar: 'الخدمات اللوجستية والنقل' },
  { key: 'events_entertainment', order: 12, name: 'Events & Entertainment', name_ar: 'الفعاليات والترفيه' },
  { key: 'agriculture', order: 13, name: 'Agriculture', name_ar: 'الزراعة' },
  { key: 'energy_utilities', order: 14, name: 'Energy & Utilities', name_ar: 'الطاقة والمرافق' },
  { key: 'finance_insurance', order: 15, name: 'Finance & Insurance', name_ar: 'المالية والتأمين' },
  { key: 'nonprofit_community', order: 16, name: 'Nonprofit & Community', name_ar: 'المنظمات غير الربحية والمجتمعية' },
  { key: 'government_public', order: 17, name: 'Government & Public Sector', name_ar: 'الحكومة والقطاع العام' },
  { key: 'other', order: 18, name: 'Other Industries', name_ar: 'صناعات أخرى' },
];

export interface BusinessActivity {
  key: string;
  family: IndustryFamilyKey;
  name: string;
  name_ar: string;
  recommends: ModuleKey[];
}

// Shorthands for the recurring module sets.
const TRADE: ModuleKey[] = ['items', 'inventory', 'sales', 'purchasing', 'expenses'];
const RETAIL: ModuleKey[] = [...TRADE, 'pos'];
const SERVICE: ModuleKey[] = ['items', 'sales', 'expenses'];
const PROJECT_SERVICE: ModuleKey[] = [...SERVICE, 'purchasing', 'projects'];
const a = (key: string, family: IndustryFamilyKey, name: string, name_ar: string, recommends: ModuleKey[]): BusinessActivity =>
  ({ key, family, name, name_ar, recommends });

export const BUSINESS_ACTIVITIES: readonly BusinessActivity[] = [
  a('wholesale_trading', 'trading_commerce', 'Wholesale & distribution', 'تجارة الجملة والتوزيع', TRADE),
  a('retail_store', 'trading_commerce', 'Retail store', 'متجر تجزئة', RETAIL),
  a('import_export', 'trading_commerce', 'Import & export', 'الاستيراد والتصدير', [...TRADE, 'multi_currency']),
  a('ecommerce', 'trading_commerce', 'E-commerce', 'التجارة الإلكترونية', [...TRADE, 'api_access']),

  a('automotive_parts_trading', 'automotive', 'Spare parts trading', 'تجارة قطع الغيار', [...RETAIL, 'automotive_catalog']),
  a('vehicle_workshop', 'automotive', 'Repair workshop & garage', 'ورشة صيانة وإصلاح', [...TRADE, 'projects', 'automotive_catalog']),
  a('vehicle_dealership', 'automotive', 'Vehicle dealership', 'معرض سيارات', TRADE),
  a('vehicle_rental', 'automotive', 'Vehicle rental & leasing', 'تأجير السيارات', [...SERVICE, 'fixed_assets']),

  a('discrete_manufacturing', 'manufacturing', 'Discrete manufacturing', 'تصنيع المنتجات', [...TRADE, 'fixed_assets', 'projects']),
  a('food_processing', 'manufacturing', 'Food & beverage processing', 'تصنيع الأغذية والمشروبات', [...TRADE, 'fixed_assets']),
  a('contract_manufacturing', 'manufacturing', 'Contract manufacturing', 'التصنيع حسب الطلب', [...TRADE, 'projects']),

  a('general_contracting', 'construction', 'General contracting', 'المقاولات العامة', [...PROJECT_SERVICE, 'inventory', 'fixed_assets']),
  a('specialty_contracting', 'construction', 'Specialty contracting (MEP, fit-out)', 'المقاولات التخصصية', [...PROJECT_SERVICE, 'inventory']),
  a('building_materials', 'construction', 'Building materials supply', 'توريد مواد البناء', TRADE),

  a('consulting', 'professional_services', 'Consulting', 'الاستشارات', PROJECT_SERVICE),
  a('accounting_legal', 'professional_services', 'Accounting & legal practice', 'المحاسبة والمحاماة', SERVICE),
  a('marketing_agency', 'professional_services', 'Marketing & creative agency', 'وكالة تسويق وإبداع', PROJECT_SERVICE),
  a('engineering_services', 'professional_services', 'Engineering & design services', 'الخدمات الهندسية والتصميم', PROJECT_SERVICE),

  a('software_development', 'technology_it', 'Software development', 'تطوير البرمجيات', [...PROJECT_SERVICE, 'amortization']),
  a('it_services', 'technology_it', 'IT services & support', 'خدمات ودعم تقنية المعلومات', [...PROJECT_SERVICE, 'amortization']),
  a('hardware_reseller', 'technology_it', 'Hardware & electronics reseller', 'بيع الأجهزة والإلكترونيات', TRADE),

  a('restaurant', 'food_hospitality', 'Restaurant & café', 'مطعم ومقهى', RETAIL),
  a('catering', 'food_hospitality', 'Catering', 'خدمات التموين', [...TRADE, 'projects']),
  a('hotel', 'food_hospitality', 'Hotel & accommodation', 'الفنادق والإقامة', [...SERVICE, 'fixed_assets']),

  a('clinic', 'healthcare', 'Clinic & medical practice', 'عيادة وممارسة طبية', [...SERVICE, 'purchasing', 'inventory']),
  a('pharmacy', 'healthcare', 'Pharmacy', 'صيدلية', RETAIL),
  a('medical_supplies', 'healthcare', 'Medical equipment & supplies', 'المعدات والمستلزمات الطبية', TRADE),

  a('school', 'education', 'School', 'مدرسة', [...SERVICE, 'amortization']),
  a('training_center', 'education', 'Training center', 'مركز تدريب', [...SERVICE, 'projects']),

  a('property_management', 'real_estate', 'Property management & leasing', 'إدارة وتأجير العقارات', [...SERVICE, 'fixed_assets', 'amortization']),
  a('real_estate_brokerage', 'real_estate', 'Real estate brokerage', 'الوساطة العقارية', SERVICE),
  a('property_development', 'real_estate', 'Property development', 'التطوير العقاري', [...PROJECT_SERVICE, 'fixed_assets']),

  a('freight_forwarding', 'logistics_transport', 'Freight forwarding', 'الشحن وإرسال البضائع', [...SERVICE, 'purchasing', 'multi_currency']),
  a('transport_fleet', 'logistics_transport', 'Transport & fleet operations', 'النقل وتشغيل الأساطيل', [...SERVICE, 'purchasing', 'fixed_assets']),
  a('warehousing_3pl', 'logistics_transport', 'Warehousing & 3PL', 'التخزين والخدمات اللوجستية للغير', [...SERVICE, 'inventory']),

  a('event_management', 'events_entertainment', 'Event management', 'تنظيم الفعاليات', [...PROJECT_SERVICE, 'inventory']),
  a('entertainment_venue', 'events_entertainment', 'Entertainment venue', 'مرافق الترفيه', [...RETAIL, 'fixed_assets']),

  a('farming', 'agriculture', 'Farming & livestock', 'الزراعة والثروة الحيوانية', [...TRADE, 'fixed_assets']),
  a('agri_trading', 'agriculture', 'Agricultural trading', 'تجارة المنتجات الزراعية', TRADE),

  a('energy_services', 'energy_utilities', 'Energy services & contracting', 'خدمات ومقاولات الطاقة', [...PROJECT_SERVICE, 'inventory', 'fixed_assets']),
  a('fuel_distribution', 'energy_utilities', 'Fuel distribution', 'توزيع الوقود', RETAIL),

  a('insurance_brokerage', 'finance_insurance', 'Insurance brokerage', 'الوساطة التأمينية', [...SERVICE, 'amortization']),
  a('financial_advisory', 'finance_insurance', 'Financial advisory', 'الاستشارات المالية', SERVICE),

  a('nonprofit_organization', 'nonprofit_community', 'Charity & nonprofit', 'جمعية خيرية ومنظمة غير ربحية', [...SERVICE, 'projects', 'purchasing']),
  a('membership_association', 'nonprofit_community', 'Club & membership association', 'نادٍ وجمعية أعضاء', [...SERVICE, 'amortization']),

  a('public_entity', 'government_public', 'Public entity or agency', 'جهة أو هيئة حكومية', [...SERVICE, 'purchasing', 'fixed_assets', 'projects']),

  a('other_trading', 'other', 'Other trading business', 'نشاط تجاري آخر', TRADE),
  a('other_services', 'other', 'Other service business', 'نشاط خدمي آخر', SERVICE),
];

const ACTIVITY_BY_KEY = new Map(BUSINESS_ACTIVITIES.map((x) => [x.key, x]));

export function getActivity(key: string): BusinessActivity | undefined {
  return ACTIVITY_BY_KEY.get(key);
}

export function activitiesOf(family: IndustryFamilyKey): BusinessActivity[] {
  return BUSINESS_ACTIVITIES.filter((x) => x.family === family);
}
