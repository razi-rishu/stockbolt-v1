import { Fragment, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { getAdapter } from '@/data/index';
import { useAuthStore } from '@/store/auth';
import { usePeriodPicker } from '@/hooks/use-period-picker';
import { PeriodPicker } from '@/ui/period-picker';
import { ReportActions } from '@/ui/report-actions';
import { OceanReport, ReportCard, ReportMessage, ReportTableWrap, money as fmt, Num, ltr } from '@/components/ocean-report';
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
    // A voided asset was entered in error and never reached the ledger.
    () => assets.filter((a) => a.in_service_date <= asOf && a.status !== 'void'),
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

  const methodLabel = (a: FixedAssetRow) => (a.method === 'straight_line' ? t('fa.method_straight_line') : t('fa.method_reducing_balance'));
  // Excel columns follow the screen language.
  const H = {
    category: t('rptOcean.col_category'), tag: t('rptOcean.col_tag'), asset: t('reports.far_asset'),
    inService: t('reports.far_in_service'), method: t('reports.far_method'), cost: t('reports.far_cost'),
    accum: t('reports.far_accumulated'), nbv: t('reports.far_nbv'), status: t('reports.far_status'),
  };
  const exportRows: Record<string, unknown>[] = rows.map((a) => ({
    [H.category]: a.category ?? '',
    [H.tag]: a.asset_tag ?? '',
    [H.asset]: a.name,
    [H.inService]: a.in_service_date,
    [H.method]: methodLabel(a),
    [H.cost]: Number(a.cost).toFixed(2),
    [H.accum]: Number(a.accumulated_depreciation).toFixed(2),
    [H.nbv]: round2(Number(a.cost) - Number(a.accumulated_depreciation)).toFixed(2),
    [H.status]: t(`fa.status_${a.status}`),
  }));
  const exportHeaders = [H.category, H.tag, H.asset, H.inService, H.method, H.cost, H.accum, H.nbv, H.status];

  return (
    <OceanReport
      testid="fixed-asset-register-ocean"
      title={t('reports.far_title')}
      subtitle={t('reports.far_as_of', { date: ltr(asOf) })}
      controls={<>
        <PeriodPicker mode="asOf" preset={preset} from={from} to={to} onPresetChange={setPreset} onCustomRange={setCustomRange} />
        <ReportActions rows={exportRows} headers={exportHeaders} filename={`fixed-asset-register-${asOf}`} />
      </>}
    >
      {error && <ReportCard><ReportMessage tone="bad">{(error as Error).message}</ReportMessage></ReportCard>}

      <ReportCard
        figures={rows.length > 0 ? [
          { label: t('reports.far_cost'), value: <Num>{fmt(totals.cost)}</Num> },
          { label: t('reports.far_accumulated'), value: <Num>{fmt(totals.accum)}</Num> },
          { label: t('reports.far_nbv'), value: <Num>{fmt(nbv)}</Num>, tone: 'brand' },
        ] : undefined}
      >
        {rows.length === 0 ? (
          <ReportMessage>{isFetching ? t('common.loading') : t('reports.far_empty')}</ReportMessage>
        ) : (
          <>
            <ReportTableWrap>
              <table className="sb-rpt-table sb-rpt-flat" style={{ minWidth: 860 }}>
                <thead>
                  <tr>
                    <th>{t('reports.far_asset')}</th>
                    <th>{t('reports.far_in_service')}</th>
                    <th>{t('reports.far_method')}</th>
                    <th className="num">{t('reports.far_cost')}</th>
                    <th className="num">{t('reports.far_accumulated')}</th>
                    <th className="num">{t('reports.far_nbv')}</th>
                    <th>{t('reports.far_status')}</th>
                  </tr>
                </thead>
                <tbody>
                  {grouped.map(([category, list]) => {
                    const gOnBook = list.filter((a) => a.status !== 'disposed');
                    const gCost = round2(gOnBook.reduce((s, a) => s + Number(a.cost), 0));
                    const gAcc  = round2(gOnBook.reduce((s, a) => s + Number(a.accumulated_depreciation), 0));
                    return (
                      <Fragment key={category}>
                        <tr className="sb-rpt-section"><td colSpan={7}>{category}</td></tr>
                        {list.map((a) => (
                          <tr key={a.id} className={a.status === 'disposed' ? 'is-dim' : undefined}>
                            <td>
                              <span className="sb-rpt-acct">
                                <span className="strong">{a.name}</span>
                                {a.asset_tag && <bdi dir="ltr" className="code">{a.asset_tag}</bdi>}
                              </span>
                            </td>
                            <td className="muted"><Num>{a.in_service_date}</Num></td>
                            <td className="muted">
                              {a.method === 'straight_line'
                                ? <>{t('fa.method_straight_line')} · <Num>{a.useful_life_months}m</Num></>
                                : <>{t('fa.method_reducing_balance')} · <Num>{Number(a.wdv_rate)}%</Num></>}
                            </td>
                            <td className="num muted"><Num>{fmt(Number(a.cost))}</Num></td>
                            <td className="num muted"><Num>{fmt(Number(a.accumulated_depreciation))}</Num></td>
                            <td className="num strong"><Num>{fmt(round2(Number(a.cost) - Number(a.accumulated_depreciation)))}</Num></td>
                            <td><span className={`sb-pill ${a.status === 'active' ? 'sb-pill-good' : 'sb-pill-muted'}`}>{t(`fa.status_${a.status}`)}</span></td>
                          </tr>
                        ))}
                        <tr className="sb-rpt-subtotal">
                          <td colSpan={3}>{t('reports.far_subtotal', { category })}</td>
                          <td className="num"><Num>{fmt(gCost)}</Num></td>
                          <td className="num"><Num>{fmt(gAcc)}</Num></td>
                          <td className="num"><Num>{fmt(round2(gCost - gAcc))}</Num></td>
                          <td />
                        </tr>
                      </Fragment>
                    );
                  })}
                </tbody>
                <tfoot>
                  <tr className="sb-rpt-total">
                    <td colSpan={3}>{t('reports.far_total_on_book')}</td>
                    <td className="num"><Num>{fmt(totals.cost)}</Num></td>
                    <td className="num"><Num>{fmt(totals.accum)}</Num></td>
                    <td className="num"><Num>{fmt(nbv)}</Num></td>
                    <td />
                  </tr>
                </tfoot>
              </table>
            </ReportTableWrap>
            <p className="sb-rpt-foot">{t('reports.far_tie_hint')}</p>
          </>
        )}
      </ReportCard>
    </OceanReport>
  );
}
