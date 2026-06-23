import { useState, useEffect, useCallback, useRef } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { useNavigate, useParams } from 'react-router-dom';
import { getAdapter } from '@/data/index';
import { useAuthStore } from '@/store/auth';
import { useCompanyCurrency, useCompanyCountry } from '@/hooks/use-company-currency';
import { defaultTaxRate } from '@/lib/locale';
import { useUnsavedChangesGuard } from '@/hooks/use-unsaved-changes-guard';
import { Button } from '@/ui/button';
import { Input } from '@/ui/input';
import { Select } from '@/ui/select';
import { SearchableSelect } from '@/ui/searchable-select';
import { currencyOptions } from '@/lib/currencies';
import { ProductQuickCreate } from '@/components/quick-create/product-quick-create';
// Phase 14.04 — Signature template view mode for saved POs.
import { ConfigurableDocTemplate } from '@/modules/print/engine/ConfigurableDocTemplate';
import { useResolvedPrintTemplate } from '@/hooks/use-resolved-print-template';
import { purchaseOrderToDocumentData } from '@/modules/print/_signature/adapters';
import '@/modules/print/_signature/print.css';
import type { PurchaseOrderRow, PurchaseOrderItemRow, PurchaseOrderItemInsert, ContactRow, ProductRow, TaxRateRow, WarehouseRow, Company } from '@/data/adapter';
import { calcPurchaseLine as _calc } from '@/core/purchasing/purchase-calc';

interface LineRow {
  _key: string;
  product_id: string | null;
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
  _key: newKey(), product_id: null, description: '',
  quantity: '1', unit_cost: '0', discount_percent: '0', tax_rate: '0',
  line_subtotal: 0, discount_amount: 0, tax_amount: 0, line_total: 0,
});
const fmt = (n: number) => n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const todayIso = () => new Date().toISOString().slice(0, 10);

