import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { getAdapter } from '@/data/index';
import { useAuthStore } from '@/store/auth';
import { useInvalidateBooks } from '@/hooks/use-invalidate-books';
import { useCompanyCurrency, useCompanyCountry, useCompanyRoundingStep } from '@/hooks/use-company-currency';
import { applyRoundOff } from '@/core/sales/invoice-calc';
import { defaultTaxRate } from '@/lib/locale';
import { Button } from '@/ui/button';
import { BackButton } from '@/ui/back-button';
import { SearchableSelect } from '@/ui/searchable-select';
// Phase 14.04 — Signature template view mode for saved credit notes.
import { ConfigurableDocTemplate } from '@/modules/print/engine/ConfigurableDocTemplate';
import { useResolvedPrintTemplate } from '@/hooks/use-resolved-print-template';
import { creditNoteToDocumentData } from '@/modules/print/_signature/adapters';
import { RefundDueBanner } from '@/components/refund-due-banner';
import { RefundedBadge, RefundedPill } from '@/components/refunded-badge';
import '@/modules/print/_signature/print.css';
import type { CreditNoteRow, CreditNoteItemInsert, CreditNoteItemRow, ContactRow, InvoiceRow, InvoiceItemRow, Company, ProductRow, ReturnableLine, WarehouseRow } from '@/data/adapter';

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
  /** Z1 — the invoice line this came back from. Set only when the note is
   *  raised against an invoice; a standalone rebate or goodwill credit has
   *  no source line and leaves it null. v_invoice_line_returnable counts
   *  these, so it is what stops the same goods being credited twice. */
  invoice_item_id:  string | null;
  /** How much of that invoice line is still returnable — display + input
   *  cap. 0 when there is no source line, which means uncapped. */
  qty_returnable:   number;
  /** R4a — damaged goods come back into stock and are then written off.
   *  Only meaningful when the note restocks. */
  condition:        'resellable' | 'damaged';
  /** P3 — where these goods physically go. Null = the note's warehouse. */
  restock_warehouse_id: string | null;
}

