import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { getAdapter } from '@/data/index';
import { useAuthStore } from '@/store/auth';
import { Button } from '@/ui/button';
import type { SalesQuoteRow } from '@/data/adapter';

function fmt(n: number) {
  return n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, string> = {
    draft:             'bg-gray-50 text-gray-600',
    sent:              'bg-blue-50 text-blue-700',
    accepted:          'bg-green-50 text-green-700',
    rejected:          'bg-red-50 text-red-600',
    expired:           'bg-orange-50 text-orange-700',
    partially_invoiced:'bg-purple-50 text-purple-700',
    fully_invoiced:    'bg-teal-50 text-teal-700',
    void:              'bg-red-50 text-red-500',
  };
  return (
    <span className={`rounded-pill px-2 py-0.5 text-xs font-medium capitalize ${map[status] ?? 'bg-gray-50 text-gray-600'}`}>
      {status.replace(/_/g, ' ')}
    </span>
  );
}

export default function QuotesPage() {
  const { t } = useTranslation();
  const { company_id } = useAuthStore();
  const navigate = useNavigate();
  const qc = useQueryClient();

  const { data: quotes = [], isLoading } = useQuery({
    queryKey: ['sales_quotes', company_id],
    queryFn: () => getAdapter().salesQuotes.list(company_id!),
    enabled: !!company_id,
  });

  const convertMutation = useMutation({
    mutationFn: (quote_id: string) => getAdapter().salesQuotes.convertToInvoice(quote_id),
    onSuccess: (inv) => {
      qc.invalidateQueries({ queryKey: ['sales_quotes', company_id] });
      qc.invalidateQueries({ queryKey: ['invoices', company_id] });
      navigate(`/sales/invoices/${inv.id}`);
    },
  });

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold text-ink-primary">{t('sales.quotes_title')}</h1>
        <Button size="sm" onClick={() => navigate('/sales/quotes/new')}>
          {t('sales.new_quote')}
        </Button>
      </div>

      {isLoading ? (
        <p className="text-sm text-ink-secondary">{t('common.loading')}</p>
      ) : quotes.length === 0 ? (
        <p className="text-sm text-ink-tertiary">{t('sales.quotes_empty')}</p>
      ) : (
        <div className="rounded-card border border-border-subtle bg-surface-card">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border-subtle bg-surface-muted text-xs text-ink-tertiary">
                <th className="px-4 py-2.5 text-start font-medium">{t('sales.quote_number')}</th>
                <th className="px-4 py-2.5 text-start font-medium">{t('sales.date')}</th>
                <th className="px-4 py-2.5 text-start font-medium">{t('sales.expiry_date')}</th>
                <th className="px-4 py-2.5 text-end font-medium">{t('sales.total_amount')}</th>
                <th className="px-4 py-2.5 text-start font-medium">{t('sales.status')}</th>
                <th className="px-4 py-2.5" />
              </tr>
            </thead>
            <tbody>
              {(quotes as SalesQuoteRow[]).map((q) => (
                <tr
                  key={q.id}
                  className="border-b border-border-subtle last:border-0 hover:bg-surface-muted/50"
                >
                  <td
                    className="cursor-pointer px-4 py-2.5 font-mono text-xs text-brand-600"
                    onClick={() => navigate(`/sales/quotes/${q.id}`)}
                  >
                    {q.quote_number}
                  </td>
                  <td className="px-4 py-2.5 text-ink-secondary">{q.date}</td>
                  <td className="px-4 py-2.5 text-ink-secondary">{q.expiry_date ?? '—'}</td>
                  <td className="px-4 py-2.5 text-end font-mono text-ink-primary">
                    {q.currency} {fmt(Number(q.total_amount))}
                  </td>
                  <td className="px-4 py-2.5"><StatusBadge status={q.status} /></td>
                  <td className="px-4 py-2.5 text-end">
                    {['draft','sent','accepted'].includes(q.status) && (
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => convertMutation.mutate(q.id)}
                        disabled={convertMutation.isPending}
                      >
                        {t('sales.convert_to_invoice')}
                      </Button>
                    )}
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
