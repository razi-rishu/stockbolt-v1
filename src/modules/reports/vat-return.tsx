import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { getAdapter } from '@/data';
import { useAuthStore } from '@/store/auth';
import { usePeriodPicker } from '@/hooks/use-period-picker';
import { PeriodPicker } from '@/ui/period-picker';
import { ReportActions } from '@/ui/report-actions';
import { OceanReport, ReportCard, ReportTableWrap, ReportMessage, Num, ltr } from '@/components/ocean-report';
import type { VATReturn, VATReturnRegionRow } from '@/data/adapter';

function fmt(n: number) {
  return new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n);
}

export default function VATReturnPage() {
  const { t } = useTranslation();
  const company_id = useAuthStore(s => s.company_id);

  // Phase 46b — range picker. GCC VAT quarters are fixed to the calendar, so
  // "This Quarter" (calendar) is exactly right here. Default = this quarter.
  const { preset, from, to, setPreset, setCustomRange } = usePeriodPicker('stockbolt.report.vat-return.period', 'this_quarter');

  const { data, isLoading: loading } = useQuery<VATReturn>({
    queryKey: ['vat_return', company_id, from, to],
    queryFn: () => getAdapter().reports.getVATReturn(company_id!, from, to),
    enabled: !!company_id,
  });

  const H = {
    section: t('rptOcean.col_section'), box: t('reports.box'), desc: t('reports.description'),
    taxable: t('reports.taxable_amount'), vat: t('reports.vat_amount'),
  };
  const exportRows: Record<string, unknown>[] = [];
  if (data) {
    for (const b of data.output_boxes) exportRows.push({ [H.section]: t('reports.vat_on_sales'), [H.box]: b.box, [H.desc]: b.label, [H.taxable]: b.taxable_amount.toFixed(2), [H.vat]: b.vat_amount.toFixed(2) });
    for (const b of data.input_boxes) exportRows.push({ [H.section]: t('reports.vat_on_expenses'), [H.box]: b.box, [H.desc]: b.label, [H.taxable]: b.taxable_amount.toFixed(2), [H.vat]: b.vat_amount.toFixed(2) });
    exportRows.push({ [H.section]: t('rptOcean.sec_summary'), [H.box]: '', [H.desc]: t('reports.net_vat_payable'), [H.taxable]: '', [H.vat]: data.net_vat_payable.toFixed(2) });
  }
  const exportHeaders = [H.section, H.box, H.desc, H.taxable, H.vat];

  const Section = ({ title, boxes, total, totalLabel }: { title: string; boxes: VATReturn['output_boxes']; total: number; totalLabel: string }) => (
    <ReportCard title={title}>
      <ReportTableWrap>
        <table className="sb-rpt-table" style={{ minWidth: 0 }}>
          <thead>
            <tr>
              <th>{t('reports.box')}</th>
              <th>{t('reports.description')}</th>
              <th className="num">{t('reports.taxable_amount')}</th>
              <th className="num">{t('reports.vat_amount')}</th>
            </tr>
          </thead>
          <tbody>
            {boxes.map((b) => (
              <tr key={b.box}>
                <td><span className="code">{b.box}</span></td>
                <td>{b.label}</td>
                <td className="num muted"><Num>{fmt(b.taxable_amount)}</Num></td>
                <td className="num"><Num>{fmt(b.vat_amount)}</Num></td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="sb-rpt-total">
              <td colSpan={3}>{totalLabel}</td>
              <td className="num"><Num>{fmt(total)}</Num></td>
            </tr>
          </tfoot>
        </table>
      </ReportTableWrap>
    </ReportCard>
  );

  // Place-wise breakdown (customer/supplier regions; emirates → VAT201 1a–1g).
  const RegionSection = ({ title, hint, rows, showTaxable }: { title: string; hint: string; rows: VATReturnRegionRow[]; showTaxable: boolean }) => (
    <ReportCard title={title}>
      <ReportTableWrap>
        <table className="sb-rpt-table" style={{ minWidth: 0 }}>
          <thead>
            <tr>
              <th>{t('reports.box')}</th>
              <th>{t('reports.place')}</th>
              {showTaxable && <th className="num">{t('reports.taxable_amount')}</th>}
              <th className="num">{t('reports.vat_amount')}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={`${r.region_name}-${i}`}>
                <td><span className="code">{r.box ?? '—'}</span></td>
                <td className={r.region_name === 'Unassigned' ? 'muted' : undefined}>
                  {r.region_name === 'Unassigned' ? t('rptOcean.unassigned') : r.region_name}
                </td>
                {showTaxable && <td className="num muted"><Num>{fmt(r.taxable_amount)}</Num></td>}
                <td className="num"><Num>{fmt(r.vat_amount)}</Num></td>
              </tr>
            ))}
          </tbody>
        </table>
      </ReportTableWrap>
      <p className="sb-rpt-foot">{hint}</p>
    </ReportCard>
  );

  const range = data
    ? t('rptOcean.range', { from: ltr(data.period_start), to: ltr(data.period_end) })
    : t('rptOcean.range', { from: ltr(from), to: ltr(to) });
  const refund = !!data && data.net_vat_payable < 0;

  return (
    <OceanReport
      testid="vat-return-ocean"
      title={t('reports.vat_return')}
      subtitle={range}
      controls={<>
        <PeriodPicker mode="range" preset={preset} from={from} to={to} onPresetChange={setPreset} onCustomRange={setCustomRange} />
        <ReportActions rows={exportRows} headers={exportHeaders} filename={`vat-return-${from}_${to}`} disabled={!data} />
      </>}
    >
      {loading && !data && <ReportCard><ReportMessage>{t('common.loading')}</ReportMessage></ReportCard>}

      {data && (
        <>
          <ReportCard
            figures={[
              { label: t('reports.total_output_vat'), value: <Num>{fmt(data.total_output_vat)}</Num> },
              { label: t('reports.total_input_vat'), value: <Num>{fmt(data.total_input_vat)}</Num> },
              {
                label: t('reports.net_vat_payable'),
                value: <Num>{fmt(Math.abs(data.net_vat_payable))}</Num>,
                note: refund ? t('reports.refund') : undefined,
                tone: refund ? 'good' : 'warn',
              },
            ]}
          />
          <div className="sb-rpt-grid">
            <Section title={t('reports.vat_on_sales')}    boxes={data.output_boxes} total={data.total_output_vat} totalLabel={t('reports.total_output_vat')} />
            <Section title={t('reports.vat_on_expenses')} boxes={data.input_boxes}  total={data.total_input_vat}  totalLabel={t('reports.total_input_vat')} />

            {data.output_by_region && data.output_by_region.length > 0 && (
              <RegionSection title={t('reports.vat_by_place')} hint={t('reports.vat_place_hint')} rows={data.output_by_region} showTaxable />
            )}
            {data.input_by_region && data.input_by_region.length > 0 && (
              <RegionSection title={t('reports.vat_input_by_place')} hint={t('reports.vat_input_place_hint')} rows={data.input_by_region} showTaxable={false} />
            )}
          </div>
        </>
      )}
    </OceanReport>
  );
}
