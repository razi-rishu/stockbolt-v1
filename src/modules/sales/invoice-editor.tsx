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
import type { InvoiceRow, InvoiceItemInsert, ContactRow, ProductRow, WarehouseRow, TaxRateRow } from '@/data/adapter';
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
  const contactOpts = contacts.map(c => ({ value: c.id, label: c.name }));
  const warehouseOpts = [
    { value: '', label: t('sales.select_warehouse') },
    ...warehouses.map(w => ({ value: w.id, label: w.name })),
  ];
  const productOpts = products.map(p => ({ value: p.id, label: `${p.sku}  ${p.name}` }));
  const taxOpts = [
    { value: '0', label: t('sales.no_tax') },
    ...taxRates.map(r => ({ value: String(r.rate), label: `${r.name} (${r.rate}%)` })),
  ];

  // ── Render ───────────────────────────────────────────────────────────────
  return (
    <div className="space-y-6 pb-16">
      {/* Header row */}
      <div className="flex items-center gap-3">
        <button onClick={() => navigate('/sales/invoices')} className="text-sm text-ink-secondary hover:text-ink-primary">
          ← {t('sales.invoices_title')}
        </button>
        <span className="text-ink-tertiary">/</span>
        <h1 className="text-xl font-semibold text-ink-primary">
          {isNew ? t('sales.new_invoice') : existing?.invoice_number ?? '…'}
        </h1>
        {!isNew && (
          <span className={`rounded-pill px-2.5 py-0.5 text-xs font-medium capitalize ${
            status === 'draft' ? 'bg-yellow-50 text-yellow-700' :
            status === 'confirmed' ? 'bg-green-50 text-green-700' :
            'bg-red-50 text-red-600'
          }`}>
            {status}
          </span>
        )}
        <div className="ms-auto flex gap-2">
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
        <div className="rounded-input bg-red-50 px-4 py-2 text-sm text-red-700">{error}</div>
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
      <div className="rounded-card border border-border-subtle bg-surface-card p-5">
        <h2 className="mb-4 text-sm font-semibold text-ink-primary">{t('sales.invoice_details')}</h2>
        <div className="grid grid-cols-2 gap-4 md:grid-cols-3">
          <div className="col-span-2 md:col-span-1">
            <label className="mb-1 block text-sm font-medium text-ink-primary">
              {t('sales.customer')} <span className="text-danger-500">*</span>
            </label>
            <SearchableSelect
              options={contactOpts}
              value={header.contact_id}
              disabled={!canEdit || isVoid}
              onChange={(v) => setHeader(h => ({ ...h, contact_id: v }))}
              placeholder={t('sales.select_contact')}
              panelWidth={320}
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

      {/* Line Items */}
      <div className="rounded-card border border-border-subtle bg-surface-card">
        <div className="border-b border-border-subtle px-5 py-3">
          <h2 className="text-sm font-semibold text-ink-primary">{t('sales.line_items')}</h2>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-border-subtle bg-surface-muted text-ink-tertiary">
                <th className="px-3 py-2 text-start font-medium w-48">{t('sales.product')}</th>
                <th className="px-3 py-2 text-start font-medium w-48">{t('sales.description')}</th>
                <th className="px-3 py-2 text-end font-medium w-20">{t('sales.qty')}</th>
                <th className="px-3 py-2 text-end font-medium w-24">{t('sales.unit_price')}</th>
                <th className="px-3 py-2 text-end font-medium w-20">{t('sales.disc_pct')}</th>
                <th className="px-3 py-2 text-end font-medium w-28">{t('sales.tax')}</th>
                <th className="px-3 py-2 text-end font-medium w-24">{t('sales.line_total')}</th>
                {canEdit && !isVoid && <th className="w-10" />}
              </tr>
            </thead>
            <tbody>
              {lines.map(line => (
                <tr key={line._key} className="border-b border-border-subtle last:border-0">
                  <td className="px-3 py-1.5">
                    <SearchableSelect
                      options={productOpts}
                      value={line.product_id ?? ''}
                      disabled={!canEdit || isVoid}
                      onChange={(v) => handleProductChange(line._key, v)}
                      placeholder={'— ' + t('sales.select_product') + ' —'}
                      panelWidth={360}
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

        {/* Totals */}
        <div className="border-t border-border-subtle px-5 py-4">
          <div className="ms-auto w-60 space-y-1.5 text-sm">
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
            <div className="flex justify-between border-t border-border-subtle pt-1.5 font-semibold text-ink-primary">
              <span>{t('sales.total_amount')}</span>
              <span className="font-mono">{header.currency} {fmt(grandTotal)}</span>
            </div>
          </div>
        </div>
      </div>

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
