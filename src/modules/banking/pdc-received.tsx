import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { getAdapter } from '@/data/index';
import { useAuthStore } from '@/store/auth';
import { useInvalidateBooks } from '@/hooks/use-invalidate-books';
import { useCompanyCurrency } from '@/hooks/use-company-currency';
import { Button } from '@/ui/button';
import { Input } from '@/ui/input';
import { Modal } from '@/ui/modal';
import { SearchableSelect } from '@/ui/searchable-select';
import type { BankAccountRow, ContactRow, PDCChequeRow } from '@/data/adapter';

const fmt = (n: number) => n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const STATUS_COLORS: Record<string, string> = {
  pending:   'bg-yellow-100 text-yellow-700',
  deposited: 'bg-blue-100 text-blue-700',
  cleared:   'bg-green-100 text-green-700',
  bounced:   'bg-red-100 text-red-600',
  cancelled: 'bg-surface-muted text-ink-tertiary',
};

export default function PDCReceivedPage() {
  const { t } = useTranslation();
  const { company_id } = useAuthStore();
  const qc = useQueryClient();
  const invalidateBooks = useInvalidateBooks();   // Phase 14.14k
  const companyCurrency = useCompanyCurrency();    // Phase 14.14m

  // New PDC form state
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [contactId, setContactId]             = useState('');
  const [chequeNumber, setChequeNumber]       = useState('');
  const [bankName, setBankName]               = useState('');
  const [amount, setAmount]                   = useState('');
  const [currency, setCurrency]               = useState(companyCurrency);
  const [issueDate, setIssueDate]             = useState(new Date().toISOString().slice(0, 10));
  const [dueDate, setDueDate]                 = useState('');
  const [depositAccountId, setDepositAccountId] = useState('');
  const [isAdvance, setIsAdvance]             = useState(false);
  const [notes, setNotes]                     = useState('');
  const [createError, setCreateError]         = useState<string | null>(null);

  // Clear modal state
  const [clearPdcId, setClearPdcId]       = useState<string | null>(null);
  const [clearAccountId, setClearAccountId] = useState('');

  const [error, setError] = useState<string | null>(null);

  const { data: pdcs = [], isLoading } = useQuery<PDCChequeRow[]>({
    queryKey: ['pdc_cheques', 'received', company_id],
    queryFn:  () => getAdapter().pdcCheques.list(company_id!, { type: 'received' }),
    enabled:  !!company_id,
  });
  const { data: customers = [] } = useQuery<ContactRow[]>({
    queryKey: ['contacts', company_id, 'customer'],
    queryFn:  () => getAdapter().contacts.list(company_id!, 'customer'),
    enabled:  !!company_id,
  });
  const { data: bankAccounts = [] } = useQuery<BankAccountRow[]>({
    queryKey: ['bank_accounts', company_id],
    queryFn:  () => getAdapter().bankAccounts.list(company_id!),
    enabled:  !!company_id,
  });

  function invalidate() {
    // Phase 14.14k — clear / bank-deposit / bounce all touch GL.
    invalidateBooks();
    qc.invalidateQueries({ queryKey: ['pdc_cheques', 'received'] });
  }

  const createMutation = useMutation({
    mutationFn: () => getAdapter().pdcCheques.create({
      type: 'received', contact_id: contactId, cheque_number: chequeNumber,
      bank_name: bankName || undefined, amount: parseFloat(amount), currency,
      issue_date: issueDate, due_date: dueDate,
      deposit_account_id: depositAccountId || undefined,
      is_advance: isAdvance, notes: notes || undefined,
    }),
    onSuccess: () => { invalidate(); setShowCreateModal(false); resetForm(); },
    onError: (e: Error) => setCreateError(e.message),
  });

  const depositMutation = useMutation({
    mutationFn: (pdc_id: string) => getAdapter().pdcCheques.deposit(pdc_id),
    onSuccess: () => { invalidate(); setError(null); },
    onError: (e: Error) => setError(e.message),
  });

  const clearMutation = useMutation({
    mutationFn: () => getAdapter().pdcCheques.clear(clearPdcId!, clearAccountId || undefined),
    onSuccess: () => { invalidate(); setClearPdcId(null); setError(null); },
    onError: (e: Error) => { setError(e.message); setClearPdcId(null); },
  });

  const bounceMutation = useMutation({
    mutationFn: (pdc_id: string) => getAdapter().pdcCheques.bounce(pdc_id),
    onSuccess: () => { invalidate(); setError(null); },
    onError: (e: Error) => setError(e.message),
  });

  const cancelMutation = useMutation({
    mutationFn: (pdc_id: string) => getAdapter().pdcCheques.cancel(pdc_id),
    onSuccess: () => { invalidate(); setError(null); },
    onError: (e: Error) => setError(e.message),
  });

  function resetForm() {
    setContactId(''); setChequeNumber(''); setBankName(''); setAmount('');
    setCurrency(companyCurrency); setIssueDate(new Date().toISOString().slice(0, 10));
    setDueDate(''); setDepositAccountId(''); setIsAdvance(false); setNotes('');
    setCreateError(null);
  }

  const contactName = (id: string) => customers.find(c => c.id === id)?.name ?? id.slice(0, 8);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-ink-primary">{t('banking.pdc_received_title')}</h1>
          <p className="text-sm text-ink-tertiary mt-1">{t('banking.pdc_received_desc')}</p>
        </div>
        <Button variant="primary" onClick={() => setShowCreateModal(true)}>
          {t('banking.new_pdc')}
        </Button>
      </div>

      {error && <p className="text-sm text-red-600 bg-red-50 rounded p-3">{error}</p>}

      <div className="bg-white border border-border-subtle rounded-lg overflow-hidden">
        {isLoading ? (
          <p className="p-8 text-center text-sm text-ink-tertiary">{t('common.loading')}</p>
        ) : pdcs.length === 0 ? (
          <p className="p-8 text-center text-ink-tertiary">{t('banking.no_pdc')}</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-surface-muted border-b border-border-subtle">
                <tr>
                  <th className="px-4 py-3 text-left font-medium text-ink-secondary">{t('banking.pdc_number')}</th>
                  <th className="px-4 py-3 text-left font-medium text-ink-secondary">{t('banking.customer')}</th>
                  <th className="px-4 py-3 text-left font-medium text-ink-secondary">{t('banking.cheque_number')}</th>
                  <th className="px-4 py-3 text-left font-medium text-ink-secondary">{t('banking.bank_name')}</th>
                  <th className="px-4 py-3 text-left font-medium text-ink-secondary">{t('banking.due_date')}</th>
                  <th className="px-4 py-3 text-right font-medium text-ink-secondary">{t('banking.amount')}</th>
                  <th className="px-4 py-3 text-left font-medium text-ink-secondary">{t('common.status')}</th>
                  <th className="px-4 py-3 text-right font-medium text-ink-secondary">{t('banking.actions')}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border-subtle">
                {pdcs.map(pdc => (
                  <tr key={pdc.id} className="hover:bg-surface-muted transition-colors">
                    <td className="px-4 py-3 font-mono text-brand-600">{pdc.pdc_number}</td>
                    <td className="px-4 py-3 text-ink-secondary">{contactName(pdc.contact_id)}</td>
                    <td className="px-4 py-3 font-mono text-ink-secondary">{pdc.cheque_number}</td>
                    <td className="px-4 py-3 text-ink-secondary">{pdc.bank_name ?? '—'}</td>
                    <td className="px-4 py-3 text-ink-secondary">{pdc.due_date}</td>
                    <td className="px-4 py-3 text-right font-semibold text-ink-primary">{pdc.currency} {fmt(pdc.amount)}</td>
                    <td className="px-4 py-3">
                      <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-semibold ${STATUS_COLORS[pdc.status] ?? 'bg-surface-muted text-ink-secondary'}`}>
                        {pdc.status}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right space-x-1">
                      {pdc.status === 'pending' && (
                        <>
                          <button onClick={() => depositMutation.mutate(pdc.id)}
                            className="text-xs text-brand-600 hover:underline px-1">{t('banking.deposit')}</button>
                          <button onClick={() => { setClearPdcId(pdc.id); setClearAccountId(pdc.deposit_account_id ?? ''); }}
                            className="text-xs text-green-600 hover:underline px-1">{t('banking.clear')}</button>
                          <button onClick={() => { if (confirm(t('banking.cancel_confirm'))) cancelMutation.mutate(pdc.id); }}
                            className="text-xs text-ink-tertiary hover:underline px-1">{t('banking.cancel_pdc')}</button>
                        </>
                      )}
                      {pdc.status === 'deposited' && (
                        <>
                          <button onClick={() => { setClearPdcId(pdc.id); setClearAccountId(pdc.deposit_account_id ?? ''); }}
                            className="text-xs text-green-600 hover:underline px-1">{t('banking.clear')}</button>
                          <button onClick={() => { if (confirm(t('banking.bounce_confirm'))) bounceMutation.mutate(pdc.id); }}
                            className="text-xs text-red-600 hover:underline px-1">{t('banking.bounce')}</button>
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

      {/* Create PDC Modal */}
      <Modal open={showCreateModal} onClose={() => { setShowCreateModal(false); resetForm(); }}
        title={t('banking.new_pdc')}>
        <div className="space-y-3 mb-4">
          {createError && <p className="text-sm text-red-600 bg-red-50 rounded p-2">{createError}</p>}
          <div>
            <label className="block text-xs font-medium text-ink-secondary mb-1">{t('banking.customer')}</label>
            <SearchableSelect
              options={customers.map((c) => ({ value: c.id, label: c.name }))}
              value={contactId}
              onChange={(v) => setContactId(v)}
              placeholder={t('banking.select_customer')}
              panelWidth={320}
            />
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
            <label className="block text-xs font-medium text-ink-secondary mb-1">{t('banking.deposit_account')}</label>
            <select value={depositAccountId} onChange={e => setDepositAccountId(e.target.value)}
              className="w-full h-9 rounded-md border border-border-strong px-2 text-sm">
              <option value="">— {t('banking.none')} —</option>
              {bankAccounts.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
            </select>
          </div>
          <label className="flex items-center gap-2 text-sm text-ink-secondary cursor-pointer">
            <input type="checkbox" checked={isAdvance} onChange={e => setIsAdvance(e.target.checked)} />
            {t('banking.is_advance')}
          </label>
          <Input label={t('banking.notes')} value={notes} onChange={e => setNotes(e.target.value)} />
        </div>
        <div className="flex justify-end gap-3">
          <Button variant="ghost" size="sm" onClick={() => { setShowCreateModal(false); resetForm(); }}>{t('common.cancel')}</Button>
          <Button size="sm" variant="primary" disabled={createMutation.isPending || !contactId || !chequeNumber || !amount || !dueDate}
            onClick={() => createMutation.mutate()}>
            {createMutation.isPending ? t('common.loading') : t('banking.record_pdc')}
          </Button>
        </div>
      </Modal>

      {/* Clear PDC Modal */}
      <Modal open={!!clearPdcId} onClose={() => setClearPdcId(null)} title={t('banking.clear_pdc')}>
        <div className="space-y-3 mb-4">
          <p className="text-sm text-ink-secondary">{t('banking.clear_pdc_desc')}</p>
          <div>
            <label className="block text-xs font-medium text-ink-secondary mb-1">{t('banking.deposit_account')}</label>
            <select value={clearAccountId} onChange={e => setClearAccountId(e.target.value)}
              className="w-full h-9 rounded-md border border-border-strong px-2 text-sm">
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
