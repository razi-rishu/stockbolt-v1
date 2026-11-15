/**
 * phase133 — Support inbox for StockBolt support operators: every ticket,
 * across companies, with filters and search. A company admin is NOT an
 * operator; support_inbox() refuses anyone outside support_operators, and
 * the guard below just keeps the page out of their way.
 */
import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Navigate, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Search } from 'lucide-react';
import { getAdapter } from '@/data/index';
import { OceanPage, OceanTable } from '@/components/ocean-list';
import { BackButton } from '@/ui/back-button';
import type { Column } from '@/ui/table';
import type { SupportInboxRow } from '@/data/adapter';
import { CATEGORIES, PRIORITIES, STATUSES, StatusPill, UnreadDot, fmtDateTime } from './labels';
import '@/styles/stockbolt-ocean-teal.css';

const PAGE = 50;

export default function SupportInboxPage() {
  const { t } = useTranslation();
  const countsQ = useQuery({ queryKey: ['support', 'unread'], queryFn: () => getAdapter().support.unreadCounts() });
  if (countsQ.isLoading) return <div className="sb-ocean sb-page"><div className="sb-card sb-empty">{t('common.loading')}</div></div>;
  if (!countsQ.data?.is_operator) return <Navigate to="/support" replace />;
  return <Inbox />;
}

function Inbox() {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const [status, setStatus] = useState('');
  const [category, setCategory] = useState('');
  const [priority, setPriority] = useState('');
  const [searchText, setSearchText] = useState('');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(0);
  // Search after typing pauses (AGENTS §13: 300 ms).
  useEffect(() => { const h = setTimeout(() => { setSearch(searchText); setPage(0); }, 300); return () => clearTimeout(h); }, [searchText]);

  const { data: rows = [], isLoading } = useQuery<SupportInboxRow[]>({
    queryKey: ['support', 'inbox', status, category, priority, search, page],
    queryFn: () => getAdapter().support.inbox({ status, category, priority, search, limit: PAGE, offset: page * PAGE }),
    refetchInterval: 60_000,
  });

  const columns: Column<SupportInboxRow>[] = [
    { key: 'no', header: t('support.col_ticket'), render: (x) => (
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
        {x.unread && <UnreadDot label={t('support.unread_message')} />}
        <bdi dir="ltr" className="sb-acct-code">{x.ticket_number}</bdi>
      </span>) },
    { key: 'subject', header: t('support.col_subject'), render: (x) => <span style={{ fontWeight: x.unread ? 700 : 500 }}>{x.subject}</span> },
    { key: 'company', header: t('support.col_company'), render: (x) => (
      <span><span>{x.company_name}</span>
        <span className="sb-fx-name" style={{ display: 'block', fontSize: 12 }}><bdi dir="ltr">{x.requester_email ?? ''}</bdi></span></span>) },
    { key: 'category', header: t('support.col_category'), render: (x) => t(`support.cat_${x.category}`) },
    { key: 'priority', header: t('support.col_priority'), render: (x) => t(`support.priority_${x.priority}`) },
    { key: 'status', header: t('support.col_status'), render: (x) => <StatusPill status={x.status} /> },
    { key: 'updated', header: t('support.col_updated'), render: (x) => <bdi dir="ltr">{fmtDateTime(x.updated_at, i18n.language)}</bdi> },
  ];
  const sel = (value: string, set: (v: string) => void, all: string, opts: { v: string; l: string }[], label: string) => (
    <select className="sb-pc-select" style={{ width: 'auto' }} aria-label={label} value={value} onChange={(e) => { set(e.target.value); setPage(0); }}>
      <option value="">{all}</option>
      {opts.map((o) => <option key={o.v} value={o.v}>{o.l}</option>)}
    </select>
  );

  return (
    <OceanPage
      testid="support-inbox"
      title={t('support.inbox_title')}
      subtitle={t('support.inbox_sub')}
      back={<BackButton to="/support" label={t('support.title')} />}
      below={
        <div className="sb-acct-filterbar" style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 12 }}>
          <label className="sb-search" style={{ margin: 0, flex: 1, minWidth: 200 }}>
            <Search size={18} className="sb-icon" aria-hidden="true" />
            <span className="sr-only">{t('support.search')}</span>
            <input type="search" placeholder={t('support.search')} value={searchText} onChange={(e) => setSearchText(e.target.value)} />
          </label>
          {sel(status, setStatus, t('support.all_statuses'), STATUSES.map((s) => ({ v: s, l: t(`support.status_${s}`) })), t('support.col_status'))}
          {sel(category, setCategory, t('support.all_categories'), CATEGORIES.map((c) => ({ v: c.key, l: t(`support.cat_${c.key}`) })), t('support.col_category'))}
          {sel(priority, setPriority, t('support.all_priorities'), PRIORITIES.map((p) => ({ v: p, l: t(`support.priority_${p}`) })), t('support.col_priority'))}
        </div>
      }
    >
      {isLoading
        ? <div className="sb-card sb-empty">{t('common.loading')}</div>
        : <OceanTable columns={columns} rows={rows} keyFn={(x) => x.id} onRowClick={(x) => navigate(`/support/tickets/${x.id}`)}
            emptyMessage={t('support.inbox_empty')} cardTitleKey="subject" />}
      <div className="flex justify-end gap-2" style={{ marginTop: 12 }}>
        <button type="button" className="sb-secondary-btn" disabled={page === 0} onClick={() => setPage(page - 1)}>{t('support.prev_page')}</button>
        <button type="button" className="sb-secondary-btn" disabled={rows.length < PAGE} onClick={() => setPage(page + 1)}>{t('support.next_page')}</button>
      </div>
    </OceanPage>
  );
}
