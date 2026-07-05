import { useState, useEffect, useCallback, useRef } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { useNavigate, useParams } from 'react-router-dom';
import { getAdapter } from '@/data/index';
import { useAuthStore } from '@/store/auth';
import { useCompanyCurrency, useCompanyCountry } from '@/hooks/use-company-currency';
import { defaultTaxRate } from '@/lib/locale';
import { Button } from '@/ui/button';
import { Input } from '@/ui/input';
import { SearchableSelect } from '@/ui/searchable-select';
import { Select } from '@/ui/select';
import { currencyOptions } from '@/lib/currencies';
import { ContactPicker } from '@/components/contact-picker';
import { ProductQuickCreate } from '@/components/quick-create/product-quick-create';
import { useUnsavedChangesGuard } from '@/hooks/use-unsaved-changes-guard';
// Phase 14.04 — Signature template view mode for saved quotes.
import { ConfigurableDocTemplate } from '@/modules/print/engine/ConfigurableDocTemplate';
import { useResolvedPrintTemplate } from '@/hooks/use-resolved-print-template';
import { quoteToDocumentData } from '@/modules/print/_signature/adapters';
import '@/modules/print/_signature/print.css';
import type { SalesQuoteRow, SalesQuoteItemInsert, SalesQuoteItemRow, ContactRow, ProductRow, TaxRateRow, Company } from '@/data/adapter';
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
  const companyCurrency = useCompanyCurrency();   // Issue 1 — was hardcoded 'AED'
  const companyCountry = useCompanyCountry();      // Phase 21 — country standard tax rate
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const printTemplate = useResolvedPrintTemplate('quotation');
  const qc = useQueryClient();
  const isNew = id === 'new';

  const { data: contacts = [] } = useQuery<ContactRow[]>({
    queryKey: ['contacts', company_id, 'customer'],
    queryFn: () => getAdapter().contacts.list(company_id!, 'customer'),
    enabled: !!company_id,
  });
  // Salespeople — dedicated master table (Phase 12.16). Manage in
  // Settings → Salespeople.
  const { data: salespeople = [] } = useQuery({
    queryKey: ['salespeople', company_id],
    queryFn: () => getAdapter().salespeople.list(company_id!),
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
  const { data: existing } = useQuery<SalesQuoteRow | null>({
    queryKey: ['sales_quote', id],
    queryFn: () => getAdapter().salesQuotes.getById(id!),
    enabled: !isNew && !!id,
  });
  const { data: existingItems = [] } = useQuery<SalesQuoteItemRow[]>({
    queryKey: ['sales_quote_items', id],
    queryFn: () => getAdapter().salesQuotes.getItems(id!),
    enabled: !isNew && !!id,
  });
  // Phase 14.04 — company row for the Signature template header.
  const { data: companyRow } = useQuery<Company | null>({
    queryKey: ['company', company_id],
    queryFn: () => getAdapter().companies.getById(company_id!),
    enabled: !!company_id,
  });

  // Phase 14.04 — view-first mode (saved quotes open in template view).
  const [viewMode, setViewMode] = useState(!isNew);

  const [header, setHeader] = useState({ contact_id: '', salesperson_id: '', date: todayIso(), expiry_date: '', reference: '', notes: '', currency: companyCurrency ?? 'AED' });
  const [lines, setLines] = useState<LineRow[]>([emptyLine()]);
  const [error, setError] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);
  const confirmLeave = useUnsavedChangesGuard(dirty);

  // Phase 12.42 — quick-create product from inside the line picker.
  // Opening the modal seeds it with the in-progress search query.
  const [productQcOpen,    setProductQcOpen]    = useState(false);
  const [productQcSeed,    setProductQcSeed]    = useState('');
  const [productQcLineKey, setProductQcLineKey] = useState<string | null>(null);

  useEffect(() => {
    if (existing) {
      setHeader({ contact_id: existing.contact_id, salesperson_id: existing.salesperson_id ?? '', date: existing.date as string, expiry_date: (existing.expiry_date as string | null) ?? '', reference: existing.reference ?? '', notes: existing.notes ?? '', currency: existing.currency });
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

  // ── Credit limit check (same logic as invoice editor) ───────────────────
  // Quotes don't post AR so they don't change outstanding, but flagging an
  // over-limit quote lets the salesperson know there's a problem BEFORE
  // it gets converted to an invoice and confirmed.
  const { data: openCustomerInvoices = [] } = useQuery({
    queryKey: ['open_invoices_for_credit_check', company_id, header.contact_id],
    queryFn:  () => getAdapter().invoices.listOpenForContact(company_id!, header.contact_id),
    enabled:  !!company_id && !!header.contact_id,
  });
  const selectedCustomer = contacts.find(c => c.id === header.contact_id);
  const creditLimit      = Number(selectedCustomer?.credit_limit ?? 0);
  const currentOutstanding = openCustomerInvoices
    .reduce((s, inv) => s + Number(inv.outstanding ?? 0), 0);
  const projectedOutstanding = currentOutstanding + grandTotal;
  const creditOverage        = projectedOutstanding - creditLimit;
  const overCreditLimit      = creditLimit > 0 && creditOverage > 0.005;

  // Phase 21 — pre-fill the pristine opening line on a NEW quote with the company
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

  const updateLine = useCallback((key: string, patch: Partial<LineRow>) => {
    setLines(prev => prev.map(l => { if (l._key !== key) return l; const u = { ...l, ...patch }; return { ...u, ...calcLine(u) }; }));
    setDirty(true);
  }, []);

  const handleProductChange = (key: string, productId: string) => {
    const product = products.find(p => p.id === productId);
    if (product) {
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
      if (!header.salesperson_id) throw new Error('Salesperson is required');
      const quoteNum = isNew ? await getAdapter().salesQuotes.getNextNumber(company_id!) : existing!.quote_number;
      const row = { company_id: company_id!, quote_number: quoteNum, contact_id: header.contact_id, salesperson_id: header.salesperson_id, date: header.date, expiry_date: header.expiry_date || null, reference: header.reference || null, price_level_id: null, currency: header.currency, exchange_rate: 1, prices_inclusive: false, subtotal: +subtotal.toFixed(2), discount_amount: +discountTotal.toFixed(2), tax_amount: +taxTotal.toFixed(2), total_amount: +grandTotal.toFixed(2), status: isNew ? 'draft' : existing!.status, invoiced_amount: existing?.invoiced_amount ?? 0, terms: null, terms_ar: null, notes: header.notes || null };
      if (isNew) return getAdapter().salesQuotes.create(row, buildItems());
      await getAdapter().salesQuotes.update(id!, row, buildItems());
      return null;
    },
    onSuccess: (data) => {
      setDirty(false);
      qc.invalidateQueries({ queryKey: ['sales_quotes', company_id] });
      if (isNew && data) navigate('/sales/quotes');
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

  // Quotes are non-GL proposals — editable in any status (draft/sent/accepted/
  // fully_invoiced). The existing status is preserved on save so a fully-invoiced
  // quote can't be silently reset to draft and re-converted.
  const canEdit = isNew || !!existing;
  // contactOpts removed — customer picker uses ContactPicker (D3).
  const productOpts = products.map(p => ({ value: p.id, label: `${p.sku}  ${p.name}` }));
  const taxOpts = [
    { key: '__none__', value: '', label: t('sales.no_tax') },
    ...taxRates.map(r => ({ key: r.id, value: String(r.rate), label: `${r.name} (${r.rate}%)` })),
  ];

  // Phase 14.04 — view-mode renderer (Signature template).
  if (viewMode && !isNew && existing) {
    const doc = quoteToDocumentData({
      quote: existing,
      items: existingItems,
      contact: contacts.find(c => c.id === existing.contact_id) ?? null,
      company: companyRow ?? null,
      products,
    });
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: '16px', paddingBottom: '32px' }}>
        <div
          data-no-print="true"
          style={{ display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap' }}
        >
          <button onClick={() => { if (confirmLeave()) navigate('/sales/quotes'); }} style={{
            background: 'transparent', border: 'none', cursor: 'pointer',
            fontSize: '13px', color: '#64748b',
          }}>← {t('sales.quotes_title')}</button>
          <span style={{ color: '#94a3b8' }}>/</span>
          <h1 style={{ margin: 0, fontSize: '20px', fontWeight: 700, color: '#1e293b', letterSpacing: '-.01em' }}>
            {existing.quote_number}
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
            {existing?.id && ['draft', 'sent', 'accepted'].includes(existing.status) && (
              <Button
                size="sm"
                onClick={() => { setError(null); convertMutation.mutate(); }}
                disabled={convertMutation.isPending}
                title="Create a draft invoice from this quote and open it"
              >
                {convertMutation.isPending ? '…' : `→ ${t('sales.convert_to_invoice')}`}
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
        <button onClick={() => { if (confirmLeave()) navigate('/sales/quotes'); }} className="text-sm text-ink-secondary hover:text-ink-primary">← {t('sales.quotes_title')}</button>
        <span className="text-ink-tertiary">/</span>
        <h1 className="text-xl font-semibold text-ink-primary">{isNew ? t('sales.new_quote') : existing?.quote_number ?? '…'}</h1>
        {!isNew && <span className="rounded-pill bg-gray-100 px-2.5 py-0.5 text-xs capitalize text-gray-600">{existing?.status}</span>}
        <div className="ms-auto flex gap-2">
          {!isNew && existing && (
            <Button variant="ghost" size="sm" onClick={() => setViewMode(true)}>
              {t('common.view') || 'View'}
            </Button>
          )}
          {!isNew && existing?.id && (
            <Button variant="ghost" size="sm" onClick={() => window.open(`/print/quote/${existing.id}`, '_blank')}>
              🖨 {t('print.print')}
            </Button>
          )}
          <Button variant="ghost" size="sm" onClick={() => { if (confirmLeave()) navigate('/sales/quotes'); }}>{t('common.cancel')}</Button>
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

      {/* Credit-limit warning — non-blocking. Quotes don't post AR, but
           it's better to surface this NOW than after conversion to invoice. */}
      {overCreditLimit && selectedCustomer && (
        <div className="rounded-input border border-amber-300 bg-amber-50 px-4 py-3 text-sm">
          <p className="font-semibold text-amber-900">⚠ Over credit limit</p>
          <p className="mt-1 text-amber-800">
            <strong>{selectedCustomer.name}</strong>'s credit limit is{' '}
            <span className="font-mono">{header.currency} {fmt(creditLimit)}</span>.
            Current outstanding: <span className="font-mono">{fmt(currentOutstanding)}</span>.
            After this quote ({fmt(grandTotal)}), outstanding would be{' '}
            <span className="font-mono font-semibold">{fmt(projectedOutstanding)}</span>{' '}
            — over by <span className="font-mono font-semibold">{fmt(creditOverage)}</span>.
          </p>
          <p className="mt-1 text-xs text-amber-700">
            This quote doesn't post receivables, but converting to an invoice will.
          </p>
        </div>
      )}
      <div className="glass-card p-5">
        <h2 className="mb-4 text-sm font-semibold text-ink-primary">{t('sales.quote_details')}</h2>
        <div className="grid grid-cols-2 gap-4 md:grid-cols-3">
          <div className="col-span-2 md:col-span-1">
            <label className="mb-1 block text-sm font-medium text-ink-primary">
              {t('sales.customer')} <span className="text-danger-500">*</span>
            </label>
            <ContactPicker
              type="customer"
              value={header.contact_id}
              disabled={!canEdit}
              onChange={(id) => { setHeader(h => ({ ...h, contact_id: id ?? '' })); setDirty(true); }}
              placeholder={t('sales.select_contact')}
              panelWidth={380}
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
          <div>
            <label className="mb-1 block text-sm font-medium text-ink-primary">
              Salesperson <span className="text-danger-500">*</span>
            </label>
            <SearchableSelect
              options={salespeople.map(p => ({ value: p.id, label: p.name }))}
              value={header.salesperson_id}
              disabled={!canEdit}
              onChange={(v) => setHeader(h => ({ ...h, salesperson_id: v }))}
              placeholder={salespeople.length === 0 ? 'No salespeople — add in Settings' : 'Select salesperson'}
              panelWidth={280}
            />
          </div>
          <Input label={t('sales.date')} type="date" required value={header.date} disabled={!canEdit} onChange={e => setHeader(h => ({ ...h, date: e.target.value }))} />
          <Input label={t('sales.expiry_date')} type="date" value={header.expiry_date} disabled={!canEdit} onChange={e => setHeader(h => ({ ...h, expiry_date: e.target.value }))} />
          <Input label={t('sales.reference')} value={header.reference} disabled={!canEdit} onChange={e => setHeader(h => ({ ...h, reference: e.target.value }))} />
          <Select label={t('sales.currency')} options={currencyOptions(header.currency)} value={header.currency} disabled={!canEdit} onChange={e => setHeader(h => ({ ...h, currency: e.target.value }))} />
        </div>
        <div className="mt-3">
          <Input label={t('sales.notes')} value={header.notes} disabled={!canEdit} onChange={e => setHeader(h => ({ ...h, notes: e.target.value }))} />
        </div>
      </div>
      <div className="glass-card">
        <div className="border-b border-border-subtle px-5 py-3">
          <h2 className="text-sm font-semibold text-ink-primary">{t('sales.line_items')}</h2>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full table-fixed text-xs" style={{ minWidth: '760px' }}>
            <thead>
              <tr className="border-b border-border-subtle bg-surface-muted text-ink-tertiary">
                <th className="px-3 py-2 text-start font-medium" style={{ minWidth: '220px' }}>{t('sales.product')}</th>
                <th className="px-3 py-2 text-end font-medium" style={{ width: '72px' }}>{t('sales.qty')}</th>
                <th className="px-3 py-2 text-end font-medium" style={{ width: '112px' }}>{t('sales.unit_price')}</th>
                <th className="px-3 py-2 text-end font-medium" style={{ width: '84px' }}>{t('sales.disc_pct')}</th>
                <th className="px-3 py-2 text-end font-medium" style={{ width: '100px' }}>{t('sales.tax')}</th>
                <th className="px-3 py-2 text-end font-medium" style={{ width: '112px' }}>{t('sales.line_total')}</th>
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
                      placeholder={'— ' + t('sales.select_product') + ' —'}
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
                    <input className="mt-1 w-full rounded border border-transparent bg-transparent px-2 py-0.5 text-[11px] text-ink-tertiary placeholder:text-ink-tertiary hover:border-border-subtle focus:border-border-strong focus:bg-surface-subtle focus:text-ink-secondary disabled:opacity-60" value={line.description} disabled={!canEdit} placeholder={t('sales.description') + ' (optional)'} onChange={e => updateLine(line._key, { description: e.target.value })} />
                  </td>
                  <td className="px-3 py-1.5 align-top"><input type="number" min="0" step="1" className="w-full rounded border border-border-strong bg-surface-subtle px-2 py-1 text-xs text-end disabled:opacity-60" value={line.quantity} disabled={!canEdit} onChange={e => updateLine(line._key, { quantity: e.target.value })} /></td>
                  <td className="px-3 py-1.5 align-top"><input type="number" min="0" step="0.01" className="w-full rounded border border-border-strong bg-surface-subtle px-2 py-1 text-xs text-end disabled:opacity-60" value={line.unit_price} disabled={!canEdit} onChange={e => updateLine(line._key, { unit_price: e.target.value })} /></td>
                  <td className="px-3 py-1.5 align-top"><input type="number" min="0" max="100" step="0.01" className="w-full rounded border border-border-strong bg-surface-subtle px-2 py-1 text-xs text-end disabled:opacity-60" value={line.discount_percent} disabled={!canEdit} onChange={e => updateLine(line._key, { discount_percent: e.target.value })} /></td>
                  <td className="px-3 py-1.5 align-top"><select className="w-full rounded border border-border-strong bg-surface-subtle px-2 py-1 text-xs disabled:opacity-60" value={line.tax_rate} disabled={!canEdit} onChange={e => updateLine(line._key, { tax_rate: e.target.value })}>{taxOpts.map(o => <option key={o.key} value={o.value}>{o.label}</option>)}</select></td>
                  <td className="px-3 py-1.5 align-top text-end font-mono text-ink-primary">{fmt(line.line_total)}</td>
                  {canEdit && <td className="px-3 py-1.5 align-top"><button className="text-red-400 hover:text-red-600 disabled:opacity-30" disabled={lines.length === 1} onClick={() => { setLines(prev => prev.filter(l => l._key !== line._key)); setDirty(true); }}>×</button></td>}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {canEdit && <div className="border-t border-border-subtle px-5 py-2"><button className="text-xs text-brand-600 hover:text-brand-700" onClick={() => { const b = { ...emptyLine(), tax_rate: stdTaxRate }; setLines(prev => [...prev, { ...b, ...calcLine(b) }]); setDirty(true); }}>+ {t('sales.add_line')}</button></div>}
        <div className="border-t border-border-subtle px-5 py-4">
          <div className="ms-auto w-60 space-y-1.5 text-sm">
            <div className="flex justify-between text-ink-secondary"><span>{t('sales.subtotal')}</span><span className="font-mono">{fmt(subtotal)}</span></div>
            {discountTotal > 0 && <div className="flex justify-between text-ink-secondary"><span>{t('sales.discount')}</span><span className="font-mono text-red-600">−{fmt(discountTotal)}</span></div>}
            {taxTotal > 0 && <div className="flex justify-between text-ink-secondary"><span>{t('sales.vat')}</span><span className="font-mono">{fmt(taxTotal)}</span></div>}
            <div className="flex justify-between border-t border-border-subtle pt-1.5 font-semibold text-ink-primary"><span>{t('sales.total_amount')}</span><span className="font-mono">{header.currency} {fmt(grandTotal)}</span></div>
          </div>
        </div>
      </div>

      {/* Phase 12.42 — quick-create product modal. After save, auto-drops the
           new product onto the line that triggered it. */}
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
