import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { getAdapter } from '@/data/index';
import { useAuthStore } from '@/store/auth';
import { useInvalidateBooks } from '@/hooks/use-invalidate-books';
import { Button } from '@/ui/button';
import { BackButton } from '@/ui/back-button';
import { SearchableSelect } from '@/ui/searchable-select';
// Phase 14.04 — Signature template view mode for saved sales returns.
import { ConfigurableDocTemplate } from '@/modules/print/engine/ConfigurableDocTemplate';
import { useResolvedPrintTemplate } from '@/hooks/use-resolved-print-template';
import { salesReturnToDocumentData } from '@/modules/print/_signature/adapters';
import '@/modules/print/_signature/print.css';
import type { SalesReturnRow, SalesReturnItemRow, InvoiceRow, InvoiceItemRow, SalesReturnItemInsert, Company, ProductRow, ContactRow, ReturnableLine, WarehouseRow } from '@/data/adapter';
import { computeReturnLine, sumReturnLines } from '@/lib/return-line-math';

const today = () => new Date().toISOString().slice(0, 10);

interface ReturnLine {
  /** R2b — the invoice line this came from. confirm_sales_return refuses a
   *  line without it: price, returned-to-date and "was this even sold?" all
   *  depend on knowing the source line, not just the product. */
  invoice_item_id:     string | null;
  product_id:          string | null;
  description:         string;
  qty_returned:        number;
  condition:           'resellable' | 'damaged';
  unit_cost:           number | null;
  /** How much of that line is still returnable — display + input cap. The
   *  server enforces the same number, so a stale figure cannot over-return. */
  qty_returnable:      number;
  /** P3 — where these goods physically go back. Null means the document's
   *  warehouse, which is what every return did before phase 83. Price and tax
   *  are deliberately NOT held here: they belong to the invoice line and are
   *  read from it at render, so the screen cannot drift from the credit note. */
  restock_warehouse_id: string | null;
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
  // R4b — kept out of the credit, entered inclusive of tax.
  const [restockingFee, setRestockingFee] = useState(0);
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
      setRestockingFee(Number(existing.restocking_fee ?? 0));
    }
  }, [existing]);

  useEffect(() => {
    if (existingItems.length > 0) {
      setLines(existingItems.map(it => ({
        // R2b — a saved row may predate phase 72 and carry no link. It stays
        // null so the confirm guard surfaces it rather than the UI hiding it.
        invoice_item_id: (it as { invoice_item_id?: string | null }).invoice_item_id ?? null,
        product_id:   it.product_id ?? null,
        description:  '',
        qty_returned: Number(it.qty_returned),
        condition:    (it.condition ?? 'resellable') as 'resellable' | 'damaged',
        unit_cost:    it.unit_cost !== undefined ? Number(it.unit_cost) : null,
        restock_warehouse_id: (it as { restock_warehouse_id?: string | null }).restock_warehouse_id ?? null,
        // Already-saved lines consumed their own quantity, so add it back to
        // show what this return may still claim.
        qty_returnable: Number(it.qty_returned),
      })));
    }
  }, [existingItems]);

  // Load invoice items for import
  const { data: invItems = [] } = useQuery<InvoiceItemRow[]>({
    queryKey: ['invoice_items_for_sr', invoiceId],
    queryFn:  () => getAdapter().invoices.getItems(invoiceId),
    enabled:  !!invoiceId,
  });

  // R2b — what is still returnable per line, straight from the same view the
  // confirm-time guard reads, so the screen and the server always agree.
  const { data: returnable = [] } = useQuery<ReturnableLine[]>({
    queryKey: ['returnable_lines', invoiceId],
    queryFn:  () => getAdapter().salesReturns.getReturnableLines(invoiceId),
    enabled:  !!invoiceId,
  });
  const returnableById = new Map(returnable.map(r => [r.invoice_item_id, r]));

  const { data: warehouses = [] } = useQuery<WarehouseRow[]>({
    queryKey: ['warehouses', company_id],
    queryFn: () => getAdapter().warehouses.list(company_id!),
    enabled: !!company_id,
  });

  // P1 — price and tax come from the INVOICE line, never from the return line
  // and never from an operator. You credit back the tax you charged; offering a
  // choice here would let someone bill 5% and credit 0%. Read at render so the
  // figures cannot drift from what confirm_sales_return will post.
  const invItemById = new Map(invItems.map(it => [it.id, it]));
  const lineValue = (l: ReturnLine) => {
    const src = l.invoice_item_id ? invItemById.get(l.invoice_item_id) : undefined;
    return {
      src,
      ...computeReturnLine({
        unit_value:       Number(src?.unit_price ?? 0),
        quantity:         l.qty_returned,
        discount_percent: Number(src?.discount_percent ?? 0),
        tax_rate:         Number(src?.tax_rate ?? 0),
      }),
    };
  };
  const docTotal = sumReturnLines(lines.map(l => {
    const src = l.invoice_item_id ? invItemById.get(l.invoice_item_id) : undefined;
    return {
      unit_value:       Number(src?.unit_price ?? 0),
      quantity:         l.qty_returned,
      discount_percent: Number(src?.discount_percent ?? 0),
      tax_rate:         Number(src?.tax_rate ?? 0),
    };
  }));

  // R4b — the fee is INCLUSIVE of tax at the rate of the invoice's
  // highest-value line, which is how post_sales_return_fee splits it too: one
  // side rounded, the other derived by subtraction so the two always sum to
  // the fee. This is a preview — the server recomputes and is authoritative.
  const feeTaxRate = [...invItems]
    .sort((a, b) => Number(b.line_total ?? 0) - Number(a.line_total ?? 0)
                 || Number(a.sort_order ?? 0) - Number(b.sort_order ?? 0))
    .map(it => Number(it.tax_rate ?? 0))[0] ?? 0;
  const feeNet = feeTaxRate > 0
    ? Math.round((restockingFee / (1 + feeTaxRate / 100)) * 100) / 100
    : restockingFee;
  const feeVat = Math.round((restockingFee - feeNet) * 100) / 100;

  // R2b — import each invoice LINE (not each product), defaulting to what is
  // still returnable rather than the full original quantity, and skipping
  // lines already fully returned. Previously this pulled every line at full
  // qty, so a second return could re-credit goods that had already come back.
  function importFromInvoice() {
    if (invItems.length === 0) return;
    setLines(invItems
      .filter(it => it.product_id)
      .map(it => ({
        invoice_item_id: it.id,
        product_id:      it.product_id!,
        description:     it.description ?? '',
        qty_returned:    Number(returnableById.get(it.id)?.qty_returnable ?? it.quantity),
        condition:       'resellable' as const,
        unit_cost:       it.cost_at_sale !== undefined ? Number(it.cost_at_sale) : null,
        qty_returnable:  Number(returnableById.get(it.id)?.qty_returnable ?? it.quantity),
        restock_warehouse_id: null,
      }))
      .filter(l => l.qty_returnable > 0));
  }

  // R2b — "Add line" is gone. A hand-typed line cannot name a source invoice
  // line, so it could not be priced, counted, or proven to have been sold —
  // confirm_sales_return now refuses it. Returns come from the invoice.
  function removeLine(i: number) {
    setLines(prev => prev.filter((_, idx) => idx !== i));
  }
  function updateLine<K extends keyof ReturnLine>(i: number, key: K, val: ReturnLine[K]) {
    setLines(prev => prev.map((l, idx) => idx === i ? { ...l, [key]: val } : l));
  }

  const saveMutation = useMutation({
    mutationFn: async () => {
      const items: SalesReturnItemInsert[] = lines.map(l => ({
        invoice_item_id:     l.invoice_item_id,   // R2b
        product_id:          l.product_id ?? undefined,
        qty_returned:        l.qty_returned,
        condition:           l.condition,
        unit_cost:           l.unit_cost ?? undefined,
        restock_warehouse_id: l.restock_warehouse_id,   // P3
      } as SalesReturnItemInsert));
      // R6b — must stay in step with sales_returns_reason_check (phase 79).
      // R5 branched before those codes existed and hoisted this cast with the
      // old four-value union; narrowing it back would make update() reject
      // damaged_in_transit, ordered_in_error and warranty.
      const reasonValue = reason as 'wrong_part' | 'defective' | 'customer_changed_mind'
                                  | 'damaged_in_transit' | 'ordered_in_error' | 'warranty' | 'other';

      // R5 — a saved draft is UPDATED, never re-created. This branch did not
      // exist: every save called create() with a freshly minted return_number,
      // so editing a saved draft produced a SECOND sales return and left the
      // first one behind holding its old values. Anything with an :id in the
      // URL takes this path unconditionally — falling through to create()
      // because the row had not arrived yet is exactly the old bug.
      if (!isNew) {
        if (!existing) {
          throw new Error('The return is still loading. Try again in a moment.');
        }
        if (existing.status !== 'draft') {
          throw new Error('Only draft returns can be edited. Re-open a confirmed return first.');
        }
        await getAdapter().salesReturns.update(existing.id, {
          invoice_id: invoiceId,
          date,
          reason:     reasonValue,
          // null, not undefined: an omitted key leaves the stored value alone,
          // so clearing the notes has to be said out loud.
          notes:      notes || null,
          // R4b — same reasoning as on create: the key is sent only when there
          // is something to say about the fee, because restocking_fee is a
          // phase-77 column and PostgREST rejects it outright until that
          // migration is applied. A fee already on the row proves the column
          // exists, so clearing it back to 0 is safe to send.
          ...(restockingFee > 0 || Number(existing.restocking_fee ?? 0) > 0
            ? { restocking_fee: restockingFee }
            : {}),
        }, items);
        return existing;
      }

      const header = {
        company_id:   company_id!,
        return_number: await getAdapter().salesReturns.getNextNumber(company_id!),
        invoice_id:   invoiceId,
        date,
        reason:       reasonValue,
        notes:        notes || undefined,
        // R4b — the key is OMITTED when there is no fee, not sent as 0.
        // Code ships before migrations are hand-applied, and PostgREST rejects
        // an unknown column outright: sending it unconditionally would break
        // every sales return created in the window before phase77 lands.
        ...(restockingFee > 0 ? { restocking_fee: restockingFee } : {}),
        status:       'draft' as const,
      };
      return getAdapter().salesReturns.create(header, items);
    },
    onSuccess: async (sr) => {
      await invalidateBooks();
      qc.invalidateQueries({ queryKey: ['sales_returns'] });
      // R5 — an edit stays on the document it edited. Only a brand-new return
      // goes on to the credit note screen; sending an edit there would invite a
      // second credit note for goods already accounted for.
      if (!isNew) {
        qc.invalidateQueries({ queryKey: ['sales_return', id] });
        qc.invalidateQueries({ queryKey: ['sales_return_items', id] });
        setViewMode(true);
        return;
      }
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
          <BackButton to="/sales/returns" label={t('returns.sales_returns_title') || 'Sales Returns'} />
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
            <Button variant="primary" onClick={() => saveMutation.mutate()} disabled={saveMutation.isPending || !invoiceId || lines.length === 0 || (!isNew && !existing)}>
              {/* R5 — only a new return goes on to the credit note screen, so
                  only a new return promises to. */}
              {isNew ? t('returns.save_and_create_cn') : t('common.save')}
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
            {/* R6b — ordered_in_error is not the same as changing your mind, and
                the difference decides whether a restocking fee applies. */}
            <option value="ordered_in_error">{t('returns.ordered_in_error')}</option>
            <option value="damaged_in_transit">{t('returns.damaged_in_transit')}</option>
            <option value="warranty">{t('returns.warranty')}</option>
            <option value="other">{t('returns.other')}</option>
          </select>
        </div>

        <div>
          <label className="block text-sm font-medium text-ink-secondary mb-1">{t('common.notes')}</label>
          <input type="text" value={notes} onChange={e => setNotes(e.target.value)} disabled={!isDraft}
            className="w-full border border-border-strong rounded px-3 py-2 text-sm" />
        </div>

        {/* R4b — a fee kept out of the credit. The credit note still reverses
            the sale in full, because that is what happened; this claws part
            of it back as Other Income, so revenue, gross margin and the VAT
            return all stay right. R5 — editable for as long as the return is a
            draft, like every other header field: saving one now updates it
            instead of minting a second return. */}
        <div>
          <label className="block text-sm font-medium text-ink-secondary mb-1">{t('returns.restocking_fee')}</label>
          <input
            type="number" min="0" step="0.01" placeholder="0.00"
            value={restockingFee || ''}
            onChange={e => setRestockingFee(e.target.value ? Number(e.target.value) : 0)}
            disabled={!isDraft}
            className="w-full border border-border-strong rounded px-3 py-2 text-sm" />
          {restockingFee > 0 ? (
            <p className="mt-1 text-xs text-ink-tertiary">
              {feeTaxRate > 0
                ? t('returns.fee_split', { net: feeNet.toFixed(2), vat: feeVat.toFixed(2), rate: feeTaxRate })
                : t('returns.fee_no_tax', { net: feeNet.toFixed(2) })}
            </p>
          ) : (
            <p className="mt-1 text-xs text-ink-tertiary">{t('returns.restocking_fee_hint')}</p>
          )}
        </div>
      </div>

      {/* Line items */}
      <div className="glass-card overflow-hidden">
        <div className="flex items-center justify-between px-4 py-3 border-b border-border-subtle">
          <h2 className="text-sm font-semibold text-ink-primary">{t('returns.returned_items')}</h2>
          {isDraft && invoiceId && lines.length === 0 && invItems.length > 0 && (
            <span className="text-xs text-ink-tertiary">{t('returns.use_import')}</span>
          )}
        </div>
        <table className="w-full text-sm">
          <thead className="bg-surface-muted">
            <tr>
              <th className="px-3 py-2 text-left text-xs font-medium text-ink-tertiary">{t('common.description')}</th>
              <th className="px-3 py-2 text-right text-xs font-medium text-ink-tertiary">{t('returns.returnable')}</th>
              <th className="px-3 py-2 text-right text-xs font-medium text-ink-tertiary">{t('returns.qty_returned')}</th>
              <th className="px-3 py-2 text-left text-xs font-medium text-ink-tertiary">{t('returns.condition')}</th>
              {/* P3 — where the goods physically land. Blank = the document's warehouse. */}
              <th className="px-3 py-2 text-left text-xs font-medium text-ink-tertiary">{t('returns.restock_to')}</th>
              {/* P1 — what the CUSTOMER gets back. Read-only: taken from the
                  invoice line, because you credit the tax you charged. */}
              <th className="px-3 py-2 text-right text-xs font-medium text-ink-tertiary">{t('returns.unit_price')}</th>
              <th className="px-3 py-2 text-right text-xs font-medium text-ink-tertiary">{t('returns.tax_pct')}</th>
              <th className="px-3 py-2 text-right text-xs font-medium text-ink-tertiary">{t('returns.credit_amount')}</th>
              <th className="px-3 py-2 text-right text-xs font-medium text-ink-tertiary">{t('returns.cost_at_sale')}</th>
              {isDraft && <th className="px-3 py-2" />}
            </tr>
          </thead>
          <tbody className="divide-y divide-border-subtle">
            {lines.map((l, i) => (
              <tr key={i}>
                {/* R1 — read-only. sales_return_items has no description column,
                    so anything typed here was silently discarded on save, and
                    confirm_sales_return uses the INVOICE line's description for
                    the credit note regardless. Showing it as editable was a lie.
                    Free-text commentary belongs in the return's Notes field. */}
                <td className="px-3 py-2 text-ink-secondary">
                  {l.description || <span className="text-ink-tertiary">—</span>}
                </td>
                <td className="px-3 py-2 text-right text-xs text-ink-secondary">
                  {l.qty_returnable}
                </td>
                <td className="px-3 py-2">
                  <input type="number" min="1" step="1" max={l.qty_returnable || undefined}
                    value={l.qty_returned}
                    onChange={e => updateLine(i, 'qty_returned', Number(e.target.value))}
                    disabled={!isDraft}
                    className={`w-24 border rounded px-2 py-1 text-sm text-right ${
                      l.qty_returned > l.qty_returnable
                        ? 'border-danger-500 text-danger-600'
                        : 'border-border-strong'}`} />
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
                  <select value={l.restock_warehouse_id ?? ''}
                    onChange={e => updateLine(i, 'restock_warehouse_id', e.target.value || null)}
                    disabled={!isDraft} className="border border-border-strong rounded px-2 py-1 text-sm">
                    <option value="">{t('returns.warehouse_default')}</option>
                    {warehouses.map(w => <option key={w.id} value={w.id}>{w.name}</option>)}
                  </select>
                </td>
                {(() => { const v = lineValue(l); return (<>
                  <td className="px-3 py-2 text-right text-sm text-ink-secondary tabular-nums">
                    {v.src ? Number(v.src.unit_price).toFixed(2) : '—'}
                  </td>
                  <td className="px-3 py-2 text-right text-sm text-ink-secondary tabular-nums">
                    {v.src?.tax_rate ? `${Number(v.src.tax_rate)}%` : '—'}
                  </td>
                  <td className="px-3 py-2 text-right text-sm font-medium text-ink-primary tabular-nums">
                    {v.line_total.toFixed(2)}
                  </td>
                </>); })()}
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
          {lines.length > 0 && (
            <tfoot>
              {/* P1 — the credit this return will raise, computed exactly as
                  confirm_sales_return computes it. The restocking fee is NOT
                  netted here: it posts as a separate charge, so the customer
                  receives this total minus the fee. */}
              <tr className="border-t-2 border-border-strong bg-surface-muted">
                <td className="px-3 py-2 text-xs font-semibold text-ink-primary" colSpan={5}>
                  {t('returns.credit_total')}
                </td>
                <td className="px-3 py-2 text-right text-xs text-ink-secondary tabular-nums">
                  {t('returns.tax_pct')}
                </td>
                <td className="px-3 py-2 text-right text-xs text-ink-secondary tabular-nums">
                  {docTotal.tax_amount.toFixed(2)}
                </td>
                <td className="px-3 py-2 text-right text-sm font-semibold text-ink-primary tabular-nums">
                  {docTotal.line_total.toFixed(2)}
                </td>
                {isDraft && <td />}
              </tr>
            </tfoot>
          )}
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
