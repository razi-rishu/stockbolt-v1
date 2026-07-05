import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { getAdapter } from '@/data';
import { useAuthStore } from '@/store/auth';
import { PageHeader, Panel } from '@/ui/primitives';
import { theme } from '@/ui/theme';
import type { VATReturn, VATReturnRegionRow } from '@/data/adapter';

function fmt(n: number) {
  return new Intl.NumberFormat(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n);
}

export default function VATReturnPage() {
  const { t } = useTranslation();
  const adapter = getAdapter();
  const company_id = useAuthStore(s => s.company_id);

  const today = new Date().toISOString().slice(0, 10);
  const qStart = today.slice(0, 7).replace(/-\d+$/, '') + '-' + String(Math.floor((parseInt(today.slice(5, 7)) - 1) / 3) * 3 + 1).padStart(2, '0') + '-01';

  const [from, setFrom]   = useState(qStart);
  const [to, setTo]       = useState(today);
  const [data, setData]   = useState<VATReturn | null>(null);
  const [loading, setLoading] = useState(false);

  const run = async () => {
    if (!company_id) return;
    setLoading(true);
    try { setData(await adapter.reports.getVATReturn(company_id, from, to)); }
    catch (e) { console.error(e); }
    finally { setLoading(false); }
  };

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
      <PageHeader title={t('reports.vat_return')} subtitle={data ? `${data.period_start} — ${data.period_end}` : `${from} — ${to}`} />

      <Panel icon="📅" title="Period" compact>
        <span style={{ fontSize: '12px', color: theme.inkMuted, fontWeight: 500 }}>{t('reports.period_start')}</span>
        <input type="date" value={from} onChange={e => setFrom(e.target.value)}
          style={{ height: '32px', padding: '0 10px', fontSize: '13px', border: `1px solid ${theme.border}`, borderRadius: '7px', background: '#fff', color: theme.ink, outline: 'none' }} />
        <span style={{ fontSize: '12px', color: theme.inkMuted, fontWeight: 500 }}>{t('reports.period_end')}</span>
        <input type="date" value={to} onChange={e => setTo(e.target.value)}
          style={{ height: '32px', padding: '0 10px', fontSize: '13px', border: `1px solid ${theme.border}`, borderRadius: '7px', background: '#fff', color: theme.ink, outline: 'none' }} />
        <button onClick={run} disabled={loading} style={{
          height: '32px', padding: '0 16px',
          background: theme.brand, color: '#fff', border: 'none',
          borderRadius: '7px', fontSize: '13px', fontWeight: 600,
          cursor: loading ? 'not-allowed' : 'pointer', opacity: loading ? 0.6 : 1,
        }}>
          {loading ? t('common.loading') : t('common.run')}
        </button>
      </Panel>

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
