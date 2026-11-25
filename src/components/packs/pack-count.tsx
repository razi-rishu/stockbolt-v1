/**
 * Counting or moving stock in packs (phase155): 7 BOX + 7 PCS. The line itself
 * keeps base units (91 PCS) — this only does the multiplication, and shows what
 * the quantity comes to. Renders nothing for a product without packs.
 */
import { useTranslation } from 'react-i18next';
import { baseQuantity, packBreakdown, type ProductUnitRow } from '@/lib/packs';

export interface PackCount { pack_id: string; packs: string; loose: string }

export function packCountTotal(c: PackCount, packs: ProductUnitRow[]): number {
  const p = packs.find((x) => x.id === c.pack_id);
  return Math.round(((p ? baseQuantity(parseFloat(c.packs) || 0, p.factor) : 0) + (parseFloat(c.loose) || 0)) * 1000) / 1000;
}

export function PackCounter({ packs, value, quantity, baseUnit, disabled, onChange }: {
  packs: ProductUnitRow[];
  value: PackCount | null;
  /** The line's quantity in base units. */
  quantity: number;
  baseUnit: string;
  disabled?: boolean;
  /** null = typed in base units again. */
  onChange: (next: PackCount | null, quantity: number | null) => void;
}) {
  const { t } = useTranslation();
  if (packs.length === 0) return null;
  const unit = baseUnit || t('packs.piece');
  const note = packBreakdown(quantity, packs, unit);
  const set = (c: PackCount) => onChange(c, packCountTotal(c, packs));
  return (
    <span className="sb-pack" data-testid="pack-counter">
      {!disabled && (
        <select className="sb-pack-select" aria-label={t('packs.count_in')} value={value?.pack_id ?? ''}
          onChange={(e) => (e.target.value
            ? onChange({ pack_id: e.target.value, packs: '', loose: '' }, null)
            : onChange(null, null))}>
          <option value="">{t('packs.count_in_unit', { unit })}</option>
          {packs.map((p) => <option key={p.id} value={p.id}>{t('packs.count_in_pack', { pack: p.name, unit })}</option>)}
        </select>
      )}
      {value && !disabled && (
        <span className="sb-pack-count">
          <input type="number" min="0" step="any" inputMode="decimal" value={value.packs} data-testid="pack-count-packs"
            aria-label={packs.find((p) => p.id === value.pack_id)?.name} placeholder={packs.find((p) => p.id === value.pack_id)?.name}
            onChange={(e) => set({ ...value, packs: e.target.value })} dir="ltr" />
          <span aria-hidden="true">+</span>
          <input type="number" min="0" step="any" inputMode="decimal" value={value.loose} data-testid="pack-count-loose"
            aria-label={unit} placeholder={unit} onChange={(e) => set({ ...value, loose: e.target.value })} dir="ltr" />
        </span>
      )}
      {note && <bdi dir="ltr" className="sb-pack-note" data-testid="pack-note">= {note}</bdi>}
    </span>
  );
}
