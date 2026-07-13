import { useState, type ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { getAdapter } from '@/data';
import { useAuthStore } from '@/store/auth';
import { PageHeader } from '@/ui/primitives';
import { theme } from '@/ui/theme';
import { usePeriodPicker } from '@/hooks/use-period-picker';
import { PeriodPicker } from '@/ui/period-picker';
import { ReportActions } from '@/ui/report-actions';
import type { CashFlowStatement } from '@/data/adapter';

function fmt(n: number, parens = false) {
  const abs = Math.abs(n);
  const s = new Intl.NumberFormat(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(abs);
  return parens && n < 0 ? `(${s})` : n < 0 ? `-${s}` : s;
}

function Row({ label, amount }: { label: string; amount: number }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '6px 0', fontSize: '13px' }}>
      <span style={{ color: theme.inkMuted }}>{label}</span>
      <span className="font-mono" style={{ fontWeight: 500, color: amount < 0 ? '#dc2626' : theme.ink }}>{fmt(amount, true)}</span>
    </div>
  );
}

function SubtotalRow({ label, amount }: { label: string; amount: number }) {
  return (
    <div style={{
      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      padding: '8px 0', fontSize: '13px', fontWeight: 700,
      borderTop: `1px solid ${theme.border}`, marginTop: '4px',
    }}>
      <span style={{ color: theme.ink }}>{label}</span>
      <span className="font-mono" style={{ color: amount < 0 ? '#dc2626' : theme.brand }}>{fmt(amount, true)}</span>
    </div>
  );
}

function CashSection({
  title, total, totalLabel, children,
}: {
  title: string;
  total: number;
  totalLabel: string;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(true);
  return (
    <div style={{ border: `1px solid ${theme.border}`, borderRadius: '10px', overflow: 'hidden' }}>
      {/* Collapsible header */}
      <div
        onClick={() => setOpen(o => !o)}
        title={open ? 'Click to collapse' : 'Click to expand'}
        style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '9px 14px',
          background: '#f8fafc',
          borderBottom: open ? `1px solid ${theme.border}` : 'none',
          cursor: 'pointer',
          userSelect: 'none',
        }}
      >
        <span style={{ fontSize: '11px', fontWeight: 700, color: theme.inkMuted, textTransform: 'uppercase', letterSpacing: '.08em', display: 'flex', alignItems: 'center', gap: '6px' }}>
          <span style={{ fontSize: '9px', opacity: 0.6 }}>{open ? '▾' : '▸'}</span>
          {title}
        </span>
        {!open && (
          <span className="font-mono" style={{ fontSize: '13px', fontWeight: 700, color: total < 0 ? '#dc2626' : theme.brand }}>
            {fmt(total, true)}
          </span>
        )}
      </div>
      {open && (
        <div style={{ padding: '10px 14px' }}>
          {children}
          <SubtotalRow label={totalLabel} amount={total} />
        </div>
      )}
    </div>
  );
}