export default function POEditorPage() {
  const { t } = useTranslation();
  const { company_id } = useAuthStore();
  const companyCurrency = useCompanyCurrency();    // Phase 14.14m
  const companyCountry = useCompanyCountry();       // Phase 21 — country standard tax rate
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const printTemplate = useResolvedPrintTemplate('purchase_order');
  const qc = useQueryClient();
  const isNew = id === 'new';

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
  // Phase 21 — company standard tax rate (5% GCC / 18% India), matched to a seeded row.
  const stdTaxRate = (() => {
    const target = defaultTaxRate(companyCountry);
    const hit = taxRates.find(r => r.is_active && Number(r.rate) === target);
    return hit ? String(hit.rate) : '0';
  })();
  const { data: warehouses = [] } = useQuery<WarehouseRow[]>({
    queryKey: ['warehouses', company_id],
    queryFn: () => getAdapter().warehouses.list(company_id!),
    enabled: !!company_id,
  });
  const { data: existing } = useQuery<PurchaseOrderRow | null>({
    queryKey: ['purchase_order', id],
    queryFn: () => getAdapter().purchaseOrders.getById(id!),
    enabled: !isNew && !!id,
  });
  const { data: existingItems = [] } = useQuery<PurchaseOrderItemRow[]>({
    queryKey: ['purchase_order_items', id],
    queryFn: () => getAdapter().purchaseOrders.getItems(id!),
    enabled: !isNew && !!id,
  });
  // Phase 14.04 — company row for the Signature template header.
  const { data: companyRow } = useQuery<Company | null>({
    queryKey: ['company', company_id],
    queryFn: () => getAdapter().companies.getById(company_id!),
    enabled: !!company_id,
  });

  // Phase 14.04 — view-first mode for saved POs.
  const [viewMode, setViewMode] = useState(!isNew);

  const [header, setHeader] = useState({
    supplier_id: '', warehouse_id: '', date: todayIso(),
    expected_delivery_date: '', reference: '', notes: '', currency: companyCurrency,
  });
  const [lines, setLines] = useState<LineRow[]>([emptyLine()]);
  const [error, setError] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);
  const confirmLeave = useUnsavedChangesGuard(dirty);

  // Phase 12.42 — quick-create product from inside the line picker.
  const [productQcOpen,    setProductQcOpen]    = useState(false);
  const [productQcSeed,    setProductQcSeed]    = useState('');
  const [productQcLineKey, setProductQcLineKey] = useState<string | null>(null);

  useEffect(() => {
    if (existing) {
      setHeader({
        supplier_id: existing.supplier_id,
        warehouse_id: existing.warehouse_id ?? '',
        date: existing.date as string,
        expected_delivery_date: (existing.expected_delivery_date as string | null) ?? '',
        reference: existing.reference ?? '',
        notes: existing.notes ?? '',
        currency: existing.currency,
      });
    }
  }, [existing]);

  useEffect(() => {
    if (existingItems.length > 0) {
      setLines(existingItems.map(item => {
        const base: LineRow = {
          _key: newKey(), product_id: item.product_id ?? null,
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

  const subtotal      = lines.reduce((s, l) => s + l.line_subtotal, 0);
  const discountTotal = lines.reduce((s, l) => s + l.discount_amount, 0);
  const taxTotal      = lines.reduce((s, l) => s + l.tax_amount, 0);
  const grandTotal    = lines.reduce((s, l) => s + l.line_total, 0);

  const updateLine = useCallback((key: string, patch: Partial<LineRow>) => {
    setLines(prev => prev.map(l => {
      if (l._key !== key) return l;
      const u = { ...l, ...patch };
      return { ...u, ...calcLine(u) };
    }));
    setDirty(true);
  }, []);

  // Phase 21 — pre-fill the pristine opening line on a NEW PO with the company
  // standard rate once tax rates + country resolve (runs once, untouched line only).
  const seededDefaultRate = useRef(false);
  useEffect(() => {
    if (!isNew || seededDefaultRate.current || stdTaxRate === '0') return;
    seededDefaultRate.current = true;
    setLines(prev => prev.map(l =>
      (l.product_id == null && l.description === '' && l.tax_rate === '0')
        ? { ...l, tax_rate: stdTaxRate, ...calcLine({ ...l, tax_rate: stdTaxRate }) }
        : l));
  }, [isNew, stdTaxRate]);

  const handleProductChange = (key: string, productId: string) => {
    const product = products.find(p => p.id === productId);
    if (product) {
      const matchedRate = taxRates.find(r => r.is_active && r.tax_type === product.tax_category);
      updateLine(key, {
        product_id:  productId,
        description: product.name,
        unit_cost:   '0',
        tax_rate:    String(matchedRate?.rate ?? 0),
      });
    } else {
      updateLine(key, { product_id: null, description: '' });
    }
  };

  function buildItems(): PurchaseOrderItemInsert[] {
    return lines.map((l, i) => ({
      po_id: '',
      product_id: l.product_id,
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
      sort_order: i,
    }));
  }

  const saveMutation = useMutation({
    mutationFn: async () => {
      if (!header.supplier_id) throw new Error(t('purchasing.error_supplier_required'));
      const poNum = isNew ? await getAdapter().purchaseOrders.getNextNumber(company_id!) : existing!.po_number;
      const row = {
        company_id: company_id!, po_number: poNum,
        supplier_id: header.supplier_id, buyer_id: null,
        warehouse_id: header.warehouse_id || null,
        date: header.date,
        expected_delivery_date: header.expected_delivery_date || null,
        reference: header.reference || null,
        currency: header.currency, exchange_rate: 1,
        subtotal: +subtotal.toFixed(2), discount_amount: +discountTotal.toFixed(2),
        tax_amount: +taxTotal.toFixed(2), total_amount: +grandTotal.toFixed(2),
        status: 'draft' as const,
        terms: null, terms_ar: null, notes: header.notes || null,
      };
      if (isNew) return getAdapter().purchaseOrders.create(row, buildItems());
      await getAdapter().purchaseOrders.update(id!, row, buildItems());
      return null;
    },
    onSuccess: (data) => {
      setDirty(false);
      qc.invalidateQueries({ queryKey: ['purchase_orders', company_id] });
      if (isNew && data) navigate('/purchasing/orders');
      else {
        qc.invalidateQueries({ queryKey: ['purchase_order', id] });
        qc.invalidateQueries({ queryKey: ['purchase_order_items', id] });
      }
    },
    onError: (e: Error) => setError(e.message),
  });

  // Phase 12.47 — Convert this PO into a draft vendor bill. After
  // success the new bill takes over the screen so the user can fill
  // supplier_bill_number, due_date and warehouse before confirming.
  const convertToBillMutation = useMutation({
    mutationFn: () => getAdapter().purchaseOrders.convertToBill(id!),
    onSuccess: (bill) => {
      qc.invalidateQueries({ queryKey: ['vendor_bills',     company_id] });
      qc.invalidateQueries({ queryKey: ['purchase_orders',  company_id] });
      qc.invalidateQueries({ queryKey: ['purchase_order',   id] });
      navigate(`/purchasing/bills/${bill.id}`);
    },
    onError: (e: Error) => setError(e.message),
  });

  const canEdit = isNew || existing?.status === 'draft';
  // Phase 12.47 → 12.48 — converting a draft PO is fine. The UI has no
  // explicit "Send" button so POs stay in 'draft' for the entire SME
  // workflow (write → bill arrives → convert). Only block terminal
  // states (closed / void) and the brand-new unsaved screen.
  const canConvertToBill = !isNew
    && !!existing
    && !['closed', 'void'].includes(existing.status);
  const supplierOpts = suppliers.map(s => ({ value: s.id, label: s.name }));
  const warehouseOpts = [{ value: '', label: t('purchasing.select_warehouse') }, ...warehouses.map(w => ({ value: w.id, label: w.name }))];
  const productOpts = products.map(p => ({ value: p.id, label: `${p.sku}  ${p.name}` }));
  const taxOpts = [
    { key: '__none__', value: '', label: t('sales.no_tax') },
    ...taxRates.map(r => ({ key: r.id, value: String(r.rate), label: `${r.name} (${r.rate}%)` })),
  ];

  // Phase 14.04 — view-mode renderer (Signature template).
  if (viewMode && !isNew && existing) {
    const doc = purchaseOrderToDocumentData({
      po: existing,
      items: existingItems,
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
          <button onClick={() => { if (confirmLeave()) navigate('/purchasing/orders'); }} style={{
            background: 'transparent', border: 'none', cursor: 'pointer',
            fontSize: '13px', color: '#64748b',
          }}>← {t('purchasing.po_title')}</button>
          <span style={{ color: '#94a3b8' }}>/</span>
          <h1 style={{ margin: 0, fontSize: '20px', fontWeight: 700, color: '#1e293b', letterSpacing: '-.01em' }}>
            {existing.po_number}
          </h1>
          <span style={{
            display: 'inline-block', padding: '3px 9px', borderRadius: '999px',
            fontSize: '11px', fontWeight: 600, textTransform: 'capitalize',
            background: '#f1f5f9', color: '#64748b', border: '1px solid #e2e8f0',
          }}>{existing.status}</span>
          <div style={{ marginInlineStart: 'auto', display: 'flex', gap: '8px' }}>
            {canEdit && (
              <Button size="sm" onClick={() => setViewMode(false)}>
                ✎ {t('common.edit') || 'Edit'}
              </Button>
            )}
            {canConvertToBill && (
              <Button
                size="sm"
                onClick={() => { setError(null); convertToBillMutation.mutate(); }}
                disabled={convertToBillMutation.isPending}
              >
                {convertToBillMutation.isPending ? 'Converting…' : 'Convert to Bill'}
              </Button>
            )}
            {existing?.id && (
              <Button variant="ghost" size="sm" onClick={() => window.print()}>
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
    <div className="space-y-6 pb-16">
      <div className="flex items-center gap-3">
        <button onClick={() => { if (confirmLeave()) navigate('/purchasing/orders'); }} className="text-sm text-ink-secondary hover:text-ink-primary">← {t('purchasing.po_title')}</button>
        <span className="text-ink-tertiary">/</span>
        <h1 className="text-xl font-semibold text-ink-primary">{isNew ? t('purchasing.new_po') : existing?.po_number ?? '…'}</h1>
        {!isNew && <span className="rounded-pill bg-gray-100 px-2.5 py-0.5 text-xs capitalize text-gray-600">{existing?.status}</span>}
        <div className="ms-auto flex gap-2">
          {!isNew && existing && (
            <Button variant="ghost" size="sm" onClick={() => setViewMode(true)}>
              {t('common.view') || 'View'}
            </Button>
          )}
          {!isNew && existing?.id && (
            <Button variant="ghost" size="sm" onClick={() => window.open(`/print/po/${existing.id}`, '_blank')}>
              🖨 {t('print.print')}
            </Button>
          )}
          <Button variant="ghost" size="sm" onClick={() => { if (confirmLeave()) navigate('/purchasing/orders'); }}>{t('common.cancel')}</Button>
          {canEdit && (
            <Button size="sm" onClick={() => { setError(null); saveMutation.mutate(); }} disabled={saveMutation.isPending}>
              {saveMutation.isPending ? t('common.saving') : t('common.save')}
            </Button>
          )}
          {!isNew && existing?.status === 'received' && (
            <Button size="sm" variant="ghost" onClick={() => navigate(`/purchasing/grns/new?po_id=${existing.id}`)}>
              {t('purchasing.create_grn')}
            </Button>
          )}
          {/* Phase 12.47 — Convert PO -> draft vendor Bill. Cheaper path
               for SME shops that don't want to GRN every order. */}
          {canConvertToBill && (
            <Button
              size="sm"
              onClick={() => { setError(null); convertToBillMutation.mutate(); }}
              disabled={convertToBillMutation.isPending}
            >
              {convertToBillMutation.isPending ? 'Converting…' : 'Convert to Bill'}
            </Button>
          )}
        </div>
      </div>

      {error && <div className="rounded-input bg-red-50 px-4 py-2 text-sm text-red-700">{error}</div>}

      <div className="glass-card p-5">
        <h2 className="mb-4 text-sm font-semibold text-ink-primary">{t('purchasing.po_details')}</h2>
        <div className="grid grid-cols-2 gap-4 md:grid-cols-3">
          <div className="col-span-2 md:col-span-1">
            <label className="mb-1 block text-sm font-medium text-ink-primary">
              {t('purchasing.supplier')} <span className="text-danger-500">*</span>
            </label>
            <SearchableSelect
              options={supplierOpts}
              value={header.supplier_id}
              disabled={!canEdit}
              onChange={(v) => { setHeader(h => ({ ...h, supplier_id: v })); setDirty(true); }}
              placeholder={t('purchasing.select_supplier')}
              panelWidth={320}
            />
          </div>
          <Select label={t('purchasing.warehouse')} options={warehouseOpts} value={header.warehouse_id}
            disabled={!canEdit} onChange={e => setHeader(h => ({ ...h, warehouse_id: e.target.value }))} />
          <Input label={t('purchasing.date')} type="date" required value={header.date}
            disabled={!canEdit} onChange={e => setHeader(h => ({ ...h, date: e.target.value }))} />
          <Input label={t('purchasing.expected_delivery')} type="date" value={header.expected_delivery_date}
            disabled={!canEdit} onChange={e => setHeader(h => ({ ...h, expected_delivery_date: e.target.value }))} />
          <Input label={t('purchasing.reference')} value={header.reference}
            disabled={!canEdit} onChange={e => setHeader(h => ({ ...h, reference: e.target.value }))} />
          <Select label={t('purchasing.currency')} options={currencyOptions(header.currency)} value={header.currency}
            disabled={!canEdit} onChange={e => setHeader(h => ({ ...h, currency: e.target.value }))} />
        </div>
        <div className="mt-3">
          <Input label={t('purchasing.notes')} value={header.notes}
            disabled={!canEdit} onChange={e => setHeader(h => ({ ...h, notes: e.target.value }))} />
        </div>
      </div>

      <div className="glass-card">
        <div className="border-b border-border-subtle px-5 py-3">
          <h2 className="text-sm font-semibold text-ink-primary">{t('purchasing.line_items')}</h2>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full table-fixed text-xs" style={{ minWidth: '760px' }}>
            <thead>
              <tr className="border-b border-border-subtle bg-surface-muted text-ink-tertiary">
                <th className="px-3 py-2 text-start font-medium" style={{ minWidth: '220px' }}>{t('purchasing.product')}</th>
                <th className="px-3 py-2 text-end font-medium" style={{ width: '72px' }}>{t('purchasing.qty')}</th>
                <th className="px-3 py-2 text-end font-medium" style={{ width: '112px' }}>{t('purchasing.unit_cost')}</th>
                <th className="px-3 py-2 text-end font-medium" style={{ width: '84px' }}>{t('purchasing.disc_pct')}</th>
                <th className="px-3 py-2 text-end font-medium" style={{ width: '100px' }}>{t('purchasing.tax')}</th>
                <th className="px-3 py-2 text-end font-medium" style={{ width: '112px' }}>{t('purchasing.line_total')}</th>
                {canEdit && <th style={{ width: '36px' }} />}
              </tr>
            </thead>
            <tbody>
              {lines.map(line => (
                <tr key={line._key} className="border-b border-border-subtle last:border-0">
                  <td className="px-3 py-1.5 align-top">
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
                    <input
                      className="mt-1 w-full rounded border border-transparent bg-transparent px-2 py-0.5 text-[11px] text-ink-tertiary placeholder:text-ink-tertiary hover:border-border-subtle focus:border-border-strong focus:bg-surface-subtle focus:text-ink-secondary disabled:opacity-60"
                      value={line.description} disabled={!canEdit}
                      placeholder={t('purchasing.description') + ' (optional)'}
                      onChange={e => updateLine(line._key, { description: e.target.value })} />
                  </td>
                  <td className="px-3 py-1.5 align-top">
                    <input type="number" min="0" step="1"
                      className="w-full rounded border border-border-strong bg-surface-subtle px-2 py-1 text-xs text-end disabled:opacity-60"
                      value={line.quantity} disabled={!canEdit}
                      onChange={e => updateLine(line._key, { quantity: e.target.value })} />
                  </td>
                  <td className="px-3 py-1.5 align-top">
                    <input type="number" min="0" step="0.01"
                      className="w-full rounded border border-border-strong bg-surface-subtle px-2 py-1 text-xs text-end disabled:opacity-60"
                      value={line.unit_cost} disabled={!canEdit}
                      onChange={e => updateLine(line._key, { unit_cost: e.target.value })} />
                  </td>
                  <td className="px-3 py-1.5 align-top">
                    <input type="number" min="0" max="100" step="0.01"
                      className="w-full rounded border border-border-strong bg-surface-subtle px-2 py-1 text-xs text-end disabled:opacity-60"
                      value={line.discount_percent} disabled={!canEdit}
                      onChange={e => updateLine(line._key, { discount_percent: e.target.value })} />
                  </td>
                  <td className="px-3 py-1.5 align-top">
                    <select className="w-full rounded border border-border-strong bg-surface-subtle px-2 py-1 text-xs disabled:opacity-60"
                      value={line.tax_rate} disabled={!canEdit}
                      onChange={e => updateLine(line._key, { tax_rate: e.target.value })}>
                      {taxOpts.map(o => <option key={o.key} value={o.value}>{o.label}</option>)}
                    </select>
                  </td>
                  <td className="px-3 py-1.5 align-top text-end font-mono text-ink-primary">{fmt(line.line_total)}</td>
                  {canEdit && (
                    <td className="px-3 py-1.5 align-top">
                      <button className="text-red-400 hover:text-red-600 disabled:opacity-30"
                        disabled={lines.length === 1}
                        onClick={() => { setLines(prev => prev.filter(l => l._key !== line._key)); setDirty(true); }}>×</button>
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
              onClick={() => { const b = { ...emptyLine(), tax_rate: stdTaxRate }; setLines(prev => [...prev, { ...b, ...calcLine(b) }]); setDirty(true); }}>
              + {t('purchasing.add_line')}
            </button>
          </div>
        )}
        <div className="border-t border-border-subtle px-5 py-4">
          <div className="ms-auto w-60 space-y-1.5 text-sm">
            <div className="flex justify-between text-ink-secondary"><span>{t('purchasing.subtotal')}</span><span className="font-mono">{fmt(subtotal)}</span></div>
            {discountTotal > 0 && <div className="flex justify-between text-ink-secondary"><span>{t('purchasing.discount')}</span><span className="font-mono text-red-600">−{fmt(discountTotal)}</span></div>}
            {taxTotal > 0 && <div className="flex justify-between text-ink-secondary"><span>{t('purchasing.vat')}</span><span className="font-mono">{fmt(taxTotal)}</span></div>}
            <div className="flex justify-between border-t border-border-subtle pt-1.5 font-semibold text-ink-primary">
              <span>{t('purchasing.total_amount')}</span>
              <span className="font-mono">{header.currency} {fmt(grandTotal)}</span>
            </div>
          </div>
        </div>
      </div>

      {/* Phase 12.42 — quick-create product modal. */}
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
