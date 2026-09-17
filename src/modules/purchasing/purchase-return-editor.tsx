import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { getAdapter } from '@/data/index';
import { useAuthStore } from '@/store/auth';
import { useInvalidateBooks } from '@/hooks/use-invalidate-books';
import { Button } from '@/ui/button';
import { BackButton } from '@/ui/back-button';
import { SearchableSelect } from '@/ui/searchable-select';
import { StatusBadge } from '@/ui/status-badge';
import type {
  PurchaseReturnRow, PurchaseReturnItemRow, PurchaseReturnItemInsert,
  VendorBillRow, VendorBillItemRow, ReturnableBillLine,
} from '@/data/adapter';

/**
 * R3b — Purchase Return editor. Mirror of the sales return editor.
 *
 * Carries the R2 discipline from birth: every line names the vendor-bill LINE
 * it returns, quantities default to what is still returnable rather than the
 * full billed amount, and there is no hand-typed line — a line with no source
 * cannot be priced or counted, and confirm_purchase_return refuses it.
 *
 * Confirming posts nothing here: it builds a debit note and hands it to
 * confirm_debit_note, which is the only thing that touches the ledger.
 */

const today = () => new Date().toISOString().slice(0, 10);

interface ReturnLine {
  vendor_bill_item_id: string;
  product_id:          string | null;
  description:         string;
  qty_returned:        number;
  qty_returnable:      number;
  condition:           'resellable' | 'damaged';
  unit_cost:           number | null;
}

