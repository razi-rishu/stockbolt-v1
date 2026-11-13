import { useState, useMemo } from 'react';
import { formatDate } from '@/lib/locale';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { getAdapter } from '@/data/index';
import { useAuthStore } from '@/store/auth';
import type { Column } from '@/ui/table';
import { OceanPage, OceanTable } from '@/components/ocean-list';
import { Plus } from 'lucide-react';
import type { JournalEntryRow } from '@/data/adapter';

function fmt(n: number) {
  return n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

type Tab = 'manual' | 'system' | 'all';
type JeRow = JournalEntryRow & { source_type?: string; reversed_by_id?: string | null };

export default function JournalEntriesPage() {
  const { t } = useTranslation();
  const { company_id } = useAuthStore();
  const navigate = useNavigate();
  // Phase 12.51 — default tab is "Manual" so the audit view is clean.
  // System-generated entries (invoice confirms, payments, etc.) live on
  // their own tab so the operator can sanity-check them without scrolling
  // past their own manual posts.
  const [tab, setTab] = useState<Tab>('manual');

  const { data: entries = [], isLoading } = useQuery({
    queryKey: ['journal_entries', company_id],
    queryFn: () => getAdapter().accounting.listJEs(company_id!, 200),
    enabled: !!company_id,
  });

  const all = entries as JeRow[];
  const manualCount = useMemo(() => all.filter(je => je.source_type === 'manual').length, [all]);
  const systemCount = all.length - manualCount;

  const filtered = useMemo(() => {
    if (tab === 'manual') return all.filter(je => je.source_type === 'manual');
    if (tab === 'system') return all.filter(je => je.source_type !== 'manual');
    return all;
  }, [all, tab]);

  // Labels for every source type the journal_entries CHECK allows; anything
  // new falls back to a readable form of the raw value.
  const srcLabel = (src: string) => t(`jeOcean.src_${src}`, { defaultValue: src.replace(/_/g, ' ') });

  const columns: Column<JeRow>[] = [
    { key: 'no', header: t('accounting.entry_number'), render: (je) => <bdi dir="ltr" className="sb-inv-no">{je.entry_number}</bdi> },
    { key: 'date', header: t('accounting.date'), render: (je) => <bdi dir="ltr">{formatDate(je.date)}</bdi> },
    { key: 'desc', header: t('accounting.description'), render: (je) => <span style={{ fontWeight: 600 }}>{je.description ?? '—'}</span> },
    {
      key: 'src', header: t('accounting.source_type'),
      render: (je) => je.source_type
        ? <span className={`sb-pill ${je.source_type === 'manual' ? '' : 'sb-pill-muted'}`} style={{ marginTop: 0 }}>{srcLabel(je.source_type)}</span>
        : '—',
    },
    { key: 'amt', header: t('accounting.debit'), align: 'end', render: (je) => <bdi dir="ltr" className="sb-dash-num">{fmt(Number(je.total_debit))}</bdi> },
    {
      key: 'status', header: '',
      render: (je) => je.reversed_by_id
        ? <span className="sb-pill sb-pill-bad" style={{ marginTop: 0 }}>{t('accounting.reversed')}</span>
        : <span className="sb-pill sb-pill-good" style={{ marginTop: 0 }}>{t('accounting.posted')}</span>,
    },
  ];

  const emptyMessage = tab === 'manual' ? t('jeOcean.empty_manual')
    : tab === 'system' ? t('jeOcean.empty_system')
    : t('accounting.je_empty');

  const chips: { v: Tab; label: string; count: number }[] = [
    { v: 'manual', label: t('jeOcean.tab_manual'), count: manualCount },
    { v: 'system', label: t('jeOcean.tab_system'), count: systemCount },
    { v: 'all',    label: t('common.all'),          count: all.length },
  ];

  // Ocean Teal (UI v1.1): look only — same entries, tabs and drill-in.
  return (
    <OceanPage
      testid="journal-entries-ocean"
      title={t('accounting.je_title')}
      subtitle={t('jeOcean.counts', { total: all.length, manual: manualCount, system: systemCount })}
      actions={<button type="button" className="sb-primary-btn sb-btn-inline" onClick={() => navigate('/accounting/journal-entries/new')}><Plus size={18} aria-hidden="true" />{t('accounting.new_je')}</button>}
      below={
        <div className="sb-chips" style={{ marginTop: 14 }} role="group" aria-label={t('accounting.source_type')}>
          {chips.map(c => (
            <button key={c.v} type="button" aria-pressed={tab === c.v} className={`sb-chip ${tab === c.v ? 'active' : ''}`} onClick={() => setTab(c.v)}>
              {c.label}<span className="sb-chip-count">{c.count}</span>
            </button>
          ))}
        </div>
      }
    >
      {isLoading
        ? <div className="sb-card sb-empty">{t('common.loading')}</div>
        : <OceanTable columns={columns} rows={filtered} keyFn={(je) => je.id} cardTitleKey="desc"
            onRowClick={(je) => navigate(`/accounting/journal-entries/${je.id}`)} rowMuted={(je) => !!je.reversed_by_id} emptyMessage={emptyMessage} />}
    </OceanPage>
  );
}