export default function CashFlowPage() {
  const { t } = useTranslation();
  const company_id = useAuthStore(s => s.company_id);

  // Phase 46b — range period picker; preset clicks auto-run. Default this year.
  const { preset, from, to, setPreset, setCustomRange } = usePeriodPicker('stockbolt.report.cash-flow.period', 'this_year');

  const { data, isLoading: loading } = useQuery<CashFlowStatement>({
    queryKey: ['cash_flow', company_id, from, to],
    queryFn: () => getAdapter().reports.getCashFlow(company_id!, from, to),
    enabled: !!company_id,
  });

  const exportRows: Record<string, unknown>[] = [];
  if (data) {
    const push = (section: string, label: string, amount: number) =>
      exportRows.push({ Section: section, Line: label, Amount: amount.toFixed(2) });
    push('Operating', 'Net Profit', data.net_profit);
    for (const s of data.operating_adjustments) push('Operating', s.label, s.amount);
    for (const s of data.working_capital_changes) push('Operating (Working Capital)', s.label, s.amount);
    push('Operating', 'Net Cash from Operating', data.net_operating);
    for (const s of data.investing_activities) push('Investing', s.label, s.amount);
    push('Investing', 'Net Cash from Investing', data.net_investing);
    for (const s of data.financing_activities) push('Financing', s.label, s.amount);
    push('Financing', 'Net Cash from Financing', data.net_financing);
    push('Summary', 'Net Increase in Cash', data.net_increase);
    push('Summary', 'Opening Cash', data.opening_cash);
    push('Summary', 'Closing Cash', data.closing_cash);
  }
  const exportHeaders = ['Section', 'Line', 'Amount'];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
      <PageHeader
        title={t('reports.cash_flow')}
        subtitle={data ? `${data.period_start} — ${data.period_end}` : `${from} — ${to}`}
        actions={
          <div data-print-hide style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
            <PeriodPicker
              mode="range" preset={preset} from={from} to={to}
              onPresetChange={setPreset} onCustomRange={setCustomRange}
            />
            <ReportActions rows={exportRows} headers={exportHeaders} filename={`cash-flow-${from}_${to}`} disabled={!data} />
          </div>
        }
      />

      {loading && !data && <p style={{ fontSize: '13px', color: theme.inkMuted, padding: '24px 0', textAlign: 'center' }}>{t('common.loading')}</p>}

      {data && (
        <div style={{
          maxWidth: '640px',
          background: theme.card, border: `1px solid ${theme.border}`,
          borderRadius: '12px', boxShadow: theme.shadowSm,
          padding: '24px',
          display: 'flex', flexDirection: 'column', gap: '14px',
        }}>
          <div style={{ textAlign: 'center', fontSize: '12px', color: theme.inkFaint }}>
            {data.period_start} — {data.period_end}
          </div>

          {/* ── Operating Activities ─────────────────────────────── */}
          <CashSection title={t('reports.cf_operating')} total={data.net_operating} totalLabel={t('reports.net_operating')}>
            <Row label={t('reports.net_profit')} amount={data.net_profit} />
            {data.operating_adjustments.map((s, i) => <Row key={i} label={s.label} amount={s.amount} />)}
            {data.working_capital_changes.length > 0 && (
              <>
                <p style={{ margin: '8px 0 4px', fontSize: '11px', fontWeight: 600, color: theme.inkFaint }}>
                  {t('reports.cf_working_capital')}
                </p>
                {data.working_capital_changes.map((s, i) => <Row key={i} label={s.label} amount={s.amount} />)}
              </>
            )}
          </CashSection>

          {/* ── Investing Activities ──────────────────────────────── */}
          <CashSection title={t('reports.cf_investing')} total={data.net_investing} totalLabel={t('reports.net_investing')}>
            {data.investing_activities.length === 0
              ? <Row label={t('common.none')} amount={0} />
              : data.investing_activities.map((s, i) => <Row key={i} label={s.label} amount={s.amount} />)
            }
          </CashSection>

          {/* ── Financing Activities ──────────────────────────────── */}
          <CashSection title={t('reports.cf_financing')} total={data.net_financing} totalLabel={t('reports.net_financing')}>
            {data.financing_activities.length === 0
              ? <Row label={t('common.none')} amount={0} />
              : data.financing_activities.map((s, i) => <Row key={i} label={s.label} amount={s.amount} />)
            }
          </CashSection>

          {/* ── Summary — always visible ─────────────────────────── */}
          <div style={{ borderTop: `2px solid ${theme.border}`, paddingTop: '12px' }}>
            <Row label={t('reports.net_increase_cash')} amount={data.net_increase} />
            <Row label={t('reports.opening_cash')} amount={data.opening_cash} />
            <SubtotalRow label={t('reports.closing_cash')} amount={data.closing_cash} />
          </div>
        </div>
      )}
    </div>
  );
}
