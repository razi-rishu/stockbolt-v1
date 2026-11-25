import { useState, useEffect, useRef, useCallback } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { getAdapter } from '@/data/index';
import { useAuthStore } from '@/store/auth';
import { useInvalidateBooks } from '@/hooks/use-invalidate-books';
import { useCompanyCountry, useCompanyRoundingStep, useTaxName } from '@/hooks/use-company-currency';
import { applyRoundOff } from '@/core/sales/invoice-calc';
import { defaultTaxRate as countryStdTaxRate } from '@/lib/locale';
import { Input } from '@/ui/input';
import { Select } from '@/ui/select';
import { Button } from '@/ui/button';
import { Modal } from '@/ui/modal';
import { calcPOSLine, calcPOSTotals, type POSCartLine, type POSCartLineResult } from '@/core/pos/pos-calc';
import { loadHardwareConfig, normalizeScan, resolveScan } from '@/lib/hardware-config';
import { usePacks } from '@/hooks/use-packs';
import { PackSelect } from '@/components/packs/pack-select';
import { recordPackAcceptance, usePackGate } from '@/components/packs/use-pack-gate';
import { packError } from '@/lib/pack-errors';
import { linePackFrom, linePackOf, NO_PACK, packColumn, packInput, packPrice, type ProductUnitRow } from '@/lib/packs';
import type { ProductRow, WarehouseRow, TaxRateRow, ContactRow, PosSessionRow } from '@/data/adapter';

/** One cart row per product and pack: 2 BOX and 5 PCS are two rows. */
const rowKey = (l: { product_id: string; product_unit_id?: string | null }) => `${l.product_id}|${l.product_unit_id ?? ''}`;

const fmt = (n: number) => n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

type PaymentMethod = 'cash' | 'card' | 'credit';

// ── Open Session Dialog ────────────────────────────────────────────────────────
function OpenSessionDialog({ warehouses, onOpen }: {
  warehouses: WarehouseRow[];
  onOpen: (warehouseId: string, openingCash: number) => void;
}) {
  const { t } = useTranslation();
  const [warehouseId, setWarehouseId] = useState(warehouses.find(w => w.is_default)?.id ?? warehouses[0]?.id ?? '');
  const [openingCash, setOpeningCash] = useState('0');
  const [loading, setLoading] = useState(false);

  const warehouseOpts = warehouses.map(w => ({ value: w.id, label: w.name }));

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="w-full max-w-sm rounded-xl bg-surface-card p-6 shadow-xl">
        <h2 className="text-lg font-semibold text-ink-primary mb-4">{t('pos.open_session')}</h2>
        <div className="space-y-3">
          <Select label={t('pos.warehouse')} options={warehouseOpts} value={warehouseId}
            onChange={e => setWarehouseId(e.target.value)} />
          <Input label={t('pos.opening_cash')} type="number" value={openingCash}
            onChange={e => setOpeningCash(e.target.value)} />
        </div>
        <Button className="mt-5 w-full" variant="primary"
          disabled={!warehouseId || loading}
          onClick={() => { setLoading(true); onOpen(warehouseId, parseFloat(openingCash) || 0); }}>
          {t('pos.start_session')}
        </Button>
      </div>
    </div>
  );
}

