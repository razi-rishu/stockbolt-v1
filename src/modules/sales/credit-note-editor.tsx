import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { getAdapter } from '@/data/index';
import { useAuthStore } from '@/store/auth';
import { Button } from '@/ui/button';
import type { CreditNoteRow, CreditNoteItemInsert, ContactRow, InvoiceRow, InvoiceItemRow } from '@/data/adapter';

const today = () => new Date().toISOString().slice(0, 10);
const fmt   = (n: number) => n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

interface LineItem {
  product_id:       string | null;
  description:      string;
  quantity:         number;
  unit_price:       number;
  discount_percent: number;
  tax_rate:         number;
  cost_at_sale:     number | null;
}

function calcLine(l: LineItem) {
  const sub   = l.quantity * l.unit_price;
  const disc  = Math.round(sub * (l.discount_percent / 100) * 100) / 100;
  const net   = sub - disc;
  const tax   = Math.round(net * (l.tax_rate / 100) * 100) / 100;
  return { line_subtotal: net, discount_amount: disc, tax_amount: tax, line_total: net + tax };
}

export default function CreditNoteEditorPage() {
  const { id }      = useParams<{ id: string }>();
  const isNew       = !id || id === 'new';
  const { t }       = useTranslation();
  const navigate    = useNavigate();
  const qc          = useQueryClient();
  const { company_id } = useAuthStore();

  // Header state
  const [contactId,    setContactId]    = useState('');
  const [linkedInvId,  setLinkedInvId]  = useState('');
  const [date,         setDate]         = useState(today());
  const [reason,       setReason]       = useState<string>('return');
  const [restock,      setRestock]      = useState(true);
  const [notes,        setNotes]        = useState('');
  const [lines,        setLines]        = useState<LineItem[]>([]);
  const [voidReason,   setVoidReason]   = useState('');
  const [showVoidDlg,  setShowVoidDlg]  = useState(false);

  // Remote data
  const { data: contacts = [] } = useQuery<ContactRow[]>({
    queryKey: ['contacts', company_id, 'customer'],
    queryFn:  () => getAdapter().contacts.list(company_id!, 'customer'),
    enabled:  !!company_id,
  });
  const { data: invoices = [] } = useQuery<InvoiceRow[]>({
    queryKey: ['invoices_confirmed', company_id],
    queryFn:  () => getAdapter().invoices.list(company_id!, 'confirmed'),
    enabled:  !!company_id,
  });
  const { data: existing } = useQuery<CreditNoteRow | null>({
    queryKey: ['credit_note', id],
    queryFn:  () => getAdapter().creditNotes.getById(id!),
    enabled:  !isNew && !!id,
  });
  const { data: existingItems = [] } = useQuery({
    queryKey: ['credit_note_items', id],
    queryFn:  () => getAdapter().creditNotes.getItems(id!),
    enabled:  !isNew && !!id,
  });

  // Populate form from existing
  useEffect(() => {
    if (existing) {
      setContactId(existing.contact_id);
      setLinkedInvId(existing.linked_invoice_id ?? '');
      setDate(existing.date);
      setReason(existing.reason ?? 'return');
      setRestock(existing.restock);
      setNotes(existing.notes ?? '');
    }
  }, [existing]);
  useEffect(() => {
    if (existingItems.length > 0) {
      setLines(existingItems.map(it => ({
        product_id:       it.product_id ?? null,
        description:      it.description ?? '',
        quantity:         Number(it.quantity),
        unit_price:       Number(it.unit_price),
        discount_percent: Number(it.discount_percent),
        tax_rate:         Number(it.tax_rate ?? 0),
        cost_at_sale:     it.cost_at_sale !== undefined ? Number(it.cost_at_sale) : null,
      })));
    }
  }, [existingItems]);

  // When linked invoice changes, offer to import its items
  const { data: invItems = [] } = useQuery<InvoiceItemRow[]>({
    queryKey: ['invoice_items_for_cn', linkedInvId],
    queryFn:  () => getAdapter().invoices.getItems(linkedInvId),
    enabled:  !!linkedInvId,
  });

  function importFromInvoice() {
    if (invItems.length === 0) return;
    setLines(invItems.map(it => ({
      product_id:       it.product_id ?? null,
      description:      it.description ?? '',
      quantity:         Number(it.quantity),
      unit_price:       Number(it.unit_price),
      discount_percent: Number(it.discount_percent),
      tax_rate:         Number(it.tax_rate ?? 0),
      cost_at_sale:     it.cost_at_sale !== undefined ? Number(it.cost_at_sale) : null,
    })));
  }

  function addLine() {
    setLines(prev => [...prev, { product_id: null, description: '', quantity: 1, unit_price: 0, discount_percent: 0, tax_rate: 5, cost_at_sale: null }]);
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

  function buildItems(): CreditNoteItemInsert[] {
    return lines.map((l, i) => {
      const c = calcLine(l);
      return {
        product_id:      l.product_id ?? undefined,
        description:     l.description || undefined,
        quantity:        l.quantity,
        unit_price:      l.unit_price,
        discount_percent: l.discount_percent,
        discount_amount: c.discount_amount,
        tax_rate:        l.tax_rate,
        tax_amount:      c.tax_amount,
        line_subtotal:   c.line_subtotal,
        line_total:      c.line_total,
        sort_order:      i,
        cost_at_sale:    l.cost_at_sale ?? undefined,
        tax_category:    'standard',
      } as CreditNoteItemInsert;
    });
  }

  const saveMutation = useMutation({
    mutationFn: async () => {
      const header = {
        company_id:        company_id!,
        credit_note_number: isNew ? await getAdapter().creditNotes.getNextNumber(company_id!) : existing!.credit_note_number,
        contact_id:        contactId,
        linked_invoice_id: linkedInvId || undefined,
        date,
        reason:            reason as 'return' | 'rebate' | 'price_correction' | 'damage' | 'bad_debt',
        restock,
        currency:          'AED',
        exchange_rate:     1,
        subtotal:          totals.subtotal,
        discount_amount:   totals.discount,
        tax_amount:        totals.tax,
        total_amount:      totals.total,
        notes:             notes || undefined,
        status:            'draft' as const,
      };
      if (isNew) {
        return getAdapter().creditNotes.create(header, buildItems());
      } else {
        await getAdapter().creditNotes.update(id!, header, buildItems());
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['credit_notes'] });
      navigate('/sales/credit-notes');
    },
  });

  const confirmMutation = useMutation({
    mutationFn: () => getAdapter().creditNotes.confirm(id!),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['credit_notes'] });
      qc.invalidateQueries({ queryKey: ['credit_note', id] });
    },
  });

  const voidMutation = useMutation({
    mutationFn: () => getAdapter().creditNotes.void(id!, voidReason || undefined),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['credit_notes'] });
      qc.invalidateQueries({ queryKey: ['credit_note', id] });
      setShowVoidDlg(false);
    },
  });

  const isDraft     = !existing || existing.status === 'draft';
  const isConfirmed = existing?.status === 'confirmed';

  return (
    <div className="space-y-6 max-w-5xl">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-slate-800">
          {isNew ? t('returns.new_credit_note') : `${t('returns.cn_number')}: ${existing?.credit_note_number}`}
        </h1>
        <div className="flex gap-2">
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

      {/* Header fields */}
      <div className="bg-white border border-slate-200 rounded-lg p-6 grid grid-cols-2 gap-4">
        <div>
          <label className="block text-sm font-medium text-slate-700 mb-1">{t('common.customer')} *</label>
          <select
            value={contactId}
            onChange={e => setContactId(e.target.value)}
            disabled={!isDraft}
            className="w-full border border-slate-300 rounded px-3 py-2 text-sm"
          >
            <option value="">— {t('common.select')} —</option>
            {contacts.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </div>

        <div>
          <label className="block text-sm font-medium text-slate-700 mb-1">{t('returns.linked_invoice')}</label>
          <div className="flex gap-2">
            <select
              value={linkedInvId}
              onChange={e => setLinkedInvId(e.target.value)}
              disabled={!isDraft}
              className="flex-1 border border-slate-300 rounded px-3 py-2 text-sm"
            >
              <option value="">— {t('returns.no_linked_invoice')} —</option>
              {invoices.filter(inv => !contactId || inv.contact_id === contactId).map(inv => (
                <option key={inv.id} value={inv.id}>{inv.invoice_number} ({inv.date})</option>
              ))}
            </select>
            {isDraft && linkedInvId && invItems.length > 0 && (
              <Button variant="secondary" onClick={importFromInvoice}>{t('returns.import_lines')}</Button>
            )}
          </div>
        </div>

        <div>
          <label className="block text-sm font-medium text-slate-700 mb-1">{t('common.date')} *</label>
          <input type="date" value={date} onChange={e => setDate(e.target.value)} disabled={!isDraft}
            className="w-full border border-slate-300 rounded px-3 py-2 text-sm" />
        </div>

        <div>
          <label className="block text-sm font-medium text-slate-700 mb-1">{t('returns.reason')}</label>
          <select value={reason} onChange={e => setReason(e.target.value)} disabled={!isDraft}
            className="w-full border border-slate-300 rounded px-3 py-2 text-sm">
            <option value="return">{t('returns.reason_return')}</option>
            <option value="rebate">{t('returns.reason_rebate')}</option>
            <option value="price_correction">{t('returns.reason_price_correction')}</option>
            <option value="damage">{t('returns.reason_damage')}</option>
          </select>
        </div>

        <div className="flex items-center gap-3">
          <input type="checkbox" id="restock" checked={restock} onChange={e => setRestock(e.target.checked)} disabled={!isDraft}
            className="h-4 w-4 rounded border-slate-300 text-blue-600" />
          <label htmlFor="restock" className="text-sm font-medium text-slate-700">
            {t('returns.restock_inventory')}
          </label>
        </div>

        <div>
          <label className="block text-sm font-medium text-slate-700 mb-1">{t('common.notes')}</label>
          <input type="text" value={notes} onChange={e => setNotes(e.target.value)} disabled={!isDraft}
            className="w-full border border-slate-300 rounded px-3 py-2 text-sm" />
        </div>
      </div>

      {/* Line items */}
      <div className="bg-white border border-slate-200 rounded-lg overflow-hidden">
        <div className="flex items-center justify-between px-4 py-3 border-b border-slate-200">
          <h2 className="font-semibold text-slate-700">{t('returns.line_items')}</h2>
          {isDraft && <Button variant="secondary" onClick={addLine}>{t('returns.add_line')}</Button>}
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-50">
              <tr>
                <th className="px-3 py-2 text-left text-xs font-medium text-slate-500">{t('common.description')}</th>
                <th className="px-3 py-2 text-right text-xs font-medium text-slate-500">{t('common.qty')}</th>
                <th className="px-3 py-2 text-right text-xs font-medium text-slate-500">{t('common.unit_price')}</th>
                <th className="px-3 py-2 text-right text-xs font-medium text-slate-500">{t('common.discount')} %</th>
                <th className="px-3 py-2 text-right text-xs font-medium text-slate-500">{t('common.tax')} %</th>
                {restock && <th className="px-3 py-2 text-right text-xs font-medium text-slate-500">{t('returns.cost_at_sale')}</th>}
                <th className="px-3 py-2 text-right text-xs font-medium text-slate-500">{t('common.total')}</th>
                {isDraft && <th className="px-3 py-2" />}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {lines.map((l, i) => {
                const c = calcLine(l);
                return (
                  <tr key={i}>
                    <td className="px-3 py-2">
                      <input value={l.description} onChange={e => updateLine(i, 'description', e.target.value)}
                        disabled={!isDraft} className="w-full border border-slate-300 rounded px-2 py-1 text-sm" />
                    </td>
                    <td className="px-3 py-2">
                      <input type="number" min="0.001" step="0.001" value={l.quantity}
                        onChange={e => updateLine(i, 'quantity', Number(e.target.value))}
                        disabled={!isDraft} className="w-24 border border-slate-300 rounded px-2 py-1 text-sm text-right" />
                    </td>
                    <td className="px-3 py-2">
                      <input type="number" min="0" step="0.01" value={l.unit_price}
                        onChange={e => updateLine(i, 'unit_price', Number(e.target.value))}
                        disabled={!isDraft} className="w-28 border border-slate-300 rounded px-2 py-1 text-sm text-right" />
                    </td>
                    <td className="px-3 py-2">
                      <input type="number" min="0" max="100" step="0.1" value={l.discount_percent}
                        onChange={e => updateLine(i, 'discount_percent', Number(e.target.value))}
                        disabled={!isDraft} className="w-20 border border-slate-300 rounded px-2 py-1 text-sm text-right" />
                    </td>
                    <td className="px-3 py-2">
                      <input type="number" min="0" max="100" step="0.1" value={l.tax_rate}
                        onChange={e => updateLine(i, 'tax_rate', Number(e.target.value))}
                        disabled={!isDraft} className="w-20 border border-slate-300 rounded px-2 py-1 text-sm text-right" />
                    </td>
                    {restock && (
                      <td className="px-3 py-2">
                        <input type="number" min="0" step="0.01" value={l.cost_at_sale ?? ''}
                          placeholder={t('returns.cost_at_sale_hint')}
                          onChange={e => updateLine(i, 'cost_at_sale', e.target.value ? Number(e.target.value) : null)}
                          disabled={!isDraft} className="w-28 border border-slate-300 rounded px-2 py-1 text-sm text-right" />
                      </td>
                    )}
                    <td className="px-3 py-2 text-right font-semibold text-slate-700">{fmt(c.line_total)}</td>
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
        </div>
        <div className="flex justify-end px-4 py-3 border-t border-slate-200 gap-6 text-sm">
          <span className="text-slate-500">{t('common.subtotal')}: <strong>{fmt(totals.subtotal - totals.discount)}</strong></span>
          <span className="text-slate-500">{t('common.tax')}: <strong>{fmt(totals.tax)}</strong></span>
          <span className="text-slate-800 font-bold">{t('common.total')}: {fmt(totals.total)}</span>
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
            <h3 className="font-semibold text-slate-800">{t('common.void_confirm')}</h3>
            <input
              value={voidReason}
              onChange={e => setVoidReason(e.target.value)}
              placeholder={t('common.void_reason')}
              className="w-full border border-slate-300 rounded px-3 py-2 text-sm"
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
