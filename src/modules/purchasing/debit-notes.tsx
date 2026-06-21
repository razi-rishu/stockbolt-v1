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
import type { DebitNoteRow, ContactRow } from '@/data/adapter';

const fmt = (n: number) => n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export default function DebitNotesPage() {
  const { t } = useTranslation();
  const { company_id } = useAuthStore();
  const navigate = useNavigate();

  const { data: notes = [], isLoading } = useQuery<DebitNoteRow[]>({
    queryKey: ['debit_notes', company_id],
    queryFn:  () => getAdapter().debitNotes.list(company_id!),
    enabled:  !!company_id,
  });
  const { data: suppliers = [] } = useQuery<ContactRow[]>({
    queryKey: ['contacts', company_id, 'supplier'],
    queryFn: () => getAdapter().contacts.list(company_id!, 'supplier'),
    enabled: !!company_id,
  });
  const supplierName = (id: string) => suppliers.find(s => s.id === id)?.name ?? `${id.slice(0, 8)}…`;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
      <PageHeader
        title={t('returns.debit_notes_title')}
        subtitle={t('returns.debit_notes_desc')}
        actions={
          <Link to="/purchasing/debit-notes/new"><Button>+ {t('returns.new_debit_note')}</Button></Link>
        }
      />

      {isLoading ? (
        <p style={{ padding: '48px 0', textAlign: 'center', fontSize: '13px', color: theme.inkFaint }}>{t('common.loading')}</p>
      ) : notes.length === 0 ? (
        <p style={{ padding: '48px 0', textAlign: 'center', fontSize: '13px', color: theme.inkFaint }}>{t('returns.no_debit_notes')}</p>
      ) : (
        <div
          className="overflow-x-auto bg-white"
          style={{ border: `1px solid ${theme.border}`, borderRadius: '12px', boxShadow: theme.shadowSm }}
        >
          <table className="w-full text-sm">
            <thead>
              <tr style={{ background: theme.panelHead, borderBottom: `1px solid ${theme.border}` }}>
                {[
                  { l: t('returns.dn_number'),    a: 'start' as const },
                  { l: t('common.date'),          a: 'start' as const },
                  { l: t('common.supplier'),      a: 'start' as const },
                  { l: t('returns.reason'),       a: 'start' as const },
                  { l: t('returns.total_amount'), a: 'end'   as const },
                  { l: t('common.status'),        a: 'start' as const },
                  { l: '',                        a: 'end'   as const },
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
              {notes.map((dn, idx) => (
                <tr
                  key={dn.id}
                  onClick={() => navigate(`/purchasing/debit-notes/${dn.id}`)}
                  className="cursor-pointer"
                  style={{
                    borderTop: idx === 0 ? 'none' : '1px solid #f1f5f9',
                    transition: 'background-color .12s',
                  }}
                  onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = theme.panelHead; }}
                  onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = ''; }}
                >
                  <td className="px-4 py-3 font-mono" style={{ fontSize: '12px', color: theme.brandSoftText, fontWeight: 600 }}>{dn.debit_note_number}</td>
                  <td className="px-4 py-3" style={{ color: theme.inkMuted, fontSize: '13px' }}>{formatDate(dn.date)}</td>
                  <td className="px-4 py-3" style={{ color: theme.ink, fontSize: '13px' }}>{supplierName(dn.supplier_id)}</td>
                  <td className="px-4 py-3" style={{ color: theme.inkMuted, fontSize: '13px', textTransform: 'capitalize' }}>{dn.reason ?? '—'}</td>
                  <td className="px-4 py-3 font-mono" style={{ textAlign: 'end', fontSize: '13px', fontWeight: 600, color: theme.ink }}>{fmt(dn.total_amount)}</td>
                  <td className="px-4 py-3"><StatusBadge status={dn.status} /></td>
                  <td className="px-4 py-3" style={{ textAlign: 'end' }}>
                    <Link to={`/purchasing/debit-notes/${dn.id}`} style={{ fontSize: '11px', color: theme.brand, fontWeight: 600, textDecoration: 'none' }}>
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
