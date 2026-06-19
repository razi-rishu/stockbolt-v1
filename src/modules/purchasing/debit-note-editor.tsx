import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { getAdapter } from '@/data/index';
import { useAuthStore } from '@/store/auth';
import { useInvalidateBooks } from '@/hooks/use-invalidate-books';
import { useCompanyCurrency } from '@/hooks/use-company-currency';
import { Button } from '@/ui/button';
import { SearchableSelect } from '@/ui/searchable-select';
// Phase 14.04 — Signature template view mode for saved debit notes.
import { ConfigurableDocTemplate } from '@/modules/print/engine/ConfigurableDocTemplate';
import { useResolvedPrintTemplate } from '@/hooks/use-resolved-print-template';
import { debitNoteToDocumentData } from '@/modules/print/_signature/adapters';
import '@/modules/print/_signature/print.css';
import type { DebitNoteRow, DebitNoteItemInsert, DebitNoteItemRow, ContactRow, VendorBillRow, VendorBillItemRow, Company, ProductRow } from '@/data/adapter';

const today = () => new Date().toISOString().slice(0, 10);
const fmt   = (n: number) => n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

interface LineItem {
  product_id:       string | null;
  description:      string;
  quantity:         number;
  unit_cost:        number;
  discount_percent: number;
  tax_rate:         number;
}

function calcLine(l: LineItem) {
  const sub  = l.quantity * l.unit_cost;
  const disc = Math.round(sub * (l.discount_percent / 100) * 100) / 100;
  const net  = sub - disc;
  const tax  = Math.round(net * (l.tax_rate / 100) * 100) / 100;
  return { line_subtotal: net, discount_amount: disc, tax_amount: tax, line_total: net + tax };
}

