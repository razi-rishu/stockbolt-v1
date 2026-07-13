import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { formatDate } from '@/lib/locale';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { getAdapter } from '@/data/index';
import { useAuthStore } from '@/store/auth';
import { Button } from '@/ui/button';
import { PageHeader } from '@/ui/primitives';
import { theme } from '@/ui/theme';
import { StatusBadge } from '@/ui/status-badge';
import { usePeriodPicker } from '@/hooks/use-period-picker';
import { PeriodPicker } from '@/ui/period-picker';
import type { SalesQuoteRow, ContactRow } from '@/data/adapter';

function fmt(n: number) {
  return n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export default function QuotesPage() {
  const { t } = useTranslation();
  const { company_id } = useAuthStore();
  const navigate = useNavigate();
  const qc = useQueryClient();
  // Phase 47c — period filter (default All time = show every quote).
  const { preset, from, to, setPreset, setCustomRange } = usePeriodPicker('stockbolt.list.quotes.period', 'all_time');

  const { data: allQuotes = [], isLoading } = useQuery({
    queryKey: ['sales_quotes', company_id],
    queryFn: () => getAdapter().salesQuotes.list(company_id!),
    enabled: !!company_id,
  });
  const quotes = (allQuotes as SalesQuoteRow[]).filter(q => {
    if (from && (q.date as string) < from) return false;
    if (to && (q.date as string) > to) return false;
    return true;
  });

  const { data: customers = [] } = useQuery<ContactRow[]>({
    queryKey: ['contacts', company_id, 'customer'],
    queryFn: () => getAdapter().contacts.list(company_id!, 'customer'),
    enabled: !!company_id,
  });
  const customerMap = Object.fromEntries(customers.map(c => [c.id, c.name]));

  const convertMutation = useMutation({
    mutationFn: (quote_id: string) => getAdapter().salesQuotes.convertToInvoice(quote_id),
    onSuccess: (inv) => {
      qc.invalidateQueries({ queryKey: ['sales_quotes', company_id] });
      qc.invalidateQueries({ queryKey: ['invoices', company_id] });
      navigate(`/sales/invoices/${inv.id}`);
    },
  });

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
      <PageHeader
        title={t('sales.quotes_title')}
        subtitle={`${quotes.length} ${quotes.length === 1 ? 'quote' : 'quotes'}`}
        actions={
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
            <PeriodPicker mode="range" allowAllTime preset={preset} from={from} to={to} onPresetChange={setPreset} onCustomRange={setCustomRange} />
            <Button size="sm" onClick={() => navigate('/sales/quotes/new')}>
              + {t('sales.new_quote')}
            </Button>
          </div>
        }
      />

      {isLoading ? (
        <p style={{ fontSize: '13px', color: theme.inkFaint, padding: '48px 0', textAlign: 'center' }}>{t('common.loading')}</p>
      ) : quotes.length === 0 ? (
        <p style={{ fontSize: '13px', color: theme.inkFaint, padding: '48px 0', textAlign: 'center' }}>{t('sales.quotes_empty')}</p>
      ) : (
        <div
          className="overflow-x-auto bg-white"
          style={{ border: `1px solid ${theme.border}`, borderRadius: '12px', boxShadow: theme.shadowSm }}
        >
          <table className="w-full text-sm">
            <thead>
              <tr style={{ background: theme.panelHead, borderBottom: `1px solid ${theme.border}` }}>
                {[
                  { l: t('sales.quote_number'),  a: 'start' as const },
                  { l: t('sales.customer'),      a: 'start' as const },
                  { l: t('sales.date'),          a: 'start' as const },
                  { l: t('sales.expiry_date'),   a: 'start' as const },
                  { l: t('sales.total_amount'),  a: 'end'   as const },
                  { l: t('sales.status'),        a: 'start' as const },
                  { l: '',                       a: 'end'   as const },
                ].map((c, i) => (
                  <th
                    key={i}
                    className="px-4 py-3"
                    style={{
                      fontSize: '11px', fontWeight: 600, color: theme.inkMuted,
                      textTransform: 'uppercase', letterSpacing: '.06em',
                      textAlign: c.a, whiteSpace: 'nowrap',
                    }}
                  >{c.l}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {(quotes as SalesQuoteRow[]).map((q, idx) => (
                <tr
                  key={q.id}
                  style={{
                    borderTop: idx === 0 ? 'none' : '1px solid #f1f5f9',
                    transition: 'background-color .12s',
                  }}
                  onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = theme.panelHead; }}
                  onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = ''; }}
                >
                  <td
                    className="px-4 py-3 font-mono cursor-pointer"
                    style={{ fontSize: '12px', color: theme.brandSoftText, fontWeight: 600 }}
                    onClick={() => navigate(`/sales/quotes/${q.id}`)}
                  >
                    {q.quote_number}
                  </td>
                  <td className="px-4 py-3" style={{ color: theme.ink, fontSize: '13px', fontWeight: 500 }}>{customerMap[q.contact_id] ?? '—'}</td>
                  <td className="px-4 py-3" style={{ color: theme.inkMuted, fontSize: '13px' }}>{formatDate(q.date)}</td>
                  <td className="px-4 py-3" style={{ color: theme.inkMuted, fontSize: '13px' }}>{q.expiry_date ?? '—'}</td>
                  <td className="px-4 py-3 font-mono" style={{ textAlign: 'end', color: theme.ink, fontSize: '13px' }}>
                    {q.currency} {fmt(Number(q.total_amount))}
                  </td>
                  <td className="px-4 py-3"><StatusBadge status={q.status} /></td>
                  <td className="px-4 py-3" style={{ textAlign: 'end' }}>
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
