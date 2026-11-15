import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { getAdapter } from '@/data';
import { useAuthStore } from '@/store/auth';
import { usePeriodPicker } from '@/hooks/use-period-picker';
import { PeriodPicker } from '@/ui/period-picker';
import { ReportActions } from '@/ui/report-actions';
import { OceanReport, ReportCard, ReportMessage, ReportTable, money as fmt, Num, ltr, type ReportColumn } from '@/components/ocean-report';
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

function fmtQty(n: number) {
  return new Intl.NumberFormat('en-US', { maximumFractionDigits: 3 }).format(n);
}

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
  const H = {
    side: t('rptOcean.col_side'), reason: t('returns.reason'), returns: t('reports.returns_count'),
    qty: t('reports.qty_returned'), value: t('rptOcean.col_value'), restocked: t('reports.restocked_cost'),
    written: t('reports.written_off'), fees: t('returns.restocking_fee'),
  };
  const exportHeaders = [H.side, H.reason, H.returns, H.qty, H.value, H.restocked, H.written, H.fees];
  const exportRows: Record<string, unknown>[] = [
    ...sales.map(r => ({
      [H.side]: t('rptOcean.side_sales'), [H.reason]: label(r.reason), [H.returns]: r.returns, [H.qty]: r.qty,
      [H.value]: r.credit_value.toFixed(2), [H.restocked]: r.restocked_value.toFixed(2),
      [H.written]: r.written_off.toFixed(2), [H.fees]: r.fees.toFixed(2),
    })),
    ...purch.map(r => ({
      [H.side]: t('rptOcean.side_purchase'), [H.reason]: label(r.reason), [H.returns]: r.returns, [H.qty]: r.qty,
      [H.value]: r.debit_value.toFixed(2), [H.restocked]: r.cost.toFixed(2),
      [H.written]: '', [H.fees]: '',
    })),
  ];

  const salesCols: ReportColumn<SalesReturnReasonLine>[] = [
    { key: 'reason', header: t('returns.reason'), cls: 'strong', cell: r => label(r.reason) },
    { key: 'returns', header: t('reports.returns_count'), num: true, cls: 'muted', cell: r => r.returns, foot: sTot.returns },
    { key: 'qty', header: t('reports.qty_returned'), num: true, cls: 'muted', cell: r => fmtQty(r.qty), foot: fmtQty(sTot.qty) },
    { key: 'credit', header: t('reports.credit_value'), num: true, cell: r => fmt(r.credit_value), foot: fmt(sTot.credit_value) },
    { key: 'restocked', header: t('reports.restocked_cost'), num: true, cls: 'muted', cell: r => fmt(r.restocked_value), foot: fmt(sTot.restocked_value) },
    { key: 'written', header: t('reports.written_off'), num: true, cls: r => (r.written_off > 0 ? 'is-down strong' : 'muted'), cell: r => fmt(r.written_off), foot: fmt(sTot.written_off) },
    { key: 'fees', header: t('returns.restocking_fee'), num: true, cls: 'muted', cell: r => fmt(r.fees), foot: fmt(sTot.fees) },
  ];
  const purchCols: ReportColumn<PurchaseReturnReasonLine>[] = [
    { key: 'reason', header: t('returns.reason'), cls: 'strong', cell: r => label(r.reason) },
    { key: 'returns', header: t('reports.returns_count'), num: true, cls: 'muted', cell: r => r.returns, foot: pTot.returns },
    { key: 'qty', header: t('reports.qty_returned'), num: true, cls: 'muted', cell: r => fmtQty(r.qty), foot: fmtQty(pTot.qty) },
    { key: 'debit', header: t('reports.debit_value'), num: true, cell: r => fmt(r.debit_value), foot: fmt(pTot.debit_value) },
    { key: 'cost', header: t('reports.returned_cost'), num: true, cls: 'muted', cell: r => fmt(r.cost), foot: fmt(pTot.cost) },
  ];

  return (
    <OceanReport
      testid="returns-analysis-ocean"
      title={t('reports.returns_analysis')}
      subtitle={t('rptOcean.range', { from: ltr(from), to: ltr(to) })}
      controls={<>
        <PeriodPicker mode="range" preset={preset} from={from} to={to} onPresetChange={setPreset} onCustomRange={setCustomRange} />
        <ReportActions rows={exportRows} headers={exportHeaders} filename={`returns-analysis-${from}_${to}`} disabled={isEmpty} />
      </>}
    >
      {isEmpty && <ReportCard><ReportMessage>{busy ? t('common.loading') : t('reports.no_data')}</ReportMessage></ReportCard>}

      {/* ── Sales returns ── */}
      {sales.length > 0 && (
        <ReportCard
          title={t('reports.returns_sales_side')}
          figures={[
            { label: t('reports.returns_count'), value: <Num>{sTot.returns}</Num> },
            { label: t('reports.credit_value'), value: <Num>{fmt(sTot.credit_value)}</Num>, tone: 'brand' },
            { label: t('reports.written_off'), value: <Num>{fmt(sTot.written_off)}</Num>, tone: sTot.written_off > 0 ? 'bad' : undefined },
          ]}
        >
          <ReportTable columns={salesCols} rows={sales} rowKey={r => r.reason || '_'} footLabel={t('rptOcean.total')} minWidth={820} />
          {sTot.written_off > 0 && <p className="sb-rpt-foot">{t('reports.written_off_hint')}</p>}
        </ReportCard>
      )}

      {/* ── Purchase returns ── */}
      {purch.length > 0 && (
        <ReportCard
          title={t('reports.returns_purchase_side')}
          figures={[
            { label: t('reports.returns_count'), value: <Num>{pTot.returns}</Num> },
            { label: t('reports.debit_value'), value: <Num>{fmt(pTot.debit_value)}</Num>, tone: 'brand' },
          ]}
        >
          <ReportTable columns={purchCols} rows={purch} rowKey={r => r.reason || '_'} footLabel={t('rptOcean.total')} minWidth={620} />
        </ReportCard>
      )}
    </OceanReport>
  );
}
