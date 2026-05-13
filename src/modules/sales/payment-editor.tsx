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
import { Modal } from '@/ui/modal';
import type { PaymentRow, BankAccountRow, ContactRow, OpenInvoice, PaymentAllocationInsert } from '@/data/adapter';

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
  const companyCurrency = 'AED';
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const isNew = id === 'new';

  const { data: contacts = [] } = useQuery<ContactRow[]>({
    queryKey: ['contacts', company_id, 'customer'],
    queryFn: () => getAdapter().contacts.list(company_id!, 'customer'),
    enabled: !!company_id,
  });
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
      for (const a of existingAllocations) {
        if (a.doc_type === 'invoice') {
          seed[a.doc_id] = Number(a.amount_applied).toFixed(2);
        }
      }
      setApplyAmounts(seed);
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

  // Sum of per-row apply amounts (the live "Total to apply" value in the panel)
  const totalToApply = useMemo(() => {
    return Object.values(applyAmounts).reduce((s, v) => s + (parseFloat(v) || 0), 0);
  }, [applyAmounts]);

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
      const allocations: PaymentAllocationInsert[] = [];
      if (isDraftLike && header.classification === 'against_invoice') {
        for (const [doc_id, raw] of Object.entries(applyAmounts)) {
          const amt = parseFloat(raw);
          if (isFinite(amt) && amt > 0) {
            // Per-row over-allocation guard — cannot apply more than the
            // invoice's current outstanding (would drive the invoice to a
            // negative outstanding and break AR aging + customer balance).
            const inv = openInvoices.find(i => i.id === doc_id);
            // Drop stale entries — applyAmounts can hold keys for invoices
            // that aren't in the open list anymore (voided, fully paid by
            // another payment, etc). The amber banner warns about this.
            if (!inv) continue;
            if (amt > inv.outstanding + 0.005) {
              throw new Error(
                `Invoice ${inv.invoice_number}: applied ${amt.toFixed(2)} exceeds outstanding ${inv.outstanding.toFixed(2)}`,
              );
            }
            allocations.push({
              company_id:     company_id!,
              payment_id:     '', // adapter fills in the new payment id
              doc_id,
              doc_type:       'invoice',
              amount_applied: +amt.toFixed(2),
            });
          }
        }
        // Reject if total allocations > payment amount (overpayment)
        const totalAlloc = allocations.reduce((s, a) => s + a.amount_applied, 0);
        const payAmt = parseFloat(header.amount);
        if (totalAlloc > payAmt + 0.005) {
          throw new Error(`Allocations (${totalAlloc.toFixed(2)}) exceed payment amount (${payAmt.toFixed(2)})`);
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
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ['payments', company_id] });
      qc.invalidateQueries({ queryKey: ['payment', id] });
      qc.invalidateQueries({ queryKey: ['payment_allocations', id] });
      qc.invalidateQueries({ queryKey: ['open_invoices', company_id, selectedContact] });
      if (isNew && data) navigate(`/sales/payments/${data.id}`);
    },
    onError: (e: Error) => setError(e.message),
  });

  const confirmMutation = useMutation({
    mutationFn: () => getAdapter().payments.confirm(id!),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['payments', company_id] });
      qc.invalidateQueries({ queryKey: ['payment', id] });
    },
    onError: (e: Error) => setError(e.message),
  });

  const applyMutation = useMutation({
    mutationFn: () => getAdapter().payments.applyAdvance(id!, applyInvId, parseFloat(applyAmt)),
    onSuccess: () => {
      setApplyModal(false);
      setApplyInvId('');
      setApplyAmt('');
      qc.invalidateQueries({ queryKey: ['payment', id] });
    },
    onError: (e: Error) => { setApplyModal(false); setError(e.message); },
  });

  const status = existing?.status ?? 'draft';
  const isConfirmed = status === 'confirmed';
  const isVoid = status === 'void';
  const canEdit = isNew || status === 'draft';

  const contactOpts = contacts.map(c => ({ value: c.id, label: c.name }));
  const bankOpts = [
    { value: '', label: t('payments.select_bank') },
    ...bankAccounts.map(b => ({ value: b.id, label: b.name })),
  ];
  const classOpts = [
    { value: 'against_invoice', label: t('payments.against_invoice') },
    { value: 'advance',         label: t('payments.advance') },
    { value: 'on_account',      label: t('payments.on_account') },
  ];
  const invoiceOpts = [
    { value: '', label: t('payments.select_invoice') },
    ...openInvoices
      .filter(inv => inv.contact_id === header.contact_id)
      .map(inv => ({ value: inv.id, label: `${inv.invoice_number} — ${inv.currency} ${fmt(Number(inv.total_amount))}` })),
  ];

  return (
    <div className="space-y-6 pb-16">
      <div className="flex items-center gap-3">
        <button onClick={() => navigate('/sales/payments')} className="text-sm text-ink-secondary hover:text-ink-primary">
          ← {t('payments.title')}
        </button>
        <span className="text-ink-tertiary">/</span>
        <h1 className="text-xl font-semibold text-ink-primary">
          {isNew ? t('payments.new_payment') : existing?.payment_number ?? '…'}
        </h1>
        {!isNew && (
          <span className={`rounded-pill px-2.5 py-0.5 text-xs font-medium capitalize ${
            status === 'draft' ? 'bg-yellow-50 text-yellow-700' :
            status === 'confirmed' ? 'bg-green-50 text-green-700' :
            'bg-red-50 text-red-600'
          }`}>
            {status}
          </span>
        )}
        <div className="ms-auto flex gap-2">
          {canEdit && (
            <>
              <Button variant="ghost" size="sm" onClick={() => navigate('/sales/payments')}>
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
          {isConfirmed && (
            <Button variant="ghost" size="sm" onClick={() => setApplyModal(true)}>
              {t('payments.apply_advance')}
            </Button>
          )}
        </div>
      </div>

      {error && (
        <div className="rounded-input bg-red-50 px-4 py-2 text-sm text-red-700">{error}</div>
      )}

      {staleAllocations.length > 0 && (
        <div className="rounded-input bg-amber-50 px-4 py-2 text-sm text-amber-800">
          <strong>Stale allocation{staleAllocations.length === 1 ? '' : 's'} detected.</strong>{' '}
          {staleAllocations.length} previously-allocated invoice{staleAllocations.length === 1 ? ' is' : 's are'} no
          longer in the open list (likely voided or fully paid by another payment). They will be dropped on Save.
        </div>
      )}

      <div className="rounded-card border border-border-subtle bg-surface-card p-5">
        <h2 className="mb-4 text-sm font-semibold text-ink-primary">{t('payments.payment_details')}</h2>
        <div className="grid grid-cols-2 gap-4 md:grid-cols-3">
          <div className="col-span-2 md:col-span-1">
            <label className="mb-1 block text-sm font-medium text-ink-primary">
              {t('payments.customer')} <span className="text-danger-500">*</span>
            </label>
            <SearchableSelect
              options={contactOpts}
              value={header.contact_id}
              disabled={!canEdit || isVoid}
              onChange={(v) => {
                setHeader(h => ({ ...h, contact_id: v }));
                setSelectedContact(v);
                setApplyAmounts({}); // open invoice list will refetch; reset apply
              }}
              placeholder={t('payments.select_contact')}
              panelWidth={320}
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
              // FIFO auto-fill — only when allocation panel is shown.
              // We re-read showAllocationPanel based on the OUTGOING state
              // (classification + contact + open invoices length already known).
              if (isNew && header.classification === 'against_invoice' && header.contact_id) {
                autoFillFIFO(v, openInvoices);
              }
            }}
          />
          <Select
            label={`${t('payments.bank_account')} *`}
            required
            options={bankOpts}
            value={header.bank_account_id}
            disabled={!canEdit || isVoid}
            onChange={e => setHeader(h => ({ ...h, bank_account_id: e.target.value }))}
          />
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
              if (v !== 'against_invoice') setApplyAmounts({});
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
          <div className="rounded-card border border-border-subtle bg-surface-card">
            <div className="border-b border-border-subtle px-5 py-3">
              <h2 className="text-sm font-semibold text-ink-primary">Apply to Invoices</h2>
              <p className="mt-0.5 text-xs text-ink-tertiary">
                Distribute the payment across {openInvoices.length} open invoice{openInvoices.length === 1 ? '' : 's'}. Oldest first by default — edit any row to override.
              </p>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border-subtle bg-surface-muted text-xs text-ink-tertiary">
                    <th className="px-4 py-2 text-start font-medium">Invoice #</th>
                    <th className="px-4 py-2 text-start font-medium">Date</th>
                    <th className="px-4 py-2 text-end font-medium">Total</th>
                    <th className="px-4 py-2 text-end font-medium">Outstanding</th>
                    <th className="px-4 py-2 text-end font-medium w-32">Apply</th>
                  </tr>
                </thead>
                <tbody>
                  {openInvoices.map((inv) => {
                    const applyVal = applyAmounts[inv.id] ?? '';
                    const applyNum = parseFloat(applyVal) || 0;
                    const overApplied = applyNum > inv.outstanding + 0.005;
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
                            className={`w-full rounded border bg-surface-subtle px-2 py-1 text-end text-xs ${overApplied ? 'border-red-400 text-red-700' : 'border-border-strong text-ink-primary'}`}
                            onChange={(e) => setApplyAmounts(prev => ({ ...prev, [inv.id]: e.target.value }))}
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
                    The unallocated portion will sit as a customer advance and can be applied to future invoices.
                  </p>
                )}
              </div>
            </div>
          </div>
        );
      })()}

      {/* Apply advance modal */}
      <Modal open={applyModal} onClose={() => setApplyModal(false)} title={t('payments.apply_advance')}>
        <div className="space-y-4">
          <Select
            label={t('payments.invoice')}
            options={invoiceOpts}
            value={applyInvId}
            onChange={e => setApplyInvId(e.target.value)}
          />
          <Input
            label={t('payments.apply_amount')}
            type="number"
            min="0"
            step="0.01"
            value={applyAmt}
            onChange={e => setApplyAmt(e.target.value)}
          />
          <div className="flex justify-end gap-2">
            <Button variant="ghost" size="sm" onClick={() => setApplyModal(false)}>
              {t('common.cancel')}
            </Button>
            <Button
              size="sm"
              disabled={!applyInvId || !applyAmt || applyMutation.isPending}
              onClick={() => applyMutation.mutate()}
            >
              {applyMutation.isPending ? '…' : t('payments.apply')}
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
