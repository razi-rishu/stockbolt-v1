import { useState, useCallback, useEffect } from 'react';
import { ApprovalPanel } from '@/components/approvals/approval-panel';
import { useDocApproval } from '@/components/approvals/use-approval';
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
import { usePacks } from '@/hooks/use-packs';
import { PackCounter, type PackCount } from '@/components/packs/pack-count';
import { usePackGate } from '@/components/packs/use-pack-gate';
import { NO_PACK, packInput, type PackLineInput } from '@/lib/packs';
import type { ProductRow, WarehouseRow, StockTransferItemInsert } from '@/data/adapter';

interface LineRow {
  _key: string;
  product_id: string | null;
  quantity: string;
  unit_cost: string;
  notes: string;
  /** phase155 — how it was counted; the quantity itself is in base units. */
  count?: PackCount | null;
}

const newLine = (): LineRow => ({
  _key: crypto.randomUUID(), product_id: null, quantity: '1', unit_cost: '0', notes: '',
});

export default function TransferEditorPage() {
  const { t } = useTranslation();
  const { id } = useParams();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const invalidateBooks = useInvalidateBooks();   // Phase 14.14k
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

  // phase149 — approvals: Confirm becomes Submit for approval when the server
  // says this transfer needs it (it values transfers at moving-average cost).
  const appr = useDocApproval('stock_transfer', isNew ? null : id);
  const canEdit = (isNew || existing?.status === 'draft') && !appr.pending;

  const warehouseOpts = [
    { value: '', label: t('inventory.select_warehouse') },
    ...warehouses.map(w => ({ value: w.id, label: w.name })),
  ];
  const productOpts = products.map(p => ({ value: p.id, label: `${p.sku} — ${p.name}` }));

  // phase155 — counted in packs; the line keeps base units. Off: nothing runs.
  const packs = usePacks();
  const packGate = usePackGate({ loading: packs.loading });
  const packsOf = (pid: string | null) => packs.forProduct(pid, 'all');
  const unitOf = (pid: string | null) => packs.unitCode(products.find(p => p.id === pid)?.unit_id);
  const packLines: PackLineInput[] = !packs.on ? [] : lines.flatMap(l => {
    const base = packInput({ ...NO_PACK, quantity: parseFloat(l.quantity) || 0, net_price: null }, products.find(p => p.id === l.product_id), packs, null, null);
    if (!base) return [];
    const p = l.count ? packsOf(l.product_id).find(x => x.id === l.count!.pack_id) : undefined;
    return [p ? { ...base, quantity: parseFloat(l.count!.packs) || 0, factor: p.factor, pack_name: p.name, loose: parseFloat(l.count!.loose) || 0 } : base];
  });
  const askSave = () => { setError(null); packGate.ask(packLines, () => saveMutation.mutate()); };

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
    onSuccess: async () => {
      await invalidateBooks();
      qc.invalidateQueries({ queryKey: ['stock_transfers'] });
      qc.invalidateQueries({ queryKey: ['approval_doc', 'stock_transfer'] });
      navigate('/inventory/transfers');
    },
    onError: (e: Error) => setError(e.message),
  });

  const confirmMutation = useMutation({
    mutationFn: () => getAdapter().stockTransfers.confirm(id!),
    onSuccess: async () => {
      await invalidateBooks();
      qc.invalidateQueries({ queryKey: ['stock_transfers'] });
      qc.invalidateQueries({ queryKey: ['stock_transfer', id] });
      setConfirmOpen(false);
    },
    onError: (e: Error) => { setError(e.message); setConfirmOpen(false); },
  });

  return (
    // Ocean Teal (UI v1.1): look only — same fields, lines, save and confirm.
    <div className="sb-ocean sb-docx sb-docx-edit" data-testid="transfer-edit-ocean">
      <div className="sb-card sb-doc-bar">
        <div className="sb-doc-bar-id">
          <BackButton to="/inventory/transfers" label={t('inventory.transfers_title')} />
          {isNew
            ? <h1 className="sb-doc-bar-no">{t('inventory.new_transfer')}</h1>
            : <bdi dir="ltr" className="sb-doc-bar-no">{existing?.transfer_number ?? t('inventory.transfer_details')}</bdi>}
          {!isNew && existing && <StatusBadge status={existing.status} />}
        </div>
        <div className="sb-doc-bar-actions">
          {canEdit && (
            <Button size="sm" onClick={askSave} disabled={saveMutation.isPending}>
              {t('common.save')}
            </Button>
          )}
          {!isNew && existing?.status === 'draft' && !appr.needs && !appr.pending && (
            <Button size="sm" variant="primary" onClick={() => setConfirmOpen(true)}>
              <CircleCheck size={15} aria-hidden="true" /> {t('inventory.confirm_transfer')}
            </Button>
          )}
        </div>
      </div>

      {packGate.modal}
      {error && <p className="sb-alert sb-alert-danger" role="alert">{error}</p>}
      {!isNew && id && (
        <ApprovalPanel docType="stock_transfer" docId={id} isDraft={existing?.status === 'draft'}
          onChanged={() => { qc.invalidateQueries({ queryKey: ['stock_transfer', id] }); qc.invalidateQueries({ queryKey: ['stock_transfers'] }); }} />
      )}

      <div className="sb-card sb-form sb-doc-card space-y-4">
        <h2 className="sb-doc-card-title">{t('inventory.transfer_details')}</h2>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Input label={t('inventory.date')} type="date" value={date} onChange={e => setDate(e.target.value)} disabled={!canEdit} />
        </div>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Select label={t('inventory.from_warehouse')} options={warehouseOpts} value={fromWarehouseId}
            onChange={e => setFromWarehouseId(e.target.value)} disabled={!canEdit} />
          <Select label={t('inventory.to_warehouse')} options={warehouseOpts} value={toWarehouseId}
            onChange={e => setToWarehouseId(e.target.value)} disabled={!canEdit} />
        </div>
        <Input label={t('inventory.notes')} value={notes} onChange={e => setNotes(e.target.value)} disabled={!canEdit} />
      </div>

      {/* Line Items */}
      <div className="sb-card sb-doc-card sb-doc-lines">
        <div className="sb-doc-lines-head">
          <h2 className="sb-doc-card-title" style={{ margin: 0 }}>{t('inventory.items')}</h2>
          {canEdit && (
            <button type="button" onClick={() => setLines(p => [...p, newLine()])} className="sb-row-link text-brand-600">
              <Plus size={15} aria-hidden="true" /> {t('inventory.add_item')}
            </button>
          )}
        </div>
        <div className="overflow-x-auto">
        <table className="w-full text-sm" style={{ minWidth: 520 }}>
          <thead>
            <tr>
              <th className="px-4 py-2 text-start font-medium">{t('inventory.product')}</th>
              <th className={`px-4 py-2 text-end font-medium ${packs.on ? 'w-44' : 'w-28'}`}>{t('inventory.quantity')}</th>
              <th className="px-4 py-2 text-end font-medium w-28">{t('inventory.unit_cost')}</th>
              {canEdit && <th className="w-10" />}
            </tr>
          </thead>
          <tbody>
            {lines.map(line => (
              <tr key={line._key} className="border-b border-border-subtle last:border-0">
                <td className="px-4 py-2">
                  <SearchableSelect
                    options={productOpts}
                    value={line.product_id ?? ''}
                    onChange={(v) => updateLine(line._key, { product_id: v || null, count: null })}
                    disabled={!canEdit}
                    placeholder={t('inventory.select_product')}
                    panelWidth={360}
                  />
                </td>
                <td className="px-4 py-2">
                  <Input type="number" value={line.quantity} onChange={e => updateLine(line._key, { quantity: e.target.value, count: null })}
                    className="text-end" disabled={!canEdit} />
                  {packs.on && <PackCounter packs={packsOf(line.product_id)} value={line.count ?? null} quantity={parseFloat(line.quantity) || 0}
                    baseUnit={unitOf(line.product_id)} disabled={!canEdit}
                    onChange={(count, q) => updateLine(line._key, q === null ? { count } : { count, quantity: String(q) })} />}
                </td>
                <td className="px-4 py-2">
                  <Input type="number" value={line.unit_cost} onChange={e => updateLine(line._key, { unit_cost: e.target.value })}
                    className="text-end" disabled={!canEdit} />
                </td>
                {canEdit && (
                  <td className="px-2 py-2">
                    <button type="button" onClick={() => setLines(p => p.filter(l => l._key !== line._key))}
                      className="sb-doc-line-del" aria-label={t('invOcean.remove_line')} title={t('invOcean.remove_line')}><X size={15} aria-hidden="true" /></button>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
        </div>
      </div>

      {/* Confirm Modal */}
      <Modal open={confirmOpen} onClose={() => setConfirmOpen(false)} title={t('inventory.confirm_transfer')}>
        <div className="sb-ocean sb-form sb-modal-form">
        <p className="text-sm text-ink-secondary">{t('inventory.confirm_transfer_desc')}</p>
        <div className="flex justify-end gap-3">
          <Button variant="ghost" size="sm" onClick={() => setConfirmOpen(false)}>{t('common.cancel')}</Button>
          <Button size="sm" variant="primary" onClick={() => confirmMutation.mutate()} disabled={confirmMutation.isPending}>
            {t('inventory.confirm_transfer')}
          </Button>
        </div>
        </div>
      </Modal>
    </div>
  );
}
