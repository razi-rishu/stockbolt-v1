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
// Phase 14.04 — Signature template view mode for saved credit notes.
import { ConfigurableDocTemplate } from '@/modules/print/engine/ConfigurableDocTemplate';
import { useResolvedPrintTemplate } from '@/hooks/use-resolved-print-template';
import { creditNoteToDocumentData } from '@/modules/print/_signature/adapters';
import '@/modules/print/_signature/print.css';
import type { CreditNoteRow, CreditNoteItemInsert, CreditNoteItemRow, ContactRow, InvoiceRow, InvoiceItemRow, Company, ProductRow } from '@/data/adapter';

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
  const printTemplate = useResolvedPrintTemplate('credit_note');
  const qc          = useQueryClient();
  const invalidateBooks = useInvalidateBooks();   // Phase 14.14k
  const companyCurrency = useCompanyCurrency();    // Phase 14.14m
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
  const { data: existingItems = [] } = useQuery<CreditNoteItemRow[]>({
    queryKey: ['credit_note_items', id],
    queryFn:  () => getAdapter().creditNotes.getItems(id!),
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

  // Phase 14.04 — view-first mode (saved credit notes open in template view).
  const [viewMode, setViewMode] = useState(!isNew);

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
        currency:          companyCurrency,
        exchange_rate:     1,
        subtotal:          totals.subtotal,
        discount_amount:   totals.discount,
        tax_amount:        totals.tax,
        total_amount:      totals.total,
        notes:             notes || undefined,
        status:            'draft' as const,
      };
      // Save = persist the draft then immediately post it (single-step).
      let noteId: string;
      if (isNew) {
        const created = await getAdapter().creditNotes.create(header, buildItems());
        noteId = created.id;
      } else {
        await getAdapter().creditNotes.update(id!, header, buildItems());
        noteId = id!;
      }
      try {
        await getAdapter().creditNotes.confirm(noteId);
      } catch (e) {
        if (isNew) navigate(`/sales/credit-notes/${noteId}`);
        throw e;
      }
      return noteId;
    },
    onSuccess: async () => {
      await invalidateBooks();
      qc.invalidateQueries({ queryKey: ['credit_notes'] });
      navigate('/sales/credit-notes');
    },
  });

  const voidMutation = useMutation({
    mutationFn: () => getAdapter().creditNotes.void(id!, voidReason || undefined),
    onSuccess: async () => {
      await invalidateBooks();
      qc.invalidateQueries({ queryKey: ['credit_notes'] });
      qc.invalidateQueries({ queryKey: ['credit_note', id] });
      setShowVoidDlg(false);
    },
  });

  const isDraft     = !existing || existing.status === 'draft';
  const isConfirmed = existing?.status === 'confirmed';

  // Phase 14.04 — view-mode renderer (Signature template).
  if (viewMode && !isNew && existing) {
    const linkedInv = existing.linked_invoice_id
      ? invoices.find(i => i.id === existing.linked_invoice_id)
      : null;
    const doc = creditNoteToDocumentData({
      creditNote: existing,
      items: existingItems,
      contact: contacts.find(c => c.id === existing.contact_id) ?? null,
      company: companyRow ?? null,
      products,
      linkedInvoiceNumber: linkedInv?.invoice_number ?? null,
    });
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: '16px', paddingBottom: '32px' }}>
        <div
          data-no-print="true"
          style={{ display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap' }}
        >
          <button onClick={() => navigate('/sales/credit-notes')} style={{
            background: 'transparent', border: 'none', cursor: 'pointer',
            fontSize: '13px', color: '#64748b',
          }}>← {t('returns.credit_notes_title') || 'Credit Notes'}</button>
          <span style={{ color: '#94a3b8' }}>/</span>
          <h1 style={{ margin: 0, fontSize: '20px', fontWeight: 700, color: '#1e293b', letterSpacing: '-.01em' }}>
            {existing.credit_note_number}
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
          {isNew ? t('returns.new_credit_note') : `${t('returns.cn_number')}: ${existing?.credit_note_number}`}
        </h1>
        <div className="flex gap-2">
          {!isNew && existing && (
            <Button variant="ghost" onClick={() => setViewMode(true)}>
              {t('common.view') || 'View'}
            </Button>
          )}
          {!isNew && existing?.id && (
            <Button variant="ghost" onClick={() => window.open(`/print/credit-note/${existing.id}`, '_blank')}>
              🖨 {t('print.print')}
            </Button>
          )}
          {!isNew && isConfirmed && (
            <Button variant="secondary" onClick={() => setShowVoidDlg(true)}>{t('common.void')}</Button>
          )}
          {isDraft && (
            <Button variant="primary" onClick={() => saveMutation.mutate()} disabled={saveMutation.isPending}>
              {saveMutation.isPending ? t('common.saving') : t('common.save')}
            </Button>
          )}
        </div>
      </div>

      {/* Header fields */}
      <div className="glass-card p-6 grid grid-cols-2 gap-4">
        <div>
          <label className="block text-sm font-medium text-ink-secondary mb-1">{t('common.customer')} *</label>
          <SearchableSelect
            options={contacts.map((c) => ({ value: c.id, label: c.name }))}
            value={contactId}
            disabled={!isDraft}
            onChange={(v) => setContactId(v)}
            placeholder={`— ${t('common.select')} —`}
            panelWidth={320}
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-ink-secondary mb-1">{t('returns.linked_invoice')}</label>
          <div className="flex gap-2">
            <select
              value={linkedInvId}
              onChange={e => setLinkedInvId(e.target.value)}
              disabled={!isDraft}
              className="flex-1 border border-border-strong rounded px-3 py-2 text-sm"
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

        <div className="flex items-center gap-3">
          <input type="checkbox" id="restock" checked={restock} onChange={e => setRestock(e.target.checked)} disabled={!isDraft}
            className="h-4 w-4 rounded border-border-strong text-brand-600" />
          <label htmlFor="restock" className="text-sm font-medium text-ink-secondary">
            {t('returns.restock_inventory')}
          </label>
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
          <h2 className="text-sm font-semibold text-ink-primary">{t('returns.line_items')}</h2>
          {isDraft && <Button variant="secondary" onClick={addLine}>{t('returns.add_line')}</Button>}
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-surface-muted">
              <tr>
                <th className="px-3 py-2 text-left text-xs font-medium text-ink-tertiary">{t('common.description')}</th>
                <th className="px-3 py-2 text-right text-xs font-medium text-ink-tertiary">{t('common.qty')}</th>
                <th className="px-3 py-2 text-right text-xs font-medium text-ink-tertiary">{t('common.unit_price')}</th>
                <th className="px-3 py-2 text-right text-xs font-medium text-ink-tertiary">{t('common.discount')} %</th>
                <th className="px-3 py-2 text-right text-xs font-medium text-ink-tertiary">{t('common.tax')} %</th>
                {restock && <th className="px-3 py-2 text-right text-xs font-medium text-ink-tertiary">{t('returns.cost_at_sale')}</th>}
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
                      <input type="number" min="0" step="0.01" value={l.unit_price}
                        onChange={e => updateLine(i, 'unit_price', Number(e.target.value))}
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
                    {restock && (
                      <td className="px-3 py-2">
                        <input type="number" min="0" step="0.01" value={l.cost_at_sale ?? ''}
                          placeholder={t('returns.cost_at_sale_hint')}
                          onChange={e => updateLine(i, 'cost_at_sale', e.target.value ? Number(e.target.value) : null)}
                          disabled={!isDraft} className="w-28 border border-border-strong rounded px-2 py-1 text-sm text-right" />
                      </td>
                    )}
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
