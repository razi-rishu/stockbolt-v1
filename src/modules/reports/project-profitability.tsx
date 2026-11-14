import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { getAdapter } from '@/data/index';
import { useAuthStore } from '@/store/auth';
import { useProjectsEnabled } from '@/hooks/use-company-currency';
import { usePeriodPicker } from '@/hooks/use-period-picker';
import { PeriodPicker } from '@/ui/period-picker';
import { ReportActions } from '@/ui/report-actions';
import { StatusBadge } from '@/ui/status-badge';
import { OceanReport, ReportCard, ReportTableWrap, ReportMessage, Num } from '@/components/ocean-report';
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

  // Excel columns follow the screen language.
  const H = {
    project: t('projects.name'), customer: t('projects.customer'), status: t('projects.status'),
    estRev: t('projects.est_revenue'), estCost: t('projects.est_cost'), revenue: t('projects.revenue'),
    cost: t('projects.cost'), margin: t('projects.margin'), marginPct: t('rptOcean.col_margin_pct'),
  };
  const exportHeaders = [H.project, H.customer, H.status, H.estRev, H.estCost, H.revenue, H.cost, H.margin, H.marginPct];
  const marginPct = (r: ProjectProfitabilityRow) =>
    Number(r.revenue) === 0 ? '' : ((Number(r.margin) / Number(r.revenue)) * 100).toFixed(1);
  const exportRows: Record<string, unknown>[] = rows.map(r => ({
    [H.project]: r.name,
    [H.customer]: r.contact_name ?? '',
    [H.status]: r.status,
    [H.estRev]: Number(r.estimated_revenue).toFixed(2),
    [H.estCost]: Number(r.estimated_cost).toFixed(2),
    [H.revenue]: Number(r.revenue).toFixed(2),
    [H.cost]: Number(r.cost).toFixed(2),
    [H.margin]: Number(r.margin).toFixed(2),
    [H.marginPct]: marginPct(r),
  }));

  if (!projectsEnabled) {
    return (
      <OceanReport testid="project-profitability-ocean" title={t('projects.report_title')}>
        <ReportCard><ReportMessage>{t('projects.disabled')}</ReportMessage></ReportCard>
      </OceanReport>
    );
  }

  const neg = (n: number) => (n < 0 ? `(${fmt(-n)})` : fmt(n));

  return (
    <OceanReport
      testid="project-profitability-ocean"
      title={t('projects.report_title')}
      subtitle={t('projects.report_desc')}
      controls={<>
        <PeriodPicker preset={preset} from={from} to={to} onPresetChange={setPreset} onCustomRange={setCustomRange} />
        <ReportActions
          rows={exportRows}
          headers={exportHeaders}
          filename={`project-profitability-${isAllTime ? 'all-time' : to}`}
          disabled={rows.length === 0}
        />
      </>}
    >
      <ReportCard
        figures={[
          { label: t('projects.revenue'), value: <Num>{fmt(totalRevenue)}</Num> },
          { label: t('projects.cost'), value: <Num>{fmt(totalCost)}</Num> },
          { label: t('projects.margin'), value: <Num>{neg(totalMargin)}</Num>, tone: totalMargin >= 0 ? 'good' : 'bad' },
        ]}
      >
        {isFetching && rows.length === 0 ? (
          <ReportMessage>{t('common.loading')}</ReportMessage>
        ) : rows.length === 0 ? (
          <ReportMessage>{t('projects.empty')}</ReportMessage>
        ) : (
          <ReportTableWrap>
            <table className="sb-rpt-table" style={{ minWidth: 820 }}>
              <thead>
                <tr>
                  <th>{t('projects.name')}</th>
                  <th>{t('projects.customer')}</th>
                  <th>{t('projects.status')}</th>
                  <th className="num">{t('projects.est_revenue')}</th>
                  <th className="num">{t('projects.est_cost')}</th>
                  <th className="num">{t('projects.revenue')}</th>
                  <th className="num">{t('projects.cost')}</th>
                  <th className="num">{t('projects.margin')}</th>
                </tr>
              </thead>
              <tbody>
                {rows.map(r => (
                  <tr key={r.project_id}>
                    <td style={{ fontWeight: 600 }}>
                      {r.name}
                      {/* gl_rows distinguishes "nothing posted" from "posted and
                          nets to zero" — identical numbers, different meaning. */}
                      {r.gl_rows === 0 && <span className="muted" style={{ marginInlineStart: 8, fontSize: 12, fontWeight: 400 }}>{t('projects.nothing_posted')}</span>}
                    </td>
                    <td className="muted">{r.contact_name ?? '—'}</td>
                    <td><StatusBadge status={r.status} /></td>
                    <td className="num muted"><Num>{fmt(r.estimated_revenue)}</Num></td>
                    <td className="num muted"><Num>{fmt(r.estimated_cost)}</Num></td>
                    <td className="num"><Num>{fmt(r.revenue)}</Num></td>
                    <td className="num"><Num>{fmt(r.cost)}</Num></td>
                    <td className={`num ${Number(r.margin) >= 0 ? '' : 'is-down'}`} style={{ fontWeight: 700 }}>
                      <Num>{neg(Number(r.margin))}</Num>
                      {Number(r.revenue) !== 0 && <span className="muted" style={{ marginInlineStart: 6, fontSize: 12, fontWeight: 400 }}><Num>({marginPct(r)}%)</Num></span>}
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className={`sb-rpt-total ${totalMargin >= 0 ? '' : 'is-bad'}`}>
                  <td colSpan={5}>{t('rptOcean.total')}</td>
                  <td className="num"><Num>{fmt(totalRevenue)}</Num></td>
                  <td className="num"><Num>{fmt(totalCost)}</Num></td>
                  <td className="num"><Num>{neg(totalMargin)}</Num></td>
                </tr>
              </tfoot>
            </table>
          </ReportTableWrap>
        )}
      </ReportCard>
    </OceanReport>
  );
}
