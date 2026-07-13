import { useState, useEffect, useCallback, useRef } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { useNavigate, useParams, useLocation } from 'react-router-dom';
import { getAdapter } from '@/data/index';
import { useAuthStore } from '@/store/auth';
import { useShortcutAction } from '@/keyboard/use-shortcut-action';
import { useInvalidateBooks } from '@/hooks/use-invalidate-books';
import { useCompanyCurrency, useCompanyCountry, useCompanyRoundingStep } from '@/hooks/use-company-currency';
import { applyRoundOff } from '@/core/sales/invoice-calc';
import { defaultTaxRate } from '@/lib/locale';
import { useUnsavedChangesGuard } from '@/hooks/use-unsaved-changes-guard';
import { Button } from '@/ui/button';
import { Input } from '@/ui/input';
import { Select } from '@/ui/select';
import { Modal } from '@/ui/modal';
import { SearchableSelect } from '@/ui/searchable-select';
import { currencyOptions } from '@/lib/currencies';
import { AddNewButton } from '@/ui/add-new-button';
import { SmartEntitySearch, highlightMatch } from '@/components/smart-entity-search';
import { ContactPicker } from '@/components/contact-picker';
import { ProductQuickCreate } from '@/components/quick-create/product-quick-create';
import { AccountingPreview, buildSalesInvoicePreview } from '@/components/accounting-preview';
// Phase 14.03 — Signature template view mode.
import { ConfigurableDocTemplate } from '@/modules/print/engine/ConfigurableDocTemplate';
import { useResolvedPrintTemplate } from '@/hooks/use-resolved-print-template';
import { invoiceToDocumentData } from '@/modules/print/_signature/adapters';
import '@/modules/print/_signature/print.css';
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

