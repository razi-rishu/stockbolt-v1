/**
 * The warning before a document with packs is saved (phase155): every pack
 * line in full ("2 BOX = 24 PCS"), price and stock warnings, and nothing is
 * saved until the user accepts. Everyone sees it, admins too. A document
 * without packs never does.
 *
 *   const gate = usePackGate();
 *   gate.ask(lines, () => save());   // runs at once when there is nothing to accept
 *   {gate.modal}
 */
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { AlertTriangle, Package } from 'lucide-react';
import { Modal } from '@/ui/modal';
import { getAdapter } from '@/data/index';
import type { PackDocType } from '@/data/adapter';
import { checkPacks, packLabel, type PackCheck, type PackLineInput } from '@/lib/packs';

const money = (n: number) => n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export function usePackGate(opts: { loading?: boolean; continueLabel?: string } = {}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState<{ check: PackCheck; go: () => void } | null>(null);
  const [accepted, setAccepted] = useState(false);

  const ask = (lines: PackLineInput[], go: () => void) => {
    if (opts.loading) return;
    const check = checkPacks(lines);
    if (check.lines.length === 0 && check.problems.length === 0) { go(); return; }
    setAccepted(false);
    setOpen({ check, go });
  };
  const close = () => setOpen(null);
  const check = open?.check;
  const blocked = (check?.problems.length ?? 0) > 0;

  const modal = (
    <Modal open={!!open} onClose={close} title={blocked ? t('packs.fix_title') : t('packs.warn_title')}>
      {check && (
        <div className="sb-ocean sb-form sb-modal-form" data-testid="pack-warning">
          {blocked ? (
            <ul className="sb-pack-list">
              {check.problems.map((p, i) => (
                <li key={i} className="sb-alert sb-alert-danger" role="alert">
                  {p.kind === 'whole_units'
                    ? t('packs.err_whole', { product: p.label, qty: p.text, unit: p.base_unit || t('packs.piece') })
                    : t('packs.err_small', { product: p.label, qty: p.text, unit: p.base_unit || t('packs.piece') })}
                </li>
              ))}
            </ul>
          ) : (
            <>
              <p className="sb-form-hint">{t('packs.warn_body')}</p>
              <ul className="sb-pack-list" data-testid="pack-warning-lines">
                {check.lines.map((l, i) => (
                  <li key={i} className="sb-pack-line">
                    <Package size={18} aria-hidden="true" />
                    <span className="sb-pack-line-name">{l.label}</span>
                    <bdi dir="ltr" className="sb-pack-line-qty">{l.text_qty} {packLabel(l.pack_name)} = {l.text_base} {l.base_unit || t('packs.piece')}</bdi>
                  </li>
                ))}
              </ul>
              {check.warnings.map((w, i) => (
                <p key={i} className="sb-alert sb-alert-warn" role="status" style={{ fontWeight: 400, display: 'flex', gap: 8, alignItems: 'flex-start' }}>
                  <AlertTriangle size={16} aria-hidden="true" style={{ flex: 'none', marginTop: 2 }} />
                  <span>{w.kind === 'price_is_base' ? t('packs.w_price', { product: w.label, pack: w.pack_name, unit: w.base_unit || t('packs.piece') })
                    : w.kind === 'cost_odd' ? t('packs.w_cost_odd', { product: w.label, unit: w.base_unit || t('packs.piece'), cost: money(w.cost), usual: money(w.usual) })
                    : w.kind === 'below_cost' ? t('packs.w_cost', { product: w.label, pack: w.pack_name, price: money(w.price), cost: money(w.cost) })
                    : t('packs.w_stock', { product: w.label, have: w.have, need: w.need, unit: w.base_unit || t('packs.piece') })}</span>
                </p>
              ))}
              <label className="sb-check-row">
                <input type="checkbox" checked={accepted} onChange={(e) => setAccepted(e.target.checked)} data-testid="pack-accept" />
                <span className="sb-check-text">{t('packs.accept')}</span>
              </label>
            </>
          )}
          <div className="flex flex-wrap justify-end gap-2">
            <button type="button" className="sb-secondary-btn sb-btn-inline" onClick={close}>{blocked ? t('packs.go_back') : t('common.cancel')}</button>
            {!blocked && (
              <button type="button" className="sb-primary-btn sb-btn-inline" disabled={!accepted} data-testid="pack-continue"
                onClick={() => { const go = open!.go; close(); go(); }}>{opts.continueLabel ?? t('packs.continue')}</button>
            )}
          </div>
        </div>
      )}
    </Modal>
  );
  return { ask, modal };
}

/** Activity: who accepted the quantities. Never stops a save that succeeded. */
export async function recordPackAcceptance(doc_type: PackDocType, id: string, lines: PackLineInput[]): Promise<void> {
  if (!lines.some((l) => l.pack_name)) return;
  try { await getAdapter().productUnits.recordAcceptance(doc_type, id); }
  catch (e) { console.error('pack acceptance not recorded', e); }
}
