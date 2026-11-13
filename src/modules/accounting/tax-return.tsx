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
import { OceanPage } from '@/components/ocean-list';
import { ChevronLeft, ChevronRight, CheckCircle2, FileCheck2, FileDown, History } from 'lucide-react';
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
 * Ocean Teal layout (2026-11): look only, same data and actions.
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
  const jurLabel = t(`acctOcean.jur_${jurisdiction}`, { defaultValue: jurisdictionLabel(jurisdiction) });

  return (
    <OceanPage
      testid="tax-return-ocean"
      title={t('accounting.tr_title')}
      subtitle={t('accounting.tr_hint')}
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        {/* ── Region A — prepare & file ────────────────────────────────────── */}
        {loadingReturn && !ret ? (
          <div className="sb-card sb-doc-card" data-print-hide><p className="sb-empty" style={{ margin: 0 }}>{t('common.loading')}</p></div>
        ) : ret ? (
          <div className="sb-card sb-doc-card sb-doc-lines">
            {/* Print-only header */}
            <div data-print-only className="hidden mb-4">
              <p className="text-base font-bold text-ink-primary">{(company as any)?.name ?? ''}</p>
              <p className="text-sm text-ink-secondary">{jurLabel} — {t('accounting.tr_title')}</p>
              <p className="text-xs text-ink-tertiary">{periodLabel}</p>
            </div>

            {/* Header: period navigator + actions */}
            <div className="sb-doc-lines-head sb-acct-head">
              <div className="sb-acct-period">
                <button
                  data-print-hide type="button" onClick={() => setOffset((o) => o - 1)}
                  className="sb-icon-btn" title={t('accounting.tr_prev_period')} aria-label={t('accounting.tr_prev_period')}
                ><ChevronLeft size={17} className="sb-rtl-flip" aria-hidden="true" /></button>
                <div style={{ minWidth: 0 }}>
                  <p className="sb-doc-card-title" style={{ margin: 0 }}>{jurLabel} · <bdi dir="ltr">{periodLabel}</bdi></p>
                  <p className="sb-fx-name" style={{ margin: 0, fontSize: 12 }}>
                    {t('accounting.tr_frequency')}: {t(`accounting.tr_freq_${frequency}`)}
                    {existing && <> · <StatusPill status={existing.status} t={t} /></>}
                  </p>
                </div>
                <button
                  data-print-hide type="button" onClick={() => setOffset((o) => Math.min(0, o + 1))} disabled={offset >= 0}
                  className="sb-icon-btn" title={t('accounting.tr_next_period')} aria-label={t('accounting.tr_next_period')}
                ><ChevronRight size={17} className="sb-rtl-flip" aria-hidden="true" /></button>
              </div>
              <div data-print-hide className="sb-acct-actions">
                <ReportActions rows={exportRows} headers={exportHeaders} filename={exportName} disabled={!ret} />
                <button
                  type="button" disabled={!ret} title={t('accounting.tr_export_csv')}
                  onClick={() => downloadCSV(exportRows, exportHeaders, `${exportName}.csv`)}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-border-subtle bg-white px-3 py-1.5 text-xs font-semibold text-ink-secondary transition-colors hover:border-border-strong hover:text-ink-primary disabled:pointer-events-none disabled:opacity-50"
                ><FileDown size={14} aria-hidden="true" /> {t('acctOcean.csv')}</button>
                {canWrite && (
                  <Button size="sm" onClick={() => { setFileResult(null); setReference(''); fileMutation.reset(); setShowFile(true); }} disabled={alreadyFiled || !periodEnded}>
                    <FileCheck2 size={15} aria-hidden="true" /> {t('accounting.tr_file_return')}
                  </Button>
                )}
              </div>
            </div>

            {/* Summary strip */}
            <div className="sb-gl-summary sb-acct-sum">
              <div><span className="sb-info-label">{t('accounting.tr_output_tax')}</span><bdi dir="ltr" className="sb-dash-num">{money(ret.output_tax)}</bdi></div>
              <div><span className="sb-info-label">{t('accounting.tr_input_tax')}</span><bdi dir="ltr" className="sb-dash-num">{money(ret.input_tax)}</bdi></div>
              <div>
                <span className="sb-info-label">{t('accounting.tr_net')}</span>
                <bdi dir="ltr" className="sb-dash-num" style={{ color: ret.net_payable < 0 ? 'var(--sb-success)' : 'var(--sb-warning)' }}>{money(ret.net_payable)}</bdi>
                <span className="sb-fx-name" style={{ fontSize: 12, color: ret.net_payable < 0 ? 'var(--sb-success)' : 'var(--sb-warning)' }}>{netLabel(ret.net_payable)}</span>
              </div>
            </div>

            {/* Reconciliation */}
            <div className="sb-acct-section">
              <div className="sb-acct-section-head">
                <p className="sb-acct-label">{t('accounting.tr_reconciliation')}</p>
                <span className={`sb-pill ${ret.reconciliation.matched ? 'sb-pill-good' : 'sb-pill-warn'}`}>
                  {ret.reconciliation.matched ? t('accounting.tr_recon_matched') : t('accounting.tr_recon_mismatch')}
                </span>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm" style={{ minWidth: 460 }}>
                  <thead>
                    <tr>
                      <th className="px-3 py-2 text-start font-medium">{t('accounting.tr_recon_side')}</th>
                      <th className="px-3 py-2 text-end font-medium">{t('accounting.tr_recon_gl')}</th>
                      <th className="px-3 py-2 text-end font-medium">{t('accounting.tr_recon_docs')}</th>
                      <th className="px-3 py-2 text-end font-medium">{t('accounting.tr_recon_diff')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    <ReconRow label={t('accounting.tr_output_tax')} r={ret.reconciliation.output} fmt={fmt} />
                    <ReconRow label={t('accounting.tr_input_tax')} r={ret.reconciliation.input} fmt={fmt} />
                  </tbody>
                </table>
              </div>
              <p className="sb-form-hint" style={{ margin: 0 }}>{t('accounting.tr_recon_hint')}</p>
            </div>

            {/* Filing preview / plain-language explanation */}
            <div className="sb-acct-section">
              <p className="sb-acct-label">{t('accounting.tr_filing_preview')}</p>
              <dl className="sb-acct-fields">
                <Field label={t('accounting.tr_return_period')} value={periodLabel} />
                <Field label={t('accounting.tr_frequency')} value={t(`accounting.tr_freq_${frequency}`)} />
                <Field label={t('accounting.tr_output_tax')} value={money(ret.output_tax)} />
                <Field label={t('accounting.tr_input_tax')} value={money(ret.input_tax)} />
                <Field label={t('accounting.tr_net')} value={`${money(ret.net_payable)} ${netLabel(ret.net_payable)}`} />
                <Field label={t('accounting.tr_lock_after')} value={fmtDate(period.period_end)} />
              </dl>
              <p className="sb-info-note">
                {t('accounting.tr_explain', {
                  jurisdiction: jurLabel,
                  period: periodLabel,
                  net: money(ret.net_payable),
                  netLabel: netLabel(ret.net_payable),
                  lock: fmtDate(period.period_end),
                })}
              </p>
              {!periodEnded && <p className="sb-alert sb-alert-warn">{t('accounting.tr_not_ended')}</p>}
              {alreadyFiled && <p className="sb-alert sb-alert-good">{t('accounting.tr_already_filed')}</p>}
            </div>
          </div>
        ) : null}

        {/* ── Region B — filing history ────────────────────────────────────── */}
        <div data-print-hide className="sb-card sb-doc-card sb-doc-lines">
          <div className="sb-doc-lines-head">
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
              <span className="sb-side-ico" style={{ background: 'var(--sb-primary-light)', color: 'var(--sb-primary-dark)' }} aria-hidden="true"><History size={17} /></span>
              <p className="sb-doc-card-title" style={{ margin: 0 }}>{t('accounting.tr_history')}</p>
            </div>
          </div>
          {loadingFilings ? (
            <p className="sb-empty" style={{ margin: 0 }}>{t('common.loading')}</p>
          ) : (filings ?? []).length === 0 ? (
            <p className="sb-empty" style={{ margin: 0 }}>{t('accounting.tr_no_filings')}</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm" style={{ minWidth: 760 }}>
                <thead>
                  <tr>
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
                    <tr key={f.id}>
                      <td className="px-4 py-2 font-medium"><bdi dir="ltr">{fmtDate(f.period_start)} – {fmtDate(f.period_end)}</bdi></td>
                      <td className="px-4 py-2 text-ink-secondary">{t(`acctOcean.jur_${f.jurisdiction}`, { defaultValue: jurisdictionLabel(f.jurisdiction) })}</td>
                      <td className="px-4 py-2"><StatusPill status={f.status} t={t} /></td>
                      <td className="px-4 py-2 text-ink-secondary"><bdi dir="ltr">{fmtDate(f.filed_at)}</bdi></td>
                      <td className="px-4 py-2 text-ink-secondary">{f.reference_number || '—'}</td>
                      <td className="px-4 py-2 text-end"><bdi dir="ltr" className="sb-dash-num">{money(Number(f.net_payable))}</bdi> <span className="sb-fx-name">{netLabel(Number(f.net_payable))}</span></td>
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
      </div>

      {/* ── File confirmation / success modal ────────────────────────────── */}
      <Modal
        open={showFile}
        onClose={() => { if (!fileMutation.isPending) { setShowFile(false); setFileResult(null); fileMutation.reset(); } }}
        title={fileResult ? t('accounting.tr_file_success_title') : t('accounting.tr_file_confirm_title')}
      >
        {fileResult ? (
          <div className="sb-ocean sb-modal-form" style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            <p className="sb-alert sb-alert-good" style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <CheckCircle2 size={18} aria-hidden="true" style={{ flexShrink: 0 }} />
              {t('accounting.tr_file_success_body', { period: periodLabel, lock: fmtDate(fileResult.period_lock_date) })}
            </p>
            <div className="flex justify-end">
              <Button size="sm" onClick={() => { setShowFile(false); setFileResult(null); fileMutation.reset(); }}>{t('common.done')}</Button>
            </div>
          </div>
        ) : (
          <div className="sb-ocean sb-modal-form" style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            <p className="text-sm text-ink-secondary" style={{ margin: 0 }}>
              {t('accounting.tr_file_confirm_body', {
                jurisdiction: jurLabel, period: periodLabel,
                net: ret ? money(ret.net_payable) : '', netLabel: ret ? netLabel(ret.net_payable) : '',
                lock: fmtDate(period.period_end),
              })}
            </p>
            {ret && !ret.reconciliation.matched && (
              <p className="sb-alert sb-alert-warn">{t('accounting.tr_file_mismatch_warn')}</p>
            )}
            <div>
              <label className="sb-flabel">{t('accounting.tr_reference_optional')}</label>
              <Input value={reference} onChange={(e) => setReference(e.target.value)} placeholder={t('accounting.tr_reference_placeholder')} className="w-full" />
            </div>
            {fileMutation.isError && (
              <p className="sb-alert sb-alert-danger">{friendlyError(fileMutation.error, t)}</p>
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
          <div className="sb-ocean sb-modal-form" style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            <p className="sb-alert sb-alert-good">{t('accounting.tr_reopen_success_body')}</p>
            <div className="flex justify-end">
              <Button size="sm" onClick={() => { setReopenRow(null); setReopenDone(false); reopenMutation.reset(); }}>{t('common.done')}</Button>
            </div>
          </div>
        ) : (
          <div className="sb-ocean sb-modal-form" style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            <p className="text-sm text-ink-secondary" style={{ margin: 0 }}>
              {reopenRow && t('accounting.tr_reopen_confirm_body', { period: `${fmtDate(reopenRow.period_start)} – ${fmtDate(reopenRow.period_end)}` })}
            </p>
            {reopenMutation.isError && (
              <p className="sb-alert sb-alert-danger">{friendlyError(reopenMutation.error, t)}</p>
            )}
            <div className="flex justify-end gap-2">
              <Button variant="secondary" size="sm" onClick={() => setReopenRow(null)} disabled={reopenMutation.isPending}>{t('common.cancel')}</Button>
              <Button variant="danger" size="sm" loading={reopenMutation.isPending} onClick={() => reopenRow && reopenMutation.mutate(reopenRow.id)}>{t('accounting.tr_reopen')}</Button>
            </div>
          </div>
        )}
      </Modal>
    </OceanPage>
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
function Field({ label, value }: { label: string; value: string }) {
  return (
    <div className="sb-acct-field">
      <dt className="sb-info-label">{label}</dt>
      <dd className="sb-info-value"><bdi dir="ltr">{value}</bdi></dd>
    </div>
  );
}

function ReconRow({ label, r, fmt }: { label: string; r: { gl: number; documents: number; difference: number; matched: boolean }; fmt: (n: number) => string }) {
  return (
    <tr>
      <td className="px-3 py-2">{label}</td>
      <td className="px-3 py-2 text-end"><bdi dir="ltr" className="sb-dash-num">{fmt(r.gl)}</bdi></td>
      <td className="px-3 py-2 text-end text-ink-secondary"><bdi dir="ltr">{fmt(r.documents)}</bdi></td>
      <td className="px-3 py-2 text-end" style={{ color: r.matched ? 'var(--sb-text-secondary)' : 'var(--sb-danger)' }}><bdi dir="ltr">{r.difference === 0 ? '—' : fmt(r.difference)}</bdi></td>
    </tr>
  );
}

function StatusPill({ status, t }: { status: string; t: (k: string) => string }) {
  const tone: Record<string, string> = { filed: 'sb-pill-good', reopened: 'sb-pill-warn', draft: 'sb-pill-muted' };
  const label: Record<string, string> = {
    filed: t('accounting.tr_status_filed'),
    reopened: t('accounting.tr_status_reopened'),
    draft: t('accounting.tr_status_notfiled'),
  };
  return <span className={`sb-pill ${tone[status] ?? tone.draft}`}>{label[status] ?? status}</span>;
}

function friendlyError(err: unknown, t: (k: string) => string): string {
  const msg = err instanceof Error ? err.message : String(err);
  if (/permission|not authorized|insufficient|42501/i.test(msg)) return t('acctOcean.tr_err_permission');
  if (/does not exist|schema cache|PGRST202|could not find/i.test(msg)) return t('acctOcean.tr_err_missing');
  if (/already filed/i.test(msg)) return t('acctOcean.tr_err_already');
  if (/has not ended/i.test(msg)) return t('acctOcean.tr_err_not_ended');
  if (/reverse order|later tax periods/i.test(msg)) return t('acctOcean.tr_err_order');
  return msg.replace(/^accounting\.\w+:\s*/, '');
}
