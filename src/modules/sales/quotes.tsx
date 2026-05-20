import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { getAdapter } from '@/data/index';
import { useAuthStore } from '@/store/auth';
import { Button } from '@/ui/button';
import { PageHeader } from '@/ui/primitives';
import { theme } from '@/ui/theme';
import type { SalesQuoteRow } from '@/data/adapter';

function fmt(n: number) {
  return n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, { bg: string; text: string; border: string }> = {
    draft:              { bg: theme.muted,  text: theme.inkMuted, border: theme.border },
    sent:               { bg: '#eff6ff',    text: '#1d4ed8',      border: '#bfdbfe' },
    accepted:           { bg: '#f0fdf4',    text: '#15803d',      border: '#bbf7d0' },
    rejected:           { bg: '#fef2f2',    text: '#dc2626',      border: '#fecaca' },
    expired:            { bg: '#fff7ed',    text: '#c2410c',      border: '#fed7aa' },
    partially_invoiced: { bg: '#f5f3ff',    text: '#6d28d9',      border: '#ddd6fe' },
    fully_invoiced:     { bg: '#f0fdfa',    text: '#0f766e',      border: '#99f6e4' },
    void:               { bg: '#fef2f2',    text: '#ef4444',      border: '#fecaca' },
  };
  const p = map[status] ?? { bg: theme.muted, text: theme.inkMuted, border: theme.border };
  return (
    <span style={{
      display: 'inline-block',
      padding: '3px 9px',
      borderRadius: '999px',
      fontSize: '11px', fontWeight: 600,
      textTransform: 'capitalize',
      background: p.bg, color: p.text,
      border: `1px solid ${p.border}`,
    }}>{status.replace(/_/g, ' ')}</span>
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
    <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
      <PageHeader
        title={t('sales.quotes_title')}
        subtitle={`${quotes.length} ${quotes.length === 1 ? 'quote' : 'quotes'}`}
        actions={
          <Button size="sm" onClick={() => navigate('/sales/quotes/new')}>
            + {t('sales.new_quote')}
          </Button>
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
                  <td className="px-4 py-3" style={{ color: theme.inkMuted, fontSize: '13px' }}>{q.date}</td>
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
