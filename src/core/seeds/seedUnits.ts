import type { DataAdapter } from '@/data/adapter';

const UNITS = [
  { code: 'PCS',   name: 'Pieces',  name_ar: 'قطعة' },
  { code: 'SET',   name: 'Set',     name_ar: 'طقم' },
  { code: 'KG',    name: 'Kilogram', name_ar: 'كيلوجرام' },
  { code: 'LITRE', name: 'Litre',   name_ar: 'لتر' },
  { code: 'BOX',   name: 'Box',     name_ar: 'صندوق' },
] as const;

/** Seeds default units of measure. Per Doc 5 Phase 1 backend logic. */
export async function seedUnits(company_id: string, adapter: DataAdapter): Promise<void> {
  for (const u of UNITS) {
    await adapter.onboarding.insertUnit({
      company_id,
      code: u.code,
      name: u.name,
      name_ar: u.name_ar,
    });
  }
}
