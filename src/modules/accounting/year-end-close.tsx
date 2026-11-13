import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { getAdapter } from '@/data/index';
import { useAuthStore } from '@/store/auth';
import { hasPerm } from '@/lib/permissions';
import { Button } from '@/ui/button';
import { Modal } from '@/ui/modal';
import { DocLink } from '@/ui/doc-link';
import { OceanPage } from '@/components/ocean-list';
import { CalendarCheck2, Check, CheckCircle2, Eye, History, Lock, Printer } from 'lucide-react';
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
 * Ocean Teal layout (2026-11): look only, same data and actions.
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
    <OceanPage
      testid="year-end-close-ocean"
      title={t('accounting.yec_title')}
      subtitle={t('accounting.yec_hint')}
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        {/* ── Region A — next closeable year ───────────────────────────────── */}
        {loadingNext || (nextYear != null && loadingPreview) ? (
          <div className="sb-card sb-doc-card" data-print-hide><p className="sb-empty" style={{ margin: 0 }}>{t('common.loading')}</p></div>
        ) : nextYear == null ? (
          <div data-print-hide className="sb-card sb-doc-card sb-acct-empty">
            <span className="sb-side-ico" style={{ background: 'var(--sb-primary-light)', color: 'var(--sb-primary-dark)' }} aria-hidden="true"><CalendarCheck2 size={18} /></span>
            <p className="sb-doc-card-title" style={{ margin: 0 }}>
              {(closes ?? []).some((c) => c.status === 'closed')
                ? t('accounting.yec_all_caught_up')
                : t('accounting.yec_nothing_to_close')}
            </p>
            <p className="sb-fx-name" style={{ margin: 0 }}>
              {(closes ?? []).some((c) => c.status === 'closed')
                ? t('accounting.yec_all_caught_up_sub')
                : t('accounting.yec_nothing_to_close_sub')}
            </p>
          </div>
        ) : preview ? (
          <div className="sb-card sb-doc-card sb-doc-lines">
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
            <div className="sb-acct-banner">
              <Eye size={17} aria-hidden="true" style={{ flexShrink: 0 }} />
              <div>
                <p className="sb-acct-banner-title">{t('accounting.yec_preview_banner_title')}</p>
                <p style={{ margin: 0 }}>{t('accounting.yec_preview_banner_sub')}</p>
              </div>
            </div>

            {/* Header row: year + actions */}
            <div className="sb-doc-lines-head sb-acct-head">
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
                <span className="sb-side-ico" style={{ background: 'var(--sb-primary-light)', color: 'var(--sb-primary-dark)' }} aria-hidden="true"><CalendarCheck2 size={17} /></span>
                <div style={{ minWidth: 0 }}>
                  <p className="sb-doc-card-title" style={{ margin: 0 }}>{t('accounting.yec_fiscal_year')} <bdi dir="ltr">{preview.fiscal_year}</bdi></p>
                  <p className="sb-fx-name" style={{ margin: 0, fontSize: 12 }}>
                    <bdi dir="ltr">{fmtDate(preview.fiscal_year_start)} – {fmtDate(preview.fiscal_year_end)}</bdi> · {t('accounting.yec_ready_to_close')}
                  </p>
                </div>
              </div>
              <div data-print-hide className="sb-acct-actions">
                <Button variant="secondary" size="sm" onClick={() => window.print()} title={t('accounting.yec_print_hint')}>
                  <Printer size={15} aria-hidden="true" /> {t('accounting.yec_print_preview')}
                </Button>
                {canWrite && (
                  <Button
                    size="sm"
                    onClick={() => { setCloseResult(null); closeMutation.reset(); setShowClose(true); }}
                    disabled={!preview.retained_earnings_name}
                  >
                    <Lock size={15} aria-hidden="true" /> {t('accounting.yec_close_year')}
                  </Button>
                )}
              </div>
            </div>

            {/* Net income strip */}
            <div className="sb-gl-summary sb-acct-sum">
              <div><span className="sb-info-label">{t('accounting.yec_total_income')}</span><bdi dir="ltr" className="sb-dash-num">{money(preview.total_income)}</bdi></div>
              <div><span className="sb-info-label">{t('accounting.yec_total_expenses')}</span><bdi dir="ltr" className="sb-dash-num">{money(preview.total_expenses)}</bdi></div>
              <div>
                <span className="sb-info-label">{t('accounting.yec_net_result')}</span>
                <bdi dir="ltr" className="sb-dash-num" style={{ color: preview.net_income < 0 ? 'var(--sb-danger)' : 'var(--sb-success)' }}>{signedMoney(preview.net_income)}</bdi>
              </div>
            </div>

            {/* Closing Impact Summary */}
            <div className="sb-acct-section">
              <p className="sb-acct-label">{t('accounting.yec_impact_summary')}</p>
              <dl className="sb-acct-fields">
                <Field label={t('accounting.yec_fiscal_year')} value={`${preview.fiscal_year} (${fmtDate(preview.fiscal_year_start)} – ${fmtDate(preview.fiscal_year_end)})`} />
                <Field label={t('accounting.yec_income_accounts')} value={String(preview.income_account_count)} />
                <Field label={t('accounting.yec_expense_accounts')} value={String(preview.expense_account_count)} />
                <Field label={t('accounting.yec_journal_lines')} value={String(preview.journal_line_count)} />
                <Field
                  label={t('accounting.yec_net_result')}
                  value={signedMoney(preview.net_income)}
                  color={preview.net_income < 0 ? 'var(--sb-danger)' : 'var(--sb-success)'}
                />
                <Field
                  label={t('accounting.yec_retained_earnings')}
                  value={preview.retained_earnings_name ? `${preview.retained_earnings_code} — ${preview.retained_earnings_name}` : t('accounting.yec_re_missing_short')}
                  color={preview.retained_earnings_name ? undefined : 'var(--sb-danger)'}
                  ltr={!!preview.retained_earnings_name}
                />
                <Field label={t('accounting.yec_lock_after')} value={fmtDate(preview.period_lock_after)} />
                <Field label={t('accounting.yec_current_lock')} value={preview.current_lock_date ? fmtDate(preview.current_lock_date) : t('accounting.yec_no_lock')} ltr={!!preview.current_lock_date} />
              </dl>

              {/* Plain-language explanation */}
              <p className="sb-info-note">{explain(preview, { money, fmtDate, t })}</p>

              {/* Validation notices */}
              {!preview.retained_earnings_name && <p className="sb-alert sb-alert-danger">{t('accounting.yec_re_missing')}</p>}
              {!preview.has_activity && <p className="sb-alert sb-alert-warn">{t('accounting.yec_no_activity')}</p>}
            </div>

            {/* Closing journal preview */}
            {preview.has_activity && (
              <div className="sb-acct-section">
                <div className="sb-acct-section-head">
                  <p className="sb-acct-label">{t('accounting.yec_closing_journal')}</p>
                  <BalancedPill lines={preview.lines} t={t} />
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr>
                        <th className="px-3 py-2 text-start font-medium">{t('accounting.yec_account')}</th>
                        <th className="px-3 py-2 text-end font-medium">{t('accounting.yec_debit')}</th>
                        <th className="px-3 py-2 text-end font-medium">{t('accounting.yec_credit')}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {preview.lines.map((l, i) => {
                        const isRE = l.account_type === 'equity';
                        return (
                          <tr key={`${l.account_code}-${i}`} className={isRE ? 'sb-acct-re-row' : undefined}>
                            <td className="px-3 py-2">
                              <bdi dir="ltr" className="sb-acct-code">{l.account_code}</bdi>{' '}
                              {l.account_name}
                            </td>
                            <td className="px-3 py-2 text-end"><bdi dir="ltr" className="sb-dash-num">{l.debit ? fmt(l.debit) : ''}</bdi></td>
                            <td className="px-3 py-2 text-end"><bdi dir="ltr" className="sb-dash-num">{l.credit ? fmt(l.credit) : ''}</bdi></td>
                          </tr>
                        );
                      })}
                    </tbody>
                    <tfoot>
                      <tr className="sb-acct-total-row">
                        <td className="px-3 py-2">{t('accounting.yec_totals')}</td>
                        <td className="px-3 py-2 text-end"><bdi dir="ltr" className="sb-dash-num">{fmt(sum(preview.lines, 'debit'))}</bdi></td>
                        <td className="px-3 py-2 text-end"><bdi dir="ltr" className="sb-dash-num">{fmt(sum(preview.lines, 'credit'))}</bdi></td>
                      </tr>
                    </tfoot>
                  </table>
                </div>
              </div>
            )}
          </div>
        ) : null}

        {/* ── Region B — closed fiscal years ───────────────────────────────── */}
        <div data-print-hide className="sb-card sb-doc-card sb-doc-lines">
          <div className="sb-doc-lines-head">
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
              <span className="sb-side-ico" style={{ background: 'var(--sb-primary-light)', color: 'var(--sb-primary-dark)' }} aria-hidden="true"><History size={17} /></span>
              <p className="sb-doc-card-title" style={{ margin: 0 }}>{t('accounting.yec_closed_years')}</p>
            </div>
          </div>
          {loadingCloses ? (
            <p className="sb-empty" style={{ margin: 0 }}>{t('common.loading')}</p>
          ) : (closes ?? []).length === 0 ? (
            <p className="sb-empty" style={{ margin: 0 }}>{t('accounting.yec_no_closed_years')}</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm" style={{ minWidth: 760 }}>
                <thead>
                  <tr>
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
                    <tr key={c.id}>
                      <td className="px-4 py-2 font-medium"><bdi dir="ltr">{c.fiscal_year}</bdi></td>
                      <td className="px-4 py-2 text-ink-secondary"><bdi dir="ltr">{fmtDate(c.fiscal_year_start)} – {fmtDate(c.fiscal_year_end)}</bdi></td>
                      <td className="px-4 py-2 text-end"><bdi dir="ltr" className="sb-dash-num">{signedMoney(Number(c.net_income))}</bdi></td>
                      <td className="px-4 py-2"><StatusPill status={c.status} t={t} /></td>
                      <td className="px-4 py-2 text-ink-secondary"><bdi dir="ltr">{fmtDate(c.closed_at)}</bdi></td>
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
      </div>

      {/* ── Close confirmation / success modal ───────────────────────────── */}
      <Modal
        open={showClose}
        onClose={() => { if (!closeMutation.isPending) { setShowClose(false); setCloseResult(null); closeMutation.reset(); } }}
        title={closeResult ? t('accounting.yec_close_success_title') : t('accounting.yec_close_confirm_title', { year: nextYear ?? '' })}
      >
        {closeResult ? (
          <div className="sb-ocean sb-modal-form" style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            <p className="sb-alert sb-alert-good" style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <CheckCircle2 size={18} aria-hidden="true" style={{ flexShrink: 0 }} />
              {t('accounting.yec_close_success_body', { year: closeResult.fiscal_year })}
            </p>
            {closeResult.journal_entry_id && (
              <p className="text-sm text-ink-secondary" style={{ margin: 0 }}>
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
          <div className="sb-ocean sb-modal-form" style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            <p className="text-sm text-ink-secondary" style={{ margin: 0 }}>
              {t('accounting.yec_close_confirm_body', {
                income: preview ? signedMoney(preview.net_income) : '',
                re: preview?.retained_earnings_code ?? '3100',
                lock: preview ? fmtDate(preview.period_lock_after) : '',
              })}
            </p>
            <p className="sb-form-hint" style={{ margin: 0 }}>{t('accounting.yec_close_confirm_note')}</p>
            {closeMutation.isError && (
              <p className="sb-alert sb-alert-danger">{friendlyError(closeMutation.error, t)}</p>
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
          <div className="sb-ocean sb-modal-form" style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            <p className="sb-alert sb-alert-good">{t('accounting.yec_reopen_success_body', { year: reopenResult.fiscal_year })}</p>
            <div className="flex justify-end">
              <Button size="sm" onClick={() => { setReopenYear(null); setReopenResult(null); reopenMutation.reset(); }}>
                {t('common.done')}
              </Button>
            </div>
          </div>
        ) : (
          <div className="sb-ocean sb-modal-form" style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            <p className="text-sm text-ink-secondary" style={{ margin: 0 }}>{t('accounting.yec_reopen_confirm_body', { year: reopenYear ?? '' })}</p>
            {reopenMutation.isError && (
              <p className="sb-alert sb-alert-danger">{friendlyError(reopenMutation.error, t)}</p>
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
    </OceanPage>
  );
}

// ── small presentational helpers ─────────────────────────────────────────────
function Field({ label, value, color, ltr = true }: { label: string; value: string; color?: string; ltr?: boolean }) {
  return (
    <div className="sb-acct-field">
      <dt className="sb-info-label">{label}</dt>
      <dd className="sb-info-value" style={color ? { color } : undefined}>{ltr ? <bdi dir="ltr">{value}</bdi> : value}</dd>
    </div>
  );
}

function StatusPill({ status, t }: { status: string; t: (k: string) => string }) {
  const tone: Record<string, string> = { closed: 'sb-pill-good', reopened: 'sb-pill-warn', draft: 'sb-pill-muted' };
  const label: Record<string, string> = {
    closed: t('accounting.yec_status_closed'),
    reopened: t('accounting.yec_status_reopened'),
    draft: t('accounting.yec_status_draft'),
  };
  return <span className={`sb-pill ${tone[status] ?? tone.draft}`}>{label[status] ?? status}</span>;
}

function BalancedPill({ lines, t }: { lines: { debit: number; credit: number }[]; t: (k: string) => string }) {
  const bal = Math.abs(sum(lines, 'debit') - sum(lines, 'credit')) < 0.005;
  return (
    <span className={`sb-pill ${bal ? 'sb-pill-good' : 'sb-pill-bad'}`} style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
      {bal && <Check size={13} aria-hidden="true" />}
      {bal ? t('accounting.yec_balanced') : t('accounting.yec_unbalanced')}
    </span>
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

function friendlyError(err: unknown, t: (k: string) => string): string {
  const msg = err instanceof Error ? err.message : String(err);
  if (/permission|not authorized|insufficient|42501/i.test(msg)) return t('acctOcean.yec_err_permission');
  if (/does not exist|schema cache|PGRST202|could not find/i.test(msg)) return t('acctOcean.yec_err_missing');
  return msg.replace(/^accounting\.\w+:\s*/, '');
}
