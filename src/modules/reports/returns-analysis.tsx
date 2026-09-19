import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { getAdapter } from '@/data';
import { useAuthStore } from '@/store/auth';
import { usePeriodPicker } from '@/hooks/use-period-picker';
import { PeriodPicker } from '@/ui/period-picker';
import { ReportActions } from '@/ui/report-actions';
import type { SalesReturnReasonLine, PurchaseReturnReasonLine } from '@/data/adapter';

/**
 * R6a — Returns Analysis.
 *
 * Why returns come back, and what they cost. Both sides of the return path,
 * grouped by reason code, over the usual period picker.
 *
 * The column worth looking at is "written off": the cost of lines marked
 * damaged, which phase 76 debits to 6700 Inventory Loss instead of leaving in
 * 5100 COGS. It is computed here exactly as the posting computes it
 * (qty x unit_cost over damaged lines), so this report and the ledger cannot
 * drift apart.
 *
 * The purchase table has no such column on purpose. purchase_return_items
 * carries a condition, but nothing posts from it, so showing a write-off
 * figure there would imply a journal entry that is never made.
 *
 * Only CONFIRMED returns are counted: a draft has returned nothing and a void
 * has been reversed.
 */

function fmt(n: number) {
  return new Intl.NumberFormat(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n);
}
function fmtQty(n: number) {
  return new Intl.NumberFormat(undefined, { maximumFractionDigits: 3 }).format(n);
}

const th     = 'px-4 py-2 text-left font-medium text-ink-secondary';
const thNum  = 'px-4 py-2 text-right font-medium text-ink-secondary';
const td     = 'px-4 py-2 text-ink-primary';
const tdNum  = 'px-4 py-2 text-right tabular-nums text-ink-secondary';
const tdTot  = 'px-4 py-2 text-right tabular-nums font-semibold text-ink-primary';