// ── Close Session Dialog ───────────────────────────────────────────────────────
function CloseSessionDialog({ session, onClose, onCancel }: {
  session: PosSessionRow;
  onClose: (counted: number, reason: string) => void;
  onCancel: () => void;
}) {
  const { t } = useTranslation();
  const [counted, setCounted] = useState('');
  const [reason, setReason] = useState('');

  return (
    <Modal open onClose={onCancel} title={t('pos.close_session')}>
      <div className="space-y-3 mb-4">
        <div className="grid grid-cols-2 gap-3 text-sm">
          <div className="bg-surface-muted rounded p-3">
            <p className="text-xs text-ink-tertiary">{t('pos.session_number')}</p>
            <p className="font-semibold">{session.session_number}</p>
          </div>
          <div className="bg-surface-muted rounded p-3">
            <p className="text-xs text-ink-tertiary">{t('pos.total_sales')}</p>
            <p className="font-semibold text-green-700">{fmt(session.total_sales_amount ?? 0)}</p>
          </div>
        </div>
        <Input label={t('pos.counted_cash')} type="number" value={counted} onChange={e => setCounted(e.target.value)} />
        <Input label={t('pos.variance_reason')} value={reason} onChange={e => setReason(e.target.value)} />
      </div>
      <div className="flex justify-end gap-3">
        <Button variant="ghost" size="sm" onClick={onCancel}>{t('common.cancel')}</Button>
        <Button size="sm" variant="primary" onClick={() => onClose(parseFloat(counted) || 0, reason)}>
          {t('pos.close_session')}
        </Button>
      </div>
    </Modal>
  );
}

/** A quantity that can be typed (0.5 KG); an empty or zero entry goes back to what it was. */
function PosQty({ value, onChange, label }: { value: number; onChange: (q: number) => void; label: string }) {
  const [text, setText] = useState(String(value));
  useEffect(() => { setText(String(value)); }, [value]);
  const commit = () => {
    const n = Math.round(parseFloat(text) * 1000) / 1000;
    if (Number.isFinite(n) && n > 0) onChange(n); else setText(String(value));
  };
  return (
    <input type="number" min="0" step="any" inputMode="decimal" aria-label={label} value={text} data-testid="pos-qty"
      onChange={e => {
        setText(e.target.value);
        // The total follows while typing, so it is right even before leaving the box.
        const n = Math.round(parseFloat(e.target.value) * 1000) / 1000;
        if (Number.isFinite(n) && n > 0 && String(n) === e.target.value) onChange(n);
      }}
      onBlur={commit} onKeyDown={e => { if (e.key === 'Enter') e.currentTarget.blur(); }}
      className="w-16 rounded border border-border-subtle px-1 py-0.5 text-center text-sm font-semibold" dir="ltr" />
  );
}

