import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useDataAdapter } from '@/hooks/use-data-adapter';
import { useAuthStore } from '@/stores/authStore';
import type { CashFlowStatement } from '@/data/adapter';

function fmt(n: number, parens = false) {
  const abs = Math.abs(n);
  const s = new Intl.NumberFormat(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(abs);
  return parens && n < 0 ? `(${s})` : n < 0 ? `-${s}` : s;
}

function Row({ label, amount }: { label: string; amount: number }) {
  return (
    <div className="flex items-center justify-between py-1.5 text-sm">
      <span className="text-ink-secondary">{label}</span>
      <span className={`font-medium ${amount < 0 ? 'text-red-600' : 'text-ink-primary'}`}>{fmt(amount, true)}</span>
    </div>
  );
}

function SubtotalRow({ label, amount }: { label: string; amount: number }) {
  return (
    <div className="flex items-center justify-between border-t border-border py-1.5 text-sm font-semibold">
      <span className="text-ink-primary">{label}</span>
      <span className={`${amount < 0 ? 'text-red-700' : 'text-emerald-700'}`}>{fmt(amount, true)}</span>
    </div>
  );
}

export default function CashFlowPage() {
  const { t } = useTranslation();
  const adapter = useDataAdapter();
  const company = useAuthStore(s => s.company);

  const today = new Date().toISOString().slice(0, 10);
  const [from, setFrom]   = useState(today.slice(0, 4) + '-01-01');
  const [to, setTo]       = useState(today);
  const [data, setData]   = useState<CashFlowStatement | null>(null);
  const [loading, setLoading] = useState(false);

  const run = async () => {
    if (!company?.id) return;
    setLoading(true);
    try { setData(await adapter.reports.getCashFlow(company.id, from, to)); }
    catch (e) { console.error(e); }
    finally { setLoading(false); }
  };

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold text-ink-primary">{t('reports.cash_flow')}</h1>

      <div className="flex flex-wrap items-end gap-3 rounded-lg border border-border bg-surface-card p-4">
        <div>
          <label className="block text-xs text-ink-secondary mb-1">{t('common.date_from')}</label>
          <input type="date" value={from} onChange={e => setFrom(e.target.value)} className="input-field h-9 text-sm" />
        </div>
        <div>
          <label className="block text-xs text-ink-secondary mb-1">{t('common.date_to')}</label>
          <input type="date" value={to} onChange={e => setTo(e.target.value)} className="input-field h-9 text-sm" />
        </div>
        <button onClick={run} disabled={loading} className="btn-primary h-9 px-4 text-sm">
          {loading ? t('common.loading') : t('common.run')}
        </button>
      </div>

      {data && (
        <div className="max-w-xl rounded-lg border border-border bg-surface-card p-6 shadow-sm space-y-4">
          <div className="text-center">
            <p className="text-xs text-ink-tertiary">{data.period_start} — {data.period_end}</p>
          </div>

          {/* Operating */}
          <div>
            <p className="mb-1 font-semibold text-ink-primary text-sm uppercase tracking-wide">{t('reports.cf_operating')}</p>
            <Row label={t('reports.net_profit')} amount={data.net_profit} />
            {data.operating_adjustments.map((s, i) => <Row key={i} label={s.label} amount={s.amount} />)}
            <p className="mt-1 mb-1 text-xs text-ink-tertiary font-medium">{t('reports.cf_working_capital')}</p>
            {data.working_capital_changes.map((s, i) => <Row key={i} label={s.label} amount={s.amount} />)}
            <SubtotalRow label={t('reports.net_operating')} amount={data.net_operating} />
          </div>

          {/* Investing */}
          <div>
            <p className="mb-1 font-semibold text-ink-primary text-sm uppercase tracking-wide">{t('reports.cf_investing')}</p>
            {data.investing_activities.length === 0 ? <Row label={t('common.none')} amount={0} /> : data.investing_activities.map((s, i) => <Row key={i} label={s.label} amount={s.amount} />)}
            <SubtotalRow label={t('reports.net_investing')} amount={data.net_investing} />
          </div>

          {/* Financing */}
          <div>
            <p className="mb-1 font-semibold text-ink-primary text-sm uppercase tracking-wide">{t('reports.cf_financing')}</p>
            {data.financing_activities.length === 0 ? <Row label={t('common.none')} amount={0} /> : data.financing_activities.map((s, i) => <Row key={i} label={s.label} amount={s.amount} />)}
            <SubtotalRow label={t('reports.net_financing')} amount={data.net_financing} />
          </div>

          {/* Summary */}
          <div className="border-t-2 border-border pt-3 space-y-1">
            <Row label={t('reports.net_increase_cash')} amount={data.net_increase} />
            <Row label={t('reports.opening_cash')} amount={data.opening_cash} />
            <SubtotalRow label={t('reports.closing_cash')} amount={data.closing_cash} />
          </div>
        </div>
      )}
    </div>
  );
}
