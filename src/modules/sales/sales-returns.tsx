import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate } from 'react-router-dom';
import { getAdapter } from '@/data/index';
import { useAuthStore } from '@/store/auth';
import { Button } from '@/ui/button';
import { PageHeader } from '@/ui/primitives';
import { theme } from '@/ui/theme';
import type { SalesReturnRow } from '@/data/adapter';

// ── Sample-style tinted status pill ──────────────────────────────────────
function StatusBadge({ status }: { status: string }) {
  const map: Record<string, { bg: string; text: string; border: string; label: string }> = {
    draft:     { bg: '#fffbeb', text: '#b45309', border: '#fde68a', label: 'Draft' },
    confirmed: { bg: '#f0fdf4', text: '#15803d', border: '#bbf7d0', label: 'Confirmed' },
    void:      { bg: '#fef2f2', text: '#dc2626', border: '#fecaca', label: 'Void' },
  };
  const p = map[status] ?? map.draft;
  return (
    <span style={{
      display: 'inline-block', padding: '3px 9px', borderRadius: '999px',
      fontSize: '11px', fontWeight: 600,
      background: p.bg, color: p.text, border: `1px solid ${p.border}`,
    }}>{p.label}</span>
  );
}

export default function SalesReturnsPage() {
  const { t } = useTranslation();
  const { company_id } = useAuthStore();
  const navigate = useNavigate();

  const { data: returns = [], isLoading } = useQuery<SalesReturnRow[]>({
    queryKey: ['sales_returns', company_id],
    queryFn:  () => getAdapter().salesReturns.list(company_id!),
    enabled:  !!company_id,
  });

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
      <PageHeader
        title={t('returns.sales_returns_title')}
        subtitle={t('returns.sales_returns_desc')}
        actions={
          <Link to="/sales/returns/new"><Button>+ {t('returns.new_return')}</Button></Link>
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
                  <td className="px-4 py-3" style={{ color: theme.inkMuted, fontSize: '13px' }}>{sr.date}</td>
                  <td className="px-4 py-3 font-mono" style={{ fontSize: '11px', color: theme.inkMuted }}>{sr.invoice_id.slice(0, 8)}…</td>
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
