import { useState, useEffect, useRef, useCallback } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { getAdapter } from '@/data/index';
import { useAuthStore } from '@/store/auth';
import { useInvalidateBooks } from '@/hooks/use-invalidate-books';
import { Input } from '@/ui/input';
import { Select } from '@/ui/select';
import { Button } from '@/ui/button';
import { Modal } from '@/ui/modal';
import { calcPOSLine, calcPOSTotals, type POSCartLine, type POSCartLineResult } from '@/core/pos/pos-calc';
import type { ProductRow, WarehouseRow, TaxRateRow, ContactRow, PosSessionRow } from '@/data/adapter';

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

// ── Main POS Screen ────────────────────────────────────────────────────────────
export default function POSScreen() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const invalidateBooks = useInvalidateBooks();   // Phase 14.14k
  const { company_id } = useAuthStore();

  const searchRef = useRef<HTMLInputElement>(null);
  const [search, setSearch] = useState('');
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

  const { data: customers = [] } = useQuery<ContactRow[]>({
    queryKey: ['contacts', company_id, 'customer'],
    queryFn: () => getAdapter().contacts.list(company_id!, 'customer'),
    enabled: !!company_id,
  });

  // ── Keyboard shortcuts ────────────────────────────────────────────────────────
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'F2') { e.preventDefault(); searchRef.current?.focus(); }
      if (e.key === 'F4') { e.preventDefault(); if (cart.length > 0) setPaymentModal('cash'); }
      if (e.key === 'Escape') { setSearch(''); searchRef.current?.blur(); }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [cart]);

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
      }));
      return getAdapter().pos.confirmSale(
        session.id, items, method,
        customerId || null,
      );
    },
    onSuccess: async (result) => {
      setLastSale(result.invoice_number);
      setCart([]);
      setCustomerId('');
      setPaymentModal(null);
      setError(null);
      await invalidateBooks();
      qc.invalidateQueries({ queryKey: ['pos_session'] });
    },
    onError: (e: Error) => { setError(e.message); setPaymentModal(null); },
  });

  // ── Product search (local filter) ─────────────────────────────────────────────
  const filtered = search.trim().length > 0
    ? products.filter(p => {
        const q = search.toLowerCase();
        return p.name?.toLowerCase().includes(q)
          || p.sku?.toLowerCase().includes(q)
          || p.oe_number?.toLowerCase().includes(q);
      }).slice(0, 24)
    : [];

  // ── Cart helpers ──────────────────────────────────────────────────────────────
  const defaultTaxRate = taxRates[0]?.rate ?? 0;

  const addToCart = useCallback((product: ProductRow) => {
    setCart(prev => {
      const existing = prev.find(l => l.product_id === product.id);
      if (existing) {
        return prev.map(l => l.product_id === product.id ? { ...l, quantity: l.quantity + 1 } : l);
      }
      return [...prev, {
        product_id:       product.id,
        product_name:     product.name ?? '',
        sku:              product.sku ?? '',
        quantity:         1,
        unit_price:       product.selling_price ?? 0,
        discount_percent: 0,
        tax_rate:         defaultTaxRate,
      }];
    });
    setSearch('');
  }, [defaultTaxRate]);

  const updateQty = (product_id: string, qty: number) => {
    if (qty <= 0) {
      setCart(prev => prev.filter(l => l.product_id !== product_id));
    } else {
      setCart(prev => prev.map(l => l.product_id === product_id ? { ...l, quantity: qty } : l));
    }
  };

  // ── Totals ────────────────────────────────────────────────────────────────────
  const cartLines: POSCartLineResult[] = cart.map(calcPOSLine);
  const totals = calcPOSTotals(cartLines);

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
    <div className="flex h-[calc(100vh-3.5rem)] bg-surface-page overflow-hidden -m-6">
      {/* ── Left panel: Search + Results ─────────────────────────────────── */}
      <div className="flex flex-1 flex-col overflow-hidden border-e border-border-subtle">

        {/* Session bar */}
        <div className="flex items-center justify-between bg-surface-card border-b border-border-subtle px-4 py-2.5">
          <div className="flex items-center gap-3 text-sm">
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
            placeholder={`${t('pos.search_placeholder')} (F2)`}
            className="w-full rounded-card border border-border-subtle bg-surface-page px-3 py-2 text-sm text-ink-primary placeholder:text-ink-tertiary focus:border-brand-400 focus:outline-none focus:ring-2 focus:ring-brand-200"
          />
        </div>

        {/* Product grid */}
        <div className="flex-1 overflow-y-auto p-4">
          {search.trim() === '' ? (
            <div className="flex items-center justify-center h-full text-sm text-ink-tertiary">
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
      <div className="flex w-80 flex-col bg-surface-card">
        {/* Cart items */}
        <div className="flex-1 overflow-y-auto p-3 space-y-1.5">
          {cart.length === 0 ? (
            <p className="py-8 text-center text-sm text-ink-tertiary">{t('pos.cart_empty')}</p>
          ) : cartLines.map((line, i) => (
            <div key={line.product_id + i} className="rounded-card border border-border-subtle p-2.5">
              <div className="flex items-start justify-between gap-2">
                <div className="flex-1 min-w-0">
                  <p className="text-xs text-ink-tertiary font-mono truncate">{line.sku}</p>
                  <p className="text-sm font-medium text-ink-primary leading-tight">{line.product_name}</p>
                </div>
                <button onClick={() => updateQty(line.product_id, 0)}
                  className="text-ink-tertiary hover:text-red-500 text-lg leading-none shrink-0">×</button>
              </div>
              <div className="flex items-center justify-between mt-2">
                <div className="flex items-center gap-1">
                  <button onClick={() => updateQty(line.product_id, line.quantity - 1)}
                    className="w-6 h-6 rounded border border-border-subtle text-ink-secondary text-sm hover:bg-surface-muted">−</button>
                  <span className="w-8 text-center text-sm font-semibold">{line.quantity}</span>
                  <button onClick={() => updateQty(line.product_id, line.quantity + 1)}
                    className="w-6 h-6 rounded border border-border-subtle text-ink-secondary text-sm hover:bg-surface-muted">+</button>
                </div>
                <p className="text-sm font-semibold text-ink-primary">{fmt(line.line_total)}</p>
              </div>
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
              <span>{t('pos.tax')}</span><span>{fmt(totals.tax_amount)}</span>
            </div>
          )}
          <div className="flex justify-between font-bold text-ink-primary text-base border-t border-border-subtle pt-2 mt-1">
            <span>{t('pos.total')}</span><span>{fmt(totals.total_amount)}</span>
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
            onClick={() => setPaymentModal('cash')}
            className="rounded-card border-2 border-green-500 bg-green-50 py-3 text-sm font-bold text-green-700 hover:bg-green-100 disabled:opacity-40 transition-colors">
            💵 {t('pos.cash')}
          </button>
          <button
            disabled={cart.length === 0 || saleMutation.isPending}
            onClick={() => setPaymentModal('card')}
            className="rounded-card border-2 border-blue-500 bg-blue-50 py-3 text-sm font-bold text-blue-700 hover:bg-blue-100 disabled:opacity-40 transition-colors">
            💳 {t('pos.card')}
          </button>
          <button
            disabled={cart.length === 0 || saleMutation.isPending}
            onClick={() => setPaymentModal('credit')}
            className="col-span-2 rounded-card border-2 border-orange-500 bg-orange-50 py-3 text-sm font-bold text-orange-700 hover:bg-orange-100 disabled:opacity-40 transition-colors">
            📋 {t('pos.credit')} (F4)
          </button>
        </div>
      </div>

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