/** Every new line starts here, so a field added above cannot be forgotten. */
const BLANK_RETURN_FIELDS = {
  invoice_item_id: null,
  qty_returnable: 0,
  condition: 'resellable' as const,
  restock_warehouse_id: null,
};

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
  const companyCountry  = useCompanyCountry();      // Phase 21 — new lines default to country tax rate
  const { company_id } = useAuthStore();

  // Header state
  const [contactId,    setContactId]    = useState('');
  const [linkedInvId,  setLinkedInvId]  = useState('');
  const [date,         setDate]         = useState(today());
  const [reason,       setReason]       = useState<string>('return');
  const [restock,      setRestock]      = useState(true);
  const [notes,        setNotes]        = useState('');
  // R4b — kept out of the credit, entered inclusive of tax.
  const [restockingFee, setRestockingFee] = useState(0);
  // Phase 46 — null = automatic rounding from Settings; a string = manual.
  const [roundOffOverride, setRoundOffOverride] = useState<string | null>(null);
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
      setRestockingFee(Number(existing.restocking_fee ?? 0));
      // Freeze the stored round-off on edit; "Auto" re-rounds on demand.
      setRoundOffOverride(String(Number((existing as { round_off_amount?: number }).round_off_amount ?? 0)));
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
        invoice_item_id:  it.invoice_item_id ?? null,
        // A saved line has already consumed its own quantity, so add it back
        // to show what this note may still claim.
        qty_returnable:   Number(it.quantity),
        condition:        (it.condition ?? 'resellable') as 'resellable' | 'damaged',
        restock_warehouse_id: it.restock_warehouse_id ?? null,
      })));
    }
  }, [existingItems]);

  // When linked invoice changes, offer to import its items
  const { data: invItems = [] } = useQuery<InvoiceItemRow[]>({
    queryKey: ['invoice_items_for_cn', linkedInvId],
    queryFn:  () => getAdapter().invoices.getItems(linkedInvId),
    enabled:  !!linkedInvId,
  });

  // Z1 — what is still returnable per line, from the same view the confirm-—
  // time guard reads, so the screen and the server always agree.
  const { data: returnable = [] } = useQuery<ReturnableLine[]>({
    queryKey: ['returnable_lines', linkedInvId],
    queryFn:  () => getAdapter().creditNotes.getReturnableLines(linkedInvId),
    enabled:  !!linkedInvId,
  });
  const returnableById = new Map(returnable.map(r => [r.invoice_item_id, r]));

  const { data: warehouses = [] } = useQuery<WarehouseRow[]>({
    queryKey: ['warehouses', company_id],
    queryFn: () => getAdapter().warehouses.list(company_id!),
    enabled: !!company_id,
  });

  // Another note already raised against this invoice. The returnable view
  // counts CONFIRMED notes only — correct for the over-return guard, but it
  // means two DRAFTS each believe the full quantity is still available, and
  // nothing catches that until the second is confirmed. A warning, not a
  // block: crediting two lines of an invoice on separate days is ordinary.
  const { data: allNotes = [] } = useQuery<CreditNoteRow[]>({
    queryKey: ['credit_notes', company_id],
    queryFn: () => getAdapter().creditNotes.list(company_id!),
    enabled: !!company_id,
  });
  const siblingNotes = allNotes.filter(n =>
    n.linked_invoice_id === linkedInvId && n.id !== existing?.id && n.status !== 'void');

  // R4b — the fee is INCLUSIVE of tax at the rate of the invoice's
  // highest-value line, which is how the posting engine splits it too: one
  // side rounded, the other derived by subtraction so the two always sum to
  // the fee. A preview — the server recomputes and is authoritative.
  const feeTaxRate = [...invItems]
    .sort((a, b) => Number(b.line_total ?? 0) - Number(a.line_total ?? 0)
                 || Number(a.sort_order ?? 0) - Number(b.sort_order ?? 0))
    .map(it => Number(it.tax_rate ?? 0))[0] ?? 0;
  const feeNet = feeTaxRate > 0
    ? Math.round((restockingFee / (1 + feeTaxRate / 100)) * 100) / 100
    : restockingFee;
  const feeVat = Math.round((restockingFee - feeNet) * 100) / 100;

  // Z1 — import each invoice LINE at what is still RETURNABLE, not at the
  // full original quantity, and skip lines already fully credited. Before
  // this it pulled every line at full qty, so a second note could re-credit
  // goods that had already come back — the confirm guard would refuse it, but
  // only after the operator had filled the whole form in.
  function importFromInvoice() {
    if (invItems.length === 0) return;
    setLines(invItems.map(it => {
      const left = Number(returnableById.get(it.id)?.qty_returnable ?? it.quantity);
      return {
        product_id:       it.product_id ?? null,
        description:      it.description ?? '',
        quantity:         left,
        unit_price:       Number(it.unit_price),
        discount_percent: Number(it.discount_percent),
        tax_rate:         Number(it.tax_rate ?? 0),
        cost_at_sale:     it.cost_at_sale !== undefined ? Number(it.cost_at_sale) : null,
        ...BLANK_RETURN_FIELDS,
        invoice_item_id:  it.id,
        qty_returnable:   left,
      };
    }).filter(l => l.qty_returnable > 0));
  }

  function addLine() {
    // A hand-typed line names no invoice line, so it is uncapped and cannot
    // be counted against what was sold — which is correct for a rebate or a
    // goodwill credit, the cases that have no goods behind them at all.
    setLines(prev => [...prev, { product_id: null, description: '', quantity: 1, unit_price: 0, discount_percent: 0, tax_rate: defaultTaxRate(companyCountry), cost_at_sale: null, ...BLANK_RETURN_FIELDS }]);
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
  // Phase 46 — round the credit total like invoices, so refunds match what
  // the customer actually paid on a rounded invoice. Auto from Settings;
  // typing a value (±1.00) overrides it manually.
  const roundingStep = useCompanyRoundingStep();
  const autoRoundOff = applyRoundOff(totals.total, roundingStep).round_off;
  const roundOff     = roundOffOverride !== null
    ? Math.max(-1, Math.min(1, parseFloat(roundOffOverride) || 0))
    : autoRoundOff;
  const roundedTotal = +(totals.total + roundOff).toFixed(2);

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
        invoice_item_id: l.invoice_item_id,
        condition:       l.condition,
        restock_warehouse_id: l.restock_warehouse_id,
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
        // Inherit the salesperson from the linked invoice so returns reduce
        // the right person's commission base (Sales by Salesperson report).
        salesperson_id:    (linkedInvId ? invoices.find(i => i.id === linkedInvId)?.salesperson_id : existing?.salesperson_id) ?? undefined,
        date,
        reason:            reason as 'return' | 'rebate' | 'price_correction' | 'damage' | 'bad_debt',
        restock,
        currency:          companyCurrency,
        exchange_rate:     1,
        subtotal:          totals.subtotal,
        discount_amount:   totals.discount,
        tax_amount:        totals.tax,
        ...(roundOff !== 0 ? { round_off_amount: +roundOff.toFixed(2) } : {}),
        total_amount:      +roundedTotal.toFixed(2),
        notes:             notes || undefined,
        restocking_fee:    restockingFee || 0,
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

  // Phase 34 — Edit a CONFIRMED note: reverse the posting + reopen as a draft.
  const reopenMutation = useMutation({
    mutationFn: () => getAdapter().creditNotes.reopen(id!),
    onSuccess: async () => {
      await invalidateBooks();
      qc.invalidateQueries({ queryKey: ['credit_notes'] });
      qc.invalidateQueries({ queryKey: ['credit_note', id] });
      setViewMode(false);
    },
  });

  const isDraft     = !existing || existing.status === 'draft';
  const isConfirmed = existing?.status === 'confirmed';

  // Phase 14.04 — view-mode renderer (Signature template).
  // Drafts open in the editable form (single Save posts them); only posted
  // credit notes show the read-only template view.
  if (viewMode && !isNew && existing && existing.status !== 'draft') {
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
      <div className="signature-print-scope" style={{ display: 'flex', flexDirection: 'column', gap: '16px', paddingBottom: '32px' }}>
        <div
          data-print-hide
          style={{ display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap' }}
        >
          <BackButton to="/sales/credit-notes" label={t('returns.credit_notes_title') || 'Credit Notes'} />
          <h1 style={{ margin: 0, fontSize: '20px', fontWeight: 700, color: '#1e293b', letterSpacing: '-.01em' }}>
            {existing.credit_note_number}
          </h1>
          <span style={{
            display: 'inline-block', padding: '3px 9px', borderRadius: '999px',
            fontSize: '11px', fontWeight: 600, textTransform: 'capitalize',
            background: '#f1f5f9', color: '#64748b', border: '1px solid #e2e8f0',
          }}>{existing.status}</span>
          {/* Z5b — confirmed AND refunded are two different facts. The green
              bar below gives the amount and the payment number; this is the
              at-a-glance version, next to the status it qualifies. */}
          <RefundedPill docType="credit_note" docId={existing.id} />
          <div style={{ marginInlineStart: 'auto', display: 'flex', gap: '8px' }}>
            {isConfirmed && (
              <Button variant="primary" loading={reopenMutation.isPending} onClick={() => { if (window.confirm(t('common.reopen_warn') || 'Edit this confirmed document? It reverses its posted entries and reopens it as a draft so you can change it and confirm again.')) reopenMutation.mutate(); }}>
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
        {/* The document that actually puts the credit on 1200. A note raised
            with no return behind it is the commonest way a customer ends up
            in credit, so the refund belongs here too. The banner reads the ledger, so it shows only when the
            party's NET position is in their favour, and never prints. */}
        <div data-print-hide>
          <RefundDueBanner
            side="customer"
            sourceDoc={{ type: 'credit_note', id: existing.id }}
            contactId={existing.contact_id}
            currency={existing.currency ?? undefined}
          />
        </div>
        {/* Z5 — the answer to "was this refunded?", read from the refund
            itself rather than guessed from the contact and the date. */}
        <RefundedBadge docType="credit_note" docId={existing.id}
          currency={existing.currency ?? companyCurrency} />
        <div className="signature-canvas" style={{ borderRadius: '12px', overflow: 'auto' }}>
          <ConfigurableDocTemplate data={doc} template={printTemplate} />
        </div>
      </div>
    );
  }

  // Z1 added condition + restock-to, taking the line table to ten columns.
  // max-w-5xl clipped the last one against a card with overflow-hidden on
  // the return editor, which is how the remove button went missing there.
  // Wider page, and remove moved to the first column below.
  return (
    <div className="space-y-6 max-w-6xl">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-ink-primary">
          {isNew ? t('returns.new_credit_note') : `${t('returns.cn_number')}: ${existing?.credit_note_number}`}
        </h1>
        <div className="flex gap-2">
          {!isNew && existing && existing.status !== 'draft' && (
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

        {/* R4b — a charge kept OUT of the credit. The note still reverses the
            sale in full; this is clawed back separately, so the customer's
            net position is the credit MINUS this. */}
        <div>
          <label className="block text-sm font-medium text-ink-secondary mb-1">
            {t('returns.restocking_fee')}
          </label>
          <input type="number" min="0" step="0.01" value={restockingFee || ''}
            placeholder="0.00"
            onChange={e => setRestockingFee(Number(e.target.value) || 0)}
            disabled={!isDraft}
            className="w-full border border-border-strong rounded px-3 py-2 text-sm text-right" />
          {restockingFee > 0 && (
            <p className="mt-1 text-xs text-ink-tertiary">
              {feeTaxRate > 0
                ? t('returns.fee_split', { net: fmt(feeNet), vat: fmt(feeVat), rate: feeTaxRate })
                : t('returns.fee_no_tax', { net: fmt(feeNet) })}
            </p>
          )}
          <p className="mt-1 text-xs text-ink-tertiary">{t('returns.restocking_fee_hint')}</p>
        </div>
      </div>

      {/* Z1 — the returnable view counts CONFIRMED notes only, so two drafts
          against one invoice each believe the full quantity is available.
          Nothing catches that until the second is confirmed. */}
      {isDraft && linkedInvId && siblingNotes.length > 0 && (
        <div className="rounded-card border border-warning-500/40 bg-warning-500/10 px-4 py-2 text-sm text-ink-secondary">
          {t('returns.already_credited', {
            list: siblingNotes.map(n => `${n.credit_note_number} (${n.status})`).join(', '),
          })}
        </div>
      )}

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
                {isDraft && <th className="w-8 px-2 py-2" />}
                <th className="px-3 py-2 text-left text-xs font-medium text-ink-tertiary">{t('common.description')}</th>
                <th className="px-3 py-2 text-right text-xs font-medium text-ink-tertiary">{t('common.qty')}</th>
                <th className="px-3 py-2 text-right text-xs font-medium text-ink-tertiary">{t('common.unit_price')}</th>
                <th className="px-3 py-2 text-right text-xs font-medium text-ink-tertiary">{t('common.discount')} %</th>
                <th className="px-3 py-2 text-right text-xs font-medium text-ink-tertiary">{t('common.tax')} %</th>
                {restock && <th className="px-3 py-2 text-right text-xs font-medium text-ink-tertiary">{t('returns.cost_at_sale')}</th>}
                {restock && <th className="px-3 py-2 text-left text-xs font-medium text-ink-tertiary">{t('returns.condition')}</th>}
                {restock && <th className="px-3 py-2 text-left text-xs font-medium text-ink-tertiary">{t('returns.restock_to')}</th>}
                <th className="px-3 py-2 text-right text-xs font-medium text-ink-tertiary">{t('common.total')}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border-subtle">
              {lines.map((l, i) => {
                const c = calcLine(l);
                return (
                  <tr key={i}>
                    {isDraft && (
                      <td className="w-8 px-2 py-2 align-middle">
                        <button onClick={() => removeLine(i)}
                          className="text-red-400 hover:text-red-600 text-xs">✕</button>
                      </td>
                    )}
                    <td className="px-3 py-2">
                      <input value={l.description} onChange={e => updateLine(i, 'description', e.target.value)}
                        disabled={!isDraft} className="w-full border border-border-strong rounded px-2 py-1 text-sm" />
                    </td>
                    <td className="px-3 py-2">
                      {/* Capped only when the line names an invoice line. A
                          standalone credit has nothing to cap against. The
                          server enforces the same ceiling, so a stale figure
                          here cannot over-credit. */}
                      <input type="number" min="0" step="0.001" value={l.quantity}
                        max={l.invoice_item_id ? l.qty_returnable : undefined}
                        onChange={e => {
                          const v = Number(e.target.value);
                          updateLine(i, 'quantity', l.invoice_item_id
                            ? Math.min(Math.max(v, 0), l.qty_returnable) : v);
                        }}
                        disabled={!isDraft} className="w-24 border border-border-strong rounded px-2 py-1 text-sm text-right" />
                      {l.invoice_item_id && (
                        <span className="mt-0.5 block text-[10px] text-ink-tertiary">
                          {t('returns.of_returnable', { qty: l.qty_returnable })}
                        </span>
                      )}
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
                    {restock && (
                      <td className="px-3 py-2">
                        <select value={l.condition}
                          onChange={e => updateLine(i, 'condition', e.target.value as 'resellable' | 'damaged')}
                          disabled={!isDraft}
                          className="w-32 border border-border-strong rounded px-2 py-1 text-sm">
                          <option value="resellable">{t('returns.resellable')}</option>
                          <option value="damaged">{t('returns.damaged')}</option>
                        </select>
                      </td>
                    )}
                    {restock && (
                      <td className="px-3 py-2">
                        <select value={l.restock_warehouse_id ?? ''}
                          onChange={e => updateLine(i, 'restock_warehouse_id', e.target.value || null)}
                          disabled={!isDraft}
                          className="w-40 border border-border-strong rounded px-2 py-1 text-sm">
                          <option value="">{t('returns.warehouse_default')}</option>
                          {warehouses.map(w => (
                            <option key={w.id} value={w.id}>{w.name}</option>
                          ))}
                        </select>
                      </td>
                    )}
                    <td className="px-3 py-2 text-right font-semibold text-ink-secondary">{fmt(c.line_total)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <div className="flex justify-end px-4 py-3 border-t border-border-subtle gap-6 text-sm">
          <span className="text-ink-tertiary">{t('common.subtotal')}: <strong>{fmt(totals.subtotal - totals.discount)}</strong></span>
          <span className="text-ink-tertiary">{t('common.tax')}: <strong>{fmt(totals.tax)}</strong></span>
          <span className="flex items-center gap-2 text-ink-secondary">
            {t('sales.round_off')}:
            <input
              type="number" step="0.01" min="-1" max="1"
              value={roundOffOverride !== null ? roundOffOverride : String(roundOff)}
              onChange={e => setRoundOffOverride(e.target.value)}
              title="Automatic from Settings; type a value (±1.00) to round manually"
              className="h-7 w-24 rounded border border-border-subtle px-2 text-end font-mono text-sm"
            />
            {roundOffOverride !== null && (
              <button type="button" onClick={() => setRoundOffOverride(null)}
                title="Return to automatic rounding from Settings → Company Settings"
                className="rounded-full border border-border-subtle px-2 py-0.5 text-[10px] font-semibold text-brand-600 hover:bg-brand-50">
                {t('sales.round_off_auto')}
              </button>
            )}
          </span>
          <span className="text-ink-primary font-bold">{t('common.total')}: {fmt(roundedTotal)}</span>
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
