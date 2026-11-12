import { useState, useEffect, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { getAdapter } from '@/data/index';
import { useAuthStore } from '@/store/auth';
import { useInvalidateBooks } from '@/hooks/use-invalidate-books';
import { useUnsavedChangesGuard } from '@/hooks/use-unsaved-changes-guard';
import { useCompanyCurrency } from '@/hooks/use-company-currency';
import { Button } from '@/ui/button';
import { BackButton } from '@/ui/back-button';
import { StatusBadge } from '@/ui/status-badge';
import { Modal } from '@/ui/modal';
import { Pencil, Printer, Eye, AlertTriangle } from 'lucide-react';
import '@/styles/stockbolt-ocean-teal.css';
import { Input } from '@/ui/input';
import { Select } from '@/ui/select';
import { ContactPicker } from '@/components/contact-picker';
import { AccountingPreview, buildVendorPaymentPreview } from '@/components/accounting-preview';
import { ActivityLog } from '@/components/activity-log';
// Phase 14.05 — Signature template view mode for saved vendor payments.
import { ConfigurableDocTemplate } from '@/modules/print/engine/ConfigurableDocTemplate';
import { useResolvedPrintTemplate } from '@/hooks/use-resolved-print-template';
import { vendorPaymentToDocumentData } from '@/modules/print/_signature/adapters';
import '@/modules/print/_signature/print.css';
import type { PaymentRow, BankAccountRow, VendorBillRow, OpenVendorBill, PaymentAllocationInsert, PaymentMethodRow, Company, ContactRow } from '@/data/adapter';

const todayIso = () => new Date().toISOString().slice(0, 10);
const fmt = (n: number) => n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export default function VendorPaymentEditorPage() {
  const { t } = useTranslation();
  const { company_id } = useAuthStore();
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const printTemplate = useResolvedPrintTemplate('payment_voucher');
  const qc = useQueryClient();
  const invalidateBooks = useInvalidateBooks();   // Phase 14.14k
  const companyCurrency = useCompanyCurrency();    // Phase 14.14m
  const [searchParams] = useSearchParams();
  const isNew = id === 'new';
  // Deep-link from a saved bill's "Make Payment" CTA — pre-selects the supplier.
  const seedContact = searchParams.get('contact');
  // Phase 14.08 — deep-link from supplier-detail "Apply credit" banner.
  const autoApply = searchParams.get('apply') === '1';

  // suppliers list removed — supplier picker now uses ContactPicker (D3).
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

  // Phase 14.05 — reference data for Signature template view.
  const { data: companyRow } = useQuery<Company | null>({
    queryKey: ['company', company_id],
    queryFn:  () => getAdapter().companies.getById(company_id!),
    enabled:  !!company_id,
  });
  const { data: suppliers = [] } = useQuery<ContactRow[]>({
    queryKey: ['contacts', company_id, 'supplier'],
    queryFn:  () => getAdapter().contacts.list(company_id!, 'supplier'),
    enabled:  !!company_id,
  });
  const { data: allBills = [] } = useQuery<VendorBillRow[]>({
    queryKey: ['vendor_bills', company_id],
    queryFn:  () => getAdapter().vendorBills.list(company_id!),
    enabled:  !!company_id,
  });

  // Phase 14.05 — view-first mode for saved vendor payments.
  const [viewMode, setViewMode] = useState(!isNew);

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
    date: todayIso(), amount: '', currency: companyCurrency,
    classification: 'against_invoice' as 'against_invoice' | 'advance' | 'on_account',
    reference: '', notes: '',
  });
  const [error, setError] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);
  const confirmLeave = useUnsavedChangesGuard(dirty);
  const [applyModal, setApplyModal] = useState(false);
  const [applyBillId, setApplyBillId] = useState('');
  const [applyAmount, setApplyAmount] = useState('');
  // Phase 18 — edit a confirmed payment: reverse the posting + reopen as draft.
  const [reopenModal, setReopenModal] = useState(false);
  // Phase 19 — PDC: issue this payment as a post-dated cheque (posts to 2450
  // PDC Payable, not bank; creates a linked cheque for the PDC lifecycle).
  const [isPdc, setIsPdc] = useState(false);
  const [chequeNumber, setChequeNumber] = useState('');
  const [chequeBank, setChequeBank] = useState('');
  const [chequeDueDate, setChequeDueDate] = useState('');
  // Phase 14.08b — OpenVendorBill carries `outstanding`, so the modal can
  // show what's actually left to pay on each bill (not the gross total).
  const [openBills, setOpenBills] = useState<OpenVendorBill[]>([]);

  // Phase 14.08 — auto-open the apply modal when arriving via ?apply=1.
  useEffect(() => {
    if (autoApply && existing?.status === 'confirmed') {
      setApplyModal(true);
    }
  }, [autoApply, existing?.status]);

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

  // New payment opened from a saved bill — pre-select that supplier.
  useEffect(() => {
    if (isNew && seedContact) {
      setHeader(h => ({ ...h, contact_id: seedContact }));
    }
  }, [isNew, seedContact]);

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

  // Phase 14.08b — pull only bills with positive outstanding for this
  // supplier so the apply-to-bill picker doesn't surface anything that's
  // already fully paid. Provides `outstanding` per row for the new UX.
  useEffect(() => {
    if (applyModal && existing) {
      getAdapter().vendorBills.listOpenForSupplier(company_id!, existing.contact_id)
        .then(setOpenBills);
    }
  }, [applyModal, existing, company_id]);

  // Build + persist the draft (create or update) and return the row. Shared by
  // the normal Save and the Phase 19 "Confirm as PDC" flow.
  const persistDraft = async (): Promise<PaymentRow> => {
      if (!header.contact_id) throw new Error(t('purchasing.error_supplier_required'));
      if (!header.amount || isNaN(Number(header.amount))) throw new Error(t('purchasing.error_amount_required'));
      if (Number(header.amount) <= 0) throw new Error(t('rcptOcean.err_amount'));
      if (!header.bank_account_id) throw new Error(t('vpOcean.err_bank'));

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
                t('vpOcean.err_over_bill', { no: bill.bill_number, applied: amt.toFixed(2), outstanding: bill.outstanding.toFixed(2) }),
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
          throw new Error(t('vpOcean.err_over_total', { alloc: totalAlloc.toFixed(2), amount: payAmt.toFixed(2) }));
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
  };

  // Save = persist the draft then immediately post it (single-step). Failed
  // post leaves a saved draft; a new payment routes to its record so a retry
  // updates+posts instead of duplicating.
  const saveMutation = useMutation({
    mutationFn: async () => {
      const saved = await persistDraft();
      const pid = isNew ? saved.id : id!;
      try {
        await getAdapter().vendorPayments.confirm(pid);
      } catch (e) {
        if (isNew) navigate(`/purchasing/payments/${pid}`);
        throw e;
      }
      return saved;
    },
    onSuccess: async (data) => {
      setDirty(false);
      await invalidateBooks();
      qc.invalidateQueries({ queryKey: ['vendor_payments', company_id] });
      qc.invalidateQueries({ queryKey: ['open_bills_for_supplier', company_id, header.contact_id] });
      qc.invalidateQueries({ queryKey: ['vendor_payment', id] });
      qc.invalidateQueries({ queryKey: ['vendor_payment_allocations', id] });
      if (isNew && data) navigate('/purchasing/payments');
    },
    onError: (e: Error) => setError(e.message),
  });

  // Phase 19 — save the draft then confirm it as an issued PDC (posts to 2450,
  // creates the linked cheque). One click from the editor.
  const pdcMutation = useMutation({
    mutationFn: async () => {
      if (!chequeNumber.trim()) throw new Error(t('rcptOcean.err_cheque_no'));
      if (!chequeDueDate) throw new Error(t('rcptOcean.err_cheque_due'));
      const saved = await persistDraft();
      const pid = isNew ? saved.id : id!;
      return getAdapter().vendorPayments.confirmAsPdc(pid, {
        cheque_number: chequeNumber.trim(),
        bank_name: chequeBank.trim(),
        due_date: chequeDueDate,
      });
    },
    onSuccess: async () => {
      setDirty(false);
      await invalidateBooks();
      qc.invalidateQueries({ queryKey: ['vendor_payments', company_id] });
      navigate('/banking/pdc-issued');
    },
    onError: (e: Error) => setError(e.message),
  });

  // Phase 18 — reverse a confirmed payment's posting and reopen as a draft,
  // then drop into the edit form to change + re-confirm.
  const reopenMutation = useMutation({
    mutationFn: () => getAdapter().vendorPayments.reopen(id!),
    onSuccess: async () => {
      setReopenModal(false);
      await invalidateBooks();
      qc.invalidateQueries({ queryKey: ['vendor_payment', id] });
      qc.invalidateQueries({ queryKey: ['vendor_payment_allocations', id] });
      qc.invalidateQueries({ queryKey: ['vendor_payments', company_id] });
      setViewMode(false);
    },
    onError: (e: Error) => { setReopenModal(false); setError(e.message); },
  });

  const applyMutation = useMutation({
    mutationFn: () => getAdapter().vendorPayments.applyAdvance(id!, applyBillId, Number(applyAmount)),
    onSuccess: async () => {
      setApplyModal(false); setApplyBillId(''); setApplyAmount('');
      await invalidateBooks();
      qc.invalidateQueries({ queryKey: ['vendor_payment_allocations', id] });
    },
    onError: (e: Error) => setError(e.message),
  });

  const usedAmount = existingAllocations.reduce((s, a) => s + Number(a.amount_applied), 0);
  const available = (existing ? Number(existing.amount) : 0) - usedAmount;

  // Drafts are editable; confirmed/void are locked. The RPC (update_payment_draft)
  // is the source of truth — it refuses anything that isn't status='draft'.
  const canEdit = isNew || existing?.status === 'draft';
  // supplierOpts removed — supplier picker uses ContactPicker (D3).
  // Phase 12.49 — label the bank picker with `b.name` (the user-facing
  // display name set in Settings → Bank Accounts), matching the sales
  // payment editor. The previous label preferred `account_number` then
  // `bank_name`, which meant an account named "Rashid" rendered as its
  // account number — confusing for the operator.
  const bankOpts = [
    { value: '', label: t('purchasing.select_bank') },
    ...bankAccounts.map(b => ({
      value: b.id,
      label: `${b.name} · ${b.account_type === 'cash' ? t('rcptOcean.cash') : t('rcptOcean.bank')}`,
    })),
  ];
  // The Select's `required` already adds the asterisk.
  const bankLabel = t('purchasing.bank_account');
  const methodOpts = [{ value: '', label: '—' }, ...paymentMethods.map(m => ({ value: m.id, label: m.name }))];
  const classOpts = [
    { value: 'against_invoice', label: t('purchasing.against_invoice') },
    { value: 'advance', label: t('purchasing.advance') },
    { value: 'on_account', label: t('purchasing.on_account') },
  ];
  // Phase 14.08b — show outstanding (what's left to pay) on each bill so the
  // operator picks based on what's actually owed, not the gross.
  const billOpts = [
    { value: '', label: t('purchasing.select_bill') },
    ...openBills.map(b => ({
      value: b.id,
      label: t('rcptOcean.inv_option', { no: b.bill_number, amount: fmt(b.outstanding) }),
    })),
  ];
  const selectedBill = openBills.find(b => b.id === applyBillId);
  const suggestedVendorApply = selectedBill ? Math.min(available, selectedBill.outstanding) : 0;

  // Phase 14.05 — view-mode renderer (Signature template).
  // Phase 14.08 — bypass when ?apply=1 so the editor hosts the modal.
  // Drafts open in the editable form (single Save posts them); only posted
  // payments show the read-only template view.
  if (viewMode && !autoApply && !isNew && existing && existing.status !== 'draft') {
    const doc = vendorPaymentToDocumentData({
      payment: existing,
      allocations: existingAllocations,
      contact: suppliers.find(s => s.id === existing.contact_id) ?? null,
      company: companyRow ?? null,
      bankAccounts,
      paymentMethods,
      invoices: allBills.map(b => ({ id: b.id, bill_number: b.bill_number, date: b.date as unknown as string, total_amount: b.total_amount })),
    });
    return (
      // Ocean Teal (UI v1.1): look only — same actions and printed voucher.
      <div className="signature-print-scope sb-ocean sb-docx" data-testid="vendor-payment-view-ocean">
        <div data-print-hide className="sb-card sb-doc-bar">
          <div className="sb-doc-bar-id">
            <BackButton to="/purchasing/payments" label={t('purchasing.vp_title')} confirm={confirmLeave} />
            <bdi dir="ltr" className="sb-doc-bar-no">{existing.payment_number}</bdi>
            <StatusBadge status={existing.status} />
          </div>
          <div className="sb-doc-bar-actions">
            {canEdit && (
              <Button variant="ghost" size="sm" onClick={() => setViewMode(false)}>
                <Pencil size={15} aria-hidden="true" /> {t('common.edit') || 'Edit'}
              </Button>
            )}
            {/* Phase 18 — a confirmed payment can be edited by reversing its
                posting and reopening it as a draft (un-reconcile first). */}
            {existing?.status === 'confirmed' && !isReconciled && (
              <Button variant="ghost" size="sm" onClick={() => setReopenModal(true)}>
                <Pencil size={15} aria-hidden="true" /> {t('common.edit') || 'Edit'}
              </Button>
            )}
            {existing?.id && (
              <Button variant="ghost" size="sm" onClick={() => window.print()}>
                <Printer size={15} aria-hidden="true" /> {t('print.print') || 'Print'}
              </Button>
            )}
          </div>
        </div>
        {error && <p className="sb-alert sb-alert-danger" role="alert">{error}</p>}
        <div className="signature-canvas sb-doc-canvas">
          <ConfigurableDocTemplate data={doc} template={printTemplate} />
        </div>
        {/* Phase 18 — confirm before reversing a posted payment for editing. */}
        <Modal open={reopenModal} onClose={() => setReopenModal(false)} title={t('purchasing.edit_payment') || 'Edit payment'}>
            <div className="sb-ocean sb-form sb-modal-form">
              <p className="text-sm text-ink-secondary">
                {t('purchasing.reopen_confirm_text') || 'Editing this payment reverses its posted journal entries and reopens it as a draft. Any bills it paid will reopen. You can change it and confirm again.'}
              </p>
              <div className="flex justify-end gap-2">
                <Button variant="ghost" size="sm" onClick={() => setReopenModal(false)}>{t('common.cancel')}</Button>
                <Button size="sm" onClick={() => { setError(null); reopenMutation.mutate(); }} disabled={reopenMutation.isPending}>
                  {reopenMutation.isPending ? '…' : (t('purchasing.reopen_to_edit') || 'Reverse & edit')}
                </Button>
              </div>
            </div>
        </Modal>
      </div>
    );
  }

  return (
    // Ocean Teal (UI v1.1): look only — same fields, allocation (FIFO
    // auto-fill), PDC, save / confirm / reopen / apply advance and previews.
    <div className="sb-ocean sb-docx sb-docx-edit" data-testid="vendor-payment-edit-ocean">
      <div className="sb-card sb-doc-bar">
        <div className="sb-doc-bar-id">
          <BackButton to="/purchasing/payments" label={t('purchasing.vp_title')} confirm={confirmLeave} />
          {isNew
            ? <h1 className="sb-doc-bar-no">{t('purchasing.new_vp')}</h1>
            : <bdi dir="ltr" className="sb-doc-bar-no">{existing?.payment_number ?? '…'}</bdi>}
          {!isNew && existing && <StatusBadge status={existing.status} />}
          {!isNew && (() => {
            const alloc = (existing as (PaymentRow & { allocation_status?: 'unallocated' | 'partial' | 'full' | null }) | null | undefined)?.allocation_status;
            if (existing?.status !== 'confirmed' || !alloc) return null;
            const map: Record<string, { key: string; tone: string }> = {
              unallocated: { key: 'alloc_advance', tone: '' },
              partial:     { key: 'alloc_partial', tone: 'sb-pill-warn' },
              full:        { key: 'alloc_full',    tone: 'sb-pill-good' },
            };
            const cfg = map[alloc];
            if (!cfg) return null;
            return <span className={`sb-pill ${cfg.tone}`} style={{ marginTop: 0 }}>{t(`salesOcean.${cfg.key}`)}</span>;
          })()}
          {!isNew && isReconciled && existing?.status === 'confirmed' && (
            <span className="sb-pill sb-pill-good" style={{ marginTop: 0 }}>{t('salesOcean.reconciled')}</span>
          )}
        </div>
        <div className="sb-doc-bar-actions">
          {!isNew && existing && existing.status !== 'draft' && (
            <Button variant="ghost" size="sm" onClick={() => setViewMode(true)}>
              <Eye size={15} aria-hidden="true" /> {t('common.view') || 'View'}
            </Button>
          )}
          <Button variant="ghost" size="sm" onClick={() => { if (confirmLeave()) navigate('/purchasing/payments'); }}>{t('common.cancel')}</Button>
          {canEdit && (
            isPdc ? (
              <Button size="sm" onClick={() => { setError(null); pdcMutation.mutate(); }} disabled={pdcMutation.isPending}>
                {pdcMutation.isPending ? '…' : (t('purchasing.confirm_as_pdc') || 'Confirm as PDC')}
              </Button>
            ) : (
              <Button size="sm" onClick={() => { setError(null); saveMutation.mutate(); }} disabled={saveMutation.isPending}>
                {saveMutation.isPending ? t('common.saving') : t('common.save')}
              </Button>
            )
          )}
          {!isNew && existing?.status === 'confirmed' && available > 0 && (
            <Button size="sm" variant="ghost" onClick={() => setApplyModal(true)}>
              {t('purchasing.apply_advance')}
            </Button>
          )}
        </div>
      </div>

      {error && <p className="sb-alert sb-alert-danger" role="alert">{error}</p>}

      {staleAllocations.length > 0 && (
        <p className="sb-alert sb-alert-warn" style={{ fontWeight: 400 }} role="status">
          <AlertTriangle size={16} aria-hidden="true" style={{ display: 'inline', verticalAlign: '-3px', marginInlineEnd: 6 }} />
          <strong>{t('rcptOcean.stale_title')}</strong>{' '}{t('vpOcean.stale_body', { count: staleAllocations.length })}
        </p>
      )}

      <Modal open={applyModal} onClose={() => setApplyModal(false)} title={t('purchasing.apply_advance')}>
          <div className="sb-ocean sb-form sb-modal-form">

            {/* Phase 14.08b — available credit + selected bill outstanding,
                 side by side so the operator can sanity-check the math
                 without leaving the modal. */}
            <div style={{
              display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 200px), 1fr))', gap: '12px',
              padding: '12px 14px',
              background: 'var(--sb-primary-soft)',
              border: '1px solid var(--sb-primary-light)',
              borderRadius: 'var(--sb-radius-md)',
            }}>
              <div>
                <div style={{ fontSize: '10.5px', fontWeight: 600, color: '#047857', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                  {t('rcptOcean.available_credit')}
                </div>
                <div style={{ marginTop: '2px', fontSize: '17px', fontWeight: 700, color: '#065f46', fontVariantNumeric: 'tabular-nums' }}>
                  {header.currency || 'AED'} {fmt(available)}
                </div>
                <div style={{ fontSize: '10.5px', color: '#059669' }}>
                  {usedAmount > 0.005
                    ? t('rcptOcean.credit_split', { payment: fmt(Number(existing?.amount ?? 0)), applied: fmt(usedAmount) })
                    : t('rcptOcean.credit_unallocated')}
                </div>
              </div>
              <div>
                <div style={{ fontSize: '10.5px', fontWeight: 600, color: '#047857', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                  {t('vpOcean.bill_outstanding')}
                </div>
                <div style={{ marginTop: '2px', fontSize: '17px', fontWeight: 700, color: selectedBill ? '#065f46' : '#94a3b8', fontVariantNumeric: 'tabular-nums' }}>
                  {selectedBill ? `${header.currency || 'AED'} ${fmt(selectedBill.outstanding)}` : '—'}
                </div>
                <div style={{ fontSize: '10.5px', color: '#059669' }}>
                  {selectedBill ? selectedBill.bill_number : t('vpOcean.pick_bill')}
                </div>
              </div>
            </div>

            <Select
              label={t('purchasing.select_bill')}
              options={billOpts}
              value={applyBillId}
              onChange={e => {
                const next = e.target.value;
                setApplyBillId(next);
                const bill = openBills.find(b => b.id === next);
                if (bill) {
                  // Auto-fill with min(available, outstanding) — what the
                  // operator would type 99% of the time.
                  setApplyAmount(Math.min(available, bill.outstanding).toFixed(2));
                } else {
                  setApplyAmount('');
                }
              }}
            />
            <div>
              <Input
                label={t('purchasing.amount')}
                type="number"
                min="0"
                max={Math.min(available, selectedBill?.outstanding ?? available).toFixed(2)}
                step="0.01"
                value={applyAmount}
                onChange={e => setApplyAmount(e.target.value)}
              />
              {selectedBill && parseFloat(applyAmount || '0') > 0 && (() => {
                const amt = parseFloat(applyAmount) || 0;
                if (amt > available + 0.005) {
                  return (
                    <p style={{ marginTop: '6px', fontSize: '11.5px', color: '#b91c1c', fontWeight: 500 }}>
                      {t('rcptOcean.over_credit', { amount: `${header.currency || 'AED'} ${fmt(available)}` })}
                    </p>
                  );
                }
                if (amt > selectedBill.outstanding + 0.005) {
                  return (
                    <p style={{ marginTop: '6px', fontSize: '11.5px', color: '#b91c1c', fontWeight: 500 }}>
                      {t('vpOcean.over_bill', { amount: `${header.currency || 'AED'} ${fmt(selectedBill.outstanding)}` })}
                    </p>
                  );
                }
                const remaining = available - amt;
                if (remaining > 0.005) {
                  return (
                    <p style={{ marginTop: '6px', fontSize: '11.5px', color: '#475569' }}>
                      {t('rcptOcean.remaining', { amount: `${header.currency || 'AED'} ${fmt(remaining)}` })}
                    </p>
                  );
                }
                return (
                  <p style={{ marginTop: '6px', fontSize: '11.5px', color: '#047857', fontWeight: 500 }}>
                    {t('rcptOcean.applying_full')}
                  </p>
                );
              })()}
              <button
                type="button"
                onClick={() => setApplyAmount(suggestedVendorApply.toFixed(2))}
                disabled={!selectedBill || suggestedVendorApply <= 0}
                style={{
                  marginTop: '6px',
                  fontSize: '11.5px',
                  fontWeight: 600,
                  color: !selectedBill || suggestedVendorApply <= 0 ? '#94a3b8' : 'var(--sb-primary-dark)',
                  background: 'transparent',
                  border: 'none',
                  cursor: !selectedBill || suggestedVendorApply <= 0 ? 'not-allowed' : 'pointer',
                  padding: 0,
                }}
              >
                {selectedBill
                  ? t('rcptOcean.use_max', { amount: `${header.currency || 'AED'} ${fmt(suggestedVendorApply)}` })
                  : t('vpOcean.pick_bill_suggest')}
              </button>
            </div>

            <div className="flex gap-2 justify-end">
              <Button variant="ghost" size="sm" onClick={() => setApplyModal(false)}>{t('common.cancel')}</Button>
              <Button
                size="sm"
                onClick={() => applyMutation.mutate()}
                disabled={
                  applyMutation.isPending ||
                  !applyBillId ||
                  !applyAmount ||
                  parseFloat(applyAmount) <= 0 ||
                  parseFloat(applyAmount) > available + 0.005 ||
                  (selectedBill && parseFloat(applyAmount) > selectedBill.outstanding + 0.005)
                }
              >
                {applyMutation.isPending ? t('common.saving') : t('common.apply')}
              </Button>
            </div>
          </div>
      </Modal>

      <div className="sb-card sb-form sb-doc-card">
        <h2 className="sb-doc-card-title">{t('purchasing.payment_details')}</h2>
        <div className="grid grid-cols-2 gap-4 md:grid-cols-3">
          <div className="col-span-2 md:col-span-1">
            <label className="mb-1 block text-sm font-medium text-ink-primary">
              {t('purchasing.supplier')} <span className="text-danger-500">*</span>
            </label>
            <ContactPicker
              type="supplier"
              value={header.contact_id}
              disabled={!canEdit}
              onChange={(id) => {
                setHeader(h => ({ ...h, contact_id: id ?? '' }));
                setApplyAmounts({});
                setDirty(true);
              }}
              placeholder={t('purchasing.select_supplier')}
              panelWidth={380}
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
              setDirty(true);
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

        {/* Phase 19 — issue this payment as a post-dated cheque. Routes to
             2450 PDC Payable (not bank) and creates a linked cheque. */}
        {canEdit && isNew && (
          <div className="sb-hw-test" style={{ marginTop: 16 }}>
            <label style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '8px', cursor: 'pointer', userSelect: 'none' }}>
              <input type="checkbox" checked={isPdc} onChange={e => setIsPdc(e.target.checked)} />
              <span className="text-sm font-semibold text-ink-primary">{t('purchasing.is_pdc') || 'Post-dated cheque (PDC)'}</span>
              <span className="text-xs text-ink-tertiary">{t('purchasing.pdc_hint') || '— money goes to PDC Payable, not the bank, until the cheque clears'}</span>
            </label>
            {isPdc && (
              <div className="mt-3 grid grid-cols-2 gap-4 md:grid-cols-3">
                <Input label={t('purchasing.cheque_number') || 'Cheque number'} required value={chequeNumber}
                  onChange={e => setChequeNumber(e.target.value)} />
                <Input label={t('purchasing.drawee_bank') || 'Drawee bank'} value={chequeBank}
                  onChange={e => setChequeBank(e.target.value)} />
                <Input label={t('purchasing.cheque_due_date') || 'Cheque due date'} type="date" required value={chequeDueDate}
                  onChange={e => setChequeDueDate(e.target.value)} />
              </div>
            )}
          </div>
        )}
      </div>

      {/* ── Apply to Bills panel ─────────────────────────────────────────
           Shown only on a NEW draft when classification is "against_invoice"
           and the chosen supplier has open bills. Auto-fills oldest-first
           when the payment Amount changes; user can override per row. */}
      {showAllocationPanel && (() => {
        const payAmt = parseFloat(header.amount) || 0;
        const difference = +(payAmt - totalToApply).toFixed(2);
        return (
          <div className="sb-card sb-doc-card sb-doc-lines">
            <div className="sb-doc-lines-head" style={{ display: 'block' }}>
              <h2 className="sb-doc-card-title" style={{ margin: 0 }}>{t('vpOcean.apply_title')}</h2>
              <p className="sb-form-hint" style={{ margin: '4px 0 0' }}>{t('vpOcean.apply_hint', { count: openBillsForPanel.length })}</p>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr>
                    <th className="px-4 py-2 text-start font-medium">{t('vpOcean.c_bill')}</th>
                    <th className="px-4 py-2 text-start font-medium">{t('rcptOcean.c_date')}</th>
                    <th className="px-4 py-2 text-end font-medium">{t('rcptOcean.c_total')}</th>
                    <th className="px-4 py-2 text-end font-medium">{t('rcptOcean.c_outstanding')}</th>
                    <th className="px-4 py-2 text-end font-medium w-32">{t('rcptOcean.c_apply')}</th>
                  </tr>
                </thead>
                <tbody>
                  {openBillsForPanel.map((bill) => {
                    const applyVal = applyAmounts[bill.id] ?? '';
                    const applyNum = parseFloat(applyVal) || 0;
                    const overApplied = applyNum > bill.outstanding + 0.005;
                    return (
                      <tr key={bill.id} className="border-b border-border-subtle last:border-0">
                        <td className="px-4 py-2 font-mono text-xs text-ink-primary"><bdi dir="ltr">{bill.bill_number}</bdi></td>
                        <td className="px-4 py-2 text-ink-secondary"><bdi dir="ltr">{bill.date as unknown as string}</bdi></td>
                        <td className="px-4 py-2 text-end font-mono text-ink-secondary">{fmt(Number(bill.total_amount))}</td>
                        <td className="px-4 py-2 text-end font-mono text-ink-primary">{fmt(bill.outstanding)}</td>
                        <td className="px-4 py-2">
                          <input
                            type="number"
                            min="0"
                            step="0.01"
                            value={applyVal}
                            placeholder="0.00"
                            dir="ltr"
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
            <div className="sb-doc-quote-total">
              <div className="sb-doc-summary-rows" style={{ marginInlineStart: 'auto', width: 'min(100%, 320px)' }}>
                <div className="flex justify-between text-ink-secondary">
                  <span>{t('rcptOcean.payment_amount')}</span>
                  <span className="font-mono">{fmt(payAmt)}</span>
                </div>
                <div className="flex justify-between text-ink-secondary">
                  <span>{t('rcptOcean.total_to_apply')}</span>
                  <span className="font-mono">{fmt(totalToApply)}</span>
                </div>
                <div className={`flex justify-between font-semibold ${
                  difference < 0 ? 'text-red-600' : difference > 0 ? 'text-amber-600' : 'text-green-700'
                }`}>
                  <span>{difference < 0 ? t('rcptOcean.over_applied') : difference > 0 ? t('rcptOcean.unallocated') : t('rcptOcean.fully_allocated')}</span>
                  <span className="font-mono">{fmt(Math.abs(difference))}</span>
                </div>
                {difference > 0 && (
                  <p className="pt-1 text-xs text-ink-tertiary">
                    {t('vpOcean.unallocated_hint')}
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
        <div className="sb-card sb-doc-card sb-doc-lines">
          <div className="sb-doc-lines-head">
            <h2 className="sb-doc-card-title" style={{ margin: 0 }}>{t('purchasing.allocations')}</h2>
          </div>
          <table className="w-full text-sm">
            <thead>
              <tr>
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
          <div className="sb-doc-quote-total justify-between text-sm text-ink-secondary">
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
