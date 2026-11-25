/**
 * The unit of a document line (phase155): the base unit or one of the
 * product's packs, with what it comes to ("= 24 PCS") underneath. Renders
 * nothing unless the product has a pack, so a line without packs looks exactly
 * as before.
 */
import { useTranslation } from 'react-i18next';
import { baseQuantity, fmtQty, type ProductUnitRow } from '@/lib/packs';

type Choice = Pick<ProductUnitRow, 'id' | 'name' | 'name_ar' | 'factor'>;

export function PackSelect<P extends Choice>({ packs, value, savedLabel, savedFactor, baseUnit, quantity, disabled, onChange, className }: {
  packs: P[];
  value: string | null;
  /** The line's frozen pack, for one that was switched off since. */
  savedLabel?: string | null;
  savedFactor?: number | null;
  baseUnit: string;
  quantity: number;
  disabled?: boolean;
  onChange: (pack: P | null) => void;
  className?: string;
}) {
  const { t, i18n } = useTranslation();
  if (packs.length === 0 && !value) return null;
  const unit = baseUnit || t('packs.piece');
  const known = value ? packs.find((p) => p.id === value) : undefined;
  const factor = known?.factor ?? (value ? savedFactor ?? null : null);
  const name = (p: Choice) => (i18n.language === 'ar' && p.name_ar ? p.name_ar : p.name);
  return (
    <span className={`sb-pack ${className ?? ''}`} data-testid="pack-select">
      <select value={value ?? ''} disabled={disabled} aria-label={t('packs.unit')}
        className="sb-pack-select"
        onChange={(e) => onChange(packs.find((p) => p.id === e.target.value) ?? null)}>
        <option value="">{unit}</option>
        {packs.map((p) => <option key={p.id} value={p.id}>{`${name(p)} (${fmtQty(p.factor)} ${unit})`}</option>)}
        {value && !known && <option value={value}>{savedLabel ?? '—'}</option>}
      </select>
      {factor != null && quantity > 0 && (
        <bdi dir="ltr" className="sb-pack-note" data-testid="pack-note">= {fmtQty(baseQuantity(quantity, factor))} {unit}</bdi>
      )}
    </span>
  );
}