export default function ReturnsAnalysisPage() {
  const { t } = useTranslation();
  const company_id = useAuthStore(s => s.company_id);
  const { preset, from, to, setPreset, setCustomRange } =
    usePeriodPicker('stockbolt.report.returns-analysis.period', 'this_month');

  const { data: salesData, isFetching: salesBusy } = useQuery({
    queryKey: ['returns_by_reason_sales', company_id, from, to],
    queryFn: () => getAdapter().reports.getSalesReturnsByReason(company_id!, from, to),
    enabled: !!company_id,
  });
  const { data: purchData, isFetching: purchBusy } = useQuery({
    queryKey: ['returns_by_reason_purchase', company_id, from, to],
    queryFn: () => getAdapter().reports.getPurchaseReturnsByReason(company_id!, from, to),
    enabled: !!company_id,
  });

  const sales: SalesReturnReasonLine[]      = salesData ?? [];
  const purch: PurchaseReturnReasonLine[]   = purchData ?? [];
  const busy    = salesBusy || purchBusy;
  const isEmpty = sales.length === 0 && purch.length === 0;

  // A reason code the document never carried reads better as "not given" than
  // as an empty cell.
  const label = (reason: string) => (reason ? t(`returns.${reason}`, reason) : t('reports.reason_none'));

  const sTot = sales.reduce((a, r) => ({
    returns: a.returns + r.returns, qty: a.qty + r.qty,
    credit_value: a.credit_value + r.credit_value,
    restocked_value: a.restocked_value + r.restocked_value,
    written_off: a.written_off + r.written_off, fees: a.fees + r.fees,
  }), { returns: 0, qty: 0, credit_value: 0, restocked_value: 0, written_off: 0, fees: 0 });

  const pTot = purch.reduce((a, r) => ({
    returns: a.returns + r.returns, qty: a.qty + r.qty,
    debit_value: a.debit_value + r.debit_value, cost: a.cost + r.cost,
  }), { returns: 0, qty: 0, debit_value: 0, cost: 0 });

  // One sheet for both tables, told apart by the Side column — an export that
  // silently dropped half the page would be worse than no export.
  const exportHeaders = ['Side', 'Reason', 'Returns', 'Qty', 'Value', 'Restocked Cost', 'Written Off', 'Fees'];
  const exportRows: Record<string, unknown>[] = [
    ...sales.map(r => ({
      Side: 'Sales', Reason: label(r.reason), Returns: r.returns, Qty: r.qty,
      Value: r.credit_value.toFixed(2), 'Restocked Cost': r.restocked_value.toFixed(2),
      'Written Off': r.written_off.toFixed(2), Fees: r.fees.toFixed(2),
    })),
    ...purch.map(r => ({
      Side: 'Purchase', Reason: label(r.reason), Returns: r.returns, Qty: r.qty,
      Value: r.debit_value.toFixed(2), 'Restocked Cost': r.cost.toFixed(2),
      'Written Off': '', Fees: '',
    })),
  ];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-xl font-semibold text-ink-primary">{t('reports.returns_analysis')}</h1>
        <div data-print-hide className="flex flex-wrap items-center gap-2">
          <PeriodPicker mode="range" preset={preset} from={from} to={to}
            onPresetChange={setPreset} onCustomRange={setCustomRange} />
          <ReportActions rows={exportRows} headers={exportHeaders}
            filename={`returns-analysis-${from}_${to}`} disabled={isEmpty} />
        </div>
      </div>

      {busy && isEmpty && <p className="text-sm text-ink-secondary">{t('common.loading')}</p>}
      {!busy && isEmpty && <p className="text-sm text-ink-tertiary">{t('reports.no_data')}</p>}

      {/* ── Sales returns ────────────────────────────────────────────────── */}
      {sales.length > 0 && (
        <section className="space-y-2">
          <h2 className="text-sm font-semibold text-ink-primary">{t('reports.returns_sales_side')}</h2>
          <div className="overflow-x-auto rounded-lg border border-border bg-surface-card shadow-sm">
            <table className="w-full text-sm">
              <thead className="bg-surface-subtle">
                <tr>
                  <th className={th}>{t('returns.reason')}</th>
                  <th className={thNum}>{t('reports.returns_count')}</th>
                  <th className={thNum}>{t('reports.qty_returned')}</th>
                  <th className={thNum}>{t('reports.credit_value')}</th>
                  <th className={thNum}>{t('reports.restocked_cost')}</th>
                  <th className={thNum}>{t('reports.written_off')}</th>
                  <th className={thNum}>{t('returns.restocking_fee')}</th>
                </tr>
              </thead>
              <tbody>
                {sales.map(r => (
                  <tr key={r.reason || '_'} className="border-t border-border-subtle">
                    <td className={td}>{label(r.reason)}</td>
                    <td className={tdNum}>{r.returns}</td>
                    <td className={tdNum}>{fmtQty(r.qty)}</td>
                    <td className={tdNum}>{fmt(r.credit_value)}</td>
                    <td className={tdNum}>{fmt(r.restocked_value)}</td>
                    <td className={r.written_off > 0 ? 'px-4 py-2 text-right tabular-nums font-medium text-danger-600' : tdNum}>
                      {fmt(r.written_off)}
                    </td>
                    <td className={tdNum}>{fmt(r.fees)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="border-t-2 border-border-strong bg-surface-subtle">
                  <td className="px-4 py-2 font-semibold text-ink-primary">{t('common.total')}</td>
                  <td className={tdTot}>{sTot.returns}</td>
                  <td className={tdTot}>{fmtQty(sTot.qty)}</td>
                  <td className={tdTot}>{fmt(sTot.credit_value)}</td>
                  <td className={tdTot}>{fmt(sTot.restocked_value)}</td>
                  <td className={tdTot}>{fmt(sTot.written_off)}</td>
                  <td className={tdTot}>{fmt(sTot.fees)}</td>
                </tr>
              </tfoot>
            </table>
          </div>
          {sTot.written_off > 0 && (
            <p className="text-xs text-ink-tertiary">{t('reports.written_off_hint')}</p>
          )}
        </section>
      )}

      {/* ── Purchase returns ─────────────────────────────────────────────── */}
      {purch.length > 0 && (
        <section className="space-y-2">
          <h2 className="text-sm font-semibold text-ink-primary">{t('reports.returns_purchase_side')}</h2>
          <div className="overflow-x-auto rounded-lg border border-border bg-surface-card shadow-sm">
            <table className="w-full text-sm">
              <thead className="bg-surface-subtle">
                <tr>
                  <th className={th}>{t('returns.reason')}</th>
                  <th className={thNum}>{t('reports.returns_count')}</th>
                  <th className={thNum}>{t('reports.qty_returned')}</th>
                  <th className={thNum}>{t('reports.debit_value')}</th>
                  <th className={thNum}>{t('reports.returned_cost')}</th>
                </tr>
              </thead>
              <tbody>
                {purch.map(r => (
                  <tr key={r.reason || '_'} className="border-t border-border-subtle">
                    <td className={td}>{label(r.reason)}</td>
                    <td className={tdNum}>{r.returns}</td>
                    <td className={tdNum}>{fmtQty(r.qty)}</td>
                    <td className={tdNum}>{fmt(r.debit_value)}</td>
                    <td className={tdNum}>{fmt(r.cost)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="border-t-2 border-border-strong bg-surface-subtle">
                  <td className="px-4 py-2 font-semibold text-ink-primary">{t('common.total')}</td>
                  <td className={tdTot}>{pTot.returns}</td>
                  <td className={tdTot}>{fmtQty(pTot.qty)}</td>
                  <td className={tdTot}>{fmt(pTot.debit_value)}</td>
                  <td className={tdTot}>{fmt(pTot.cost)}</td>
                </tr>
              </tfoot>
            </table>
          </div>
        </section>
      )}
    </div>
  );
}
