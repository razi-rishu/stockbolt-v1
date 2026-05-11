import { useState, useEffect, useCallback } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { useNavigate, useParams } from 'react-router-dom';
import { getAdapter } from '@/data/index';
import { useAuthStore } from '@/store/auth';
import { Button } from '@/ui/button';
import { Input } from '@/ui/input';
import { SearchableSelect } from '@/ui/searchable-select';
import type { SalesQuoteRow, SalesQuoteItemInsert, ContactRow, ProductRow, TaxRateRow } from '@/data/adapter';
import { calcLine as _calcLine } from '@/core/sales/invoice-calc';

interface LineRow {
  _key: string;
  product_id: string | null;
  description: string;
  quantity: string;
  unit_price: string;
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
  return _calcLine({
    quantity:         parseFloat(l.quantity) || 0,
    unit_price:       parseFloat(l.unit_price) || 0,
    discount_percent: parseFloat(l.discount_percent) || 0,
    tax_rate:         parseFloat(l.tax_rate) || 0,
  });
}

const emptyLine = (): LineRow => ({ _key: newKey(), product_id: null, description: '', quantity: '1', unit_price: '0', discount_percent: '0', tax_rate: '0', line_subtotal: 0, discount_amount: 0, tax_amount: 0, line_total: 0 });
const fmt = (n: number) => n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const todayIso = () => new Date().toISOString().slice(0, 10);

