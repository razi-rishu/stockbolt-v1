/**
 * phase133 — Help & Support home: four ways to reach the StockBolt team, and
 * the user's own requests below. Tickets are private to their author (company
 * admins do not see their staff's requests).
 */
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Inbox } from 'lucide-react';
import { getAdapter } from '@/data/index';
import { useAuthStore } from '@/store/auth';
import { OceanPage, OceanTable } from '@/components/ocean-list';
import type { Column } from '@/ui/table';
import type { SupportTicketRow } from '@/data/adapter';
import { CATEGORIES, StatusPill, UnreadDot, fmtDateTime } from './labels';
import '@/styles/stockbolt-ocean-teal.css';

export default function SupportHomePage() {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const { user_id } = useAuthStore();
  const { data: tickets = [], isLoading } = useQuery<SupportTicketRow[]>({
    queryKey: ['support', 'mine'],
    queryFn: () => getAdapter().support.listMyTickets(),
  });
  const { data: counts } = useQuery({
    queryKey: ['support', 'unread'],
    queryFn: () => getAdapter().support.unreadCounts(),
  });
  // An operator also sees every ticket through RLS; "My requests" are their own.
  const mine = tickets.filter((x) => x.created_by === user_id);

  const unread = (x: SupportTicketRow) =>
    !!x.last_operator_message_at && x.last_operator_message_at > x.user_last_read_at;

  const columns: Column<SupportTicketRow>[] = [
    { key: 'no', header: t('support.col_ticket'), render: (x) => (
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
        {unread(x) && <UnreadDot label={t('support.unread_reply')} />}
        <bdi dir="ltr" className="sb-acct-code">{x.ticket_number}</bdi>
      </span>
    ) },
    { key: 'subject', header: t('support.col_subject'), render: (x) => <span style={{ fontWeight: unread(x) ? 700 : 500 }}>{x.subject}</span> },
    { key: 'category', header: t('support.col_category'), render: (x) => t(`support.cat_${x.category}`) },
    { key: 'status', header: t('support.col_status'), render: (x) => <StatusPill status={x.status} /> },
    { key: 'updated', header: t('support.col_updated'), render: (x) => <bdi dir="ltr">{fmtDateTime(x.updated_at, i18n.language)}</bdi> },
  ];

  return (
    <OceanPage
      testid="support-home"
      title={t('support.title')}
      subtitle={t('support.subtitle')}
      actions={counts?.is_operator ? (
        <button type="button" className="sb-secondary-btn sb-btn-inline" onClick={() => navigate('/support/inbox')}>
          <Inbox size={17} aria-hidden="true" /> {t('support.inbox_title')}
          {counts.inbox > 0 && <span className="sb-support-count">{counts.inbox}</span>}
        </button>
      ) : undefined}
    >
      <div className="sb-support-cards">
        {CATEGORIES.map((c) => (
          <button key={c.key} type="button" className="sb-card sb-support-card" onClick={() => navigate(`/support/new/${c.key}`)}>
            <span className="sb-side-ico" aria-hidden="true">{c.icon}</span>
            <span className="sb-support-card-txt">
              <span className="sb-support-card-title">{t(`support.cat_${c.key}`)}</span>
              <span className="sb-support-card-sub">{t(`support.cat_${c.key}_sub`)}</span>
            </span>
          </button>
        ))}
      </div>

      <h2 className="sb-doc-card-title" style={{ margin: '20px 0 10px' }}>{t('support.my_requests')}</h2>
      {isLoading
        ? <div className="sb-card sb-empty">{t('common.loading')}</div>
        : <OceanTable columns={columns} rows={mine} keyFn={(x) => x.id} onRowClick={(x) => navigate(`/support/tickets/${x.id}`)}
            emptyMessage={t('support.no_requests')} cardTitleKey="subject" />}
    </OceanPage>
  );
}

