/**
 * phase126 — the asset lines of a fixed asset purchase (Ocean Teal).
 *
 * Each line is one asset: the purchase columns (as on New Bill) on the first
 * row, and the register / depreciation details on a second row underneath,
 * so the purchase and the register entry are entered once, together.
 */
import { useTranslation } from 'react-i18next';
import { Plus, Trash2 } from 'lucide-react';
import type { CoaRow } from '@/data/adapter';
import { lineAmounts, newAssetLine, type AssetLine } from './asset-purchase-calc';

const fmt = (n: number) => n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export interface AssetPurchaseLinesProps {
  lines: AssetLine[];
  onChange: (lines: AssetLine[]) => void;
  accounts: CoaRow[];
  taxOptions: { value: string; label: string }[];
  warehouses: { id: string; name: string }[];
  showTax: boolean;
  showWarehouse: boolean;
  inclusive: boolean;
  readOnly: boolean;
  defaultTaxRate: string;
}

export function AssetPurchaseLines(p: AssetPurchaseLinesProps) {
  const { t } = useTranslation();
  const set = (key: string, patch: Partial<AssetLine>) =>
    p.onChange(p.lines.map((l) => (l.key === key ? { ...l, ...patch } : l)));
  const remove = (key: string) => p.onChange(p.lines.filter((l) => l.key !== key));
  const add = () => p.onChange([...p.lines, newAssetLine({
    tax_rate: p.defaultTaxRate,
    asset_account_id: p.lines[p.lines.length - 1]?.asset_account_id ?? '',
  })]);

  const cols = 6 + (p.showTax ? 1 : 0) + (p.showWarehouse ? 1 : 0) + (p.readOnly ? 0 : 1);

  return (
    <div className="sb-card sb-doc-card sb-doc-lines">
      <div className="sb-doc-lines-head">
        <div style={{ minWidth: 0 }}>
          <h2 className="sb-doc-card-title" style={{ margin: 0 }}>{t('apOcean.lines_title')}</h2>
          <p className="sb-fx-name" style={{ margin: 0, fontSize: 12 }}>{t('apOcean.lines_hint')}</p>
        </div>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm sb-ap-table">
          <thead>
            <tr>
              <th className="px-3 py-2 text-start font-medium" style={{ minWidth: 200 }}>{t('apOcean.col_asset')}</th>
              <th className="px-3 py-2 text-start font-medium" style={{ minWidth: 190 }}>{t('apOcean.col_account')}</th>
              <th className="px-3 py-2 text-end font-medium" style={{ width: 80 }}>{t('apOcean.col_qty')}</th>
              <th className="px-3 py-2 text-end font-medium" style={{ width: 120 }}>{t('apOcean.col_unit_cost')}</th>
              <th className="px-3 py-2 text-end font-medium" style={{ width: 80 }}>{t('apOcean.col_disc')}</th>
              {p.showTax && <th className="px-3 py-2 text-start font-medium" style={{ width: 130 }}>{t('apOcean.col_tax')}</th>}
              {p.showWarehouse && <th className="px-3 py-2 text-start font-medium" style={{ width: 150 }}>{t('apOcean.col_location')}</th>}
              <th className="px-3 py-2 text-end font-medium" style={{ width: 120 }}>{t('apOcean.col_total')}</th>
              {!p.readOnly && <th style={{ width: 40 }} />}
            </tr>
          </thead>
          <tbody>
            {p.lines.map((l, i) => {
              const a = lineAmounts(l, p.inclusive);
              return [
                <tr key={l.key} className="sb-ap-main">
                  <td className="px-3 pt-2">
                    <input className="sb-ap-in" value={l.name} disabled={p.readOnly}
                      placeholder={t('apOcean.ph_asset')} aria-label={t('apOcean.col_asset')}
                      onChange={(e) => set(l.key, { name: e.target.value })} />
                  </td>
                  <td className="px-3 pt-2">
                    <select className="sb-ap-in" value={l.asset_account_id} disabled={p.readOnly} aria-label={t('apOcean.col_account')}
                      onChange={(e) => set(l.key, { asset_account_id: e.target.value })}>
                      <option value="">{t('apOcean.pick_account')}</option>
                      {p.accounts.map((c) => <option key={c.id} value={c.id}>{c.code} — {c.name}</option>)}
                    </select>
                  </td>
                  <td className="px-3 pt-2"><input className="sb-ap-in text-end" dir="ltr" type="number" min="0" step="1" value={l.quantity} disabled={p.readOnly} aria-label={t('apOcean.col_qty')} onChange={(e) => set(l.key, { quantity: e.target.value })} /></td>
                  <td className="px-3 pt-2"><input className="sb-ap-in text-end" dir="ltr" type="number" min="0" step="0.01" value={l.unit_cost} disabled={p.readOnly} aria-label={t('apOcean.col_unit_cost')} onChange={(e) => set(l.key, { unit_cost: e.target.value })} /></td>
                  <td className="px-3 pt-2"><input className="sb-ap-in text-end" dir="ltr" type="number" min="0" max="100" step="0.01" value={l.discount_percent} disabled={p.readOnly} aria-label={t('apOcean.col_disc')} onChange={(e) => set(l.key, { discount_percent: e.target.value })} /></td>
                  {p.showTax && (
                    <td className="px-3 pt-2">
                      <select className="sb-ap-in" value={l.tax_rate} disabled={p.readOnly} aria-label={t('apOcean.col_tax')}
                        onChange={(e) => set(l.key, { tax_rate: e.target.value })}>
                        {p.taxOptions.map((o) => <option key={o.value + o.label} value={o.value}>{o.label}</option>)}
                      </select>
                    </td>
                  )}
                  {p.showWarehouse && (
                    <td className="px-3 pt-2">
                      <select className="sb-ap-in" value={l.warehouse_id} disabled={p.readOnly} aria-label={t('apOcean.col_location')}
                        onChange={(e) => set(l.key, { warehouse_id: e.target.value })}>
                        <option value="">—</option>
                        {p.warehouses.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
                      </select>
                    </td>
                  )}
                  <td className="px-3 pt-2 text-end"><bdi dir="ltr" className="sb-dash-num">{fmt(a.line_total)}</bdi></td>
                  {!p.readOnly && (
                    <td className="px-1 pt-2">
                      <button type="button" className="sb-doc-line-del" disabled={p.lines.length <= 1}
                        onClick={() => remove(l.key)} aria-label={t('apOcean.remove_line')} title={t('apOcean.remove_line')}>
                        <Trash2 size={15} aria-hidden="true" />
                      </button>
                    </td>
                  )}
                </tr>,
                <tr key={`${l.key}-reg`} className="sb-ap-reg">
                  <td colSpan={cols} className="px-3 pb-3">
                    <div className="sb-ap-reg-grid">
                      <span className="sb-ap-reg-tag">{t('apOcean.register_n', { n: i + 1 })}</span>
                      <label><span>{t('fa.f_category')}</span>
                        <input className="sb-ap-in" value={l.category} disabled={p.readOnly} onChange={(e) => set(l.key, { category: e.target.value })} /></label>
                      <label><span>{t('fa.f_tag')}</span>
                        <input className="sb-ap-in" dir="ltr" value={l.asset_tag} disabled={p.readOnly} onChange={(e) => set(l.key, { asset_tag: e.target.value })} /></label>
                      <label><span>{t('fa.f_in_service_date')}</span>
                        <input className="sb-ap-in" type="date" value={l.in_service_date} disabled={p.readOnly} onChange={(e) => set(l.key, { in_service_date: e.target.value })} /></label>
                      <label><span>{t('fa.f_method')}</span>
                        <select className="sb-ap-in" value={l.method} disabled={p.readOnly}
                          onChange={(e) => set(l.key, { method: e.target.value as AssetLine['method'] })}>
                          <option value="straight_line">{t('fa.method_straight_line')}</option>
                          <option value="reducing_balance">{t('fa.method_reducing_balance')}</option>
                        </select></label>
                      {l.method === 'straight_line' ? (
                        <label><span>{t('fa.f_life_months')}</span>
                          <input className="sb-ap-in" dir="ltr" type="number" min="1" value={l.useful_life_months} disabled={p.readOnly} onChange={(e) => set(l.key, { useful_life_months: e.target.value })} /></label>
                      ) : (
                        <label><span>{t('fa.f_wdv_rate')}</span>
                          <input className="sb-ap-in" dir="ltr" type="number" min="0" max="100" step="0.001" value={l.wdv_rate} disabled={p.readOnly} onChange={(e) => set(l.key, { wdv_rate: e.target.value })} /></label>
                      )}
                      <label><span>{t('fa.f_salvage')}</span>
                        <input className="sb-ap-in" dir="ltr" type="number" min="0" step="0.01" value={l.salvage_value} disabled={p.readOnly} onChange={(e) => set(l.key, { salvage_value: e.target.value })} /></label>
                    </div>
                  </td>
                </tr>,
              ];
            })}
          </tbody>
        </table>
      </div>
      {!p.readOnly && (
        <div className="sb-doc-add-line">
          <button type="button" className="sb-row-link" onClick={add}>
            <Plus size={15} aria-hidden="true" /> {t('apOcean.add_line')}
          </button>
        </div>
      )}
    </div>
  );
}
