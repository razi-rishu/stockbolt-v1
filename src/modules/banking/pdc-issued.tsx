import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { getAdapter } from '@/data/index';
import { useAuthStore } from '@/store/auth';
import { Button } from '@/ui/button';
import { Input } from '@/ui/input';
import { Modal } from '@/ui/modal';
import type { BankAccountRow, ContactRow, PDCChequeRow } from '@/data/adapter';

const fmt = (n: number) => n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const STATUS_COLORS: Record<string, string> = {
  pending:   'bg-yellow-100 text-yellow-700',
  deposited: 'bg-blue-100 text-blue-700',
  cleared:   'bg-green-100 text-green-700',
  bounced:   'bg-red-100 text-red-600',
  cancelled: 'bg-slate-100 text-slate-500',
};

export default function PDCIssuedPage() {
  const { t } = useTranslation();
  const { company_id } = useAuthStore();
  const qc = useQueryClient();

  // New PDC form state
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [contactId, setContactId]             = useState('');
  const [chequeNumber, setChequeNumber]       = useState('');
  const [bankName, setBankName]               = useState('');
  const [amount, setAmount]                   = useState('');
  const [currency, setCurrency]               = useState('AED');
  const [issueDate, setIssueDate]             = useState(new Date().toISOString().slice(0, 10));
  const [dueDate, setDueDate]                 = useState('');
  const [depositAccountId, setDepositAccountId] = useState('');
  const [notes, setNotes]                     = useState('');
  const [createError, setCreateError]         = useState<string | null>(null);

  // Clear modal state
  const [clearPdcId, setClearPdcId]       = useState<string | null>(null);
  const [clearAccountId, setClearAccountId] = useState('');

  const [error, setError] = useState<string | null>(null);

  const { data: pdcs = [], isLoading } = useQuery<PDCChequeRow[]>({
    queryKey: ['pdc_cheques', 'issued', company_id],
    queryFn:  () => getAdapter().pdcCheques.list(company_id!, { type: 'issued' }),
    enabled:  !!company_id,
  });
  const { data: suppliers = [] } = useQuery<ContactRow[]>({
    queryKey: ['contacts_suppliers', company_id],
    queryFn:  () => getAdapter().contacts.list(company_id!, 'supplier'),
    enabled:  !!company_id,
  });
  const { data: bankAccounts = [] } = useQuery<BankAccountRow[]>({
    queryKey: ['bank_accounts', company_id],
    queryFn:  () => getAdapter().bankAccounts.list(company_id!),
    enabled:  !!company_id,
  });

  function invalidate() {
    qc.invalidateQueries({ queryKey: ['pdc_cheques', 'issued'] });
  }

  const createMutation = useMutation({
    mutationFn: () => getAdapter().pdcCheques.create({
      type: 'issued', contact_id: contactId, cheque_number: chequeNumber,
      bank_name: bankName || undefined, amount: parseFloat(amount), currency,
      issue_date: issueDate, due_date: dueDate,
      deposit_account_id: depositAccountId || undefined,
      is_advance: false, notes: notes || undefined,
    }),
    onSuccess: () => { invalidate(); setShowCreateModal(false); resetForm(); },
    onError: (e: Error) => setCreateError(e.message),
  });

  const clearMutation = useMutation({
    mutationFn: () => getAdapter().pdcCheques.clear(clearPdcId!, clearAccountId || undefined),
    onSuccess: () => { invalidate(); setClearPdcId(null); setError(null); },
    onError: (e: Error) => { setError(e.message); setClearPdcId(null); },
  });

  const cancelMutation = useMutation({
    mutationFn: (pdc_id: string) => getAdapter().pdcCheques.cancel(pdc_id),
    onSuccess: () => { invalidate(); setError(null); },
    onError: (e: Error) => setError(e.message),
  });

  function resetForm() {
    setContactId(''); setChequeNumber(''); setBankName(''); setAmount('');
    setCurrency('AED'); setIssueDate(new Date().toISOString().slice(0, 10));
    setDueDate(''); setDepositAccountId(''); setNotes('');
    setCreateError(null);
  }

  const contactName = (id: string) => suppliers.find(c => c.id === id)?.name ?? id.slice(0, 8);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-800">{t('banking.pdc_issued_title')}</h1>
          <p className="text-sm text-slate-500 mt-1">{t('banking.pdc_issued_desc')}</p>
        </div>
        <Button variant="primary" onClick={() => setShowCreateModal(true)}>
          {t('banking.new_pdc_issued')}
        </Button>
      </div>

      {error && <p className="text-sm text-red-600 bg-red-50 rounded p-3">{error}</p>}

      <div className="bg-white border border-slate-200 rounded-lg overflow-hidden">
        {isLoading ? (
          <p className="p-8 text-center text-sm text-slate-400">{t('common.loading')}</p>
        ) : pdcs.length === 0 ? (
          <p className="p-8 text-center text-slate-500">{t('banking.no_pdc_issued')}</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 border-b border-slate-200">
                <tr>
                  <th className="px-4 py-3 text-left font-medium text-slate-600">{t('banking.pdc_number')}</th>
                  <th className="px-4 py-3 text-left font-medium text-slate-600">{t('banking.supplier')}</th>
                  <th className="px-4 py-3 text-left font-medium text-slate-600">{t('banking.cheque_number')}</th>
                  <th className="px-4 py-3 text-left font-medium text-slate-600">{t('banking.bank_name')}</th>
                  <th className="px-4 py-3 text-left font-medium text-slate-600">{t('banking.due_date')}</th>
                  <th className="px-4 py-3 text-right font-medium text-slate-600">{t('banking.amount')}</th>
                  <th className="px-4 py-3 text-left font-medium text-slate-600">{t('common.status')}</th>
                  <th className="px-4 py-3 text-right font-medium text-slate-600">{t('banking.actions')}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {pdcs.map(pdc => (
                  <tr key={pdc.id} className="hover:bg-slate-50 transition-colors">
                    <td className="px-4 py-3 font-mono text-blue-600">{pdc.pdc_number}</td>
                    <td className="px-4 py-3 text-slate-700">{contactName(pdc.contact_id)}</td>
                    <td className="px-4 py-3 font-mono text-slate-600">{pdc.cheque_number}</td>
                    <td className="px-4 py-3 text-slate-600">{pdc.bank_name ?? '—'}</td>
                    <td className="px-4 py-3 text-slate-600">{pdc.due_date}</td>
                    <td className="px-4 py-3 text-right font-semibold text-slate-800">{pdc.currency} {fmt(pdc.amount)}</td>
                    <td className="px-4 py-3">
                      <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-semibold ${STATUS_COLORS[pdc.status] ?? 'bg-slate-100 text-slate-600'}`}>
                        {pdc.status}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right space-x-1">
                      {pdc.status === 'pending' && (
                        <>
                          <button onClick={() => { setClearPdcId(pdc.id); setClearAccountId(pdc.deposit_account_id ?? ''); }}
                            className="text-xs text-green-600 hover:underline px-1">{t('banking.clear')}</button>
                          <button onClick={() => { if (confirm(t('banking.cancel_confirm'))) cancelMutation.mutate(pdc.id); }}
                            className="text-xs text-slate-500 hover:underline px-1">{t('banking.cancel_pdc')}</button>
                        </>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Create PDC Issued Modal */}
      <Modal open={showCreateModal} onClose={() => { setShowCreateModal(false); resetForm(); }}
        title={t('banking.new_pdc_issued')}>
        <div className="space-y-3 mb-4">
          {createError && <p className="text-sm text-red-600 bg-red-50 rounded p-2">{createError}</p>}
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">{t('banking.supplier')}</label>
            <select value={contactId} onChange={e => setContactId(e.target.value)}
              className="w-full h-9 rounded-md border border-slate-300 px-2 text-sm">
              <option value="">{t('banking.select_supplier')}</option>
              {suppliers.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Input label={t('banking.cheque_number')} value={chequeNumber} onChange={e => setChequeNumber(e.target.value)} />
            <Input label={t('banking.bank_name')} value={bankName} onChange={e => setBankName(e.target.value)} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Input label={t('banking.amount')} type="number" value={amount} onChange={e => setAmount(e.target.value)} />
            <Input label={t('banking.currency')} value={currency} onChange={e => setCurrency(e.target.value)} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Input label={t('banking.issue_date')} type="date" value={issueDate} onChange={e => setIssueDate(e.target.value)} />
            <Input label={t('banking.due_date')} type="date" value={dueDate} onChange={e => setDueDate(e.target.value)} />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">{t('banking.payment_account')}</label>
            <select value={depositAccountId} onChange={e => setDepositAccountId(e.target.value)}
              className="w-full h-9 rounded-md border border-slate-300 px-2 text-sm">
              <option value="">— {t('banking.none')} —</option>
              {bankAccounts.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
            </select>
          </div>
          <Input label={t('banking.notes')} value={notes} onChange={e => setNotes(e.target.value)} />
        </div>
        <div className="flex justify-end gap-3">
          <Button variant="ghost" size="sm" onClick={() => { setShowCreateModal(false); resetForm(); }}>{t('common.cancel')}</Button>
          <Button size="sm" variant="primary" disabled={createMutation.isPending || !contactId || !chequeNumber || !amount || !dueDate}
            onClick={() => createMutation.mutate()}>
            {createMutation.isPending ? t('common.loading') : t('banking.record_pdc_issued')}
          </Button>
        </div>
      </Modal>

      {/* Clear PDC Modal */}
      <Modal open={!!clearPdcId} onClose={() => setClearPdcId(null)} title={t('banking.clear_pdc_issued')}>
        <div className="space-y-3 mb-4">
          <p className="text-sm text-slate-600">{t('banking.clear_pdc_issued_desc')}</p>
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">{t('banking.payment_account')}</label>
            <select value={clearAccountId} onChange={e => setClearAccountId(e.target.value)}
              className="w-full h-9 rounded-md border border-slate-300 px-2 text-sm">
              <option value="">— {t('banking.select_account')} —</option>
              {bankAccounts.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
            </select>
          </div>
        </div>
        <div className="flex justify-end gap-3">
          <Button variant="ghost" size="sm" onClick={() => setClearPdcId(null)}>{t('common.cancel')}</Button>
          <Button size="sm" variant="primary" disabled={clearMutation.isPending}
            onClick={() => clearMutation.mutate()}>
            {clearMutation.isPending ? t('common.loading') : t('banking.mark_cleared')}
          </Button>
        </div>
      </Modal>
    </div>
  );
}
