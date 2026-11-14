import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { getAdapter } from '@/data';
import { useAuthStore } from '@/store/auth';
import { ReportActions } from '@/ui/report-actions';
import { OceanReport, ReportCard, ReportMessage, ReportTable, exportFromColumns, money as fmt, Num, type ReportColumn } from '@/components/ocean-report';
import type { OutstandingPOLine } from '@/data/adapter';

export default function OutstandingPOsPage() {
  const { t } = useTranslation();
  const adapter = getAdapter();
  const company_id = useAuthStore(s => s.company_id);
  const [rows, setRows]     = useState<OutstandingPOLine[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!company_id) return;
    adapter.reports.getOutstandingPOs(company_id).then(setRows).catch(console.error).finally(() => setLoading(false));
  }, [company_id]);

  const totPending = rows.reduce((s, r) => s + r.pending_value, 0);

  const columns: ReportColumn<OutstandingPOLine>[] = [
    { key: 'po', header: t('purchasing.po_number'), cell: r => <Link to={`/purchasing/orders/${r.po_id}`}>{r.po_number}</Link>, exp: r => r.po_number },
    { key: 'supplier', header: t('contacts.supplier'), cell: r => r.supplier_name, exp: r => r.supplier_name },
    { key: 'date', header: t('common.date'), cls: 'muted', cell: r => <Num>{r.date}</Num>, exp: r => r.date },
    { key: 'expected', header: t('purchasing.expected_delivery'), cls: 'muted', cell: r => <Num>{r.expected_delivery ?? '—'}</Num>, exp: r => r.expected_delivery ?? '' },
    { key: 'total', header: t('common.total'), num: true, cls: 'muted', cell: r => fmt(r.total), exp: r => r.total.toFixed(2) },
    { key: 'received', header: t('reports.received'), num: true, cls: 'is-up', cell: r => fmt(r.received_value), exp: r => r.received_value.toFixed(2) },
    { key: 'pending', header: t('reports.pending'), num: true, cls: 'is-warn strong', cell: r => fmt(r.pending_value), foot: fmt(totPending), exp: r => r.pending_value.toFixed(2) },
  ];
  const xl = exportFromColumns(columns, rows);

  return (
    <OceanReport
      testid="outstanding-pos-ocean"
      title={t('reports.outstanding_pos')}
      controls={<ReportActions rows={xl.rows} headers={xl.headers} filename="outstanding-pos" disabled={rows.length === 0} />}
    >
      <ReportCard
        figures={rows.length > 0 ? [
          { label: t('rptOcean.fig_open_orders'), value: <Num>{rows.length}</Num> },
          { label: t('reports.total_pending'), value: <Num>{fmt(totPending)}</Num>, tone: 'warn' },
        ] : undefined}
      >
        {loading
          ? <ReportMessage>{t('common.loading')}</ReportMessage>
          : rows.length === 0
            ? <ReportMessage>{t('common.no_data')}</ReportMessage>
            : <ReportTable columns={columns} rows={rows} rowKey={r => r.po_id} footLabel={t('reports.total_pending')} minWidth={820} />}
      </ReportCard>
    </OceanReport>
  );
}
