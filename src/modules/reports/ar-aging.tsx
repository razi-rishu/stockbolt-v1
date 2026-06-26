import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { getAdapter } from '@/data/index';
import { useAuthStore } from '@/store/auth';
import { Input } from '@/ui/input';
import { Button } from '@/ui/button';
import { DocLink } from '@/ui/doc-link';

function fmt(n: number) {
  return n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/**
 * Accounting-style signed formatter — negatives wrapped in parens.
 *   -100 → "(100.00)" ; 100 → "100.00"
 * Used for the "Net Due" column: a negative means the customer is in
 * credit with us (we owe them).
 */
function fmtSigned(n: number) {
  if (n < -0.005) return `(${fmt(-n)})`;
  return fmt(n);
}

function todayIso() { return new Date().toISOString().slice(0, 10); }

export default function ARAgingPage() {
  const { t } = useTranslation();
  const { company_id } = useAuthStore();
  const [asOf, setAsOf] = useState(todayIso);
  const [trigger, setTrigger] = useState(0);

  const { data: ar, isLoading, error } = useQuery({
    queryKey: ['ar_aging', company_id, asOf, trigger],
    queryFn: () => getAdapter().reports.getARAgingReport(company_id!, asOf),
    enabled: !!company_id && trigger > 0,
  });

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold text-ink-primary">{t('reports.ar_aging_title')}</h1>

      <div className="flex items-center gap-3 rounded-card border border-border-subtle bg-surface-card px-5 py-3">
        <Input type="date" label={t('reports.as_of_date')} value={asOf} onChange={e => setAsOf(e.target.value)} />
        <div className="mt-5">
          <Button size="sm" onClick={() => setTrigger(n => n + 1)}>{t('reports.run')}</Button>
        </div>
      </div>

      {isLoading && <p className="text-sm text-ink-secondary">{t('common.loading')}</p>}
      {error && <p className="text-sm text-red-600">{String(error)}</p>}

      {ar && ar.buckets.length === 0 && (
        <p className="text-sm text-ink-tertiary">{t('reports.no_outstanding')}</p>
      )}

      {ar && ar.buckets.length > 0 && (
        <div className="rounded-card border border-border-subtle bg-surface-card">
          <div className="border-b border-border-subtle px-5 py-3 text-sm text-ink-secondary">
            {t('reports.as_of_date')}: {asOf}
          </div>
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border-subtle bg-surface-muted text-xs text-ink-tertiary">
                <th className="px-4 py-2.5 text-start font-medium">{t('reports.customer')}</th>
                <th className="px-4 py-2.5 text-end font-medium">{t('reports.current')}</th>
                <th className="px-4 py-2.5 text-end font-medium">31–60</th>
                <th className="px-4 py-2.5 text-end font-medium">61–90</th>
                <th className="px-4 py-2.5 text-end font-medium">&gt;90</th>
                <th className="px-4 py-2.5 text-end font-medium">{t('reports.total')}</th>
                {/* Phase 12.24 — advance + net due columns */}
                <th
                  className="px-4 py-2.5 text-end font-medium"
                  title="Unallocated customer advance held in 2400 Customer Advances"
                >
                  Advance
                </th>
                <th
                  className="px-4 py-2.5 text-end font-medium"
                  title="Outstanding minus advance — what the customer actually owes (negative = we owe them)"
                >
                  Net Due
                </th>
              </tr>
            </thead>
            <tbody>
              {ar.buckets.map(b => {
                const netNegative = b.net_due < -0.005;
                return (
                  <tr key={b.contact_id} className="border-b border-border-subtle last:border-0">
                    <td className="px-4 py-2.5"><DocLink type="customer" id={b.contact_id} label={b.contact_name} className="font-medium text-brand-600 hover:underline" /></td>
                    <td className="px-4 py-2.5 text-end font-mono text-ink-primary">{b.current > 0 ? fmt(b.current) : '—'}</td>
                    <td className="px-4 py-2.5 text-end font-mono text-orange-600">{b.days_31_60 > 0 ? fmt(b.days_31_60) : '—'}</td>
                    <td className="px-4 py-2.5 text-end font-mono text-red-500">{b.days_61_90 > 0 ? fmt(b.days_61_90) : '—'}</td>
                    <td className="px-4 py-2.5 text-end font-mono text-red-700">{b.over_90 > 0 ? fmt(b.over_90) : '—'}</td>
                    <td className="px-4 py-2.5 text-end font-mono font-semibold text-ink-primary">{fmt(b.total)}</td>
                    <td className="px-4 py-2.5 text-end font-mono text-emerald-700">
                      {b.advance_credit > 0.005 ? fmt(b.advance_credit) : '—'}
                    </td>
                    <td className={`px-4 py-2.5 text-end font-mono font-semibold ${netNegative ? 'text-emerald-700' : 'text-ink-primary'}`}>
                      {fmtSigned(b.net_due)}
                    </td>
                  </tr>
                );
              })}
              <tr className="border-t-2 border-border-subtle bg-surface-muted font-semibold">
                <td className="px-4 py-2.5 text-ink-primary">{t('reports.total')}</td>
                <td className="px-4 py-2.5 text-end font-mono">{fmt(ar.total_current)}</td>
                <td className="px-4 py-2.5 text-end font-mono">{fmt(ar.total_31_60)}</td>
                <td className="px-4 py-2.5 text-end font-mono">{fmt(ar.total_61_90)}</td>
                <td className="px-4 py-2.5 text-end font-mono">{fmt(ar.total_over_90)}</td>
                <td className="px-4 py-2.5 text-end font-mono">{fmt(ar.grand_total)}</td>
                <td className="px-4 py-2.5 text-end font-mono text-emerald-700">
                  {fmt(ar.buckets.reduce((s, b) => s + b.advance_credit, 0))}
                </td>
                <td className="px-4 py-2.5 text-end font-mono">
                  {fmtSigned(ar.buckets.reduce((s, b) => s + b.net_due, 0))}
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
