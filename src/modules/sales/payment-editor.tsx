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
import { Input } from '@/ui/input';
import { Select } from '@/ui/select';
import { ContactPicker } from '@/components/contact-picker';
import { Modal } from '@/ui/modal';
import { AccountingPreview, buildCustomerPaymentPreview } from '@/components/accounting-preview';
import { ActivityLog } from '@/components/activity-log';
import { theme } from '@/ui/theme';
// Phase 14.05 — Signature template view mode for saved payments.
import { ConfigurableDocTemplate } from '@/modules/print/engine/ConfigurableDocTemplate';
import { useResolvedPrintTemplate } from '@/hooks/use-resolved-print-template';
import { paymentToDocumentData } from '@/modules/print/_signature/adapters';
import '@/modules/print/_signature/print.css';
import type { PaymentRow, BankAccountRow, OpenInvoice, PaymentAllocationInsert, Company, ContactRow, PaymentMethodRow, InvoiceRow } from '@/data/adapter';

function fmt(n: number) {
  return n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

interface PmtHeader {
  contact_id: string;
  date: string;
  amount: string;
  currency: string;
  bank_account_id: string;
  classification: 'against_invoice' | 'advance' | 'on_account';
  reference: string;
  notes: string;
}

export default function PaymentEditorPage() {
  const { t } = useTranslation();
  const { company_id } = useAuthStore();
  const companyCurrency = useCompanyCurrency();   // Phase 14.14m
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const printTemplate = useResolvedPrintTemplate('payment_receipt');
  const qc = useQueryClient();
  const invalidateBooks = useInvalidateBooks();   // Phase 14.14k — TB/BS/aging/GL sweep
  const [searchParams] = useSearchParams();
  const isNew = id === 'new';
  // Phase 14.08 — deep-link from customer-detail "Apply credit" banner.
  // Auto-opens the apply-advance modal and skips the view-first template.
  const autoApply = searchParams.get('apply') === '1';
  // Deep-link from a saved invoice's "Receive Payment" CTA — pre-selects the
  // customer so the user lands ready to allocate against their open invoices.
  const seedContact = searchParams.get('contact');

  // contacts list removed — customer picker uses ContactPicker (D3).
  const { data: bankAccounts = [] } = useQuery<BankAccountRow[]>({
    queryKey: ['bankAccounts', company_id],
    queryFn: () => getAdapter().bankAccounts.list(company_id!),
    enabled: !!company_id,
  });

  const { data: existing } = useQuery<PaymentRow | null>({
    queryKey: ['payment', id],
    queryFn: () => getAdapter().payments.getById(id!),
    enabled: !isNew && !!id,
  });

  // Existing allocations — needed so drafts can be re-edited without losing
  // the previous allocation rows. Confirmed payments also show this list
  // (separate read-only section further down).
  const { data: existingAllocations = [] } = useQuery({
    queryKey: ['payment_allocations', id],
    queryFn: () => getAdapter().payments.getAllocations(id!),
    enabled: !isNew && !!id,
  });

  // Reconciled-payment IDs from Batch C — single batched query, cached
  // app-wide. Used to show a "Reconciled" badge in the header.
  const { data: reconciledIds = [] } = useQuery({
    queryKey: ['reconciled_payment_ids', company_id],
    queryFn: () => getAdapter().bankReconciliations.listReconciledPaymentIds(company_id!),
    enabled: !!company_id && !isNew,
  });
  const isReconciled = !!id && reconciledIds.includes(id);

  // Phase 14.05 — reference data for Signature template view.
  const { data: companyRow } = useQuery<Company | null>({
    queryKey: ['company', company_id],
    queryFn:  () => getAdapter().companies.getById(company_id!),
    enabled:  !!company_id,
  });
  const { data: customers = [] } = useQuery<ContactRow[]>({
    queryKey: ['contacts', company_id, 'customer'],
    queryFn:  () => getAdapter().contacts.list(company_id!, 'customer'),
    enabled:  !!company_id,
  });
  const { data: paymentMethods = [] } = useQuery<PaymentMethodRow[]>({
    queryKey: ['paymentMethods', company_id],
    queryFn: async () => {
      const { data, error } = await (await import('@/data/supabase-client')).getSupabaseClient()
        .from('payment_methods').select('*').eq('company_id', company_id!);
      if (error) throw error;
      return (data ?? []) as PaymentMethodRow[];
    },
    enabled:  !!company_id,
  });
  const { data: allInvoices = [] } = useQuery<InvoiceRow[]>({
    queryKey: ['invoices', company_id],
    queryFn:  () => getAdapter().invoices.list(company_id!),
    enabled:  !!company_id,
  });

  // Phase 14.05 — view-first mode for saved payments.
  const [viewMode, setViewMode] = useState(!isNew);

  // Open invoices (with computed outstanding) for the allocation panel and advance modal
  const [selectedContact, setSelectedContact] = useState('');
  const { data: openInvoices = [] } = useQuery<OpenInvoice[]>({
    queryKey: ['open_invoices', company_id, selectedContact],
    queryFn: () => getAdapter().invoices.listOpenForContact(company_id!, selectedContact),
    enabled: !!company_id && !!selectedContact,
  });

  // Per-invoice apply amounts entered by the user on the New Payment form.
  // Only used when classification === 'against_invoice' AND status is draft (or new).
  // Map: invoice_id -> string (raw input for editing precision).
  const [applyAmounts, setApplyAmounts] = useState<Record<string, string>>({});
  // Phase 12.23 — per-invoice post-sale discount. Settles part of the
  // invoice as Discount Allowed (6850, Indirect Expense) instead of cash.
  // SUM(amount_applied + discount_amount) per allocation = total closed
  // on that invoice. Empty string is treated as 0.
  const [discountAmounts, setDiscountAmounts] = useState<Record<string, string>>({});

  const [header, setHeader] = useState<PmtHeader>({
    contact_id: '',
    date: todayIso(),
    amount: '',
    currency: companyCurrency ?? 'AED',
    bank_account_id: '',
    classification: 'against_invoice',
    reference: '',
    notes: '',
  });
  const [applyInvId, setApplyInvId] = useState('');
  const [applyAmt, setApplyAmt] = useState('');
  const [applyModal, setApplyModal] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);
  const [deleteModal, setDeleteModal] = useState(false);
  const [voidModal, setVoidModal] = useState(false);
  const [voidReason, setVoidReason] = useState('');
  const confirmLeave = useUnsavedChangesGuard(dirty);

  // Phase 14.08 — auto-open the apply-advance modal when the user
  // arrives from the customer-detail "Apply credit" CTA. Only fires
  // once after the existing payment has loaded and is confirmed.
  useEffect(() => {
    if (autoApply && existing?.status === 'confirmed') {
      setApplyModal(true);
    }
  }, [autoApply, existing?.status]);

  // New payment opened from a saved invoice — pre-select that customer.
  useEffect(() => {
    if (isNew && seedContact) {
      setHeader(h => ({ ...h, contact_id: seedContact }));
      setSelectedContact(seedContact);
    }
  }, [isNew, seedContact]);

  useEffect(() => {
    if (existing) {
      setHeader({
        contact_id:      existing.contact_id,
        date:            existing.date as string,
        amount:          String(existing.amount),
        currency:        existing.currency,
        bank_account_id: existing.bank_account_id ?? '',
        classification:  existing.classification as PmtHeader['classification'],
        reference:       existing.reference ?? '',
        notes:           existing.notes ?? '',
      });
      setSelectedContact(existing.contact_id);
    }
  }, [existing]);

  // Pre-fill the apply panel from existing allocations on DRAFT mount.
  // For confirmed/void payments the panel is hidden, so this is a no-op
  // visually. We only do this once per draft load.
  const [appliedSeed, setAppliedSeed] = useState(false);
  useEffect(() => {
    if (!appliedSeed && existing && existing.status === 'draft' && existingAllocations.length > 0) {
      const seed: Record<string, string> = {};
      const discSeed: Record<string, string> = {};
      for (const a of existingAllocations) {
        if (a.doc_type === 'invoice') {
          seed[a.doc_id] = Number(a.amount_applied).toFixed(2);
          // Phase 12.23 — also pull any discount already saved.
          const d = Number((a as { discount_amount?: number }).discount_amount ?? 0);
          if (d > 0) discSeed[a.doc_id] = d.toFixed(2);
        }
      }
      setApplyAmounts(seed);
      setDiscountAmounts(discSeed);
      setAppliedSeed(true);
    }
  }, [existing, existingAllocations, appliedSeed]);

  // FIFO auto-fill: when the payment Amount changes (or invoices load), distribute
  // the amount across open invoices oldest-first. Skip rows the user has already
  // manually overridden in this session.
  function autoFillFIFO(amountStr: string, invoices: OpenInvoice[]) {
    const amt = parseFloat(amountStr);
    if (!isFinite(amt) || amt <= 0) {
      setApplyAmounts({});
      return;
    }
    let remaining = amt;
    const next: Record<string, string> = {};
    for (const inv of invoices) {
      if (remaining <= 0.005) break;
      const apply = Math.min(remaining, inv.outstanding);
      next[inv.id] = apply.toFixed(2);
      remaining -= apply;
    }
    setApplyAmounts(next);
  }

  // Sum of per-row apply amounts (the live "Total to apply" value in the panel).
  // This is the CASH portion that ties back to payment.amount — discount is
  // separate and lives in totalDiscount.
  const totalToApply = useMemo(() => {
    return Object.values(applyAmounts).reduce((s, v) => s + (parseFloat(v) || 0), 0);
  }, [applyAmounts]);
  // Phase 12.23 — total discount across all rows. Hits 6850 Discount Allowed
  // on confirm_payment; doesn't reduce the cash side.
  const totalDiscount = useMemo(() => {
    return Object.values(discountAmounts).reduce((s, v) => s + (parseFloat(v) || 0), 0);
  }, [discountAmounts]);

  // Panel renders for any editable payment (new or existing draft) with
  // against_invoice classification, a chosen contact, and at least one
  // open invoice. Confirmed/void payments hide the panel — they already
  // have a separate read-only allocations section.
  const isDraftLike = isNew || existing?.status === 'draft';
  const showAllocationPanel = isDraftLike
    && header.classification === 'against_invoice'
    && !!header.contact_id
    && openInvoices.length > 0;

  // Stale-allocation guard: an existing allocation may reference an
  // invoice that's no longer in the open list (e.g. it was voided after
  // the draft was saved). Surface a warning so the user knows those
  // entries will be dropped on Save.
  const staleAllocations = useMemo(() => {
    if (!isDraftLike) return [];
    const openIds = new Set(openInvoices.map(i => i.id));
    return existingAllocations.filter(a => a.doc_type === 'invoice' && !openIds.has(a.doc_id));
  }, [isDraftLike, existingAllocations, openInvoices]);

  const saveMutation = useMutation({
    mutationFn: async () => {
      if (!header.contact_id) throw new Error(t('payments.error_contact_required'));
      if (!header.amount || isNaN(parseFloat(header.amount))) throw new Error(t('payments.error_amount_required'));
      if (parseFloat(header.amount) <= 0) throw new Error('Amount must be greater than zero');
      if (!header.bank_account_id) throw new Error('Bank / cash account is required — every receipt must hit a real GL account');

      // Build allocations from the panel inputs — for both new payments
      // and existing drafts that are still in against_invoice mode.
      // Phase 12.23 — also pulls discount_amount per row. A row qualifies
      // if amount_applied + discount_amount > 0 (an allocation with only
      // a discount and no cash is still valid — write-off case).
      const allocations: PaymentAllocationInsert[] = [];
      if (isDraftLike && header.classification === 'against_invoice') {
        // Union of all invoice ids that have either an apply amount or a
        // discount amount entered. Pure-discount rows wouldn't show up if
        // we only iterated applyAmounts.
        const allKeys = new Set<string>([
          ...Object.keys(applyAmounts),
          ...Object.keys(discountAmounts),
        ]);
        for (const doc_id of allKeys) {
          const amt  = parseFloat(applyAmounts[doc_id]    ?? '') || 0;
          const disc = parseFloat(discountAmounts[doc_id] ?? '') || 0;
          if (amt <= 0 && disc <= 0) continue;
          const inv = openInvoices.find(i => i.id === doc_id);
          if (!inv) continue; // stale entry
          // Per-row over-settlement guard — apply + discount can't exceed
          // the outstanding (otherwise AR goes negative for this invoice).
          const settled = +(amt + disc).toFixed(2);
          if (settled > inv.outstanding + 0.005) {
            throw new Error(
              `Invoice ${inv.invoice_number}: applied ${amt.toFixed(2)} + discount ${disc.toFixed(2)} = ${settled.toFixed(2)} exceeds outstanding ${inv.outstanding.toFixed(2)}`,
            );
          }
          allocations.push({
            company_id:      company_id!,
            payment_id:      '', // adapter fills in the new payment id
            doc_id,
            doc_type:        'invoice',
            amount_applied:  +amt.toFixed(2),
            discount_amount: +disc.toFixed(2),
          });
        }
        // Reject if cash-applied total > payment amount (overpayment of cash)
        const totalCashApplied = allocations.reduce((s, a) => s + a.amount_applied, 0);
        const payAmt = parseFloat(header.amount);
        if (totalCashApplied > payAmt + 0.005) {
          throw new Error(`Cash applied (${totalCashApplied.toFixed(2)}) exceeds payment amount (${payAmt.toFixed(2)})`);
        }
      }

      if (isNew) {
        const num = await getAdapter().payments.getNextNumber(company_id!);
        return getAdapter().payments.create(
          {
            company_id:        company_id!,
            payment_number:    num,
            type:              'inbound',
            contact_id:        header.contact_id,
            date:              header.date,
            amount:            parseFloat(header.amount),
            currency:          header.currency,
            exchange_rate:     1,
            bank_account_id:   header.bank_account_id || null,
            reference:         header.reference || null,
            classification:    header.classification,
            status:            'draft',
            notes:             header.notes || null,
            payment_method_id: null,
            void_reason:       null,
            voided_at:         null,
            voided_by:         null,
          },
          allocations.length > 0 ? allocations : undefined,
        );
      }

      // Existing draft: update via RPC, atomically replacing allocations.
      // Allocation rules (RPC also enforces):
      //   classification = against_invoice → send the panel's allocations
      //     (may be empty — empty array means "no allocations, leftover
      //     becomes a customer advance on confirm").
      //   classification != against_invoice → send [] to clear any stale
      //     allocations from a previous against_invoice session.
      const updateAllocations =
        header.classification === 'against_invoice' ? allocations : [];
      return getAdapter().payments.update(id!, {
        contact_id:        header.contact_id,
        date:              header.date,
        amount:            parseFloat(header.amount),
        currency:          header.currency,
        bank_account_id:   header.bank_account_id || null,
        reference:         header.reference || null,
        classification:    header.classification,
        notes:             header.notes || null,
      }, updateAllocations);
    },
    onSuccess: async (data) => {
      setDirty(false);
      await invalidateBooks();
      qc.invalidateQueries({ queryKey: ['payments', company_id] });
      qc.invalidateQueries({ queryKey: ['payment', id] });
      qc.invalidateQueries({ queryKey: ['payment_allocations', id] });
      qc.invalidateQueries({ queryKey: ['open_invoices', company_id, selectedContact] });
      if (isNew && data) navigate('/sales/payments');
    },
    onError: (e: Error) => setError(e.message),
  });

  const confirmMutation = useMutation({
    mutationFn: () => getAdapter().payments.confirm(id!),
    onSuccess: async () => {
      await invalidateBooks();
      qc.invalidateQueries({ queryKey: ['payments', company_id] });
      qc.invalidateQueries({ queryKey: ['payment', id] });
    },
    onError: (e: Error) => setError(e.message),
  });

  const deleteMutation = useMutation({
    mutationFn: () => getAdapter().payments.deleteDraft(id!),
    onSuccess: async () => {
      setDeleteModal(false);
      qc.invalidateQueries({ queryKey: ['payments', company_id] });
      navigate('/sales/payments');
    },
    onError: (e: Error) => { setDeleteModal(false); setError(e.message); },
  });

  const voidMutation = useMutation({
    mutationFn: () => getAdapter().payments.void(id!, voidReason || undefined),
    onSuccess: async () => {
      setVoidModal(false);
      await invalidateBooks();
      qc.invalidateQueries({ queryKey: ['payments', company_id] });
      qc.invalidateQueries({ queryKey: ['payment', id] });
    },
    onError: (e: Error) => { setVoidModal(false); setError(e.message); },
  });

  const applyMutation = useMutation({
    mutationFn: () => getAdapter().payments.applyAdvance(id!, applyInvId, parseFloat(applyAmt)),
    onSuccess: async () => {
      setApplyModal(false);
      setApplyInvId('');
      setApplyAmt('');
      await invalidateBooks();
      qc.invalidateQueries({ queryKey: ['payment', id] });
    },
    onError: (e: Error) => { setApplyModal(false); setError(e.message); },
  });

  const status = existing?.status ?? 'draft';
  const isConfirmed = status === 'confirmed';
  const isVoid = status === 'void';
  const canEdit = isNew || status === 'draft';

  // Delete-draft + Void confirmations — shared between the view template and
  // the editor form so a receipt can be removed/reversed from either place.
  const dangerModalsEl = (
    <>
      <Modal open={deleteModal} onClose={() => setDeleteModal(false)} title={t('payments.delete_payment')}>
        <div className="space-y-4">
          <p className="text-sm text-ink-secondary">{t('payments.delete_confirm_text')}</p>
          <div className="flex justify-end gap-2">
            <Button variant="ghost" size="sm" onClick={() => setDeleteModal(false)}>{t('common.cancel')}</Button>
            <Button variant="danger" size="sm" onClick={() => deleteMutation.mutate()} disabled={deleteMutation.isPending}>
              {deleteMutation.isPending ? '…' : t('common.delete')}
            </Button>
          </div>
        </div>
      </Modal>
      <Modal open={voidModal} onClose={() => setVoidModal(false)} title={t('payments.void_payment')}>
        <div className="space-y-4">
          <p className="text-sm text-ink-secondary">{t('payments.void_confirm_text')}</p>
          <Input label={t('payments.void_reason')} value={voidReason} onChange={e => setVoidReason(e.target.value)} />
          <div className="flex justify-end gap-2">
            <Button variant="ghost" size="sm" onClick={() => setVoidModal(false)}>{t('common.cancel')}</Button>
            <Button variant="danger" size="sm" onClick={() => voidMutation.mutate()} disabled={voidMutation.isPending}>
              {voidMutation.isPending ? '…' : t('payments.void_payment')}
            </Button>
          </div>
        </div>
      </Modal>
    </>
  );

  // contactOpts removed — customer picker uses ContactPicker (D3).
  const bankOpts = [
    { value: '', label: t('payments.select_bank') },
    ...bankAccounts.map(b => ({
      value: b.id,
      label: `${b.name} · ${b.account_type === 'cash' ? 'Cash' : 'Bank'}`,
    })),
  ];
  const classOpts = [
    { value: 'against_invoice', label: t('payments.against_invoice') },
    { value: 'advance',         label: t('payments.advance') },
    { value: 'on_account',      label: t('payments.on_account') },
  ];
  // Phase 14.08b — show OUTSTANDING (what's left to pay), not gross total,
  // and skip invoices with nothing left to collect. The label flips to the
  // outstanding number so the user picks based on what's actually owed.
  const applyTargets = openInvoices
    .filter(inv => inv.contact_id === header.contact_id)
    .filter(inv => inv.outstanding > 0.005);
  const invoiceOpts = [
    { value: '', label: t('payments.select_invoice') },
    ...applyTargets.map(inv => ({
      value: inv.id,
      label: `${inv.invoice_number} — ${inv.currency} ${fmt(inv.outstanding)} outstanding`,
    })),
  ];

  // Phase 14.08b — available credit on THIS payment. This is the chunk the
  // user can still allocate from the source advance: payment.amount minus
  // everything that's already been applied to other invoices.
  const alreadyApplied = existingAllocations.reduce(
    (s, a) => s + Number((a as { amount_applied?: number }).amount_applied ?? 0),
    0,
  );
  const availableCredit = Math.max(0, Number(existing?.amount ?? 0) - alreadyApplied);
  const selectedInvoice = applyTargets.find(inv => inv.id === applyInvId);
  const suggestedApply = selectedInvoice
    ? Math.min(availableCredit, selectedInvoice.outstanding)
    : 0;

  // Sample-style status pill helper
  const pill = (text: string, bg: string, color: string, border: string) => (
    <span style={{
      display: 'inline-block', padding: '3px 9px', borderRadius: '999px',
      fontSize: '11px', fontWeight: 600, textTransform: 'capitalize',
      background: bg, color, border: `1px solid ${border}`,
    }}>{text}</span>
  );

  // Phase 14.05 — view-mode renderer (Signature template).
  // Phase 14.08 — bypass when the user landed via ?apply=1 so the editor
  // hosts the apply-advance modal immediately.
  if (viewMode && !autoApply && !isNew && existing) {
    const doc = paymentToDocumentData({
      payment: existing,
      allocations: existingAllocations,
      contact: customers.find(c => c.id === existing.contact_id) ?? null,
      company: companyRow ?? null,
      bankAccounts,
      paymentMethods,
      invoices: allInvoices.map(i => ({ id: i.id, invoice_number: i.invoice_number, date: i.date as unknown as string, total_amount: i.total_amount })),
    });
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: '16px', paddingBottom: '32px' }}>
        <div
          data-no-print="true"
          style={{ display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap' }}
        >
          <button onClick={() => { if (confirmLeave()) navigate('/sales/payments'); }} style={{
            background: 'transparent', border: 'none', cursor: 'pointer',
            fontSize: '13px', color: theme.inkMuted,
          }}>← {t('payments.title')}</button>
          <span style={{ color: theme.inkFaint }}>/</span>
          <h1 style={{ margin: 0, fontSize: '20px', fontWeight: 700, color: theme.ink, letterSpacing: '-.01em' }}>
            {existing.payment_number}
          </h1>
          <span style={{
            display: 'inline-block', padding: '3px 9px', borderRadius: '999px',
            fontSize: '11px', fontWeight: 600, textTransform: 'capitalize',
            background: '#f1f5f9', color: '#64748b', border: '1px solid #e2e8f0',
          }}>{status}</span>
          <div style={{ marginInlineStart: 'auto', display: 'flex', gap: '8px' }}>
            {canEdit && (
              <Button variant="ghost" size="sm" onClick={() => setViewMode(false)}>
                ✎ {t('common.edit') || 'Edit'}
              </Button>
            )}
            {/* Draft → Confirm posts it to the books; Delete removes the unposted draft. */}
            {status === 'draft' && (
              <Button size="sm" onClick={() => { setError(null); confirmMutation.mutate(); }} disabled={confirmMutation.isPending}>
                {confirmMutation.isPending ? '…' : t('payments.confirm_payment')}
              </Button>
            )}
            {isConfirmed && (
              <Button size="sm" onClick={() => setApplyModal(true)}>
                {t('payments.apply_advance')}
              </Button>
            )}
            {existing?.id && (
              <Button variant="ghost" size="sm" onClick={() => window.print()}>
                🖨 {t('print.print') || 'Print'}
              </Button>
            )}
            {isConfirmed && !isReconciled && (
              <Button variant="danger" size="sm" onClick={() => setVoidModal(true)}>
                {t('payments.void_payment')}
              </Button>
            )}
            {status === 'draft' && (
              <Button variant="danger" size="sm" onClick={() => setDeleteModal(true)}>
                {t('common.delete')}
              </Button>
            )}
          </div>
        </div>
        {error && (
          <div style={{
            background: theme.dangerSoft, border: `1px solid ${theme.dangerBorder}`,
            borderRadius: '8px', padding: '10px 16px', fontSize: '13px', color: theme.danger,
          }}>{error}</div>
        )}
        <div className="signature-canvas" style={{ borderRadius: '12px', overflow: 'auto' }}>
          <ConfigurableDocTemplate data={doc} template={printTemplate} />
        </div>
        {dangerModalsEl}
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '20px', paddingBottom: '64px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap' }}>
        <button onClick={() => { if (confirmLeave()) navigate('/sales/payments'); }} style={{
          background: 'transparent', border: 'none', cursor: 'pointer',
          fontSize: '13px', color: theme.inkMuted,
        }}>← {t('payments.title')}</button>
        <span style={{ color: theme.inkFaint }}>/</span>
        <h1 style={{ margin: 0, fontSize: '20px', fontWeight: 700, color: theme.ink, letterSpacing: '-.01em' }}>
          {isNew ? t('payments.new_payment') : existing?.payment_number ?? '…'}
        </h1>
        {!isNew && (
          <>
            {status === 'draft'     && pill(status, '#fffbeb', '#b45309', '#fde68a')}
            {status === 'confirmed' && pill(status, '#f0fdf4', '#15803d', '#bbf7d0')}
            {status === 'void'      && pill(status, '#fef2f2', '#dc2626', '#fecaca')}
            {(() => {
              const alloc = (existing as (PaymentRow & { allocation_status?: 'unallocated' | 'partial' | 'full' | null }) | null | undefined)?.allocation_status;
              if (status !== 'confirmed' || !alloc) return null;
              if (alloc === 'unallocated') return pill('Advance', theme.purpleSoft, theme.purple, theme.purpleBorder);
              if (alloc === 'partial')     return pill('Partial', '#fffbeb', '#b45309', '#fde68a');
              if (alloc === 'full')        return pill('Fully applied', '#eff6ff', '#1d4ed8', '#bfdbfe');
              return null;
            })()}
            {isReconciled && status === 'confirmed' && pill('Reconciled', '#ecfdf5', '#059669', '#a7f3d0')}
          </>
        )}
        <div style={{ marginInlineStart: 'auto', display: 'flex', gap: '8px' }}>
          {!isNew && existing && (
            <Button variant="ghost" size="sm" onClick={() => setViewMode(true)}>
              {t('common.view') || 'View'}
            </Button>
          )}
          {canEdit && (
            <>
              <Button variant="ghost" size="sm" onClick={() => { if (confirmLeave()) navigate('/sales/payments'); }}>
                {t('common.cancel')}
              </Button>
              <Button size="sm" onClick={() => { setError(null); saveMutation.mutate(); }} disabled={saveMutation.isPending}>
                {saveMutation.isPending ? t('common.saving') : t('common.save')}
              </Button>
            </>
          )}
          {!isNew && status === 'draft' && (
            <Button size="sm" onClick={() => { setError(null); confirmMutation.mutate(); }} disabled={confirmMutation.isPending}>
              {confirmMutation.isPending ? '…' : t('payments.confirm_payment')}
            </Button>
          )}
          {!isNew && status === 'draft' && (
            <Button variant="danger" size="sm" onClick={() => setDeleteModal(true)}>
              {t('common.delete')}
            </Button>
          )}
          {isConfirmed && (
            <Button variant="ghost" size="sm" onClick={() => setApplyModal(true)}>
              {t('payments.apply_advance')}
            </Button>
          )}
          {isConfirmed && !isReconciled && (
            <Button variant="danger" size="sm" onClick={() => setVoidModal(true)}>
              {t('payments.void_payment')}
            </Button>
          )}
        </div>
      </div>

      {error && (
        <div style={{
          background: theme.dangerSoft, border: `1px solid ${theme.dangerBorder}`,
          borderRadius: '8px', padding: '10px 16px', fontSize: '13px', color: theme.danger,
        }}>{error}</div>
      )}

      {staleAllocations.length > 0 && (
        <div style={{
          background: theme.warnSoft, border: `1px solid ${theme.warnBorder}`,
          borderRadius: '8px', padding: '10px 16px', fontSize: '13px', color: theme.warn,
        }}>
          <strong>Stale allocation{staleAllocations.length === 1 ? '' : 's'} detected.</strong>{' '}
          {staleAllocations.length} previously-allocated invoice{staleAllocations.length === 1 ? ' is' : 's are'} no
          longer in the open list (likely voided or fully paid by another payment). They will be dropped on Save.
        </div>
      )}

      <div style={{
        background: theme.card, border: `1px solid ${theme.border}`,
        borderRadius: '12px', boxShadow: theme.shadowSm, padding: '20px',
      }}>
        <h2 className="mb-4 text-sm font-semibold text-ink-primary">{t('payments.payment_details')}</h2>
        <div className="grid grid-cols-2 gap-4 md:grid-cols-3">
          <div className="col-span-2 md:col-span-1">
            <label className="mb-1 block text-sm font-medium text-ink-primary">
              {t('payments.customer')} <span className="text-danger-500">*</span>
            </label>
            <ContactPicker
              type="customer"
              value={header.contact_id}
              disabled={!canEdit || isVoid}
              onChange={(id) => {
                const v = id ?? '';
                setHeader(h => ({ ...h, contact_id: v }));
                setSelectedContact(v);
                setApplyAmounts({});
                setDiscountAmounts({});
                setDirty(true);
              }}
              placeholder={t('payments.select_contact')}
              panelWidth={380}
            />
          </div>
          <Input
            label={t('payments.date')}
            type="date"
            required
            value={header.date}
            disabled={!canEdit || isVoid}
            onChange={e => setHeader(h => ({ ...h, date: e.target.value }))}
          />
          <Input
            label={t('payments.amount')}
            type="number"
            min="0"
            step="0.01"
            required
            value={header.amount}
            disabled={!canEdit || isVoid}
            onChange={e => {
              const v = e.target.value;
              setHeader(h => ({ ...h, amount: v }));
              setDirty(true);
              // FIFO auto-fill — only when allocation panel is shown.
              // We re-read showAllocationPanel based on the OUTGOING state
              // (classification + contact + open invoices length already known).
              if (isNew && header.classification === 'against_invoice' && header.contact_id) {
                autoFillFIFO(v, openInvoices);
              }
            }}
          />
          <div>
            <Select
              label={t('payments.bank_account')}
              required
              options={bankOpts}
              value={header.bank_account_id}
              disabled={!canEdit || isVoid}
              onChange={e => setHeader(h => ({ ...h, bank_account_id: e.target.value }))}
            />
            {/* Phase 14.13h — empty-state hint for brand-new tenants.
                 Since onboarding no longer creates a first bank account,
                 a fresh company will have an empty picker. Tell the
                 operator exactly where to set one up. */}
            {canEdit && !isVoid && bankAccounts.length === 0 && (
              <p className="mt-1 text-xs text-ink-tertiary">
                No bank or cash accounts yet. Add one in{' '}
                <a href="/settings/bank-accounts" className="text-brand-600 underline">
                  Settings → Bank Accounts
                </a>{' '}
                — set <span className="font-medium">Type = Cash</span> for cash transactions.
              </p>
            )}
          </div>
          <Select
            label={t('payments.classification')}
            required
            options={classOpts}
            value={header.classification}
            disabled={!canEdit || isVoid}
            onChange={e => {
              const v = e.target.value as PmtHeader['classification'];
              setHeader(h => ({ ...h, classification: v }));
              // Switching away from against_invoice clears any pending allocations
              if (v !== 'against_invoice') { setApplyAmounts({}); setDiscountAmounts({}); }
              else if (header.amount) autoFillFIFO(header.amount, openInvoices);
            }}
          />
          <Input
            label={t('payments.reference')}
            value={header.reference}
            disabled={!canEdit || isVoid}
            onChange={e => setHeader(h => ({ ...h, reference: e.target.value }))}
          />
        </div>
        <div className="mt-3">
          <Input
            label={t('payments.notes')}
            value={header.notes}
            disabled={!canEdit || isVoid}
            onChange={e => setHeader(h => ({ ...h, notes: e.target.value }))}
          />
        </div>
      </div>

      {/* ── Apply to Invoices panel ─────────────────────────────────────────
           Shown only on a NEW draft when classification is "against_invoice"
           and the chosen customer has open invoices. Auto-fills oldest-first
           when the payment Amount changes; user can override per row. */}
      {showAllocationPanel && (() => {
        const payAmt    = parseFloat(header.amount) || 0;
        const difference = +(payAmt - totalToApply).toFixed(2);
        return (
          <div style={{
            background: theme.card, border: `1px solid ${theme.border}`,
            borderRadius: '12px', boxShadow: theme.shadowSm, overflow: 'hidden',
          }}>
            <div style={{ background: theme.panelHead, borderBottom: `1px solid ${theme.border}`, padding: '10px 20px' }}>
              <h2 style={{
                margin: 0,
                fontSize: '11px', fontWeight: 700, color: theme.inkMuted,
                textTransform: 'uppercase', letterSpacing: '.06em',
              }}>Apply to Invoices</h2>
              <p style={{ margin: '4px 0 0', fontSize: '11px', color: theme.inkFaint }}>
                Distribute the payment across {openInvoices.length} open invoice{openInvoices.length === 1 ? '' : 's'}. Oldest first by default — edit any row to override.
              </p>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr style={{ background: theme.panelHead, borderBottom: `1px solid ${theme.border}` }}>
                    {[
                      { l: 'Invoice #',   a: 'start' as const, w: undefined as string | undefined },
                      { l: 'Date',        a: 'start' as const, w: undefined },
                      { l: 'Total',       a: 'end'   as const, w: undefined },
                      { l: 'Outstanding', a: 'end'   as const, w: undefined },
                      { l: 'Apply',       a: 'end'   as const, w: '112px' },
                      { l: 'Discount',    a: 'end'   as const, w: '112px' },
                    ].map(c => (
                      <th key={c.l} className="px-4 py-3" style={{
                        fontSize: '11px', fontWeight: 600, color: theme.inkMuted,
                        textTransform: 'uppercase', letterSpacing: '.06em',
                        textAlign: c.a, width: c.w, whiteSpace: 'nowrap',
                      }}>{c.l}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {openInvoices.map((inv) => {
                    const applyVal    = applyAmounts[inv.id]    ?? '';
                    const discountVal = discountAmounts[inv.id] ?? '';
                    const applyNum    = parseFloat(applyVal)    || 0;
                    const discountNum = parseFloat(discountVal) || 0;
                    // Over-settlement = cash applied + discount > outstanding.
                    // Either column alone or the sum exceeding the outstanding
                    // triggers the red highlight.
                    const overSettled = (applyNum + discountNum) > inv.outstanding + 0.005;
                    return (
                      <tr key={inv.id} className="border-b border-border-subtle last:border-0">
                        <td className="px-4 py-2 font-mono text-xs text-ink-primary">{inv.invoice_number}</td>
                        <td className="px-4 py-2 text-ink-secondary">{inv.date as unknown as string}</td>
                        <td className="px-4 py-2 text-end font-mono text-ink-secondary">{fmt(Number(inv.total_amount))}</td>
                        <td className="px-4 py-2 text-end font-mono text-ink-primary">{fmt(inv.outstanding)}</td>
                        <td className="px-4 py-2">
                          <input
                            type="number"
                            min="0"
                            step="0.01"
                            value={applyVal}
                            placeholder="0.00"
                            className={`w-full rounded border bg-surface-subtle px-2 py-1 text-end text-xs ${overSettled ? 'border-red-400 text-red-700' : 'border-border-strong text-ink-primary'}`}
                            onChange={(e) => setApplyAmounts(prev => ({ ...prev, [inv.id]: e.target.value }))}
                          />
                        </td>
                        <td className="px-4 py-2">
                          <input
                            type="number"
                            min="0"
                            step="0.01"
                            value={discountVal}
                            placeholder="0.00"
                            title="Cash discount given on this invoice. Hits 6850 Discount Allowed."
                            className={`w-full rounded border bg-surface-subtle px-2 py-1 text-end text-xs ${overSettled ? 'border-red-400 text-red-700' : 'border-border-strong text-ink-primary'}`}
                            onChange={(e) => setDiscountAmounts(prev => ({ ...prev, [inv.id]: e.target.value }))}
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
                {totalDiscount > 0 && (
                  <div className="flex justify-between text-ink-secondary">
                    <span title="Hits 6850 Discount Allowed (Indirect Expense)">
                      Total discount given
                    </span>
                    <span className="font-mono">{fmt(totalDiscount)}</span>
                  </div>
                )}
                <div className={`flex justify-between font-semibold ${
                  difference < 0 ? 'text-red-600' : difference > 0 ? 'text-amber-600' : 'text-green-700'
                }`}>
                  <span>{difference < 0 ? 'Over-applied' : difference > 0 ? 'Unallocated (advance)' : 'Fully allocated'}</span>
                  <span className="font-mono">{fmt(Math.abs(difference))}</span>
                </div>
                {difference > 0 && (
                  <p className="pt-1 text-xs text-ink-tertiary">
                    The unallocated portion will sit as a customer advance and can be applied to future invoices.
                  </p>
                )}
                {totalDiscount > 0 && (
                  <p className="pt-1 text-xs text-ink-tertiary">
                    The discount portion will hit Indirect Expenses (6850 Discount Allowed) on confirm.
                  </p>
                )}
              </div>
            </div>
          </div>
        );
      })()}

      {/* Accounting preview — shown for drafts (and new) so the user
           can sanity-check the JE before clicking Confirm. Lives outside
           the allocation panel so it shows even for advance/on_account. */}
      {isDraftLike && parseFloat(header.amount) > 0 && (() => {
        const bank = bankAccounts.find(b => b.id === header.bank_account_id);
        const lines = buildCustomerPaymentPreview({
          amount:             parseFloat(header.amount) || 0,
          classification:     header.classification,
          bank_account_name:  bank?.name,
          allocated_total:    totalToApply,
          payment_number:     existing?.payment_number,
        });
        return <AccountingPreview lines={lines} currency={header.currency || 'AED'} />;
      })()}

      {dangerModalsEl}

      {/* Apply advance modal — Phase 14.08b: shows the available credit on
           this payment, the outstanding on the chosen invoice, and pre-fills
           the amount field with min(available, outstanding) so the operator
           almost never has to type. */}
      <Modal open={applyModal} onClose={() => setApplyModal(false)} title={t('payments.apply_advance')}>
        <div className="space-y-4">
          {/* Available credit panel — the missing context the user needed. */}
          <div style={{
            display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 200px), 1fr))', gap: '12px',
            padding: '12px 14px',
            background: '#ecfdf5',
            border: '1px solid #a7f3d0',
            borderRadius: '10px',
          }}>
            <div>
              <div style={{ fontSize: '10.5px', fontWeight: 600, color: '#047857', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                Available credit
              </div>
              <div style={{ marginTop: '2px', fontSize: '17px', fontWeight: 700, color: '#065f46', fontVariantNumeric: 'tabular-nums' }}>
                {header.currency || 'AED'} {fmt(availableCredit)}
              </div>
              <div style={{ fontSize: '10.5px', color: '#059669' }}>
                {alreadyApplied > 0.005
                  ? `payment ${fmt(Number(existing?.amount ?? 0))} · already applied ${fmt(alreadyApplied)}`
                  : 'unallocated portion of this payment'}
              </div>
            </div>
            <div>
              <div style={{ fontSize: '10.5px', fontWeight: 600, color: '#047857', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                Invoice outstanding
              </div>
              <div style={{ marginTop: '2px', fontSize: '17px', fontWeight: 700, color: selectedInvoice ? '#065f46' : '#94a3b8', fontVariantNumeric: 'tabular-nums' }}>
                {selectedInvoice
                  ? `${selectedInvoice.currency} ${fmt(selectedInvoice.outstanding)}`
                  : '—'}
              </div>
              <div style={{ fontSize: '10.5px', color: '#059669' }}>
                {selectedInvoice ? selectedInvoice.invoice_number : 'pick an invoice below'}
              </div>
            </div>
          </div>

          <Select
            label={t('payments.invoice')}
            options={invoiceOpts}
            value={applyInvId}
            onChange={e => {
              const next = e.target.value;
              setApplyInvId(next);
              // Phase 14.08b — auto-fill the amount with whichever is
              // smaller: available credit or invoice outstanding. Saves the
              // operator from mental arithmetic and is what they'd type 99%
              // of the time.
              const inv = applyTargets.find(i => i.id === next);
              if (inv) {
                setApplyAmt(Math.min(availableCredit, inv.outstanding).toFixed(2));
              } else {
                setApplyAmt('');
              }
            }}
          />
          <div>
            <Input
              label={t('payments.apply_amount')}
              type="number"
              min="0"
              max={Math.min(availableCredit, selectedInvoice?.outstanding ?? availableCredit).toFixed(2)}
              step="0.01"
              value={applyAmt}
              onChange={e => setApplyAmt(e.target.value)}
            />
            {selectedInvoice && parseFloat(applyAmt || '0') > 0 && (() => {
              const amt = parseFloat(applyAmt) || 0;
              const overCredit = amt > availableCredit + 0.005;
              const overInvoice = amt > selectedInvoice.outstanding + 0.005;
              if (overCredit) {
                return (
                  <p style={{ marginTop: '6px', fontSize: '11.5px', color: '#b91c1c', fontWeight: 500 }}>
                    Cannot apply more than the available credit ({header.currency || 'AED'} {fmt(availableCredit)}).
                  </p>
                );
              }
              if (overInvoice) {
                return (
                  <p style={{ marginTop: '6px', fontSize: '11.5px', color: '#b91c1c', fontWeight: 500 }}>
                    Cannot apply more than the invoice outstanding ({selectedInvoice.currency} {fmt(selectedInvoice.outstanding)}).
                  </p>
                );
              }
              const remaining = availableCredit - amt;
              if (remaining > 0.005) {
                return (
                  <p style={{ marginTop: '6px', fontSize: '11.5px', color: '#475569' }}>
                    {header.currency || 'AED'} {fmt(remaining)} will remain as credit on this payment.
                  </p>
                );
              }
              return (
                <p style={{ marginTop: '6px', fontSize: '11.5px', color: '#047857', fontWeight: 500 }}>
                  Applying the full available credit. Payment will be fully allocated.
                </p>
              );
            })()}
            <button
              type="button"
              onClick={() => setApplyAmt(suggestedApply.toFixed(2))}
              disabled={!selectedInvoice || suggestedApply <= 0}
              style={{
                marginTop: '6px',
                fontSize: '11.5px',
                fontWeight: 600,
                color: !selectedInvoice || suggestedApply <= 0 ? '#94a3b8' : '#7c3aed',
                background: 'transparent',
                border: 'none',
                cursor: !selectedInvoice || suggestedApply <= 0 ? 'not-allowed' : 'pointer',
                padding: 0,
              }}
            >
              {selectedInvoice
                ? `Use ${header.currency || 'AED'} ${fmt(suggestedApply)} (apply the maximum)`
                : 'Pick an invoice to enable the suggested amount'}
            </button>
          </div>
          <div className="flex justify-end gap-2">
            <Button variant="ghost" size="sm" onClick={() => setApplyModal(false)}>
              {t('common.cancel')}
            </Button>
            <Button
              size="sm"
              disabled={
                !applyInvId ||
                !applyAmt ||
                parseFloat(applyAmt) <= 0 ||
                parseFloat(applyAmt) > availableCredit + 0.005 ||
                (selectedInvoice && parseFloat(applyAmt) > selectedInvoice.outstanding + 0.005) ||
                applyMutation.isPending
              }
              onClick={() => applyMutation.mutate()}
            >
              {applyMutation.isPending ? '…' : t('payments.apply')}
            </Button>
          </div>
        </div>
      </Modal>

      {/* Activity log — every confirm/void writes an audit_logs row.
           Hidden for new payments (nothing to show yet). */}
      {!isNew && id && <ActivityLog entityType="payment" entityId={id} />}
    </div>
  );
}
