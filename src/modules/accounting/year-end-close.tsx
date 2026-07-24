import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { getAdapter } from '@/data/index';
import { useAuthStore } from '@/store/auth';
import { hasPerm } from '@/lib/permissions';
import { Button } from '@/ui/button';
import { Modal } from '@/ui/modal';
import { DocLink } from '@/ui/doc-link';
import type { Company, YearEndClosePreview, FiscalYearClose, YearEndCloseResult, YearEndReopenResult } from '@/data/adapter';

/**
 * AC-1.2 — Year-End Close (single guided page).
 *
 * Region A: preview + close the next fiscal year in sequence (guided; no
 * free year-picker). Leads with a "Preview — Not Posted" banner and a Closing
 * Impact Summary, then the exact closing journal that would post. Confirm modal
 * → swaps to a success panel with a drill-down to the posted entry.
 *
 * Region B: closed-years history + LIFO reopen (latest closed year only).
 *
 * The preview is read-only (getAdapter().accounting.previewYearEndClose) and
 * mirrors the close RPC's aggregation, so the numbers match the P&L and what
 * close_fiscal_year() posts. The Print/Save-PDF action prints just this preview
 * with the "Not Posted" banner intact.
 */
export default function YearEndClosePage() {
  const { t } = useTranslation();
  const { company_id, role, permissions } = useAuthStore();
  const qc = useQueryClient();
  const canWrite = hasPerm(role, permissions, 'accounting.write');

  const [showClose, setShowClose] = useState(false);
  const [closeResult, setCloseResult] = useState<YearEndCloseResult | null>(null);
  const [reopenYear, setReopenYear] = useState<number | null>(null);
  const [reopenResult, setReopenResult] = useState<YearEndReopenResult | null>(null);

  const { data: company } = useQuery<Company | null>({
    queryKey: ['company', company_id],
    queryFn: () => getAdapter().companies.getById(company_id!),
    enabled: !!company_id,
  });
  const currency = (company as any)?.currency ?? '';

  const { data: nextYear, isLoading: loadingNext } = useQuery<number | null>({
    queryKey: ['yec-next', company_id],
    queryFn: () => getAdapter().accounting.getNextCloseableFiscalYear(company_id!),
    enabled: !!company_id,
  });

  const { data: preview, isLoading: loadingPreview } = useQuery<YearEndClosePreview>({
    queryKey: ['yec-preview', company_id, nextYear],
    queryFn: () => getAdapter().accounting.previewYearEndClose(company_id!, nextYear!),
    enabled: !!company_id && nextYear != null,
  });

  const { data: closes, isLoading: loadingCloses } = useQuery<FiscalYearClose[]>({
    queryKey: ['yec-closes', company_id],
    queryFn: () => getAdapter().accounting.listFiscalYearCloses(company_id!),
    enabled: !!company_id,
  });

  function invalidateAll() {
    qc.invalidateQueries({ queryKey: ['yec-next', company_id] });
    qc.invalidateQueries({ queryKey: ['yec-preview', company_id] });
    qc.invalidateQueries({ queryKey: ['yec-closes', company_id] });
    qc.invalidateQueries({ queryKey: ['company', company_id] }); // lock date changed
  }

  const closeMutation = useMutation({
    mutationFn: () => getAdapter().accounting.closeFiscalYear(nextYear!),
    onSuccess: (res) => { setCloseResult(res); invalidateAll(); },
  });

  const reopenMutation = useMutation({
    mutationFn: (fy: number) => getAdapter().accounting.reopenFiscalYear(fy),
    onSuccess: (res) => { setReopenResult(res); invalidateAll(); },
  });

  // ── formatters ───────────────────────────────────────────────────────────
  const fmt = (n: number) => Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const money = (n: number) => (currency ? `${currency} ${fmt(n)}` : fmt(n));
  const signedMoney = (n: number) => (n < 0 ? `(${money(n)})` : money(n));
  const fmtDate = (iso: string | null | undefined) =>
    iso ? new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : '—';

  const latestClosedYear = (closes ?? [])
    .filter((c) => c.status === 'closed')
    .reduce<number | null>((max, c) => (max == null || c.fiscal_year > max ? c.fiscal_year : max), null);

  return (
    <div className="space-y-6">
      <div data-print-hide>
        <h1 className="text-xl font-semibold text-ink-primary">{t('accounting.yec_title')}</h1>
        <p className="mt-1 text-sm text-ink-secondary">{t('accounting.yec_hint')}</p>
      </div>

      {/* ── Region A — next closeable year ───────────────────────────────── */}
      {loadingNext || (nextYear != null && loadingPreview) ? (
        <PreviewSkeleton />
      ) : nextYear == null ? (
        <div data-print-hide className="rounded-card border border-border-subtle bg-surface-card p-8 text-center">
          <p className="text-sm font-medium text-ink-primary">
            {(closes ?? []).some((c) => c.status === 'closed')
              ? t('accounting.yec_all_caught_up')
              : t('accounting.yec_nothing_to_close')}
          </p>
          <p className="mt-1 text-xs text-ink-tertiary">
            {(closes ?? []).some((c) => c.status === 'closed')
              ? t('accounting.yec_all_caught_up_sub')
              : t('accounting.yec_nothing_to_close_sub')}
          </p>
        </div>
      ) : preview ? (
        <div className="rounded-card border border-border-subtle bg-surface-card overflow-hidden">
          {/* Print-only document header */}
          <div data-print-only className="hidden mb-4">
            <p className="text-base font-bold text-ink-primary">{(company as any)?.name ?? ''}</p>
            <p className="text-sm text-ink-secondary">
              {t('accounting.yec_title')} — {t('accounting.yec_print_preview_tag')}
            </p>
            <p className="text-xs text-ink-tertiary">
              {t('accounting.yec_fiscal_year')} {preview.fiscal_year} · {fmtDate(preview.fiscal_year_start)} – {fmtDate(preview.fiscal_year_end)}
            </p>
          </div>

          {/* Preview / Not-Posted banner (screen + print) */}
          <div className="border-b border-amber-300 bg-amber-50 px-5 py-3">
            <p className="text-sm font-bold uppercase tracking-wide text-amber-800">
              {t('accounting.yec_preview_banner_title')}
            </p>
            <p className="text-xs text-amber-700">{t('accounting.yec_preview_banner_sub')}</p>
          </div>

          {/* Header row: year + actions */}
          <div className="flex flex-wrap items-start justify-between gap-3 px-5 pt-4">
            <div>
              <p className="text-sm font-semibold text-ink-primary">
                {t('accounting.yec_fiscal_year')} {preview.fiscal_year}
              </p>
              <p className="text-xs text-ink-tertiary">
                {fmtDate(preview.fiscal_year_start)} – {fmtDate(preview.fiscal_year_end)} · {t('accounting.yec_ready_to_close')}
              </p>
            </div>
            <div data-print-hide className="flex items-center gap-2">
              <Button variant="secondary" size="sm" onClick={() => window.print()} title={t('accounting.yec_print_hint')}>
                <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M6 9V2h12v7M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2" />
                  <rect x="6" y="14" width="12" height="8" rx="1" />
                </svg>
                {t('accounting.yec_print_preview')}
              </Button>
              {canWrite && (
                <Button
                  size="sm"
                  onClick={() => { setCloseResult(null); closeMutation.reset(); setShowClose(true); }}
                  disabled={!preview.retained_earnings_name}
                >
                  {t('accounting.yec_close_year')}
                </Button>
              )}
            </div>
          </div>

          {/* Net income tiles */}
          <div className="grid grid-cols-1 gap-3 px-5 py-4 sm:grid-cols-3">
            <Tile label={t('accounting.yec_total_income')} value={money(preview.total_income)} />
            <Tile label={t('accounting.yec_total_expenses')} value={money(preview.total_expenses)} />
            <Tile
              label={t('accounting.yec_net_result')}
              value={signedMoney(preview.net_income)}
              accent={preview.net_income < 0 ? 'red' : 'green'}
              emphasis
            />
          </div>

          {/* Closing Impact Summary */}
          <div className="border-t border-border-subtle px-5 py-4">
            <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-ink-tertiary">
              {t('accounting.yec_impact_summary')}
            </p>
            <dl className="grid grid-cols-1 gap-x-8 gap-y-2 sm:grid-cols-2">
              <Field label={t('accounting.yec_fiscal_year')} value={`${preview.fiscal_year} (${fmtDate(preview.fiscal_year_start)} – ${fmtDate(preview.fiscal_year_end)})`} />
              <Field label={t('accounting.yec_income_accounts')} value={String(preview.income_account_count)} />
              <Field label={t('accounting.yec_expense_accounts')} value={String(preview.expense_account_count)} />
              <Field label={t('accounting.yec_journal_lines')} value={String(preview.journal_line_count)} />
              <Field
                label={t('accounting.yec_net_result')}
                value={signedMoney(preview.net_income)}
                valueClass={preview.net_income < 0 ? 'text-danger-600' : 'text-emerald-700'}
              />
              <Field
                label={t('accounting.yec_retained_earnings')}
                value={preview.retained_earnings_name ? `${preview.retained_earnings_code} — ${preview.retained_earnings_name}` : t('accounting.yec_re_missing_short')}
                valueClass={preview.retained_earnings_name ? undefined : 'text-danger-600'}
              />
              <Field label={t('accounting.yec_lock_after')} value={fmtDate(preview.period_lock_after)} />
              <Field label={t('accounting.yec_current_lock')} value={preview.current_lock_date ? fmtDate(preview.current_lock_date) : t('accounting.yec_no_lock')} />
            </dl>

            {/* Plain-language explanation */}
            <div className="mt-4 rounded-lg bg-surface-subtle px-4 py-3">
              <p className="text-sm text-ink-secondary">{explain(preview, { money, fmtDate, t })}</p>
            </div>

            {/* Validation notices */}
            {!preview.retained_earnings_name && (
              <p className="mt-3 rounded-lg border border-danger-500 bg-danger-50 px-3 py-2 text-xs text-danger-600">
                {t('accounting.yec_re_missing')}
              </p>
            )}
            {!preview.has_activity && (
              <p className="mt-3 rounded-lg border border-border-subtle bg-surface-subtle px-3 py-2 text-xs text-ink-secondary">
                {t('accounting.yec_no_activity')}
              </p>
            )}
          </div>

          {/* Closing journal preview */}
          {preview.has_activity && (
            <div className="border-t border-border-subtle px-5 py-4">
              <div className="mb-2 flex items-center justify-between">
                <p className="text-xs font-semibold uppercase tracking-wide text-ink-tertiary">
                  {t('accounting.yec_closing_journal')}
                </p>
                <BalancedBadge lines={preview.lines} t={t} />
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border-subtle text-xs text-ink-tertiary">
                      <th className="px-2 py-2 text-start font-medium">{t('accounting.yec_account')}</th>
                      <th className="px-2 py-2 text-end font-medium">{t('accounting.yec_debit')}</th>
                      <th className="px-2 py-2 text-end font-medium">{t('accounting.yec_credit')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {preview.lines.map((l, i) => {
                      const isRE = l.account_type === 'equity';
                      return (
                        <tr key={`${l.account_code}-${i}`} className={`border-b border-border-subtle/60 ${isRE ? 'bg-brand-50 font-semibold' : ''}`}>
                          <td className="px-2 py-1.5 text-ink-primary">
                            <span className="me-2 font-medium text-brand-600">{l.account_code}</span>
                            {l.account_name}
                          </td>
                          <td className="px-2 py-1.5 text-end font-mono text-ink-primary">{l.debit ? fmt(l.debit) : ''}</td>
                          <td className="px-2 py-1.5 text-end font-mono text-ink-primary">{l.credit ? fmt(l.credit) : ''}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                  <tfoot>
                    <tr className="border-t-2 border-border-strong font-semibold">
                      <td className="px-2 py-2 text-ink-primary">{t('accounting.yec_totals')}</td>
                      <td className="px-2 py-2 text-end font-mono text-ink-primary">{fmt(sum(preview.lines, 'debit'))}</td>
                      <td className="px-2 py-2 text-end font-mono text-ink-primary">{fmt(sum(preview.lines, 'credit'))}</td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            </div>
          )}
        </div>
      ) : null}

      {/* ── Region B — closed fiscal years ───────────────────────────────── */}
      <div data-print-hide className="rounded-card border border-border-subtle bg-surface-card overflow-hidden">
        <div className="border-b border-border-subtle px-5 py-3">
          <p className="text-sm font-semibold text-ink-primary">{t('accounting.yec_closed_years')}</p>
        </div>
        {loadingCloses ? (
          <div className="px-5 py-6 text-center text-sm text-ink-tertiary">{t('common.loading')}</div>
        ) : (closes ?? []).length === 0 ? (
          <div className="px-5 py-8 text-center">
            <p className="text-sm text-ink-secondary">{t('accounting.yec_no_closed_years')}</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border-subtle text-xs text-ink-tertiary">
                  <th className="px-4 py-2 text-start font-medium">{t('accounting.yec_fiscal_year')}</th>
                  <th className="px-4 py-2 text-start font-medium">{t('accounting.yec_period')}</th>
                  <th className="px-4 py-2 text-end font-medium">{t('accounting.yec_net_result')}</th>
                  <th className="px-4 py-2 text-start font-medium">{t('accounting.yec_status')}</th>
                  <th className="px-4 py-2 text-start font-medium">{t('accounting.yec_closed_on')}</th>
                  <th className="px-4 py-2 text-start font-medium">{t('accounting.yec_entry')}</th>
                  <th className="px-4 py-2 text-end font-medium"></th>
                </tr>
              </thead>
              <tbody>
                {(closes ?? []).map((c) => (
                  <tr key={c.id} className="border-b border-border-subtle/60">
                    <td className="px-4 py-2 font-medium text-ink-primary">{c.fiscal_year}</td>
                    <td className="px-4 py-2 text-ink-secondary">{fmtDate(c.fiscal_year_start)} – {fmtDate(c.fiscal_year_end)}</td>
                    <td className="px-4 py-2 text-end font-mono text-ink-primary">{signedMoney(Number(c.net_income))}</td>
                    <td className="px-4 py-2"><StatusBadge status={c.status} t={t} /></td>
                    <td className="px-4 py-2 text-ink-secondary">{fmtDate(c.closed_at)}</td>
                    <td className="px-4 py-2">
                      {c.je_id
                        ? <DocLink type="journal_entry" id={c.je_id} status={c.status === 'reopened' ? 'reversed' : 'active'} />
                        : <span className="text-ink-tertiary">—</span>}
                    </td>
                    <td className="px-4 py-2 text-end">
                      {canWrite && c.status === 'closed' && c.fiscal_year === latestClosedYear && (
                        <Button
                          variant="secondary"
                          size="sm"
                          onClick={() => { setReopenResult(null); reopenMutation.reset(); setReopenYear(c.fiscal_year); }}
                        >
                          {t('accounting.yec_reopen')}
                        </Button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* ── Close confirmation / success modal ───────────────────────────── */}
      <Modal
        open={showClose}
        onClose={() => { if (!closeMutation.isPending) { setShowClose(false); setCloseResult(null); closeMutation.reset(); } }}
        title={closeResult ? t('accounting.yec_close_success_title') : t('accounting.yec_close_confirm_title', { year: nextYear ?? '' })}
      >
        {closeResult ? (
          <div className="space-y-4">
            <div className="flex items-center gap-3">
              <span className="flex h-9 w-9 items-center justify-center rounded-full bg-emerald-100 text-emerald-700">
                <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M20 6 9 17l-5-5" /></svg>
              </span>
              <p className="text-sm text-ink-secondary">
                {t('accounting.yec_close_success_body', { year: closeResult.fiscal_year })}
              </p>
            </div>
            {closeResult.journal_entry_id && (
              <p className="text-sm text-ink-secondary">
                {t('accounting.yec_entry')}:{' '}
                <DocLink type="journal_entry" id={closeResult.journal_entry_id} label={closeResult.entry_number} />
              </p>
            )}
            <div className="flex justify-end">
              <Button size="sm" onClick={() => { setShowClose(false); setCloseResult(null); closeMutation.reset(); }}>
                {t('common.done')}
              </Button>
            </div>
          </div>
        ) : (
          <div className="space-y-4">
            <p className="text-sm text-ink-secondary">
              {t('accounting.yec_close_confirm_body', {
                income: preview ? signedMoney(preview.net_income) : '',
                re: preview?.retained_earnings_code ?? '3100',
                lock: preview ? fmtDate(preview.period_lock_after) : '',
              })}
            </p>
            <p className="text-xs text-ink-tertiary">{t('accounting.yec_close_confirm_note')}</p>
            {closeMutation.isError && (
              <p className="rounded-lg border border-danger-500 bg-danger-50 px-3 py-2 text-xs text-danger-600">
                {friendlyError(closeMutation.error)}
              </p>
            )}
            <div className="flex justify-end gap-2">
              <Button variant="secondary" size="sm" onClick={() => setShowClose(false)} disabled={closeMutation.isPending}>
                {t('common.cancel')}
              </Button>
              <Button size="sm" loading={closeMutation.isPending} onClick={() => closeMutation.mutate()}>
                {t('accounting.yec_close_year')}
              </Button>
            </div>
          </div>
        )}
      </Modal>

      {/* ── Reopen confirmation / success modal ──────────────────────────── */}
      <Modal
        open={reopenYear != null}
        onClose={() => { if (!reopenMutation.isPending) { setReopenYear(null); setReopenResult(null); reopenMutation.reset(); } }}
        title={reopenResult ? t('accounting.yec_reopen_success_title') : t('accounting.yec_reopen_confirm_title', { year: reopenYear ?? '' })}
      >
        {reopenResult ? (
          <div className="space-y-4">
            <p className="text-sm text-ink-secondary">{t('accounting.yec_reopen_success_body', { year: reopenResult.fiscal_year })}</p>
            <div className="flex justify-end">
              <Button size="sm" onClick={() => { setReopenYear(null); setReopenResult(null); reopenMutation.reset(); }}>
                {t('common.done')}
              </Button>
            </div>
          </div>
        ) : (
          <div className="space-y-4">
            <p className="text-sm text-ink-secondary">{t('accounting.yec_reopen_confirm_body', { year: reopenYear ?? '' })}</p>
            {reopenMutation.isError && (
              <p className="rounded-lg border border-danger-500 bg-danger-50 px-3 py-2 text-xs text-danger-600">
                {friendlyError(reopenMutation.error)}
              </p>
            )}
            <div className="flex justify-end gap-2">
              <Button variant="secondary" size="sm" onClick={() => setReopenYear(null)} disabled={reopenMutation.isPending}>
                {t('common.cancel')}
              </Button>
              <Button variant="danger" size="sm" loading={reopenMutation.isPending} onClick={() => reopenMutation.mutate(reopenYear!)}>
                {t('accounting.yec_reopen')}
              </Button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}

// ── small presentational helpers ─────────────────────────────────────────────
function Tile({ label, value, accent, emphasis }: { label: string; value: string; accent?: 'red' | 'green'; emphasis?: boolean }) {
  const color = accent === 'red' ? 'text-danger-600' : accent === 'green' ? 'text-emerald-700' : 'text-ink-primary';
  return (
    <div className="rounded-lg border border-border-subtle bg-surface-subtle px-4 py-3">
      <p className="text-xs font-medium text-ink-tertiary">{label}</p>
      <p className={`mt-1 font-mono font-semibold ${emphasis ? 'text-xl' : 'text-base'} ${color}`}>{value}</p>
    </div>
  );
}

function Field({ label, value, valueClass }: { label: string; value: string; valueClass?: string }) {
  return (
    <div className="flex items-baseline justify-between gap-4 border-b border-border-subtle/40 py-1">
      <dt className="text-xs text-ink-tertiary">{label}</dt>
      <dd className={`text-sm font-medium text-end ${valueClass ?? 'text-ink-primary'}`}>{value}</dd>
    </div>
  );
}

function StatusBadge({ status, t }: { status: string; t: (k: string) => string }) {
  const map: Record<string, string> = {
    closed: 'bg-emerald-100 text-emerald-700',
    reopened: 'bg-amber-100 text-amber-700',
    draft: 'bg-surface-muted text-ink-tertiary',
  };
  const label: Record<string, string> = {
    closed: t('accounting.yec_status_closed'),
    reopened: t('accounting.yec_status_reopened'),
    draft: t('accounting.yec_status_draft'),
  };
  return <span className={`rounded px-2 py-0.5 text-xs font-semibold ${map[status] ?? map.draft}`}>{label[status] ?? status}</span>;
}

function BalancedBadge({ lines, t }: { lines: { debit: number; credit: number }[]; t: (k: string) => string }) {
  const bal = Math.abs(sum(lines, 'debit') - sum(lines, 'credit')) < 0.005;
  return (
    <span className={`inline-flex items-center gap-1 rounded px-2 py-0.5 text-xs font-semibold ${bal ? 'bg-emerald-100 text-emerald-700' : 'bg-danger-50 text-danger-600'}`}>
      {bal && (
        <svg viewBox="0 0 24 24" className="h-3 w-3" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><path d="M20 6 9 17l-5-5" /></svg>
      )}
      {bal ? t('accounting.yec_balanced') : t('accounting.yec_unbalanced')}
    </span>
  );
}

function PreviewSkeleton() {
  return (
    <div data-print-hide className="rounded-card border border-border-subtle bg-surface-card p-5">
      <div className="h-4 w-40 animate-pulse rounded bg-surface-muted" />
      <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-3">
        {[0, 1, 2].map((i) => <div key={i} className="h-16 animate-pulse rounded-lg bg-surface-muted" />)}
      </div>
      <div className="mt-4 h-24 animate-pulse rounded-lg bg-surface-muted" />
    </div>
  );
}

function sum(lines: { debit: number; credit: number }[], key: 'debit' | 'credit') {
  return lines.reduce((s, l) => s + (key === 'debit' ? l.debit : l.credit), 0);
}

function explain(
  p: YearEndClosePreview,
  h: { money: (n: number) => string; fmtDate: (s: string | null | undefined) => string; t: (k: string, o?: Record<string, unknown>) => string },
): string {
  const lock = h.fmtDate(p.fiscal_year_end);
  if (!p.has_activity) return h.t('accounting.yec_explain_none', { year: p.fiscal_year, lock });
  if (p.net_income === 0) return h.t('accounting.yec_explain_zero', { year: p.fiscal_year, lock });
  const key = p.net_income < 0 ? 'accounting.yec_explain_loss' : 'accounting.yec_explain_profit';
  return h.t(key, { year: p.fiscal_year, amount: h.money(Math.abs(p.net_income)), re: p.retained_earnings_code, lock });
}

function friendlyError(err: unknown): string {
  const msg = err instanceof Error ? err.message : String(err);
  if (/permission|not authorized|insufficient|42501/i.test(msg)) return 'You don’t have permission to close or reopen fiscal years.';
  if (/does not exist|schema cache|PGRST202|could not find/i.test(msg)) return 'The year-end close engine isn’t installed yet. Apply the pending database migration, then try again.';
  return msg.replace(/^accounting\.\w+:\s*/, '');
}
