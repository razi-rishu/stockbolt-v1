import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { formatDate } from '@/lib/locale';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { getAdapter } from '@/data/index';
import { useAuthStore } from '@/store/auth';
import type { Column } from '@/ui/table';
import { OceanPage, OceanTable } from '@/components/ocean-list';
import { Plus, ArrowRightLeft } from 'lucide-react';
import { StatusBadge } from '@/ui/status-badge';
import { usePeriodPicker } from '@/hooks/use-period-picker';
import { PeriodPicker } from '@/ui/period-picker';
import { VoidedToggle } from '@/ui/voided-toggle';
import { useHideVoided, showsInList } from '@/hooks/use-hide-voided';
import type { SalesQuoteRow, ContactRow } from '@/data/adapter';

function fmt(n: number) {
  return n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export default function QuotesPage() {
  const { t } = useTranslation();
  const { company_id } = useAuthStore();
  const navigate = useNavigate();
  const qc = useQueryClient();
  // Phase 47c — period filter (default All time = show every quote).
  const { preset, from, to, setPreset, setCustomRange } = usePeriodPicker('stockbolt.list.quotes.period', 'all_time');
  const { hideVoided, setHideVoided } = useHideVoided('stockbolt.list.quotes.voided');

  const { data: allQuotes = [], isLoading } = useQuery({
    queryKey: ['sales_quotes', company_id],
    queryFn: () => getAdapter().salesQuotes.list(company_id!),
    enabled: !!company_id,
  });
  const quotesInPeriod = (allQuotes as SalesQuoteRow[]).filter(q => {
    if (from && (q.date as string) < from) return false;
    if (to && (q.date as string) > to) return false;
    return true;
  });
  // Z4 — the count is what THIS period is holding back, not all
  // history, so "Show 2 voided" always reveals exactly two.
  const quotesVoidedCount = quotesInPeriod.filter(r => r.status === 'void').length;
  const quotes = quotesInPeriod.filter(r => showsInList(r, hideVoided));

  const { data: customers = [] } = useQuery<ContactRow[]>({
    queryKey: ['contacts', company_id, 'customer'],
    queryFn: () => getAdapter().contacts.list(company_id!, 'customer'),
    enabled: !!company_id,
  });
  const customerMap = Object.fromEntries(customers.map(c => [c.id, c.name]));

  const convertMutation = useMutation({
    mutationFn: (quote_id: string) => getAdapter().salesQuotes.convertToInvoice(quote_id),
    onSuccess: (inv) => {
      qc.invalidateQueries({ queryKey: ['sales_quotes', company_id] });
      qc.invalidateQueries({ queryKey: ['invoices', company_id] });
      navigate(`/sales/invoices/${inv.id}`);
    },
  });

  const columns: Column<SalesQuoteRow>[] = [
    { key: 'no', header: t('sales.quote_number'), render: (q) => <bdi dir="ltr" className="sb-inv-no">{q.quote_number}</bdi> },
    { key: 'cust', header: t('sales.customer'), render: (q) => <span style={{ fontWeight: 600 }}>{customerMap[q.contact_id] ?? '—'}</span> },
    { key: 'date', header: t('sales.date'), render: (q) => <bdi dir="ltr">{formatDate(q.date)}</bdi> },
    { key: 'exp', header: t('sales.expiry_date'), render: (q) => <bdi dir="ltr">{q.expiry_date ?? '—'}</bdi> },
    { key: 'amt', header: t('sales.total_amount'), align: 'end', render: (q) => <bdi dir="ltr" className="sb-dash-num">{q.currency} {fmt(Number(q.total_amount))}</bdi> },
    { key: 'status', header: '', render: (q) => <StatusBadge status={q.status} /> },
    {
      key: 'convert', header: '', align: 'end',
      render: (q) => ['draft', 'sent', 'accepted'].includes(q.status) && (
        <button type="button" className="sb-row-link text-brand-600" disabled={convertMutation.isPending}
          onClick={(e) => { e.stopPropagation(); convertMutation.mutate(q.id); }}>
          <ArrowRightLeft size={15} aria-hidden="true" />{t('sales.convert_to_invoice')}
        </button>
      ),
    },
  ];

  // Ocean Teal (UI v1.1): look only — same quotes, period, voided toggle and
  // convert-to-invoice as before.
  return (
    <OceanPage
      testid="quotes-ocean"
      title={t('sales.quotes_title')}
      subtitle={t('salesOcean.quotes_count', { count: quotes.length })}
      actions={<>
        <PeriodPicker mode="range" allowAllTime preset={preset} from={from} to={to} onPresetChange={setPreset} onCustomRange={setCustomRange} />
        <VoidedToggle hideVoided={hideVoided} onChange={setHideVoided} count={quotesVoidedCount} />
        <button type="button" className="sb-primary-btn sb-btn-inline" onClick={() => navigate('/sales/quotes/new')}><Plus size={18} aria-hidden="true" />{t('sales.new_quote')}</button>
      </>}
    >
      {isLoading
        ? <div className="sb-card sb-empty">{t('common.loading')}</div>
        : <OceanTable columns={columns} rows={quotes as SalesQuoteRow[]} keyFn={(q) => q.id} cardTitleKey="cust"
            onRowClick={(q) => navigate(`/sales/quotes/${q.id}`)} rowMuted={(q) => q.status === 'void'} emptyMessage={t('sales.quotes_empty')} />}
    </OceanPage>
  );
}
