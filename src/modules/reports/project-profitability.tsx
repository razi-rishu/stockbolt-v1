import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { getAdapter } from '@/data/index';
import { useAuthStore } from '@/store/auth';
import { useProjectsEnabled } from '@/hooks/use-company-currency';
import { usePeriodPicker } from '@/hooks/use-period-picker';
import { PeriodPicker } from '@/ui/period-picker';
import { ReportActions } from '@/ui/report-actions';
import { StatusBadge } from '@/ui/status-badge';
import type { ProjectProfitabilityRow } from '@/data/adapter';

const fmt = (n: number) =>
  Number(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/**
 * Project Profitability — phase108, Stage 4 of the projects feature.
 *
 * Every figure comes from the ledger at read time via get_project_profitability;
 * nothing is stored (Rule 1). The estimates beside them are the operator's
 * budget, which is what makes the comparison worth showing.
 *
 * Revenue here is INVOICED, not collected — income accounts are credited when
 * an invoice is confirmed, so a job can show revenue with nothing received yet.
 * That matches the P&L; collection is an AR-aging question. The description
 * line under the title says so, because a job showing profit the owner has not
 * banked is exactly the kind of number that needs explaining once.
 */
export default function ProjectProfitabilityPage() {
  const { t } = useTranslation();
  const { company_id } = useAuthStore();
  const projectsEnabled = useProjectsEnabled();

  // Job costing is normally a lifetime question, not a monthly one, so the
  // default is all-time rather than this month.
  const { preset, from, to, setPreset, setCustomRange } =
    usePeriodPicker('stockbolt.report.project-profitability.period', 'all_time');

  // 'all' means unbounded: the RPC takes NULL rather than a sentinel date.
  const isAllTime = preset === 'all_time';
  const qFrom = isAllTime ? null : from;
  const qTo   = isAllTime ? null : to;

  const { data: rows = [], isFetching } = useQuery<ProjectProfitabilityRow[]>({
    queryKey: ['report_project_profitability', company_id, qFrom, qTo],
    queryFn:  () => getAdapter().reports.projectProfitability(company_id!, qFrom, qTo),
    enabled:  !!company_id && projectsEnabled,
  });

  const totalRevenue = rows.reduce((s, r) => s + Number(r.revenue), 0);
  const totalCost    = rows.reduce((s, r) => s + Number(r.cost), 0);
  const totalMargin  = totalRevenue - totalCost;

  const exportHeaders = [
    'Project', 'Customer', 'Status', 'Est. Revenue', 'Est. Cost',
    'Revenue', 'Cost', 'Margin', 'Margin %',
  ];
  const marginPct = (r: ProjectProfitabilityRow) =>
    Number(r.revenue) === 0 ? '' : ((Number(r.margin) / Number(r.revenue)) * 100).toFixed(1);
  const exportRows: Record<string, unknown>[] = rows.map(r => ({
    'Project': r.name,
    'Customer': r.contact_name ?? '',
    'Status': r.status,
    'Est. Revenue': Number(r.estimated_revenue).toFixed(2),
    'Est. Cost': Number(r.estimated_cost).toFixed(2),
    'Revenue': Number(r.revenue).toFixed(2),
    'Cost': Number(r.cost).toFixed(2),
    'Margin': Number(r.margin).toFixed(2),
    'Margin %': marginPct(r),
  }));

  if (!projectsEnabled) {
    return (
      <div className="py-16 text-center">
        <p className="text-sm text-ink-secondary">{t('projects.disabled')}</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-ink-primary">{t('projects.report_title')}</h1>
          <p className="text-sm text-ink-tertiary mt-1">{t('projects.report_desc')}</p>
        </div>
        <div data-print-hide className="flex flex-wrap items-center gap-2">
          <PeriodPicker
            preset={preset}
            from={from}
            to={to}
            onPresetChange={setPreset}
            onCustomRange={setCustomRange}
          />
          <ReportActions
            rows={exportRows}
            headers={exportHeaders}
            filename={`project-profitability-${isAllTime ? 'all-time' : to}`}
            disabled={rows.length === 0}
          />
        </div>
      </div>

      <div className="grid grid-cols-3 gap-4">
        <div className="bg-white border border-border-subtle rounded-lg p-4">
          <p className="text-xs font-medium text-ink-tertiary uppercase tracking-wide">{t('projects.revenue')}</p>
          <p className="text-2xl font-bold text-green-600 mt-1" dir="ltr">{fmt(totalRevenue)}</p>
        </div>
        <div className="bg-white border border-border-subtle rounded-lg p-4">
          <p className="text-xs font-medium text-ink-tertiary uppercase tracking-wide">{t('projects.cost')}</p>
          <p className="text-2xl font-bold text-red-600 mt-1" dir="ltr">{fmt(totalCost)}</p>
        </div>
        <div className="bg-white border border-border-subtle rounded-lg p-4">
          <p className="text-xs font-medium text-ink-tertiary uppercase tracking-wide">{t('projects.margin')}</p>
          <p className={`text-2xl font-bold mt-1 ${totalMargin >= 0 ? 'text-green-700' : 'text-red-600'}`} dir="ltr">
            {fmt(totalMargin)}
          </p>
        </div>
      </div>

      <div className="bg-white border border-border-subtle rounded-lg overflow-hidden">
        {isFetching && rows.length === 0 ? (
          <p className="p-8 text-center text-sm text-ink-tertiary">{t('common.loading')}</p>
        ) : rows.length === 0 ? (
          <p className="p-8 text-center text-ink-tertiary">{t('projects.empty')}</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-surface-muted border-b border-border-subtle">
                <tr>
                  <th className="px-4 py-3 text-start font-medium text-ink-secondary">{t('projects.name')}</th>
                  <th className="px-4 py-3 text-start font-medium text-ink-secondary">{t('projects.customer')}</th>
                  <th className="px-4 py-3 text-start font-medium text-ink-secondary">{t('projects.status')}</th>
                  <th className="px-4 py-3 text-end font-medium text-ink-secondary">{t('projects.est_revenue')}</th>
                  <th className="px-4 py-3 text-end font-medium text-ink-secondary">{t('projects.est_cost')}</th>
                  <th className="px-4 py-3 text-end font-medium text-ink-secondary">{t('projects.revenue')}</th>
                  <th className="px-4 py-3 text-end font-medium text-ink-secondary">{t('projects.cost')}</th>
                  <th className="px-4 py-3 text-end font-medium text-ink-secondary">{t('projects.margin')}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border-subtle">
                {rows.map(r => (
                  <tr key={r.project_id} className="hover:bg-surface-muted transition-colors">
                    <td className="px-4 py-3 font-medium text-ink-primary">
                      {r.name}
                      {/* gl_rows distinguishes "nothing posted" from "posted and
                          nets to zero" — identical numbers, different meaning. */}
                      {r.gl_rows === 0 && (
                        <span className="ms-2 text-xs text-ink-tertiary">{t('projects.nothing_posted')}</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-ink-secondary">{r.contact_name ?? '—'}</td>
                    <td className="px-4 py-3"><StatusBadge status={r.status} /></td>
                    {/* Numbers stay LTR inside RTL text — AGENTS.md section 15. */}
                    <td className="px-4 py-3 text-end text-ink-tertiary" dir="ltr">{fmt(r.estimated_revenue)}</td>
                    <td className="px-4 py-3 text-end text-ink-tertiary" dir="ltr">{fmt(r.estimated_cost)}</td>
                    <td className="px-4 py-3 text-end text-green-600 font-semibold" dir="ltr">{fmt(r.revenue)}</td>
                    <td className="px-4 py-3 text-end text-red-600 font-semibold" dir="ltr">{fmt(r.cost)}</td>
                    <td
                      className={`px-4 py-3 text-end font-bold ${Number(r.margin) >= 0 ? 'text-ink-primary' : 'text-red-600'}`}
                      dir="ltr"
                    >
                      {fmt(r.margin)}
                      {Number(r.revenue) !== 0 && (
                        <span className="ms-1 text-xs font-normal text-ink-tertiary">
                          ({marginPct(r)}%)
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot className="bg-surface-muted border-t-2 border-border-subtle">
                <tr>
                  <td colSpan={5} className="px-4 py-3 text-sm font-semibold text-ink-secondary">
                    {t('common.total')}
                  </td>
                  <td className="px-4 py-3 text-end font-bold text-green-600" dir="ltr">{fmt(totalRevenue)}</td>
                  <td className="px-4 py-3 text-end font-bold text-red-600" dir="ltr">{fmt(totalCost)}</td>
                  <td
                    className={`px-4 py-3 text-end font-bold ${totalMargin >= 0 ? 'text-ink-primary' : 'text-red-600'}`}
                    dir="ltr"
                  >
                    {fmt(totalMargin)}
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
