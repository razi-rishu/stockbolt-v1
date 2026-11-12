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
import { BackButton } from '@/ui/back-button';
import { Modal } from '@/ui/modal';
import { SearchableSelect } from '@/ui/searchable-select';
import { StatusBadge } from '@/ui/status-badge';
import { Plus, X, CircleCheck } from 'lucide-react';
import '@/styles/stockbolt-ocean-teal.css';
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
    // Ocean Teal (UI v1.1): look only — same fields, lines, save and confirm.
    <div className="sb-ocean sb-docx sb-docx-edit" data-testid="adjustment-edit-ocean">
      <div className="sb-card sb-doc-bar">
        <div className="sb-doc-bar-id">
          <BackButton to="/inventory/adjustments" label={t('inventory.adjustments_title')} />
          {isNew
            ? <h1 className="sb-doc-bar-no">{t('inventory.new_adjustment')}</h1>
            : <bdi dir="ltr" className="sb-doc-bar-no">{existing?.adjustment_number ?? t('inventory.adjustment_details')}</bdi>}
          {!isNew && existing && <StatusBadge status={existing.status} />}
        </div>
        <div className="sb-doc-bar-actions">
          {canEdit && (
            <Button size="sm" onClick={() => { setError(null); saveMutation.mutate(); }} disabled={saveMutation.isPending}>
              {t('common.save')}
            </Button>
          )}
          {!isNew && existing?.status === 'draft' && (
            <Button size="sm" variant="primary" onClick={() => setConfirmOpen(true)}>
              <CircleCheck size={15} aria-hidden="true" /> {t('inventory.confirm_adjustment')}
            </Button>
          )}
        </div>
      </div>

      {error && <p className="sb-alert sb-alert-danger" role="alert">{error}</p>}

      {/* Summary cards */}
      <div className="sb-adj-kpis">
        <div className="sb-exp-kpi">
          <div className="sb-exp-kpi-txt">
            <span className="sb-exp-kpi-label">{t('inventory.total_gain')}</span>
            <bdi dir="ltr" className="sb-exp-kpi-val" style={{ color: '#067647' }}>{fmt(totals.gain)}</bdi>
          </div>
        </div>
        <div className="sb-exp-kpi">
          <div className="sb-exp-kpi-txt">
            <span className="sb-exp-kpi-label">{t('inventory.total_loss')}</span>
            <bdi dir="ltr" className="sb-exp-kpi-val" style={{ color: 'var(--sb-danger)' }}>{fmt(totals.loss)}</bdi>
          </div>
        </div>
        <div className="sb-exp-kpi">
          <div className="sb-exp-kpi-txt">
            <span className="sb-exp-kpi-label">{t('inventory.net_change')}</span>
            <bdi dir="ltr" className="sb-exp-kpi-val" style={{ color: totals.net >= 0 ? '#067647' : 'var(--sb-danger)' }}>
              {totals.net > 0 ? '+' : ''}{totals.net}
            </bdi>
          </div>
        </div>
      </div>

      {/* Header */}
      <div className="sb-card sb-form sb-doc-card space-y-4">
        <h2 className="sb-doc-card-title">{t('inventory.adjustment_details')}</h2>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <Input label={t('inventory.date')} type="date" value={date} onChange={e => setDate(e.target.value)} disabled={!canEdit} />
          <Select label={t('inventory.warehouse')} options={warehouseOpts} value={warehouseId}
            onChange={e => setWarehouseId(e.target.value)} disabled={!canEdit} />
          <Select label={t('inventory.reason')} options={reasonOpts} value={reason}
            onChange={e => setReason(e.target.value)} disabled={!canEdit} />
        </div>
        <Input label={t('inventory.notes')} value={notes} onChange={e => setNotes(e.target.value)} disabled={!canEdit} />
      </div>

      {/* Line Items */}
      <div className="sb-card sb-doc-card sb-doc-lines">
        <div className="sb-doc-lines-head">
          <h2 className="sb-doc-card-title" style={{ margin: 0 }}>{t('inventory.count_lines')}</h2>
          {canEdit && (
            <button type="button" onClick={() => setLines(p => [...p, newLine()])} className="sb-row-link text-brand-600">
              <Plus size={15} aria-hidden="true" /> {t('inventory.add_item')}
            </button>
          )}
        </div>
        <div className="overflow-x-auto">
        <table className="w-full text-sm" style={{ minWidth: 760 }}>
          <thead>
            <tr>
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
                      <button type="button" onClick={() => setLines(p => p.filter(l => l._key !== line._key))}
                        className="sb-doc-line-del" aria-label={t('invOcean.remove_line')} title={t('invOcean.remove_line')}><X size={15} aria-hidden="true" /></button>
                    </td>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
        </div>
      </div>

      {/* Confirm Modal */}
      <Modal open={confirmOpen} onClose={() => setConfirmOpen(false)} title={t('inventory.confirm_adjustment')}>
        <div className="sb-ocean sb-form sb-modal-form">
        <p className="text-sm text-ink-secondary">{t('inventory.confirm_adjustment_desc')}</p>
        <div className="grid grid-cols-2 gap-3 text-sm">
          <div className="sb-alert sb-alert-good" style={{ margin: 0, display: 'block' }}>
            <p className="text-xs" style={{ margin: 0 }}>{t('inventory.total_gain')}</p>
            <bdi dir="ltr" className="font-semibold">{fmt(totals.gain)}</bdi>
          </div>
          <div className="sb-alert sb-alert-danger" style={{ margin: 0, display: 'block' }}>
            <p className="text-xs" style={{ margin: 0 }}>{t('inventory.total_loss')}</p>
            <bdi dir="ltr" className="font-semibold">{fmt(totals.loss)}</bdi>
          </div>
        </div>
        <div className="flex justify-end gap-3">
          <Button variant="ghost" size="sm" onClick={() => setConfirmOpen(false)}>{t('common.cancel')}</Button>
          <Button size="sm" variant="primary" onClick={() => confirmMutation.mutate()} disabled={confirmMutation.isPending}>
            {t('inventory.confirm_adjustment')}
          </Button>
        </div>
        </div>
      </Modal>
    </div>
  );
}
