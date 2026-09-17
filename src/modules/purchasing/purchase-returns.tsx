import { useQuery } from '@tanstack/react-query';
import { formatDate } from '@/lib/locale';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate } from 'react-router-dom';
import { getAdapter } from '@/data/index';
import { useAuthStore } from '@/store/auth';
import { Button } from '@/ui/button';
import { PageHeader } from '@/ui/primitives';
import { StatusBadge } from '@/ui/status-badge';
import { usePeriodPicker } from '@/hooks/use-period-picker';
import { PeriodPicker } from '@/ui/period-picker';
import type { PurchaseReturnRow, VendorBillRow, ContactRow } from '@/data/adapter';

/**
 * R3b — Purchase Returns list. Mirror of the sales returns list.
 *
 * Like sales_returns, purchase_returns has no supplier FK of its own: the
 * supplier comes via the linked vendor bill, so the bill is resolved here to
 * show who the goods went back to.
 */
export default function PurchaseReturnsPage() {
  const { t } = useTranslation();
  const { company_id } = useAuthStore();
  const navigate = useNavigate();
  const { preset, from, to, setPreset, setCustomRange } =
    usePeriodPicker('stockbolt.list.purchase-returns.period', 'all_time');

  const { data: allReturns = [], isLoading } = useQuery<PurchaseReturnRow[]>({
    queryKey: ['purchase_returns', company_id],
    queryFn:  () => getAdapter().purchaseReturns.list(company_id!),
    enabled:  !!company_id,
  });
  const returns = allReturns.filter(pr => {
    if (from && (pr.date as string) < from) return false;
    if (to   && (pr.date as string) > to)   return false;
    return true;
  });

  const { data: bills = [] } = useQuery<VendorBillRow[]>({
    queryKey: ['vendor_bills', company_id],
    queryFn: () => getAdapter().vendorBills.list(company_id!),
    enabled: !!company_id,
  });
  const { data: suppliers = [] } = useQuery<ContactRow[]>({
    queryKey: ['contacts', company_id, 'supplier'],
    queryFn: () => getAdapter().contacts.list(company_id!, 'supplier'),
    enabled: !!company_id,
  });
  const billMap     = Object.fromEntries(bills.map(b => [b.id, b]));
  const supplierMap = Object.fromEntries(suppliers.map(s => [s.id, s]));

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <PageHeader title={t('returns.purchase_returns_title')} subtitle={t('returns.purchase_returns_desc')} />
        <div className="flex flex-wrap items-center gap-2">
          <PeriodPicker mode="range" preset={preset} from={from} to={to}
            onPresetChange={setPreset} onCustomRange={setCustomRange} />
          <Button onClick={() => navigate('/purchasing/returns/new')}>
            {t('returns.new_purchase_return')}
          </Button>
        </div>
      </div>

      <div className="glass-card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-surface-muted text-xs uppercase tracking-wide text-ink-tertiary">
              <tr>
                <th className="px-4 py-2 text-start">{t('returns.return_number')}</th>
                <th className="px-4 py-2 text-start">{t('common.date')}</th>
                <th className="px-4 py-2 text-start">{t('common.supplier')}</th>
                <th className="px-4 py-2 text-start">{t('purchasing.bill')}</th>
                <th className="px-4 py-2 text-start">{t('returns.reason')}</th>
                <th className="px-4 py-2 text-start">{t('common.status')}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border-subtle">
              {isLoading && (
                <tr><td colSpan={6} className="px-4 py-6 text-center text-ink-tertiary">{t('common.loading')}</td></tr>
              )}
              {!isLoading && returns.length === 0 && (
                <tr><td colSpan={6} className="px-4 py-6 text-center text-ink-tertiary">{t('returns.no_purchase_returns')}</td></tr>
              )}
              {returns.map(pr => {
                const bill = billMap[pr.bill_id];
                const supplier = bill ? supplierMap[bill.supplier_id] : undefined;
                return (
                  <tr key={pr.id} className="hover:bg-surface-subtle">
                    <td className="px-4 py-2">
                      <Link to={`/purchasing/returns/${pr.id}`} className="font-medium text-brand-600 hover:underline">
                        {pr.return_number}
                      </Link>
                    </td>
                    <td className="px-4 py-2 text-ink-secondary">{formatDate(pr.date)}</td>
                    <td className="px-4 py-2 text-ink-secondary">{supplier?.name ?? '—'}</td>
                    <td className="px-4 py-2 text-ink-secondary">{bill?.bill_number ?? '—'}</td>
                    <td className="px-4 py-2 text-ink-secondary">
                      {pr.reason ? t(`returns.${pr.reason}`) : '—'}
                    </td>
                    <td className="px-4 py-2"><StatusBadge status={pr.status} /></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
