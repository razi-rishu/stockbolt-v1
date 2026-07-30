import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { getAdapter } from '@/data/index';
import { useAuthStore } from '@/store/auth';
import { usePeriodPicker } from '@/hooks/use-period-picker';
import { PeriodPicker } from '@/ui/period-picker';
import { ReportActions } from '@/ui/report-actions';
import type { FixedAssetRow } from '@/data/adapter';

/**
 * AC-5C — Fixed Asset Register.
 *
 * Every asset with cost, accumulated depreciation and net book value, grouped
 * by category. The on-book total is what should tie to the Fixed Assets section
 * of the Balance Sheet: accounts 17x0 (cost, debit) plus 1790 (accumulated,
 * credit) already net to NBV there, so the two figures are directly comparable.
 *
 * Read-only — it posts nothing. Disposed assets are excluded from the totals
 * because their cost and accumulated depreciation have been removed from the
 * books, but they remain listed for the audit trail.
 */

function fmt(n: number) {
  return n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

export default function FixedAssetRegisterPage() {
  const { t } = useTranslation();
  const { company_id } = useAuthStore();
  const { preset, from, to, setPreset, setCustomRange } =
    usePeriodPicker('stockbolt.report.fixed-asset-register.period', 'this_month');
  const asOf = to;

  const { data: assets = [], isFetching, error } = useQuery<FixedAssetRow[]>({
    queryKey: ['fixed_assets', company_id],
    queryFn: () => getAdapter().fixedAssets.list(company_id!),
    enabled: !!company_id,
  });

  /** Only assets in service by the as-of date are on the books that day. */
  const rows = useMemo(
    () => assets.filter((a) => a.in_service_date <= asOf),
    [assets, asOf],
  );

  const grouped = useMemo(() => {
    const map = new Map<string, FixedAssetRow[]>();
    for (const a of rows) {
      const key = a.category || t('reports.far_uncategorised');
      map.set(key, [...(map.get(key) ?? []), a]);
    }
    return [...map.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  }, [rows, t]);

  /** On-book only: a disposed asset's cost and accumulation are already out. */
  const onBook = rows.filter((a) => a.status !== 'disposed');
  const totals = {
    cost: round2(onBook.reduce((s, a) => s + Number(a.cost), 0)),
    accum: round2(onBook.reduce((s, a) => s + Number(a.accumulated_depreciation), 0)),
  };
  const nbv = round2(totals.cost - totals.accum);

  const exportRows: Record<string, unknown>[] = rows.map((a) => ({
    Category: a.category ?? '',
    Tag: a.asset_tag ?? '',
    Asset: a.name,
    'In service': a.in_service_date,
    Method: a.method === 'straight_line' ? 'Straight line' : 'Reducing balance',
    Cost: Number(a.cost).toFixed(2),
    Accumulated: Number(a.accumulated_depreciation).toFixed(2),
    'Book value': round2(Number(a.cost) - Number(a.accumulated_depreciation)).toFixed(2),
    Status: a.status,
  }));
  const exportHeaders = ['Category', 'Tag', 'Asset', 'In service', 'Method', 'Cost', 'Accumulated', 'Book value', 'Status'];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-xl font-semibold text-ink-primary">{t('reports.far_title')}</h1>
        <div data-print-hide className="flex flex-wrap items-center gap-2">
          <PeriodPicker mode="asOf" preset={preset} from={from} to={to} onPresetChange={setPreset} onCustomRange={setCustomRange} />
          <ReportActions rows={exportRows} headers={exportHeaders} filename={`fixed-asset-register-${asOf}`} />
        </div>
      </div>

      <p className="text-xs text-ink-tertiary">{t('reports.far_as_of', { date: asOf })}</p>
      {error && <p className="text-sm text-danger-600">{(error as Error).message}</p>}

      <div className="glass-card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-surface-subtle text-xs uppercase tracking-wide text-ink-tertiary">
              <tr>
                <th className="px-4 py-2 text-start">{t('reports.far_asset')}</th>
                <th className="px-4 py-2 text-start">{t('reports.far_in_service')}</th>
                <th className="px-4 py-2 text-start">{t('reports.far_method')}</th>
                <th className="px-4 py-2 text-end">{t('reports.far_cost')}</th>
                <th className="px-4 py-2 text-end">{t('reports.far_accumulated')}</th>
                <th className="px-4 py-2 text-end">{t('reports.far_nbv')}</th>
                <th className="px-4 py-2 text-start">{t('reports.far_status')}</th>
              </tr>
            </thead>
            <tbody>
              {isFetching && rows.length === 0 && (
                <tr><td colSpan={7} className="px-4 py-6 text-center text-ink-tertiary">{t('common.loading')}</td></tr>
              )}
              {!isFetching && rows.length === 0 && (
                <tr><td colSpan={7} className="px-4 py-6 text-center text-ink-tertiary">{t('reports.far_empty')}</td></tr>
              )}
              {grouped.map(([category, list]) => {
                const gOnBook = list.filter((a) => a.status !== 'disposed');
                const gCost = round2(gOnBook.reduce((s, a) => s + Number(a.cost), 0));
                const gAcc  = round2(gOnBook.reduce((s, a) => s + Number(a.accumulated_depreciation), 0));
                return (
                  <>
                    <tr key={`h-${category}`} className="border-t border-border-subtle bg-surface-subtle">
                      <td className="px-4 py-1.5 text-xs font-semibold uppercase tracking-wide text-ink-secondary" colSpan={7}>
                        {category}
                      </td>
                    </tr>
                    {list.map((a) => (
                      <tr key={a.id} className={`border-t border-border-subtle ${a.status === 'disposed' ? 'text-ink-tertiary' : ''}`}>
                        <td className="px-4 py-2">
                          <span className={a.status === 'disposed' ? '' : 'text-ink-primary'}>{a.name}</span>
                          {a.asset_tag && <span className="ms-2 text-xs text-ink-tertiary">{a.asset_tag}</span>}
                        </td>
                        <td className="px-4 py-2 text-ink-secondary">{a.in_service_date}</td>
                        <td className="px-4 py-2 text-ink-secondary">
                          {a.method === 'straight_line'
                            ? `${t('fa.method_straight_line')} · ${a.useful_life_months}m`
                            : `${t('fa.method_reducing_balance')} · ${Number(a.wdv_rate)}%`}
                        </td>
                        <td className="px-4 py-2 text-end text-ink-secondary">{fmt(Number(a.cost))}</td>
                        <td className="px-4 py-2 text-end text-ink-secondary">{fmt(Number(a.accumulated_depreciation))}</td>
                        <td className="px-4 py-2 text-end font-medium text-ink-primary">
                          {fmt(round2(Number(a.cost) - Number(a.accumulated_depreciation)))}
                        </td>
                        <td className="px-4 py-2 text-xs">{t(`fa.status_${a.status}`)}</td>
                      </tr>
                    ))}
                    <tr key={`s-${category}`} className="border-t border-border-subtle text-xs font-medium text-ink-secondary">
                      <td className="px-4 py-1.5" colSpan={3}>{t('reports.far_subtotal', { category })}</td>
                      <td className="px-4 py-1.5 text-end">{fmt(gCost)}</td>
                      <td className="px-4 py-1.5 text-end">{fmt(gAcc)}</td>
                      <td className="px-4 py-1.5 text-end">{fmt(round2(gCost - gAcc))}</td>
                      <td />
                    </tr>
                  </>
                );
              })}
            </tbody>
            {rows.length > 0 && (
              <tfoot>
                <tr className="border-t-2 border-border-strong bg-surface-subtle font-semibold text-ink-primary">
                  <td className="px-4 py-2" colSpan={3}>{t('reports.far_total_on_book')}</td>
                  <td className="px-4 py-2 text-end">{fmt(totals.cost)}</td>
                  <td className="px-4 py-2 text-end">{fmt(totals.accum)}</td>
                  <td className="px-4 py-2 text-end">{fmt(nbv)}</td>
                  <td />
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      </div>

      <p className="text-xs text-ink-tertiary">{t('reports.far_tie_hint')}</p>
    </div>
  );
}
