import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { getAdapter } from '@/data';
import { useAuthStore } from '@/store/auth';
import type { VATReturn } from '@/data/adapter';

function fmt(n: number) { return new Intl.NumberFormat(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n); }

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

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold text-ink-primary">{t('reports.vat_return')}</h1>

      <div className="flex flex-wrap items-end gap-3 rounded-lg border border-border bg-surface-card p-4">
        <div>
          <label className="block text-xs text-ink-secondary mb-1">{t('reports.period_start')}</label>
          <input type="date" value={from} onChange={e => setFrom(e.target.value)} className="input-field h-9 text-sm" />
        </div>
        <div>
          <label className="block text-xs text-ink-secondary mb-1">{t('reports.period_end')}</label>
          <input type="date" value={to} onChange={e => setTo(e.target.value)} className="input-field h-9 text-sm" />
        </div>
        <button onClick={run} disabled={loading} className="btn-primary h-9 px-4 text-sm">
          {loading ? t('common.loading') : t('common.run')}
        </button>
      </div>

      {data && (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          {/* Output VAT */}
          <div className="rounded-lg border border-border bg-surface-card p-5 shadow-sm">
            <h2 className="mb-3 font-semibold text-ink-primary">{t('reports.vat_on_sales')}</h2>
            <table className="w-full text-sm">
              <thead className="text-ink-secondary">
                <tr>
                  <th className="py-1 text-left font-medium">{t('reports.box')}</th>
                  <th className="py-1 text-left font-medium">{t('reports.description')}</th>
                  <th className="py-1 text-right font-medium">{t('reports.taxable_amount')}</th>
                  <th className="py-1 text-right font-medium">{t('reports.vat_amount')}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {data.output_boxes.map(b => (
                  <tr key={b.box}>
                    <td className="py-1.5 text-ink-secondary font-mono">{b.box}</td>
                    <td className="py-1.5 text-ink-primary">{b.label}</td>
                    <td className="py-1.5 text-right text-ink-secondary">{fmt(b.taxable_amount)}</td>
                    <td className="py-1.5 text-right text-ink-primary font-medium">{fmt(b.vat_amount)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot className="border-t-2 border-border font-semibold">
                <tr>
                  <td colSpan={3} className="py-1.5 text-ink-primary">{t('reports.total_output_vat')}</td>
                  <td className="py-1.5 text-right text-ink-primary">{fmt(data.total_output_vat)}</td>
                </tr>
              </tfoot>
            </table>
          </div>

          {/* Input VAT */}
          <div className="rounded-lg border border-border bg-surface-card p-5 shadow-sm">
            <h2 className="mb-3 font-semibold text-ink-primary">{t('reports.vat_on_expenses')}</h2>
            <table className="w-full text-sm">
              <thead className="text-ink-secondary">
                <tr>
                  <th className="py-1 text-left font-medium">{t('reports.box')}</th>
                  <th className="py-1 text-left font-medium">{t('reports.description')}</th>
                  <th className="py-1 text-right font-medium">{t('reports.taxable_amount')}</th>
                  <th className="py-1 text-right font-medium">{t('reports.vat_amount')}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {data.input_boxes.map(b => (
                  <tr key={b.box}>
                    <td className="py-1.5 text-ink-secondary font-mono">{b.box}</td>
                    <td className="py-1.5 text-ink-primary">{b.label}</td>
                    <td className="py-1.5 text-right text-ink-secondary">{fmt(b.taxable_amount)}</td>
                    <td className="py-1.5 text-right text-ink-primary font-medium">{fmt(b.vat_amount)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot className="border-t-2 border-border font-semibold">
                <tr>
                  <td colSpan={3} className="py-1.5 text-ink-primary">{t('reports.total_input_vat')}</td>
                  <td className="py-1.5 text-right text-ink-primary">{fmt(data.total_input_vat)}</td>
                </tr>
              </tfoot>
            </table>
          </div>

          {/* Net payable */}
          <div className="md:col-span-2 rounded-lg border-2 border-brand-500 bg-brand-50 p-5">
            <div className="flex items-center justify-between">
              <span className="text-lg font-semibold text-brand-800">{t('reports.net_vat_payable')}</span>
              <span className={`text-2xl font-bold ${data.net_vat_payable >= 0 ? 'text-red-700' : 'text-emerald-700'}`}>
                {fmt(Math.abs(data.net_vat_payable))}
                {data.net_vat_payable < 0 && <span className="text-sm ms-1">({t('reports.refund')})</span>}
              </span>
            </div>
            <p className="mt-1 text-xs text-brand-600">{t('reports.vat_period')}: {data.period_start} — {data.period_end}</p>
          </div>
        </div>
      )}
    </div>
  );
}
