/**
 * Repack (phase157, Document 3 C5) — 48 KG of loose sugar become 240 packets.
 * The goods used leave at their exact cost and the goods made come in at that
 * total; only wastage reaches the accounts. Everyone accepts the quantities
 * before they are posted.
 */
import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQueries, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { useNavigate, useParams } from 'react-router-dom';
import { ArrowDown, CircleCheck, Plus, X } from 'lucide-react';
import { getAdapter } from '@/data/index';
import type { StockRepackItemInput } from '@/data/adapter';
import { useAuthStore } from '@/store/auth';
import { useHasPermission } from '@/hooks/use-permissions';
import { useInventorySettings } from '@/hooks/use-inventory-settings';
import { useInvalidateBooks } from '@/hooks/use-invalidate-books';
import { useUnsavedChangesGuard } from '@/hooks/use-unsaved-changes-guard';
import { usePacks } from '@/hooks/use-packs';
import { PackCounter, type PackCount } from '@/components/packs/pack-count';
import { DocumentActivity } from '@/components/document-activity';
import { fmtQty, unitAllowsDecimals } from '@/lib/packs';
import { checkRepack, type RepackLine, type RepackProblem } from '@/lib/repack';
import { repackError } from '@/lib/pack-errors';
import { BackButton } from '@/ui/back-button';
import { Button } from '@/ui/button';
import { Input } from '@/ui/input';
import { Modal } from '@/ui/modal';
import { SearchableSelect } from '@/ui/searchable-select';
import { Select } from '@/ui/select';
import { StatusBadge } from '@/ui/status-badge';
import '@/styles/stockbolt-ocean-teal.css';

interface Line { _key: string; kind: 'input' | 'waste'; product_id: string | null; quantity: string; count?: PackCount | null }
const newLine = (kind: 'input' | 'waste'): Line => ({ _key: crypto.randomUUID(), kind, product_id: null, quantity: '' });
const money = (n: number) => n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const REFRESH = ['stock_repacks', 'stock_repack', 'stock_repack_items', 'stock_repack_moves', 'stock_balance', 'document_activity'];

