/**
 * Selling units of one product (phase155): BOX = 12 PCS, "200 g" = 0.2 KG.
 * Shown only while the company has packs on. A unit exists only with its
 * value, and the value is locked once a document has used it.
 */
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Loader2, Package, Pencil, Plus, Trash2 } from 'lucide-react';
import { getAdapter } from '@/data/index';
import type { ProductRow, ProductUnitInput } from '@/data/adapter';
import { useAuthStore } from '@/store/auth';
import { useHasPermission } from '@/hooks/use-permissions';
import { useArabicEnabled } from '@/hooks/use-arabic-enabled';
import { useInventorySettings } from '@/hooks/use-inventory-settings';
import { usePacks } from '@/hooks/use-packs';
import { fmtQty, packProblem, type ProductUnitRow } from '@/lib/packs';
import { packError } from '@/lib/pack-errors';
import { Modal } from '@/ui/modal';
import { Input } from '@/ui/input';

const BLANK = { name: '', name_ar: '', factor: '', selling_price: '', purchase_price: '', barcode: '', for_sales: true, for_purchases: true, is_active: true };
type Form = typeof BLANK;
const num = (s: string) => (s.trim() === '' ? null : Number(s));
const money = (n: number) => n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export function ProductPacksCard({ product }: { product: ProductRow }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const { company_id } = useAuthStore();
  const arabicOn = useArabicEnabled();
  const canEdit = useHasPermission('inventory.write');
  const inv = useInventorySettings();
  const packs = usePacks();
  const unit = packs.unitCode(product.unit_id) || t('packs.piece');
  const [editing, setEditing] = useState<ProductUnitRow | 'new' | null>(null);
  const [form, setForm] = useState<Form>(BLANK);
  const [err, setErr] = useState<string | null>(null);

  const { data: rows = [] } = useQuery({
    queryKey: ['product_units', company_id, product.id],
    queryFn: () => getAdapter().productUnits.listForProduct(product.id),
    enabled: !!company_id && inv.packs_enabled,
  });
  const refresh = () => qc.invalidateQueries({ queryKey: ['product_units', company_id] });

  const open = (r: ProductUnitRow | 'new') => {
    setErr(null);
    setEditing(r);
    setForm(r === 'new' ? BLANK : {
      name: r.name, name_ar: r.name_ar ?? '', factor: String(r.factor),
      selling_price: r.selling_price == null ? '' : String(r.selling_price),
      purchase_price: r.purchase_price == null ? '' : String(r.purchase_price),
      barcode: r.barcode ?? '', for_sales: r.for_sales, for_purchases: r.for_purchases, is_active: r.is_active,
    });
  };
  const factor = Number(form.factor);
  const valid = form.name.trim() !== '' && Number.isFinite(factor) && factor > 0;
  const whole = valid ? packProblem(1, factor, packs.allowsDecimals(product.unit_id)) : null;

  const save = useMutation({
    mutationFn: async () => {
      const row: ProductUnitInput = {
        name: form.name.trim(), name_ar: form.name_ar.trim() || null, factor,
        selling_price: num(form.selling_price), purchase_price: num(form.purchase_price),
        barcode: form.barcode.trim() || null,
        for_sales: form.for_sales, for_purchases: form.for_purchases, is_active: form.is_active,
        sort_order: editing === 'new' ? rows.length : (editing as ProductUnitRow).sort_order,
      };
      if (editing === 'new') await getAdapter().productUnits.create({ ...row, company_id: company_id!, product_id: product.id });
      else await getAdapter().productUnits.update((editing as ProductUnitRow).id, row);
    },
    onSuccess: async () => { await refresh(); setEditing(null); },
    onError: (e) => setErr(packError(t, e)),
  });
  const remove = useMutation({
    mutationFn: (id: string) => getAdapter().productUnits.remove(id),
    onSuccess: refresh,
    onError: (e) => window.alert(/violates foreign key/i.test(String(e)) ? t('packs.in_use') : packError(t, e)),
  });

  if (!inv.packs_enabled || (product as { type?: string }).type === 'service' || product.requires_serial) return null;
  const set = <K extends keyof Form>(k: K, v: Form[K]) => setForm((f) => ({ ...f, [k]: v }));

  return (
    <section className="sb-card sb-pack-card" data-testid="product-packs">
      <div className="sb-doc-lines-head">
        <div>
          <h2 className="sb-form-title">{t('packs.card_title')}</h2>
          <p className="sb-form-hint">{t('packs.card_hint', { unit })}</p>
        </div>
        {canEdit && <button type="button" className="sb-secondary-btn sb-btn-inline" onClick={() => open('new')} data-testid="pack-add"><Plus size={16} aria-hidden="true" />{t('packs.add')}</button>}
      </div>
      {rows.length === 0 ? <p className="sb-empty">{t('packs.none')}</p> : (
        <ul className="sb-pack-list">
          {rows.map((r) => (
            <li key={r.id} className="sb-pack-line">
              <Package size={18} aria-hidden="true" />
              <span className="sb-pack-line-name">
                <bdi dir="ltr">1 {r.name} = {fmtQty(r.factor)} {unit}</bdi>
                {!r.is_active && <span className="sb-pill sb-pill-muted ms-2" style={{ marginTop: 0 }}>{t('common.inactive')}</span>}
                <span className="sb-form-hint">
                  {[
                    r.selling_price != null && `${t('packs.sell_price')}: ${money(r.selling_price)}`,
                    r.purchase_price != null && `${t('packs.buy_price')}: ${money(r.purchase_price)}`,
                    inv.barcodes_enabled && r.barcode,
                    !r.for_sales && t('packs.buy_only'), !r.for_purchases && t('packs.sell_only'),
                  ].filter(Boolean).join(' · ')}
                </span>
              </span>
              {canEdit && (
                <span className="sb-pack-line-act">
                  <button type="button" className="sb-doc-line-del" aria-label={t('common.edit')} title={t('common.edit')} onClick={() => open(r)}><Pencil size={15} aria-hidden="true" /></button>
                  <button type="button" className="sb-doc-line-del" aria-label={t('common.delete')} title={t('common.delete')} disabled={remove.isPending}
                    onClick={() => { if (window.confirm(t('packs.delete_confirm', { name: r.name }))) remove.mutate(r.id); }}><Trash2 size={15} aria-hidden="true" /></button>
                </span>
              )}
            </li>
          ))}
        </ul>
      )}

      <Modal open={!!editing} onClose={() => setEditing(null)} title={editing === 'new' ? t('packs.add') : t('packs.edit')}>
        <form className="sb-ocean sb-form sb-modal-form" onSubmit={(e) => { e.preventDefault(); if (valid && !whole) save.mutate(); }}>
          <Input label={t('packs.name')} required maxLength={40} value={form.name} onChange={(e) => set('name', e.target.value)} placeholder={t('packs.name_ph')} />
          {arabicOn && <Input label={t('packs.name_ar')} dir="rtl" maxLength={40} value={form.name_ar} onChange={(e) => set('name_ar', e.target.value)} />}
          <Input label={t('packs.value', { unit })} required type="number" min="0" step="any" value={form.factor} onChange={(e) => set('factor', e.target.value)} hint={t('packs.value_hint')} data-testid="pack-factor" />
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Input label={t('packs.sell_price')} type="number" min="0" step="0.01" value={form.selling_price} onChange={(e) => set('selling_price', e.target.value)} hint={t('packs.sell_price_hint')} />
            <Input label={t('packs.buy_price')} type="number" min="0" step="0.01" value={form.purchase_price} onChange={(e) => set('purchase_price', e.target.value)} />
          </div>
          {inv.barcodes_enabled && <Input label={t('products.barcode')} value={form.barcode} onChange={(e) => set('barcode', e.target.value)} />}
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
            {([['for_sales', t('packs.for_sales')], ['for_purchases', t('packs.for_purchases')], ['is_active', t('common.active')]] as const).map(([k, label]) => (
              <label key={k} className="sb-check-row"><input type="checkbox" checked={form[k]} onChange={(e) => set(k, e.target.checked)} /><span className="sb-check-text">{label}</span></label>
            ))}
          </div>
          {valid && !whole && (
            <p className="sb-info-note" role="status" data-testid="pack-preview"><bdi dir="ltr">1 {form.name.trim()} = {fmtQty(factor)} {unit}</bdi>. {t('packs.value_lock')}</p>
          )}
          {whole && <p className="sb-alert sb-alert-danger" role="alert">{whole === 'whole_units' ? t('packs.value_whole', { unit }) : t('packs.value_small', { unit })}</p>}
          {err && <p className="sb-alert sb-alert-danger" role="alert">{err}</p>}
          <div className="flex justify-end gap-2">
            <button type="button" className="sb-secondary-btn sb-btn-inline" onClick={() => setEditing(null)}>{t('common.cancel')}</button>
            <button type="submit" className="sb-primary-btn sb-btn-inline" disabled={!valid || !!whole || save.isPending}>
              {save.isPending && <Loader2 size={16} className="sb-spin" aria-hidden="true" />}{t('common.save')}
            </button>
          </div>
        </form>
      </Modal>
    </section>
  );
}
