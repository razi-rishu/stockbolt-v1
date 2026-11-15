import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { getAdapter } from '@/data/index';
import { useAuthStore } from '@/store/auth';
import { DocLink } from '@/ui/doc-link';
import { usePeriodPicker } from '@/hooks/use-period-picker';
import { PeriodPicker } from '@/ui/period-picker';
import { ReportActions } from '@/ui/report-actions';
import { OceanReport, ReportCard, ReportMessage, ReportTable, exportFromColumns, money as fmt, Num, ltr, type ReportColumn } from '@/components/ocean-report';
import type { DepreciationEntryRow, FixedAssetRow } from '@/data/adapter';

/**
 * AC-5C — Depreciation Schedule.
 *
 * Every depreciation charge posted in the window, with a per-month summary.
 * The period total is what hit 6750 Depreciation Expense, so it should agree
 * with that account on the P&L for the same range — a quick way to spot a
 * missed or double run.
 *
 * Read-only. Reversed entries are shown struck through for the audit trail but
 * excluded from every total, since their JE has been backed out of the ledger.
 */

const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

export default function DepreciationSchedulePage() {
  const { t } = useTranslation();
  const { company_id } = useAuthStore();
  const { preset, from, to, setPreset, setCustomRange } =
    usePeriodPicker('stockbolt.report.depreciation-schedule.period', 'this_year');

  const { data: entries = [], isFetching, error } = useQuery<DepreciationEntryRow[]>({
    queryKey: ['depreciation_entries_period', company_id, from, to],
    queryFn: () => getAdapter().fixedAssets.listEntriesForPeriod(company_id!, from, to),
    enabled: !!company_id,
  });

  const { data: assets = [] } = useQuery<FixedAssetRow[]>({
    queryKey: ['fixed_assets', company_id],
    queryFn: () => getAdapter().fixedAssets.list(company_id!),
    enabled: !!company_id,
  });
  const assetOf = (id: string) => assets.find((a) => a.id === id);

  const live = useMemo(() => entries.filter((e) => !e.reversed_at), [entries]);

  /** Per-month totals — the shape you compare against 6750 on the P&L. */
  const byMonth = useMemo(() => {
    const map = new Map<string, { period: string; count: number; charge: number }>();
    for (const e of live) {
      const row = map.get(e.period_end) ?? { period: e.period_end, count: 0, charge: 0 };
      row.count += 1;
      row.charge = round2(row.charge + Number(e.charge));
      map.set(e.period_end, row);
    }
    return [...map.values()].sort((a, b) => a.period.localeCompare(b.period));
  }, [live]);

  const total = round2(live.reduce((s, e) => s + Number(e.charge), 0));

  type Month = typeof byMonth[number];
  const monthCols: ReportColumn<Month>[] = [
    { key: 'period', header: t('reports.ds_period'), cls: 'strong', cell: m => <Num>{m.period}</Num> },
    { key: 'count', header: t('reports.ds_assets'), num: true, cls: 'muted', cell: m => m.count },
    { key: 'charge', header: t('reports.ds_charge'), num: true, cls: 'strong', cell: m => fmt(m.charge), foot: fmt(total) },
  ];
  // The detail list is what goes to Excel, reversed entries included.
  const detailCols: ReportColumn<DepreciationEntryRow>[] = [
    { key: 'period', header: t('reports.ds_period'), cell: e => <Num>{e.period_end}</Num>, exp: e => e.period_end },
    {
      key: 'asset', header: t('reports.far_asset'),
      cell: e => { const a = assetOf(e.asset_id); return <span className="sb-rpt-acct"><span className="strong">{a?.name ?? '—'}</span>{a?.asset_tag && <bdi dir="ltr" className="code">{a.asset_tag}</bdi>}</span>; },
      exp: e => assetOf(e.asset_id)?.name ?? '',
    },
    { key: 'charge', header: t('reports.ds_charge'), num: true, cell: e => fmt(Number(e.charge)), exp: e => Number(e.charge).toFixed(2) },
    { key: 'after', header: t('reports.ds_book_after'), num: true, cls: 'muted', cell: e => fmt(Number(e.book_value_after)), exp: e => Number(e.book_value_after).toFixed(2) },
    {
      key: 'entry', header: t('reports.ds_entry'),
      cell: e => (e.journal_entry_id ? <DocLink type="journal_entry" id={e.journal_entry_id} status={e.reversed_at ? 'reversed' : 'active'} /> : '—'),
    },
  ];
  const xl = exportFromColumns<DepreciationEntryRow>([
    detailCols[0], detailCols[1],
    { key: 'tag', header: t('rptOcean.col_tag'), cell: e => assetOf(e.asset_id)?.asset_tag ?? '', exp: e => assetOf(e.asset_id)?.asset_tag ?? '' },
    detailCols[2], detailCols[3],
    { key: 'status', header: t('reports.far_status'), cell: () => '', exp: e => (e.reversed_at ? t('rptOcean.status_reversed') : t('rptOcean.status_posted')) },
  ], entries);

  return (
    <OceanReport
      testid="depreciation-schedule-ocean"
      title={t('reports.ds_title')}
      subtitle={t('reports.ds_range', { from: ltr(from), to: ltr(to) })}
      controls={<>
        <PeriodPicker mode="range" preset={preset} from={from} to={to} onPresetChange={setPreset} onCustomRange={setCustomRange} />
        <ReportActions rows={xl.rows} headers={xl.headers} filename={`depreciation-schedule-${from}_${to}`} />
      </>}
    >
      {error && <ReportCard><ReportMessage tone="bad">{(error as Error).message}</ReportMessage></ReportCard>}

      {/* Per-month summary */}
      <ReportCard
        title={t('reports.ds_by_month')}
        figures={byMonth.length > 0 ? [
          { label: t('rptOcean.fig_charges'), value: <Num>{live.length}</Num> },
          { label: t('reports.ds_total'), value: <Num>{fmt(total)}</Num>, tone: 'brand' },
        ] : undefined}
      >
        {byMonth.length === 0
          ? <ReportMessage>{isFetching ? t('common.loading') : t('reports.ds_empty')}</ReportMessage>
          : <ReportTable columns={monthCols} rows={byMonth} rowKey={m => m.period} footLabel={t('reports.ds_total')} minWidth={420} />}
        <p className="sb-rpt-foot">{t('reports.ds_tie_hint')}</p>
      </ReportCard>

      {/* Per-charge detail */}
      <ReportCard title={t('reports.ds_detail')}>
        {entries.length === 0
          ? <ReportMessage>{isFetching ? t('common.loading') : t('reports.ds_empty')}</ReportMessage>
          : <ReportTable columns={detailCols} rows={entries} rowKey={e => e.id} rowCls={e => (e.reversed_at ? 'is-reversed' : undefined)} minWidth={720} />}
      </ReportCard>
    </OceanReport>
  );
}
