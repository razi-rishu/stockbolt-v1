import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { getAdapter } from '@/data/index';
import { useAuthStore } from '@/store/auth';
import { usePeriodPicker } from '@/hooks/use-period-picker';
import { PeriodPicker } from '@/ui/period-picker';
import { ReportActions } from '@/ui/report-actions';
import { OceanReport, ReportCard, ReportMessage, ReportTable, exportFromColumns, money as fmt, Num, ltr, type ReportColumn } from '@/components/ocean-report';
import type { BankAccountRow, BankReconLine } from '@/data/adapter';

export default function BankReconPage() {
  const { t } = useTranslation();
  const { company_id } = useAuthStore();
  const [accountId, setAccountId] = useState('');
  const { preset, from, to, setPreset, setCustomRange } = usePeriodPicker('stockbolt.report.bank-recon.period', 'this_month');

  const { data: bankAccounts = [] } = useQuery<BankAccountRow[]>({
    queryKey: ['bank_accounts', company_id],
    queryFn:  () => getAdapter().bankAccounts.list(company_id!),
    enabled:  !!company_id,
  });

  const { data: lines = [], isFetching } = useQuery<BankReconLine[]>({
    queryKey: ['report_bank_recon', company_id, accountId, from, to],
    queryFn:  () => getAdapter().reports.bankRecon(company_id!, accountId, from, to),
    enabled:  !!company_id && !!accountId,
  });

  const closingBalance = lines.length > 0 ? lines[lines.length - 1].running_balance : 0;
  const neg = (n: number) => (n < 0 ? `(${fmt(-n)})` : fmt(n));
  const srcLabel = (src: string) => t(`jeOcean.src_${src}`, { defaultValue: src.replace(/_/g, ' ') });

  const columns: ReportColumn<BankReconLine>[] = [
    { key: 'date', header: t('common.date'), cls: 'muted', cell: l => <Num>{l.date}</Num>, exp: l => l.date },
    { key: 'je', header: t('reports.je_number'), cell: l => <span className="code">{l.je_number}</span>, exp: l => l.je_number },
    { key: 'src', header: t('reports.source_type'), cell: l => <span className="sb-pill sb-pill-muted">{srcLabel(l.source_type)}</span>, exp: l => srcLabel(l.source_type) },
    { key: 'desc', header: t('reports.description'), cls: 'muted', cell: l => <span className="sb-rpt-clip" title={l.description}>{l.description}</span>, exp: l => l.description },
    { key: 'debit', header: t('reports.debit'), num: true, cls: l => (l.debit > 0 ? 'is-up' : 'muted'), cell: l => (l.debit > 0 ? fmt(l.debit) : '—'), exp: l => l.debit.toFixed(2) },
    { key: 'credit', header: t('reports.credit'), num: true, cls: l => (l.credit > 0 ? 'is-down' : 'muted'), cell: l => (l.credit > 0 ? fmt(l.credit) : '—'), exp: l => l.credit.toFixed(2) },
    { key: 'bal', header: t('reports.running_balance'), num: true, cls: l => (l.running_balance < 0 ? 'is-down strong' : 'strong'), cell: l => neg(l.running_balance), exp: l => l.running_balance.toFixed(2) },
  ];
  const xl = exportFromColumns(columns, lines);

  return (
    <OceanReport
      testid="bank-recon-report-ocean"
      title={t('reports.bank_recon_title')}
      subtitle={t('reports.bank_recon_desc')}
      controls={<>
        <select value={accountId} onChange={e => setAccountId(e.target.value)} className="sb-rpt-select sb-rpt-select-wide" aria-label={t('banking.select_account')}>
          <option value="">{t('banking.select_account')}</option>
          {bankAccounts.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
        </select>
        <PeriodPicker mode="range" preset={preset} from={from} to={to} onPresetChange={setPreset} onCustomRange={setCustomRange} />
        <ReportActions rows={xl.rows} headers={xl.headers} filename={`bank-recon-${from}_${to}`} disabled={!accountId || lines.length === 0} />
      </>}
    >
      {!accountId ? (
        <ReportCard><ReportMessage>{t('reports.select_account_prompt')}</ReportMessage></ReportCard>
      ) : (
        <ReportCard
          meta={t('rptOcean.range', { from: ltr(from), to: ltr(to) })}
          figures={lines.length > 0 ? [
            { label: t('rptOcean.fig_entries'), value: <Num>{lines.length}</Num> },
            {
              label: `${t('reports.closing_balance_as_of')} ${ltr(to)}`,
              value: <Num>{neg(closingBalance)}</Num>,
              tone: closingBalance >= 0 ? 'brand' : 'bad',
            },
          ] : undefined}
        >
          {lines.length === 0
            ? <ReportMessage>{isFetching ? t('common.loading') : t('reports.no_data')}</ReportMessage>
            : <ReportTable columns={columns} rows={lines} rowKey={(_, i) => String(i)} minWidth={900} />}
        </ReportCard>
      )}
    </OceanReport>
  );
}