export default function PurchaseReturnEditorPage() {
  const { id }   = useParams<{ id: string }>();
  const isNew    = !id || id === 'new';
  const { t }    = useTranslation();
  const navigate = useNavigate();
  const qc       = useQueryClient();
  const invalidateBooks = useInvalidateBooks();
  const { company_id } = useAuthStore();

  const [billId,  setBillId]  = useState('');
  const [date,    setDate]    = useState(today());
  const [reason,  setReason]  = useState('wrong_part');
  const [notes,   setNotes]   = useState('');
  const [lines,   setLines]   = useState<ReturnLine[]>([]);
  const [error,   setError]   = useState<string | null>(null);

  const { data: bills = [] } = useQuery<VendorBillRow[]>({
    queryKey: ['vendor_bills_confirmed', company_id],
    queryFn:  () => getAdapter().vendorBills.list(company_id!, 'confirmed'),
    enabled:  !!company_id,
  });

  const { data: existing } = useQuery<PurchaseReturnRow | null>({
    queryKey: ['purchase_return', id],
    queryFn:  () => getAdapter().purchaseReturns.getById(id!),
    enabled:  !isNew && !!id,
  });

  const { data: existingItems = [] } = useQuery<PurchaseReturnItemRow[]>({
    queryKey: ['purchase_return_items', id],
    queryFn:  () => getAdapter().purchaseReturns.getItems(id!),
    enabled:  !isNew && !!id,
  });

  const { data: billItems = [] } = useQuery<VendorBillItemRow[]>({
    queryKey: ['bill_items_for_pr', billId],
    queryFn:  () => getAdapter().vendorBills.getItems(billId),
    enabled:  !!billId,
  });

  // Same view confirm_purchase_return checks, so the screen and the server can
  // never disagree about what is left to send back.
  const { data: returnable = [] } = useQuery<ReturnableBillLine[]>({
    queryKey: ['returnable_bill_lines', billId],
    queryFn:  () => getAdapter().debitNotes.getReturnableBillLines(billId),
    enabled:  !!billId,
  });
  const returnableById = new Map(returnable.map(r => [r.vendor_bill_item_id, r]));

  useEffect(() => {
    if (existing) {
      setBillId(existing.bill_id);
      setDate(existing.date);
      setReason(existing.reason ?? 'wrong_part');
      setNotes(existing.notes ?? '');
    }
  }, [existing]);

  useEffect(() => {
    if (existingItems.length > 0) {
      setLines(existingItems.map(it => ({
        vendor_bill_item_id: it.vendor_bill_item_id ?? '',
        product_id:          it.product_id,
        description:         '',
        qty_returned:        Number(it.qty_returned),
        // A saved line already consumed its own quantity; add it back so the
        // document shows what it may still claim.
        qty_returnable:      Number(it.qty_returned),
        condition:           (it.condition ?? 'resellable') as 'resellable' | 'damaged',
        unit_cost:           it.unit_cost !== null ? Number(it.unit_cost) : null,
      })));
    }
  }, [existingItems]);

  const isDraft = isNew || existing?.status === 'draft';

  function importFromBill() {
    if (billItems.length === 0) return;
    setLines(billItems
      .filter(it => it.product_id)
      .map(it => ({
        vendor_bill_item_id: it.id,
        product_id:          it.product_id,
        description:         it.description ?? '',
        qty_returned:        Number(returnableById.get(it.id)?.qty_returnable ?? it.quantity),
        qty_returnable:      Number(returnableById.get(it.id)?.qty_returnable ?? it.quantity),
        condition:           'resellable' as const,
        unit_cost:           Number(it.unit_cost),
      }))
      .filter(l => l.qty_returnable > 0));
  }

  function updateLine<K extends keyof ReturnLine>(i: number, key: K, val: ReturnLine[K]) {
    setLines(prev => prev.map((l, idx) => idx === i ? { ...l, [key]: val } : l));
  }
  function removeLine(i: number) {
    setLines(prev => prev.filter((_, idx) => idx !== i));
  }

  const saveMutation = useMutation({
    mutationFn: async () => {
      const number = await getAdapter().purchaseReturns.getNextNumber(company_id!);
      const items: PurchaseReturnItemInsert[] = lines.map(l => ({
        vendor_bill_item_id:  l.vendor_bill_item_id,
        product_id:           l.product_id,
        qty_returned:         l.qty_returned,
        condition:            l.condition,
        restock_warehouse_id: null,
        unit_cost:            l.unit_cost,
      }));
      return getAdapter().purchaseReturns.create({
        company_id:    company_id!,
        return_number: number,
        bill_id:       billId,
        date,
        warehouse_id:  null,
        reason,
        status:        'draft',
        notes:         notes || null,
      }, items);
    },
    onSuccess: (pr) => {
      qc.invalidateQueries({ queryKey: ['purchase_returns'] });
      navigate(`/purchasing/returns/${pr.id}`);
    },
    onError: (e) => setError(e instanceof Error ? e.message : String(e)),
  });

  const confirmMutation = useMutation({
    mutationFn: () => getAdapter().purchaseReturns.confirm(id!),
    onSuccess: async () => {
      await invalidateBooks();
      qc.invalidateQueries({ queryKey: ['purchase_return', id] });
      qc.invalidateQueries({ queryKey: ['purchase_returns'] });
    },
    onError: (e) => setError(e instanceof Error ? e.message : String(e)),
  });

  const voidMutation = useMutation({
    mutationFn: (r: string) => getAdapter().purchaseReturns.void(id!, r),
    onSuccess: async () => {
      await invalidateBooks();
      qc.invalidateQueries({ queryKey: ['purchase_return', id] });
      qc.invalidateQueries({ queryKey: ['purchase_returns'] });
    },
    onError: (e) => setError(e instanceof Error ? e.message : String(e)),
  });

  const canSave = isNew && !!billId && lines.length > 0 && !saveMutation.isPending;
  const overReturned = lines.some(l => l.qty_returned > l.qty_returnable);

  return (
    <div className="space-y-4">
      <BackButton to="/purchasing/returns" />

      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-xl font-semibold text-ink-primary">
          {isNew ? t('returns.new_purchase_return') : existing?.return_number ?? ''}
        </h1>
        <div className="flex items-center gap-2">
          {existing && <StatusBadge status={existing.status} />}
          {isNew && (
            <Button onClick={() => saveMutation.mutate()} disabled={!canSave || overReturned}
              loading={saveMutation.isPending}>
              {t('common.save')}
            </Button>
          )}
          {!isNew && existing?.status === 'draft' && (
            <Button onClick={() => { if (confirm(t('returns.confirm_purchase_post_warn'))) confirmMutation.mutate(); }}
              loading={confirmMutation.isPending}>
              {t('returns.confirm')}
            </Button>
          )}
          {!isNew && existing?.status === 'confirmed' && (
            <Button variant="danger"
              onClick={() => {
                const r = prompt(t('common.void_reason'));
                if (r !== null) voidMutation.mutate(r);
              }}
              loading={voidMutation.isPending}>
              {t('common.void')}
            </Button>
          )}
        </div>
      </div>

      {error && <p className="rounded-card border border-danger-500 bg-danger-50 px-4 py-2 text-sm text-danger-600">{error}</p>}

      <div className="glass-card grid gap-4 p-4 md:grid-cols-2">
        <div>
          <label className="mb-1 block text-sm font-medium text-ink-secondary">{t('returns.linked_bill')} *</label>
          <div className="flex gap-2">
            <div className="flex-1">
              <SearchableSelect
                options={bills.map(b => ({ value: b.id, label: `${b.bill_number} (${b.date})` }))}
                value={billId}
                disabled={!isDraft || !isNew}
                onChange={setBillId}
                placeholder={`— ${t('common.select')} —`}
                panelWidth={360}
              />
            </div>
            {isNew && billId && billItems.length > 0 && (
              <Button variant="secondary" onClick={importFromBill}>{t('returns.import_lines')}</Button>
            )}
          </div>
        </div>

        <div>
          <label className="mb-1 block text-sm font-medium text-ink-secondary">{t('common.date')} *</label>
          <input type="date" value={date} onChange={e => setDate(e.target.value)} disabled={!isDraft}
            className="w-full rounded border border-border-strong px-3 py-2 text-sm" />
        </div>

        <div>
          <label className="mb-1 block text-sm font-medium text-ink-secondary">{t('returns.reason')}</label>
          <select value={reason} onChange={e => setReason(e.target.value)} disabled={!isDraft}
            className="w-full rounded border border-border-strong px-3 py-2 text-sm">
            <option value="wrong_part">{t('returns.wrong_part')}</option>
            <option value="defective">{t('returns.defective')}</option>
            <option value="damaged_in_transit">{t('returns.damaged_in_transit')}</option>
            <option value="over_shipment">{t('returns.over_shipment')}</option>
            <option value="other">{t('returns.other')}</option>
          </select>
        </div>

        <div>
          <label className="mb-1 block text-sm font-medium text-ink-secondary">{t('common.notes')}</label>
          <input type="text" value={notes} onChange={e => setNotes(e.target.value)} disabled={!isDraft}
            className="w-full rounded border border-border-strong px-3 py-2 text-sm" />
        </div>
      </div>

      <div className="glass-card overflow-hidden">
        <div className="flex items-center justify-between border-b border-border-subtle px-4 py-3">
          <h2 className="text-sm font-semibold text-ink-primary">{t('returns.returned_items')}</h2>
          {isNew && billId && lines.length === 0 && billItems.length > 0 && (
            <span className="text-xs text-ink-tertiary">{t('returns.use_import')}</span>
          )}
        </div>
        <table className="w-full text-sm">
          <thead className="bg-surface-muted">
            <tr>
              <th className="px-3 py-2 text-start text-xs font-medium text-ink-tertiary">{t('common.description')}</th>
              <th className="px-3 py-2 text-end text-xs font-medium text-ink-tertiary">{t('returns.returnable')}</th>
              <th className="px-3 py-2 text-end text-xs font-medium text-ink-tertiary">{t('returns.qty_returned')}</th>
              <th className="px-3 py-2 text-start text-xs font-medium text-ink-tertiary">{t('returns.condition')}</th>
              <th className="px-3 py-2 text-end text-xs font-medium text-ink-tertiary">{t('common.unit_cost')}</th>
              {isNew && <th className="px-3 py-2" />}
            </tr>
          </thead>
          <tbody className="divide-y divide-border-subtle">
            {lines.length === 0 && (
              <tr><td colSpan={6} className="px-3 py-6 text-center text-ink-tertiary">{t('returns.no_lines')}</td></tr>
            )}
            {lines.map((l, i) => (
              <tr key={i}>
                <td className="px-3 py-2 text-ink-secondary">
                  {l.description || <span className="text-ink-tertiary">—</span>}
                </td>
                <td className="px-3 py-2 text-end text-xs text-ink-secondary">{l.qty_returnable}</td>
                <td className="px-3 py-2 text-end">
                  <input type="number" min="1" step="1" max={l.qty_returnable || undefined}
                    value={l.qty_returned}
                    onChange={e => updateLine(i, 'qty_returned', Number(e.target.value))}
                    disabled={!isDraft}
                    className={`w-24 rounded border px-2 py-1 text-end text-sm ${
                      l.qty_returned > l.qty_returnable
                        ? 'border-danger-500 text-danger-600'
                        : 'border-border-strong'}`} />
                </td>
                <td className="px-3 py-2">
                  <select value={l.condition}
                    onChange={e => updateLine(i, 'condition', e.target.value as 'resellable' | 'damaged')}
                    disabled={!isDraft}
                    className="rounded border border-border-strong px-2 py-1 text-sm">
                    <option value="resellable">{t('returns.resellable')}</option>
                    <option value="damaged">{t('returns.damaged')}</option>
                  </select>
                </td>
                <td className="px-3 py-2 text-end text-ink-secondary">
                  {l.unit_cost !== null ? l.unit_cost.toFixed(2) : '—'}
                </td>
                {isNew && (
                  <td className="px-3 py-2">
                    <button onClick={() => removeLine(i)} className="text-xs text-red-400 hover:text-red-600">✕</button>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <p className="text-xs text-ink-tertiary">{t('returns.purchase_post_hint')}</p>
    </div>
  );
}
