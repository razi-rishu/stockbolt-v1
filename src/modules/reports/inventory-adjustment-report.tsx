import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { getAdapter } from '@/data/index';
import { useAuthStore } from '@/store/auth';
import { usePeriodPicker } from '@/hooks/use-period-picker';
import { PeriodPicker } from '@/ui/period-picker';
import { ReportActions } from '@/ui/report-actions';
import { OceanReport, ReportCard, ReportMessage, ReportTable, exportFromColumns, money as fmt, Num, ltr, type ReportColumn } from '@/components/ocean-report';
import type { WarehouseRow } from '@/data/adapter';

export default function InventoryAdjustmentReportPage() {
  const { t } = useTranslation();
  const { company_id } = useAuthStore();
  const { preset, from, to, setPreset, setCustomRange } = usePeriodPicker('stockbolt.report.inventory-adjustment.period', 'this_month');

  const { data: warehouses = [] } = useQuery<WarehouseRow[]>({
    queryKey: ['warehouses', company_id],
    queryFn: () => getAdapter().warehouses.list(company_id!),
    enabled: !!company_id,
  });
  const warehouseMap = Object.fromEntries(warehouses.map(w => [w.id, w.name]));

  const { data: rows = [], isFetching } = useQuery({
    queryKey: ['report_inv_adjustment', company_id, from, to],
    queryFn: () => getAdapter().reports.getInventoryAdjustmentReport(company_id!, {
      date_from: from,
      date_to: to,
    }),
    enabled: !!company_id,
  });
  type Row = typeof rows[number];

  const totalGain = rows.reduce((s, r) => s + (r.total_gain ?? 0), 0);
  const totalLoss = rows.reduce((s, r) => s + (r.total_loss ?? 0), 0);
  const net = totalGain - totalLoss;
  const netOf = (r: Row) => (r.total_gain ?? 0) - (r.total_loss ?? 0);
  const signed = (n: number) => `${n > 0 ? '+' : ''}${fmt(n)}`;

  const columns: ReportColumn<Row>[] = [
    { key: 'date', header: t('inventory.date'), cls: 'muted', cell: r => <Num>{r.date as string}</Num>, exp: r => r.date as string },
    { key: 'no', header: t('inventory.adjustment_number'), cell: r => <span className="code">{r.adjustment_number}</span>, exp: r => r.adjustment_number },
    { key: 'wh', header: t('inventory.warehouse'), cls: 'muted', cell: r => warehouseMap[r.warehouse_id] ?? r.warehouse_id, exp: r => warehouseMap[r.warehouse_id] ?? r.warehouse_id },
    { key: 'reason', header: t('inventory.reason'), cls: 'muted', cell: r => <span style={{ textTransform: 'capitalize' }}>{r.reason}</span>, exp: r => r.reason },
    { key: 'gain', header: t('inventory.total_gain'), num: true, cls: 'is-up', cell: r => fmt(r.total_gain ?? 0), exp: r => (r.total_gain ?? 0).toFixed(2) },
    { key: 'loss', header: t('inventory.total_loss'), num: true, cls: 'is-down', cell: r => fmt(r.total_loss ?? 0), exp: r => (r.total_loss ?? 0).toFixed(2) },
    { key: 'net', header: t('inventory.net_change'), num: true, cls: r => (netOf(r) >= 0 ? 'is-up strong' : 'is-down strong'), cell: r => signed(netOf(r)), exp: r => netOf(r).toFixed(2) },
  ];
  const xl = exportFromColumns(columns, rows);

  return (
    <OceanReport
      testid="inventory-adjustment-ocean"
      title={t('reports.inventory_adjustment_report')}
      subtitle={t('rptOcean.range', { from: ltr(from), to: ltr(to) })}
      controls={<>
        <PeriodPicker mode="range" preset={preset} from={from} to={to} onPresetChange={setPreset} onCustomRange={setCustomRange} />
        <ReportActions rows={xl.rows} headers={xl.headers} filename={`inventory-adjustments-${from}_${to}`} disabled={rows.length === 0} />
      </>}
    >
      <ReportCard
        figures={rows.length > 0 ? [
          { label: t('inventory.total_gain'), value: <Num>{fmt(totalGain)}</Num>, tone: 'good' },
          { label: t('inventory.total_loss'), value: <Num>{fmt(totalLoss)}</Num>, tone: 'bad' },
          { label: t('inventory.net_change'), value: <Num>{signed(net)}</Num>, tone: net >= 0 ? 'brand' : 'bad' },
        ] : undefined}
      >
        {rows.length === 0
          ? <ReportMessage>{isFetching ? t('common.loading') : t('reports.no_adjustments')}</ReportMessage>
          : <ReportTable columns={columns} rows={rows} rowKey={(_, i) => String(i)} minWidth={820} />}
      </ReportCard>
    </OceanReport>
  );
}
