import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { getAdapter } from '@/data/index';
import { useAuthStore } from '@/store/auth';
import { DocLink } from '@/ui/doc-link';
import { usePeriodPicker } from '@/hooks/use-period-picker';
import { PeriodPicker } from '@/ui/period-picker';
import { ReportActions } from '@/ui/report-actions';
import { OceanReport, ReportCard, ReportMessage, ReportTable, exportFromColumns, money as fmt, Num, ltr, type ReportColumn } from '@/components/ocean-report';
import type { ContactRow } from '@/data/adapter';

export default function SupplierStatementPage() {
  const { t } = useTranslation();
  const { company_id } = useAuthStore();
  const [supplierId, setSupplierId] = useState('');
  const { preset, from, to, setPreset, setCustomRange } = usePeriodPicker('stockbolt.report.supplier-statement.period', 'this_month');

  const { data: suppliers = [] } = useQuery<ContactRow[]>({
    queryKey: ['contacts', company_id, 'supplier'],
    queryFn: () => getAdapter().contacts.list(company_id!, 'supplier'),
    enabled: !!company_id,
  });

  const { data, isFetching } = useQuery({
    queryKey: ['supplier_statement_report', company_id, supplierId, from, to],
    queryFn: () => getAdapter().reports.getSupplierStatement(company_id!, supplierId, from, to),
    enabled: !!supplierId && !!company_id,
  });
  const lines = data?.lines ?? [];
  type Row = typeof lines[number];
  const dash = (n: number) => (n > 0 ? fmt(n) : '—');

  const columns: ReportColumn<Row>[] = [
    { key: 'date', header: t('reports.date'), cls: 'muted', cell: l => <Num>{l.date}</Num>, exp: l => l.date },
    { key: 'doc', header: t('reports.document'), cell: l => <DocLink type={l.doc_type} id={l.doc_id ?? null} label={l.doc_number} status={l.is_reversed ? 'reversed' : 'active'} />, exp: l => l.doc_number },
    { key: 'debit', header: t('reports.debit'), num: true, cell: l => dash(l.debit), exp: l => l.debit.toFixed(2) },
    { key: 'credit', header: t('reports.credit'), num: true, cell: l => dash(l.credit), exp: l => l.credit.toFixed(2) },
    { key: 'balance', header: t('reports.balance'), num: true, cls: 'strong', cell: l => fmt(l.balance), foot: data ? fmt(data.closing_balance) : '', exp: l => l.balance.toFixed(2) },
  ];
  const xl = exportFromColumns(columns, lines);

  return (
    <OceanReport
      testid="supplier-statement-ocean"
      title={t('reports.supplier_statement')}
      subtitle={t('rptOcean.range', { from: ltr(from), to: ltr(to) })}
      controls={<>
        <select
          value={supplierId} onChange={e => setSupplierId(e.target.value)}
          className="sb-rpt-select sb-rpt-select-wide" aria-label={t('purchasing.select_supplier')}
        >
          <option value="">{t('purchasing.select_supplier')}</option>
          {suppliers.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>
        <PeriodPicker mode="range" preset={preset} from={from} to={to} onPresetChange={setPreset} onCustomRange={setCustomRange} />
        <ReportActions rows={xl.rows} headers={xl.headers} filename={`supplier-statement-${from}_${to}`} disabled={!data} />
      </>}
    >
      {!supplierId && <ReportCard><ReportMessage>{t('purchasing.select_supplier')}</ReportMessage></ReportCard>}
      {supplierId && isFetching && !data && <ReportCard><ReportMessage>{t('common.loading')}</ReportMessage></ReportCard>}
      {data && (
        <ReportCard
          title={data.contact_name}
          meta={t('rptOcean.range', { from: ltr(data.from_date), to: ltr(data.to_date) })}
          figures={[{ label: t('reports.closing_balance'), value: <Num>{fmt(data.closing_balance)}</Num>, tone: 'brand' }]}
        >
          {lines.length === 0
            ? <ReportMessage>{t('reports.no_data')}</ReportMessage>
            : <ReportTable columns={columns} rows={lines} rowKey={(_, i) => String(i)} footLabel={t('reports.closing_balance')} minWidth={500} />}
        </ReportCard>
      )}
    </OceanReport>
  );
}
