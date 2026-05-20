import { useState, useEffect, useCallback } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { useNavigate, useParams } from 'react-router-dom';
import { getAdapter } from '@/data/index';
import { useAuthStore } from '@/store/auth';
import { Button } from '@/ui/button';
import { Input } from '@/ui/input';
import { Select } from '@/ui/select';
import { Modal } from '@/ui/modal';
import { SearchableSelect } from '@/ui/searchable-select';
import { SmartEntitySearch, highlightMatch } from '@/components/smart-entity-search';
import { ContactPicker } from '@/components/contact-picker';
import { ProductQuickCreate } from '@/components/quick-create/product-quick-create';
import { AccountingPreview, buildSalesInvoicePreview } from '@/components/accounting-preview';
import type { InvoiceRow, InvoiceItemInsert, ContactRow, ProductRow, WarehouseRow, TaxRateRow, ProductSearchRow } from '@/data/adapter';
import { calcLine as _calcLine } from '@/core/sales/invoice-calc';

// ── Types ───────────────────────────────────────────────────────────────────

interface LineRow {
  _key: string;
  product_id: string | null;
  description: string;
  quantity: string;
  unit_price: string;
  discount_percent: string;
  tax_rate: string;
  // computed (display only)
  line_subtotal: number;
  discount_amount: number;
  tax_amount: number;
  line_total: number;
}

interface InvHeader {
  contact_id: string;
  salesperson_id: string;
  date: string;
  due_date: string;
  warehouse_id: string;
  reference: string;
  notes: string;
  currency: string;
}

// ── Helpers ─────────────────────────────────────────────────────────────────

let _keyCounter = 0;
function newKey() { return `k${++_keyCounter}`; }

function calcLine(l: LineRow) {
  return _calcLine({
    quantity:         parseFloat(l.quantity) || 0,
    unit_price:       parseFloat(l.unit_price) || 0,
    discount_percent: parseFloat(l.discount_percent) || 0,
    tax_rate:         parseFloat(l.tax_rate) || 0,
  });
}

function emptyLine(): LineRow {
  return { _key: newKey(), product_id: null, description: '', quantity: '1', unit_price: '0', discount_percent: '0', tax_rate: '0', line_subtotal: 0, discount_amount: 0, tax_amount: 0, line_total: 0 };
}

