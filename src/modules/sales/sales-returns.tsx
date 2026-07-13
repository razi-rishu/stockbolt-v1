import { useQuery } from '@tanstack/react-query';
import { formatDate } from '@/lib/locale';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate } from 'react-router-dom';
import { getAdapter } from '@/data/index';
import { useAuthStore } from '@/store/auth';
import { Button } from '@/ui/button';
import { PageHeader } from '@/ui/primitives';
import { theme } from '@/ui/theme';
import { StatusBadge } from '@/ui/status-badge';
import { usePeriodPicker } from '@/hooks/use-period-picker';
import { PeriodPicker } from '@/ui/period-picker';
import type { SalesReturnRow, InvoiceRow, ContactRow } from '@/data/adapter';

export default function SalesReturnsPage() {
  const { t } = useTranslation();
  const { company_id } = useAuthStore();
  const navigate = useNavigate();
  // Phase 47c — period filter (default All time = show every return).
  const { preset, from, to, setPreset, setCustomRange } = usePeriodPicker('stockbolt.list.sales-returns.period', 'all_time');

  const { data: allReturns = [], isLoading } = useQuery<SalesReturnRow[]>({
    queryKey: ['sales_returns', company_id],
    queryFn:  () => getAdapter().salesReturns.list(company_id!),
    enabled:  !!company_id,
  });
  const returns = allReturns.filter(sr => {
    if (from && (sr.date as string) < from) return false;
    if (to && (sr.date as string) > to) return false;
    return true;
  });

  // sales_returns has no contact FK — the customer comes via the linked
  // invoice. Resolve invoice_id → invoice number + customer name.
  const { data: invoices = [] } = useQuery<InvoiceRow[]>({
    queryKey: ['invoices', company_id],
    queryFn: () => getAdapter().invoices.list(company_id!),
    enabled: !!company_id,
  });
  const { data: customers = [] } = useQuery<ContactRow[]>({
    queryKey: ['contacts', company_id, 'customer'],
    queryFn: () => getAdapter().contacts.list(company_id!, 'customer'),
    enabled: !!company_id,
  });
  const invoiceMap  = Object.fromEntries(invoices.map(i => [i.id, i]));
  const customerMap = Object.fromEntries(customers.map(c => [c.id, c.name]));

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
      <PageHeader
        title={t('returns.sales_returns_title')}
        subtitle={t('returns.sales_returns_desc')}
        actions={
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
            <PeriodPicker mode="range" allowAllTime preset={preset} from={from} to={to} onPresetChange={setPreset} onCustomRange={setCustomRange} />
            <Link to="/sales/returns/new"><Button>+ {t('returns.new_return')}</Button></Link>
          </div>
        }
      />

      {isLoading ? (
        <p style={{ padding: '48px 0', textAlign: 'center', fontSize: '13px', color: theme.inkFaint }}>{t('common.loading')}</p>
      ) : returns.length === 0 ? (
        <p style={{ padding: '48px 0', textAlign: 'center', fontSize: '13px', color: theme.inkFaint }}>{t('returns.no_sales_returns')}</p>
      ) : (
        <div
          className="overflow-x-auto bg-white"
          style={{ border: `1px solid ${theme.border}`, borderRadius: '12px', boxShadow: theme.shadowSm }}
        >
          <table className="w-full text-sm">
            <thead>
              <tr style={{ background: theme.panelHead, borderBottom: `1px solid ${theme.border}` }}>
                {[
                  { l: t('returns.return_number'), a: 'start' as const },
                  { l: t('sales.customer'),        a: 'start' as const },
                  { l: t('common.date'),           a: 'start' as const },
                  { l: t('returns.linked_invoice'),a: 'start' as const },
                  { l: t('returns.reason'),        a: 'start' as const },
                  { l: t('common.status'),         a: 'start' as const },
                  { l: '',                         a: 'end'   as const },
                ].map((c, i) => (
                  <th key={i} className="px-4 py-3" style={{
                    fontSize: '11px', fontWeight: 600, color: theme.inkMuted,
                    textTransform: 'uppercase', letterSpacing: '.06em',
                    textAlign: c.a, whiteSpace: 'nowrap',
                  }}>{c.l}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {returns.map((sr, idx) => (
                <tr
                  key={sr.id}
                  onClick={() => navigate(`/sales/returns/${sr.id}`)}
                  className="cursor-pointer"
                  style={{
                    borderTop: idx === 0 ? 'none' : '1px solid #f1f5f9',
                    transition: 'background-color .12s',
                  }}
                  onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = theme.panelHead; }}
                  onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = ''; }}
                >
                  <td className="px-4 py-3 font-mono" style={{ fontSize: '12px', color: theme.brandSoftText, fontWeight: 600 }}>{sr.return_number}</td>
                  <td className="px-4 py-3" style={{ color: theme.ink, fontSize: '13px', fontWeight: 500 }}>
                    {customerMap[invoiceMap[sr.invoice_id]?.contact_id ?? ''] ?? '—'}
                  </td>
                  <td className="px-4 py-3" style={{ color: theme.inkMuted, fontSize: '13px' }}>{formatDate(sr.date)}</td>
                  <td className="px-4 py-3 font-mono" style={{ fontSize: '12px', color: theme.inkMuted }}>
                    {invoiceMap[sr.invoice_id]?.invoice_number ?? `${sr.invoice_id.slice(0, 8)}…`}
                  </td>
                  <td className="px-4 py-3" style={{ color: theme.inkMuted, fontSize: '13px', textTransform: 'capitalize' }}>{sr.reason ?? '—'}</td>
                  <td className="px-4 py-3"><StatusBadge status={sr.status} /></td>
                  <td className="px-4 py-3" style={{ textAlign: 'end' }}>
                    <Link to={`/sales/returns/${sr.id}`} style={{ fontSize: '11px', color: theme.brand, fontWeight: 600, textDecoration: 'none' }}>
                      {t('common.view')} →
                    </Link>
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
