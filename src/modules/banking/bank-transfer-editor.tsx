import { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { getAdapter } from '@/data/index';
import { useAuthStore } from '@/store/auth';
import { useInvalidateBooks } from '@/hooks/use-invalidate-books';
import { Input } from '@/ui/input';
import { Button } from '@/ui/button';
import { BackButton } from '@/ui/back-button';
import { StatusBadge } from '@/ui/status-badge';
import { ArrowRight, Ban, CircleCheck, Pencil } from 'lucide-react';
import type { BankAccountRow, BankTransferRow } from '@/data/adapter';

const fmt = (n: number) => n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export default function BankTransferEditorPage() {
  const { t } = useTranslation();
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const invalidateBooks = useInvalidateBooks();   // Phase 14.14k
  const { company_id } = useAuthStore();
  const isNew = !id || id === 'new';

  const today = new Date().toISOString().slice(0, 10);

  const [fromAccountId, setFromAccountId] = useState('');
  const [toAccountId, setToAccountId]     = useState('');
  const [amount, setAmount]               = useState('');
  const [date, setDate]                   = useState(today);
  const [reference, setReference]         = useState('');
  const [notes, setNotes]                 = useState('');
  const [error, setError]                 = useState<string | null>(null);

  const { data: bankAccounts = [] } = useQuery<BankAccountRow[]>({
    queryKey: ['bank_accounts', company_id],
    queryFn:  () => getAdapter().bankAccounts.list(company_id!),
    enabled:  !!company_id,
  });

  const { data: transfer } = useQuery<BankTransferRow>({
    queryKey: ['bank_transfer', id],
    queryFn:  () => getAdapter().bankTransfers.getById(id!),
    enabled:  !!id && !isNew,
  });

  useEffect(() => {
    if (transfer) {
      setFromAccountId(transfer.from_account_id);
      setToAccountId(transfer.to_account_id);
      setAmount(String(transfer.amount));
      setDate(transfer.date);
      setReference(transfer.reference ?? '');
      setNotes(transfer.notes ?? '');
    }
  }, [transfer]);

  const { data: nextNumber } = useQuery<string>({
    queryKey: ['next_number', 'TRF', company_id],
    queryFn:  () => getAdapter().bankTransfers.getNextNumber(company_id!),
    enabled:  !!company_id && isNew,
  });

  const saveMutation = useMutation({
    mutationFn: async () => {
      if (!fromAccountId || !toAccountId || !amount || fromAccountId === toAccountId) {
        throw new Error(t('banking.error_transfer_invalid'));
      }
      const amt = parseFloat(amount);
      if (!isFinite(amt) || amt <= 0) {
        throw new Error(t('btOcean.amount_positive'));
      }
      const payload = {
        company_id:      company_id!,
        transfer_number: nextNumber ?? 'TRF-DRAFT',
        from_account_id: fromAccountId,
        to_account_id:   toAccountId,
        amount:          parseFloat(amount),
        date,
        reference:       reference || null,
        notes:           notes || null,
        status:          'draft' as const,
      };
      if (isNew) return getAdapter().bankTransfers.create(payload);
      return getAdapter().bankTransfers.update(id!, { from_account_id: fromAccountId, to_account_id: toAccountId, amount: parseFloat(amount), date, reference: reference || null, notes: notes || null });
    },
    onSuccess: async () => {
      await invalidateBooks();
      qc.invalidateQueries({ queryKey: ['bank_transfers'] });
      navigate('/banking/transfers');
    },
    onError: (e: Error) => setError(e.message),
  });

  const confirmMutation = useMutation({
    mutationFn: () => getAdapter().bankTransfers.confirm(id!),
    onSuccess: async () => {
      await invalidateBooks();
      qc.invalidateQueries({ queryKey: ['bank_transfer', id] });
      qc.invalidateQueries({ queryKey: ['bank_transfers'] });
    },
    onError: (e: Error) => setError(e.message),
  });

  const voidMutation = useMutation({
    mutationFn: () => getAdapter().bankTransfers.void(id!),
    onSuccess: async () => {
      await invalidateBooks();
      qc.invalidateQueries({ queryKey: ['bank_transfer', id] });
      qc.invalidateQueries({ queryKey: ['bank_transfers'] });
    },
    onError: (e: Error) => setError(e.message),
  });

  // Phase 39 — Edit a CONFIRMED transfer: reverse the posting + reopen as a draft.
  const reopenMutation = useMutation({
    mutationFn: () => getAdapter().bankTransfers.reopen(id!),
    onSuccess: async () => {
      await invalidateBooks();
      qc.invalidateQueries({ queryKey: ['bank_transfer', id] });
      qc.invalidateQueries({ queryKey: ['bank_transfers'] });
    },
    onError: (e: Error) => setError(e.message),
  });

  const isDraft = !transfer || transfer.status === 'draft';
  const isConfirmed = transfer?.status === 'confirmed';
  const accountOpts = bankAccounts.map(a => ({ value: a.id, label: a.name }));

  return (
    // Ocean Teal (UI v1.1): look only — same fields, save, confirm, edit and void.
    <div className="sb-ocean sb-docx sb-docx-edit sb-bt-editor" data-testid="bank-transfer-edit-ocean">
      <div className="sb-card sb-doc-bar">
        <div className="sb-doc-bar-id">
          <BackButton to="/banking/transfers" label={t('banking.transfers_title')} />
          {isNew
            ? <h1 className="sb-doc-bar-no">{t('banking.new_transfer')}</h1>
            : <bdi dir="ltr" className="sb-doc-bar-no">{transfer?.transfer_number ?? t('banking.new_transfer')}</bdi>}
          {transfer && <StatusBadge status={transfer.status} />}
        </div>
        <div className="sb-doc-bar-actions">
          {isDraft && (
            <>
              <Button size="sm" disabled={saveMutation.isPending} onClick={() => saveMutation.mutate()}>
                {t('common.save')}
              </Button>
              {!isNew && (
                <Button size="sm" variant="primary" disabled={confirmMutation.isPending || !fromAccountId || !toAccountId}
                  onClick={() => { setError(null); confirmMutation.mutate(); }}>
                  <CircleCheck size={15} aria-hidden="true" /> {t('banking.confirm_transfer')}
                </Button>
              )}
            </>
          )}
          {isConfirmed && (
            <>
              <Button size="sm" variant="ghost" disabled={reopenMutation.isPending}
                onClick={() => { if (confirm(t('common.reopen_warn') || 'Edit this confirmed document? It reverses its posted entries and reopens it as a draft so you can change it and confirm again.')) { setError(null); reopenMutation.mutate(); } }}>
                <Pencil size={15} aria-hidden="true" /> {t('common.edit') || 'Edit'}
              </Button>
              <Button size="sm" variant="ghost" style={{ color: 'var(--sb-danger)' }}
                disabled={voidMutation.isPending}
                onClick={() => { if (confirm(t('banking.void_confirm_text'))) { setError(null); voidMutation.mutate(); } }}>
                <Ban size={15} aria-hidden="true" /> {t('banking.void_transfer')}
              </Button>
            </>
          )}
        </div>
      </div>

      {error && <p className="sb-alert sb-alert-danger" role="alert">{error}</p>}

      {/* Confirmed summary */}
      {isConfirmed && (
        <div className="sb-alert sb-alert-good" style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <CircleCheck size={18} aria-hidden="true" style={{ flexShrink: 0 }} />
          <span>
            {t('banking.transfer_confirmed')} · {t('banking.amount')}: <bdi dir="ltr">{fmt(transfer.amount)}</bdi>
          </span>
        </div>
      )}

      <div className="sb-card sb-form sb-doc-card space-y-4">
        <h2 className="sb-doc-card-title">{t('btOcean.details')}</h2>

        {/* From → To, the heart of a transfer */}
        <div className="sb-bt-route-edit">
          <div className="sb-bt-side">
            <label className="sb-flabel" htmlFor="bt-from">{t('banking.from_account')}</label>
            <select id="bt-from" className="sb-pc-select" disabled={!isDraft}
              value={fromAccountId} onChange={e => setFromAccountId(e.target.value)}>
              <option value="">{t('banking.select_account')}</option>
              {accountOpts.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </div>
          <span className="sb-bt-arrow" aria-hidden="true"><ArrowRight size={18} className="sb-rtl-flip" /></span>
          <div className="sb-bt-side">
            <label className="sb-flabel" htmlFor="bt-to">{t('banking.to_account')}</label>
            <select id="bt-to" className="sb-pc-select" disabled={!isDraft}
              value={toAccountId} onChange={e => setToAccountId(e.target.value)}>
              <option value="">{t('banking.select_account')}</option>
              {accountOpts.filter(o => o.value !== fromAccountId).map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </div>
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Input label={t('banking.amount')} type="number" dir="ltr" value={amount}
            onChange={e => setAmount(e.target.value)} disabled={!isDraft} />
          <Input label={t('common.date')} type="date" value={date}
            onChange={e => setDate(e.target.value)} disabled={!isDraft} />
        </div>
        <Input label={t('banking.reference')} value={reference}
          onChange={e => setReference(e.target.value)} disabled={!isDraft} />
        <Input label={t('banking.notes')} value={notes}
          onChange={e => setNotes(e.target.value)} disabled={!isDraft} />
      </div>
    </div>
  );
}
