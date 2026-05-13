import { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { getAdapter } from '@/data/index';
import { useAuthStore } from '@/store/auth';
import { Input } from '@/ui/input';
import { Button } from '@/ui/button';
import type { BankAccountRow, BankTransferRow } from '@/data/adapter';

const fmt = (n: number) => n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export default function BankTransferEditorPage() {
  const { t } = useTranslation();
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const qc = useQueryClient();
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
        throw new Error('Amount must be greater than zero');
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
    onSuccess: (row) => {
      qc.invalidateQueries({ queryKey: ['bank_transfers'] });
      if (isNew) navigate(`/banking/transfers/${(row as BankTransferRow).id}`);
    },
    onError: (e: Error) => setError(e.message),
  });

  const confirmMutation = useMutation({
    mutationFn: () => getAdapter().bankTransfers.confirm(id!),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['bank_transfer', id] }); qc.invalidateQueries({ queryKey: ['bank_transfers'] }); },
    onError: (e: Error) => setError(e.message),
  });

  const voidMutation = useMutation({
    mutationFn: () => getAdapter().bankTransfers.void(id!),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['bank_transfer', id] }); qc.invalidateQueries({ queryKey: ['bank_transfers'] }); },
    onError: (e: Error) => setError(e.message),
  });

  const isDraft = !transfer || transfer.status === 'draft';
  const isConfirmed = transfer?.status === 'confirmed';
  const accountOpts = bankAccounts.map(a => ({ value: a.id, label: a.name }));

  return (
    <div className="space-y-6 max-w-2xl">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-slate-800">
          {isNew ? t('banking.new_transfer') : (transfer?.transfer_number ?? t('banking.new_transfer'))}
        </h1>
        {transfer && (
          <span className={`px-2.5 py-1 rounded text-xs font-semibold ${
            transfer.status === 'confirmed' ? 'bg-green-100 text-green-700'
            : transfer.status === 'void' ? 'bg-red-100 text-red-600'
            : 'bg-yellow-100 text-yellow-700'
          }`}>{transfer.status.toUpperCase()}</span>
        )}
      </div>

      {error && <p className="text-sm text-red-600 bg-red-50 rounded p-3">{error}</p>}

      <div className="bg-white border border-slate-200 rounded-lg p-6 space-y-4">
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">{t('banking.from_account')}</label>
            <select disabled={!isDraft}
              value={fromAccountId} onChange={e => setFromAccountId(e.target.value)}
              className="w-full h-9 rounded-md border border-slate-300 px-2 text-sm disabled:bg-slate-50">
              <option value="">{t('banking.select_account')}</option>
              {accountOpts.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">{t('banking.to_account')}</label>
            <select disabled={!isDraft}
              value={toAccountId} onChange={e => setToAccountId(e.target.value)}
              className="w-full h-9 rounded-md border border-slate-300 px-2 text-sm disabled:bg-slate-50">
              <option value="">{t('banking.select_account')}</option>
              {accountOpts.filter(o => o.value !== fromAccountId).map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <Input label={t('banking.amount')} type="number" value={amount}
            onChange={e => setAmount(e.target.value)} disabled={!isDraft} />
          <Input label={t('common.date')} type="date" value={date}
            onChange={e => setDate(e.target.value)} disabled={!isDraft} />
        </div>
        <Input label={t('banking.reference')} value={reference}
          onChange={e => setReference(e.target.value)} disabled={!isDraft} />
        <Input label={t('banking.notes')} value={notes}
          onChange={e => setNotes(e.target.value)} disabled={!isDraft} />
      </div>

      {/* Confirmed summary */}
      {isConfirmed && (
        <div className="bg-green-50 border border-green-200 rounded-lg p-4 text-sm text-green-800">
          <p className="font-semibold">{t('banking.transfer_confirmed')}</p>
          <p className="mt-1">{t('banking.amount')}: <strong>{fmt(transfer.amount)}</strong></p>
        </div>
      )}

      <div className="flex gap-3">
        <Button variant="ghost" onClick={() => navigate('/banking/transfers')}>{t('common.back')}</Button>
        {isDraft && (
          <>
            <Button disabled={saveMutation.isPending} onClick={() => saveMutation.mutate()}>
              {t('common.save')}
            </Button>
            {!isNew && (
              <Button variant="primary" disabled={confirmMutation.isPending || !fromAccountId || !toAccountId}
                onClick={() => { setError(null); confirmMutation.mutate(); }}>
                {t('banking.confirm_transfer')}
              </Button>
            )}
          </>
        )}
        {isConfirmed && (
          <Button variant="ghost" className="text-red-600 border-red-300"
            disabled={voidMutation.isPending}
            onClick={() => { if (confirm(t('banking.void_confirm_text'))) { setError(null); voidMutation.mutate(); } }}>
            {t('banking.void_transfer')}
          </Button>
        )}
      </div>
    </div>
  );
}
