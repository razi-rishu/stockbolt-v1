import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { getAdapter } from '@/data/index';
import { useAuthStore } from '@/store/auth';
import { useCompanyCountry } from '@/hooks/use-company-currency';
import { Select } from '@/ui/select';
import { DocLink } from '@/ui/doc-link';
import { ReportActions } from '@/ui/report-actions';
import { indianFinancialYear, tdsQuarter } from '@/lib/tds';
import type { ContactRow, TdsDeductionRow } from '@/data/adapter';

/**
 * AC-7B — TDS register + Form 26Q summary (India only).
 *
 * Read-only view over the deduction ledger. The quarterly summary grouped by
 * section is what actually gets filed, so it is exportable/printable via the
 * shared ReportActions. Deductions are created and reversed from the vendor
 * bill (see modules/purchasing/tds-panel.tsx) — this page never posts.
 */

const MONEY = (n: number) => n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

export default function TdsPage() {
  const { t } = useTranslation();
  const { company_id } = useAuthStore();
  const country = useCompanyCountry();

  // Default to the current Indian financial year.
  const today = new Date().toISOString().slice(0, 10);
  const [fy, setFy] = useState<number>(indianFinancialYear(today));
  const [quarter, setQuarter] = useState<'all' | 'Q1' | 'Q2' | 'Q3' | 'Q4'>('all');

  const from = `${fy}-04-01`;
  const to = `${fy + 1}-03-31`;

  const { data: deductions = [], isLoading } = useQuery<TdsDeductionRow[]>({
    queryKey: ['tds_deductions', company_id, from, to],
    queryFn: () => getAdapter().tds.listDeductions(company_id!, from, to),
    enabled: !!company_id,
  });

  const { data: contacts = [] } = useQuery<ContactRow[]>({
    queryKey: ['contacts', company_id, 'supplier'],
    queryFn: () => getAdapter().contacts.list(company_id!, 'supplier'),
    enabled: !!company_id,
  });
  const nameOf = (id: string) => contacts.find((c) => c.id === id)?.name ?? '—';
  const panOf  = (id: string) => contacts.find((c) => c.id === id)?.pan ?? '';

  const visible = useMemo(
    () => deductions.filter((d) => quarter === 'all' || tdsQuarter(d.deduction_date) === quarter),
    [deductions, quarter],
  );

  /** Form 26Q shape: quarter × section, counting only live (non-reversed) rows. */
  const summary = useMemo(() => {
    const map = new Map<string, { quarter: string; section: string; count: number; base: number; tds: number }>();
    for (const d of deductions) {
      if (d.status !== 'posted') continue;
      const q = tdsQuarter(d.deduction_date);
      const key = `${q}|${d.section_code}`;
      const row = map.get(key) ?? { quarter: q, section: d.section_code, count: 0, base: 0, tds: 0 };
      row.count += 1;
      row.base = round2(row.base + Number(d.base_amount));
      row.tds = round2(row.tds + Number(d.amount));
      map.set(key, row);
    }
    return [...map.values()].sort((a, b) => a.quarter.localeCompare(b.quarter) || a.section.localeCompare(b.section));
  }, [deductions]);

  const totals = useMemo(() => ({
    base: round2(summary.reduce((a, r) => a + r.base, 0)),
    tds: round2(summary.reduce((a, r) => a + r.tds, 0)),
  }), [summary]);

  const fyOptions = useMemo(() => {
    const cur = indianFinancialYear(today);
    return [cur + 1, cur, cur - 1, cur - 2].map((y) => ({ value: String(y), label: `FY ${y}-${String((y + 1) % 100).padStart(2, '0')}` }));
  }, [today]);

  // Export rows for the shared Print / Excel actions.
  const exportRows = summary.map((r) => ({
    Quarter: r.quarter, Section: r.section, Deductions: r.count,
    'Base amount': r.base.toFixed(2), 'TDS deducted': r.tds.toFixed(2),
  }));

  if (country !== 'IN') {
    return (
      <div className="glass-card p-6 text-sm text-ink-tertiary">
        <h1 className="mb-1 text-lg font-bold text-ink-primary">{t('tds.title')}</h1>
        {t('tds.india_only')}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3" data-print-hide>
        <div>
          <h1 className="text-xl font-bold text-ink-primary">{t('tds.title')}</h1>
          <p className="text-xs text-ink-tertiary">{t('tds.subtitle')}</p>
        </div>
        <div className="flex flex-wrap items-end gap-2">
          <Select
            label={t('tds.f_fy')}
            options={fyOptions}
            value={String(fy)}
            onChange={(e) => setFy(Number(e.target.value))}
          />
          <Select
            label={t('tds.f_quarter')}
            options={[
              { value: 'all', label: t('tds.all_quarters') },
              { value: 'Q1', label: 'Q1 (Apr–Jun)' }, { value: 'Q2', label: 'Q2 (Jul–Sep)' },
              { value: 'Q3', label: 'Q3 (Oct–Dec)' }, { value: 'Q4', label: 'Q4 (Jan–Mar)' },
            ]}
            value={quarter}
            onChange={(e) => setQuarter(e.target.value as typeof quarter)}
          />
          <ReportActions
            rows={exportRows}
            headers={['Quarter', 'Section', 'Deductions', 'Base amount', 'TDS deducted']}
            filename={`tds-26q-summary-fy${fy}`}
          />
        </div>
      </div>

      {/* Form 26Q summary — quarter × section, the filing shape */}
      <div className="glass-card overflow-hidden">
        <div className="border-b border-border-subtle px-4 py-3">
          <h2 className="text-sm font-semibold text-ink-primary">{t('tds.summary_title')}</h2>
          <p className="text-xs text-ink-tertiary">{t('tds.summary_hint')}</p>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-surface-subtle text-xs uppercase tracking-wide text-ink-tertiary">
              <tr>
                <th className="px-4 py-2 text-start">{t('tds.col_quarter')}</th>
                <th className="px-4 py-2 text-start">{t('tds.col_section')}</th>
                <th className="px-4 py-2 text-end">{t('tds.col_count')}</th>
                <th className="px-4 py-2 text-end">{t('tds.col_base')}</th>
                <th className="px-4 py-2 text-end">{t('tds.col_tds')}</th>
              </tr>
            </thead>
            <tbody>
              {summary.length === 0 && (
                <tr><td colSpan={5} className="px-4 py-6 text-center text-ink-tertiary">{t('tds.no_deductions')}</td></tr>
              )}
              {summary.map((r) => (
                <tr key={`${r.quarter}-${r.section}`} className="border-t border-border-subtle">
                  <td className="px-4 py-2 text-ink-primary">{r.quarter}</td>
                  <td className="px-4 py-2 text-ink-secondary">{r.section}</td>
                  <td className="px-4 py-2 text-end text-ink-secondary">{r.count}</td>
                  <td className="px-4 py-2 text-end text-ink-secondary">{MONEY(r.base)}</td>
                  <td className="px-4 py-2 text-end font-medium text-ink-primary">{MONEY(r.tds)}</td>
                </tr>
              ))}
            </tbody>
            {summary.length > 0 && (
              <tfoot>
                <tr className="border-t-2 border-border-strong bg-surface-subtle font-semibold text-ink-primary">
                  <td className="px-4 py-2" colSpan={3}>{t('tds.total_payable')}</td>
                  <td className="px-4 py-2 text-end">{MONEY(totals.base)}</td>
                  <td className="px-4 py-2 text-end">{MONEY(totals.tds)}</td>
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      </div>

      {/* Deduction register */}
      <div className="glass-card overflow-hidden">
        <div className="border-b border-border-subtle px-4 py-3">
          <h2 className="text-sm font-semibold text-ink-primary">{t('tds.register_title')}</h2>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-surface-subtle text-xs uppercase tracking-wide text-ink-tertiary">
              <tr>
                <th className="px-4 py-2 text-start">{t('tds.col_date')}</th>
                <th className="px-4 py-2 text-start">{t('tds.col_vendor')}</th>
                <th className="px-4 py-2 text-start">{t('tds.col_pan')}</th>
                <th className="px-4 py-2 text-start">{t('tds.col_section')}</th>
                <th className="px-4 py-2 text-end">{t('tds.col_base')}</th>
                <th className="px-4 py-2 text-end">{t('tds.col_rate')}</th>
                <th className="px-4 py-2 text-end">{t('tds.col_tds')}</th>
                <th className="px-4 py-2 text-start">{t('tds.col_entry')}</th>
              </tr>
            </thead>
            <tbody>
              {isLoading && (
                <tr><td colSpan={8} className="px-4 py-6 text-center text-ink-tertiary">{t('common.loading')}</td></tr>
              )}
              {!isLoading && visible.length === 0 && (
                <tr><td colSpan={8} className="px-4 py-6 text-center text-ink-tertiary">{t('tds.no_deductions')}</td></tr>
              )}
              {visible.map((d) => (
                <tr key={d.id} className={`border-t border-border-subtle ${d.status === 'reversed' ? 'text-ink-tertiary line-through' : ''}`}>
                  <td className="px-4 py-2">{d.deduction_date}</td>
                  <td className="px-4 py-2 text-ink-primary">{nameOf(d.contact_id)}</td>
                  <td className="px-4 py-2 font-mono text-xs text-ink-secondary">
                    {panOf(d.contact_id) || <span className="text-warning-600">{t('tds.no_pan_short')}</span>}
                  </td>
                  <td className="px-4 py-2 text-ink-secondary">{d.section_code}</td>
                  <td className="px-4 py-2 text-end text-ink-secondary">{MONEY(Number(d.base_amount))}</td>
                  <td className="px-4 py-2 text-end text-ink-secondary">{Number(d.rate)}%</td>
                  <td className="px-4 py-2 text-end font-medium text-ink-primary">{MONEY(Number(d.amount))}</td>
                  <td className="px-4 py-2">
                    {d.journal_entry_id
                      ? <DocLink type="journal_entry" id={d.journal_entry_id} status={d.status === 'reversed' ? 'reversed' : 'active'} />
                      : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
