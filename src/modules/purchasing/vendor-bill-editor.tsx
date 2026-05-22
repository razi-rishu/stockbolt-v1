import { useState, useEffect, useCallback } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { getAdapter } from '@/data/index';
import { useAuthStore } from '@/store/auth';
import { Button } from '@/ui/button';
import { Input } from '@/ui/input';
import { SearchableSelect } from '@/ui/searchable-select';
import { ProductQuickCreate } from '@/components/quick-create/product-quick-create';
import { ContactPicker } from '@/components/contact-picker';
import { AccountingPreview, buildVendorBillPreview } from '@/components/accounting-preview';
// Phase 14.03 — Signature template view mode for saved bills.
import { TaxInvoiceTemplate } from '@/modules/print/_signature/templates/tax-invoice';
import { vendorBillToDocumentData } from '@/modules/print/_signature/adapters';
import '@/modules/print/_signature/print.css';
import type { VendorBillRow, VendorBillItemInsert, ContactRow, ProductRow, TaxRateRow, CoaRow } from '@/data/adapter';
import { calcPurchaseLine as _calc } from '@/core/purchasing/purchase-calc';

interface LineRow {
  _key: string;
  product_id: string | null;
  coa_account_id: string | null;
  warehouse_id: string | null;        // Phase 12.17 — per-line destination warehouse
  description: string;
  quantity: string;
  unit_cost: string;
  discount_percent: string;
  tax_rate: string;
  line_subtotal: number;
  discount_amount: number;
  tax_amount: number;
  line_total: number;
}

let _k = 0;
const newKey = () => `k${++_k}`;

function calcLine(l: LineRow) {
  return _calc({
    quantity: parseFloat(l.quantity) || 0,
    unit_cost: parseFloat(l.unit_cost) || 0,
    discount_percent: parseFloat(l.discount_percent) || 0,
    tax_rate: parseFloat(l.tax_rate) || 0,
  });
}

const emptyLine = (): LineRow => ({
  _key: newKey(), product_id: null, coa_account_id: null, warehouse_id: null, description: '',
  quantity: '1', unit_cost: '0', discount_percent: '0', tax_rate: '0',
  line_subtotal: 0, discount_amount: 0, tax_amount: 0, line_total: 0,
});
const fmt = (n: number) => n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const todayIso = () => new Date().toISOString().slice(0, 10);

