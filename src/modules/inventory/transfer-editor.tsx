import { useState, useCallback, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { getAdapter } from '@/data/index';
import { useAuthStore } from '@/store/auth';
import { Input } from '@/ui/input';
import { Select } from '@/ui/select';
import { Button } from '@/ui/button';
import { Modal } from '@/ui/modal';
import type { ProductRow, WarehouseRow, StockTransferItemInsert } from '@/data/adapter';

interface LineRow {
  _key: string;
  product_id: string | null;
  quantity: string;
  unit_cost: string;
  notes: string;
}

const newLine = (): LineRow => ({
  _key: crypto.randomUUID(), product_id: null, quantity: '1', unit_cost: '0', notes: '',
});

export default function TransferEditorPage() {
  const { t } = useTranslation();
  const { id } = useParams();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { company_id } = useAuthStore();
  const isNew = !id || id === 'new';

  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [fromWarehouseId, setFromWarehouseId] = useState('');
  const [toWarehouseId, setToWarehouseId] = useState('');
  const [notes, setNotes] = useState('');
  const [lines, setLines] = useState<LineRow[]>([newLine()]);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const { data: existing } = useQuery({
    queryKey: ['stock_transfer', id],
    queryFn: () => getAdapter().stockTransfers.getById(id!),
    enabled: !isNew && !!id,
  });

  const { data: existingItems } = useQuery({
    queryKey: ['stock_transfer_items', id],
    queryFn: () => getAdapter().stockTransfers.getItems(id!),
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
      setFromWarehouseId(existing.from_warehouse_id);
      setToWarehouseId(existing.to_warehouse_id);
      setNotes(existing.notes ?? '');
    }
    if (existingItems?.length) {
      setLines(existingItems.map(i => ({
        _key: i.id,
        product_id: i.product_id,
        quantity: String(i.quantity),
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
  const productOpts = [
    { value: '', label: t('inventory.select_product') },
    ...products.map(p => ({ value: p.id, label: `${p.sku} — ${p.name}` })),
  ];

  function buildItems(): StockTransferItemInsert[] {
    return lines
      .filter(l => l.product_id && Number(l.quantity) > 0)
      .map(l => ({
        transfer_id: '',
        product_id: l.product_id!,
        quantity: parseFloat(l.quantity) || 0,
        unit_cost: parseFloat(l.unit_cost) || null,
        notes: l.notes || null,
      }));
  }

  const saveMutation = useMutation({
    mutationFn: async () => {
      const items = buildItems();
      if (!fromWarehouseId || !toWarehouseId) throw new Error(t('inventory.error_warehouses_required'));
      if (fromWarehouseId === toWarehouseId) throw new Error(t('inventory.error_same_warehouse'));
      if (items.length === 0) throw new Error(t('inventory.error_no_items'));

      const row = {
        company_id: company_id!,
        transfer_number: isNew
          ? await getAdapter().stockTransfers.getNextNumber(company_id!)
          : existing!.transfer_number,
        date,
        from_warehouse_id: fromWarehouseId,
        to_warehouse_id: toWarehouseId,
        status: 'draft',
        notes: notes || null,
      };
      if (isNew) {
        const t = await getAdapter().stockTransfers.create(row, items);
        return t.id;
      } else {
        await getAdapter().stockTransfers.update(id!, row, items);
        return id!;
      }
    },
    onSuccess: (newId) => {
      qc.invalidateQueries({ queryKey: ['stock_transfers'] });
      if (isNew) navigate(`/inventory/transfers/${newId}`, { replace: true });
    },
    onError: (e: Error) => setError(e.message),
  });

  const confirmMutation = useMutation({
    mutationFn: () => getAdapter().stockTransfers.confirm(id!),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['stock_transfers'] });
      qc.invalidateQueries({ queryKey: ['stock_transfer', id] });
      setConfirmOpen(false);
    },
    onError: (e: Error) => { setError(e.message); setConfirmOpen(false); },
  });

  return (
    <div className="space-y-6 pb-16">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold text-ink-primary">
          {isNew ? t('inventory.new_transfer') : (existing?.transfer_number ?? t('inventory.transfer_details'))}
        </h1>
        <div className="flex gap-2">
          {canEdit && (
            <Button size="sm" onClick={() => { setError(null); saveMutation.mutate(); }} disabled={saveMutation.isPending}>
              {t('common.save')}
            </Button>
          )}
          {!isNew && existing?.status === 'draft' && (
            <Button size="sm" variant="primary" onClick={() => setConfirmOpen(true)}>
              {t('inventory.confirm_transfer')}
            </Button>
          )}
        </div>
      </div>

      {error && <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded p-3">{error}</p>}

      <div className="rounded-card border border-border-subtle bg-surface-card p-5 space-y-4">
        <h2 className="text-sm font-semibold text-ink-primary">{t('inventory.transfer_details')}</h2>
        <div className="grid grid-cols-2 gap-4">
          <Input label={t('inventory.date')} type="date" value={date} onChange={e => setDate(e.target.value)} disabled={!canEdit} />
        </div>
        <div className="grid grid-cols-2 gap-4">
          <Select label={t('inventory.from_warehouse')} options={warehouseOpts} value={fromWarehouseId}
            onChange={e => setFromWarehouseId(e.target.value)} disabled={!canEdit} />
          <Select label={t('inventory.to_warehouse')} options={warehouseOpts} value={toWarehouseId}
            onChange={e => setToWarehouseId(e.target.value)} disabled={!canEdit} />
        </div>
        <Input label={t('inventory.notes')} value={notes} onChange={e => setNotes(e.target.value)} disabled={!canEdit} />
      </div>

      {/* Line Items */}
      <div className="rounded-card border border-border-subtle bg-surface-card overflow-x-auto">
        <div className="px-5 py-3 border-b border-border-subtle flex items-center justify-between">
          <h2 className="text-sm font-semibold text-ink-primary">{t('inventory.items')}</h2>
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
              <th className="px-4 py-2 text-end font-medium w-28">{t('inventory.quantity')}</th>
              <th className="px-4 py-2 text-end font-medium w-28">{t('inventory.unit_cost')}</th>
              {canEdit && <th className="w-10" />}
            </tr>
          </thead>
          <tbody>
            {lines.map(line => (
              <tr key={line._key} className="border-b border-border-subtle last:border-0">
                <td className="px-4 py-2">
                  <Select options={productOpts} value={line.product_id ?? ''}
                    onChange={e => updateLine(line._key, { product_id: e.target.value || null })}
                    disabled={!canEdit} />
                </td>
                <td className="px-4 py-2">
                  <Input type="number" value={line.quantity} onChange={e => updateLine(line._key, { quantity: e.target.value })}
                    className="text-end" disabled={!canEdit} />
                </td>
                <td className="px-4 py-2">
                  <Input type="number" value={line.unit_cost} onChange={e => updateLine(line._key, { unit_cost: e.target.value })}
                    className="text-end" disabled={!canEdit} />
                </td>
                {canEdit && (
                  <td className="px-2 py-2">
                    <button onClick={() => setLines(p => p.filter(l => l._key !== line._key))}
                      className="text-ink-tertiary hover:text-red-500 text-lg leading-none">×</button>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Confirm Modal */}
      <Modal open={confirmOpen} onClose={() => setConfirmOpen(false)} title={t('inventory.confirm_transfer')}>
        <p className="text-sm text-ink-secondary mb-6">{t('inventory.confirm_transfer_desc')}</p>
        <div className="flex justify-end gap-3">
          <Button variant="ghost" size="sm" onClick={() => setConfirmOpen(false)}>{t('common.cancel')}</Button>
          <Button size="sm" variant="primary" onClick={() => confirmMutation.mutate()} disabled={confirmMutation.isPending}>
            {t('inventory.confirm_transfer')}
          </Button>
        </div>
      </Modal>
    </div>
  );
}
