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

/** The database's repack refusals (phase157). */
export function repackError(t: TFunction, e: unknown): string {
  const msg = e instanceof Error ? e.message : String(e);
  const detail = msg.slice(msg.indexOf(': ', msg.indexOf('repack_')) + 2);
  if (/repack_off/.test(msg)) return t('repack.off');
  if (/repack_not_enough/.test(msg)) return t('repack.e_not_enough', { detail });
  if (/repack_no_cost/.test(msg)) return t('repack.e_no_cost', { detail });
  if (/repack_pending_cost/.test(msg)) return t('repack.e_pending');
  if (/repack_waste_approval/.test(msg)) return t('repack.e_waste_approval');
  if (/repack_output_gone/.test(msg)) return t('repack.e_gone');
  if (/repack_same_product/.test(msg)) return t('repack.e_same');
  if (/repack_no_input/.test(msg)) return t('repack.p_no_input');
  if (/repack_locked/.test(msg)) return t('repack.e_locked');
  return packError(t, e);
}
