import type { DataAdapter } from '@/data/adapter';

const PAYMENT_METHODS = [
  { name: 'Cash',           name_ar: 'نقدي',                type: 'cash' },
  { name: 'Bank Transfer',  name_ar: 'تحويل بنكي',          type: 'bank' },
  { name: 'Cheque',         name_ar: 'شيك',                 type: 'cheque' },
  { name: 'Card',           name_ar: 'بطاقة ائتمانية',       type: 'card' },
] as const;

/** Seeds the four standard payment methods. Per Doc 5 Phase 1 backend logic. */
export async function seedPaymentMethods(
  company_id: string,
  adapter: DataAdapter,
  existing_names: string[] = [],
): Promise<void> {
  // A resumed onboarding may have inserted some already (one row per request).
  for (const pm of PAYMENT_METHODS.filter((p) => !existing_names.includes(p.name))) {
    await adapter.onboarding.insertPaymentMethod({
      company_id,
      name: pm.name,
      name_ar: pm.name_ar,
      type: pm.type,
      is_active: true,
    });
  }
}
