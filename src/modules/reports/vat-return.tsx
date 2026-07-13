import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { getAdapter } from '@/data';
import { useAuthStore } from '@/store/auth';
import { PageHeader } from '@/ui/primitives';
import { theme } from '@/ui/theme';
import { usePeriodPicker } from '@/hooks/use-period-picker';
import { PeriodPicker } from '@/ui/period-picker';
import { ReportActions } from '@/ui/report-actions';
import type { VATReturn, VATReturnRegionRow } from '@/data/adapter';

function fmt(n: number) {
  return new Intl.NumberFormat(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n);
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

  const exportRows: Record<string, unknown>[] = [];
  if (data) {
    for (const b of data.output_boxes) exportRows.push({ Section: 'VAT on Sales', Box: b.box, Description: b.label, 'Taxable Amount': b.taxable_amount.toFixed(2), 'VAT Amount': b.vat_amount.toFixed(2) });
    for (const b of data.input_boxes) exportRows.push({ Section: 'VAT on Expenses', Box: b.box, Description: b.label, 'Taxable Amount': b.taxable_amount.toFixed(2), 'VAT Amount': b.vat_amount.toFixed(2) });
    exportRows.push({ Section: 'Summary', Box: '', Description: 'Net VAT Payable', 'Taxable Amount': '', 'VAT Amount': data.net_vat_payable.toFixed(2) });
  }
  const exportHeaders = ['Section', 'Box', 'Description', 'Taxable Amount', 'VAT Amount'];

  const Section = ({ title, boxes, total, totalLabel }: { title: string; boxes: VATReturn['output_boxes']; total: number; totalLabel: string }) => (
    <div style={{
      background: theme.card, border: `1px solid ${theme.border}`,
      borderRadius: '12px', boxShadow: theme.shadowSm, overflow: 'hidden',
    }}>
      <div style={{ background: theme.panelHead, borderBottom: `1px solid ${theme.border}`, padding: '10px 16px' }}>
        <span style={{ fontSize: '11px', fontWeight: 700, color: theme.inkMuted, textTransform: 'uppercase', letterSpacing: '.06em' }}>{title}</span>
      </div>
      <table className="w-full text-sm">
        <thead>
          <tr style={{ borderBottom: `1px solid ${theme.border}` }}>
            {[
              { l: t('reports.box'),            a: 'start' as const },
              { l: t('reports.description'),    a: 'start' as const },
              { l: t('reports.taxable_amount'), a: 'end'   as const },
              { l: t('reports.vat_amount'),     a: 'end'   as const },
            ].map(c => (
              <th key={c.l} className="px-4 py-2" style={{
                fontSize: '11px', fontWeight: 600, color: theme.inkMuted,
                textTransform: 'uppercase', letterSpacing: '.06em',
                textAlign: c.a,
              }}>{c.l}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {boxes.map((b, i) => (
            <tr key={b.box} style={{ borderTop: i === 0 ? 'none' : '1px solid #f1f5f9' }}>
              <td className="px-4 py-2 font-mono" style={{ color: theme.inkMuted, fontSize: '12px' }}>{b.box}</td>
              <td className="px-4 py-2" style={{ color: theme.ink, fontSize: '13px' }}>{b.label}</td>
              <td className="px-4 py-2 font-mono" style={{ textAlign: 'end', color: theme.inkMuted, fontSize: '13px' }}>{fmt(b.taxable_amount)}</td>
              <td className="px-4 py-2 font-mono" style={{ textAlign: 'end', color: theme.ink, fontSize: '13px', fontWeight: 500 }}>{fmt(b.vat_amount)}</td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr style={{ borderTop: `2px solid ${theme.border}`, background: theme.panelHead, fontWeight: 700 }}>
            <td colSpan={3} className="px-4 py-2.5" style={{ color: theme.ink, fontSize: '13px' }}>{totalLabel}</td>
            <td className="px-4 py-2.5 font-mono" style={{ textAlign: 'end', color: theme.ink, fontSize: '13px' }}>{fmt(total)}</td>
          </tr>
        </tfoot>
      </table>
    </div>
  );

  // Place-wise breakdown (customer/supplier regions; emirates → VAT201 1a–1g).
  const RegionSection = ({ title, hint, rows, showTaxable }: { title: string; hint: string; rows: VATReturnRegionRow[]; showTaxable: boolean }) => (
    <div style={{
      background: theme.card, border: `1px solid ${theme.border}`,
      borderRadius: '12px', boxShadow: theme.shadowSm, overflow: 'hidden',
    }}>
      <div style={{ background: theme.panelHead, borderBottom: `1px solid ${theme.border}`, padding: '10px 16px' }}>
        <span style={{ fontSize: '11px', fontWeight: 700, color: theme.inkMuted, textTransform: 'uppercase', letterSpacing: '.06em' }}>{title}</span>
      </div>
      <table className="w-full text-sm">
        <thead>
          <tr style={{ borderBottom: `1px solid ${theme.border}` }}>
            {[
              { l: t('reports.box'),   a: 'start' as const },
              { l: t('reports.place'), a: 'start' as const },
              ...(showTaxable ? [{ l: t('reports.taxable_amount'), a: 'end' as const }] : []),
              { l: t('reports.vat_amount'), a: 'end' as const },
            ].map(c => (
              <th key={c.l} className="px-4 py-2" style={{
                fontSize: '11px', fontWeight: 600, color: theme.inkMuted,
                textTransform: 'uppercase', letterSpacing: '.06em', textAlign: c.a,
              }}>{c.l}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={`${r.region_name}-${i}`} style={{ borderTop: i === 0 ? 'none' : '1px solid #f1f5f9' }}>
              <td className="px-4 py-2 font-mono" style={{ color: theme.inkMuted, fontSize: '12px' }}>{r.box ?? '—'}</td>
              <td className="px-4 py-2" style={{ color: r.region_name === 'Unassigned' ? theme.inkFaint : theme.ink, fontSize: '13px', fontStyle: r.region_name === 'Unassigned' ? 'italic' : 'normal' }}>{r.region_name}</td>
              {showTaxable && <td className="px-4 py-2 font-mono" style={{ textAlign: 'end', color: theme.inkMuted, fontSize: '13px' }}>{fmt(r.taxable_amount)}</td>}
              <td className="px-4 py-2 font-mono" style={{ textAlign: 'end', color: theme.ink, fontSize: '13px', fontWeight: 500 }}>{fmt(r.vat_amount)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p style={{ margin: 0, padding: '8px 16px', fontSize: '11px', color: theme.inkFaint, borderTop: `1px solid ${theme.border}` }}>{hint}</p>
    </div>
  );

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
      <PageHeader
        title={t('reports.vat_return')}
        subtitle={data ? `${data.period_start} — ${data.period_end}` : `${from} — ${to}`}
        actions={
          <div data-print-hide style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
            <PeriodPicker
              mode="range" preset={preset} from={from} to={to}
              onPresetChange={setPreset} onCustomRange={setCustomRange}
            />
            <ReportActions rows={exportRows} headers={exportHeaders} filename={`vat-return-${from}_${to}`} disabled={!data} />
          </div>
        }
      />

      {loading && !data && <p style={{ fontSize: '13px', color: theme.inkMuted, padding: '24px 0', textAlign: 'center' }}>{t('common.loading')}</p>}

      {data && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 340px), 1fr))', gap: '16px' }}>
          <Section title={t('reports.vat_on_sales')}    boxes={data.output_boxes} total={data.total_output_vat} totalLabel={t('reports.total_output_vat')} />
          <Section title={t('reports.vat_on_expenses')} boxes={data.input_boxes}  total={data.total_input_vat}  totalLabel={t('reports.total_input_vat')} />

          {data.output_by_region && data.output_by_region.length > 0 && (
            <RegionSection title={t('reports.vat_by_place')} hint={t('reports.vat_place_hint')} rows={data.output_by_region} showTaxable />
          )}
          {data.input_by_region && data.input_by_region.length > 0 && (
            <RegionSection title={t('reports.vat_input_by_place')} hint={t('reports.vat_input_place_hint')} rows={data.input_by_region} showTaxable={false} />
          )}

          {/* Net payable */}
          <div style={{
            gridColumn: '1 / -1',
            background: theme.brandSoft,
            border: `2px solid ${theme.brand}`,
            borderRadius: '12px',
            padding: '20px',
          }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px', flexWrap: 'wrap' }}>
              <span style={{ fontSize: '16px', fontWeight: 700, color: theme.brandSoftText }}>{t('reports.net_vat_payable')}</span>
              <span style={{ fontSize: '24px', fontWeight: 800, color: data.net_vat_payable >= 0 ? '#dc2626' : '#15803d' }}>
                {fmt(Math.abs(data.net_vat_payable))}
                {data.net_vat_payable < 0 && <span style={{ fontSize: '12px', marginInlineStart: '6px', color: '#15803d' }}>({t('reports.refund')})</span>}
              </span>
            </div>
            <p style={{ margin: '6px 0 0', fontSize: '11px', color: theme.brand }}>
              {t('reports.vat_period')}: {data.period_start} — {data.period_end}
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