// ── Main POS Screen ────────────────────────────────────────────────────────────
export default function POSScreen() {
  const taxName = useTaxName();   // GST for India, VAT for the GCC
  const { t } = useTranslation();
  const qc = useQueryClient();
  const invalidateBooks = useInvalidateBooks();   // Phase 14.14k
  const { company_id } = useAuthStore();

  const searchRef = useRef<HTMLInputElement>(null);
  const [search, setSearch] = useState('');
  // Per-device scanner/printer config (Settings → Barcode & Printer Setup).
  const hwCfg = useRef(loadHardwareConfig()).current;
  const [cart, setCart] = useState<POSCartLine[]>([]);
  const [customerId, setCustomerId] = useState<string>('');
  const [paymentModal, setPaymentModal] = useState<PaymentMethod | null>(null);
  const [closeDialog, setCloseDialog] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastSale, setLastSale] = useState<string | null>(null);

  // ── Queries ──────────────────────────────────────────────────────────────────
  const { data: session, isLoading: sessionLoading } = useQuery<PosSessionRow | null>({
    queryKey: ['pos_session', company_id],
    queryFn: () => getAdapter().pos.getOpenSession(company_id!),
    enabled: !!company_id,
    refetchInterval: 30_000,
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
    queryKey: ['tax_rates', company_id],
    queryFn: () => getAdapter().taxRates.list(company_id!),
    enabled: !!company_id,
  });
  const companyCountry = useCompanyCountry();

  const { data: customers = [] } = useQuery<ContactRow[]>({
    queryKey: ['contacts', company_id, 'customer'],
    queryFn: () => getAdapter().contacts.list(company_id!, 'customer'),
    enabled: !!company_id,
  });

  // ── Keyboard shortcuts ────────────────────────────────────────────────────────
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'F2') { e.preventDefault(); searchRef.current?.focus(); }
      if (e.key === 'F4') { e.preventDefault(); if (cart.length > 0) askPay('cash'); }
      if (e.key === 'Escape') { setSearch(''); searchRef.current?.blur(); }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  });

  // ── Session mutations ─────────────────────────────────────────────────────────
  const openSessionMutation = useMutation({
    mutationFn: ({ warehouseId, openingCash }: { warehouseId: string; openingCash: number }) =>
      getAdapter().pos.openSession(warehouseId, openingCash),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['pos_session'] }),
    onError: (e: Error) => setError(e.message),
  });

  const closeSessionMutation = useMutation({
    mutationFn: ({ counted, reason }: { counted: number; reason: string }) =>
      getAdapter().pos.closeSession(session!.id, counted, reason),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['pos_session'] }); setCloseDialog(false); },
    onError: (e: Error) => { setError(e.message); setCloseDialog(false); },
  });

  // ── Sale mutation ─────────────────────────────────────────────────────────────
  const saleMutation = useMutation({
    mutationFn: ({ method }: { method: PaymentMethod }) => {
      if (!session) throw new Error('No active session');
      if (method === 'credit' && !customerId) throw new Error(t('pos.error_customer_required'));
      const defaultRate = taxRates[0]?.rate ?? 0;
      const items = cart.map(c => ({
        product_id:       c.product_id,
        description:      c.product_name,
        quantity:         c.quantity,
        unit_price:       c.unit_price,
        discount_percent: c.discount_percent,
        tax_rate:         c.tax_rate || defaultRate,
        ...packColumn(linePackOf(c)),
      }));
      return getAdapter().pos.confirmSale(
        session.id, items, method,
        customerId || null,
      );
    },
    onSuccess: async (result) => {
      if (result.invoice_id) void recordPackAcceptance('invoice', result.invoice_id, packLines);
      setLastSale(result.invoice_number);
      setCart([]);
      setCustomerId('');
      setPaymentModal(null);
      setError(null);
      // Settings → Barcode & Printer Setup: open the print dialog automatically.
      if (hwCfg.printer.autoPrintAfterSale && result.invoice_id) {
        window.open(`/print/invoice/${result.invoice_id}?autoprint=1`, '_blank');
      }
      await invalidateBooks();
      qc.invalidateQueries({ queryKey: ['pos_session'] });
    },
    onError: (e: Error) => { setError(packError(t, e)); setPaymentModal(null); },
  });

  // ── Product search (local filter) ─────────────────────────────────────────────
  const filtered = search.trim().length > 0
    ? products.filter(p => {
        const q = search.toLowerCase();
        return p.name?.toLowerCase().includes(q)
          || p.sku?.toLowerCase().includes(q)
          || p.oe_number?.toLowerCase().includes(q)
          || p.barcode?.toLowerCase().includes(q);
      }).slice(0, 24)
    : [];

  // ── Cart helpers ──────────────────────────────────────────────────────────────
  // Default new cart lines to the company's standard rate (5% GCC / 18% India),
  // not the alphabetically-first seeded rate (which would be a 0% / exempt row).
  const stdRate = countryStdTaxRate(companyCountry);
  const defaultTaxRate = taxRates.find(r => Number(r.rate) === stdRate)?.rate ?? (taxRates[0]?.rate ?? 0);

  // phase155 — packs. Off: one row per product in its own unit, as always.
  const packs = usePacks();
  const packGate = usePackGate({ loading: packs.loading, continueLabel: t('packs.to_payment') });
  const { data: stockMap = {} } = useQuery({
    queryKey: ['current_stock_map', company_id],
    queryFn: () => getAdapter().stockLedger.getCurrentStockMap(company_id!),
    enabled: !!company_id && packs.on,
  });
  const packLines = !packs.on ? [] : cart.flatMap(c => {
    const product = products.find(p => p.id === c.product_id);
    return packInput({ ...linePackOf(c), quantity: c.quantity, net_price: c.unit_price * (1 - c.discount_percent / 100) },
      product, packs, product ? stockMap[product.id] : null, 0) ?? [];
  });
  /** Pack quantities are accepted before any payment is taken. */
  const askPay = (method: PaymentMethod) => { setError(null); packGate.ask(packLines, () => setPaymentModal(method)); };

  const addToCart = useCallback((product: ProductRow, pack: ProductUnitRow | null = null) => {
    const key = rowKey({ product_id: product.id, product_unit_id: pack?.id });
    setCart(prev => {
      const existing = prev.find(l => rowKey(l) === key);
      if (existing) {
        return prev.map(l => rowKey(l) === key ? { ...l, quantity: l.quantity + 1 } : l);
      }
      const price = product.selling_price ?? 0;
      return [...prev, {
        product_id:       product.id,
        product_name:     product.name ?? '',
        sku:              product.sku ?? '',
        quantity:         1,
        unit_price:       pack ? packPrice(pack, Number(price)) : price,
        discount_percent: 0,
        tax_rate:         defaultTaxRate,
        ...(pack ? linePackFrom(pack) : {}),
      }];
    });
    setSearch('');
  }, [defaultTaxRate]);

  /** A scanned code: the product fields first, as always, then a pack's own barcode. */
  const addScanned = useCallback((code: string): boolean => {
    const hit = resolveScan(code, products, hwCfg);
    if (hit) { addToCart(hit); return true; }
    const pack = packs.byBarcode(normalizeScan(code, hwCfg));
    const product = pack?.for_sales ? products.find(p => p.id === pack.product_id) : undefined;
    if (!product) return false;
    addToCart(product, pack!);
    return true;
  }, [products, hwCfg, addToCart, packs]);

  const changePack = (line: POSCartLine, pack: ProductUnitRow | null) => {
    const price = Number(products.find(p => p.id === line.product_id)?.selling_price ?? 0);
    const from = rowKey(line);
    const next = { ...line, ...(pack ? linePackFrom(pack) : NO_PACK), unit_price: pack ? packPrice(pack, price) : price };
    const to = rowKey(next);
    setCart(prev => {
      // Already a row in that unit: add to it instead of making a second one.
      if (prev.some(l => rowKey(l) === to)) {
        return prev.filter(l => rowKey(l) !== from).map(l => rowKey(l) === to ? { ...l, quantity: +(l.quantity + line.quantity).toFixed(3) } : l);
      }
      return prev.map(l => rowKey(l) === from ? next : l);
    });
  };

  // ── Barcode scanner (keyboard-wedge burst capture) ────────────────────────────
  // Scanners "type" the code very fast and finish with Enter. When the user isn't
  // typing in a field, we collect those bursts and resolve them through the
  // configured mapping (Settings → Barcode & Printer Setup). Exact matches only.
  const scanBuf = useRef({ chars: '', last: 0 });
  useEffect(() => {
    if (!hwCfg.scanner.enabled) return;
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      const typing = !!el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable);
      if (typing) return;                    // the search box handles its own Enter below
      const now = Date.now();
      if (now - scanBuf.current.last > 120) scanBuf.current.chars = '';   // humans type slower than this
      scanBuf.current.last = now;
      if (e.key === 'Enter') {
        const code = scanBuf.current.chars;
        scanBuf.current.chars = '';
        if (code.length >= hwCfg.scanner.minLength) {
          if (addScanned(code)) setError(null);
          else setError(`${t('pos.no_results')} — "${code}"`);
        }
      } else if (e.key.length === 1) {
        scanBuf.current.chars += e.key;
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [addScanned, hwCfg, t]);

  const updateQty = (key: string, qty: number) => {
    if (qty <= 0) {
      setCart(prev => prev.filter(l => rowKey(l) !== key));
    } else {
      setCart(prev => prev.map(l => rowKey(l) === key ? { ...l, quantity: qty } : l));
    }
  };

  // ── Totals ────────────────────────────────────────────────────────────────────
  const cartLines: POSCartLineResult[] = cart.map(calcPOSLine);
  const totals = calcPOSTotals(cartLines);
  // Phase 46 — mirror the server-side cash rounding so the display matches
  // what confirm_pos_sale will actually charge.
  const roundingStep = useCompanyRoundingStep();
  const { round_off: roundOff, rounded_total: roundedTotal } = applyRoundOff(totals.total_amount, roundingStep);

  const customerOpts = [
    { value: '', label: t('pos.select_customer') },
    ...customers.map(c => ({ value: c.id, label: c.name })),
  ];

  if (sessionLoading) {
    return <div className="flex h-full items-center justify-center text-sm text-ink-tertiary">{t('common.loading')}</div>;
  }

  if (!session) {
    return (
      <OpenSessionDialog
        warehouses={warehouses}
        onOpen={(wId, cash) => openSessionMutation.mutate({ warehouseId: wId, openingCash: cash })}
      />
    );
  }

  const warehouseName = warehouses.find(w => w.id === session.warehouse_id)?.name ?? session.warehouse_id;

  return (
    // Phones (below md): search + results on top, cart underneath, in one
    // scrolling column. md and up: the original side-by-side till.
    <div className="flex flex-col bg-surface-page md:-m-6 md:h-[calc(100vh-3.5rem)] md:flex-row md:overflow-hidden">
      {/* ── Left panel: Search + Results ─────────────────────────────────── */}
      <div className="flex flex-col border-b border-border-subtle md:flex-1 md:overflow-hidden md:border-b-0 md:border-e">

        {/* Session bar */}
        <div className="flex flex-wrap items-center justify-between gap-2 bg-surface-card border-b border-border-subtle px-4 py-2.5">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
            <span className="font-semibold text-brand-600">{session.session_number}</span>
            <span className="text-ink-tertiary">·</span>
            <span className="text-ink-secondary">{warehouseName}</span>
            <span className="text-ink-tertiary">·</span>
            <span className="text-ink-secondary">{fmt(session.total_sales_amount ?? 0)} {t('pos.total_today')}</span>
          </div>
          <Button size="sm" variant="ghost" onClick={() => setCloseDialog(true)}>
            {t('pos.close_session')}
          </Button>
        </div>

        {/* Search */}
        <div className="px-4 py-3 bg-surface-card border-b border-border-subtle">
          <input
            ref={searchRef}
            type="text"
            value={search}
            onChange={e => setSearch(e.target.value)}
            onKeyDown={e => {
              if (e.key !== 'Enter' || !search.trim()) return;
              e.preventDefault();
              // Scanner (or typed code) into the search box: exact mapping first,
              // then a single filtered result — either way straight into the cart.
              if (addScanned(search)) { setError(null); return; }
              if (filtered.length === 1) addToCart(filtered[0]);
            }}
            placeholder={`${t('pos.search_placeholder')} (F2)`}
            className="w-full rounded-card border border-border-subtle bg-surface-page px-3 py-2 text-sm text-ink-primary placeholder:text-ink-tertiary focus:border-brand-400 focus:outline-none focus:ring-2 focus:ring-brand-200"
          />
        </div>

        {/* Product grid */}
        <div className="max-h-[45vh] overflow-y-auto p-4 md:max-h-none md:flex-1">
          {search.trim() === '' ? (
            <div className="flex items-center justify-center h-full py-6 text-sm text-ink-tertiary md:py-0">
              {t('pos.search_hint')}
            </div>
          ) : filtered.length === 0 ? (
            <p className="text-center text-sm text-ink-tertiary py-8">{t('pos.no_results')}</p>
          ) : (
            <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-4">
              {filtered.map(p => (
                <button
                  key={p.id}
                  onClick={() => addToCart(p)}
                  className="rounded-card border border-border-subtle bg-surface-card p-3 text-start hover:border-brand-400 hover:bg-brand-50 transition-colors"
                >
                  <p className="text-xs text-ink-tertiary font-mono">{p.sku}</p>
                  <p className="text-sm font-medium text-ink-primary mt-0.5 leading-tight line-clamp-2">{p.name}</p>
                  <p className="text-sm font-semibold text-brand-600 mt-1">{fmt(p.selling_price ?? 0)}</p>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* ── Right panel: Cart + Payment ───────────────────────────────────── */}
      <div className="flex w-full flex-col bg-surface-card md:w-80">
        {/* Cart items */}
        <div className="flex-1 overflow-y-auto p-3 space-y-1.5">
          {cart.length === 0 ? (
            <p className="py-8 text-center text-sm text-ink-tertiary">{t('pos.cart_empty')}</p>
          ) : cartLines.map((line, i) => (
            <div key={rowKey(line) + i} className="rounded-card border border-border-subtle p-2.5">
              <div className="flex items-start justify-between gap-2">
                <div className="flex-1 min-w-0">
                  <p className="text-xs text-ink-tertiary font-mono truncate">{line.sku}</p>
                  <p className="text-sm font-medium text-ink-primary leading-tight">{line.product_name}</p>
                </div>
                <button onClick={() => updateQty(rowKey(line), 0)}
                  className="text-ink-tertiary hover:text-red-500 text-lg leading-none shrink-0">×</button>
              </div>
              <div className="flex items-center justify-between mt-2">
                <div className="flex items-center gap-1">
                  <button onClick={() => updateQty(rowKey(line), +(line.quantity - 1).toFixed(3))}
                    className="w-6 h-6 rounded border border-border-subtle text-ink-secondary text-sm hover:bg-surface-muted">−</button>
                  {packs.on
                    ? <PosQty value={line.quantity} onChange={(q) => updateQty(rowKey(line), q)} label={t('sales.qty')} />
                    : <span className="w-8 text-center text-sm font-semibold">{line.quantity}</span>}
                  <button onClick={() => updateQty(rowKey(line), +(line.quantity + 1).toFixed(3))}
                    className="w-6 h-6 rounded border border-border-subtle text-ink-secondary text-sm hover:bg-surface-muted">+</button>
                </div>
                <p className="text-sm font-semibold text-ink-primary">{fmt(line.line_total)}</p>
              </div>
              {packs.on && (
                <PackSelect packs={packs.forProduct(line.product_id, 'sales')} value={line.product_unit_id ?? null}
                  savedLabel={line.unit_label} savedFactor={line.unit_factor}
                  baseUnit={packs.unitCode(products.find(p => p.id === line.product_id)?.unit_id)}
                  quantity={line.quantity} onChange={(pack) => changePack(line, pack)} />
              )}
            </div>
          ))}
        </div>

        {/* Totals */}
        <div className="border-t border-border-subtle p-3 space-y-1 text-sm">
          <div className="flex justify-between text-ink-secondary">
            <span>{t('pos.subtotal')}</span><span>{fmt(totals.subtotal)}</span>
          </div>
          {totals.tax_amount > 0 && (
            <div className="flex justify-between text-ink-secondary">
              <span>{taxName}</span><span>{fmt(totals.tax_amount)}</span>
            </div>
          )}
          {roundOff !== 0 && (
            <div className="flex justify-between text-ink-secondary">
              <span>{t('sales.round_off')}</span><span>{roundOff > 0 ? '+' : '−'}{fmt(Math.abs(roundOff))}</span>
            </div>
          )}
          <div className="flex justify-between font-bold text-ink-primary text-base border-t border-border-subtle pt-2 mt-1">
            <span>{t('pos.total')}</span><span>{fmt(roundedTotal)}</span>
          </div>
        </div>

        {/* Customer (for credit) */}
        <div className="px-3 pb-2">
          <Select options={customerOpts} value={customerId} onChange={e => setCustomerId(e.target.value)} />
        </div>

        {/* Error */}
        {error && <p className="px-3 pb-1 text-xs text-red-600">{error}</p>}

        {/* Last sale banner */}
        {lastSale && (
          <div className="mx-3 mb-2 rounded bg-green-50 border border-green-200 px-3 py-2 text-xs text-green-700 flex justify-between">
            <span>✓ {lastSale}</span>
            <button onClick={() => setLastSale(null)} className="text-green-500">×</button>
          </div>
        )}

        {/* Payment buttons */}
        <div className="p-3 pt-0 grid grid-cols-2 gap-2">
          <button
            disabled={cart.length === 0 || saleMutation.isPending}
            onClick={() => askPay('cash')}
            className="rounded-card border-2 border-green-500 bg-green-50 py-3 text-sm font-bold text-green-700 hover:bg-green-100 disabled:opacity-40 transition-colors">
            💵 {t('pos.cash')}
          </button>
          <button
            disabled={cart.length === 0 || saleMutation.isPending}
            onClick={() => askPay('card')}
            className="rounded-card border-2 border-blue-500 bg-blue-50 py-3 text-sm font-bold text-blue-700 hover:bg-blue-100 disabled:opacity-40 transition-colors">
            💳 {t('pos.card')}
          </button>
          <button
            disabled={cart.length === 0 || saleMutation.isPending}
            onClick={() => askPay('credit')}
            className="col-span-2 rounded-card border-2 border-orange-500 bg-orange-50 py-3 text-sm font-bold text-orange-700 hover:bg-orange-100 disabled:opacity-40 transition-colors">
            📋 {t('pos.credit')} (F4)
          </button>
        </div>
      </div>

      {packGate.modal}
      {/* ── Payment Confirm Modal ─────────────────────────────────────────── */}
      {paymentModal && (
        <Modal open onClose={() => setPaymentModal(null)}
          title={paymentModal === 'cash' ? t('pos.confirm_cash') : paymentModal === 'card' ? t('pos.confirm_card') : t('pos.confirm_credit')}>
          <div className="space-y-3 mb-5">
            {paymentModal === 'credit' && !customerId && (
              <p className="text-sm text-red-600 bg-red-50 rounded p-2">{t('pos.error_customer_required')}</p>
            )}
            <div className="grid grid-cols-2 gap-3 text-sm">
              <div className="bg-surface-muted rounded p-3">
                <p className="text-xs text-ink-tertiary">{t('pos.items')}</p>
                <p className="font-semibold">{cart.length}</p>
              </div>
              <div className="bg-surface-muted rounded p-3">
                <p className="text-xs text-ink-tertiary">{t('pos.total')}</p>
                <p className="font-bold text-lg text-ink-primary">{fmt(totals.total_amount)}</p>
              </div>
            </div>
            {paymentModal === 'credit' && customerId && (
              <p className="text-sm text-ink-secondary">
                {t('pos.customer')}: <strong>{customers.find(c => c.id === customerId)?.name}</strong>
              </p>
            )}
          </div>
          <div className="flex justify-end gap-3">
            <Button variant="ghost" size="sm" onClick={() => setPaymentModal(null)}>{t('common.cancel')}</Button>
            <Button size="sm" variant="primary"
              disabled={saleMutation.isPending || (paymentModal === 'credit' && !customerId)}
              onClick={() => saleMutation.mutate({ method: paymentModal })}>
              {saleMutation.isPending ? t('common.loading') : t('pos.confirm_sale')}
            </Button>
          </div>
        </Modal>
      )}

      {/* ── Close Session Dialog ──────────────────────────────────────────── */}
      {closeDialog && (
        <CloseSessionDialog
          session={session}
          onClose={(counted, reason) => closeSessionMutation.mutate({ counted, reason })}
          onCancel={() => setCloseDialog(false)}
        />
      )}
    </div>
  );
}