export default function DebitNoteEditorPage() {
  const { id }      = useParams<{ id: string }>();
  const isNew       = !id || id === 'new';
  const { t }       = useTranslation();
  const navigate    = useNavigate();
  const printTemplate = useResolvedPrintTemplate('debit_note');
  const qc          = useQueryClient();
  const invalidateBooks = useInvalidateBooks();   // Phase 14.14k
  const companyCurrency = useCompanyCurrency();    // Phase 14.14m
  const { company_id } = useAuthStore();

  const [supplierId,   setSupplierId]   = useState('');
  const [linkedBillId, setLinkedBillId] = useState('');
  const [date,         setDate]         = useState(today());
  const [reason,       setReason]       = useState('return');
  const [notes,        setNotes]        = useState('');
  const [lines,        setLines]        = useState<LineItem[]>([]);
  const [voidReason,   setVoidReason]   = useState('');
  const [showVoidDlg,  setShowVoidDlg]  = useState(false);

  const { data: suppliers = [] } = useQuery<ContactRow[]>({
    queryKey: ['contacts', company_id, 'supplier'],
    queryFn:  () => getAdapter().contacts.list(company_id!, 'supplier'),
    enabled:  !!company_id,
  });
  const { data: bills = [] } = useQuery<VendorBillRow[]>({
    queryKey: ['vendor_bills_confirmed', company_id],
    queryFn:  () => getAdapter().vendorBills.list(company_id!, 'confirmed'),
    enabled:  !!company_id,
  });
  const { data: existing } = useQuery<DebitNoteRow | null>({
    queryKey: ['debit_note', id],
    queryFn:  () => getAdapter().debitNotes.getById(id!),
    enabled:  !isNew && !!id,
  });
  const { data: existingItems = [] } = useQuery<DebitNoteItemRow[]>({
    queryKey: ['debit_note_items', id],
    queryFn:  () => getAdapter().debitNotes.getItems(id!),
    enabled:  !isNew && !!id,
  });
  // Phase 14.04 — reference data for Signature template.
  const { data: companyRow } = useQuery<Company | null>({
    queryKey: ['company', company_id],
    queryFn:  () => getAdapter().companies.getById(company_id!),
    enabled:  !!company_id,
  });
  const { data: products = [] } = useQuery<ProductRow[]>({
    queryKey: ['products', company_id],
    queryFn:  () => getAdapter().products.list(company_id!),
    enabled:  !!company_id,
  });

  // Phase 14.04 — view-first mode for saved debit notes.
  const [viewMode, setViewMode] = useState(!isNew);

  useEffect(() => {
    if (existing) {
      setSupplierId(existing.supplier_id);
      setLinkedBillId(existing.linked_bill_id ?? '');
      setDate(existing.date);
      setReason(existing.reason ?? 'return');
      setNotes(existing.notes ?? '');
    }
  }, [existing]);

  useEffect(() => {
    if (existingItems.length > 0) {
      setLines(existingItems.map(it => ({
        product_id:       it.product_id ?? null,
        description:      it.description ?? '',
        quantity:         Number(it.quantity),
        unit_cost:        Number(it.unit_cost),
        discount_percent: Number(it.discount_percent),
        tax_rate:         Number(it.tax_rate ?? 0),
      })));
    }
  }, [existingItems]);

  // Bill items for import
  const { data: billItems = [] } = useQuery<VendorBillItemRow[]>({
    queryKey: ['bill_items_for_dn', linkedBillId],
    queryFn:  () => getAdapter().vendorBills.getItems(linkedBillId),
    enabled:  !!linkedBillId,
  });

  function importFromBill() {
    if (billItems.length === 0) return;
    setLines(billItems.map(it => ({
      product_id:       it.product_id ?? null,
      description:      it.description ?? '',
      quantity:         Number(it.quantity),
      unit_cost:        Number(it.unit_cost),
      discount_percent: Number(it.discount_percent),
      tax_rate:         Number(it.tax_rate ?? 0),
    })));
  }

  function addLine() {
    setLines(prev => [...prev, { product_id: null, description: '', quantity: 1, unit_cost: 0, discount_percent: 0, tax_rate: 5 }]);
  }
  function removeLine(i: number) {
    setLines(prev => prev.filter((_, idx) => idx !== i));
  }
  function updateLine<K extends keyof LineItem>(i: number, key: K, val: LineItem[K]) {
    setLines(prev => prev.map((l, idx) => idx === i ? { ...l, [key]: val } : l));
  }

  const totals = lines.reduce((acc, l) => {
    const c = calcLine(l);
    return { subtotal: acc.subtotal + c.line_subtotal + c.discount_amount, discount: acc.discount + c.discount_amount, tax: acc.tax + c.tax_amount, total: acc.total + c.line_total };
  }, { subtotal: 0, discount: 0, tax: 0, total: 0 });

  function buildItems(): DebitNoteItemInsert[] {
    return lines.map((l, i) => {
      const c = calcLine(l);
      return {
        product_id:       l.product_id ?? undefined,
        description:      l.description || undefined,
        quantity:         l.quantity,
        unit_cost:        l.unit_cost,
        discount_percent: l.discount_percent,
        discount_amount:  c.discount_amount,
        tax_rate:         l.tax_rate,
        tax_amount:       c.tax_amount,
        line_subtotal:    c.line_subtotal,
        line_total:       c.line_total,
        sort_order:       i,
        tax_category:     'standard',
      } as DebitNoteItemInsert;
    });
  }

  const saveMutation = useMutation({
    mutationFn: async () => {
      const header = {
        company_id:       company_id!,
        debit_note_number: isNew ? await getAdapter().debitNotes.getNextNumber(company_id!) : existing!.debit_note_number,
        supplier_id:      supplierId,
        linked_bill_id:   linkedBillId || undefined,
        date,
        reason:           reason as 'return' | 'rebate' | 'price_correction' | 'damage',
        currency:         companyCurrency,
        exchange_rate:    1,
        subtotal:         totals.subtotal,
        discount_amount:  totals.discount,
        tax_amount:       totals.tax,
        total_amount:     totals.total,
        notes:            notes || undefined,
        status:           'draft' as const,
      };
      if (isNew) {
        return getAdapter().debitNotes.create(header, buildItems());
      } else {
        return getAdapter().debitNotes.update(id!, header, buildItems());
      }
    },
    onSuccess: async () => {
      await invalidateBooks();
      qc.invalidateQueries({ queryKey: ['debit_notes'] });
      navigate('/purchasing/debit-notes');
    },
  });

  const confirmMutation = useMutation({
    mutationFn: () => getAdapter().debitNotes.confirm(id!),
    onSuccess: async () => {
      await invalidateBooks();
      qc.invalidateQueries({ queryKey: ['debit_notes'] });
      qc.invalidateQueries({ queryKey: ['debit_note', id] });
    },
  });

  const voidMutation = useMutation({
    mutationFn: () => getAdapter().debitNotes.void(id!, voidReason || undefined),
    onSuccess: async () => {
      await invalidateBooks();
      qc.invalidateQueries({ queryKey: ['debit_notes'] });
      qc.invalidateQueries({ queryKey: ['debit_note', id] });
      setShowVoidDlg(false);
    },
  });

  const isDraft     = !existing || existing.status === 'draft';
  const isConfirmed = existing?.status === 'confirmed';

  // Phase 14.04 — view-mode renderer (Signature template).
  if (viewMode && !isNew && existing) {
    const linkedBill = existing.linked_bill_id
      ? bills.find(b => b.id === existing.linked_bill_id)
      : null;
    const doc = debitNoteToDocumentData({
      debitNote: existing,
      items: existingItems,
      supplier: suppliers.find(s => s.id === existing.supplier_id) ?? null,
      company: companyRow ?? null,
      products,
      linkedBillNumber: linkedBill?.bill_number ?? null,
    });
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: '16px', paddingBottom: '32px' }}>
        <div
          data-no-print="true"
          style={{ display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap' }}
        >
          <button onClick={() => navigate('/purchasing/debit-notes')} style={{
            background: 'transparent', border: 'none', cursor: 'pointer',
            fontSize: '13px', color: '#64748b',
          }}>← {t('returns.debit_notes_title') || 'Debit Notes'}</button>
          <span style={{ color: '#94a3b8' }}>/</span>
          <h1 style={{ margin: 0, fontSize: '20px', fontWeight: 700, color: '#1e293b', letterSpacing: '-.01em' }}>
            {existing.debit_note_number}
          </h1>
          <span style={{
            display: 'inline-block', padding: '3px 9px', borderRadius: '999px',
            fontSize: '11px', fontWeight: 600, textTransform: 'capitalize',
            background: '#f1f5f9', color: '#64748b', border: '1px solid #e2e8f0',
          }}>{existing.status}</span>
          <div style={{ marginInlineStart: 'auto', display: 'flex', gap: '8px' }}>
            {isDraft && (
              <Button variant="primary" onClick={() => setViewMode(false)}>
                ✎ {t('common.edit') || 'Edit'}
              </Button>
            )}
            {existing?.id && (
              <Button variant="ghost" onClick={() => window.print()}>
                🖨 {t('print.print') || 'Print'}
              </Button>
            )}
          </div>
        </div>
        <div className="signature-canvas" style={{ borderRadius: '12px', overflow: 'auto' }}>
          <ConfigurableDocTemplate data={doc} template={printTemplate} />
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6 max-w-5xl">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-ink-primary">
          {isNew ? t('returns.new_debit_note') : `${t('returns.dn_number')}: ${existing?.debit_note_number}`}
        </h1>
        <div className="flex gap-2">
          {!isNew && existing && (
            <Button variant="ghost" onClick={() => setViewMode(true)}>
              {t('common.view') || 'View'}
            </Button>
          )}
          {!isNew && existing?.id && (
            <Button variant="ghost" onClick={() => window.open(`/print/debit-note/${existing.id}`, '_blank')}>
              🖨 {t('print.print')}
            </Button>
          )}
          {!isNew && isConfirmed && (
            <Button variant="secondary" onClick={() => setShowVoidDlg(true)}>{t('common.void')}</Button>
          )}
          {!isNew && isDraft && (
            <Button variant="primary" onClick={() => confirmMutation.mutate()} disabled={confirmMutation.isPending}>
              {t('common.confirm')}
            </Button>
          )}
          {isDraft && (
            <Button variant="primary" onClick={() => saveMutation.mutate()} disabled={saveMutation.isPending}>
              {t('common.save')}
            </Button>
          )}
        </div>
      </div>

      <div className="glass-card p-6 grid grid-cols-2 gap-4">
        <div>
          <label className="block text-sm font-medium text-ink-secondary mb-1">{t('common.supplier')} *</label>
          <SearchableSelect
            options={suppliers.map((s) => ({ value: s.id, label: s.name }))}
            value={supplierId}
            disabled={!isDraft}
            onChange={(v) => setSupplierId(v)}
            placeholder={`— ${t('common.select')} —`}
            panelWidth={320}
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-ink-secondary mb-1">{t('returns.linked_bill')}</label>
          <div className="flex gap-2">
            <select
              value={linkedBillId}
              onChange={e => setLinkedBillId(e.target.value)}
              disabled={!isDraft}
              className="flex-1 border border-border-strong rounded px-3 py-2 text-sm"
            >
              <option value="">— {t('returns.no_linked_bill')} —</option>
              {bills.filter(b => !supplierId || b.supplier_id === supplierId).map(b => (
                <option key={b.id} value={b.id}>{b.bill_number} ({b.date})</option>
              ))}
            </select>
            {isDraft && linkedBillId && billItems.length > 0 && (
              <Button variant="secondary" onClick={importFromBill}>{t('returns.import_lines')}</Button>
            )}
          </div>
        </div>

        <div>
          <label className="block text-sm font-medium text-ink-secondary mb-1">{t('common.date')} *</label>
          <input type="date" value={date} onChange={e => setDate(e.target.value)} disabled={!isDraft}
            className="w-full border border-border-strong rounded px-3 py-2 text-sm" />
        </div>

        <div>
          <label className="block text-sm font-medium text-ink-secondary mb-1">{t('returns.reason')}</label>
          <select value={reason} onChange={e => setReason(e.target.value)} disabled={!isDraft}
            className="w-full border border-border-strong rounded px-3 py-2 text-sm">
            <option value="return">{t('returns.reason_return')}</option>
            <option value="rebate">{t('returns.reason_rebate')}</option>
            <option value="price_correction">{t('returns.reason_price_correction')}</option>
            <option value="damage">{t('returns.reason_damage')}</option>
          </select>
        </div>

        <div className="col-span-2">
          <label className="block text-sm font-medium text-ink-secondary mb-1">{t('common.notes')}</label>
          <input type="text" value={notes} onChange={e => setNotes(e.target.value)} disabled={!isDraft}
            className="w-full border border-border-strong rounded px-3 py-2 text-sm" />
        </div>
      </div>

      {/* Line items */}
      <div className="glass-card overflow-hidden">
        <div className="flex items-center justify-between px-4 py-3 border-b border-border-subtle">
          <h2 className="text-sm font-semibold text-ink-primary">{t('returns.line_items')}</h2>
          {isDraft && <Button variant="secondary" onClick={addLine}>{t('returns.add_line')}</Button>}
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-surface-muted">
              <tr>
                <th className="px-3 py-2 text-left text-xs font-medium text-ink-tertiary">{t('common.description')}</th>
                <th className="px-3 py-2 text-right text-xs font-medium text-ink-tertiary">{t('common.qty')}</th>
                <th className="px-3 py-2 text-right text-xs font-medium text-ink-tertiary">{t('common.unit_cost')}</th>
                <th className="px-3 py-2 text-right text-xs font-medium text-ink-tertiary">{t('common.discount')} %</th>
                <th className="px-3 py-2 text-right text-xs font-medium text-ink-tertiary">{t('common.tax')} %</th>
                <th className="px-3 py-2 text-right text-xs font-medium text-ink-tertiary">{t('common.total')}</th>
                {isDraft && <th className="px-3 py-2" />}
              </tr>
            </thead>
            <tbody className="divide-y divide-border-subtle">
              {lines.map((l, i) => {
                const c = calcLine(l);
                return (
                  <tr key={i}>
                    <td className="px-3 py-2">
                      <input value={l.description} onChange={e => updateLine(i, 'description', e.target.value)}
                        disabled={!isDraft} className="w-full border border-border-strong rounded px-2 py-1 text-sm" />
                    </td>
                    <td className="px-3 py-2">
                      <input type="number" min="1" step="1" value={l.quantity}
                        onChange={e => updateLine(i, 'quantity', Number(e.target.value))}
                        disabled={!isDraft} className="w-24 border border-border-strong rounded px-2 py-1 text-sm text-right" />
                    </td>
                    <td className="px-3 py-2">
                      <input type="number" min="0" step="0.01" value={l.unit_cost}
                        onChange={e => updateLine(i, 'unit_cost', Number(e.target.value))}
                        disabled={!isDraft} className="w-28 border border-border-strong rounded px-2 py-1 text-sm text-right" />
                    </td>
                    <td className="px-3 py-2">
                      <input type="number" min="0" max="100" step="0.1" value={l.discount_percent}
                        onChange={e => updateLine(i, 'discount_percent', Number(e.target.value))}
                        disabled={!isDraft} className="w-20 border border-border-strong rounded px-2 py-1 text-sm text-right" />
                    </td>
                    <td className="px-3 py-2">
                      <input type="number" min="0" max="100" step="0.1" value={l.tax_rate}
                        onChange={e => updateLine(i, 'tax_rate', Number(e.target.value))}
                        disabled={!isDraft} className="w-20 border border-border-strong rounded px-2 py-1 text-sm text-right" />
                    </td>
                    <td className="px-3 py-2 text-right font-semibold text-ink-secondary">{fmt(c.line_total)}</td>
                    {isDraft && (
                      <td className="px-3 py-2">
                        <button onClick={() => removeLine(i)} className="text-red-400 hover:text-red-600 text-xs">✕</button>
                      </td>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
          {lines.length === 0 && (
            <p className="text-center text-ink-tertiary py-6 text-sm">{t('returns.no_lines_yet')}</p>
          )}
        </div>
        <div className="flex justify-end px-4 py-3 border-t border-border-subtle gap-6 text-sm">
          <span className="text-ink-tertiary">{t('common.subtotal')}: <strong>{fmt(totals.subtotal - totals.discount)}</strong></span>
          <span className="text-ink-tertiary">{t('common.tax')}: <strong>{fmt(totals.tax)}</strong></span>
          <span className="text-ink-primary font-bold">{t('common.total')}: {fmt(totals.total)}</span>
        </div>
      </div>

      {saveMutation.isError && (
        <p className="text-red-600 text-sm">{String((saveMutation.error as Error).message)}</p>
      )}
      {confirmMutation.isError && (
        <p className="text-red-600 text-sm">{String((confirmMutation.error as Error).message)}</p>
      )}

      {/* Void dialog */}
      {showVoidDlg && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg p-6 shadow-xl w-96 space-y-4">
            <h3 className="font-semibold text-ink-primary">{t('common.void_confirm')}</h3>
            <input
              value={voidReason}
              onChange={e => setVoidReason(e.target.value)}
              placeholder={t('common.void_reason')}
              className="w-full border border-border-strong rounded px-3 py-2 text-sm"
            />
            <div className="flex justify-end gap-2">
              <Button variant="secondary" onClick={() => setShowVoidDlg(false)}>{t('common.cancel')}</Button>
              <Button variant="primary" onClick={() => voidMutation.mutate()} disabled={voidMutation.isPending}>
                {t('common.void')}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
