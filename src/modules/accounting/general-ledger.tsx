import { useState, useEffect, useMemo } from 'react';
import { formatDate } from '@/lib/locale';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { useSearchParams } from 'react-router-dom';
import { getAdapter } from '@/data/index';
import { useAuthStore } from '@/store/auth';
import { Button } from '@/ui/button';
import { DocLink } from '@/ui/doc-link';
import { OceanPage } from '@/components/ocean-list';
import { BookOpen, Eye } from 'lucide-react';
import { usePeriodPicker } from '@/hooks/use-period-picker';
import { PeriodPicker } from '@/ui/period-picker';
import type { LedgerEntry, CoaRow } from '@/data/adapter';

function fmt(n: number) {
  return n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

// ── Source chip — human label per document type (glOcean.src_*) ───────────
// Tones only group the chips visually; the label is the translated type.
const SOURCE_TONE: Record<string, string> = {
  invoice: '', vendor_bill: 'sb-pill-good', payment: '', expense: 'sb-pill-warn',
  goods_receipt: 'sb-pill-good', credit_note: 'sb-pill-bad', debit_note: 'sb-pill-bad',
  sales_return: 'sb-pill-bad', inventory_adjustment: 'sb-pill-muted', stock_transfer: 'sb-pill-muted',
  bank_transfer: '', opening_balance: 'sb-pill-muted', inventory_cogs: 'sb-pill-warn',
};

function SourceCell({ type, id, number }: { type: string; id: string | null; number: string | null }) {
  const { t } = useTranslation();
  const label = type
    ? t(`glOcean.src_${type}`, { defaultValue: t(`jeOcean.src_${type}`, { defaultValue: type.replace(/_/g, ' ') }) })
    : t('jeOcean.src_manual');
  return (
    <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
      {number && <bdi dir="ltr"><DocLink type={type} id={id} label={number} className="font-mono text-xs text-brand-600 hover:underline" /></bdi>}
      <span className={`sb-pill ${SOURCE_TONE[type] ?? 'sb-pill-muted'}`} style={{ marginTop: 0, fontSize: 11, padding: '1px 8px' }}>{label}</span>
    </span>
  );
}

export default function GeneralLedgerPage() {
  const { t } = useTranslation();
  const { company_id } = useAuthStore();
  const [searchParams] = useSearchParams();

  // Phase 47c — preset period picker (replaces raw From/To). Default this_year
  // (= the page's previous firstOfYear→today default). A Trial-Balance drill-down
  // URL (?from&to) seeds an exact custom range so the drilled period is preserved.
  const { preset, from, to, setPreset, setCustomRange } =
    usePeriodPicker('stockbolt.list.general-ledger.period', 'this_year');

  // URL params (set by Trial Balance drill-down) take precedence as initial state.
  const initialCode = searchParams.get('code') ?? '';
  const [accountCode, setAccountCode] = useState(initialCode);
  const [query, setQuery] = useState<{ code: string; from: string; to: string } | null>(
    initialCode
      ? { code: initialCode, from: searchParams.get('from') ?? from, to: searchParams.get('to') ?? to }
      : null,
  );
  // Default ON — hides the original reversed entry and its void counterpart,
  // so the ledger shows only the "net" history (no noise from edit/void pairs).
  const [hideReversed, setHideReversed] = useState(true);

  // If the URL params change after mount (e.g. user navigates from TB again with a different account),
  // re-run the query without requiring a manual click, seeding the picker with the drilled range.
  useEffect(() => {
    const code = searchParams.get('code');
    const f = searchParams.get('from');
    const t2 = searchParams.get('to');
    if (code) {
      setAccountCode(code);
      if (f && t2) setCustomRange(f, t2);
      setQuery({ code, from: f ?? from, to: t2 ?? to });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams]);

  const { data: accounts = [] } = useQuery<CoaRow[]>({
    queryKey: ['coa', company_id],
    queryFn: () => getAdapter().coa.list(company_id!),
    enabled: !!company_id,
  });

  const { data: entries = [], isFetching } = useQuery<LedgerEntry[]>({
    queryKey: ['gl_ledger', company_id, query?.code, query?.from, query?.to],
    queryFn: () => getAdapter().accounting.getLedgerEntries(company_id!, query!.code, query!.from, query!.to),
    enabled: !!company_id && !!query,
  });

  function handleSearch(e: React.FormEvent) {
    e.preventDefault();
    if (accountCode.trim()) setQuery({ code: accountCode.trim(), from, to });
  }

  // When hideReversed is ON, drop BOTH halves of every reversal pair:
  //  • rows whose JE has reversed_by_id set (the original that was voided/edited)
  //  • rows whose JE has reversal_of_id set (the reversal entry itself —
  //    "Edit Reversal – INV-1001" etc.)
  //  • legacy "Void opening" rows that predate the reversal_of_id link
  // Then recompute running_balance from scratch on the visible set so the
  // balance column is always correct regardless of what was filtered out.
  const visibleEntries = useMemo(() => {
    const all = entries as LedgerEntry[];
    if (!hideReversed) return all;
    const filtered = all.filter(
      (e) =>
        e.reversed_by_id === null &&
        e.reversal_of_id === null &&
        !e.description.toLowerCase().startsWith('void opening'),
    );
    let running = 0;
    return filtered.map((e) => {
      running += e.debit - e.credit;
      return { ...e, running_balance: running };
    });
  }, [entries, hideReversed]);

  const totalDebit  = visibleEntries.reduce((s, e) => s + e.debit,  0);
  const totalCredit = visibleEntries.reduce((s, e) => s + e.credit, 0);
  const closing = visibleEntries.length ? visibleEntries[visibleEntries.length - 1].running_balance : 0;

  const selectedAccount = accounts.find((a) => a.code === query?.code);

  // Ocean Teal (UI v1.1): look only — same account/period filter, Trial
  // Balance drill-down, hide-reversed rule, running balance and totals.
  return (
    <OceanPage
      testid="general-ledger-ocean"
      title={t('accounting.gl_title')}
      subtitle={query ? t('glOcean.lines_count', { count: visibleEntries.length }) : t('glOcean.pick_hint')}
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        <form onSubmit={handleSearch} className="sb-card sb-form sb-doc-card sb-gl-filters">
          <div style={{ minWidth: 0 }}>
            <label className="mb-1 block text-xs font-medium text-ink-secondary">{t('accounting.account_code')}</label>
            <select
              value={accountCode}
              onChange={(e) => setAccountCode(e.target.value)}
              className="sb-pc-select"
            >
              <option value="">{t('accounting.select_account')}</option>
              {accounts.map((a) => (
                <option key={a.id} value={a.code}>{a.code} — {a.name}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-ink-secondary">{t('reports.period') || 'Period'}</label>
            <PeriodPicker
              mode="range" preset={preset} from={from} to={to}
              onPresetChange={setPreset} onCustomRange={setCustomRange}
            />
          </div>
          <Button type="submit" size="sm"><Eye size={15} aria-hidden="true" /> {t('accounting.view_ledger')}</Button>
        </form>

        {query && (
          <div className="sb-card sb-doc-card sb-doc-lines">
            <div className="sb-doc-lines-head">
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
                <span className="sb-side-ico" style={{ background: 'var(--sb-primary-light)', color: 'var(--sb-primary-dark)' }} aria-hidden="true"><BookOpen size={17} /></span>
                <div style={{ minWidth: 0 }}>
                  <p className="sb-doc-card-title" style={{ margin: 0 }}>
                    <bdi dir="ltr">{query.code}</bdi>{selectedAccount ? ` — ${selectedAccount.name}` : ''}
                  </p>
                  <bdi dir="ltr" className="sb-fx-name" style={{ fontSize: 12 }}>{query.from} → {query.to}</bdi>
                </div>
              </div>
              {/* Hide-reversed toggle — keeps ledger clean after edit/void cycles */}
              <label className="flex cursor-pointer select-none items-center gap-1.5 text-sm text-ink-secondary">
                <input
                  type="checkbox"
                  checked={hideReversed}
                  onChange={(ev) => setHideReversed(ev.target.checked)}
                  className="h-4 w-4"
                  style={{ accentColor: 'var(--sb-primary)' }}
                />
                {t('glOcean.hide_reversed')}
              </label>
            </div>

            {isFetching ? (
              <p className="sb-empty" style={{ margin: 0 }}>{t('common.loading')}</p>
            ) : visibleEntries.length === 0 ? (
              <p className="sb-empty" style={{ margin: 0 }}>
                {entries.length > 0 && hideReversed ? t('glOcean.all_reversed') : t('accounting.gl_empty')}
              </p>
            ) : (
              <>
                <div className="sb-gl-summary">
                  <div><span className="sb-info-label">{t('accounting.debit')}</span><bdi dir="ltr" className="sb-dash-num">{fmt(totalDebit)}</bdi></div>
                  <div><span className="sb-info-label">{t('accounting.credit')}</span><bdi dir="ltr" className="sb-dash-num">{fmt(totalCredit)}</bdi></div>
                  <div><span className="sb-info-label">{t('glOcean.closing')}</span><bdi dir="ltr" className="sb-dash-num" style={{ color: closing < 0 ? 'var(--sb-danger)' : 'var(--sb-primary-dark)' }}>{fmt(closing)}</bdi></div>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm" style={{ minWidth: 860 }}>
                    <thead>
                      <tr>
                        <th className="px-4 py-2 text-start font-medium">{t('accounting.date')}</th>
                        <th className="px-4 py-2 text-start font-medium">{t('accounting.entry_number')}</th>
                        <th className="px-4 py-2 text-start font-medium">{t('glOcean.source')}</th>
                        <th className="px-4 py-2 text-start font-medium">{t('accounting.description')}</th>
                        <th className="px-4 py-2 text-end font-medium">{t('accounting.debit')}</th>
                        <th className="px-4 py-2 text-end font-medium">{t('accounting.credit')}</th>
                        <th className="px-4 py-2 text-end font-medium">{t('accounting.balance')}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {visibleEntries.map((e) => (
                        <tr key={e.id} className="border-b border-border-subtle last:border-0">
                          <td className="px-4 py-2.5 text-ink-secondary whitespace-nowrap"><bdi dir="ltr">{formatDate(e.date)}</bdi></td>
                          <td className="px-4 py-2.5 font-mono text-xs">
                            <bdi dir="ltr">
                              <DocLink type="journal_entry" id={e.journal_entry_id} label={e.entry_number}
                                status={e.reversed_by_id ? 'reversed' : 'active'}
                                className="font-mono text-xs text-brand-600 hover:underline" />
                            </bdi>
                          </td>
                          <td className="px-4 py-2.5"><SourceCell type={e.source_type} id={e.source_id} number={e.source_number} /></td>
                          <td className="px-4 py-2.5 text-ink-primary">{e.description || '—'}</td>
                          <td className="px-4 py-2.5 text-end font-mono" dir="ltr">{e.debit > 0 ? fmt(e.debit) : ''}</td>
                          <td className="px-4 py-2.5 text-end font-mono" dir="ltr">{e.credit > 0 ? fmt(e.credit) : ''}</td>
                          <td className={`px-4 py-2.5 text-end font-mono ${e.running_balance < 0 ? 'text-red-500' : ''}`} dir="ltr">
                            {fmt(e.running_balance)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                    <tfoot>
                      <tr className="font-semibold" style={{ background: 'var(--sb-primary-soft)', color: 'var(--sb-primary-dark)' }}>
                        <td colSpan={4} className="px-4 py-2.5 text-sm">{t('accounting.total')}</td>
                        <td className="px-4 py-2.5 text-end font-mono" dir="ltr">{fmt(totalDebit)}</td>
                        <td className="px-4 py-2.5 text-end font-mono" dir="ltr">{fmt(totalCredit)}</td>
                        <td />
                      </tr>
                    </tfoot>
                  </table>
                </div>
              </>
            )}
          </div>
        )}
      </div>
    </OceanPage>
  );
}
