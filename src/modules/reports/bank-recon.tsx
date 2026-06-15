import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { getAdapter } from '@/data/index';
import { useAuthStore } from '@/store/auth';
import type { BankAccountRow, BankReconLine } from '@/data/adapter';

const fmt = (n: number) => n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export default function BankReconPage() {
  const { t } = useTranslation();
  const { company_id } = useAuthStore();

  const today      = new Date().toISOString().slice(0, 10);
  const firstOfMonth = today.slice(0, 8) + '01';

  const [accountId, setAccountId] = useState('');
  const [dateFrom, setDateFrom]   = useState(firstOfMonth);
  const [dateTo, setDateTo]       = useState(today);

  const { data: bankAccounts = [] } = useQuery<BankAccountRow[]>({
    queryKey: ['bank_accounts', company_id],
    queryFn:  () => getAdapter().bankAccounts.list(company_id!),
    enabled:  !!company_id,
  });

  const { data: lines = [], isLoading, isFetching } = useQuery<BankReconLine[]>({
    queryKey: ['report_bank_recon', company_id, accountId, dateFrom, dateTo],
    queryFn:  () => getAdapter().reports.bankRecon(company_id!, accountId, dateFrom, dateTo),
    enabled:  !!company_id && !!accountId,
  });

  const closingBalance = lines.length > 0 ? lines[lines.length - 1].running_balance : 0;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-ink-primary">{t('reports.bank_recon_title')}</h1>
        <p className="text-sm text-ink-tertiary mt-1">{t('reports.bank_recon_desc')}</p>
      </div>

      {/* Filters */}
      <div className="bg-white border border-border-subtle rounded-lg p-4">
        <div className="grid grid-cols-3 gap-4">
          <div>
            <label className="block text-xs font-medium text-ink-secondary mb-1">{t('banking.bank_account')}</label>
            <select value={accountId} onChange={e => setAccountId(e.target.value)}
              className="w-full h-9 rounded-md border border-border-strong px-2 text-sm">
              <option value="">{t('banking.select_account')}</option>
              {bankAccounts.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-ink-secondary mb-1">{t('reports.date_from')}</label>
            <input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)}
              className="w-full h-9 rounded-md border border-border-strong px-3 text-sm" />
          </div>
          <div>
            <label className="block text-xs font-medium text-ink-secondary mb-1">{t('reports.date_to')}</label>
            <input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)}
              className="w-full h-9 rounded-md border border-border-strong px-3 text-sm" />
          </div>
        </div>
      </div>

      {!accountId ? (
        <p className="text-center text-sm text-ink-tertiary py-8">{t('reports.select_account_prompt')}</p>
      ) : (
        <>
          {/* Closing balance summary */}
          {lines.length > 0 && (
            <div className="bg-white border border-border-subtle rounded-lg p-4 flex items-center justify-between">
              <span className="text-sm font-medium text-ink-secondary">{t('reports.closing_balance_as_of')} {dateTo}</span>
              <span className={`text-xl font-bold ${closingBalance >= 0 ? 'text-ink-primary' : 'text-red-600'}`}>
                {fmt(closingBalance)}
              </span>
            </div>
          )}

          <div className="bg-white border border-border-subtle rounded-lg overflow-hidden">
            {isLoading || isFetching ? (
              <p className="p-8 text-center text-sm text-ink-tertiary">{t('common.loading')}</p>
            ) : lines.length === 0 ? (
              <p className="p-8 text-center text-ink-tertiary">{t('reports.no_data')}</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-surface-muted border-b border-border-subtle">
                    <tr>
                      <th className="px-4 py-3 text-left font-medium text-ink-secondary">{t('common.date')}</th>
                      <th className="px-4 py-3 text-left font-medium text-ink-secondary">{t('reports.je_number')}</th>
                      <th className="px-4 py-3 text-left font-medium text-ink-secondary">{t('reports.source_type')}</th>
                      <th className="px-4 py-3 text-left font-medium text-ink-secondary">{t('reports.description')}</th>
                      <th className="px-4 py-3 text-right font-medium text-ink-secondary">{t('reports.debit')}</th>
                      <th className="px-4 py-3 text-right font-medium text-ink-secondary">{t('reports.credit')}</th>
                      <th className="px-4 py-3 text-right font-medium text-ink-secondary">{t('reports.running_balance')}</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border-subtle">
                    {lines.map((line, i) => (
                      <tr key={i} className="hover:bg-surface-muted transition-colors">
                        <td className="px-4 py-3 text-ink-secondary">{line.date}</td>
                        <td className="px-4 py-3 font-mono text-brand-600">{line.je_number}</td>
                        <td className="px-4 py-3">
                          <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-surface-muted text-ink-secondary">
                            {line.source_type.replace(/_/g, ' ')}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-ink-secondary max-w-xs truncate">{line.description}</td>
                        <td className="px-4 py-3 text-right text-green-600">
                          {line.debit > 0 ? fmt(line.debit) : '—'}
                        </td>
                        <td className="px-4 py-3 text-right text-red-600">
                          {line.credit > 0 ? fmt(line.credit) : '—'}
                        </td>
                        <td className={`px-4 py-3 text-right font-semibold ${line.running_balance < 0 ? 'text-red-600' : 'text-ink-primary'}`}>
                          {fmt(line.running_balance)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
