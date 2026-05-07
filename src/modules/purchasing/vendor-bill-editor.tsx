import { useState, useEffect, useCallback } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { getAdapter } from '@/data/index';
import { useAuthStore } from '@/store/auth';
import { Button } from '@/ui/button';
import { Input } from '@/ui/input';
import { Select } from '@/ui/select';
import { SearchableSelect } from '@/ui/searchable-select';
import type { VendorBillRow, VendorBillItemInsert, ContactRow, ProductRow, TaxRateRow, CoaRow } from '@/data/adapter';
import { calcPurchaseLine as _calc } from '@/core/purchasing/purchase-calc';

interface LineRow {
  _key: string;
  product_id: string | null;
  coa_account_id: string | null;
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
  _key: newKey(), product_id: null, coa_account_id: null, description: '',
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
  });
  const [lines, setLines] = useState<LineRow[]>([emptyLine()]);
  const [error, setError] = useState<string | null>(null);
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
      });
    }
  }, [existing]);

  useEffect(() => {
    if (existingItems.length > 0) {
      setLines(existingItems.map(item => {
        const base: LineRow = {
          _key: newKey(), product_id: item.product_id ?? null,
          coa_account_id: (item as { coa_account_id?: string | null }).coa_account_id ?? null,
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
    }));
  }

  const saveMutation = useMutation({
    mutationFn: async () => {
      if (!header.supplier_id) throw new Error(t('purchasing.error_supplier_required'));
      const billNum = isNew ? await getAdapter().vendorBills.getNextNumber(company_id!) : existing!.bill_number;
      const row = {
        company_id: company_id!, bill_number: billNum,
        supplier_bill_number: header.supplier_bill_number || null,
        supplier_id: header.supplier_id, date: header.date,
        due_date: header.due_date || null, reference: header.reference || null,
        currency: header.currency, exchange_rate: 1,
        subtotal: +subtotal.toFixed(2), discount_amount: +discountTotal.toFixed(2),
        tax_amount: +taxTotal.toFixed(2), total_amount: +grandTotal.toFixed(2),
        status: 'draft' as const,
        linked_grn_id: header.linked_grn_id || null,
        void_reason: null, voided_at: null, voided_by: null,
        notes: header.notes || null,
      };
      if (isNew) return getAdapter().vendorBills.create(row, buildItems());
      await getAdapter().vendorBills.update(id!, row, buildItems());
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
  const supplierOpts = [{ value: '', label: t('purchasing.select_supplier') }, ...suppliers.map(s => ({ value: s.id, label: s.name }))];
  const productOpts = [{ value: '', label: '— ' + t('purchasing.select_product') + ' —' }, ...products.map(p => ({ value: p.id, label: `${p.sku}  ${p.name}` }))];
  const taxOpts = [{ value: '0', label: t('sales.no_tax') }, ...taxRates.map(r => ({ value: String(r.rate), label: `${r.name} (${r.rate}%)` }))];
  // SearchableSelect handles its own placeholder — don't inject an empty option
  // (it would otherwise appear as a clickable row in the dropdown list).
  const expenseOpts = accountOpts.map(a => ({ value: a.id, label: `${a.code} ${a.name}` }));

  return (
    <div className="space-y-6 pb-16">
      <div className="flex items-center gap-3">
        <button onClick={() => navigate('/purchasing/bills')} className="text-sm text-ink-secondary hover:text-ink-primary">← {t('purchasing.bills_title')}</button>
        <span className="text-ink-tertiary">/</span>
        <h1 className="text-xl font-semibold text-ink-primary">{isNew ? t('purchasing.new_bill') : existing?.bill_number ?? '…'}</h1>
        {!isNew && <span className="rounded-pill bg-gray-100 px-2.5 py-0.5 text-xs capitalize text-gray-600">{existing?.status}</span>}
        <div className="ms-auto flex gap-2">
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

      {error && <div className="rounded-input bg-red-50 px-4 py-2 text-sm text-red-700">{error}</div>}

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

      <div className="rounded-card border border-border-subtle bg-surface-card p-5">
        <h2 className="mb-4 text-sm font-semibold text-ink-primary">{t('purchasing.bill_details')}</h2>
        <div className="grid grid-cols-2 gap-4 md:grid-cols-3">
          <div className="col-span-2 md:col-span-1">
            <Select label={t('purchasing.supplier')} required options={supplierOpts} value={header.supplier_id}
              disabled={!canEdit} onChange={e => setHeader(h => ({ ...h, supplier_id: e.target.value }))} />
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
        </div>
        {header.linked_grn_id && (
          <p className="mt-2 text-xs text-ink-tertiary">{t('purchasing.linked_grn')}: {header.linked_grn_id}</p>
        )}
      </div>

      <div className="rounded-card border border-border-subtle bg-surface-card">
        <div className="border-b border-border-subtle px-5 py-3">
          <h2 className="text-sm font-semibold text-ink-primary">{t('purchasing.line_items')}</h2>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-border-subtle bg-surface-muted text-ink-tertiary">
                <th className="px-3 py-2 text-start font-medium w-36">{t('purchasing.product')}</th>
                <th className="px-3 py-2 text-start font-medium w-36">{t('purchasing.account')}</th>
                <th className="px-3 py-2 text-start font-medium w-36">{t('purchasing.description')}</th>
                <th className="px-3 py-2 text-end font-medium w-20">{t('purchasing.qty')}</th>
                <th className="px-3 py-2 text-end font-medium w-24">{t('purchasing.unit_cost')}</th>
                <th className="px-3 py-2 text-end font-medium w-20">{t('purchasing.disc_pct')}</th>
                <th className="px-3 py-2 text-end font-medium w-28">{t('purchasing.tax')}</th>
                <th className="px-3 py-2 text-end font-medium w-24">{t('purchasing.line_total')}</th>
                {canEdit && <th className="w-10" />}
              </tr>
            </thead>
            <tbody>
              {lines.map(line => (
                <tr key={line._key} className="border-b border-border-subtle last:border-0">
                  <td className="px-3 py-1.5">
                    <select className="w-full rounded border border-border-strong bg-surface-subtle px-2 py-1 text-xs disabled:opacity-60"
                      value={line.product_id ?? ''} disabled={!canEdit}
                      onChange={e => handleProductChange(line._key, e.target.value)}>
                      {productOpts.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                    </select>
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
                    <input type="number" min="0" step="0.001"
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
    </div>
  );
}
