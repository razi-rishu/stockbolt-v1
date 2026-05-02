import { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { useNavigate, useParams } from 'react-router-dom';
import { getAdapter } from '@/data/index';
import { useAuthStore } from '@/store/auth';
import { Button } from '@/ui/button';
import { Input } from '@/ui/input';
import { Select } from '@/ui/select';
import { Modal } from '@/ui/modal';
import type { PaymentRow, InvoiceRow, BankAccountRow, ContactRow } from '@/data/adapter';

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
    queryKey: ['contacts', company_id],
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

  // Open invoices for advance application panel
  const [selectedContact, setSelectedContact] = useState('');
  const { data: openInvoices = [] } = useQuery<InvoiceRow[]>({
    queryKey: ['invoices_confirmed', company_id, selectedContact],
    queryFn: () => getAdapter().invoices.list(company_id!, 'confirmed'),
    enabled: !!company_id && !!selectedContact,
  });

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

  const saveMutation = useMutation({
    mutationFn: async () => {
      if (!header.contact_id) throw new Error(t('payments.error_contact_required'));
      if (!header.amount || isNaN(parseFloat(header.amount))) throw new Error(t('payments.error_amount_required'));
      const num = isNew ? await getAdapter().payments.getNextNumber(company_id!) : existing!.payment_number;
      return getAdapter().payments.create({
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
      });
    },
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ['payments', company_id] });
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

  const contactOpts = [
    { value: '', label: t('payments.select_contact') },
    ...contacts.map(c => ({ value: c.id, label: c.name })),
  ];
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

      <div className="rounded-card border border-border-subtle bg-surface-card p-5">
        <h2 className="mb-4 text-sm font-semibold text-ink-primary">{t('payments.payment_details')}</h2>
        <div className="grid grid-cols-2 gap-4 md:grid-cols-3">
          <div className="col-span-2 md:col-span-1">
            <Select
              label={t('payments.customer')}
              required
              options={contactOpts}
              value={header.contact_id}
              disabled={!canEdit || isVoid}
              onChange={e => {
                const v = e.target.value;
                setHeader(h => ({ ...h, contact_id: v }));
                setSelectedContact(v);
              }}
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
            onChange={e => setHeader(h => ({ ...h, amount: e.target.value }))}
          />
          <Select
            label={t('payments.bank_account')}
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
            onChange={e => setHeader(h => ({ ...h, classification: e.target.value as PmtHeader['classification'] }))}
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