function fmt(n: number) {
  return n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

// ── Component ────────────────────────────────────────────────────────────────

export default function InvoiceEditorPage() {
  const { t } = useTranslation();
  const { company_id } = useAuthStore();
  const companyCurrency = 'AED';
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const isNew = id === 'new';

  // ── Reference data ───────────────────────────────────────────────────────
  const { data: contacts = [] } = useQuery<ContactRow[]>({
    queryKey: ['contacts', company_id, 'customer'],
    queryFn: () => getAdapter().contacts.list(company_id!, 'customer'),
    enabled: !!company_id,
  });
  const { data: warehouses = [] } = useQuery<WarehouseRow[]>({
    queryKey: ['warehouses', company_id],
    queryFn: () => getAdapter().warehouses.list(company_id!),
    enabled: !!company_id,
  });
  const { data: products = [] } = useQuery<ProductRow[]>({
    queryKey: ['products', company_id],
    queryFn: () => getAdapter().products.list(company_id!),
    enabled: !!company_id,
  });
  const { data: taxRates = [] } = useQuery<TaxRateRow[]>({
    queryKey: ['taxRates', company_id],
    queryFn: () => getAdapter().taxRates.list(company_id!),
    enabled: !!company_id,
  });
  // Salespeople — dedicated master table (Phase 12.16). Required field
  // below. Add/edit/deactivate names from Settings → Salespeople.
  const { data: salespeople = [] } = useQuery({
    queryKey: ['salespeople', company_id],
    queryFn: () => getAdapter().salespeople.list(company_id!),
    enabled: !!company_id,
  });

  // ── Existing invoice ─────────────────────────────────────────────────────
  const { data: existing } = useQuery<InvoiceRow | null>({
    queryKey: ['invoice', id],
    queryFn: () => getAdapter().invoices.getById(id!),
    enabled: !isNew && !!id,
  });
  const { data: existingItems = [] } = useQuery({
    queryKey: ['invoice_items', id],
    queryFn: () => getAdapter().invoices.getItems(id!),
    enabled: !isNew && !!id,
  });

  // ── Form state ───────────────────────────────────────────────────────────
  const defaultHeader: InvHeader = {
    contact_id: '',
    salesperson_id: '',
    date: todayIso(),
    due_date: '',
    warehouse_id: '',
    reference: '',
    notes: '',
    currency: companyCurrency ?? 'AED',
  };
  const [header, setHeader] = useState<InvHeader>(defaultHeader);
  const [lines, setLines] = useState<LineRow[]>([emptyLine()]);
  // Product Quick Create state — shared across all line pickers.
  // We remember which line opened the modal so onCreated updates THAT line.
  const [productQcOpen,    setProductQcOpen]    = useState(false);
  const [productQcSeed,    setProductQcSeed]    = useState('');
  const [productQcLineKey, setProductQcLineKey] = useState<string | null>(null);
  const [editMode, setEditMode] = useState(false);
  const [voidModal, setVoidModal] = useState(false);
  const [voidReason, setVoidReason] = useState('');
  const [error, setError] = useState<string | null>(null);

  // Populate form when existing invoice loads
  useEffect(() => {
    if (existing) {
      setHeader({
        contact_id:     existing.contact_id,
        salesperson_id: existing.salesperson_id ?? '',
        date:           existing.date as string,
        due_date:       (existing.due_date as string | null) ?? '',
        warehouse_id:   existing.warehouse_id ?? '',
        reference:      existing.reference ?? '',
        notes:          existing.notes ?? '',
        currency:       existing.currency,
      });
    }
  }, [existing]);

  useEffect(() => {
    if (existingItems.length > 0) {
      setLines(existingItems.map(item => {
        const base: LineRow = {
          _key: newKey(),
          product_id:       item.product_id,
          description:      item.description ?? '',
          quantity:         String(item.quantity),
          unit_price:       String(item.unit_price),
          discount_percent: String(item.discount_percent ?? 0),
          tax_rate:         String(item.tax_rate ?? 0),
          line_subtotal: 0, discount_amount: 0, tax_amount: 0, line_total: 0,
        };
        return { ...base, ...calcLine(base) };
      }));
    }
  }, [existingItems]);

  // ── Derived totals ───────────────────────────────────────────────────────
  const subtotal      = lines.reduce((s, l) => s + l.line_subtotal, 0);
  const discountTotal = lines.reduce((s, l) => s + l.discount_amount, 0);
  const taxTotal      = lines.reduce((s, l) => s + l.tax_amount, 0);
  const grandTotal    = lines.reduce((s, l) => s + l.line_total, 0);

  // ── Credit limit check ───────────────────────────────────────────────────
  // Fetch the customer's open invoices to compute current outstanding.
  // Adds this invoice's grand total to get projected outstanding. If
  // projected exceeds credit_limit (and credit_limit > 0 — 0 means "no
  // limit"), surface a warning banner. We DON'T block save — admin
  // override is implicit. We exclude this invoice from the calc when
  // editing an existing draft.
  const { data: openCustomerInvoices = [] } = useQuery({
    queryKey: ['open_invoices_for_credit_check', company_id, header.contact_id],
    queryFn:  () => getAdapter().invoices.listOpenForContact(company_id!, header.contact_id),
    enabled:  !!company_id && !!header.contact_id,
  });
  const selectedCustomer = contacts.find(c => c.id === header.contact_id);
  const creditLimit      = Number(selectedCustomer?.credit_limit ?? 0);
  const currentOutstanding = openCustomerInvoices
    .filter(inv => inv.id !== id)  // exclude this draft if it's already in the list
    .reduce((s, inv) => s + Number(inv.outstanding ?? 0), 0);
  const projectedOutstanding = currentOutstanding + grandTotal;
  const creditOverage        = projectedOutstanding - creditLimit;
  const overCreditLimit      = creditLimit > 0 && creditOverage > 0.005;

  // ── Customer insight panel data ──────────────────────────────────────────
  // Overdue: open invoices past due_date.
  const todayStr = todayIso();
  const overdueInvoices = openCustomerInvoices.filter(
    inv => inv.due_date && (inv.due_date as unknown as string) < todayStr && Number(inv.outstanding ?? 0) > 0.005,
  );
  // Last payment to this customer (inbound). One small query, cached per contact.
  const { data: customerPayments = [] } = useQuery({
    queryKey: ['payments_for_contact', company_id, header.contact_id],
    queryFn:  () => getAdapter().payments.list(company_id!, 'inbound'),
    enabled:  !!company_id && !!header.contact_id,
  });
  const lastPayment = customerPayments
    .filter(p => p.contact_id === header.contact_id && p.status === 'confirmed')
    .sort((a, b) => (b.date as string).localeCompare(a.date as string))[0];

  // ── Live stock + MAC per product (for Available Stock + Margin columns) ──
  // One batched query at editor mount. Cached app-wide so multiple editor
  // sessions / line edits don't re-fetch.
  const { data: stockMap = {} } = useQuery({
    queryKey: ['current_stock_map', company_id],
    queryFn:  () => getAdapter().stockLedger.getCurrentStockMap(company_id!),
    enabled:  !!company_id,
  });

  // ── Line helpers ─────────────────────────────────────────────────────────
  const updateLine = useCallback((key: string, patch: Partial<LineRow>) => {
    setLines(prev => prev.map(l => {
      if (l._key !== key) return l;
      const updated = { ...l, ...patch };
      return { ...updated, ...calcLine(updated) };
    }));
  }, []);

  const addLine = () => setLines(prev => [...prev, emptyLine()]);
  const removeLine = (key: string) => setLines(prev => prev.filter(l => l._key !== key));

  const handleProductChange = (key: string, productId: string) => {
    const product = products.find(p => p.id === productId);
    if (product) {
      updateLine(key, {
        product_id:  productId,
        description: product.name,
        unit_price:  String(product.selling_price ?? 0),
      });
    } else {
      updateLine(key, { product_id: null, description: '' });
    }
  };

  // ── Build items payload ──────────────────────────────────────────────────
  function buildItems(): InvoiceItemInsert[] {
    return lines.map((l, i) => ({
      invoice_id:       '', // filled by adapter
      product_id:       l.product_id,
      description:      l.description || null,
      description_ar:   null,
      quantity:         parseFloat(l.quantity) || 0,
      unit_id:          null,
      unit_price:       parseFloat(l.unit_price) || 0,
      discount_percent: parseFloat(l.discount_percent) || 0,
      discount_amount:  l.discount_amount,
      tax_category:     'standard',
      tax_rate:         parseFloat(l.tax_rate) || null,
      tax_amount:       l.tax_amount,
      line_subtotal:    l.line_subtotal,
      line_total:       l.line_total,
      sort_order:       i,
      cost_at_sale:     null,
      serial_id:        null,
    }));
  }

  // ── Mutations ────────────────────────────────────────────────────────────
  const saveMutation = useMutation({
    mutationFn: async () => {
      if (!header.contact_id) throw new Error(t('sales.error_contact_required'));
      if (!header.salesperson_id) throw new Error('Salesperson is required');
      if (lines.length === 0) throw new Error(t('sales.error_no_lines'));

      const row = {
        company_id:      company_id!,
        invoice_number:  isNew ? await getAdapter().invoices.getNextNumber(company_id!) : existing!.invoice_number,
        contact_id:      header.contact_id,
        salesperson_id:  header.salesperson_id,
        warehouse_id:    header.warehouse_id || null,
        date:            header.date,
        due_date:        header.due_date || null,
        reference:       header.reference || null,
        price_level_id:  null,
        currency:        header.currency,
        exchange_rate:   1,
        prices_inclusive: false,
        subtotal:        +subtotal.toFixed(2),
        discount_amount: +discountTotal.toFixed(2),
        tax_amount:      +taxTotal.toFixed(2),
        total_amount:    +grandTotal.toFixed(2),
        status:          'draft' as const,
        source_quote_id: null,
        source_order_id: null,
        sale_channel:    'standard' as const,
        terms:           null,
        terms_ar:        null,
        notes:           header.notes || null,
        void_reason:     null,
        voided_at:       null,
        voided_by:       null,
      };

      if (isNew) {
        return getAdapter().invoices.create(row, buildItems());
      } else {
        await getAdapter().invoices.update(id!, row, buildItems());
        return null;
      }
    },
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ['invoices', company_id] });
      if (isNew && data) {
        navigate(`/sales/invoices/${data.id}`);
      } else {
        qc.invalidateQueries({ queryKey: ['invoice', id] });
        qc.invalidateQueries({ queryKey: ['invoice_items', id] });
        setEditMode(false);
      }
    },
    onError: (e: Error) => setError(e.message),
  });

  const confirmMutation = useMutation({
    mutationFn: () => getAdapter().invoices.confirm(id!),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['invoices', company_id] });
      qc.invalidateQueries({ queryKey: ['invoice', id] });
    },
    onError: (e: Error) => setError(e.message),
  });

  const voidMutation = useMutation({
    mutationFn: () => getAdapter().invoices.void(id!, voidReason || undefined),
    onSuccess: () => {
      setVoidModal(false);
      qc.invalidateQueries({ queryKey: ['invoices', company_id] });
      qc.invalidateQueries({ queryKey: ['invoice', id] });
    },
    onError: (e: Error) => { setVoidModal(false); setError(e.message); },
  });

  const editRepostMutation = useMutation({
    mutationFn: async () => {
      if (!header.salesperson_id) throw new Error('Salesperson is required');
      const row = {
        company_id:      company_id!,
        invoice_number:  existing!.invoice_number,
        contact_id:      header.contact_id,
        salesperson_id:  header.salesperson_id,
        warehouse_id:    header.warehouse_id || null,
        date:            header.date,
        due_date:        header.due_date || null,
        reference:       header.reference || null,
        price_level_id:  null,
        currency:        header.currency,
        exchange_rate:   1,
        prices_inclusive: false,
        subtotal:        +subtotal.toFixed(2),
        discount_amount: +discountTotal.toFixed(2),
        tax_amount:      +taxTotal.toFixed(2),
        total_amount:    +grandTotal.toFixed(2),
        status:          'confirmed' as const,
        source_quote_id: existing!.source_quote_id,
        source_order_id: existing!.source_order_id,
        sale_channel:    existing!.sale_channel,
        terms:           existing!.terms ?? null,
        terms_ar:        existing!.terms_ar ?? null,
        notes:           header.notes || null,
        void_reason:     null,
        voided_at:       null,
        voided_by:       null,
      };
      await getAdapter().invoices.update(id!, row, buildItems());
      await getAdapter().invoices.edit(id!);
    },
    onSuccess: () => {
      setEditMode(false);
      qc.invalidateQueries({ queryKey: ['invoices', company_id] });
      qc.invalidateQueries({ queryKey: ['invoice', id] });
      qc.invalidateQueries({ queryKey: ['invoice_items', id] });
    },
    onError: (e: Error) => setError(e.message),
  });

  // ── Status & mode ────────────────────────────────────────────────────────
  const status = existing?.status ?? 'draft';
  const canEdit = isNew || status === 'draft' || editMode;
  const isConfirmed = status === 'confirmed';
  const isVoid = status === 'void';

  // ── Contact / warehouse options ──────────────────────────────────────────
  // SearchableSelect owns its own placeholder, so option lists don't include
  // an empty entry. Plain <Select> elsewhere still needs one.
  // contactOpts removed — customer picker now uses ContactPicker (D3).
  const warehouseOpts = [
    { value: '', label: t('sales.select_warehouse') },
    ...warehouses.map(w => ({ value: w.id, label: w.name })),
  ];
  // productOpts removed — product picker now uses SmartEntitySearch (D2).
  // Keeping the products list for resolveById fallback in the picker.
  const taxOpts = [
    { value: '0', label: t('sales.no_tax') },
    ...taxRates.map(r => ({ value: String(r.rate), label: `${r.name} (${r.rate}%)` })),
  ];

  // ── Render ───────────────────────────────────────────────────────────────
  // Sample-style status pill
  const statusPill = (s: string) => {
    const map: Record<string, { bg: string; text: string; border: string }> = {
      draft:     { bg: '#fffbeb', text: '#b45309', border: '#fde68a' },
      confirmed: { bg: '#f0fdf4', text: '#15803d', border: '#bbf7d0' },
      void:      { bg: '#fef2f2', text: '#dc2626', border: '#fecaca' },
    };
    const p = map[s] ?? { bg: '#f1f5f9', text: '#64748b', border: '#e2e8f0' };
    return (
      <span style={{
        display: 'inline-block', padding: '3px 9px', borderRadius: '999px',
        fontSize: '11px', fontWeight: 600, textTransform: 'capitalize',
        background: p.bg, color: p.text, border: `1px solid ${p.border}`,
      }}>{s}</span>
    );
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '20px', paddingBottom: '64px' }}>
      {/* Header row */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap' }}>
        <button onClick={() => navigate('/sales/invoices')} style={{
          background: 'transparent', border: 'none', cursor: 'pointer',
          fontSize: '13px', color: '#64748b',
        }}>← {t('sales.invoices_title')}</button>
        <span style={{ color: '#94a3b8' }}>/</span>
        <h1 style={{ margin: 0, fontSize: '20px', fontWeight: 700, color: '#1e293b', letterSpacing: '-.01em' }}>
          {isNew ? t('sales.new_invoice') : existing?.invoice_number ?? '…'}
        </h1>
        {!isNew && statusPill(status)}
        <div style={{ marginInlineStart: 'auto', display: 'flex', gap: '8px' }}>
          {/* Draft actions — Save is ONLY shown for new invoices or drafts.
               When editing a CONFIRMED invoice (editMode=true), this button is
               hidden because saveMutation silently downgrades status to
               'draft' and replaces items WITHOUT reversing the GL — which
               leads to duplicate journal entries when the user re-confirms.
               The "Save & Repost" button (rendered further below for the
               edit-confirmed case) is the only safe save path; it calls
               edit_invoice RPC which atomically reverses old JE + reposts new. */}
          {canEdit && !editMode && (
            <>
              <Button variant="ghost" size="sm" onClick={() => navigate('/sales/invoices')}>
                {t('common.cancel')}
              </Button>
              <Button size="sm" onClick={() => { setError(null); saveMutation.mutate(); }} disabled={saveMutation.isPending}>
                {saveMutation.isPending ? t('common.saving') : t('common.save')}
              </Button>
            </>
          )}
          {/* Confirm (draft only, not edit mode) */}
          {!isNew && status === 'draft' && !editMode && (
            <Button size="sm" onClick={() => { setError(null); confirmMutation.mutate(); }} disabled={confirmMutation.isPending}>
              {confirmMutation.isPending ? '…' : t('sales.confirm_invoice')}
            </Button>
          )}
          {/* Print (any non-new invoice) */}
          {!isNew && existing?.id && (
            <Button variant="ghost" size="sm" onClick={() => window.open(`/print/invoice/${existing.id}`, '_blank')}>
              🖨 {t('print.print')}
            </Button>
          )}
          {/* Edit & Void (confirmed only) */}
          {isConfirmed && !editMode && (
            <>
              <Button variant="ghost" size="sm" onClick={() => setEditMode(true)}>
                {t('sales.edit_invoice')}
              </Button>
              <Button variant="danger" size="sm" onClick={() => setVoidModal(true)}>
                {t('sales.void_invoice')}
              </Button>
            </>
          )}
          {/* Edit-mode save (confirmed invoice). One button, labelled "Save".
               Internally calls edit_invoice RPC which atomically reverses the
               old JE and posts a new one — so the user just sees "save the
               change", which is what they expect. */}
          {editMode && isConfirmed && (
            <>
              <Button variant="ghost" size="sm" onClick={() => { setEditMode(false); }}>
                {t('common.cancel')}
              </Button>
              <Button size="sm" onClick={() => { setError(null); editRepostMutation.mutate(); }} disabled={editRepostMutation.isPending}>
                {editRepostMutation.isPending ? t('common.saving') : t('common.save')}
              </Button>
            </>
          )}
        </div>
      </div>

      {error && (
        <div style={{
          background: '#fef2f2', border: '1px solid #fecaca',
          borderRadius: '8px', padding: '10px 16px', fontSize: '13px', color: '#dc2626',
        }}>{error}</div>
      )}

      {/* Customer Insight Panel — appears once a customer is picked.
           Shows outstanding, overdue, credit limit, last payment in a
           compact horizontal card so the salesperson has full context
           while writing the invoice. */}
      {selectedCustomer && (
        <div style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: '12px', boxShadow: '0 1px 2px rgba(15,23,42,.04)', padding: '16px' }}>
          <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
            <div>
              <p className="text-xs uppercase tracking-wide text-ink-tertiary">Outstanding</p>
              <p className={`mt-0.5 text-lg font-mono font-semibold ${currentOutstanding > 0 ? 'text-amber-700' : 'text-ink-primary'}`}>
                {header.currency} {fmt(currentOutstanding)}
              </p>
              <p className="text-xs text-ink-tertiary mt-0.5">
                {openCustomerInvoices.filter(inv => inv.id !== id).length} open invoice{openCustomerInvoices.length === 1 ? '' : 's'}
              </p>
            </div>
            <div>
              <p className="text-xs uppercase tracking-wide text-ink-tertiary">Overdue</p>
              <p className={`mt-0.5 text-lg font-mono font-semibold ${overdueInvoices.length > 0 ? 'text-red-600' : 'text-ink-primary'}`}>
                {overdueInvoices.length}
              </p>
              <p className="text-xs text-ink-tertiary mt-0.5">
                {overdueInvoices.length > 0
                  ? `${fmt(overdueInvoices.reduce((s, inv) => s + Number(inv.outstanding ?? 0), 0))} past due`
                  : 'No overdue'}
              </p>
            </div>
            <div>
              <p className="text-xs uppercase tracking-wide text-ink-tertiary">Credit limit</p>
              <p className="mt-0.5 text-lg font-mono font-semibold text-ink-primary">
                {creditLimit > 0 ? `${header.currency} ${fmt(creditLimit)}` : '—'}
              </p>
              <p className="text-xs text-ink-tertiary mt-0.5">
                {creditLimit > 0 ? `${fmt(Math.max(0, creditLimit - currentOutstanding))} available` : 'No limit set'}
              </p>
            </div>
            <div>
              <p className="text-xs uppercase tracking-wide text-ink-tertiary">Last payment</p>
              {lastPayment ? (
                <>
                  <p className="mt-0.5 text-lg font-mono font-semibold text-ink-primary">
                    {header.currency} {fmt(Number(lastPayment.amount))}
                  </p>
                  <p className="text-xs text-ink-tertiary mt-0.5">{lastPayment.date as string}</p>
                </>
              ) : (
                <>
                  <p className="mt-0.5 text-lg font-mono font-semibold text-ink-tertiary">—</p>
                  <p className="text-xs text-ink-tertiary mt-0.5">No payments yet</p>
                </>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Credit-limit warning — non-blocking. Shows when projected
           outstanding (existing open invoices + this invoice's total)
           exceeds the customer's credit_limit. credit_limit = 0 means
           "no limit set" and is intentionally not enforced. */}
      {overCreditLimit && selectedCustomer && (
        <div className="rounded-input border border-amber-300 bg-amber-50 px-4 py-3 text-sm">
          <p className="font-semibold text-amber-900">
            ⚠ Over credit limit
          </p>
          <p className="mt-1 text-amber-800">
            <strong>{selectedCustomer.name}</strong>'s credit limit is{' '}
            <span className="font-mono">{header.currency} {fmt(creditLimit)}</span>.
            Current outstanding: <span className="font-mono">{fmt(currentOutstanding)}</span>.
            After this invoice ({fmt(grandTotal)}), outstanding will be{' '}
            <span className="font-mono font-semibold">{fmt(projectedOutstanding)}</span>{' '}
            — over by <span className="font-mono font-semibold">{fmt(creditOverage)}</span>.
          </p>
          <p className="mt-1 text-xs text-amber-700">
            Save is still allowed — this is a warning, not a block. Raise the customer's
            credit limit on their detail page to clear this.
          </p>
        </div>
      )}

      {/* Invoice Header */}
      <div style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: '12px', boxShadow: '0 1px 2px rgba(15,23,42,.04)', padding: '20px' }}>
        <h2 className="mb-4 text-sm font-semibold text-ink-primary">{t('sales.invoice_details')}</h2>
        <div className="grid grid-cols-2 gap-4 md:grid-cols-3">
          <div className="col-span-2 md:col-span-1">
            <label className="mb-1 block text-sm font-medium text-ink-primary">
              {t('sales.customer')} <span className="text-danger-500">*</span>
            </label>
            <ContactPicker
              type="customer"
              value={header.contact_id}
              disabled={!canEdit || isVoid}
              onChange={(id) => setHeader(h => ({ ...h, contact_id: id ?? '' }))}
              placeholder={t('sales.select_contact')}
              panelWidth={380}
            />
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium text-ink-primary">
              Salesperson <span className="text-danger-500">*</span>
            </label>
            <SearchableSelect
              options={salespeople.map(p => ({ value: p.id, label: p.name }))}
              value={header.salesperson_id}
              disabled={!canEdit || isVoid}
              onChange={(v) => setHeader(h => ({ ...h, salesperson_id: v }))}
              placeholder={salespeople.length === 0 ? 'No salespeople — add in Settings' : 'Select salesperson'}
              panelWidth={280}
            />
          </div>
          <Input
            label={t('sales.date')}
            type="date"
            required
            value={header.date}
            disabled={!canEdit || isVoid}
            onChange={e => setHeader(h => ({ ...h, date: e.target.value }))}
          />
          <Input
            label={t('sales.due_date')}
            type="date"
            value={header.due_date}
            disabled={!canEdit || isVoid}
            onChange={e => setHeader(h => ({ ...h, due_date: e.target.value }))}
          />
          <Select
            label={t('sales.warehouse')}
            options={warehouseOpts}
            value={header.warehouse_id}
            disabled={!canEdit || isVoid}
            onChange={e => setHeader(h => ({ ...h, warehouse_id: e.target.value }))}
          />
          <Input
            label={t('sales.reference')}
            value={header.reference}
            disabled={!canEdit || isVoid}
            onChange={e => setHeader(h => ({ ...h, reference: e.target.value }))}
          />
          <Input
            label={t('sales.currency')}
            value={header.currency}
            disabled={!canEdit || isVoid}
            onChange={e => setHeader(h => ({ ...h, currency: e.target.value }))}
          />
        </div>
        <div className="mt-3">
          <Input
            label={t('sales.notes')}
            value={header.notes}
            disabled={!canEdit || isVoid}
            onChange={e => setHeader(h => ({ ...h, notes: e.target.value }))}
          />
        </div>
      </div>

      {/* Line Items + Sticky Sidebar */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[1fr_320px]">
      <div style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: '12px', boxShadow: '0 1px 2px rgba(15,23,42,.04)' }}>
        <div className="border-b border-border-subtle px-5 py-3">
          <h2 className="text-sm font-semibold text-ink-primary">{t('sales.line_items')}</h2>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-border-subtle bg-surface-muted text-ink-tertiary">
                <th className="px-3 py-2 text-start font-medium w-48">{t('sales.product')}</th>
                <th className="px-3 py-2 text-start font-medium w-40">{t('sales.description')}</th>
                <th className="px-3 py-2 text-end font-medium w-20">{t('sales.qty')}</th>
                <th className="px-3 py-2 text-end font-medium w-24">{t('sales.unit_price')}</th>
                <th className="px-3 py-2 text-end font-medium w-20">{t('sales.disc_pct')}</th>
                <th className="px-3 py-2 text-end font-medium w-24">{t('sales.tax')}</th>
                <th className="px-3 py-2 text-end font-medium w-20" title="Available stock (sum across warehouses)">Stock</th>
                <th className="px-3 py-2 text-end font-medium w-20" title="Margin % vs MAC. Negative = selling at a loss.">Margin</th>
                <th className="px-3 py-2 text-end font-medium w-24">{t('sales.line_total')}</th>
                {canEdit && !isVoid && <th className="w-10" />}
              </tr>
            </thead>
            <tbody>
              {lines.map(line => (
                <tr key={line._key} className="border-b border-border-subtle last:border-0">
                  <td className="px-3 py-1.5">
                    {/* SmartEntitySearch — Phase 12.18.
                         Server-side trigram search + rich-list dropdown.
                         Falls back to the cached `products` list to resolve
                         the currently-selected row by id. */}
                    <SmartEntitySearch<ProductSearchRow>
                      value={line.product_id}
                      disabled={!canEdit || isVoid}
                      placeholder={t('sales.select_product')}
                      panelWidth={520}
                      recentKey={company_id ? `recent_products::${company_id}` : undefined}
                      search={(q) => getAdapter().products.smartSearch({
                        company_id: company_id!, q, limit: 20,
                      })}
                      // Barcode auto-pick: if a query of ≥6 chars returns
                      // exactly one row with match_rank ≥ 2 (set by RPC on
                      // exact barcode hit), pick it instantly and close.
                      // Lets the user scan a barcode → line auto-fills.
                      autoPickOnExact={{
                        rankAtLeast: 2,
                        minQueryLen: 6,
                        getRank: (row) => row.match_rank,
                      }}
                      resolveById={async (pid) => {
                        // Try cached list first (cheap), fallback to fetch.
                        const fromList = products.find(p => p.id === pid);
                        if (fromList) {
                          return {
                            id: fromList.id, sku: fromList.sku, name: fromList.name,
                            name_ar: fromList.name_ar ?? null,
                            oe_number: fromList.oe_number ?? null,
                            barcode: fromList.barcode ?? null,
                            brand_id: fromList.brand_id ?? null, brand_name: null,
                            category_id: fromList.category_id ?? null, category_name: null,
                            unit_id: fromList.unit_id ?? null, unit_code: null,
                            selling_price: Number(fromList.selling_price ?? 0),
                            is_active: fromList.is_active,
                            match_rank: 0,
                          };
                        }
                        return null;
                      }}
                      onChange={(id) => { if (id) handleProductChange(line._key, id); }}
                      getDisplayLabel={(row) => `${row.sku}  ${row.name}`}
                      getKey={(row) => row.id}
                      emptyState={(query) => (
                        <button
                          type="button"
                          onClick={() => {
                            setProductQcLineKey(line._key);
                            setProductQcSeed(query);
                            setProductQcOpen(true);
                          }}
                          className="flex w-full items-center gap-2 text-xs font-medium text-brand-600 hover:text-brand-700"
                        >
                          <span className="flex h-4 w-4 items-center justify-center rounded-full bg-brand-100 text-brand-700">+</span>
                          Add new item{query ? ` "${query}"` : ''}
                        </button>
                      )}
                      renderRow={(row, { highlighted, query }) => {
                        const s = stockMap[row.id];
                        const qty = s?.qty ?? 0;
                        const mac = s?.mac ?? 0;
                        // When the row is highlighted (selected nav state),
                        // background is solid brand-500 — switch all text
                        // tones to white-ish for contrast.
                        const titleCls    = highlighted ? 'text-white' : 'text-ink-primary';
                        const subCls      = highlighted ? 'text-white/80' : 'text-ink-tertiary';
                        const stockLabelCls = highlighted ? 'text-white/80' : 'text-ink-tertiary';
                        const stockNumCls = highlighted
                          ? 'text-white font-semibold'
                          : qty <= 0
                            ? 'text-red-600 font-semibold'
                            : qty < 5
                              ? 'text-amber-700 font-semibold'
                              : 'text-emerald-700 font-semibold';
                        return (
                          <div className="flex items-start justify-between gap-3">
                            {/* LEFT: name + sub-line */}
                            <div className="min-w-0 flex-1">
                              <div className={`text-sm font-medium truncate ${titleCls}`}>
                                {highlightMatch(row.name, query)}
                              </div>
                              <div className={`mt-0.5 text-[11px] truncate ${subCls}`}>
                                SKU: <span className="font-mono">{highlightMatch(row.sku, query)}</span>
                                {row.brand_name && <> · {row.brand_name}</>}
                                {row.oe_number && <> · OEM {highlightMatch(row.oe_number, query)}</>}
                                {mac > 0 && <> · Rate {row.unit_code ? `${row.unit_code} ` : ''}{Number(row.selling_price ?? 0).toFixed(2)}</>}
                              </div>
                            </div>
                            {/* RIGHT: stock-on-hand label + value */}
                            <div className="flex-none text-end">
                              <div className={`text-[10px] uppercase tracking-wide ${stockLabelCls}`}>
                                Stock on Hand
                              </div>
                              <div className={`text-sm ${stockNumCls}`}>
                                {qty.toFixed(2)} {row.unit_code ?? 'pcs'}
                              </div>
                            </div>
                          </div>
                        );
                      }}
                    />
                  </td>
                  <td className="px-3 py-1.5">
                    <input
                      className="w-full rounded border border-border-strong bg-surface-subtle px-2 py-1 text-xs text-ink-primary disabled:opacity-60"
                      value={line.description}
                      disabled={!canEdit || isVoid}
                      onChange={e => updateLine(line._key, { description: e.target.value })}
                    />
                  </td>
                  <td className="px-3 py-1.5">
                    <input
                      type="number" min="0" step="1"
                      className="w-full rounded border border-border-strong bg-surface-subtle px-2 py-1 text-xs text-end text-ink-primary disabled:opacity-60"
                      value={line.quantity}
                      disabled={!canEdit || isVoid}
                      onChange={e => updateLine(line._key, { quantity: e.target.value })}
                    />
                  </td>
                  <td className="px-3 py-1.5">
                    <input
                      type="number" min="0" step="0.01"
                      className="w-full rounded border border-border-strong bg-surface-subtle px-2 py-1 text-xs text-end text-ink-primary disabled:opacity-60"
                      value={line.unit_price}
                      disabled={!canEdit || isVoid}
                      onChange={e => updateLine(line._key, { unit_price: e.target.value })}
                    />
                  </td>
                  <td className="px-3 py-1.5">
                    <input
                      type="number" min="0" max="100" step="0.01"
                      className="w-full rounded border border-border-strong bg-surface-subtle px-2 py-1 text-xs text-end text-ink-primary disabled:opacity-60"
                      value={line.discount_percent}
                      disabled={!canEdit || isVoid}
                      onChange={e => updateLine(line._key, { discount_percent: e.target.value })}
                    />
                  </td>
                  <td className="px-3 py-1.5">
                    <select
                      className="w-full rounded border border-border-strong bg-surface-subtle px-2 py-1 text-xs text-ink-primary disabled:opacity-60"
                      value={line.tax_rate}
                      disabled={!canEdit || isVoid}
                      onChange={e => updateLine(line._key, { tax_rate: e.target.value })}
                    >
                      {taxOpts.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                    </select>
                  </td>
                  {(() => {
                    // Live stock + margin per line.
                    const pid = line.product_id ?? '';
                    const s = pid ? stockMap[pid] : undefined;
                    const stock = s?.qty ?? 0;
                    const mac   = s?.mac ?? 0;
                    const qty   = parseFloat(line.quantity) || 0;
                    const price = parseFloat(line.unit_price) || 0;
                    const disc  = parseFloat(line.discount_percent) || 0;
                    const netPrice = price * (1 - disc / 100);
                    const margin   = netPrice > 0 && mac > 0 ? ((netPrice - mac) / netPrice) * 100 : 0;
                    const projectedStock = stock - qty;
                    const stockCls = !pid
                      ? 'text-ink-tertiary'
                      : projectedStock < 0
                        ? 'text-red-600 font-semibold'
                        : projectedStock <= 0.005
                          ? 'text-amber-700 font-semibold'
                          : 'text-ink-secondary';
                    const marginCls = !pid || mac <= 0
                      ? 'text-ink-tertiary'
                      : margin < 0
                        ? 'text-red-600 font-semibold'
                        : margin < 10
                          ? 'text-amber-700'
                          : 'text-emerald-700';
                    return (
                      <>
                        <td className={`px-3 py-1.5 text-end font-mono ${stockCls}`} title={pid ? `On-hand: ${fmt(stock)} · After this line: ${fmt(projectedStock)}` : ''}>
                          {!pid ? '—' : projectedStock < 0 ? `${fmt(projectedStock)} ⚠` : fmt(stock)}
                        </td>
                        <td className={`px-3 py-1.5 text-end font-mono ${marginCls}`} title={pid && mac > 0 ? `MAC: ${fmt(mac)} · Net price: ${fmt(netPrice)}` : 'No cost basis yet'}>
                          {!pid || mac <= 0 ? '—' : `${margin.toFixed(1)}%`}
                        </td>
                      </>
                    );
                  })()}
                  <td className="px-3 py-1.5 text-end font-mono text-ink-primary">
                    {fmt(line.line_total)}
                  </td>
                  {canEdit && !isVoid && (
                    <td className="px-3 py-1.5">
                      <button
                        className="text-red-400 hover:text-red-600 disabled:opacity-30"
                        disabled={lines.length === 1}
                        onClick={() => removeLine(line._key)}
                      >
                        ×
                      </button>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {canEdit && !isVoid && (
          <div className="border-t border-border-subtle px-5 py-2">
            <button
              className="text-xs text-brand-600 hover:text-brand-700"
              onClick={addLine}
            >
              + {t('sales.add_line')}
            </button>
          </div>
        )}

      </div>

      {/* Sticky financial summary sidebar.
           Lives in the right column of the grid; stays visible while the
           user scrolls long line lists. Highlights Grand Total and (for
           confirmed invoices) Balance Due. */}
      <aside className="space-y-4 lg:sticky lg:top-4 lg:self-start">
        <div style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: '12px', boxShadow: '0 1px 2px rgba(15,23,42,.04)', overflow: 'hidden' }}>
          <div className="border-b border-border-subtle px-4 py-2.5 bg-surface-muted/40">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-ink-tertiary">Summary</h3>
          </div>
          <div className="p-4 space-y-2 text-sm">
            <div className="flex justify-between text-ink-secondary">
              <span>{t('sales.subtotal')}</span>
              <span className="font-mono">{fmt(subtotal)}</span>
            </div>
            {discountTotal > 0 && (
              <div className="flex justify-between text-ink-secondary">
                <span>{t('sales.discount')}</span>
                <span className="font-mono text-red-600">−{fmt(discountTotal)}</span>
              </div>
            )}
            {taxTotal > 0 && (
              <div className="flex justify-between text-ink-secondary">
                <span>{t('sales.vat')}</span>
                <span className="font-mono">{fmt(taxTotal)}</span>
              </div>
            )}
            <div className="flex justify-between border-t border-border-subtle pt-2.5 mt-1 text-base font-semibold text-ink-primary">
              <span>Grand Total</span>
              <span className="font-mono">{header.currency} {fmt(grandTotal)}</span>
            </div>
            {(() => {
              // Paid amount + balance: only meaningful for an existing
              // confirmed invoice that's in the openCustomerInvoices list.
              if (isNew || !id) return null;
              const thisInv = openCustomerInvoices.find(inv => inv.id === id);
              if (!thisInv) return null;
              const outstanding = Number(thisInv.outstanding ?? 0);
              const paid = grandTotal - outstanding;
              return (
                <>
                  <div className="flex justify-between text-ink-secondary border-t border-border-subtle pt-2.5">
                    <span>Paid</span>
                    <span className="font-mono text-emerald-700">{fmt(paid)}</span>
                  </div>
                  <div className={`flex justify-between font-semibold ${outstanding > 0.005 ? 'text-amber-700' : 'text-emerald-700'}`}>
                    <span>Balance Due</span>
                    <span className="font-mono">{header.currency} {fmt(outstanding)}</span>
                  </div>
                </>
              );
            })()}
          </div>
        </div>

        {/* Accounting preview — what confirm_invoice will post to GL.
             Best-effort; ground truth is the RPC. */}
        {!isVoid && lines.some(l => l.product_id) && (() => {
          const preview = buildSalesInvoicePreview({
            invoice_number: existing?.invoice_number,
            lines: lines.map(l => ({
              product_id:        l.product_id,
              quantity:          parseFloat(l.quantity) || 0,
              unit_price:        parseFloat(l.unit_price) || 0,
              discount_percent:  parseFloat(l.discount_percent) || 0,
              tax_amount:        l.tax_amount,
              mac:               (l.product_id && stockMap[l.product_id]?.mac) || 0,
            })),
          });
          if (preview.length === 0) return null;
          return <AccountingPreview lines={preview} currency={header.currency || 'AED'} />;
        })()}
      </aside>
      </div>

      {/* Product Quick Create modal — opened from any line's picker emptyState */}
      <ProductQuickCreate
        open={productQcOpen}
        initialQuery={productQcSeed}
        onClose={() => setProductQcOpen(false)}
        onCreated={(productId) => {
          setProductQcOpen(false);
          if (productQcLineKey) handleProductChange(productQcLineKey, productId);
          setProductQcLineKey(null);
        }}
      />

      {/* Void modal */}
      <Modal
        open={voidModal}
        onClose={() => setVoidModal(false)}
        title={t('sales.void_invoice')}
      >
        <div className="space-y-4">
          <p className="text-sm text-ink-secondary">{t('sales.void_confirm_text')}</p>
          <Input
            label={t('sales.void_reason')}
            value={voidReason}
            onChange={e => setVoidReason(e.target.value)}
          />
          <div className="flex justify-end gap-2">
            <Button variant="ghost" size="sm" onClick={() => setVoidModal(false)}>
              {t('common.cancel')}
            </Button>
            <Button variant="danger" size="sm" onClick={() => voidMutation.mutate()} disabled={voidMutation.isPending}>
              {voidMutation.isPending ? '…' : t('sales.void_invoice')}
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
