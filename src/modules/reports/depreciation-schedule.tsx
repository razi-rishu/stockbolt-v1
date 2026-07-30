import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { getAdapter } from '@/data/index';
import { useAuthStore } from '@/store/auth';
import { DocLink } from '@/ui/doc-link';
import { usePeriodPicker } from '@/hooks/use-period-picker';
import { PeriodPicker } from '@/ui/period-picker';
import { ReportActions } from '@/ui/report-actions';
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

function fmt(n: number) {
  return n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
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

  const exportRows: Record<string, unknown>[] = entries.map((e) => ({
    Period: e.period_end,
    Asset: assetOf(e.asset_id)?.name ?? '',
    Tag: assetOf(e.asset_id)?.asset_tag ?? '',
    Charge: Number(e.charge).toFixed(2),
    'Book value after': Number(e.book_value_after).toFixed(2),
    Status: e.reversed_at ? 'reversed' : 'posted',
  }));
  const exportHeaders = ['Period', 'Asset', 'Tag', 'Charge', 'Book value after', 'Status'];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-xl font-semibold text-ink-primary">{t('reports.ds_title')}</h1>
        <div data-print-hide className="flex flex-wrap items-center gap-2">
          <PeriodPicker mode="range" preset={preset} from={from} to={to} onPresetChange={setPreset} onCustomRange={setCustomRange} />
          <ReportActions rows={exportRows} headers={exportHeaders} filename={`depreciation-schedule-${from}_${to}`} />
        </div>
      </div>

      <p className="text-xs text-ink-tertiary">{t('reports.ds_range', { from, to })}</p>
      {error && <p className="text-sm text-danger-600">{(error as Error).message}</p>}

      {/* Per-month summary */}
      <div className="glass-card overflow-hidden">
        <div className="border-b border-border-subtle px-4 py-3">
          <h2 className="text-sm font-semibold text-ink-primary">{t('reports.ds_by_month')}</h2>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-surface-subtle text-xs uppercase tracking-wide text-ink-tertiary">
              <tr>
                <th className="px-4 py-2 text-start">{t('reports.ds_period')}</th>
                <th className="px-4 py-2 text-end">{t('reports.ds_assets')}</th>
                <th className="px-4 py-2 text-end">{t('reports.ds_charge')}</th>
              </tr>
            </thead>
            <tbody>
              {byMonth.length === 0 && (
                <tr><td colSpan={3} className="px-4 py-6 text-center text-ink-tertiary">{t('reports.ds_empty')}</td></tr>
              )}
              {byMonth.map((m) => (
                <tr key={m.period} className="border-t border-border-subtle">
                  <td className="px-4 py-2 text-ink-primary">{m.period}</td>
                  <td className="px-4 py-2 text-end text-ink-secondary">{m.count}</td>
                  <td className="px-4 py-2 text-end font-medium text-ink-primary">{fmt(m.charge)}</td>
                </tr>
              ))}
            </tbody>
            {byMonth.length > 0 && (
              <tfoot>
                <tr className="border-t-2 border-border-strong bg-surface-subtle font-semibold text-ink-primary">
                  <td className="px-4 py-2" colSpan={2}>{t('reports.ds_total')}</td>
                  <td className="px-4 py-2 text-end">{fmt(total)}</td>
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      </div>

      {/* Per-charge detail */}
      <div className="glass-card overflow-hidden">
        <div className="border-b border-border-subtle px-4 py-3">
          <h2 className="text-sm font-semibold text-ink-primary">{t('reports.ds_detail')}</h2>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-surface-subtle text-xs uppercase tracking-wide text-ink-tertiary">
              <tr>
                <th className="px-4 py-2 text-start">{t('reports.ds_period')}</th>
                <th className="px-4 py-2 text-start">{t('reports.far_asset')}</th>
                <th className="px-4 py-2 text-end">{t('reports.ds_charge')}</th>
                <th className="px-4 py-2 text-end">{t('reports.ds_book_after')}</th>
                <th className="px-4 py-2 text-start">{t('reports.ds_entry')}</th>
              </tr>
            </thead>
            <tbody>
              {isFetching && entries.length === 0 && (
                <tr><td colSpan={5} className="px-4 py-6 text-center text-ink-tertiary">{t('common.loading')}</td></tr>
              )}
              {!isFetching && entries.length === 0 && (
                <tr><td colSpan={5} className="px-4 py-6 text-center text-ink-tertiary">{t('reports.ds_empty')}</td></tr>
              )}
              {entries.map((e) => {
                const a = assetOf(e.asset_id);
                return (
                  <tr key={e.id} className={`border-t border-border-subtle ${e.reversed_at ? 'text-ink-tertiary line-through' : ''}`}>
                    <td className="px-4 py-2">{e.period_end}</td>
                    <td className="px-4 py-2">
                      <span className={e.reversed_at ? '' : 'text-ink-primary'}>{a?.name ?? '—'}</span>
                      {a?.asset_tag && <span className="ms-2 text-xs text-ink-tertiary">{a.asset_tag}</span>}
                    </td>
                    <td className="px-4 py-2 text-end text-ink-secondary">{fmt(Number(e.charge))}</td>
                    <td className="px-4 py-2 text-end text-ink-secondary">{fmt(Number(e.book_value_after))}</td>
                    <td className="px-4 py-2">
                      {e.journal_entry_id
                        ? <DocLink type="journal_entry" id={e.journal_entry_id} status={e.reversed_at ? 'reversed' : 'active'} />
                        : '—'}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      <p className="text-xs text-ink-tertiary">{t('reports.ds_tie_hint')}</p>
    </div>
  );
}
