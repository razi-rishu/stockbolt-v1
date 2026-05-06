import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { getAdapter } from '@/data/index';
import { useAuthStore } from '@/store/auth';
import { Button } from '@/ui/button';
import { Badge } from '@/ui/badge';
import type { GoodsReceiptRow } from '@/data/adapter';

const statusColor: Record<string, string> = {
  draft: 'muted', received: 'success', billed: 'brand', void: 'danger',
};

export default function GoodsReceiptsPage() {
  const { t } = useTranslation();
  const { company_id } = useAuthStore();
  const navigate = useNavigate();

  const { data: grns = [], isLoading } = useQuery<GoodsReceiptRow[]>({
    queryKey: ['goods_receipts', company_id],
    queryFn: () => getAdapter().goodsReceipts.list(company_id!),
    enabled: !!company_id,
  });

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold text-ink-primary">{t('purchasing.grn_title')}</h1>
        <Button size="sm" onClick={() => navigate('/purchasing/grns/new')}>{t('purchasing.new_grn')}</Button>
      </div>
      {isLoading ? (
        <div className="py-12 text-center text-sm text-ink-tertiary">{t('common.loading')}</div>
      ) : grns.length === 0 ? (
        <div className="py-12 text-center text-sm text-ink-tertiary">{t('purchasing.no_grns')}</div>
      ) : (
        <div className="rounded-card border border-border-subtle bg-surface-card">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border-subtle bg-surface-muted text-ink-tertiary text-xs">
                <th className="px-4 py-3 text-start font-medium">{t('purchasing.grn_number')}</th>
                <th className="px-4 py-3 text-start font-medium">{t('purchasing.supplier')}</th>
                <th className="px-4 py-3 text-start font-medium">{t('purchasing.date')}</th>
                <th className="px-4 py-3 text-center font-medium">{t('purchasing.status')}</th>
              </tr>
            </thead>
            <tbody>
              {grns.map(grn => (
                <tr key={grn.id} className="border-b border-border-subtle last:border-0 hover:bg-surface-muted cursor-pointer"
                  onClick={() => navigate(`/purchasing/grns/${grn.id}`)}>
                  <td className="px-4 py-3 font-mono text-xs text-brand-700">{grn.grn_number}</td>
                  <td className="px-4 py-3 text-ink-primary">{grn.supplier_id}</td>
                  <td className="px-4 py-3 text-ink-secondary">{grn.date as string}</td>
                  <td className="px-4 py-3 text-center">
                    <Badge variant={statusColor[grn.status] as 'muted' | 'success' | 'brand' | 'danger'}>{grn.status}</Badge>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