export default function RepackEditorPage() {
  const { t } = useTranslation();
  const { id } = useParams();
  const isNew = !id || id === 'new';
  const navigate = useNavigate();
  const qc = useQueryClient();
  const invalidateBooks = useInvalidateBooks();
  const { company_id } = useAuthStore();
  const canWrite = useHasPermission('inventory.write');
  const { repack_enabled } = useInventorySettings();

  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [warehouseId, setWarehouseId] = useState('');
  const [notes, setNotes] = useState('');
  const [made, setMade] = useState<{ product_id: string | null; quantity: string; count?: PackCount | null }>({ product_id: null, quantity: '' });
  const [lines, setLines] = useState<Line[]>([newLine('input')]);
  const [dirty, setDirty] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [asking, setAsking] = useState(false);
  const [accepted, setAccepted] = useState(false);
  const [voiding, setVoiding] = useState(false);
  const [reason, setReason] = useState('');
  const confirmLeave = useUnsavedChangesGuard(dirty);

  const { data: existing } = useQuery({ queryKey: ['stock_repack', id], queryFn: () => getAdapter().stockRepacks.getById(id!), enabled: !isNew });
  const { data: existingItems } = useQuery({ queryKey: ['stock_repack_items', id], queryFn: () => getAdapter().stockRepacks.getItems(id!), enabled: !isNew });
  const posted = !!existing && existing.status !== 'draft';
  const { data: moves = [] } = useQuery({ queryKey: ['stock_repack_moves', id], queryFn: () => getAdapter().stockRepacks.getMovements(id!), enabled: posted });
  const { data: warehouses = [] } = useQuery({ queryKey: ['warehouses', company_id], queryFn: () => getAdapter().warehouses.list(company_id!), enabled: !!company_id });
  const { data: products = [] } = useQuery({ queryKey: ['products', company_id], queryFn: () => getAdapter().products.list(company_id!), enabled: !!company_id });
  const { data: units = [] } = useQuery({ queryKey: ['units', company_id], queryFn: () => getAdapter().units.list(company_id!), enabled: !!company_id });
  const packs = usePacks();

  useEffect(() => {
    if (!existing) return;
    setDate(existing.date); setWarehouseId(existing.warehouse_id); setNotes(existing.notes ?? '');
    setMade({ product_id: existing.output_product_id, quantity: String(Number(existing.output_quantity)) });
  }, [existing]);
  useEffect(() => {
    if (existingItems?.length) setLines(existingItems.map((i) => ({ _key: i.id, kind: i.kind, product_id: i.product_id, quantity: String(Number(i.quantity)) })));
  }, [existingItems]);
  useEffect(() => {
    if (isNew && !warehouseId && warehouses.length) setWarehouseId((warehouses.find((w) => w.is_default) ?? warehouses[0]).id);
  }, [isNew, warehouseId, warehouses]);

  const canEdit = canWrite && !posted && (isNew ? repack_enabled : !!existing);
  const product = useMemo(() => new Map(products.map((p) => [p.id, p])), [products]);
  const unitRow = (pid: string | null | undefined) => units.find((u) => u.id === product.get(pid ?? '')?.unit_id) as { code: string; allows_decimals?: boolean | null } | undefined;
  const unitOf = (pid: string | null | undefined) => unitRow(pid)?.code ?? t('packs.piece');
  const nameOf = (pid: string | null | undefined) => { const p = product.get(pid ?? ''); return p ? `${p.sku} ${p.name}` : '—'; };
  // Only stocked goods without serial numbers can be repacked.
  const productOpts = products
    .filter((p) => (p as { type?: string }).type !== 'service' && !p.requires_serial && p.is_active)
    .map((p) => ({ value: p.id, label: `${p.sku} — ${p.name}` }));

  // What is in this warehouse of everything used.
  const usedIds = [...new Set(lines.map((l) => l.product_id).filter(Boolean) as string[])];
  const balances = useQueries({
    queries: usedIds.map((pid) => ({
      queryKey: ['stock_balance', company_id, pid, warehouseId],
      queryFn: () => getAdapter().stockLedger.getBalance(company_id!, pid, warehouseId),
      enabled: !!company_id && !!warehouseId && !posted,
    })),
  });
  const stockOf = (pid: string) => {
    const b = balances[usedIds.indexOf(pid)]?.data;
    return b ? { qty: Number(b.quantity), mac: Number(b.unit_cost) } : undefined;
  };
  const filled: RepackLine[] = lines.filter((l) => l.product_id && Number(l.quantity) > 0)
    .map((l) => ({ kind: l.kind, product_id: l.product_id!, quantity: Number(l.quantity) }));
  const check = checkRepack({ product_id: made.product_id, quantity: Number(made.quantity) || 0 }, filled, stockOf, (pid) => unitAllowsDecimals(unitRow(pid)));

  const setLine = (key: string, patch: Partial<Line>) => { setLines((p) => p.map((l) => (l._key === key ? { ...l, ...patch } : l))); setDirty(true); };

  const persist = async (): Promise<string> => {
    if (!warehouseId) throw new Error(t('inventory.error_warehouse_required'));
    if (!made.product_id || !(Number(made.quantity) > 0)) throw new Error(t('repack.p_no_output'));
    const row = {
      company_id: company_id!, date, warehouse_id: warehouseId, notes: notes || null,
      output_product_id: made.product_id, output_quantity: Number(made.quantity),
      repack_number: isNew ? await getAdapter().stockRepacks.getNextNumber(company_id!) : existing!.repack_number,
    };
    const items: StockRepackItemInput[] = filled.map((l, i) => ({ ...l, sort_order: i }));
    if (isNew) return (await getAdapter().stockRepacks.create(row, items)).id;
    await getAdapter().stockRepacks.update(id!, row, items);
    return id!;
  };
  const refresh = async () => {
    await invalidateBooks();
    for (const k of REFRESH) void qc.invalidateQueries({ queryKey: [k] });
  };
  const fail = (e: unknown) => { setAsking(false); setVoiding(false); setError(repackError(t, e)); };
  const save = useMutation({
    mutationFn: persist,
    onSuccess: async () => { setDirty(false); await refresh(); navigate('/inventory/repack'); },
    onError: fail,
  });
  const confirm = useMutation({
    // What is on screen is what is posted: saved first, then confirmed.
    mutationFn: async () => {
      const saved = await persist();
      try {
        await getAdapter().stockRepacks.confirm(saved);
      } catch (e) {
        if (isNew) { setDirty(false); navigate(`/inventory/repack/${saved}`); }
        throw e;
      }
      return saved;
    },
    onSuccess: async (saved) => { setDirty(false); setAsking(false); await refresh(); navigate(`/inventory/repack/${saved}`); },
    onError: fail,
  });
  const voidIt = useMutation({
    mutationFn: () => getAdapter().stockRepacks.void(id!, reason || undefined),
    onSuccess: async () => { setVoiding(false); await refresh(); },
    onError: fail,
  });
  const remove = useMutation({
    mutationFn: () => getAdapter().stockRepacks.deleteDraft(id!),
    onSuccess: async () => { setDirty(false); await refresh(); navigate('/inventory/repack'); },
    onError: fail,
  });
  const busy = save.isPending || confirm.isPending || voidIt.isPending || remove.isPending;

  const problemText = (p: RepackProblem): string => {
    const name = nameOf(p.product_id);
    const unit = unitOf(p.product_id);
    switch (p.kind) {
      case 'no_output': return t('repack.p_no_output');
      case 'no_input': return t('repack.p_no_input');
      case 'same_product': return t('repack.p_same', { product: name });
      case 'whole_units': return t('repack.p_whole', { product: name, unit });
      case 'not_enough': return t('repack.p_not_enough', { product: name, have: fmtQty(p.have ?? 0), need: fmtQty(p.need ?? 0), unit });
      case 'no_cost': return t('repack.p_no_cost', { product: name });
    }
  };

  // The real values once posted; the rows a void adds are not shown.
  const actual = moves.filter((m) => !m.reversal_of_id);
  const movedValue = (type: string, pid?: string) => actual.filter((m) => m.type === type && (!pid || m.product_id === pid)).reduce((s, m) => s + Number(m.total_cost), 0);
  const madeValue = posted ? movedValue('repack_in') : check.value;
  const wasteValue = posted ? movedValue('adjustment_out') : check.waste;
  const unitCost = Number(made.quantity) > 0 ? Math.round((madeValue / Number(made.quantity)) * 100) / 100 : 0;

  const lineRow = (l: Line) => {
    const s = l.product_id ? stockOf(l.product_id) : undefined;
    const q = Number(l.quantity) || 0;
    const value = posted
      // Two lines of one product share one figure: shown once, on the first.
      ? (lines.find((x) => x.kind === l.kind && x.product_id === l.product_id)?._key === l._key ? money(movedValue(l.kind === 'waste' ? 'adjustment_out' : 'repack_out', l.product_id ?? '')) : '')
      : s ? money(q * s.mac) : '—';
    return (
      <tr key={l._key} className="border-b border-border-subtle last:border-0">
        <td className="px-4 py-2 align-top">
          {canEdit
            ? <SearchableSelect options={productOpts} value={l.product_id ?? ''} onChange={(v) => setLine(l._key, { product_id: v || null, count: null })}
                placeholder={t('inventory.select_product')} panelWidth={360} />
            : nameOf(l.product_id)}
        </td>
        <td className="px-4 py-2 align-top text-end">
          {canEdit
            ? <Input type="number" min="0" step="any" value={l.quantity} aria-label={t('inventory.quantity')} className="text-end"
                onChange={(e) => setLine(l._key, { quantity: e.target.value, count: null })} />
            : <bdi dir="ltr">{fmtQty(q)} {unitOf(l.product_id)}</bdi>}
          {canEdit && packs.on && (
            <PackCounter packs={packs.forProduct(l.product_id, 'all')} value={l.count ?? null} quantity={q} baseUnit={unitOf(l.product_id)}
              onChange={(count, n) => setLine(l._key, n === null ? { count } : { count, quantity: String(n) })} />
          )}
        </td>
        {!posted && (
          <td className="px-4 py-2 align-top text-end" style={{ color: s && q > s.qty ? 'var(--sb-danger)' : undefined }}>
            <bdi dir="ltr">{s ? `${fmtQty(s.qty)} ${unitOf(l.product_id)}` : '—'}</bdi>
          </td>
        )}
        <td className="px-4 py-2 align-top text-end font-mono"><bdi dir="ltr">{value}</bdi></td>
        {canEdit && (
          <td className="px-2 py-2 align-top">
            <button type="button" className="sb-doc-line-del" aria-label={t('invOcean.remove_line')} title={t('invOcean.remove_line')}
              onClick={() => { setLines((p) => p.filter((x) => x._key !== l._key)); setDirty(true); }}><X size={15} aria-hidden="true" /></button>
          </td>
        )}
      </tr>
    );
  };

  const lineTable = (kind: 'input' | 'waste') => {
    const own = lines.filter((l) => l.kind === kind);
    return (
      <div className="sb-card sb-doc-card sb-doc-lines" data-testid={`repack-${kind}`}>
        <div className="sb-doc-lines-head">
          <div>
            <h2 className="sb-doc-card-title" style={{ margin: 0 }}>{kind === 'input' ? t('repack.used') : t('repack.waste')}</h2>
            {kind === 'waste' && <p className="sb-form-hint">{t('repack.waste_hint')}</p>}
          </div>
          {canEdit && (
            <button type="button" className="sb-row-link text-brand-600" data-testid={`repack-add-${kind}`}
              onClick={() => { setLines((p) => [...p, newLine(kind)]); setDirty(true); }}>
              <Plus size={15} aria-hidden="true" /> {t('inventory.add_item')}
            </button>
          )}
        </div>
        {own.length === 0 ? <p className="sb-empty">{kind === 'waste' ? t('repack.no_waste') : t('repack.p_no_input')}</p> : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm" style={{ minWidth: 560 }}>
              <thead>
                <tr>
                  <th className="px-4 py-2 text-start font-medium">{t('inventory.product')}</th>
                  <th className="px-4 py-2 text-end font-medium w-44">{t('inventory.quantity')}</th>
                  {!posted && <th className="px-4 py-2 text-end font-medium w-36">{t('repack.available')}</th>}
                  <th className="px-4 py-2 text-end font-medium w-32">{t('inventory.value')}</th>
                  {canEdit && <th className="w-10" />}
                </tr>
              </thead>
              <tbody>{own.map(lineRow)}</tbody>
            </table>
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="sb-ocean sb-docx sb-docx-edit" data-testid="repack-editor">
      <div className="sb-card sb-doc-bar">
        <div className="sb-doc-bar-id">
          <BackButton to="/inventory/repack" label={t('repack.title')} confirm={confirmLeave} />
          {isNew ? <h1 className="sb-doc-bar-no">{t('repack.new')}</h1> : <bdi dir="ltr" className="sb-doc-bar-no">{existing?.repack_number ?? '…'}</bdi>}
          {existing && <StatusBadge status={existing.status} />}
        </div>
        <div className="sb-doc-bar-actions">
          {canEdit && (
            <>
              {!isNew && <Button size="sm" variant="danger" disabled={busy} onClick={() => { if (window.confirm(t('repack.delete_confirm'))) remove.mutate(); }}>{t('common.delete')}</Button>}
              <Button size="sm" variant="secondary" disabled={busy} onClick={() => { setError(null); save.mutate(); }}>{t('repack.save_draft')}</Button>
              <Button size="sm" variant="primary" disabled={busy} data-testid="repack-confirm" onClick={() => { setError(null); setAccepted(false); setAsking(true); }}>
                <CircleCheck size={15} aria-hidden="true" /> {t('repack.confirm')}
              </Button>
            </>
          )}
          {existing?.status === 'confirmed' && canWrite && <Button size="sm" variant="danger" disabled={busy} onClick={() => { setError(null); setVoiding(true); }}>{t('common.void')}</Button>}
        </div>
      </div>

      {error && <p className="sb-alert sb-alert-danger" role="alert">{error}</p>}
      {isNew && !repack_enabled && <p className="sb-info-note">{t('repack.off')}</p>}
      {existing?.status === 'void' && existing.void_reason && <p className="sb-info-note">{t('common.void_reason')}: {existing.void_reason}</p>}

      <div className="sb-card sb-form sb-doc-card space-y-4">
        <h2 className="sb-doc-card-title">{t('repack.details')}</h2>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Input label={t('inventory.date')} type="date" value={date} disabled={!canEdit} onChange={(e) => { setDate(e.target.value); setDirty(true); }} />
          <Select label={t('inventory.warehouse')} options={[{ value: '', label: t('inventory.select_warehouse') }, ...warehouses.map((w) => ({ value: w.id, label: w.name }))]}
            value={warehouseId} disabled={!canEdit} onChange={(e) => { setWarehouseId(e.target.value); setDirty(true); }} />
        </div>
        <Input label={t('inventory.notes')} value={notes} disabled={!canEdit} onChange={(e) => { setNotes(e.target.value); setDirty(true); }} />
      </div>

      {lineTable('input')}
      <p className="sb-repack-arrow" aria-hidden="true"><ArrowDown size={20} /></p>

      <div className="sb-card sb-form sb-doc-card" data-testid="repack-made">
        <h2 className="sb-doc-card-title">{t('repack.made')}</h2>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <div className="sm:col-span-2">
            <span className="sb-select-label">{t('inventory.product')}</span>
            {canEdit
              ? <SearchableSelect options={productOpts} value={made.product_id ?? ''} placeholder={t('inventory.select_product')} panelWidth={360}
                  onChange={(v) => { setMade((m) => ({ ...m, product_id: v || null, count: null })); setDirty(true); }} />
              : <p style={{ margin: '6px 0 0', fontWeight: 600 }}>{nameOf(made.product_id)}</p>}
          </div>
          <div>
            {canEdit
              ? <Input label={`${t('inventory.quantity')} (${unitOf(made.product_id)})`} type="number" min="0" step="any" value={made.quantity} data-testid="repack-made-qty"
                  onChange={(e) => { setMade((m) => ({ ...m, quantity: e.target.value, count: null })); setDirty(true); }} />
              : <><span className="sb-select-label">{t('inventory.quantity')}</span><p style={{ margin: '6px 0 0', fontWeight: 600 }}><bdi dir="ltr">{fmtQty(Number(made.quantity))} {unitOf(made.product_id)}</bdi></p></>}
            {canEdit && packs.on && (
              <PackCounter packs={packs.forProduct(made.product_id, 'all')} value={made.count ?? null} quantity={Number(made.quantity) || 0} baseUnit={unitOf(made.product_id)}
                onChange={(count, n) => { setMade((m) => (n === null ? { ...m, count } : { ...m, count, quantity: String(n) })); setDirty(true); }} />
            )}
          </div>
        </div>
        <div className="sb-adj-kpis" style={{ marginTop: 14 }} data-testid="repack-figures">
          {([[posted ? t('repack.value') : t('repack.value_about'), madeValue], [t('repack.unit_cost'), unitCost], [t('repack.waste_value'), wasteValue]] as const).map(([label, n]) => (
            <div key={label} className="sb-exp-kpi"><div className="sb-exp-kpi-txt"><span className="sb-exp-kpi-label">{label}</span><bdi dir="ltr" className="sb-exp-kpi-val">{money(n)}</bdi></div></div>
          ))}
        </div>
      </div>

      {(canEdit || lines.some((l) => l.kind === 'waste')) && lineTable('waste')}
      {!isNew && existing && <DocumentActivity kind="stock_repack" id={existing.id} />}

      <Modal open={asking} onClose={() => setAsking(false)} title={check.problems.length ? t('packs.fix_title') : t('repack.ask_title')}>
        <div className="sb-ocean sb-form sb-modal-form" data-testid="repack-ask">
          {check.problems.length > 0 ? check.problems.map((p, i) => <p key={i} className="sb-alert sb-alert-danger" role="alert">{problemText(p)}</p>) : (
            <>
              <p className="sb-form-hint">{t('repack.ask_body')}</p>
              <ul className="sb-pack-list">
                {filled.map((l, i) => (
                  <li key={i} className="sb-pack-line">
                    <span className="sb-pack-line-name">{nameOf(l.product_id)}{l.kind === 'waste' && <span className="sb-pill sb-pill-warn ms-2" style={{ marginTop: 0 }}>{t('repack.waste')}</span>}</span>
                    <bdi dir="ltr" className="sb-pack-line-qty" style={{ color: 'var(--sb-danger)' }}>− {fmtQty(l.quantity)} {unitOf(l.product_id)}</bdi>
                  </li>
                ))}
                <li className="sb-pack-line">
                  <span className="sb-pack-line-name">{nameOf(made.product_id)}</span>
                  <bdi dir="ltr" className="sb-pack-line-qty">+ {fmtQty(Number(made.quantity))} {unitOf(made.product_id)}</bdi>
                </li>
              </ul>
              <p className="sb-info-note">
                {t('repack.ask_cost', { value: money(check.value), unit: money(check.unit_cost) })}
                {check.waste > 0 && ` ${t('repack.ask_waste', { waste: money(check.waste) })}`}
              </p>
              <label className="sb-check-row">
                <input type="checkbox" checked={accepted} onChange={(e) => setAccepted(e.target.checked)} data-testid="repack-accept" />
                <span className="sb-check-text">{t('packs.accept')}</span>
              </label>
            </>
          )}
          <div className="flex flex-wrap justify-end gap-2">
            <button type="button" className="sb-secondary-btn sb-btn-inline" onClick={() => setAsking(false)}>{check.problems.length ? t('packs.go_back') : t('common.cancel')}</button>
            {check.problems.length === 0 && (
              <button type="button" className="sb-primary-btn sb-btn-inline" disabled={!accepted || confirm.isPending} data-testid="repack-go" onClick={() => confirm.mutate()}>{t('repack.confirm')}</button>
            )}
          </div>
        </div>
      </Modal>

      <Modal open={voiding} onClose={() => setVoiding(false)} title={t('repack.void_title')}>
        <div className="sb-ocean sb-form sb-modal-form">
          <p className="sb-form-hint">{t('repack.void_body')}</p>
          <Input label={t('common.void_reason')} value={reason} onChange={(e) => setReason(e.target.value)} />
          <div className="flex justify-end gap-2">
            <Button variant="ghost" size="sm" onClick={() => setVoiding(false)}>{t('common.cancel')}</Button>
            <Button variant="danger" size="sm" disabled={voidIt.isPending} data-testid="repack-void-go" onClick={() => voidIt.mutate()}>{t('common.void')}</Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
