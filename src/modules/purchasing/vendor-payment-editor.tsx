import { useState, useEffect, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { useNavigate, useParams } from 'react-router-dom';
import { getAdapter } from '@/data/index';
import { useAuthStore } from '@/store/auth';
import { Button } from '@/ui/button';
import { Input } from '@/ui/input';
import { Select } from '@/ui/select';
import { SearchableSelect } from '@/ui/searchable-select';
import { AccountingPreview, buildVendorPaymentPreview } from '@/components/accounting-preview';
import { ActivityLog } from '@/components/activity-log';
import type { PaymentRow, ContactRow, BankAccountRow, VendorBillRow, OpenVendorBill, PaymentAllocationInsert, PaymentMethodRow } from '@/data/adapter';

const todayIso = () => new Date().toISOString().slice(0, 10);
const fmt = (n: number) => n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export default function VendorPaymentEditorPage() {
  const { t } = useTranslation();
  const { company_id } = useAuthStore();
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const isNew = id === 'new';

  const { data: suppliers = [] } = useQuery<ContactRow[]>({
    queryKey: ['contacts', company_id, 'supplier'],
    queryFn: () => getAdapter().contacts.list(company_id!, 'supplier'),
    enabled: !!company_id,
  });
  const { data: bankAccounts = [] } = useQuery<BankAccountRow[]>({
    queryKey: ['bankAccounts', company_id],
    queryFn: () => getAdapter().bankAccounts.list(company_id!),
    enabled: !!company_id,
  });
  const { data: paymentMethods = [] } = useQuery<PaymentMethodRow[]>({
    queryKey: ['paymentMethods', company_id],
    queryFn: async () => {
      const { data, error } = await (await import('@/data/supabase-client')).getSupabaseClient()
        .from('payment_methods').select('*').eq('company_id', company_id!);
      if (error) throw error;
      return data ?? [];
    },
    enabled: !!company_id,
  });
  const { data: existing } = useQuery<PaymentRow | null>({
    queryKey: ['vendor_payment', id],
    queryFn: () => getAdapter().vendorPayments.getById(id!),
    enabled: !isNew && !!id,
  });
  const { data: existingAllocations = [] } = useQuery({
    queryKey: ['vendor_payment_allocations', id],
    queryFn: () => getAdapter().vendorPayments.getAllocations(id!),
    enabled: !isNew && !!id,
  });

  // Reconciled-payment IDs (Batch C) — shared cache across both
  // customer + vendor payment screens.
  const { data: reconciledIds = [] } = useQuery({
    queryKey: ['reconciled_payment_ids', company_id],
    queryFn: () => getAdapter().bankReconciliations.listReconciledPaymentIds(company_id!),
    enabled: !!company_id && !isNew,
  });
  const isReconciled = !!id && reconciledIds.includes(id);

  const [header, setHeader] = useState({
    contact_id: '', bank_account_id: '', payment_method_id: '',
    date: todayIso(), amount: '', currency: 'AED',
    classification: 'against_invoice' as 'against_invoice' | 'advance' | 'on_account',
    reference: '', notes: '',
  });
  const [error, setError] = useState<string | null>(null);
  const [applyModal, setApplyModal] = useState(false);
  const [applyBillId, setApplyBillId] = useState('');
  const [applyAmount, setApplyAmount] = useState('');
  const [openBills, setOpenBills] = useState<VendorBillRow[]>([]);

  // ── Inline "Apply to Bills" panel state ──────────────────────────────────
  // Mirrors the customer payment editor: when classification === 'against_invoice'
  // and a supplier is picked, we fetch their open bills, let the user split the
  // payment across them (FIFO auto-fill, per-row override), and on Save we
  // create payment_allocations rows along with the payment.
  // Drafts (new or existing) can edit allocations. Confirmed payments hide
  // the panel — they have a separate read-only allocations section.
  const isDraftLike = isNew || existing?.status === 'draft';
  const { data: openBillsForPanel = [] } = useQuery<OpenVendorBill[]>({
    queryKey: ['open_bills_for_supplier', company_id, header.contact_id],
    queryFn: () => getAdapter().vendorBills.listOpenForSupplier(company_id!, header.contact_id),
    enabled: !!company_id && !!header.contact_id && isDraftLike,
  });
  const [applyAmounts, setApplyAmounts] = useState<Record<string, string>>({});
  const totalToApply = useMemo(
    () => Object.values(applyAmounts).reduce((s, v) => s + (parseFloat(v) || 0), 0),
    [applyAmounts],
  );
  const showAllocationPanel =
    isDraftLike && header.classification === 'against_invoice'
    && !!header.contact_id && openBillsForPanel.length > 0;

  // Stale allocations on existing drafts: a previously-allocated bill may
  // have been voided or fully paid since the draft was last saved. Warn
  // the user before save drops them.
  const staleAllocations = useMemo(() => {
    if (!isDraftLike) return [];
    const openIds = new Set(openBillsForPanel.map(b => b.id));
    return existingAllocations.filter(a => a.doc_type === 'vendor_bill' && !openIds.has(a.doc_id));
  }, [isDraftLike, existingAllocations, openBillsForPanel]);

  function autoFillFIFO(amountStr: string, bills: OpenVendorBill[]) {
    const amt = parseFloat(amountStr);
    if (!isFinite(amt) || amt <= 0) { setApplyAmounts({}); return; }
    let remaining = amt;
    const next: Record<string, string> = {};
    for (const b of bills) {
      if (remaining <= 0.005) break;
      const apply = Math.min(remaining, b.outstanding);
      next[b.id] = apply.toFixed(2);
      remaining -= apply;
    }
    setApplyAmounts(next);
  }

  useEffect(() => {
    if (existing) {
      setHeader({
        contact_id: existing.contact_id, bank_account_id: existing.bank_account_id ?? '',
        payment_method_id: existing.payment_method_id ?? '',
        date: existing.date as string, amount: String(existing.amount),
        currency: existing.currency,
        classification: existing.classification as 'against_invoice' | 'advance' | 'on_account',
        reference: existing.reference ?? '', notes: existing.notes ?? '',
      });
    }
  }, [existing]);

  // Pre-fill applyAmounts from existing allocations on a draft load. Only
  // seeds once per draft so the user's edits during the session aren't
  // clobbered. No-op for confirmed/void payments.
  const [appliedSeed, setAppliedSeed] = useState(false);
  useEffect(() => {
    if (!appliedSeed && existing && existing.status === 'draft' && existingAllocations.length > 0) {
      const seed: Record<string, string> = {};
      for (const a of existingAllocations) {
        if (a.doc_type === 'vendor_bill') {
          seed[a.doc_id] = Number(a.amount_applied).toFixed(2);
        }
      }
      setApplyAmounts(seed);
      setAppliedSeed(true);
    }
  }, [existing, existingAllocations, appliedSeed]);

  useEffect(() => {
    if (applyModal && existing) {
      getAdapter().vendorBills.list(company_id!, 'confirmed')
        .then(bills => setOpenBills(bills.filter(b => b.supplier_id === existing.contact_id)));
    }
  }, [applyModal, existing, company_id]);

  const saveMutation = useMutation({
    mutationFn: async () => {
      if (!header.contact_id) throw new Error(t('purchasing.error_supplier_required'));
      if (!header.amount || isNaN(Number(header.amount))) throw new Error(t('purchasing.error_amount_required'));
      if (Number(header.amount) <= 0) throw new Error('Amount must be greater than zero');
      if (!header.bank_account_id) throw new Error('Bank / cash account is required — every payment must hit a real GL account');

      // Build allocations from the panel — for both new payments and
      // existing drafts that are still in against_invoice mode.
      const allocations: PaymentAllocationInsert[] = [];
      if (isDraftLike && header.classification === 'against_invoice') {
        for (const [doc_id, raw] of Object.entries(applyAmounts)) {
          const amt = parseFloat(raw);
          if (isFinite(amt) && amt > 0) {
            // Per-row over-allocation guard — cannot apply more than the
            // bill's current outstanding (would drive the bill to a
            // negative outstanding and break AP aging + supplier balance).
            const bill = openBillsForPanel.find(b => b.id === doc_id);
            // Drop stale entries (bill no longer in the open list).
            // The amber banner already warns the user.
            if (!bill) continue;
            if (amt > bill.outstanding + 0.005) {
              throw new Error(
                `Bill ${bill.bill_number}: applied ${amt.toFixed(2)} exceeds outstanding ${bill.outstanding.toFixed(2)}`,
              );
            }
            allocations.push({
              company_id: company_id!,
              payment_id: '',                  // adapter fills with new payment id
              doc_id,
              doc_type: 'vendor_bill',
              amount_applied: +amt.toFixed(2),
            });
          }
        }
        const totalAlloc = allocations.reduce((s, a) => s + a.amount_applied, 0);
        const payAmt = parseFloat(header.amount);
        if (totalAlloc > payAmt + 0.005) {
          throw new Error(`Allocations (${totalAlloc.toFixed(2)}) exceed payment amount (${payAmt.toFixed(2)})`);
        }
      }

      if (isNew) {
        const pmtNum = await getAdapter().vendorPayments.getNextNumber(company_id!);
        const row = {
          company_id: company_id!, payment_number: pmtNum,
          type: 'outbound' as const,
          contact_id: header.contact_id,
          date: header.date, amount: Number(header.amount),
          currency: header.currency, exchange_rate: 1,
          payment_method_id: header.payment_method_id || null,
          bank_account_id: header.bank_account_id || null,
          reference: header.reference || null,
          classification: header.classification,
          status: 'draft' as const,
          void_reason: null, voided_at: null, voided_by: null,
          notes: header.notes || null,
        };
        return getAdapter().vendorPayments.create(row, allocations.length > 0 ? allocations : undefined);
      }

      // Existing draft: update via RPC and atomically replace allocations.
      //   against_invoice → send the panel's allocations (may be empty).
      //   advance/on_account → send [] to clear stale allocations from a
      //     previous against_invoice session.
      const updateAllocations =
        header.classification === 'against_invoice' ? allocations : [];
      return getAdapter().vendorPayments.update(id!, {
        contact_id:        header.contact_id,
        date:              header.date,
        amount:            Number(header.amount),
        currency:          header.currency,
        payment_method_id: header.payment_method_id || null,
        bank_account_id:   header.bank_account_id || null,
        reference:         header.reference || null,
        classification:    header.classification,
        notes:             header.notes || null,
      }, updateAllocations);
    },
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ['vendor_payments', company_id] });
      qc.invalidateQueries({ queryKey: ['open_bills_for_supplier', company_id, header.contact_id] });
      qc.invalidateQueries({ queryKey: ['vendor_payment', id] });
      qc.invalidateQueries({ queryKey: ['vendor_payment_allocations', id] });
      if (isNew && data) navigate(`/purchasing/payments/${data.id}`);
    },
    onError: (e: Error) => setError(e.message),
  });

  const confirmMutation = useMutation({
    mutationFn: () => getAdapter().vendorPayments.confirm(id!),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['vendor_payments', company_id] });
      qc.invalidateQueries({ queryKey: ['vendor_payment', id] });
    },
    onError: (e: Error) => setError(e.message),
  });

  const applyMutation = useMutation({
    mutationFn: () => getAdapter().vendorPayments.applyAdvance(id!, applyBillId, Number(applyAmount)),
    onSuccess: () => {
      setApplyModal(false); setApplyBillId(''); setApplyAmount('');
      qc.invalidateQueries({ queryKey: ['vendor_payment_allocations', id] });
    },
    onError: (e: Error) => setError(e.message),
  });

  const usedAmount = existingAllocations.reduce((s, a) => s + Number(a.amount_applied), 0);
  const available = (existing ? Number(existing.amount) : 0) - usedAmount;

  // Drafts are editable; confirmed/void are locked. The RPC (update_payment_draft)
  // is the source of truth — it refuses anything that isn't status='draft'.
  const canEdit = isNew || existing?.status === 'draft';
  const supplierOpts = suppliers.map(s => ({ value: s.id, label: s.name }));
  const bankOpts = [{ value: '', label: t('purchasing.select_bank') }, ...bankAccounts.map(b => ({ value: b.id, label: b.account_number ?? b.bank_name ?? b.id }))];
  const bankLabel = `${t('purchasing.bank_account')} *`;
  const methodOpts = [{ value: '', label: '—' }, ...paymentMethods.map(m => ({ value: m.id, label: m.name }))];
  const classOpts = [
    { value: 'against_invoice', label: t('purchasing.against_invoice') },
    { value: 'advance', label: t('purchasing.advance') },
    { value: 'on_account', label: t('purchasing.on_account') },
  ];
  const billOpts = [{ value: '', label: t('purchasing.select_bill') }, ...openBills.map(b => ({ value: b.id, label: `${b.bill_number} — ${fmt(Number(b.total_amount))}` }))];

  return (
    <div className="space-y-6 pb-16">
      <div className="flex items-center gap-3">
        <button onClick={() => navigate('/purchasing/payments')} className="text-sm text-ink-secondary hover:text-ink-primary">← {t('purchasing.vp_title')}</button>
        <span className="text-ink-tertiary">/</span>
        <h1 className="text-xl font-semibold text-ink-primary">{isNew ? t('purchasing.new_vp') : existing?.payment_number ?? '…'}</h1>
        {!isNew && <span className="rounded-pill bg-gray-100 px-2.5 py-0.5 text-xs capitalize text-gray-600">{existing?.status}</span>}
        {!isNew && (() => {
          const alloc = (existing as (PaymentRow & { allocation_status?: 'unallocated' | 'partial' | 'full' | null }) | null | undefined)?.allocation_status;
          if (existing?.status !== 'confirmed' || !alloc) return null;
          const map: Record<string, { label: string; cls: string }> = {
            unallocated: { label: 'Advance',       cls: 'bg-purple-50 text-purple-700' },
            partial:     { label: 'Partial',       cls: 'bg-amber-50 text-amber-700'   },
            full:        { label: 'Fully applied', cls: 'bg-sky-50 text-sky-700'       },
          };
          const cfg = map[alloc];
          if (!cfg) return null;
          return <span className={`rounded-pill px-2.5 py-0.5 text-xs font-medium ${cfg.cls}`}>{cfg.label}</span>;
        })()}
        {!isNew && isReconciled && existing?.status === 'confirmed' && (
          <span className="rounded-pill bg-emerald-50 px-2.5 py-0.5 text-xs font-medium text-emerald-700">
            Reconciled
          </span>
        )}
        <div className="ms-auto flex gap-2">
          <Button variant="ghost" size="sm" onClick={() => navigate('/purchasing/payments')}>{t('common.cancel')}</Button>
          {canEdit && (
            <Button size="sm" onClick={() => { setError(null); saveMutation.mutate(); }} disabled={saveMutation.isPending}>
              {saveMutation.isPending ? t('common.saving') : t('common.save')}
            </Button>
          )}
          {!isNew && existing?.status === 'draft' && (
            <Button size="sm" onClick={() => confirmMutation.mutate()} disabled={confirmMutation.isPending}>
              {t('purchasing.confirm_payment')}
            </Button>
          )}
          {!isNew && existing?.status === 'confirmed' && available > 0 && (
            <Button size="sm" variant="ghost" onClick={() => setApplyModal(true)}>
              {t('purchasing.apply_advance')}
            </Button>
          )}
        </div>
      </div>

      {error && <div className="rounded-input bg-red-50 px-4 py-2 text-sm text-red-700">{error}</div>}

      {staleAllocations.length > 0 && (
        <div className="rounded-input bg-amber-50 px-4 py-2 text-sm text-amber-800">
          <strong>Stale allocation{staleAllocations.length === 1 ? '' : 's'} detected.</strong>{' '}
          {staleAllocations.length} previously-allocated bill{staleAllocations.length === 1 ? ' is' : 's are'} no
          longer in the open list (likely voided or fully paid by another payment). They will be dropped on Save.
        </div>
      )}

      {applyModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="w-96 rounded-card bg-surface-card p-6 shadow-xl space-y-4">
            <h3 className="text-base font-semibold text-ink-primary">{t('purchasing.apply_advance')}</h3>
            <p className="text-sm text-ink-secondary">{t('purchasing.available_balance')}: <strong>{fmt(available)}</strong></p>
            <Select label={t('purchasing.select_bill')} options={billOpts} value={applyBillId}
              onChange={e => setApplyBillId(e.target.value)} />
            <Input label={t('purchasing.amount')} type="number" min="0" step="0.01"
              value={applyAmount} onChange={e => setApplyAmount(e.target.value)} />
            <div className="flex gap-2 justify-end">
              <Button variant="ghost" size="sm" onClick={() => setApplyModal(false)}>{t('common.cancel')}</Button>
              <Button size="sm" onClick={() => applyMutation.mutate()} disabled={applyMutation.isPending || !applyBillId || !applyAmount}>
                {applyMutation.isPending ? t('common.saving') : t('common.apply')}
              </Button>
            </div>
          </div>
        </div>
      )}

      <div className="rounded-card border border-border-subtle bg-surface-card p-5">
        <h2 className="mb-4 text-sm font-semibold text-ink-primary">{t('purchasing.payment_details')}</h2>
        <div className="grid grid-cols-2 gap-4 md:grid-cols-3">
          <div className="col-span-2 md:col-span-1">
            <label className="mb-1 block text-sm font-medium text-ink-primary">
              {t('purchasing.supplier')} <span className="text-danger-500">*</span>
            </label>
            <SearchableSelect
              options={supplierOpts}
              value={header.contact_id}
              disabled={!canEdit}
              onChange={(v) => {
                setHeader(h => ({ ...h, contact_id: v }));
                setApplyAmounts({}); // bill list will refetch; reset apply
              }}
              placeholder={t('purchasing.select_supplier')}
              panelWidth={320}
            />
          </div>
          <Select label={bankLabel} required options={bankOpts} value={header.bank_account_id}
            disabled={!canEdit} onChange={e => setHeader(h => ({ ...h, bank_account_id: e.target.value }))} />
          <Select label={t('purchasing.payment_method')} options={methodOpts} value={header.payment_method_id}
            disabled={!canEdit} onChange={e => setHeader(h => ({ ...h, payment_method_id: e.target.value }))} />
          <Input label={t('purchasing.date')} type="date" required value={header.date}
            disabled={!canEdit} onChange={e => setHeader(h => ({ ...h, date: e.target.value }))} />
          <Input label={t('purchasing.amount')} type="number" required value={header.amount}
            disabled={!canEdit} onChange={e => {
              const v = e.target.value;
              setHeader(h => ({ ...h, amount: v }));
              if (isNew && header.classification === 'against_invoice' && header.contact_id) {
                autoFillFIFO(v, openBillsForPanel);
              }
            }} />
          <Select label={t('purchasing.classification')} options={classOpts} value={header.classification}
            disabled={!canEdit} onChange={e => {
              const v = e.target.value as 'against_invoice' | 'advance' | 'on_account';
              setHeader(h => ({ ...h, classification: v }));
              if (v !== 'against_invoice') setApplyAmounts({});
              else if (header.amount) autoFillFIFO(header.amount, openBillsForPanel);
            }} />
          <Input label={t('purchasing.reference')} value={header.reference}
            disabled={!canEdit} onChange={e => setHeader(h => ({ ...h, reference: e.target.value }))} />
        </div>
      </div>

      {/* ── Apply to Bills panel ─────────────────────────────────────────
           Shown only on a NEW draft when classification is "against_invoice"
           and the chosen supplier has open bills. Auto-fills oldest-first
           when the payment Amount changes; user can override per row. */}
      {showAllocationPanel && (() => {
        const payAmt = parseFloat(header.amount) || 0;
        const difference = +(payAmt - totalToApply).toFixed(2);
        return (
          <div className="rounded-card border border-border-subtle bg-surface-card">
            <div className="border-b border-border-subtle px-5 py-3">
              <h2 className="text-sm font-semibold text-ink-primary">Apply to Bills</h2>
              <p className="mt-0.5 text-xs text-ink-tertiary">
                Distribute the payment across {openBillsForPanel.length} open bill{openBillsForPanel.length === 1 ? '' : 's'}. Oldest first by default — edit any row to override.
              </p>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border-subtle bg-surface-muted text-xs text-ink-tertiary">
                    <th className="px-4 py-2 text-start font-medium">Bill #</th>
                    <th className="px-4 py-2 text-start font-medium">Date</th>
                    <th className="px-4 py-2 text-end font-medium">Total</th>
                    <th className="px-4 py-2 text-end font-medium">Outstanding</th>
                    <th className="px-4 py-2 text-end font-medium w-32">Apply</th>
                  </tr>
                </thead>
                <tbody>
                  {openBillsForPanel.map((bill) => {
                    const applyVal = applyAmounts[bill.id] ?? '';
                    const applyNum = parseFloat(applyVal) || 0;
                    const overApplied = applyNum > bill.outstanding + 0.005;
                    return (
                      <tr key={bill.id} className="border-b border-border-subtle last:border-0">
                        <td className="px-4 py-2 font-mono text-xs text-ink-primary">{bill.bill_number}</td>
                        <td className="px-4 py-2 text-ink-secondary">{bill.date as unknown as string}</td>
                        <td className="px-4 py-2 text-end font-mono text-ink-secondary">{fmt(Number(bill.total_amount))}</td>
                        <td className="px-4 py-2 text-end font-mono text-ink-primary">{fmt(bill.outstanding)}</td>
                        <td className="px-4 py-2">
                          <input
                            type="number"
                            min="0"
                            step="0.01"
                            value={applyVal}
                            placeholder="0.00"
                            className={`w-full rounded border bg-surface-subtle px-2 py-1 text-end text-xs ${overApplied ? 'border-red-400 text-red-700' : 'border-border-strong text-ink-primary'}`}
                            onChange={(e) => setApplyAmounts(prev => ({ ...prev, [bill.id]: e.target.value }))}
                          />
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <div className="border-t border-border-subtle px-5 py-3">
              <div className="ms-auto w-72 space-y-1 text-sm">
                <div className="flex justify-between text-ink-secondary">
                  <span>Payment amount</span>
                  <span className="font-mono">{fmt(payAmt)}</span>
                </div>
                <div className="flex justify-between text-ink-secondary">
                  <span>Total to apply</span>
                  <span className="font-mono">{fmt(totalToApply)}</span>
                </div>
                <div className={`flex justify-between font-semibold ${
                  difference < 0 ? 'text-red-600' : difference > 0 ? 'text-amber-600' : 'text-green-700'
                }`}>
                  <span>{difference < 0 ? 'Over-applied' : difference > 0 ? 'Unallocated (advance)' : 'Fully allocated'}</span>
                  <span className="font-mono">{fmt(Math.abs(difference))}</span>
                </div>
                {difference > 0 && (
                  <p className="pt-1 text-xs text-ink-tertiary">
                    The unallocated portion will sit as a vendor advance and can be applied to future bills.
                  </p>
                )}
              </div>
            </div>
          </div>
        );
      })()}

      {/* Accounting preview — sanity check the JE before Confirm.
           Only shown for drafts (new or existing) with a positive amount. */}
      {isDraftLike && parseFloat(header.amount) > 0 && (() => {
        const bank = bankAccounts.find(b => b.id === header.bank_account_id);
        const lines = buildVendorPaymentPreview({
          amount:             parseFloat(header.amount) || 0,
          classification:     header.classification,
          bank_account_name:  bank?.name ?? bank?.account_number ?? undefined,
          allocated_total:    totalToApply,
          payment_number:     existing?.payment_number,
        });
        return <AccountingPreview lines={lines} currency={header.currency || 'AED'} />;
      })()}

      {!isNew && existing?.status !== 'draft' && existingAllocations.length > 0 && (
        <div className="rounded-card border border-border-subtle bg-surface-card">
          <div className="border-b border-border-subtle px-5 py-3">
            <h2 className="text-sm font-semibold text-ink-primary">{t('purchasing.allocations')}</h2>
          </div>
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border-subtle bg-surface-muted text-ink-tertiary text-xs">
                <th className="px-4 py-3 text-start font-medium">{t('purchasing.bill')}</th>
                <th className="px-4 py-3 text-end font-medium">{t('purchasing.amount_applied')}</th>
              </tr>
            </thead>
            <tbody>
              {existingAllocations.map(a => (
                <tr key={a.id} className="border-b border-border-subtle last:border-0">
                  <td className="px-4 py-3 font-mono text-xs text-ink-secondary">{a.doc_id}</td>
                  <td className="px-4 py-3 text-end font-mono">{fmt(Number(a.amount_applied))}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="border-t border-border-subtle px-5 py-3 text-sm text-ink-secondary flex justify-between">
            <span>{t('purchasing.available_balance')}</span>
            <span className="font-mono font-semibold text-ink-primary">{fmt(available)}</span>
          </div>
        </div>
      )}

      {/* Activity log — every confirm/void writes an audit_logs row.
           Hidden for new payments (nothing to show yet). */}
      {!isNew && id && <ActivityLog entityType="payment" entityId={id} />}
    </div>
  );
}
