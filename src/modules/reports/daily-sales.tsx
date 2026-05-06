import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { getAdapter } from '@/data/index';
import { useAuthStore } from '@/store/auth';
import { Input } from '@/ui/input';
import { Button } from '@/ui/button';

const fmt = (n: number) =>
  n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export default function DailySalesReportPage() {
  const { t } = useTranslation();
  const { company_id } = useAuthStore();

  const today = new Date().toISOString().slice(0, 10);
  const firstOfMonth = today.slice(0, 7) + '-01';

  const [dateFrom, setDateFrom] = useState(firstOfMonth);
  const [dateTo, setDateTo]     = useState(today);
  const [submitted, setSubmitted] = useState(false);

  const { data: rows = [], isFetching } = useQuery({
    queryKey: ['daily-sales-summary', company_id, dateFrom, dateTo, submitted],
    enabled: !!company_id && submitted,
    queryFn: () =>
      getAdapter().pos.getDailySalesSummary(company_id!, {
        date_from: dateFrom,
        date_to: dateTo,
      }),
  });

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitted(true);
  }

  const totalCash    = rows.reduce((s, r) => s + r.cash_total,   0);
  const totalCard    = rows.reduce((s, r) => s + r.card_total,   0);
  const totalCredit  = rows.reduce((s, r) => s + r.credit_total, 0);
  const grandTotal   = rows.reduce((s, r) => s + r.grand_total,  0);
  const totalInv     = rows.reduce((s, r) => s + r.invoice_count, 0);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-800">{t('reports.daily_sales_summary')}</h1>
        <p className="text-sm text-slate-500 mt-1">{t('reports.daily_sales_summary_desc')}</p>
      </div>

      {/* Filters */}
      <form onSubmit={handleSubmit} className="bg-white border border-slate-200 rounded-lg p-4 flex flex-wrap gap-4 items-end">
        <div className="flex flex-col gap-1 min-w-[140px]">
          <label className="text-xs font-medium text-slate-600">{t('common.date_from')}</label>
          <Input type="date" value={dateFrom} onChange={e => { setDateFrom(e.target.value); setSubmitted(false); }} />
        </div>
        <div className="flex flex-col gap-1 min-w-[140px]">
          <label className="text-xs font-medium text-slate-600">{t('common.date_to')}</label>
          <Input type="date" value={dateTo} onChange={e => { setDateTo(e.target.value); setSubmitted(false); }} />
        </div>
        <Button type="submit" disabled={isFetching}>
          {isFetching ? t('common.loading') : t('common.run')}
        </Button>
      </form>

      {/* Summary Cards */}
      {submitted && rows.length > 0 && (
        <div className="grid grid-cols-2 sm:grid-cols-5 gap-4">
          <div className="bg-white border border-slate-200 rounded-lg p-4">
            <p className="text-xs text-slate-500">{t('pos.payment_cash')}</p>
            <p className="text-xl font-bold text-slate-800 mt-1">{fmt(totalCash)}</p>
          </div>
          <div className="bg-white border border-slate-200 rounded-lg p-4">
            <p className="text-xs text-slate-500">{t('pos.payment_card')}</p>
            <p className="text-xl font-bold text-slate-800 mt-1">{fmt(totalCard)}</p>
          </div>
          <div className="bg-white border border-slate-200 rounded-lg p-4">
            <p className="text-xs text-slate-500">{t('pos.payment_credit')}</p>
            <p className="text-xl font-bold text-slate-800 mt-1">{fmt(totalCredit)}</p>
          </div>
          <div className="bg-white border border-slate-200 rounded-lg p-4">
            <p className="text-xs text-slate-500">{t('reports.total_invoices')}</p>
            <p className="text-xl font-bold text-slate-800 mt-1">{totalInv}</p>
          </div>
          <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
            <p className="text-xs text-blue-600">{t('reports.grand_total')}</p>
            <p className="text-xl font-bold text-blue-700 mt-1">{fmt(grandTotal)}</p>
          </div>
        </div>
      )}

      {/* Table */}
      {submitted && (
        <div className="bg-white border border-slate-200 rounded-lg overflow-hidden">
          {rows.length === 0 && !isFetching ? (
            <p className="p-8 text-center text-slate-500">{t('pos.no_sales')}</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-slate-50 border-b border-slate-200">
                  <tr>
                    <th className="px-4 py-3 text-left font-medium text-slate-600">{t('common.date')}</th>
                    <th className="px-4 py-3 text-right font-medium text-slate-600">{t('pos.payment_cash')}</th>
                    <th className="px-4 py-3 text-right font-medium text-slate-600">{t('pos.payment_card')}</th>
                    <th className="px-4 py-3 text-right font-medium text-slate-600">{t('pos.payment_credit')}</th>
                    <th className="px-4 py-3 text-right font-medium text-slate-600">{t('reports.invoices')}</th>
                    <th className="px-4 py-3 text-right font-medium text-slate-600">{t('reports.grand_total')}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {rows.map(row => (
                    <tr key={row.date} className="hover:bg-slate-50 transition-colors">
                      <td className="px-4 py-3 font-medium text-slate-800">{row.date}</td>
                      <td className="px-4 py-3 text-right text-slate-700">{fmt(row.cash_total)}</td>
                      <td className="px-4 py-3 text-right text-slate-700">{fmt(row.card_total)}</td>
                      <td className="px-4 py-3 text-right text-slate-700">{fmt(row.credit_total)}</td>
                      <td className="px-4 py-3 text-right text-slate-700">{row.invoice_count}</td>
                      <td className="px-4 py-3 text-right font-bold text-slate-800">{fmt(row.grand_total)}</td>
                    </tr>
                  ))}
                </tbody>
                {rows.length > 1 && (
                  <tfoot className="bg-slate-50 border-t-2 border-slate-300">
                    <tr>
                      <td className="px-4 py-3 font-semibold text-slate-700">{t('common.total')}</td>
                      <td className="px-4 py-3 text-right font-semibold text-slate-800">{fmt(totalCash)}</td>
                      <td className="px-4 py-3 text-right font-semibold text-slate-800">{fmt(totalCard)}</td>
                      <td className="px-4 py-3 text-right font-semibold text-slate-800">{fmt(totalCredit)}</td>
                      <td className="px-4 py-3 text-right font-semibold text-slate-800">{totalInv}</td>
                      <td className="px-4 py-3 text-right font-bold text-blue-700">{fmt(grandTotal)}</td>
                    </tr>
                  </tfoot>
                )}
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