export default function VendorBillEditorPage() {
  const { t } = useTranslation();
  const { company_id } = useAuthStore();
  const { id } = useParams<{ id: string }>();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const isNew = id === 'new';
  const linkedGrnId = searchParams.get('grn_id');

  const { data: suppliers = [] } = useQuery<ContactRow[]>({
    queryKey: ['contacts', company_id, 'supplier'],
    queryFn: () => getAdapter().contacts.list(company_id!, 'supplier'),
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
  const { data: coaAccounts = [] } = useQuery<CoaRow[]>({
    queryKey: ['coa', company_id],
    queryFn: () => getAdapter().coa.list(company_id!),
    enabled: !!company_id,
  });
  const { data: warehouses = [] } = useQuery({
    queryKey: ['warehouses', company_id],
    queryFn: () => getAdapter().warehouses.list(company_id!),
    enabled: !!company_id,
  });
  const { data: existing } = useQuery<VendorBillRow | null>({
    queryKey: ['vendor_bill', id],
    queryFn: () => getAdapter().vendorBills.getById(id!),
    enabled: !isNew && !!id,
  });
  const { data: existingItems = [] } = useQuery({
    queryKey: ['vendor_bill_items', id],
    queryFn: () => getAdapter().vendorBills.getItems(id!),
    enabled: !isNew && !!id,
  });
  // Phase 14.03 — company for view-mode template rendering.
  const { data: companyRow } = useQuery({
    queryKey: ['company', company_id],
    queryFn:  () => getAdapter().companies.getById(company_id!),
    enabled:  !!company_id && !isNew,
  });
  const { data: grnItems = [] } = useQuery({
    queryKey: ['goods_receipt_items_for_bill', linkedGrnId],
    queryFn: () => getAdapter().goodsReceipts.getItems(linkedGrnId!),
    enabled: isNew && !!linkedGrnId,
  });
  const { data: grnHeader } = useQuery({
    queryKey: ['goods_receipt', linkedGrnId],
    queryFn: () => getAdapter().goodsReceipts.getById(linkedGrnId!),
    enabled: isNew && !!linkedGrnId,
  });

  // Account dropdown for non-product lines (rent, utilities, services, etc.):
  // include any active asset/cogs/expense account so user can post to e.g. 1300
  // for direct stock receipts without a product, or 5xxx/6xxx for true expenses.
  const accountOpts = coaAccounts.filter(a =>
    a.is_active && (a.type === 'asset' || a.type === 'cogs' || a.type === 'expense')
  );

  // Look up an account by id (for the inline label when product is selected)
  const accountById = (id: string | null): { code: string; name: string } | null => {
    if (!id) return null;
    const a = coaAccounts.find(x => x.id === id);
    return a ? { code: a.code, name: a.name } : null;
  };

  // Resolve the account label shown for a product line:
  //  - if product has a purchase_account_id, use it
  //  - else fall back to "1300 Inventory" (default in the RPC)
  const resolveProductAccount = (productId: string | null): { code: string; name: string } => {
    if (productId) {
      const p = products.find(x => x.id === productId) as (ProductRow & { purchase_account_id?: string | null }) | undefined;
      if (p?.purchase_account_id) {
        const a = accountById(p.purchase_account_id);
        if (a) return a;
      }
    }
    const inv = coaAccounts.find(a => a.code === '1300');
    return inv ? { code: inv.code, name: inv.name } : { code: '1300', name: 'Inventory' };
  };

  const [header, setHeader] = useState({
    supplier_id: '', date: todayIso(), due_date: '', reference: '',
    supplier_bill_number: '', notes: '', currency: 'AED',
    linked_grn_id: linkedGrnId ?? '',
    landed_cost_total: '0',          // Phase 12.17 — freight + duty + customs
  });
  const [lines, setLines] = useState<LineRow[]>([emptyLine()]);
  const [error, setError] = useState<string | null>(null);
  // Phase 14.03 — view-first for saved bills. Renders the Signature
  // template by default; user clicks Edit to drop into the existing
  // editor. New bills skip this entirely (you're already entering it).
  const [viewMode, setViewMode] = useState(!isNew);

  // Phase 12.42 — quick-create product from inside the line picker.
  const [productQcOpen,    setProductQcOpen]    = useState(false);
  const [productQcSeed,    setProductQcSeed]    = useState('');
  const [productQcLineKey, setProductQcLineKey] = useState<string | null>(null);
  const [confirmModal, setConfirmModal] = useState(false);

  useEffect(() => {
    if (existing) {
      setHeader({
        supplier_id: existing.supplier_id,
        date: existing.date as string,
        due_date: (existing.due_date as string | null) ?? '',
        reference: existing.reference ?? '',
        supplier_bill_number: existing.supplier_bill_number ?? '',
        notes: existing.notes ?? '',
        currency: existing.currency,
        linked_grn_id: existing.linked_grn_id ?? '',
        landed_cost_total: String((existing as { landed_cost_total?: number }).landed_cost_total ?? 0),
      });
    }
  }, [existing]);

  useEffect(() => {
    if (existingItems.length > 0) {
      setLines(existingItems.map(item => {
        const base: LineRow = {
          _key: newKey(), product_id: item.product_id ?? null,
          coa_account_id: (item as { coa_account_id?: string | null }).coa_account_id ?? null,
          warehouse_id: (item as { warehouse_id?: string | null }).warehouse_id ?? null,
          description: item.description ?? '',
          quantity: String(item.quantity), unit_cost: String(item.unit_cost),
          discount_percent: String(item.discount_percent ?? 0),
          tax_rate: String(item.tax_rate ?? 0),
          line_subtotal: 0, discount_amount: 0, tax_amount: 0, line_total: 0,
        };
        return { ...base, ...calcLine(base) };
      }));
    }
  }, [existingItems]);

  // Pre-fill from GRN
  useEffect(() => {
    if (isNew && grnHeader) {
      setHeader(h => ({ ...h, supplier_id: grnHeader.supplier_id, linked_grn_id: grnHeader.id }));
    }
  }, [isNew, grnHeader]);

  useEffect(() => {
    if (isNew && grnItems.length > 0) {
      setLines(grnItems.map(item => {
        const base: LineRow = {
          _key: newKey(), product_id: item.product_id, coa_account_id: null,
          warehouse_id: (item as { warehouse_id?: string | null }).warehouse_id ?? null,
          description: '',
          quantity: String(item.qty_received), unit_cost: String(item.unit_cost),
          discount_percent: '0', tax_rate: '0',
          line_subtotal: 0, discount_amount: 0, tax_amount: 0, line_total: 0,
        };
        return { ...base, ...calcLine(base) };
      }));
    }
  }, [isNew, grnItems]);

  const subtotal      = lines.reduce((s, l) => s + l.line_subtotal, 0);
  const discountTotal = lines.reduce((s, l) => s + l.discount_amount, 0);
  const taxTotal      = lines.reduce((s, l) => s + l.tax_amount, 0);
  const grandTotal    = lines.reduce((s, l) => s + l.line_total, 0);

  // ── Supplier insight panel data ──────────────────────────────────────────
  // Pulls in once the supplier is picked. Same shape as the invoice
  // editor's customer insight.
  const { data: openSupplierBills = [] } = useQuery({
    queryKey: ['open_bills_for_supplier_insight', company_id, header.supplier_id],
    queryFn:  () => getAdapter().vendorBills.listOpenForSupplier(company_id!, header.supplier_id),
    enabled:  !!company_id && !!header.supplier_id,
  });
  const selectedSupplier = suppliers.find(s => s.id === header.supplier_id);
  const todayStr = todayIso();
  const supplierOutstanding = openSupplierBills
    .filter(b => b.id !== id)
    .reduce((s, b) => s + Number(b.outstanding ?? 0), 0);
  const overdueBills = openSupplierBills.filter(
    b => b.due_date && (b.due_date as unknown as string) < todayStr && Number(b.outstanding ?? 0) > 0.005,
  );

  // Last vendor payment to this supplier
  const { data: supplierPayments = [] } = useQuery({
    queryKey: ['vendor_payments_for_supplier', company_id, header.supplier_id],
    queryFn:  () => getAdapter().vendorPayments.list(company_id!),
    enabled:  !!company_id && !!header.supplier_id,
  });
  const lastVendorPayment = supplierPayments
    .filter(p => p.contact_id === header.supplier_id && p.status === 'confirmed')
    .sort((a, b) => (b.date as string).localeCompare(a.date as string))[0];

  // Live stock + MAC map (for projected stock + MAC-after columns)
  const { data: stockMap = {} } = useQuery({
    queryKey: ['current_stock_map', company_id],
    queryFn:  () => getAdapter().stockLedger.getCurrentStockMap(company_id!),
    enabled:  !!company_id,
  });

  const updateLine = useCallback((key: string, patch: Partial<LineRow>) => {
    setLines(prev => prev.map(l => {
      if (l._key !== key) return l;
      const u = { ...l, ...patch };
      return { ...u, ...calcLine(u) };
    }));
  }, []);

  const handleProductChange = (key: string, productId: string) => {
    const product = products.find(p => p.id === productId);
    if (product) updateLine(key, { product_id: productId, description: product.name, coa_account_id: null });
    else updateLine(key, { product_id: null, description: '' });
  };

  function buildItems(): VendorBillItemInsert[] {
    return lines.map((l, i) => ({
      bill_id: '',
      product_id: l.product_id,
      coa_account_id: l.coa_account_id,
      warehouse_id: l.warehouse_id,     // Phase 12.17 — per-line destination
      description: l.description || null,
      description_ar: null,
      quantity: parseFloat(l.quantity) || 0,
      unit_id: null,
      unit_cost: parseFloat(l.unit_cost) || 0,
      discount_percent: parseFloat(l.discount_percent) || 0,
      discount_amount: l.discount_amount,
      tax_category: 'standard',
      tax_rate: parseFloat(l.tax_rate) || null,
      tax_amount: l.tax_amount,
      line_subtotal: l.line_subtotal,
      line_total: l.line_total,
      linked_grn_item_id: null,
      sort_order: i,
    // VendorBillItemInsert type is regenerated from Supabase types; until
    // those refresh post-migration, allow the unknown warehouse_id field.
    } as unknown as VendorBillItemInsert));
  }

  const landedCost = parseFloat(header.landed_cost_total) || 0;

  const saveMutation = useMutation({
    mutationFn: async () => {
      if (!header.supplier_id) throw new Error(t('purchasing.error_supplier_required'));
      if (landedCost < 0) throw new Error('Landed cost cannot be negative');
      if (landedCost > 0 && header.linked_grn_id) {
        throw new Error('Landed cost is not allowed on GRN-linked bills. Post freight separately.');
      }
      // Per-product warehouse is required on standalone bills (the RPC
      // falls back to default if NULL, but explicit is better).
      const productLinesWithoutWh = lines.filter(l => l.product_id && !l.warehouse_id);
      if (!header.linked_grn_id && productLinesWithoutWh.length > 0) {
        throw new Error(`Pick a warehouse for ${productLinesWithoutWh.length} product line${productLinesWithoutWh.length === 1 ? '' : 's'}`);
      }

      const billNum = isNew ? await getAdapter().vendorBills.getNextNumber(company_id!) : existing!.bill_number;
      // total_amount includes landed cost so CR AP captures the full
      // commitment to the supplier.
      const totalWithLanded = +(grandTotal + landedCost).toFixed(2);
      const row = {
        company_id: company_id!, bill_number: billNum,
        supplier_bill_number: header.supplier_bill_number || null,
        supplier_id: header.supplier_id, date: header.date,
        due_date: header.due_date || null, reference: header.reference || null,
        currency: header.currency, exchange_rate: 1,
        subtotal: +subtotal.toFixed(2), discount_amount: +discountTotal.toFixed(2),
        tax_amount: +taxTotal.toFixed(2), total_amount: totalWithLanded,
        landed_cost_total: +landedCost.toFixed(2),    // Phase 12.17
        status: 'draft' as const,
        linked_grn_id: header.linked_grn_id || null,
        void_reason: null, voided_at: null, voided_by: null,
        notes: header.notes || null,
      };
      // Type cast: landed_cost_total isn't in the generated VendorBillInsert
      // yet (Supabase types regenerate post-migration).
      if (isNew) return getAdapter().vendorBills.create(row as unknown as Parameters<ReturnType<typeof getAdapter>['vendorBills']['create']>[0], buildItems());
      await getAdapter().vendorBills.update(id!, row as unknown as Parameters<ReturnType<typeof getAdapter>['vendorBills']['update']>[1], buildItems());
      return null;
    },
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ['vendor_bills', company_id] });
      if (isNew && data) navigate(`/purchasing/bills/${data.id}`);
      else {
        qc.invalidateQueries({ queryKey: ['vendor_bill', id] });
        qc.invalidateQueries({ queryKey: ['vendor_bill_items', id] });
      }
    },
    onError: (e: Error) => setError(e.message),
  });

  const confirmMutation = useMutation({
    mutationFn: () => getAdapter().vendorBills.confirm(id!),
    onSuccess: () => {
      setConfirmModal(false);
      qc.invalidateQueries({ queryKey: ['vendor_bills', company_id] });
      qc.invalidateQueries({ queryKey: ['vendor_bill', id] });
    },
    onError: (e: Error) => setError(e.message),
  });

  const canEdit = isNew || existing?.status === 'draft';
  // supplierOpts removed — supplier picker uses ContactPicker (D3).
  const productOpts = products.map(p => ({ value: p.id, label: `${p.sku}  ${p.name}` }));
  const taxOpts = [{ value: '0', label: t('sales.no_tax') }, ...taxRates.map(r => ({ value: String(r.rate), label: `${r.name} (${r.rate}%)` }))];
  // SearchableSelect handles its own placeholder — don't inject an empty option
  // (it would otherwise appear as a clickable row in the dropdown list).
  const expenseOpts = accountOpts.map(a => ({ value: a.id, label: `${a.code} ${a.name}` }));

  // Status pill helper (sample look)
  const statusPill = (status?: string) => {
    if (!status) return null;
    const map: Record<string, { bg: string; text: string; border: string }> = {
      draft:     { bg: '#fffbeb', text: '#b45309', border: '#fde68a' },
      confirmed: { bg: '#f0fdf4', text: '#15803d', border: '#bbf7d0' },
      void:      { bg: '#fef2f2', text: '#dc2626', border: '#fecaca' },
    };
    const p = map[status] ?? { bg: '#f1f5f9', text: '#64748b', border: '#e2e8f0' };
    return (
      <span style={{
        display: 'inline-block', padding: '3px 9px', borderRadius: '999px',
        fontSize: '11px', fontWeight: 600, textTransform: 'capitalize',
        background: p.bg, color: p.text, border: `1px solid ${p.border}`,
      }}>{status}</span>
    );
  };

  // Phase 14.03 — view-mode renderer (Signature template). Active only
  // on saved bills where viewMode hasn't been toggled off.
  if (viewMode && !isNew && existing) {
    const doc = vendorBillToDocumentData({
      bill: existing,
      items: existingItems as Parameters<typeof vendorBillToDocumentData>[0]['items'],
      supplier: suppliers.find(s => s.id === existing.supplier_id) ?? null,
      company: companyRow ?? null,
      products,
    });
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: '16px', paddingBottom: '32px' }}>
        <div
          data-no-print="true"
          style={{ display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap' }}
        >
          <button onClick={() => navigate('/purchasing/bills')} style={{
            background: 'transparent', border: 'none', cursor: 'pointer',
            fontSize: '13px', color: '#64748b',
          }}>← {t('purchasing.bills_title')}</button>
          <span style={{ color: '#94a3b8' }}>/</span>
          <h1 style={{ margin: 0, fontSize: '20px', fontWeight: 700, color: '#1e293b', letterSpacing: '-.01em' }}>
            {existing.bill_number}
          </h1>
          {statusPill(existing.status)}
          <div style={{ marginInlineStart: 'auto', display: 'flex', gap: '8px' }}>
            {canEdit && (
              <Button size="sm" onClick={() => setViewMode(false)}>
                ✎ {t('common.edit') || 'Edit'}
              </Button>
            )}
            <Button variant="ghost" size="sm" onClick={() => window.print()}>
              🖨 {t('print.print') || 'Print'}
            </Button>
          </div>
        </div>
        <div className="signature-canvas" style={{ borderRadius: '12px', overflow: 'auto' }}>
          <TaxInvoiceTemplate data={doc} />
        </div>
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '20px', paddingBottom: '64px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap' }}>
        <button onClick={() => navigate('/purchasing/bills')} style={{
          background: 'transparent', border: 'none', cursor: 'pointer',
          fontSize: '13px', color: '#64748b',
        }}>← {t('purchasing.bills_title')}</button>
        <span style={{ color: '#94a3b8' }}>/</span>
        <h1 style={{ margin: 0, fontSize: '20px', fontWeight: 700, color: '#1e293b', letterSpacing: '-.01em' }}>
          {isNew ? t('purchasing.new_bill') : existing?.bill_number ?? '…'}
        </h1>
        {!isNew && statusPill(existing?.status)}
        <div style={{ marginInlineStart: 'auto', display: 'flex', gap: '8px' }}>
          {/* Phase 14.03 — flip back into template view for saved bills. */}
          {!isNew && existing && (
            <Button variant="ghost" size="sm" onClick={() => setViewMode(true)}>
              {t('common.view') || 'View'}
            </Button>
          )}
          {!isNew && existing?.id && (
            <Button variant="ghost" size="sm" onClick={() => window.open(`/print/bill/${existing.id}`, '_blank')}>
              🖨 {t('print.print')}
            </Button>
          )}
          <Button variant="ghost" size="sm" onClick={() => navigate('/purchasing/bills')}>{t('common.cancel')}</Button>
          {canEdit && (
            <>
              <Button size="sm" onClick={() => { setError(null); saveMutation.mutate(); }} disabled={saveMutation.isPending}>
                {saveMutation.isPending ? t('common.saving') : t('common.save')}
              </Button>
              {!isNew && (
                <Button size="sm" onClick={() => setConfirmModal(true)}>{t('purchasing.confirm_bill')}</Button>
              )}
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

      {/* Supplier Insight Panel — appears once a supplier is picked.
           Shows payable, overdue, last payment so the buyer has full
           context while writing the bill. */}
      {selectedSupplier && (
        <div style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: '12px', boxShadow: '0 1px 2px rgba(15,23,42,.04)', padding: '16px' }}>
          <div className="grid grid-cols-2 gap-4 md:grid-cols-3">
            <div>
              <p className="text-xs uppercase tracking-wide text-ink-tertiary">Payable</p>
              <p className={`mt-0.5 text-lg font-mono font-semibold ${supplierOutstanding > 0 ? 'text-amber-700' : 'text-ink-primary'}`}>
                {header.currency} {fmt(supplierOutstanding)}
              </p>
              <p className="text-xs text-ink-tertiary mt-0.5">
                {openSupplierBills.filter(b => b.id !== id).length} pending bill{openSupplierBills.length === 1 ? '' : 's'}
              </p>
            </div>
            <div>
              <p className="text-xs uppercase tracking-wide text-ink-tertiary">Overdue</p>
              <p className={`mt-0.5 text-lg font-mono font-semibold ${overdueBills.length > 0 ? 'text-red-600' : 'text-ink-primary'}`}>
                {overdueBills.length}
              </p>
              <p className="text-xs text-ink-tertiary mt-0.5">
                {overdueBills.length > 0
                  ? `${fmt(overdueBills.reduce((s, b) => s + Number(b.outstanding ?? 0), 0))} past due`
                  : 'No overdue'}
              </p>
            </div>
            <div>
              <p className="text-xs uppercase tracking-wide text-ink-tertiary">Last payment</p>
              {lastVendorPayment ? (
                <>
                  <p className="mt-0.5 text-lg font-mono font-semibold text-ink-primary">
                    {header.currency} {fmt(Number(lastVendorPayment.amount))}
                  </p>
                  <p className="text-xs text-ink-tertiary mt-0.5">{lastVendorPayment.date as string}</p>
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

      {confirmModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="w-80 rounded-card bg-surface-card p-6 shadow-xl">
            <h3 className="mb-3 text-base font-semibold text-ink-primary">{t('purchasing.confirm_bill')}</h3>
            <p className="mb-5 text-sm text-ink-secondary">{t('purchasing.confirm_bill_desc')}</p>
            <div className="flex gap-2 justify-end">
              <Button variant="ghost" size="sm" onClick={() => setConfirmModal(false)}>{t('common.cancel')}</Button>
              <Button size="sm" onClick={() => confirmMutation.mutate()} disabled={confirmMutation.isPending}>
                {confirmMutation.isPending ? t('common.saving') : t('purchasing.confirm_bill')}
              </Button>
            </div>
          </div>
        </div>
      )}

      <div style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: '12px', boxShadow: '0 1px 2px rgba(15,23,42,.04)', padding: '20px' }}>
        <h2 className="mb-4 text-sm font-semibold text-ink-primary">{t('purchasing.bill_details')}</h2>
        <div className="grid grid-cols-2 gap-4 md:grid-cols-3">
          <div className="col-span-2 md:col-span-1">
            <label className="mb-1 block text-sm font-medium text-ink-primary">
              {t('purchasing.supplier')} <span className="text-danger-500">*</span>
            </label>
            <ContactPicker
              type="supplier"
              value={header.supplier_id}
              disabled={!canEdit}
              onChange={(id) => setHeader(h => ({ ...h, supplier_id: id ?? '' }))}
              placeholder={t('purchasing.select_supplier')}
              panelWidth={380}
            />
          </div>
          <Input label={t('purchasing.date')} type="date" required value={header.date}
            disabled={!canEdit} onChange={e => setHeader(h => ({ ...h, date: e.target.value }))} />
          <Input label={t('purchasing.due_date')} type="date" value={header.due_date}
            disabled={!canEdit} onChange={e => setHeader(h => ({ ...h, due_date: e.target.value }))} />
          <Input label={t('purchasing.supplier_ref')} value={header.supplier_bill_number}
            disabled={!canEdit} onChange={e => setHeader(h => ({ ...h, supplier_bill_number: e.target.value }))} />
          <Input label={t('purchasing.reference')} value={header.reference}
            disabled={!canEdit} onChange={e => setHeader(h => ({ ...h, reference: e.target.value }))} />
          <Input label={t('purchasing.currency')} value={header.currency}
            disabled={!canEdit} onChange={e => setHeader(h => ({ ...h, currency: e.target.value }))} />
          {/* Landed cost — freight + duty + customs + insurance.
               Only allowed on standalone bills (RPC enforces). */}
          {!header.linked_grn_id && (
            <Input
              label="Landed cost (freight/duty)"
              type="number" min="0" step="0.01"
              value={header.landed_cost_total}
              disabled={!canEdit}
              onChange={e => setHeader(h => ({ ...h, landed_cost_total: e.target.value }))}
            />
          )}
        </div>
        {header.linked_grn_id && (
          <p className="mt-2 text-xs text-ink-tertiary">{t('purchasing.linked_grn')}: {header.linked_grn_id}</p>
        )}
      </div>

      {/* Line items + Sticky sidebar */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[1fr_320px]">
      <div style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: '12px', boxShadow: '0 1px 2px rgba(15,23,42,.04)' }}>
        <div className="border-b border-border-subtle px-5 py-3">
          <h2 className="text-sm font-semibold text-ink-primary">{t('purchasing.line_items')}</h2>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-border-subtle bg-surface-muted text-ink-tertiary">
                <th className="px-3 py-2 text-start font-medium w-36">{t('purchasing.product')}</th>
                <th className="px-3 py-2 text-start font-medium w-36">{t('purchasing.account')}</th>
                <th className="px-3 py-2 text-start font-medium w-32">{t('purchasing.description')}</th>
                <th className="px-3 py-2 text-end font-medium w-20">{t('purchasing.qty')}</th>
                <th className="px-3 py-2 text-end font-medium w-24">{t('purchasing.unit_cost')}</th>
                <th className="px-3 py-2 text-end font-medium w-20">{t('purchasing.disc_pct')}</th>
                <th className="px-3 py-2 text-end font-medium w-24">{t('purchasing.tax')}</th>
                <th className="px-3 py-2 text-start font-medium w-32" title="Destination warehouse for this line">Warehouse</th>
                <th className="px-3 py-2 text-end font-medium w-20" title="On-hand stock">Stock</th>
                <th className="px-3 py-2 text-end font-medium w-24" title="Projected MAC after this purchase">MAC →</th>
                <th className="px-3 py-2 text-end font-medium w-24">{t('purchasing.line_total')}</th>
                {canEdit && <th className="w-10" />}
              </tr>
            </thead>
            <tbody>
              {lines.map(line => (
                <tr key={line._key} className="border-b border-border-subtle last:border-0">
                  <td className="px-3 py-1.5">
                    <SearchableSelect
                      options={productOpts}
                      value={line.product_id ?? ''}
                      disabled={!canEdit}
                      onChange={(v) => handleProductChange(line._key, v)}
                      placeholder={'— ' + t('purchasing.select_product') + ' —'}
                      panelWidth={360}
                      addNew={canEdit ? {
                        noun: 'product',
                        onClick: (q) => {
                          setProductQcLineKey(line._key);
                          setProductQcSeed(q);
                          setProductQcOpen(true);
                        },
                      } : undefined}
                    />
                  </td>
                  <td className="px-3 py-1.5">
                    {line.product_id ? (
                      // Resolved from the product's Purchase Account (read-only display)
                      (() => {
                        const acc = resolveProductAccount(line.product_id);
                        return (
                          <div className="rounded border border-border-subtle bg-surface-muted px-2 py-1 text-xs text-ink-tertiary truncate" title={`${acc.code} ${acc.name}`}>
                            {acc.code} {acc.name}
                          </div>
                        );
                      })()
                    ) : (
                      <SearchableSelect
                        value={line.coa_account_id ?? ''}
                        onChange={(v) => updateLine(line._key, { coa_account_id: v || null })}
                        options={expenseOpts}
                        placeholder={'— ' + t('purchasing.select_account') + ' —'}
                        disabled={!canEdit}
                        panelWidth={320}
                      />
                    )}
                  </td>
                  <td className="px-3 py-1.5">
                    <input className="w-full rounded border border-border-strong bg-surface-subtle px-2 py-1 text-xs disabled:opacity-60"
                      value={line.description} disabled={!canEdit}
                      onChange={e => updateLine(line._key, { description: e.target.value })} />
                  </td>
                  <td className="px-3 py-1.5">
                    <input type="number" min="0" step="1"
                      className="w-full rounded border border-border-strong bg-surface-subtle px-2 py-1 text-xs text-end disabled:opacity-60"
                      value={line.quantity} disabled={!canEdit}
                      onChange={e => updateLine(line._key, { quantity: e.target.value })} />
                  </td>
                  <td className="px-3 py-1.5">
                    <input type="number" min="0" step="0.01"
                      className="w-full rounded border border-border-strong bg-surface-subtle px-2 py-1 text-xs text-end disabled:opacity-60"
                      value={line.unit_cost} disabled={!canEdit}
                      onChange={e => updateLine(line._key, { unit_cost: e.target.value })} />
                  </td>
                  <td className="px-3 py-1.5">
                    <input type="number" min="0" max="100" step="0.01"
                      className="w-full rounded border border-border-strong bg-surface-subtle px-2 py-1 text-xs text-end disabled:opacity-60"
                      value={line.discount_percent} disabled={!canEdit}
                      onChange={e => updateLine(line._key, { discount_percent: e.target.value })} />
                  </td>
                  <td className="px-3 py-1.5">
                    <select className="w-full rounded border border-border-strong bg-surface-subtle px-2 py-1 text-xs disabled:opacity-60"
                      value={line.tax_rate} disabled={!canEdit}
                      onChange={e => updateLine(line._key, { tax_rate: e.target.value })}>
                      {taxOpts.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                    </select>
                  </td>
                  {/* Warehouse picker — only meaningful for product lines on
                       standalone bills (no GRN). For GRN-linked bills the
                       GRN's warehouse already governs; leave disabled. */}
                  <td className="px-3 py-1.5">
                    {line.product_id && !header.linked_grn_id ? (
                      <select
                        className="w-full rounded border border-border-strong bg-surface-subtle px-2 py-1 text-xs disabled:opacity-60"
                        value={line.warehouse_id ?? ''}
                        disabled={!canEdit}
                        onChange={e => updateLine(line._key, { warehouse_id: e.target.value || null })}
                      >
                        <option value="">— pick —</option>
                        {warehouses.map(w => <option key={w.id} value={w.id}>{w.name}</option>)}
                      </select>
                    ) : (
                      <span className="text-ink-tertiary text-xs">—</span>
                    )}
                  </td>
                  {(() => {
                    // Stock + projected MAC. Only meaningful for product lines.
                    const pid = line.product_id;
                    if (!pid) {
                      return (
                        <>
                          <td className="px-3 py-1.5 text-end font-mono text-ink-tertiary">—</td>
                          <td className="px-3 py-1.5 text-end font-mono text-ink-tertiary">—</td>
                        </>
                      );
                    }
                    const s = stockMap[pid];
                    const curQty = s?.qty ?? 0;
                    const curMac = s?.mac ?? 0;
                    const addQty = parseFloat(line.quantity) || 0;
                    const addCost = parseFloat(line.unit_cost) || 0;
                    const disc   = parseFloat(line.discount_percent) || 0;
                    const effUnit = addCost * (1 - disc / 100);
                    // MAC after = (existing value + incoming value) / (existing qty + incoming qty)
                    const totalQty = curQty + addQty;
                    const newMac = totalQty > 0
                      ? (curQty * curMac + addQty * effUnit) / totalQty
                      : 0;
                    const macDelta = newMac - curMac;
                    const macCls = curMac > 0 && Math.abs(macDelta) > 0.005
                      ? (macDelta > 0 ? 'text-amber-700' : 'text-emerald-700')
                      : 'text-ink-secondary';
                    return (
                      <>
                        <td className="px-3 py-1.5 text-end font-mono text-ink-secondary" title={`On-hand: ${fmt(curQty)}, after: ${fmt(totalQty)}`}>
                          {fmt(curQty)}
                        </td>
                        <td className={`px-3 py-1.5 text-end font-mono ${macCls}`} title={curMac > 0 ? `Current MAC: ${fmt(curMac)} → after: ${fmt(newMac)}` : `New MAC will be ${fmt(newMac)}`}>
                          {addQty > 0 ? fmt(newMac) : (curMac > 0 ? fmt(curMac) : '—')}
                        </td>
                      </>
                    );
                  })()}
                  <td className="px-3 py-1.5 text-end font-mono text-ink-primary">{fmt(line.line_total)}</td>
                  {canEdit && (
                    <td className="px-3 py-1.5">
                      <button className="text-red-400 hover:text-red-600 disabled:opacity-30"
                        disabled={lines.length === 1}
                        onClick={() => setLines(prev => prev.filter(l => l._key !== line._key))}>×</button>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {canEdit && (
          <div className="border-t border-border-subtle px-5 py-2">
            <button className="text-xs text-brand-600 hover:text-brand-700"
              onClick={() => setLines(prev => [...prev, emptyLine()])}>
              + {t('purchasing.add_line')}
            </button>
          </div>
        )}
      </div>

      {/* Sticky financial summary sidebar + accounting preview */}
      <aside className="space-y-4 lg:sticky lg:top-4 lg:self-start">
        <div style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: '12px', boxShadow: '0 1px 2px rgba(15,23,42,.04)', overflow: 'hidden' }}>
          <div className="border-b border-border-subtle px-4 py-2.5 bg-surface-muted/40">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-ink-tertiary">Summary</h3>
          </div>
          <div className="p-4 space-y-2 text-sm">
            <div className="flex justify-between text-ink-secondary">
              <span>{t('purchasing.subtotal')}</span>
              <span className="font-mono">{fmt(subtotal)}</span>
            </div>
            {discountTotal > 0 && (
              <div className="flex justify-between text-ink-secondary">
                <span>{t('purchasing.discount')}</span>
                <span className="font-mono text-red-600">−{fmt(discountTotal)}</span>
              </div>
            )}
            {taxTotal > 0 && (
              <div className="flex justify-between text-ink-secondary">
                <span>{t('purchasing.vat')}</span>
                <span className="font-mono">{fmt(taxTotal)}</span>
              </div>
            )}
            {landedCost > 0 && (
              <div className="flex justify-between text-ink-secondary">
                <span>Landed cost</span>
                <span className="font-mono">{fmt(landedCost)}</span>
              </div>
            )}
            <div className="flex justify-between border-t border-border-subtle pt-2.5 mt-1 text-base font-semibold text-ink-primary">
              <span>Grand Total</span>
              <span className="font-mono">{header.currency} {fmt(grandTotal + landedCost)}</span>
            </div>
            {(() => {
              // Paid / Balance Due only for existing confirmed bills.
              if (isNew || !id) return null;
              const thisBill = openSupplierBills.find(b => b.id === id);
              if (!thisBill) return null;
              const outstanding = Number(thisBill.outstanding ?? 0);
              const paid = (grandTotal + landedCost) - outstanding;
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

        {/* Accounting preview — what confirm_vendor_bill will post. */}
        {lines.some(l => l.product_id || l.coa_account_id) && (() => {
          const preview = buildVendorBillPreview({
            bill_number: existing?.bill_number,
            landed_cost_total: landedCost,
            lines: lines.map(l => {
              // For inventory lines: product_id is set; for expense lines:
              // coa_account_id is set and we attach the COA code/name for display.
              const expenseAcc = !l.product_id && l.coa_account_id
                ? coaAccounts.find(a => a.id === l.coa_account_id)
                : undefined;
              return {
                product_id:        l.product_id,
                coa_account_id:    l.coa_account_id,
                coa_account_code:  expenseAcc?.code,
                coa_account_name:  expenseAcc?.name,
                quantity:          parseFloat(l.quantity) || 0,
                unit_cost:         parseFloat(l.unit_cost) || 0,
                discount_percent:  parseFloat(l.discount_percent) || 0,
                tax_amount:        l.tax_amount,
              };
            }),
          });
          if (preview.length === 0) return null;
          return <AccountingPreview lines={preview} currency={header.currency || 'AED'} />;
        })()}
      </aside>
      </div>

      {/* Phase 12.42 — quick-create product modal (auto-drops new product
           onto the line that triggered it). */}
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
    </div>
  );
}