function calcLine(l: LineRow, inclusive = false) {
  return _calcLine({
    quantity:         parseFloat(l.quantity) || 0,
    unit_price:       parseFloat(l.unit_price) || 0,
    discount_percent: parseFloat(l.discount_percent) || 0,
    tax_rate:         parseFloat(l.tax_rate) || 0,
    inclusive,
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
  const companyCurrency = useCompanyCurrency();   // Phase 14.14m — reads companies.currency, falls back to AED
  const companyCountry = useCompanyCountry();      // Phase 21 — default tax to the country's standard rate
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const location = useLocation();
  const printTemplate = useResolvedPrintTemplate('sales_invoice');
  const qc = useQueryClient();
  // Phase 14.14k — invalidate all books-downstream caches (TB, BS, GL, aging,
  // statements, dashboard, stock ledger, etc.) after any GL-touching mutation.
  const invalidateBooks = useInvalidateBooks();
  // The standalone /sales/invoices/new route carries no :id param (id is
  // undefined there), so treat a missing id as "new" too — not just the
  // literal 'new'. Real invoices always have a UUID id.
  const isNew = !id || id === 'new';
  // Phase 47b — /sales/invoices/:id/edit renders standalone (full page). The
  // nested :id route (inside the list workspace) is the read-only view.
  const isEditRoute = location.pathname.endsWith('/edit');

  // ── Reference data ───────────────────────────────────────────────────────
  const { data: contacts = [] } = useQuery<ContactRow[]>({
    queryKey: ['contacts', company_id, 'customer'],
    queryFn: () => getAdapter().contacts.list(company_id!, 'customer'),
    enabled: !!company_id,
  });
  // Receipts applied to invoices — shows Paid / Balance due on the doc view.
  const { data: appliedMap = {} } = useQuery<Record<string, number>>({
    queryKey: ['invoice_applied_map', company_id],
    queryFn: () => getAdapter().payments.getAppliedMap(company_id!, 'invoice'),
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
  // Phase 21 — the company's standard tax rate (5% GCC / 18% India), matched to a
  // seeded tax_rates row. New lines default to this instead of "No Tax (0%)".
  const stdTaxRate = (() => {
    const target = defaultTaxRate(companyCountry);
    const hit = taxRates.find(r => r.is_active && Number(r.rate) === target);
    return hit ? String(hit.rate) : '0';
  })();
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
  // Phase 14.03 — company for view-mode template rendering.
  const { data: companyRow } = useQuery({
    queryKey: ['company', company_id],
    queryFn:  () => getAdapter().companies.getById(company_id!),
    enabled:  !!company_id && !isNew,
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
  const [deleteModal, setDeleteModal] = useState(false);
  const [dirty, setDirty] = useState(false);
  const confirmLeave = useUnsavedChangesGuard(dirty);
  const [error, setError] = useState<string | null>(null);
  // Phase 14.17 — tax-inclusive/exclusive toggle.
  // true = unit_price already includes tax (common in retail / GCC B2C).
  // false (default) = tax is added on top of the listed price.
  const [pricesInclusive, setPricesInclusive] = useState(false);

  // Phase 14.03 — view-first for saved invoices. Renders the Signature
  // template by default; user clicks Edit to drop into the existing
  // editor. New invoices skip this entirely (you're already editing).
  // View-first for saved invoices, EXCEPT on the /edit route which is the
  // dedicated full-page editor (opens straight into the form).
  const [viewMode, setViewMode] = useState(!isNew && !isEditRoute);

  // Clone seed — a Duplicate action navigates to /sales/invoices/new with the
  // source invoice's header + lines in router state. Seed once per navigation,
  // resetting dates to today and dropping into the editor (not view mode). The
  // new invoice saves as a fresh draft with its own number.
  const clonedKey = useRef<string | null>(null);
  useEffect(() => {
    const seed = (location.state as { cloneFrom?: { header: Partial<InvHeader>; prices_inclusive?: boolean; lines: Omit<LineRow, '_key' | 'line_subtotal' | 'discount_amount' | 'tax_amount' | 'line_total'>[] } } | null)?.cloneFrom;
    if (!seed || !isNew || clonedKey.current === location.key) return;
    clonedKey.current = location.key;
    setHeader(h => ({ ...h, ...seed.header, date: todayIso(), due_date: '' }));
    setPricesInclusive(seed.prices_inclusive ?? false);
    setLines(
      seed.lines.length
        ? seed.lines.map(l => {
            const base: LineRow = { _key: newKey(), ...l, line_subtotal: 0, discount_amount: 0, tax_amount: 0, line_total: 0 };
            return { ...base, ...calcLine(base, seed.prices_inclusive ?? false) };
          })
        : [emptyLine()],
    );
    setViewMode(false);
    setEditMode(false);
    setDirty(true);   // a clone is unsaved data — warn if the user backs out
  }, [location.key, location.state, isNew]);

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
      setPricesInclusive(existing.prices_inclusive ?? false);
      // Freeze the stored round-off when editing so opening an old invoice
      // never silently changes its total — "Auto" re-rounds on demand.
      setRoundOffOverride(String(Number((existing as { round_off_amount?: number }).round_off_amount ?? 0)));
      // On the full-page /edit route, a confirmed invoice opens straight into
      // the reverse-&-repost edit form (not the read-only view).
      if (isEditRoute && existing.status === 'confirmed') setEditMode(true);
    }
  }, [existing, isEditRoute]);

  // Auto-select the first warehouse when none is chosen yet and warehouses have loaded.
  // Covers both new invoices and existing drafts saved without a warehouse.
  useEffect(() => {
    if (!header.warehouse_id && warehouses.length > 0) {
      setHeader(h => ({ ...h, warehouse_id: warehouses[0].id }));
    }
  }, [warehouses, header.warehouse_id]); // eslint-disable-line react-hooks/exhaustive-deps

  // Recalculate all line totals when inclusive toggle changes
  useEffect(() => {
    setLines(prev => prev.map(l => ({ ...l, ...calcLine(l, pricesInclusive) })));
  }, [pricesInclusive]); // eslint-disable-line react-hooks/exhaustive-deps

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
        return { ...base, ...calcLine(base, pricesInclusive) };
      }));
    }
  }, [existingItems]);

  // ── Derived totals ───────────────────────────────────────────────────────
  const subtotal      = lines.reduce((s, l) => s + l.line_subtotal, 0);
  const discountTotal = lines.reduce((s, l) => s + l.discount_amount, 0);
  const taxTotal      = lines.reduce((s, l) => s + l.tax_amount, 0);
  const grandTotal    = lines.reduce((s, l) => s + l.line_total, 0);
  // Phase 46 — round the grand total to the company's cash step (0.25/0.50/1).
  // Automatic from Settings by default; typing a value overrides it manually
  // (±1.00). The difference is stored on the invoice and posts to 5900.
  const roundingStep  = useCompanyRoundingStep();
  const autoRoundOff  = applyRoundOff(grandTotal, roundingStep).round_off;
  const [roundOffOverride, setRoundOffOverride] = useState<string | null>(null);
  const roundOff      = roundOffOverride !== null
    ? Math.max(-1, Math.min(1, parseFloat(roundOffOverride) || 0))
    : autoRoundOff;
  const roundedTotal  = +(grandTotal + roundOff).toFixed(2);

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
  const projectedOutstanding = currentOutstanding + roundedTotal;
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
      return { ...updated, ...calcLine(updated, pricesInclusive) };
    }));
    setDirty(true);
  }, [pricesInclusive]);

  const addLine = () => {
    const base = { ...emptyLine(), tax_rate: stdTaxRate };
    setLines(prev => [...prev, { ...base, ...calcLine(base, pricesInclusive) }]);
    setDirty(true);
  };
  const removeLine = (key: string) => { setLines(prev => prev.filter(l => l._key !== key)); setDirty(true); };

  // Phase 21 — pre-fill the pristine opening line on a NEW invoice with the
  // company's standard rate once tax rates + country resolve. Touches only the
  // untouched starter line (no product, no edits), runs once, and never clobbers
  // a cloned/loaded line or a rate the user has already chosen.
  const seededDefaultRate = useRef(false);
  useEffect(() => {
    if (!isNew || seededDefaultRate.current || stdTaxRate === '0') return;
    seededDefaultRate.current = true;
    setLines(prev => prev.map(l =>
      (l.product_id == null && l.description === '' && l.tax_rate === '0')
        ? { ...l, tax_rate: stdTaxRate, ...calcLine({ ...l, tax_rate: stdTaxRate }, pricesInclusive) }
        : l));
  }, [isNew, stdTaxRate, pricesInclusive]);

  const handleProductChange = (key: string, productId: string) => {
    const product = products.find(p => p.id === productId);
    if (product) {
      // Auto-fill tax rate from product's tax_category → matching tax rate.
      const matchedRate = taxRates.find(r => r.is_active && r.tax_type === product.tax_category);
      updateLine(key, {
        product_id:  productId,
        description: product.name,
        unit_price:  String(product.selling_price ?? 0),
        tax_rate:    String(matchedRate?.rate ?? 0),
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
      // Auto-resolve warehouse: use the one in header, fall back to first available.
      const resolvedWarehouseId = header.warehouse_id || (warehouses[0]?.id ?? null);
      if (lines.some(l => l.product_id) && !resolvedWarehouseId)
        throw new Error('No warehouse found. Please create a warehouse in Settings first.');

      const row = {
        company_id:      company_id!,
        invoice_number:  isNew ? await getAdapter().invoices.getNextNumber(company_id!) : existing!.invoice_number,
        contact_id:      header.contact_id,
        salesperson_id:  header.salesperson_id,
        warehouse_id:    resolvedWarehouseId,
        date:            header.date,
        due_date:        header.due_date || null,
        reference:       header.reference || null,
        price_level_id:  null,
        currency:        header.currency,
        exchange_rate:   1,
        prices_inclusive: pricesInclusive,
        subtotal:        +subtotal.toFixed(2),
        discount_amount: +discountTotal.toFixed(2),
        tax_amount:      +taxTotal.toFixed(2),
        // Omit when zero so saves keep working until the phase46 migration
        // adds the column.
        ...(roundOff !== 0 ? { round_off_amount: +roundOff.toFixed(2) } : {}),
        total_amount:    +roundedTotal.toFixed(2),
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

      // Save = persist the draft then immediately post it (single-step). Failed
      // post leaves a saved draft; a new invoice routes to its record so a
      // retry updates+posts instead of duplicating.
      let invId: string;
      if (isNew) {
        const created = await getAdapter().invoices.create(row, buildItems());
        invId = created.id;
      } else {
        await getAdapter().invoices.update(id!, row, buildItems());
        invId = id!;
      }
      try {
        await getAdapter().invoices.confirm(invId);
      } catch (e) {
        if (isNew) navigate(`/sales/invoices/${invId}`);
        throw e;
      }
      return invId;
    },
    onSuccess: async () => {
      setDirty(false);
      await invalidateBooks();
      qc.invalidateQueries({ queryKey: ['invoices', company_id] });
      if (!isNew) {
        qc.invalidateQueries({ queryKey: ['invoice', id] });
        qc.invalidateQueries({ queryKey: ['invoice_items', id] });
        setEditMode(false);
      }
      // After editing an existing invoice, drop back into its read-only view
      // (the split workspace). A brand-new invoice goes to the list.
      navigate(isNew ? '/sales/invoices' : `/sales/invoices/${id}`);
    },
    onError: (e: Error) => setError(e.message),
  });

  const voidMutation = useMutation({
    mutationFn: () => getAdapter().invoices.void(id!, voidReason || undefined),
    onSuccess: async () => {
      setVoidModal(false);
      await invalidateBooks();
      qc.invalidateQueries({ queryKey: ['invoices', company_id] });
      qc.invalidateQueries({ queryKey: ['invoice', id] });
    },
    onError: (e: Error) => { setVoidModal(false); setError(e.message); },
  });

  const deleteMutation = useMutation({
    mutationFn: () => getAdapter().invoices.deleteDraft(id!),
    onSuccess: async () => {
      setDeleteModal(false);
      qc.invalidateQueries({ queryKey: ['invoices', company_id] });
      navigate('/sales/invoices');
    },
    onError: (e: Error) => { setDeleteModal(false); setError(e.message); },
  });

  const editRepostMutation = useMutation({
    mutationFn: async () => {
      if (!header.salesperson_id) throw new Error('Salesperson is required');
      const resolvedWarehouseId = header.warehouse_id || (warehouses[0]?.id ?? null);
      const row = {
        company_id:      company_id!,
        invoice_number:  existing!.invoice_number,
        contact_id:      header.contact_id,
        salesperson_id:  header.salesperson_id,
        warehouse_id:    resolvedWarehouseId,
        date:            header.date,
        due_date:        header.due_date || null,
        reference:       header.reference || null,
        price_level_id:  null,
        currency:        header.currency,
        exchange_rate:   1,
        prices_inclusive: pricesInclusive,
        subtotal:        +subtotal.toFixed(2),
        discount_amount: +discountTotal.toFixed(2),
        tax_amount:      +taxTotal.toFixed(2),
        // Omit when zero so saves keep working until the phase46 migration
        // adds the column.
        ...(roundOff !== 0 ? { round_off_amount: +roundOff.toFixed(2) } : {}),
        total_amount:    +roundedTotal.toFixed(2),
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
    onSuccess: async () => {
      setEditMode(false);
      setDirty(false);
      await invalidateBooks();
      qc.invalidateQueries({ queryKey: ['invoices', company_id] });
      qc.invalidateQueries({ queryKey: ['invoice', id] });
      qc.invalidateQueries({ queryKey: ['invoice_items', id] });
      // Return to the read-only view after a reverse-&-repost edit.
      navigate(`/sales/invoices/${id}`);
    },
    onError: (e: Error) => setError(e.message),
  });

  // ── Status & mode ────────────────────────────────────────────────────────
  const status = existing?.status ?? 'draft';
  const canEdit = isNew || status === 'draft' || editMode;
  const isConfirmed = status === 'confirmed';
  const isVoid = status === 'void';

  // Global keyboard actions (Phase 1) — Ctrl+S / Ctrl+Enter save, Ctrl+P print.
  useShortcutAction('save', () => { setError(null); saveMutation.mutate(); }, canEdit && !saveMutation.isPending);
  useShortcutAction('print', () => window.print(), !!existing?.id);

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
  // Use r.id as React key (UUID, always unique) so duplicate rates like
  // Zero-rated 0% and Exempt 0% don't cause "duplicate key" console warnings.
  // "No tax" uses value='' (empty) to avoid colliding with a 0% rate option.
  const taxOpts: { key: string; value: string; label: string }[] = [
    { key: '__none__', value: '', label: t('sales.no_tax') },
    ...taxRates.map(r => ({ key: r.id, value: String(r.rate), label: `${r.name} (${r.rate}%)` })),
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

  // Void + Delete confirmation modals — rendered in BOTH the view template
  // and the editor form, so the user can remove a wrong invoice from either
  // place (not only after entering edit mode).
  const dangerModals = (
    <>
      <Modal open={voidModal} onClose={() => setVoidModal(false)} title={t('sales.void_invoice')}>
        <div className="space-y-4">
          <p className="text-sm text-ink-secondary">{t('sales.void_confirm_text')}</p>
          <Input label={t('sales.void_reason')} value={voidReason} onChange={e => setVoidReason(e.target.value)} />
          <div className="flex justify-end gap-2">
            <Button variant="ghost" size="sm" onClick={() => setVoidModal(false)}>{t('common.cancel')}</Button>
            <Button variant="danger" size="sm" onClick={() => voidMutation.mutate()} disabled={voidMutation.isPending}>
              {voidMutation.isPending ? '…' : t('sales.void_invoice')}
            </Button>
          </div>
        </div>
      </Modal>
      <Modal open={deleteModal} onClose={() => setDeleteModal(false)} title={t('sales.delete_invoice')}>
        <div className="space-y-4">
          <p className="text-sm text-ink-secondary">{t('sales.delete_confirm_text')}</p>
          <div className="flex justify-end gap-2">
            <Button variant="ghost" size="sm" onClick={() => setDeleteModal(false)}>{t('common.cancel')}</Button>
            <Button variant="danger" size="sm" onClick={() => deleteMutation.mutate()} disabled={deleteMutation.isPending}>
              {deleteMutation.isPending ? '…' : t('common.delete')}
            </Button>
          </div>
        </div>
      </Modal>
    </>
  );

  // Phase 14.03 — view-mode renderer (Signature template). Active only on
  // saved invoices where viewMode hasn't been toggled off.
  // Drafts open in the editable form (single Save posts them); only posted
  // documents show the read-only template view.
  if (viewMode && !isNew && existing && existing.status !== 'draft') {
    const doc = invoiceToDocumentData({
      invoice: existing,
      items: (existingItems as InvoiceItemInsert[] as unknown as Parameters<typeof invoiceToDocumentData>[0]['items']),
      contact: contacts.find(c => c.id === existing.contact_id) ?? null,
      company: companyRow ?? null,
      products,
      warehouseName: warehouses.find(w => w.id === existing.warehouse_id)?.name ?? null,
      salespersonName: salespeople.find(p => p.id === existing.salesperson_id)?.name ?? null,
      paidAmount: appliedMap[existing.id] ?? 0,
    });
    return (
      <div className="signature-print-scope" style={{ display: 'flex', flexDirection: 'column', gap: '16px', paddingBottom: '32px' }}>
        {/* Top action bar (hidden when printing) */}
        <div
          data-print-hide
          style={{ display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap' }}
        >
          <button onClick={() => { if (confirmLeave()) navigate('/sales/invoices'); }} style={{
            background: 'transparent', border: 'none', cursor: 'pointer',
            fontSize: '13px', color: '#64748b',
          }}>← {t('sales.invoices_title')}</button>
          <span style={{ color: '#94a3b8' }}>/</span>
          <h1 style={{ margin: 0, fontSize: '20px', fontWeight: 700, color: '#1e293b', letterSpacing: '-.01em' }}>
            {existing.invoice_number}
          </h1>
          {statusPill(status)}
          <div style={{ marginInlineStart: 'auto', display: 'flex', gap: '8px' }}>
            {/* Edit opens the full-page editor (/edit) — the read-only view
                stays in the split workspace; save returns here. */}
            {canEdit && (
              <Button size="sm" onClick={() => navigate(`/sales/invoices/${existing.id}/edit`)}>
                ✎ {t('common.edit') || 'Edit'}
              </Button>
            )}
            {isConfirmed && !editMode && (
              <Button
                variant="ghost" size="sm"
                onClick={() => navigate(`/sales/invoices/${existing.id}/edit`)}
              >{t('sales.edit_invoice') || 'Edit invoice'}</Button>
            )}
            <Button
              variant="ghost" size="sm"
              onClick={() => {
                const cloneLines = (existingItems as InvoiceItemInsert[]).map((it) => ({
                  product_id:       it.product_id ?? null,
                  description:      it.description ?? '',
                  quantity:         String(it.quantity ?? 0),
                  unit_price:       String(it.unit_price ?? 0),
                  discount_percent: String(it.discount_percent ?? 0),
                  tax_rate:         String(it.tax_rate ?? 0),
                }));
                navigate('/sales/invoices/new', {
                  state: { cloneFrom: {
                    header: {
                      contact_id:     existing.contact_id,
                      salesperson_id: existing.salesperson_id ?? '',
                      warehouse_id:   existing.warehouse_id ?? '',
                      reference:      existing.reference ?? '',
                      notes:          existing.notes ?? '',
                      currency:       existing.currency,
                    },
                    prices_inclusive: existing.prices_inclusive ?? false,
                    lines: cloneLines,
                  } },
                });
              }}
            >⧉ {t('common.duplicate')}</Button>
            {isConfirmed && (
              <Button size="sm" onClick={() => navigate(`/sales/payments/new?contact=${existing.contact_id}`)}>
                💰 {t('sales.receive_payment') || 'Record Receipt'}
              </Button>
            )}
            {existing?.id && (
              <Button variant="ghost" size="sm" onClick={() => window.print()}>
                🖨 {t('print.print') || 'Print'}
              </Button>
            )}
            {/* Remove a wrong invoice straight from the view page:
                 draft → Delete (hard), confirmed → Void (reverses GL). */}
            {status === 'draft' && (
              <Button variant="danger" size="sm" onClick={() => setDeleteModal(true)}>
                {t('common.delete')}
              </Button>
            )}
            {isConfirmed && (
              <Button variant="danger" size="sm" onClick={() => setVoidModal(true)}>
                {t('sales.void_invoice')}
              </Button>
            )}
          </div>
        </div>

        {/* The A4 document, floating on a slate canvas */}
        <div className="signature-canvas" style={{ borderRadius: '12px', overflow: 'auto' }}>
          <ConfigurableDocTemplate data={doc} template={printTemplate} />
        </div>
        {dangerModals}
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '20px', paddingBottom: '64px' }}>
      {/* Header row */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap' }}>
        <button onClick={() => { if (confirmLeave()) navigate('/sales/invoices'); }} style={{
          background: 'transparent', border: 'none', cursor: 'pointer',
          fontSize: '13px', color: '#64748b',
        }}>← {t('sales.invoices_title')}</button>
        <span style={{ color: '#94a3b8' }}>/</span>
        <h1 style={{ margin: 0, fontSize: '20px', fontWeight: 700, color: '#1e293b', letterSpacing: '-.01em' }}>
          {isNew ? t('sales.new_invoice') : existing?.invoice_number ?? '…'}
        </h1>
        {!isNew && statusPill(status)}
        <div style={{ marginInlineStart: 'auto', display: 'flex', gap: '8px' }}>
          {/* Back to the read-only view (the split workspace) for saved
               invoices. Hidden on brand-new ones (nothing saved to view). */}
          {!isNew && existing && existing.status !== 'draft' && (
            <Button variant="ghost" size="sm" onClick={() => { if (confirmLeave()) navigate(`/sales/invoices/${existing.id}`); }}>
              {t('common.view') || 'View'}
            </Button>
          )}
          {/* ── New invoice (never saved yet) ── */}
          {isNew && (
            <>
              <Button variant="ghost" size="sm" onClick={() => { if (confirmLeave()) navigate('/sales/invoices'); }}>
                {t('common.cancel')}
              </Button>
              <Button size="sm" onClick={() => { setError(null); saveMutation.mutate(); }} disabled={saveMutation.isPending}>
                {saveMutation.isPending ? t('common.saving') : t('common.save')}
              </Button>
            </>
          )}
          {/* ── Existing DRAFT (view or edit mode) — single Save posts it ── */}
          {!isNew && status === 'draft' && (
            <>
              <Button variant="ghost" size="sm" onClick={() => { if (editMode) { setEditMode(false); setError(null); } else if (confirmLeave()) navigate('/sales/invoices'); }}>
                {t('common.cancel')}
              </Button>
              <Button size="sm" onClick={() => { setError(null); saveMutation.mutate(); }} disabled={saveMutation.isPending}>
                {saveMutation.isPending ? t('common.saving') : t('common.save')}
              </Button>
              {!editMode && (
                <Button variant="danger" size="sm" onClick={() => setDeleteModal(true)}>
                  {t('common.delete')}
                </Button>
              )}
            </>
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
              <Button variant="ghost" size="sm" onClick={() => { if (confirmLeave()) navigate(`/sales/invoices/${id}`); }}>
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
        <div className="glass-card" style={{ padding: '16px' }}>
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
            After this invoice ({fmt(roundedTotal)}), outstanding will be{' '}
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
      <div className="glass-card" style={{ padding: '20px' }}>
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
              onChange={(id) => { setHeader(h => ({ ...h, contact_id: id ?? '' })); setDirty(true); }}
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
            error={canEdit && lines.some(l => l.product_id) && !header.warehouse_id ? 'Required for stock items' : undefined}
          />
          <Input
            label={t('sales.reference')}
            value={header.reference}
            disabled={!canEdit || isVoid}
            onChange={e => setHeader(h => ({ ...h, reference: e.target.value }))}
          />
          <Select
            label={t('sales.currency')}
            options={currencyOptions(header.currency)}
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
      <div className="glass-card">
        <div className="border-b border-border-subtle px-5 py-3 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-ink-primary">{t('sales.line_items')}</h2>
          {canEdit && (
            <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer', userSelect: 'none' }}>
              <span style={{ fontSize: '12px', color: pricesInclusive ? '#7c3aed' : '#64748b', fontWeight: 500 }}>
                {pricesInclusive ? 'Tax-inclusive prices' : 'Tax-exclusive prices'}
              </span>
              <div
                onClick={() => { setPricesInclusive(v => !v); setDirty(true); }}
                style={{
                  width: '36px', height: '20px', borderRadius: '999px', cursor: 'pointer',
                  background: pricesInclusive ? '#7c3aed' : '#cbd5e1',
                  position: 'relative', transition: 'background 0.2s',
                }}
              >
                <div style={{
                  position: 'absolute', top: '2px',
                  left: pricesInclusive ? '18px' : '2px',
                  width: '16px', height: '16px', borderRadius: '50%',
                  background: '#fff', transition: 'left 0.2s',
                  boxShadow: '0 1px 3px rgba(0,0,0,.2)',
                }} />
              </div>
            </label>
          )}
        </div>
        <div className="overflow-x-auto">
          <table className="w-full table-fixed text-xs" style={{ minWidth: '900px' }}>
            <thead>
              <tr className="border-b border-border-subtle bg-surface-muted text-ink-tertiary">
                <th className="px-3 py-2 text-start font-medium" style={{ minWidth: '200px' }}>{t('sales.product')}</th>
                <th className="px-3 py-2 text-end font-medium" style={{ width: '72px' }}>{t('sales.qty')}</th>
                <th className="px-3 py-2 text-end font-medium" style={{ width: '112px' }}>{t('sales.unit_price')}</th>
                <th className="px-3 py-2 text-end font-medium" style={{ width: '84px' }}>{t('sales.disc_pct')}</th>
                <th className="px-3 py-2 text-end font-medium" style={{ width: '100px' }}>{t('sales.tax')}</th>
                <th className="px-3 py-2 text-end font-medium" style={{ width: '76px' }} title="Available stock (sum across warehouses)">Stock</th>
                <th className="px-3 py-2 text-end font-medium" style={{ width: '76px' }} title="Margin % vs MAC. Negative = selling at a loss.">Margin</th>
                <th className="px-3 py-2 text-end font-medium" style={{ width: '112px' }}>{t('sales.line_total')}</th>
                {canEdit && !isVoid && <th style={{ width: '36px' }} />}
              </tr>
            </thead>
            <tbody>
              {lines.map(line => (
                <tr key={line._key} className="border-b border-border-subtle last:border-0">
                  <td className="px-3 py-1.5 align-top">
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
                        <AddNewButton
                          noun="product"
                          query={query}
                          onClick={(q) => {
                            setProductQcLineKey(line._key);
                            setProductQcSeed(q);
                            setProductQcOpen(true);
                          }}
                        />
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
                    <input
                      className="mt-1 w-full rounded border border-transparent bg-transparent px-2 py-0.5 text-[11px] text-ink-tertiary placeholder:text-ink-tertiary hover:border-border-subtle focus:border-border-strong focus:bg-surface-subtle focus:text-ink-secondary disabled:opacity-60"
                      value={line.description}
                      disabled={!canEdit || isVoid}
                      placeholder={t('sales.description') + ' (optional)'}
                      onChange={e => updateLine(line._key, { description: e.target.value })}
                    />
                  </td>
                  <td className="px-3 py-1.5 align-top">
                    <input
                      type="number" min="0" step="1"
                      className="w-full rounded border border-border-strong bg-surface-subtle px-2 py-1 text-xs text-end text-ink-primary disabled:opacity-60"
                      value={line.quantity}
                      disabled={!canEdit || isVoid}
                      onChange={e => updateLine(line._key, { quantity: e.target.value })}
                    />
                  </td>
                  <td className="px-3 py-1.5 align-top">
                    <input
                      type="number" min="0" step="0.01"
                      className="w-full rounded border border-border-strong bg-surface-subtle px-2 py-1 text-xs text-end text-ink-primary disabled:opacity-60"
                      value={line.unit_price}
                      disabled={!canEdit || isVoid}
                      onChange={e => updateLine(line._key, { unit_price: e.target.value })}
                    />
                  </td>
                  <td className="px-3 py-1.5 align-top">
                    <input
                      type="number" min="0" max="100" step="0.01"
                      className="w-full rounded border border-border-strong bg-surface-subtle px-2 py-1 text-xs text-end text-ink-primary disabled:opacity-60"
                      value={line.discount_percent}
                      disabled={!canEdit || isVoid}
                      onChange={e => updateLine(line._key, { discount_percent: e.target.value })}
                    />
                  </td>
                  <td className="px-3 py-1.5 align-top">
                    <select
                      className="w-full rounded border border-border-strong bg-surface-subtle px-2 py-1 text-xs text-ink-primary disabled:opacity-60"
                      value={line.tax_rate}
                      disabled={!canEdit || isVoid}
                      onChange={e => updateLine(line._key, { tax_rate: e.target.value })}
                    >
                      {taxOpts.map(o => <option key={o.key} value={o.value}>{o.label}</option>)}
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
                        <td className={`px-3 py-1.5 align-top text-end font-mono ${stockCls}`} title={pid ? `On-hand: ${fmt(stock)} · After this line: ${fmt(projectedStock)}` : ''}>
                          {!pid ? '—' : projectedStock < 0 ? `${fmt(projectedStock)} ⚠` : fmt(stock)}
                        </td>
                        <td className={`px-3 py-1.5 align-top text-end font-mono ${marginCls}`} title={pid && mac > 0 ? `MAC: ${fmt(mac)} · Net price: ${fmt(netPrice)}` : 'No cost basis yet'}>
                          {!pid || mac <= 0 ? '—' : `${margin.toFixed(1)}%`}
                        </td>
                      </>
                    );
                  })()}
                  <td className="px-3 py-1.5 align-top text-end font-mono text-ink-primary">
                    {fmt(line.line_total)}
                  </td>
                  {canEdit && !isVoid && (
                    <td className="px-3 py-1.5 align-top">
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
        <div className="glass-card" style={{ overflow: 'hidden' }}>
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
            <div className="flex items-center justify-between text-ink-secondary">
              <span className="flex items-center gap-2">
                {t('sales.round_off')}
                {roundOffOverride !== null && (
                  <button
                    type="button"
                    onClick={() => { setRoundOffOverride(null); setDirty(true); }}
                    title="Return to automatic rounding from Settings → Company Settings"
                    className="rounded-full border border-border-subtle px-2 py-0.5 text-[10px] font-semibold text-brand-600 hover:bg-brand-50"
                  >
                    {t('sales.round_off_auto')}
                  </button>
                )}
              </span>
              <input
                type="number" step="0.01" min="-1" max="1"
                value={roundOffOverride !== null ? roundOffOverride : String(roundOff)}
                onChange={e => { setRoundOffOverride(e.target.value); setDirty(true); }}
                title="Automatic from Settings; type a value (±1.00) to round manually"
                className="h-7 w-24 rounded border border-border-subtle px-2 text-end font-mono text-sm"
              />
            </div>
            <div className="flex justify-between border-t border-border-subtle pt-2.5 mt-1 text-base font-semibold text-ink-primary">
              <span>Grand Total</span>
              <span className="font-mono">{header.currency} {fmt(roundedTotal)}</span>
            </div>
            {(() => {
              // Paid amount + balance: only meaningful for an existing
              // confirmed invoice that's in the openCustomerInvoices list.
              if (isNew || !id) return null;
              const thisInv = openCustomerInvoices.find(inv => inv.id === id);
              if (!thisInv) return null;
              const outstanding = Number(thisInv.outstanding ?? 0);
              // paid = what has already been received (DB total minus DB outstanding).
              // Use DB total_amount so unsaved edits don't create a phantom paid amount.
              const paid       = Number(thisInv.total_amount ?? 0) - outstanding;
              // balanceDue = live grand total minus what's already paid.
              // This stays correct even when line items are edited before saving.
              const balanceDue = roundedTotal - paid;
              return (
                <>
                  <div className="flex justify-between text-ink-secondary border-t border-border-subtle pt-2.5">
                    <span>Paid</span>
                    <span className="font-mono text-emerald-700">{fmt(paid)}</span>
                  </div>
                  <div className={`flex justify-between font-semibold ${balanceDue > 0.005 ? 'text-amber-700' : 'text-emerald-700'}`}>
                    <span>Balance Due</span>
                    <span className="font-mono">{header.currency} {fmt(balanceDue)}</span>
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

      {dangerModals}
    </div>
  );
}
