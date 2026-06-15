import { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { getAdapter } from '@/data/index';
import { useAuthStore } from '@/store/auth';
import { useInvalidateBooks } from '@/hooks/use-invalidate-books';
import { useUnsavedChangesGuard } from '@/hooks/use-unsaved-changes-guard';
import { Button } from '@/ui/button';
import { Input } from '@/ui/input';
import { Select } from '@/ui/select';
import { SearchableSelect } from '@/ui/searchable-select';
import { ProductQuickCreate } from '@/components/quick-create/product-quick-create';
// Phase 14.06 — Signature template view mode for saved GRNs.
import { BoltDocTemplate } from '@/modules/print/_signature/templates/bolt-v4';
import { usePrintConfig } from '@/hooks/use-print-config';
import { grnToDocumentData } from '@/modules/print/_signature/adapters';
import '@/modules/print/_signature/print.css';
import type { GoodsReceiptRow, GoodsReceiptItemRow, GoodsReceiptItemInsert, ContactRow, ProductRow, WarehouseRow, Company } from '@/data/adapter';

interface LineRow {
  _key: string;
  product_id: string;
  qty_received: string;
  unit_cost: string;
  total_cost: number;
}

let _k = 0;
const newKey = () => `k${++_k}`;
const emptyLine = (): LineRow => ({ _key: newKey(), product_id: '', qty_received: '1', unit_cost: '0', total_cost: 0 });
const fmt = (n: number) => n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const todayIso = () => new Date().toISOString().slice(0, 10);

export default function GRNEditorPage() {
  const { t } = useTranslation();
  const { company_id } = useAuthStore();
  const { id } = useParams<{ id: string }>();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const printConfig = usePrintConfig();
  const qc = useQueryClient();
  const invalidateBooks = useInvalidateBooks();   // Phase 14.14k
  const isNew = id === 'new';
  const linkedPoId = searchParams.get('po_id');

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
  const { data: warehouses = [] } = useQuery<WarehouseRow[]>({
    queryKey: ['warehouses', company_id],
    queryFn: () => getAdapter().warehouses.list(company_id!),
    enabled: !!company_id,
  });
  const { data: existing } = useQuery<GoodsReceiptRow | null>({
    queryKey: ['goods_receipt', id],
    queryFn: () => getAdapter().goodsReceipts.getById(id!),
    enabled: !isNew && !!id,
  });
  const { data: existingItems = [] } = useQuery<GoodsReceiptItemRow[]>({
    queryKey: ['goods_receipt_items', id],
    queryFn: () => getAdapter().goodsReceipts.getItems(id!),
    enabled: !isNew && !!id,
  });
  // Phase 14.06 — company row for the Signature template header.
  const { data: companyRow } = useQuery<Company | null>({
    queryKey: ['company', company_id],
    queryFn:  () => getAdapter().companies.getById(company_id!),
    enabled:  !!company_id,
  });

  // Phase 14.06 — view-first mode for saved GRNs.
  const [viewMode, setViewMode] = useState(!isNew);

  // Pre-fill from PO if creating from a PO
  const { data: poItems = [] } = useQuery({
    queryKey: ['purchase_order_items_for_grn', linkedPoId],
    queryFn: () => getAdapter().purchaseOrders.getItems(linkedPoId!),
    enabled: isNew && !!linkedPoId,
  });
  const { data: poHeader } = useQuery({
    queryKey: ['purchase_order', linkedPoId],
    queryFn: () => getAdapter().purchaseOrders.getById(linkedPoId!),
    enabled: isNew && !!linkedPoId,
  });

  const [header, setHeader] = useState({
    supplier_id: '', warehouse_id: '', date: todayIso(), notes: '',
    purchase_order_id: linkedPoId ?? '',
  });
  const [lines, setLines] = useState<LineRow[]>([emptyLine()]);
  const [error, setError] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);
  const confirmLeave = useUnsavedChangesGuard(dirty);

  // Phase 12.42 — quick-create product from inside the line picker.
  const [productQcOpen,    setProductQcOpen]    = useState(false);
  const [productQcSeed,    setProductQcSeed]    = useState('');
  const [productQcLineKey, setProductQcLineKey] = useState<string | null>(null);
  const [confirmModal, setConfirmModal] = useState(false);

  useEffect(() => {
    if (existing) {
      setHeader({
        supplier_id: existing.supplier_id,
        warehouse_id: existing.warehouse_id ?? '',
        date: existing.date as string,
        notes: existing.notes ?? '',
        purchase_order_id: existing.purchase_order_id ?? '',
      });
    }
  }, [existing]);

  useEffect(() => {
    if (existingItems.length > 0) {
      setLines(existingItems.map(item => ({
        _key: newKey(), product_id: item.product_id,
        qty_received: String(item.qty_received), unit_cost: String(item.unit_cost),
        total_cost: Number(item.qty_received) * Number(item.unit_cost),
      })));
    }
  }, [existingItems]);

  // Pre-fill from PO
  useEffect(() => {
    if (isNew && poHeader) {
      setHeader(h => ({
        ...h,
        supplier_id: poHeader.supplier_id,
        warehouse_id: poHeader.warehouse_id ?? '',
        purchase_order_id: poHeader.id,
      }));
    }
  }, [isNew, poHeader]);

  useEffect(() => {
    if (isNew && poItems.length > 0) {
      setLines(poItems.map(item => ({
        _key: newKey(), product_id: item.product_id ?? '',
        qty_received: String(item.quantity), unit_cost: String(item.unit_cost),
        total_cost: Number(item.quantity) * Number(item.unit_cost),
      })));
    }
  }, [isNew, poItems]);

  const updateLine = (key: string, patch: Partial<LineRow>) => {
    setLines(prev => prev.map(l => {
      if (l._key !== key) return l;
      const u = { ...l, ...patch };
      const qty = parseFloat(u.qty_received) || 0;
      const cost = parseFloat(u.unit_cost) || 0;
      return { ...u, total_cost: qty * cost };
    }));
    setDirty(true);
  };

  const grandTotal = lines.reduce((s, l) => s + l.total_cost, 0);

  function buildItems(): GoodsReceiptItemInsert[] {
    return lines.filter(l => l.product_id).map(l => ({
      grn_id: '',
      product_id: l.product_id,
      qty_received: parseFloat(l.qty_received) || 0,
      unit_cost: parseFloat(l.unit_cost) || 0,
      total_cost: l.total_cost,
      serial_numbers: null,
      notes: null,
    }));
  }

  // Persist current header + lines as a draft. Shared by Save and Confirm
  // so confirming always posts what's on screen, never stale DB rows.
  async function persistDraft(): Promise<string> {
    if (!header.supplier_id) throw new Error(t('purchasing.error_supplier_required'));
    const grnNum = isNew ? await getAdapter().goodsReceipts.getNextNumber(company_id!) : existing!.grn_number;
    const row = {
      company_id: company_id!, grn_number: grnNum,
      purchase_order_id: header.purchase_order_id || null,
      supplier_id: header.supplier_id,
      warehouse_id: header.warehouse_id || null,
      date: header.date,
      status: 'draft' as const,
      notes: header.notes || null,
    };
    if (isNew) {
      const created = await getAdapter().goodsReceipts.create(row, buildItems());
      return created.id;
    }
    await getAdapter().goodsReceipts.update(id!, row, buildItems());
    return id!;
  }

  const saveMutation = useMutation({
    mutationFn: persistDraft,
    onSuccess: async (savedId) => {
      setDirty(false);
      await invalidateBooks();
      qc.invalidateQueries({ queryKey: ['goods_receipts', company_id] });
      if (isNew) navigate('/purchasing/grns');
      else {
        qc.invalidateQueries({ queryKey: ['goods_receipt', savedId] });
        qc.invalidateQueries({ queryKey: ['goods_receipt_items', savedId] });
      }
    },
    onError: (e: Error) => setError(e.message),
  });

  const confirmMutation = useMutation({
    mutationFn: async () => {
      const savedId = await persistDraft();   // save the grid first
      return getAdapter().goodsReceipts.confirm(savedId);
    },
    onSuccess: async () => {
      setConfirmModal(false);
      setDirty(false);
      await invalidateBooks();
      qc.invalidateQueries({ queryKey: ['goods_receipts', company_id] });
      qc.invalidateQueries({ queryKey: ['goods_receipt', id] });
      qc.invalidateQueries({ queryKey: ['goods_receipt_items', id] });
    },
    onError: (e: Error) => { setConfirmModal(false); setError(e.message); },
  });

  const canEdit = isNew || existing?.status === 'draft';
  const supplierOpts = suppliers.map(s => ({ value: s.id, label: s.name }));
  const warehouseOpts = [{ value: '', label: t('purchasing.select_warehouse') }, ...warehouses.map(w => ({ value: w.id, label: w.name }))];
  const productOpts = products.map(p => ({ value: p.id, label: `${p.sku}  ${p.name}` }));

  // Phase 14.06 — view-mode renderer (Signature template).
  if (viewMode && !isNew && existing) {
    const doc = grnToDocumentData({
      grn: existing,
      items: existingItems,
      supplier: suppliers.find(s => s.id === existing.supplier_id) ?? null,
      company: companyRow ?? null,
      products,
      linkedPoNumber: null,                   // linked PO lookup deferred
    });
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: '16px', paddingBottom: '32px' }}>
        <div
          data-no-print="true"
          style={{ display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap' }}
        >
          <button onClick={() => { if (confirmLeave()) navigate('/purchasing/grns'); }} style={{
            background: 'transparent', border: 'none', cursor: 'pointer',
            fontSize: '13px', color: '#64748b',
          }}>← {t('purchasing.grn_title')}</button>
          <span style={{ color: '#94a3b8' }}>/</span>
          <h1 style={{ margin: 0, fontSize: '20px', fontWeight: 700, color: '#1e293b', letterSpacing: '-.01em' }}>
            {existing.grn_number}
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
            {existing?.id && (
              <Button variant="ghost" size="sm" onClick={() => window.print()}>
                🖨 {t('print.print') || 'Print'}
              </Button>
            )}
          </div>
        </div>
        <div className="signature-canvas" style={{ borderRadius: '12px', overflow: 'auto' }}>
          <BoltDocTemplate data={doc} config={printConfig} />
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6 pb-16">
      <div className="flex items-center gap-3">
        <button onClick={() => { if (confirmLeave()) navigate('/purchasing/grns'); }} className="text-sm text-ink-secondary hover:text-ink-primary">← {t('purchasing.grn_title')}</button>
        <span className="text-ink-tertiary">/</span>
        <h1 className="text-xl font-semibold text-ink-primary">{isNew ? t('purchasing.new_grn') : existing?.grn_number ?? '…'}</h1>
        {!isNew && <span className="rounded-pill bg-gray-100 px-2.5 py-0.5 text-xs capitalize text-gray-600">{existing?.status}</span>}
        <div className="ms-auto flex gap-2">
          {!isNew && existing && (
            <Button variant="ghost" size="sm" onClick={() => setViewMode(true)}>
              {t('common.view') || 'View'}
            </Button>
          )}
          <Button variant="ghost" size="sm" onClick={() => { if (confirmLeave()) navigate('/purchasing/grns'); }}>{t('common.cancel')}</Button>
          {canEdit && (
            <>
              <Button size="sm" onClick={() => { setError(null); saveMutation.mutate(); }} disabled={saveMutation.isPending}>
                {saveMutation.isPending ? t('common.saving') : t('common.save')}
              </Button>
              {!isNew && (
                <Button size="sm" onClick={() => setConfirmModal(true)}>{t('purchasing.confirm_grn')}</Button>
              )}
            </>
          )}
          {!isNew && existing?.status === 'received' && (
            <Button size="sm" variant="ghost" onClick={() => navigate(`/purchasing/bills/new?grn_id=${existing.id}`)}>
              {t('purchasing.create_bill')}
            </Button>
          )}
        </div>
      </div>

      {error && <div className="rounded-input bg-red-50 px-4 py-2 text-sm text-red-700">{error}</div>}

      {confirmModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="w-80 rounded-card bg-surface-card p-6 shadow-xl">
            <h3 className="mb-3 text-base font-semibold text-ink-primary">{t('purchasing.confirm_grn')}</h3>
            <p className="mb-5 text-sm text-ink-secondary">{t('purchasing.confirm_grn_desc')}</p>
            <div className="flex gap-2 justify-end">
              <Button variant="ghost" size="sm" onClick={() => setConfirmModal(false)}>{t('common.cancel')}</Button>
              <Button size="sm" onClick={() => confirmMutation.mutate()} disabled={confirmMutation.isPending}>
                {confirmMutation.isPending ? t('common.saving') : t('purchasing.confirm_grn')}
              </Button>
            </div>
          </div>
        </div>
      )}

      <div className="rounded-card border border-border-subtle bg-surface-card p-5">
        <h2 className="mb-4 text-sm font-semibold text-ink-primary">{t('purchasing.grn_details')}</h2>
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
            disabled={!canEdit} onChange={e => { setHeader(h => ({ ...h, warehouse_id: e.target.value })); setDirty(true); }} />
          <Input label={t('purchasing.date')} type="date" required value={header.date}
            disabled={!canEdit} onChange={e => { setHeader(h => ({ ...h, date: e.target.value })); setDirty(true); }} />
          <Input label={t('purchasing.notes')} value={header.notes}
            disabled={!canEdit} onChange={e => { setHeader(h => ({ ...h, notes: e.target.value })); setDirty(true); }} />
        </div>
      </div>

      <div className="rounded-card border border-border-subtle bg-surface-card">
        <div className="border-b border-border-subtle px-5 py-3">
          <h2 className="text-sm font-semibold text-ink-primary">{t('purchasing.items_received')}</h2>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-border-subtle bg-surface-muted text-ink-tertiary">
                <th className="px-3 py-2 text-start font-medium w-56">{t('purchasing.product')}</th>
                <th className="px-3 py-2 text-end font-medium w-28">{t('purchasing.qty_received')}</th>
                <th className="px-3 py-2 text-end font-medium w-28">{t('purchasing.unit_cost')}</th>
                <th className="px-3 py-2 text-end font-medium w-28">{t('purchasing.total_cost')}</th>
                {canEdit && <th className="w-10" />}
              </tr>
            </thead>
            <tbody>
              {lines.map(line => (
                <tr key={line._key} className="border-b border-border-subtle last:border-0">
                  <td className="px-3 py-1.5">
                    <SearchableSelect
                      options={productOpts}
                      value={line.product_id}
                      disabled={!canEdit}
                      onChange={(v) => updateLine(line._key, { product_id: v })}
                      placeholder={t('purchasing.select_product')}
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
                    <input type="number" min="0" step="1"
                      className="w-full rounded border border-border-strong bg-surface-subtle px-2 py-1 text-xs text-end disabled:opacity-60"
                      value={line.qty_received} disabled={!canEdit}
                      onChange={e => updateLine(line._key, { qty_received: e.target.value })} />
                  </td>
                  <td className="px-3 py-1.5">
                    <input type="number" min="0" step="0.01"
                      className="w-full rounded border border-border-strong bg-surface-subtle px-2 py-1 text-xs text-end disabled:opacity-60"
                      value={line.unit_cost} disabled={!canEdit}
                      onChange={e => updateLine(line._key, { unit_cost: e.target.value })} />
                  </td>
                  <td className="px-3 py-1.5 text-end font-mono text-ink-primary">{fmt(line.total_cost)}</td>
                  {canEdit && (
                    <td className="px-3 py-1.5">
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
              onClick={() => { setLines(prev => [...prev, emptyLine()]); setDirty(true); }}>
              + {t('purchasing.add_line')}
            </button>
          </div>
        )}
        <div className="border-t border-border-subtle px-5 py-4">
          <div className="ms-auto w-48 text-sm">
            <div className="flex justify-between font-semibold text-ink-primary">
              <span>{t('purchasing.total_cost')}</span>
              <span className="font-mono">{fmt(grandTotal)}</span>
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
          if (productQcLineKey) updateLine(productQcLineKey, { product_id: productId });
          setProductQcLineKey(null);
        }}
      />
    </div>
  );
}
