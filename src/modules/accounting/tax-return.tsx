import { useMemo, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { getAdapter } from '@/data/index';
import { useAuthStore } from '@/store/auth';
import { hasPerm } from '@/lib/permissions';
import { Button } from '@/ui/button';
import { Modal } from '@/ui/modal';
import { Input } from '@/ui/input';
import { ReportActions } from '@/ui/report-actions';
import { downloadCSV } from '@/lib/io-export';
import {
  jurisdictionForCountry, jurisdictionLabel, resolveFilingPeriod,
  type FilingFrequency, type TaxReturn, type TaxFiling, type TaxFileResult,
} from '@/lib/tax-return';
import type { Company } from '@/data/adapter';

/**
 * AC-3B — VAT/GST Tax Return page (Accounting → Tax Return).
 *
 * Prepares a jurisdiction-aware return for a filing period (UAE VAT / India
 * GST), previews it with a GL-vs-documents reconciliation, and drives the
 * filing lifecycle (file → lock → reopen) via the AC-3A adapter methods. All
 * figures come straight from getTaxReturn — the UI recomputes NOTHING.
 */
export default function TaxReturnPage() {
  const { t } = useTranslation();
  const { company_id, role, permissions } = useAuthStore();
  const qc = useQueryClient();
  const canWrite = hasPerm(role, permissions, 'accounting.write');

  const [offset, setOffset] = useState(-1); // 0 = current period, -1 = previous (default: most recent complete)
  const [showFile, setShowFile] = useState(false);
  const [reference, setReference] = useState('');
  const [fileResult, setFileResult] = useState<TaxFileResult | null>(null);
  const [reopenRow, setReopenRow] = useState<TaxFiling | null>(null);
  const [reopenDone, setReopenDone] = useState(false);

  const { data: company } = useQuery<Company | null>({
    queryKey: ['company', company_id],
    queryFn: () => getAdapter().companies.getById(company_id!),
    enabled: !!company_id,
  });
  const currency = (company as any)?.currency ?? '';
  const frequency = (((company as any)?.tax_filing_frequency as FilingFrequency) ?? 'quarterly');
  const jurisdiction = jurisdictionForCountry((company as any)?.country_code);

  // Resolve the selected filing period from the frequency + navigation offset.
  const period = useMemo(() => stepPeriod(frequency, offset), [frequency, offset]);
  const todayISO = isoOf(new Date());
  const periodEnded = period.period_end <= todayISO;

  const { data: ret, isLoading: loadingReturn } = useQuery<TaxReturn>({
    queryKey: ['tax_return', company_id, period.period_start, period.period_end],
    queryFn: () => getAdapter().reports.getTaxReturn(company_id!, period.period_start, period.period_end),
    enabled: !!company_id,
  });

  const { data: filings, isLoading: loadingFilings } = useQuery<TaxFiling[]>({
    queryKey: ['tax_filings', company_id],
    queryFn: () => getAdapter().accounting.listTaxFilings(company_id!),
    enabled: !!company_id,
  });

  // Is the selected period already filed?
  const existing = (filings ?? []).find(
    (f) => f.jurisdiction === jurisdiction && f.period_start === period.period_start && f.period_end === period.period_end,
  );
  const alreadyFiled = existing?.status === 'filed';

  const latestFiledEnd = (filings ?? [])
    .filter((f) => f.status === 'filed')
    .reduce<string | null>((max, f) => (max == null || f.period_end > max ? f.period_end : max), null);

  function invalidateAll() {
    qc.invalidateQueries({ queryKey: ['tax_return', company_id] });
    qc.invalidateQueries({ queryKey: ['tax_filings', company_id] });
    qc.invalidateQueries({ queryKey: ['company', company_id] }); // lock changed
  }

  const fileMutation = useMutation({
    mutationFn: () => getAdapter().accounting.fileTaxReturn({
      jurisdiction,
      period_type: frequency,
      period_start: period.period_start,
      period_end: period.period_end,
      output_tax: ret!.output_tax,
      input_tax: ret!.input_tax,
      net_payable: ret!.net_payable,
      boxes: { output: ret!.output_boxes, input: ret!.input_boxes },
      reconciliation: ret!.reconciliation,
      reference: reference.trim() || null,
    }),
    onSuccess: (res) => { setFileResult(res); invalidateAll(); },
  });

  const reopenMutation = useMutation({
    mutationFn: (id: string) => getAdapter().accounting.reopenTaxReturn(id),
    onSuccess: () => { setReopenDone(true); invalidateAll(); },
  });

  // ── formatters ─────────────────────────────────────────────────────────────
  const fmt = (n: number) => Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const money = (n: number) => (currency ? `${currency} ${fmt(n)}` : fmt(n));
  const fmtDate = (iso: string | null | undefined) =>
    iso ? new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : '—';
  const netLabel = (n: number) => (n >= 0 ? t('accounting.tr_payable') : t('accounting.tr_refundable'));

  // ── export rows (summary + boxes) ──────────────────────────────────────────
  const exportRows: Record<string, unknown>[] = [];
  if (ret) {
    for (const b of ret.output_boxes) exportRows.push({ Section: 'Output', Item: b.label, Taxable: b.taxable_amount.toFixed(2), Tax: b.tax_amount.toFixed(2) });
    for (const b of ret.input_boxes) exportRows.push({ Section: 'Input', Item: b.label, Taxable: b.taxable_amount.toFixed(2), Tax: b.tax_amount.toFixed(2) });
    exportRows.push({ Section: 'Summary', Item: 'Net Payable/(Refundable)', Taxable: '', Tax: ret.net_payable.toFixed(2) });
  }
  const exportHeaders = ['Section', 'Item', 'Taxable', 'Tax'];
  const exportName = `tax-return-${jurisdiction}-${period.period_start}_${period.period_end}`;

  const periodLabel = `${fmtDate(period.period_start)} – ${fmtDate(period.period_end)}`;

  return (
    <div className="space-y-6">
      <div data-print-hide>
        <h1 className="text-xl font-semibold text-ink-primary">{t('accounting.tr_title')}</h1>
        <p className="mt-1 text-sm text-ink-secondary">{t('accounting.tr_hint')}</p>
      </div>

      {/* ── Region A — prepare & file ────────────────────────────────────── */}
      {loadingReturn && !ret ? (
        <ReturnSkeleton />
      ) : ret ? (
        <div className="rounded-card border border-border-subtle bg-surface-card overflow-hidden">
          {/* Print-only header */}
          <div data-print-only className="hidden mb-4">
            <p className="text-base font-bold text-ink-primary">{(company as any)?.name ?? ''}</p>
            <p className="text-sm text-ink-secondary">{jurisdictionLabel(jurisdiction)} — {t('accounting.tr_title')}</p>
            <p className="text-xs text-ink-tertiary">{periodLabel}</p>
          </div>

          {/* Header: period navigator + actions */}
          <div className="flex flex-wrap items-start justify-between gap-3 border-b border-border-subtle px-5 py-4">
            <div className="flex items-center gap-2">
              <button
                data-print-hide type="button" onClick={() => setOffset((o) => o - 1)}
                className="flex h-8 w-8 items-center justify-center rounded-lg border border-border-subtle text-ink-secondary hover:bg-surface-muted"
                title={t('accounting.tr_prev_period')}
              >‹</button>
              <div>
                <p className="text-sm font-semibold text-ink-primary">{jurisdictionLabel(jurisdiction)} · {periodLabel}</p>
                <p className="text-xs text-ink-tertiary">
                  {t('accounting.tr_frequency')}: {t(`accounting.tr_freq_${frequency}`)}
                  {existing && <> · <StatusBadge status={existing.status} t={t} /></>}
                </p>
              </div>
              <button
                data-print-hide type="button" onClick={() => setOffset((o) => Math.min(0, o + 1))} disabled={offset >= 0}
                className="flex h-8 w-8 items-center justify-center rounded-lg border border-border-subtle text-ink-secondary hover:bg-surface-muted disabled:opacity-40 disabled:pointer-events-none"
                title={t('accounting.tr_next_period')}
              >›</button>
            </div>
            <div data-print-hide className="flex flex-wrap items-center gap-2">
              <ReportActions rows={exportRows} headers={exportHeaders} filename={exportName} disabled={!ret} />
              <button
                type="button" onClick={() => downloadCSV(exportRows, exportHeaders, `${exportName}.csv`)} disabled={!ret}
                className="inline-flex items-center gap-1.5 rounded-lg border border-border-subtle bg-white px-3 py-1.5 text-xs font-semibold text-ink-secondary transition-colors hover:border-border-strong hover:text-ink-primary disabled:pointer-events-none disabled:opacity-50"
                title={t('accounting.tr_export_csv')}
              >CSV</button>
              {canWrite && (
                <Button size="sm" onClick={() => { setFileResult(null); setReference(''); fileMutation.reset(); setShowFile(true); }} disabled={alreadyFiled || !periodEnded}>
                  {t('accounting.tr_file_return')}
                </Button>
              )}
            </div>
          </div>

          {/* Summary tiles */}
          <div className="grid grid-cols-1 gap-3 px-5 py-4 sm:grid-cols-3">
            <Tile label={t('accounting.tr_output_tax')} value={money(ret.output_tax)} />
            <Tile label={t('accounting.tr_input_tax')} value={money(ret.input_tax)} />
            <Tile
              label={t('accounting.tr_net')}
              value={`${money(ret.net_payable)}`}
              sub={netLabel(ret.net_payable)}
              accent={ret.net_payable < 0 ? 'green' : 'amber'}
              emphasis
            />
          </div>

          {/* Reconciliation */}
          <div className="border-t border-border-subtle px-5 py-4">
            <div className="mb-2 flex items-center justify-between">
              <p className="text-xs font-semibold uppercase tracking-wide text-ink-tertiary">{t('accounting.tr_reconciliation')}</p>
              <span className={`inline-flex items-center gap-1 rounded px-2 py-0.5 text-xs font-semibold ${ret.reconciliation.matched ? 'bg-emerald-100 text-emerald-700' : 'bg-warning-50 text-warning-600'}`}>
                {ret.reconciliation.matched ? t('accounting.tr_recon_matched') : t('accounting.tr_recon_mismatch')}
              </span>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border-subtle text-xs text-ink-tertiary">
                    <th className="px-2 py-2 text-start font-medium">{t('accounting.tr_recon_side')}</th>
                    <th className="px-2 py-2 text-end font-medium">{t('accounting.tr_recon_gl')}</th>
                    <th className="px-2 py-2 text-end font-medium">{t('accounting.tr_recon_docs')}</th>
                    <th className="px-2 py-2 text-end font-medium">{t('accounting.tr_recon_diff')}</th>
                  </tr>
                </thead>
                <tbody>
                  <ReconRow label={t('accounting.tr_output_tax')} r={ret.reconciliation.output} fmt={fmt} />
                  <ReconRow label={t('accounting.tr_input_tax')} r={ret.reconciliation.input} fmt={fmt} />
                </tbody>
              </table>
            </div>
            <p className="mt-3 text-xs text-ink-tertiary">{t('accounting.tr_recon_hint')}</p>
          </div>

          {/* Filing preview / plain-language explanation */}
          <div className="border-t border-border-subtle px-5 py-4">
            <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-ink-tertiary">{t('accounting.tr_filing_preview')}</p>
            <dl className="grid grid-cols-1 gap-x-8 gap-y-2 sm:grid-cols-2">
              <Field label={t('accounting.tr_return_period')} value={periodLabel} />
              <Field label={t('accounting.tr_frequency')} value={t(`accounting.tr_freq_${frequency}`)} />
              <Field label={t('accounting.tr_output_tax')} value={money(ret.output_tax)} />
              <Field label={t('accounting.tr_input_tax')} value={money(ret.input_tax)} />
              <Field label={t('accounting.tr_net')} value={`${money(ret.net_payable)} ${netLabel(ret.net_payable)}`} />
              <Field label={t('accounting.tr_lock_after')} value={fmtDate(period.period_end)} />
            </dl>
            <div className="mt-4 rounded-lg bg-surface-subtle px-4 py-3">
              <p className="text-sm text-ink-secondary">
                {t('accounting.tr_explain', {
                  jurisdiction: jurisdictionLabel(jurisdiction),
                  period: periodLabel,
                  net: money(ret.net_payable),
                  netLabel: netLabel(ret.net_payable),
                  lock: fmtDate(period.period_end),
                })}
              </p>
            </div>
            {!periodEnded && (
              <p className="mt-3 rounded-lg border border-border-subtle bg-surface-subtle px-3 py-2 text-xs text-ink-secondary">
                {t('accounting.tr_not_ended')}
              </p>
            )}
            {alreadyFiled && (
              <p className="mt-3 rounded-lg border border-border-subtle bg-surface-subtle px-3 py-2 text-xs text-ink-secondary">
                {t('accounting.tr_already_filed')}
              </p>
            )}
          </div>
        </div>
      ) : null}

      {/* ── Region B — filing history ────────────────────────────────────── */}
      <div data-print-hide className="rounded-card border border-border-subtle bg-surface-card overflow-hidden">
        <div className="border-b border-border-subtle px-5 py-3">
          <p className="text-sm font-semibold text-ink-primary">{t('accounting.tr_history')}</p>
        </div>
        {loadingFilings ? (
          <div className="px-5 py-6 text-center text-sm text-ink-tertiary">{t('common.loading')}</div>
        ) : (filings ?? []).length === 0 ? (
          <div className="px-5 py-8 text-center">
            <p className="text-sm text-ink-secondary">{t('accounting.tr_no_filings')}</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border-subtle text-xs text-ink-tertiary">
                  <th className="px-4 py-2 text-start font-medium">{t('accounting.tr_period')}</th>
                  <th className="px-4 py-2 text-start font-medium">{t('accounting.tr_jurisdiction')}</th>
                  <th className="px-4 py-2 text-start font-medium">{t('accounting.tr_status')}</th>
                  <th className="px-4 py-2 text-start font-medium">{t('accounting.tr_filed_on')}</th>
                  <th className="px-4 py-2 text-start font-medium">{t('accounting.tr_reference')}</th>
                  <th className="px-4 py-2 text-end font-medium">{t('accounting.tr_net')}</th>
                  <th className="px-4 py-2 text-end font-medium"></th>
                </tr>
              </thead>
              <tbody>
                {(filings ?? []).map((f) => (
                  <tr key={f.id} className="border-b border-border-subtle/60">
                    <td className="px-4 py-2 font-medium text-ink-primary">{fmtDate(f.period_start)} – {fmtDate(f.period_end)}</td>
                    <td className="px-4 py-2 text-ink-secondary">{jurisdictionLabel(f.jurisdiction)}</td>
                    <td className="px-4 py-2"><StatusBadge status={f.status} t={t} /></td>
                    <td className="px-4 py-2 text-ink-secondary">{fmtDate(f.filed_at)}</td>
                    <td className="px-4 py-2 text-ink-secondary">{f.reference_number || '—'}</td>
                    <td className="px-4 py-2 text-end font-mono text-ink-primary">{money(Number(f.net_payable))} {netLabel(Number(f.net_payable))}</td>
                    <td className="px-4 py-2 text-end">
                      {canWrite && f.status === 'filed' && f.period_end === latestFiledEnd && (
                        <Button variant="secondary" size="sm" onClick={() => { setReopenDone(false); reopenMutation.reset(); setReopenRow(f); }}>
                          {t('accounting.tr_reopen')}
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

      {/* ── File confirmation / success modal ────────────────────────────── */}
      <Modal
        open={showFile}
        onClose={() => { if (!fileMutation.isPending) { setShowFile(false); setFileResult(null); fileMutation.reset(); } }}
        title={fileResult ? t('accounting.tr_file_success_title') : t('accounting.tr_file_confirm_title')}
      >
        {fileResult ? (
          <div className="space-y-4">
            <div className="flex items-center gap-3">
              <span className="flex h-9 w-9 items-center justify-center rounded-full bg-emerald-100 text-emerald-700">
                <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M20 6 9 17l-5-5" /></svg>
              </span>
              <p className="text-sm text-ink-secondary">{t('accounting.tr_file_success_body', { period: periodLabel, lock: fmtDate(fileResult.period_lock_date) })}</p>
            </div>
            <div className="flex justify-end">
              <Button size="sm" onClick={() => { setShowFile(false); setFileResult(null); fileMutation.reset(); }}>{t('common.done')}</Button>
            </div>
          </div>
        ) : (
          <div className="space-y-4">
            <p className="text-sm text-ink-secondary">
              {t('accounting.tr_file_confirm_body', {
                jurisdiction: jurisdictionLabel(jurisdiction), period: periodLabel,
                net: ret ? money(ret.net_payable) : '', netLabel: ret ? netLabel(ret.net_payable) : '',
                lock: fmtDate(period.period_end),
              })}
            </p>
            {ret && !ret.reconciliation.matched && (
              <p className="rounded-lg border border-warning-500 bg-warning-50 px-3 py-2 text-xs text-warning-600">{t('accounting.tr_file_mismatch_warn')}</p>
            )}
            <div>
              <label className="mb-1 block text-xs font-medium text-ink-secondary">{t('accounting.tr_reference_optional')}</label>
              <Input value={reference} onChange={(e) => setReference(e.target.value)} placeholder={t('accounting.tr_reference_placeholder')} className="w-full" />
            </div>
            {fileMutation.isError && (
              <p className="rounded-lg border border-danger-500 bg-danger-50 px-3 py-2 text-xs text-danger-600">{friendlyError(fileMutation.error)}</p>
            )}
            <div className="flex justify-end gap-2">
              <Button variant="secondary" size="sm" onClick={() => setShowFile(false)} disabled={fileMutation.isPending}>{t('common.cancel')}</Button>
              <Button size="sm" loading={fileMutation.isPending} onClick={() => fileMutation.mutate()} disabled={!ret}>{t('accounting.tr_file_return')}</Button>
            </div>
          </div>
        )}
      </Modal>

      {/* ── Reopen confirmation / success modal ──────────────────────────── */}
      <Modal
        open={reopenRow != null}
        onClose={() => { if (!reopenMutation.isPending) { setReopenRow(null); setReopenDone(false); reopenMutation.reset(); } }}
        title={reopenDone ? t('accounting.tr_reopen_success_title') : t('accounting.tr_reopen_confirm_title')}
      >
        {reopenDone ? (
          <div className="space-y-4">
            <p className="text-sm text-ink-secondary">{t('accounting.tr_reopen_success_body')}</p>
            <div className="flex justify-end">
              <Button size="sm" onClick={() => { setReopenRow(null); setReopenDone(false); reopenMutation.reset(); }}>{t('common.done')}</Button>
            </div>
          </div>
        ) : (
          <div className="space-y-4">
            <p className="text-sm text-ink-secondary">
              {reopenRow && t('accounting.tr_reopen_confirm_body', { period: `${fmtDate(reopenRow.period_start)} – ${fmtDate(reopenRow.period_end)}` })}
            </p>
            {reopenMutation.isError && (
              <p className="rounded-lg border border-danger-500 bg-danger-50 px-3 py-2 text-xs text-danger-600">{friendlyError(reopenMutation.error)}</p>
            )}
            <div className="flex justify-end gap-2">
              <Button variant="secondary" size="sm" onClick={() => setReopenRow(null)} disabled={reopenMutation.isPending}>{t('common.cancel')}</Button>
              <Button variant="danger" size="sm" loading={reopenMutation.isPending} onClick={() => reopenRow && reopenMutation.mutate(reopenRow.id)}>{t('accounting.tr_reopen')}</Button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}

// ── date helpers (local, mirrors the AC-3A lib) ──────────────────────────────
function isoOf(d: Date): string {
  const y = d.getFullYear(); const m = String(d.getMonth() + 1).padStart(2, '0'); const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}
/** The filing period `offset` steps away from the one containing today (negative = earlier). */
function stepPeriod(frequency: FilingFrequency, offset: number) {
  let p = resolveFilingPeriod(frequency, isoOf(new Date()));
  for (let i = 0; i < Math.abs(offset); i++) {
    const anchor = offset < 0 ? new Date(p.period_start) : new Date(p.period_end);
    anchor.setDate(anchor.getDate() + (offset < 0 ? -1 : 1));
    p = resolveFilingPeriod(frequency, isoOf(anchor));
  }
  return p;
}

// ── presentational helpers ───────────────────────────────────────────────────
function Tile({ label, value, sub, accent, emphasis }: { label: string; value: string; sub?: string; accent?: 'green' | 'amber'; emphasis?: boolean }) {
  const color = accent === 'green' ? 'text-emerald-700' : accent === 'amber' ? 'text-warning-600' : 'text-ink-primary';
  return (
    <div className="rounded-lg border border-border-subtle bg-surface-subtle px-4 py-3">
      <p className="text-xs font-medium text-ink-tertiary">{label}</p>
      <p className={`mt-1 font-mono font-semibold ${emphasis ? 'text-xl' : 'text-base'} ${color}`}>{value}</p>
      {sub && <p className={`text-xs font-medium ${color}`}>{sub}</p>}
    </div>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-4 border-b border-border-subtle/40 py-1">
      <dt className="text-xs text-ink-tertiary">{label}</dt>
      <dd className="text-sm font-medium text-end text-ink-primary">{value}</dd>
    </div>
  );
}

function ReconRow({ label, r, fmt }: { label: string; r: { gl: number; documents: number; difference: number; matched: boolean }; fmt: (n: number) => string }) {
  return (
    <tr className="border-b border-border-subtle/60">
      <td className="px-2 py-1.5 text-ink-primary">{label}</td>
      <td className="px-2 py-1.5 text-end font-mono text-ink-primary">{fmt(r.gl)}</td>
      <td className="px-2 py-1.5 text-end font-mono text-ink-secondary">{fmt(r.documents)}</td>
      <td className={`px-2 py-1.5 text-end font-mono ${r.matched ? 'text-ink-tertiary' : 'text-danger-600'}`}>{r.difference === 0 ? '—' : fmt(r.difference)}</td>
    </tr>
  );
}

function StatusBadge({ status, t }: { status: string; t: (k: string) => string }) {
  const map: Record<string, string> = {
    filed: 'bg-emerald-100 text-emerald-700',
    reopened: 'bg-warning-50 text-warning-600',
    draft: 'bg-surface-muted text-ink-tertiary',
  };
  const label: Record<string, string> = {
    filed: t('accounting.tr_status_filed'),
    reopened: t('accounting.tr_status_reopened'),
    draft: t('accounting.tr_status_notfiled'),
  };
  return <span className={`rounded px-2 py-0.5 text-xs font-semibold ${map[status] ?? map.draft}`}>{label[status] ?? status}</span>;
}

function ReturnSkeleton() {
  return (
    <div data-print-hide className="rounded-card border border-border-subtle bg-surface-card p-5">
      <div className="h-4 w-48 animate-pulse rounded bg-surface-muted" />
      <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-3">
        {[0, 1, 2].map((i) => <div key={i} className="h-16 animate-pulse rounded-lg bg-surface-muted" />)}
      </div>
      <div className="mt-4 h-24 animate-pulse rounded-lg bg-surface-muted" />
    </div>
  );
}

function friendlyError(err: unknown): string {
  const msg = err instanceof Error ? err.message : String(err);
  if (/permission|not authorized|insufficient|42501/i.test(msg)) return 'You don’t have permission to file or reopen tax returns.';
  if (/does not exist|schema cache|PGRST202|could not find/i.test(msg)) return 'The tax-filing engine isn’t installed yet. Apply the pending database migration, then try again.';
  if (/already filed/i.test(msg)) return 'This tax period is already filed.';
  if (/has not ended/i.test(msg)) return 'This tax period has not ended yet.';
  if (/reverse order|later tax periods/i.test(msg)) return 'Reopen the most recently filed period first.';
  return msg.replace(/^accounting\.\w+:\s*/, '');
}