export default function QuoteEditorPage() {
  const { t } = useTranslation();
  const { company_id } = useAuthStore();
  const companyCurrency = 'AED';
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const isNew = id === 'new';

  const { data: contacts = [] } = useQuery<ContactRow[]>({
    queryKey: ['contacts', company_id, 'customer'],
    queryFn: () => getAdapter().contacts.list(company_id!, 'customer'),
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
  const { data: existing } = useQuery<SalesQuoteRow | null>({
    queryKey: ['sales_quote', id],
    queryFn: () => getAdapter().salesQuotes.getById(id!),
    enabled: !isNew && !!id,
  });
  const { data: existingItems = [] } = useQuery({
    queryKey: ['sales_quote_items', id],
    queryFn: () => getAdapter().salesQuotes.getItems(id!),
    enabled: !isNew && !!id,
  });

  const [header, setHeader] = useState({ contact_id: '', date: todayIso(), expiry_date: '', reference: '', notes: '', currency: companyCurrency ?? 'AED' });
  const [lines, setLines] = useState<LineRow[]>([emptyLine()]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (existing) {
      setHeader({ contact_id: existing.contact_id, date: existing.date as string, expiry_date: (existing.expiry_date as string | null) ?? '', reference: existing.reference ?? '', notes: existing.notes ?? '', currency: existing.currency });
    }
  }, [existing]);

  useEffect(() => {
    if (existingItems.length > 0) {
      setLines(existingItems.map(item => {
        const base: LineRow = { _key: newKey(), product_id: item.product_id, description: item.description ?? '', quantity: String(item.quantity), unit_price: String(item.unit_price), discount_percent: String(item.discount_percent ?? 0), tax_rate: String(item.tax_rate ?? 0), line_subtotal: 0, discount_amount: 0, tax_amount: 0, line_total: 0 };
        return { ...base, ...calcLine(base) };
      }));
    }
  }, [existingItems]);

  const subtotal      = lines.reduce((s, l) => s + l.line_subtotal, 0);
  const discountTotal = lines.reduce((s, l) => s + l.discount_amount, 0);
  const taxTotal      = lines.reduce((s, l) => s + l.tax_amount, 0);
  const grandTotal    = lines.reduce((s, l) => s + l.line_total, 0);

  const updateLine = useCallback((key: string, patch: Partial<LineRow>) => {
    setLines(prev => prev.map(l => { if (l._key !== key) return l; const u = { ...l, ...patch }; return { ...u, ...calcLine(u) }; }));
  }, []);

  const handleProductChange = (key: string, productId: string) => {
    const product = products.find(p => p.id === productId);
    if (product) updateLine(key, { product_id: productId, description: product.name, unit_price: String(product.selling_price ?? 0) });
    else updateLine(key, { product_id: null, description: '' });
  };

  function buildItems(): SalesQuoteItemInsert[] {
    return lines.map((l, i) => ({
      quote_id: '',
      product_id: l.product_id,
      description: l.description || null,
      description_ar: null,
      quantity: parseFloat(l.quantity) || 0,
      unit_id: null,
      unit_price: parseFloat(l.unit_price) || 0,
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
      if (!header.contact_id) throw new Error(t('sales.error_contact_required'));
      const quoteNum = isNew ? await getAdapter().salesQuotes.getNextNumber(company_id!) : existing!.quote_number;
      const row = { company_id: company_id!, quote_number: quoteNum, contact_id: header.contact_id, salesperson_id: null, date: header.date, expiry_date: header.expiry_date || null, reference: header.reference || null, price_level_id: null, currency: header.currency, exchange_rate: 1, prices_inclusive: false, subtotal: +subtotal.toFixed(2), discount_amount: +discountTotal.toFixed(2), tax_amount: +taxTotal.toFixed(2), total_amount: +grandTotal.toFixed(2), status: 'draft' as const, invoiced_amount: 0, terms: null, terms_ar: null, notes: header.notes || null };
      if (isNew) return getAdapter().salesQuotes.create(row, buildItems());
      await getAdapter().salesQuotes.update(id!, row, buildItems());
      return null;
    },
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ['sales_quotes', company_id] });
      if (isNew && data) navigate(`/sales/quotes/${data.id}`);
      else { qc.invalidateQueries({ queryKey: ['sales_quote', id] }); qc.invalidateQueries({ queryKey: ['sales_quote_items', id] }); }
    },
    onError: (e: Error) => setError(e.message),
  });

  // Convert this quote to an invoice. Mirrors the action available on the
  // Quotes list page; available here so the user can act from the editor too.
  const convertMutation = useMutation({
    mutationFn: () => getAdapter().salesQuotes.convertToInvoice(id!),
    onSuccess: (inv) => {
      qc.invalidateQueries({ queryKey: ['sales_quotes', company_id] });
      qc.invalidateQueries({ queryKey: ['invoices', company_id] });
      navigate(`/sales/invoices/${inv.id}`);
    },
    onError: (e: Error) => setError(e.message),
  });

  const canEdit = isNew || existing?.status === 'draft';
  const contactOpts = contacts.map(c => ({ value: c.id, label: c.name }));
  const productOpts = products.map(p => ({ value: p.id, label: `${p.sku}  ${p.name}` }));
  const taxOpts = [{ value: '0', label: t('sales.no_tax') }, ...taxRates.map(r => ({ value: String(r.rate), label: `${r.name} (${r.rate}%)` }))];

  return (
    <div className="space-y-6 pb-16">
      <div className="flex items-center gap-3">
        <button onClick={() => navigate('/sales/quotes')} className="text-sm text-ink-secondary hover:text-ink-primary">← {t('sales.quotes_title')}</button>
        <span className="text-ink-tertiary">/</span>
        <h1 className="text-xl font-semibold text-ink-primary">{isNew ? t('sales.new_quote') : existing?.quote_number ?? '…'}</h1>
        {!isNew && <span className="rounded-pill bg-gray-100 px-2.5 py-0.5 text-xs capitalize text-gray-600">{existing?.status}</span>}
        <div className="ms-auto flex gap-2">
          {!isNew && existing?.id && (
            <Button variant="ghost" size="sm" onClick={() => window.open(`/print/quote/${existing.id}`, '_blank')}>
              🖨 {t('print.print')}
            </Button>
          )}
          <Button variant="ghost" size="sm" onClick={() => navigate('/sales/quotes')}>{t('common.cancel')}</Button>
          {canEdit && <Button size="sm" onClick={() => { setError(null); saveMutation.mutate(); }} disabled={saveMutation.isPending}>{saveMutation.isPending ? t('common.saving') : t('common.save')}</Button>}
          {!isNew && existing && ['draft', 'sent', 'accepted'].includes(existing.status) && (
            <Button
              size="sm"
              onClick={() => { setError(null); convertMutation.mutate(); }}
              disabled={convertMutation.isPending}
              title="Create a draft invoice from this quote and open it"
            >
              {convertMutation.isPending ? '…' : `→ ${t('sales.convert_to_invoice')}`}
            </Button>
          )}
        </div>
      </div>
      {error && <div className="rounded-input bg-red-50 px-4 py-2 text-sm text-red-700">{error}</div>}
      <div className="rounded-card border border-border-subtle bg-surface-card p-5">
        <h2 className="mb-4 text-sm font-semibold text-ink-primary">{t('sales.quote_details')}</h2>
        <div className="grid grid-cols-2 gap-4 md:grid-cols-3">
          <div className="col-span-2 md:col-span-1">
            <label className="mb-1 block text-sm font-medium text-ink-primary">
              {t('sales.customer')} <span className="text-danger-500">*</span>
            </label>
            <SearchableSelect
              options={contactOpts}
              value={header.contact_id}
              disabled={!canEdit}
              onChange={(v) => setHeader(h => ({ ...h, contact_id: v }))}
              placeholder={t('sales.select_contact')}
              panelWidth={320}
            />
            {contacts.length === 0 && (
              <p className="mt-1 text-xs text-ink-tertiary">
                No customers yet.{' '}
                <button
                  type="button"
                  onClick={() => navigate('/contacts/customers')}
                  className="text-brand-600 hover:text-brand-700 underline"
                >
                  Add one →
                </button>
              </p>
            )}
          </div>
          <Input label={t('sales.date')} type="date" required value={header.date} disabled={!canEdit} onChange={e => setHeader(h => ({ ...h, date: e.target.value }))} />
          <Input label={t('sales.expiry_date')} type="date" value={header.expiry_date} disabled={!canEdit} onChange={e => setHeader(h => ({ ...h, expiry_date: e.target.value }))} />
          <Input label={t('sales.reference')} value={header.reference} disabled={!canEdit} onChange={e => setHeader(h => ({ ...h, reference: e.target.value }))} />
          <Input label={t('sales.currency')} value={header.currency} disabled={!canEdit} onChange={e => setHeader(h => ({ ...h, currency: e.target.value }))} />
        </div>
        <div className="mt-3">
          <Input label={t('sales.notes')} value={header.notes} disabled={!canEdit} onChange={e => setHeader(h => ({ ...h, notes: e.target.value }))} />
        </div>
      </div>
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
                      placeholder={'— ' + t('sales.select_product') + ' —'}
                      panelWidth={360}
                    />
                  </td>
                  <td className="px-3 py-1.5"><input className="w-full rounded border border-border-strong bg-surface-subtle px-2 py-1 text-xs disabled:opacity-60" value={line.description} disabled={!canEdit} onChange={e => updateLine(line._key, { description: e.target.value })} /></td>
                  <td className="px-3 py-1.5"><input type="number" min="0" step="0.001" className="w-full rounded border border-border-strong bg-surface-subtle px-2 py-1 text-xs text-end disabled:opacity-60" value={line.quantity} disabled={!canEdit} onChange={e => updateLine(line._key, { quantity: e.target.value })} /></td>
                  <td className="px-3 py-1.5"><input type="number" min="0" step="0.01" className="w-full rounded border border-border-strong bg-surface-subtle px-2 py-1 text-xs text-end disabled:opacity-60" value={line.unit_price} disabled={!canEdit} onChange={e => updateLine(line._key, { unit_price: e.target.value })} /></td>
                  <td className="px-3 py-1.5"><input type="number" min="0" max="100" step="0.01" className="w-full rounded border border-border-strong bg-surface-subtle px-2 py-1 text-xs text-end disabled:opacity-60" value={line.discount_percent} disabled={!canEdit} onChange={e => updateLine(line._key, { discount_percent: e.target.value })} /></td>
                  <td className="px-3 py-1.5"><select className="w-full rounded border border-border-strong bg-surface-subtle px-2 py-1 text-xs disabled:opacity-60" value={line.tax_rate} disabled={!canEdit} onChange={e => updateLine(line._key, { tax_rate: e.target.value })}>{taxOpts.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}</select></td>
                  <td className="px-3 py-1.5 text-end font-mono text-ink-primary">{fmt(line.line_total)}</td>
                  {canEdit && <td className="px-3 py-1.5"><button className="text-red-400 hover:text-red-600 disabled:opacity-30" disabled={lines.length === 1} onClick={() => setLines(prev => prev.filter(l => l._key !== line._key))}>×</button></td>}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {canEdit && <div className="border-t border-border-subtle px-5 py-2"><button className="text-xs text-brand-600 hover:text-brand-700" onClick={() => setLines(prev => [...prev, emptyLine()])}>+ {t('sales.add_line')}</button></div>}
        <div className="border-t border-border-subtle px-5 py-4">
          <div className="ms-auto w-60 space-y-1.5 text-sm">
            <div className="flex justify-between text-ink-secondary"><span>{t('sales.subtotal')}</span><span className="font-mono">{fmt(subtotal)}</span></div>
            {discountTotal > 0 && <div className="flex justify-between text-ink-secondary"><span>{t('sales.discount')}</span><span className="font-mono text-red-600">−{fmt(discountTotal)}</span></div>}
            {taxTotal > 0 && <div className="flex justify-between text-ink-secondary"><span>{t('sales.vat')}</span><span className="font-mono">{fmt(taxTotal)}</span></div>}
            <div className="flex justify-between border-t border-border-subtle pt-1.5 font-semibold text-ink-primary"><span>{t('sales.total_amount')}</span><span className="font-mono">{header.currency} {fmt(grandTotal)}</span></div>
          </div>
        </div>
      </div>
    </div>
  );
}
