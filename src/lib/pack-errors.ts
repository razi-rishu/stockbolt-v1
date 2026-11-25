/** The database's pack refusals (phase155) in the user's language. */
import type { TFunction } from 'i18next';

export function packError(t: TFunction, e: unknown): string {
  const msg = e instanceof Error ? e.message : String(e);
  if (/app_update_required/.test(msg)) return t('packs.e_update');
  if (/packs_off/.test(msg)) return t('packs.e_off');
  if (/pack_locked/.test(msg)) return t('packs.e_locked');
  if (/base_unit_locked/.test(msg)) return t('packs.e_base_locked');
  if (/pack_barcode_used|product_units_barcode_key/.test(msg)) return t('packs.e_barcode');
  if (/product_units_name_key/.test(msg)) return t('packs.e_name');
  if (/pack_not_allowed/.test(msg)) return t('packs.e_not_allowed');
  if (/pack_return_not_supported/.test(msg)) return t('packs.e_return');
  if (/whole_units_only/.test(msg)) return t('packs.e_whole');
  if (/pack_too_small/.test(msg)) return t('packs.e_small');
  if (/pack_invalid/.test(msg)) return t('packs.e_invalid');
  return msg;
}
