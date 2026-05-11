import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { getAdapter } from '@/data/index';
import { useAuthStore } from '@/store/auth';
import { Button } from '@/ui/button';
import { SearchableSelect } from '@/ui/searchable-select';
import type { SalesReturnRow, InvoiceRow, InvoiceItemRow, SalesReturnItemInsert } from '@/data/adapter';

const today = () => new Date().toISOString().slice(0, 10);

interface ReturnLine {
  product_id:          string | null;
  description:         string;
  qty_returned:        number;
  condition:           'resellable' | 'damaged';
  unit_cost:           number | null;
}

export default function SalesReturnEditorPage() {
  const { id }      = useParams<{ id: string }>();
  const isNew       = !id || id === 'new';
  const { t }       = useTranslation();
  const navigate    = useNavigate();
  const qc          = useQueryClient();
  const { company_id } = useAuthStore();

  const [invoiceId,    setInvoiceId]    = useState('');
  const [date,         setDate]         = useState(today());
  const [reason,       setReason]       = useState('wrong_part');
  const [notes,        setNotes]        = useState('');
  const [lines,        setLines]        = useState<ReturnLine[]>([]);

  const { data: invoices = [] } = useQuery<InvoiceRow[]>({
    queryKey: ['invoices_confirmed', company_id],
    queryFn:  () => getAdapter().invoices.list(company_id!, 'confirmed'),
    enabled:  !!company_id,
  });

  const { data: existing } = useQuery<SalesReturnRow | null>({
    queryKey: ['sales_return', id],
    queryFn:  () => getAdapter().salesReturns.getById(id!),
    enabled:  !isNew && !!id,
  });

  const { data: existingItems = [] } = useQuery({
    queryKey: ['sales_return_items', id],
    queryFn:  () => getAdapter().salesReturns.getItems(id!),
    enabled:  !isNew && !!id,
  });

  useEffect(() => {
    if (existing) {
      setInvoiceId(existing.invoice_id);
      setDate(existing.date);
      setReason(existing.reason ?? 'wrong_part');
      setNotes(existing.notes ?? '');
    }
  }, [existing]);

  useEffect(() => {
    if (existingItems.length > 0) {
      setLines(existingItems.map(it => ({
        product_id:   it.product_id ?? null,
        description:  '',
        qty_returned: Number(it.qty_returned),
        condition:    (it.condition ?? 'resellable') as 'resellable' | 'damaged',
        unit_cost:    it.unit_cost !== undefined ? Number(it.unit_cost) : null,
      })));
    }
  }, [existingItems]);

  // Load invoice items for import
  const { data: invItems = [] } = useQuery<InvoiceItemRow[]>({
    queryKey: ['invoice_items_for_sr', invoiceId],
    queryFn:  () => getAdapter().invoices.getItems(invoiceId),
    enabled:  !!invoiceId,
  });

  function importFromInvoice() {
    if (invItems.length === 0) return;
    setLines(invItems
      .filter(it => it.product_id)
      .map(it => ({
        product_id:   it.product_id!,
        description:  it.description ?? '',
        qty_returned: Number(it.quantity),
        condition:    'resellable' as const,
        unit_cost:    it.cost_at_sale !== undefined ? Number(it.cost_at_sale) : null,
      })));
  }

  function addLine() {
    setLines(prev => [...prev, { product_id: null, description: '', qty_returned: 1, condition: 'resellable', unit_cost: null }]);
  }
  function removeLine(i: number) {
    setLines(prev => prev.filter((_, idx) => idx !== i));
  }
  function updateLine<K extends keyof ReturnLine>(i: number, key: K, val: ReturnLine[K]) {
    setLines(prev => prev.map((l, idx) => idx === i ? { ...l, [key]: val } : l));
  }

  const saveMutation = useMutation({
    mutationFn: async () => {
      const header = {
        company_id:   company_id!,
        return_number: await getAdapter().salesReturns.getNextNumber(company_id!),
        invoice_id:   invoiceId,
        date,
        reason:       reason as 'wrong_part' | 'defective' | 'customer_changed_mind' | 'other',
        notes:        notes || undefined,
        status:       'draft' as const,
      };
      const items: SalesReturnItemInsert[] = lines.map(l => ({
        product_id:          l.product_id ?? undefined,
        qty_returned:        l.qty_returned,
        condition:           l.condition,
        unit_cost:           l.unit_cost ?? undefined,
      } as SalesReturnItemInsert));
      return getAdapter().salesReturns.create(header, items);
    },
    onSuccess: (sr) => {
      qc.invalidateQueries({ queryKey: ['sales_returns'] });
      // Navigate to linked credit note creation if wanted
      navigate(`/sales/credit-notes/new?from_return=${sr?.id ?? ''}&invoice_id=${invoiceId}`);
    },
  });

  const isDraft = !existing || existing.status === 'draft';

  return (
    <div className="space-y-6 max-w-4xl">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-slate-800">
          {isNew ? t('returns.new_return') : `${t('returns.return_number')}: ${existing?.return_number}`}
        </h1>
        {isDraft && (
          <Button variant="primary" onClick={() => saveMutation.mutate()} disabled={saveMutation.isPending || !invoiceId || lines.length === 0}>
            {t('returns.save_and_create_cn')}
          </Button>
        )}
      </div>

      <div className="bg-white border border-slate-200 rounded-lg p-6 grid grid-cols-2 gap-4">
        <div>
          <label className="block text-sm font-medium text-slate-700 mb-1">{t('returns.linked_invoice')} *</label>
          <div className="flex gap-2">
            <div className="flex-1">
              <SearchableSelect
                options={invoices.map((inv) => ({ value: inv.id, label: `${inv.invoice_number} (${inv.date})` }))}
                value={invoiceId}
                disabled={!isDraft}
                onChange={(v) => setInvoiceId(v)}
                placeholder={`— ${t('common.select')} —`}
                panelWidth={360}
              />
            </div>
            {isDraft && invoiceId && invItems.length > 0 && (
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
          <label className="block text-sm font-medium text-slate-700 mb-1">{t('returns.return_reason')}</label>
          <select value={reason} onChange={e => setReason(e.target.value)} disabled={!isDraft}
            className="w-full border border-slate-300 rounded px-3 py-2 text-sm">
            <option value="wrong_part">{t('returns.wrong_part')}</option>
            <option value="defective">{t('returns.defective')}</option>
            <option value="customer_changed_mind">{t('returns.customer_changed_mind')}</option>
            <option value="other">{t('returns.other')}</option>
          </select>
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
          <h2 className="font-semibold text-slate-700">{t('returns.returned_items')}</h2>
          {isDraft && <Button variant="secondary" onClick={addLine}>{t('returns.add_line')}</Button>}
        </div>
        <table className="w-full text-sm">
          <thead className="bg-slate-50">
            <tr>
              <th className="px-3 py-2 text-left text-xs font-medium text-slate-500">{t('common.description')}</th>
              <th className="px-3 py-2 text-right text-xs font-medium text-slate-500">{t('returns.qty_returned')}</th>
              <th className="px-3 py-2 text-left text-xs font-medium text-slate-500">{t('returns.condition')}</th>
              <th className="px-3 py-2 text-right text-xs font-medium text-slate-500">{t('returns.cost_at_sale')}</th>
              {isDraft && <th className="px-3 py-2" />}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {lines.map((l, i) => (
              <tr key={i}>
                <td className="px-3 py-2">
                  <input value={l.description} onChange={e => updateLine(i, 'description', e.target.value)}
                    disabled={!isDraft} placeholder={t('common.description')}
                    className="w-full border border-slate-300 rounded px-2 py-1 text-sm" />
                </td>
                <td className="px-3 py-2">
                  <input type="number" min="0.001" step="0.001" value={l.qty_returned}
                    onChange={e => updateLine(i, 'qty_returned', Number(e.target.value))}
                    disabled={!isDraft} className="w-24 border border-slate-300 rounded px-2 py-1 text-sm text-right" />
                </td>
                <td className="px-3 py-2">
                  <select value={l.condition}
                    onChange={e => updateLine(i, 'condition', e.target.value as 'resellable' | 'damaged')}
                    disabled={!isDraft} className="border border-slate-300 rounded px-2 py-1 text-sm">
                    <option value="resellable">{t('returns.resellable')}</option>
                    <option value="damaged">{t('returns.damaged')}</option>
                  </select>
                </td>
                <td className="px-3 py-2">
                  <input type="number" min="0" step="0.01" value={l.unit_cost ?? ''}
                    placeholder={t('returns.from_invoice')}
                    onChange={e => updateLine(i, 'unit_cost', e.target.value ? Number(e.target.value) : null)}
                    disabled={!isDraft} className="w-28 border border-slate-300 rounded px-2 py-1 text-sm text-right" />
                </td>
                {isDraft && (
                  <td className="px-3 py-2">
                    <button onClick={() => removeLine(i)} className="text-red-400 hover:text-red-600 text-xs">✕</button>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
        {lines.length === 0 && (
          <p className="text-center text-slate-400 py-6 text-sm">{t('returns.no_lines_yet')}</p>
        )}
      </div>

      {saveMutation.isError && (
        <p className="text-red-600 text-sm">{String((saveMutation.error as Error).message)}</p>
      )}
    </div>
  );
}
