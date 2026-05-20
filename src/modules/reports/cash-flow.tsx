import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { getAdapter } from '@/data';
import { useAuthStore } from '@/store/auth';
import { PageHeader, Panel } from '@/ui/primitives';
import { theme } from '@/ui/theme';
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

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <p style={{
      margin: '0 0 6px',
      fontSize: '11px', fontWeight: 700, color: theme.inkMuted,
      textTransform: 'uppercase', letterSpacing: '.08em',
    }}>{children}</p>
  );
}

export default function CashFlowPage() {
  const { t } = useTranslation();
  const adapter = getAdapter();
  const company_id = useAuthStore(s => s.company_id);

  const today = new Date().toISOString().slice(0, 10);
  const [from, setFrom]   = useState(today.slice(0, 4) + '-01-01');
  const [to, setTo]       = useState(today);
  const [data, setData]   = useState<CashFlowStatement | null>(null);
  const [loading, setLoading] = useState(false);

  const run = async () => {
    if (!company_id) return;
    setLoading(true);
    try { setData(await adapter.reports.getCashFlow(company_id, from, to)); }
    catch (e) { console.error(e); }
    finally { setLoading(false); }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
      <PageHeader title={t('reports.cash_flow')} subtitle={data ? `${data.period_start} — ${data.period_end}` : `${from} — ${to}`} />

      <Panel icon="📅" title="Period">
        <div style={{ display: 'flex', alignItems: 'flex-end', gap: '12px', flexWrap: 'wrap' }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
            <label style={{ fontSize: '11px', fontWeight: 600, color: theme.inkMuted, textTransform: 'uppercase', letterSpacing: '.05em' }}>{t('common.date_from')}</label>
            <input
              type="date" value={from} onChange={e => setFrom(e.target.value)}
              style={{ height: '36px', padding: '0 12px', fontSize: '13px', border: `1px solid ${theme.border}`, borderRadius: '7px', background: '#fff', color: theme.ink, outline: 'none' }}
            />
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
            <label style={{ fontSize: '11px', fontWeight: 600, color: theme.inkMuted, textTransform: 'uppercase', letterSpacing: '.05em' }}>{t('common.date_to')}</label>
            <input
              type="date" value={to} onChange={e => setTo(e.target.value)}
              style={{ height: '36px', padding: '0 12px', fontSize: '13px', border: `1px solid ${theme.border}`, borderRadius: '7px', background: '#fff', color: theme.ink, outline: 'none' }}
            />
          </div>
          <button
            onClick={run} disabled={loading}
            style={{
              height: '36px', padding: '0 18px',
              background: theme.brand, color: '#fff', border: 'none',
              borderRadius: '7px', fontSize: '13px', fontWeight: 600,
              cursor: loading ? 'not-allowed' : 'pointer',
              opacity: loading ? 0.6 : 1,
            }}
          >
            {loading ? t('common.loading') : t('common.run')}
          </button>
        </div>
      </Panel>

      {data && (
        <div style={{
          maxWidth: '640px',
          background: theme.card, border: `1px solid ${theme.border}`,
          borderRadius: '12px', boxShadow: theme.shadowSm,
          padding: '24px',
          display: 'flex', flexDirection: 'column', gap: '20px',
        }}>
          <div style={{ textAlign: 'center', fontSize: '12px', color: theme.inkFaint }}>
            {data.period_start} — {data.period_end}
          </div>

          {/* Operating */}
          <div>
            <SectionLabel>{t('reports.cf_operating')}</SectionLabel>
            <Row label={t('reports.net_profit')} amount={data.net_profit} />
            {data.operating_adjustments.map((s, i) => <Row key={i} label={s.label} amount={s.amount} />)}
            <p style={{ margin: '6px 0 4px', fontSize: '11px', fontWeight: 600, color: theme.inkFaint }}>{t('reports.cf_working_capital')}</p>
            {data.working_capital_changes.map((s, i) => <Row key={i} label={s.label} amount={s.amount} />)}
            <SubtotalRow label={t('reports.net_operating')} amount={data.net_operating} />
          </div>

          {/* Investing */}
          <div>
            <SectionLabel>{t('reports.cf_investing')}</SectionLabel>
            {data.investing_activities.length === 0 ? <Row label={t('common.none')} amount={0} /> : data.investing_activities.map((s, i) => <Row key={i} label={s.label} amount={s.amount} />)}
            <SubtotalRow label={t('reports.net_investing')} amount={data.net_investing} />
          </div>

          {/* Financing */}
          <div>
            <SectionLabel>{t('reports.cf_financing')}</SectionLabel>
            {data.financing_activities.length === 0 ? <Row label={t('common.none')} amount={0} /> : data.financing_activities.map((s, i) => <Row key={i} label={s.label} amount={s.amount} />)}
            <SubtotalRow label={t('reports.net_financing')} amount={data.net_financing} />
          </div>

          {/* Summary */}
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
