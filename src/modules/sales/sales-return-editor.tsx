import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { getAdapter } from '@/data/index';
import { useAuthStore } from '@/store/auth';
import { useInvalidateBooks } from '@/hooks/use-invalidate-books';
import { Button } from '@/ui/button';
import { SearchableSelect } from '@/ui/searchable-select';
// Phase 14.04 — Signature template view mode for saved sales returns.
import { ConfigurableDocTemplate } from '@/modules/print/engine/ConfigurableDocTemplate';
import { useResolvedPrintTemplate } from '@/hooks/use-resolved-print-template';
import { salesReturnToDocumentData } from '@/modules/print/_signature/adapters';
import '@/modules/print/_signature/print.css';
import type { SalesReturnRow, SalesReturnItemRow, InvoiceRow, InvoiceItemRow, SalesReturnItemInsert, Company, ProductRow, ContactRow } from '@/data/adapter';

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
  const printTemplate = useResolvedPrintTemplate('credit_note');
  const qc          = useQueryClient();
  const invalidateBooks = useInvalidateBooks();   // Phase 14.14k
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

  const { data: existingItems = [] } = useQuery<SalesReturnItemRow[]>({
    queryKey: ['sales_return_items', id],
    queryFn:  () => getAdapter().salesReturns.getItems(id!),
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
  const { data: customers = [] } = useQuery<ContactRow[]>({
    queryKey: ['contacts', company_id, 'customer'],
    queryFn:  () => getAdapter().contacts.list(company_id!, 'customer'),
    enabled:  !!company_id,
  });

  // Phase 14.04 — view-first mode for saved sales returns.
  const [viewMode, setViewMode] = useState(!isNew);

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
    onSuccess: async (sr) => {
      await invalidateBooks();
      qc.invalidateQueries({ queryKey: ['sales_returns'] });
      // Navigate to linked credit note creation if wanted
      navigate(`/sales/credit-notes/new?from_return=${sr?.id ?? ''}&invoice_id=${invoiceId}`);
    },
  });

  // Phase 33 — confirm posts the return through the credit-note engine
  // (restock + credit the customer); void reverses it.
  const confirmMutation = useMutation({
    mutationFn: () => getAdapter().salesReturns.confirm(id!),
    onSuccess: async () => {
      await invalidateBooks();
      qc.invalidateQueries({ queryKey: ['sales_return', id] });
      qc.invalidateQueries({ queryKey: ['sales_returns'] });
      qc.invalidateQueries({ queryKey: ['credit_notes'] });
    },
  });
  const voidMutation = useMutation({
    mutationFn: () => getAdapter().salesReturns.void(id!),
    onSuccess: async () => {
      await invalidateBooks();
      qc.invalidateQueries({ queryKey: ['sales_return', id] });
      qc.invalidateQueries({ queryKey: ['sales_returns'] });
      qc.invalidateQueries({ queryKey: ['credit_notes'] });
    },
  });
  // Phase 34 — Edit a confirmed return: void its credit note + reopen as a draft.
  const reopenMutation = useMutation({
    mutationFn: () => getAdapter().salesReturns.reopen(id!),
    onSuccess: async () => {
      await invalidateBooks();
      qc.invalidateQueries({ queryKey: ['sales_return', id] });
      qc.invalidateQueries({ queryKey: ['sales_returns'] });
      qc.invalidateQueries({ queryKey: ['credit_notes'] });
      setViewMode(false);
    },
  });

  const isDraft = !existing || existing.status === 'draft';

  // Phase 14.04 — view-mode renderer (Signature template).
  if (viewMode && !isNew && existing) {
    const linkedInv = invoices.find(i => i.id === existing.invoice_id) ?? null;
    const customer  = linkedInv ? customers.find(c => c.id === linkedInv.contact_id) ?? null : null;
    const doc = salesReturnToDocumentData({
      salesReturn: existing,
      items: existingItems,
      contact: customer,
      company: companyRow ?? null,
      products,
      linkedInvoiceNumber: linkedInv?.invoice_number ?? null,
    });
    return (
      <div className="signature-print-scope" style={{ display: 'flex', flexDirection: 'column', gap: '16px', paddingBottom: '32px' }}>
        <div
          data-print-hide
          style={{ display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap' }}
        >
          <button onClick={() => navigate('/sales/returns')} style={{
            background: 'transparent', border: 'none', cursor: 'pointer',
            fontSize: '13px', color: '#64748b',
          }}>← {t('returns.sales_returns_title') || 'Sales Returns'}</button>
          <span style={{ color: '#94a3b8' }}>/</span>
          <h1 style={{ margin: 0, fontSize: '20px', fontWeight: 700, color: '#1e293b', letterSpacing: '-.01em' }}>
            {existing.return_number}
          </h1>
          <span style={{
            display: 'inline-block', padding: '3px 9px', borderRadius: '999px',
            fontSize: '11px', fontWeight: 600, textTransform: 'capitalize',
            background: '#f1f5f9', color: '#64748b', border: '1px solid #e2e8f0',
          }}>{existing.status}</span>
          <div style={{ marginInlineStart: 'auto', display: 'flex', gap: '8px' }}>
            {isDraft && existing?.id && (
              <Button
                variant="primary"
                loading={confirmMutation.isPending}
                onClick={() => { if (window.confirm(t('returns.confirm_post_warn') || 'Confirm this return? It restocks the goods and credits the customer (posts a linked credit note).')) confirmMutation.mutate(); }}
              >
                ✓ {t('returns.confirm') || 'Confirm'}
              </Button>
            )}
            {isDraft && (
              <Button variant="secondary" onClick={() => setViewMode(false)}>
                ✎ {t('common.edit') || 'Edit'}
              </Button>
            )}
            {existing?.status === 'confirmed' && (
              <Button
                variant="secondary"
                loading={reopenMutation.isPending}
                onClick={() => { if (window.confirm(t('common.reopen_warn') || 'Edit this confirmed return? It reverses the credit note (un-credits the customer, removes the restock) and reopens it as a draft to change and confirm again.')) reopenMutation.mutate(); }}
              >
                ✎ {t('common.edit') || 'Edit'}
              </Button>
            )}
            {existing?.status === 'confirmed' && (
              <Button
                variant="danger"
                loading={voidMutation.isPending}
                onClick={() => { if (window.confirm(t('returns.void_warn') || 'Void this return? It reverses the credit note — un-credits the customer and removes the restock.')) voidMutation.mutate(); }}
              >
                {t('common.void') || 'Void'}
              </Button>
            )}
            {existing?.id && (
              <Button variant="ghost" onClick={() => window.print()}>
                🖨 {t('print.print') || 'Print'}
              </Button>
            )}
          </div>
        </div>
        {(confirmMutation.error || voidMutation.error) && (
          <div data-print-hide style={{ color: '#b91c1c', fontSize: '13px', padding: '10px 14px', background: '#fef2f2', border: '1px solid #fecaca', borderRadius: '10px' }}>
            {String((confirmMutation.error as Error)?.message || (voidMutation.error as Error)?.message || confirmMutation.error || voidMutation.error)}
          </div>
        )}
        <div className="signature-canvas" style={{ borderRadius: '12px', overflow: 'auto' }}>
          <ConfigurableDocTemplate data={doc} template={printTemplate} />
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6 max-w-4xl">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-ink-primary">
          {isNew ? t('returns.new_return') : `${t('returns.return_number')}: ${existing?.return_number}`}
        </h1>
        <div className="flex gap-2">
          {!isNew && existing && (
            <Button variant="ghost" onClick={() => setViewMode(true)}>
              {t('common.view') || 'View'}
            </Button>
          )}
          {isDraft && (
            <Button variant="primary" onClick={() => saveMutation.mutate()} disabled={saveMutation.isPending || !invoiceId || lines.length === 0}>
              {t('returns.save_and_create_cn')}
            </Button>
          )}
        </div>
      </div>

      <div className="glass-card p-6 grid grid-cols-2 gap-4">
        <div>
          <label className="block text-sm font-medium text-ink-secondary mb-1">{t('returns.linked_invoice')} *</label>
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
          <label className="block text-sm font-medium text-ink-secondary mb-1">{t('common.date')} *</label>
          <input type="date" value={date} onChange={e => setDate(e.target.value)} disabled={!isDraft}
            className="w-full border border-border-strong rounded px-3 py-2 text-sm" />
        </div>

        <div>
          <label className="block text-sm font-medium text-ink-secondary mb-1">{t('returns.return_reason')}</label>
          <select value={reason} onChange={e => setReason(e.target.value)} disabled={!isDraft}
            className="w-full border border-border-strong rounded px-3 py-2 text-sm">
            <option value="wrong_part">{t('returns.wrong_part')}</option>
            <option value="defective">{t('returns.defective')}</option>
            <option value="customer_changed_mind">{t('returns.customer_changed_mind')}</option>
            <option value="other">{t('returns.other')}</option>
          </select>
        </div>

        <div>
          <label className="block text-sm font-medium text-ink-secondary mb-1">{t('common.notes')}</label>
          <input type="text" value={notes} onChange={e => setNotes(e.target.value)} disabled={!isDraft}
            className="w-full border border-border-strong rounded px-3 py-2 text-sm" />
        </div>
      </div>

      {/* Line items */}
      <div className="glass-card overflow-hidden">
        <div className="flex items-center justify-between px-4 py-3 border-b border-border-subtle">
          <h2 className="text-sm font-semibold text-ink-primary">{t('returns.returned_items')}</h2>
          {isDraft && <Button variant="secondary" onClick={addLine}>{t('returns.add_line')}</Button>}
        </div>
        <table className="w-full text-sm">
          <thead className="bg-surface-muted">
            <tr>
              <th className="px-3 py-2 text-left text-xs font-medium text-ink-tertiary">{t('common.description')}</th>
              <th className="px-3 py-2 text-right text-xs font-medium text-ink-tertiary">{t('returns.qty_returned')}</th>
              <th className="px-3 py-2 text-left text-xs font-medium text-ink-tertiary">{t('returns.condition')}</th>
              <th className="px-3 py-2 text-right text-xs font-medium text-ink-tertiary">{t('returns.cost_at_sale')}</th>
              {isDraft && <th className="px-3 py-2" />}
            </tr>
          </thead>
          <tbody className="divide-y divide-border-subtle">
            {lines.map((l, i) => (
              <tr key={i}>
                <td className="px-3 py-2">
                  <input value={l.description} onChange={e => updateLine(i, 'description', e.target.value)}
                    disabled={!isDraft} placeholder={t('common.description')}
                    className="w-full border border-border-strong rounded px-2 py-1 text-sm" />
                </td>
                <td className="px-3 py-2">
                  <input type="number" min="1" step="1" value={l.qty_returned}
                    onChange={e => updateLine(i, 'qty_returned', Number(e.target.value))}
                    disabled={!isDraft} className="w-24 border border-border-strong rounded px-2 py-1 text-sm text-right" />
                </td>
                <td className="px-3 py-2">
                  <select value={l.condition}
                    onChange={e => updateLine(i, 'condition', e.target.value as 'resellable' | 'damaged')}
                    disabled={!isDraft} className="border border-border-strong rounded px-2 py-1 text-sm">
                    <option value="resellable">{t('returns.resellable')}</option>
                    <option value="damaged">{t('returns.damaged')}</option>
                  </select>
                </td>
                <td className="px-3 py-2">
                  <input type="number" min="0" step="0.01" value={l.unit_cost ?? ''}
                    placeholder={t('returns.from_invoice')}
                    onChange={e => updateLine(i, 'unit_cost', e.target.value ? Number(e.target.value) : null)}
                    disabled={!isDraft} className="w-28 border border-border-strong rounded px-2 py-1 text-sm text-right" />
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
          <p className="text-center text-ink-tertiary py-6 text-sm">{t('returns.no_lines_yet')}</p>
        )}
      </div>

      {saveMutation.isError && (
        <p className="text-red-600 text-sm">{String((saveMutation.error as Error).message)}</p>
      )}
    </div>
  );
}
