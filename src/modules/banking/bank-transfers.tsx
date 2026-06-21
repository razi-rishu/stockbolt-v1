import { useQuery } from '@tanstack/react-query';
import { formatDate } from '@/lib/locale';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { getAdapter } from '@/data/index';
import { useAuthStore } from '@/store/auth';
import { Button } from '@/ui/button';
import { StatusBadge } from '@/ui/status-badge';
import type { BankTransferRow, BankAccountRow } from '@/data/adapter';

const fmt = (n: number) => n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export default function BankTransfersPage() {
  const { t } = useTranslation();
  const { company_id } = useAuthStore();

  const { data: transfers = [], isLoading } = useQuery<BankTransferRow[]>({
    queryKey: ['bank_transfers', company_id],
    queryFn:  () => getAdapter().bankTransfers.list(company_id!),
    enabled:  !!company_id,
  });

  const { data: bankAccounts = [] } = useQuery<BankAccountRow[]>({
    queryKey: ['bank_accounts', company_id],
    queryFn:  () => getAdapter().bankAccounts.list(company_id!),
    enabled:  !!company_id,
  });
  const accountMap = Object.fromEntries(bankAccounts.map(a => [a.id, a.name]));

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-ink-primary">{t('banking.transfers_title')}</h1>
          <p className="text-sm text-ink-tertiary mt-1">{t('banking.transfers_desc')}</p>
        </div>
        <Link to="/banking/transfers/new">
          <Button variant="primary">{t('banking.new_transfer')}</Button>
        </Link>
      </div>

      <div className="bg-white border border-border-subtle rounded-lg overflow-hidden">
        {isLoading ? (
          <p className="p-8 text-center text-sm text-ink-tertiary">{t('common.loading')}</p>
        ) : transfers.length === 0 ? (
          <p className="p-8 text-center text-ink-tertiary">{t('banking.no_transfers')}</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-surface-muted border-b border-border-subtle">
                <tr>
                  <th className="px-4 py-3 text-left font-medium text-ink-secondary">{t('banking.transfer_number')}</th>
                  <th className="px-4 py-3 text-left font-medium text-ink-secondary">{t('common.date')}</th>
                  <th className="px-4 py-3 text-left font-medium text-ink-secondary">{t('banking.from_account')}</th>
                  <th className="px-4 py-3 text-left font-medium text-ink-secondary">{t('banking.to_account')}</th>
                  <th className="px-4 py-3 text-right font-medium text-ink-secondary">{t('banking.amount')}</th>
                  <th className="px-4 py-3 text-left font-medium text-ink-secondary">{t('common.status')}</th>
                  <th className="px-4 py-3" />
                </tr>
              </thead>
              <tbody className="divide-y divide-border-subtle">
                {transfers.map(t2 => (
                  <tr key={t2.id} className="hover:bg-surface-muted transition-colors">
                    <td className="px-4 py-3 font-mono text-brand-600">{t2.transfer_number}</td>
                    <td className="px-4 py-3 text-ink-secondary">{formatDate(t2.date)}</td>
                    <td className="px-4 py-3 text-ink-secondary text-sm">{accountMap[t2.from_account_id] ?? t2.from_account_id}</td>
                    <td className="px-4 py-3 text-ink-secondary text-sm">{accountMap[t2.to_account_id] ?? t2.to_account_id}</td>
                    <td className="px-4 py-3 text-right font-semibold text-ink-primary">{fmt(t2.amount)}</td>
                    <td className="px-4 py-3"><StatusBadge status={t2.status} /></td>
                    <td className="px-4 py-3 text-right">
                      <Link to={`/banking/transfers/${t2.id}`} className="text-xs text-brand-600 hover:underline">
                        {t('common.view')}
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
