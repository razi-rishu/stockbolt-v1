import { useState, useCallback, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { getAdapter } from '@/data/index';
import { useAuthStore } from '@/store/auth';
import { useInvalidateBooks } from '@/hooks/use-invalidate-books';
import { Input } from '@/ui/input';
import { Select } from '@/ui/select';
import { Button } from '@/ui/button';
import { Modal } from '@/ui/modal';
import { SearchableSelect } from '@/ui/searchable-select';
import { calcAdjustmentLine } from '@/core/inventory/inventory-calc';
import type { ProductRow, WarehouseRow, AdjustmentItemInsert } from '@/data/adapter';

const fmt = (n: number) => n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const REASONS = ['damage', 'shrinkage', 'theft', 'expiry', 'found', 'correction'];

interface LineRow {
  _key: string;
  product_id: string | null;
  system_qty: string;
  actual_qty: string;
  unit_cost: string;
  notes: string;
}

const newLine = (): LineRow => ({
  _key: crypto.randomUUID(), product_id: null,
  system_qty: '0', actual_qty: '0', unit_cost: '0', notes: '',
});

export default function AdjustmentEditorPage() {
  const { t } = useTranslation();
  const { id } = useParams();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const invalidateBooks = useInvalidateBooks();   // Phase 14.14k
  const { company_id } = useAuthStore();
  const isNew = !id || id === 'new';

  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [warehouseId, setWarehouseId] = useState('');
  const [reason, setReason] = useState('damage');
  const [notes, setNotes] = useState('');
  const [lines, setLines] = useState<LineRow[]>([newLine()]);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const { data: existing } = useQuery({
    queryKey: ['inventory_adjustment', id],
    queryFn: () => getAdapter().inventoryAdjustments.getById(id!),
    enabled: !isNew && !!id,
  });

  const { data: existingItems } = useQuery({
    queryKey: ['inventory_adjustment_items', id],
    queryFn: () => getAdapter().inventoryAdjustments.getItems(id!),
    enabled: !isNew && !!id,
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

  useEffect(() => {
    if (existing) {
      setDate(existing.date as string);
      setWarehouseId(existing.warehouse_id);
      setReason(existing.reason);
      setNotes(existing.notes ?? '');
    }
    if (existingItems?.length) {
      setLines(existingItems.map(i => ({
        _key: i.id,
        product_id: i.product_id,
        system_qty: String(i.system_qty),
        actual_qty: String(i.actual_qty),
        unit_cost: String(i.unit_cost ?? 0),
        notes: i.notes ?? '',
      })));
    }
  }, [existing, existingItems]);

  const updateLine = useCallback((key: string, patch: Partial<LineRow>) => {
    setLines(prev => prev.map(l => l._key !== key ? l : { ...l, ...patch }));
  }, []);

  const canEdit = isNew || existing?.status === 'draft';

  const warehouseOpts = [
    { value: '', label: t('inventory.select_warehouse') },
    ...warehouses.map(w => ({ value: w.id, label: w.name })),
  ];
  const productOpts = products.map(p => ({ value: p.id, label: `${p.sku} — ${p.name}` }));
  const reasonOpts = REASONS.map(r => ({ value: r, label: t(`inventory.reason_${r}`) }));

  function buildItems(): AdjustmentItemInsert[] {
    return lines
      .filter(l => l.product_id)
      .map(l => {
        const sysQty = parseFloat(l.system_qty) || 0;
        const actQty = parseFloat(l.actual_qty) || 0;
        const { difference } = calcAdjustmentLine(sysQty, actQty, parseFloat(l.unit_cost) || 0);
        return {
          adjustment_id: '',
          product_id: l.product_id!,
          system_qty: sysQty,
          actual_qty: actQty,
          difference,
          unit_cost: parseFloat(l.unit_cost) || null,
          notes: l.notes || null,
        };
      });
  }

  const saveMutation = useMutation({
    mutationFn: async () => {
      if (!warehouseId) throw new Error(t('inventory.error_warehouse_required'));
      const items = buildItems();
      const row = {
        company_id: company_id!,
        adjustment_number: isNew
          ? await getAdapter().inventoryAdjustments.getNextNumber(company_id!)
          : existing!.adjustment_number,
        date,
        warehouse_id: warehouseId,
        reason,
        notes: notes || null,
        status: 'draft',
      };
      if (isNew) {
        const adj = await getAdapter().inventoryAdjustments.create(row, items);
        return adj.id;
      } else {
        // For drafts we re-create (delete+insert via adapter)
        await getAdapter().inventoryAdjustments.create(row, items);
        return id!;
      }
    },
    onSuccess: async () => {
      await invalidateBooks();
      qc.invalidateQueries({ queryKey: ['inventory_adjustments'] });
      navigate('/inventory/adjustments');
    },
    onError: (e: Error) => setError(e.message),
  });

  const confirmMutation = useMutation({
    mutationFn: () => getAdapter().inventoryAdjustments.confirm(id!),
    onSuccess: async () => {
      await invalidateBooks();
      qc.invalidateQueries({ queryKey: ['inventory_adjustments'] });
      qc.invalidateQueries({ queryKey: ['inventory_adjustment', id] });
      setConfirmOpen(false);
    },
    onError: (e: Error) => { setError(e.message); setConfirmOpen(false); },
  });

  // Summary totals
  const totals = lines.reduce((acc, l) => {
    const s = parseFloat(l.system_qty) || 0;
    const a = parseFloat(l.actual_qty) || 0;
    const c = parseFloat(l.unit_cost) || 0;
    const { difference, total_value, direction } = calcAdjustmentLine(s, a, c);
    if (direction === 'in')  acc.gain += total_value;
    if (direction === 'out') acc.loss += total_value;
    acc.net += difference;
    return acc;
  }, { gain: 0, loss: 0, net: 0 });

  return (
    <div className="space-y-6 pb-16">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold text-ink-primary">
          {isNew ? t('inventory.new_adjustment') : (existing?.adjustment_number ?? t('inventory.adjustment_details'))}
        </h1>
        <div className="flex gap-2">
          {canEdit && (
            <Button size="sm" onClick={() => { setError(null); saveMutation.mutate(); }} disabled={saveMutation.isPending}>
              {t('common.save')}
            </Button>
          )}
          {!isNew && existing?.status === 'draft' && (
            <Button size="sm" variant="primary" onClick={() => setConfirmOpen(true)}>
              {t('inventory.confirm_adjustment')}
            </Button>
          )}
        </div>
      </div>

      {error && <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded p-3">{error}</p>}

      {/* Summary cards */}
      <div className="grid grid-cols-3 gap-4">
        <div className="rounded-card border border-border-subtle bg-surface-card p-4">
          <p className="text-xs text-ink-tertiary">{t('inventory.total_gain')}</p>
          <p className="text-lg font-semibold text-green-600 mt-1">{fmt(totals.gain)}</p>
        </div>
        <div className="rounded-card border border-border-subtle bg-surface-card p-4">
          <p className="text-xs text-ink-tertiary">{t('inventory.total_loss')}</p>
          <p className="text-lg font-semibold text-red-600 mt-1">{fmt(totals.loss)}</p>
        </div>
        <div className="rounded-card border border-border-subtle bg-surface-card p-4">
          <p className="text-xs text-ink-tertiary">{t('inventory.net_change')}</p>
          <p className={`text-lg font-semibold mt-1 ${totals.net >= 0 ? 'text-green-600' : 'text-red-600'}`}>
            {totals.net > 0 ? '+' : ''}{totals.net}
          </p>
        </div>
      </div>

      {/* Header */}
      <div className="rounded-card border border-border-subtle bg-surface-card p-5 space-y-4">
        <h2 className="text-sm font-semibold text-ink-primary">{t('inventory.adjustment_details')}</h2>
        <div className="grid grid-cols-3 gap-4">
          <Input label={t('inventory.date')} type="date" value={date} onChange={e => setDate(e.target.value)} disabled={!canEdit} />
          <Select label={t('inventory.warehouse')} options={warehouseOpts} value={warehouseId}
            onChange={e => setWarehouseId(e.target.value)} disabled={!canEdit} />
          <Select label={t('inventory.reason')} options={reasonOpts} value={reason}
            onChange={e => setReason(e.target.value)} disabled={!canEdit} />
        </div>
        <Input label={t('inventory.notes')} value={notes} onChange={e => setNotes(e.target.value)} disabled={!canEdit} />
      </div>

      {/* Line Items */}
      <div className="rounded-card border border-border-subtle bg-surface-card overflow-x-auto">
        <div className="px-5 py-3 border-b border-border-subtle flex items-center justify-between">
          <h2 className="text-sm font-semibold text-ink-primary">{t('inventory.count_lines')}</h2>
          {canEdit && (
            <button onClick={() => setLines(p => [...p, newLine()])}
              className="text-xs text-brand-600 hover:text-brand-700 font-medium">
              + {t('inventory.add_item')}
            </button>
          )}
        </div>
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border-subtle bg-surface-muted text-ink-tertiary text-xs">
              <th className="px-4 py-2 text-start font-medium">{t('inventory.product')}</th>
              <th className="px-4 py-2 text-end font-medium w-28">{t('inventory.system_qty')}</th>
              <th className="px-4 py-2 text-end font-medium w-28">{t('inventory.actual_qty')}</th>
              <th className="px-4 py-2 text-end font-medium w-24">{t('inventory.difference')}</th>
              <th className="px-4 py-2 text-end font-medium w-28">{t('inventory.unit_cost')}</th>
              <th className="px-4 py-2 text-end font-medium w-28">{t('inventory.value')}</th>
              {canEdit && <th className="w-10" />}
            </tr>
          </thead>
          <tbody>
            {lines.map(line => {
              const s = parseFloat(line.system_qty) || 0;
              const a = parseFloat(line.actual_qty) || 0;
              const c = parseFloat(line.unit_cost) || 0;
              const { difference, total_value, direction } = calcAdjustmentLine(s, a, c);
              const diffColor = direction === 'in' ? 'text-green-600' : direction === 'out' ? 'text-red-600' : 'text-ink-tertiary';
              return (
                <tr key={line._key} className="border-b border-border-subtle last:border-0">
                  <td className="px-4 py-2">
                    <SearchableSelect
                      options={productOpts}
                      value={line.product_id ?? ''}
                      onChange={(v) => updateLine(line._key, { product_id: v || null })}
                      disabled={!canEdit}
                      placeholder={t('inventory.select_product')}
                      panelWidth={360}
                    />
                  </td>
                  <td className="px-4 py-2">
                    <Input type="number" value={line.system_qty}
                      onChange={e => updateLine(line._key, { system_qty: e.target.value })}
                      className="text-end" disabled={!canEdit} />
                  </td>
                  <td className="px-4 py-2">
                    <Input type="number" value={line.actual_qty}
                      onChange={e => updateLine(line._key, { actual_qty: e.target.value })}
                      className="text-end" disabled={!canEdit} />
                  </td>
                  <td className={`px-4 py-2 text-end font-mono font-semibold ${diffColor}`}>
                    {difference > 0 ? '+' : ''}{difference}
                  </td>
                  <td className="px-4 py-2">
                    <Input type="number" value={line.unit_cost}
                      onChange={e => updateLine(line._key, { unit_cost: e.target.value })}
                      className="text-end" disabled={!canEdit} />
                  </td>
                  <td className={`px-4 py-2 text-end font-mono ${diffColor}`}>{fmt(total_value)}</td>
                  {canEdit && (
                    <td className="px-2 py-2">
                      <button onClick={() => setLines(p => p.filter(l => l._key !== line._key))}
                        className="text-ink-tertiary hover:text-red-500 text-lg leading-none">×</button>
                    </td>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Confirm Modal */}
      <Modal open={confirmOpen} onClose={() => setConfirmOpen(false)} title={t('inventory.confirm_adjustment')}>
        <p className="text-sm text-ink-secondary mb-4">{t('inventory.confirm_adjustment_desc')}</p>
        <div className="grid grid-cols-2 gap-3 mb-6 text-sm">
          <div className="bg-green-50 rounded p-3">
            <p className="text-xs text-ink-tertiary">{t('inventory.total_gain')}</p>
            <p className="font-semibold text-green-700">{fmt(totals.gain)}</p>
          </div>
          <div className="bg-red-50 rounded p-3">
            <p className="text-xs text-ink-tertiary">{t('inventory.total_loss')}</p>
            <p className="font-semibold text-red-700">{fmt(totals.loss)}</p>
          </div>
        </div>
        <div className="flex justify-end gap-3">
          <Button variant="ghost" size="sm" onClick={() => setConfirmOpen(false)}>{t('common.cancel')}</Button>
          <Button size="sm" variant="primary" onClick={() => confirmMutation.mutate()} disabled={confirmMutation.isPending}>
            {t('inventory.confirm_adjustment')}
          </Button>
        </div>
      </Modal>
    </div>
  );
}
