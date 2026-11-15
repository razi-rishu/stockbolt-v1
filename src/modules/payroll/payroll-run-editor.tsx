/**
 * Payroll Run editor — Payroll P1 (owner override 2026-06-13).
 *
 * Draft:     edit per-employee earnings/deductions, save, delete, confirm.
 * Confirm:   posts the accrual JE  (Dr 6100 / Cr 1450 loans / Cr 2350 net)
 *            via confirm_payroll_run RPC — totals locked after this.
 * Pay:       picks a bank account, posts the settlement JE
 *            (Dr 2350 / Cr bank) via pay_payroll_run RPC.
 *
 * Per-line maths mirrors the RPC exactly:
 *   gross   = basic + housing + transport + other + overtime + bonus
 *   expense = gross − deductions          (absence/fines reduce 6100)
 *   net     = expense − loan_repayment    (loans recover 1450)
 */
import { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { getAdapter } from '@/data/index';
import { useAuthStore } from '@/store/auth';
import { useInvalidateBooks } from '@/hooks/use-invalidate-books';
import { useTranslation } from 'react-i18next';
import { Ban, CheckCircle2, Download, Landmark, Save, Trash2, X } from 'lucide-react';
import { Button } from '@/ui/button';
import { BackButton } from '@/ui/back-button';
import { Modal } from '@/ui/modal';
import { Input } from '@/ui/input';
import { Select } from '@/ui/select';
import { StatusBadge } from '@/ui/status-badge';
import { ReportFigures, ReportTableWrap, Num } from '@/components/ocean-report';
import '@/styles/stockbolt-ocean-teal.css';
import { buildSif, downloadSif, type SifResult } from './wps-sif';
import type {
  PayrollRunRow, PayrollRunItemRow, PayrollRunItemInsert,
  EmployeeRow, BankAccountRow,
} from '@/data/adapter';

const fmt = (n: number) => n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

interface LineState {
  employee_id: string;
  basic: string; housing: string; transport: string; other: string;
  overtime: string; bonus: string; deductions: string; loan: string;
}

function toLine(i: PayrollRunItemRow): LineState {
  return {
    employee_id: i.employee_id,
    basic: String(i.basic_salary), housing: String(i.housing_allowance),
    transport: String(i.transport_allowance), other: String(i.other_allowance),
    overtime: String(i.overtime), bonus: String(i.bonus),
    deductions: String(i.deductions), loan: String(i.loan_repayment),
  };
}

function lineMath(l: LineState) {
  const p = (s: string) => parseFloat(s) || 0;
  const gross = p(l.basic) + p(l.housing) + p(l.transport) + p(l.other) + p(l.overtime) + p(l.bonus);
  const expense = gross - p(l.deductions);
  const net = expense - p(l.loan);
  return { gross, expense, net };
}



export default function PayrollRunEditorPage() {
  const { t, i18n } = useTranslation();
  const monthName = (m: number) => new Date(2000, m - 1, 1).toLocaleString(i18n.language, { month: 'long' });
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const invalidateBooks = useInvalidateBooks();
  const { company_id } = useAuthStore();

  const [lines, setLines] = useState<LineState[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [payOpen, setPayOpen] = useState(false);
  const [voidOpen, setVoidOpen] = useState(false);
  const [voidReason, setVoidReason] = useState('');
  const [payBankId, setPayBankId] = useState('');
  const [payDate, setPayDate] = useState(new Date().toISOString().slice(0, 10));
  // P2 — WPS SIF export
  const [wpsOpen, setWpsOpen] = useState(false);
  const [wpsMolId, setWpsMolId] = useState('');
  const [wpsRouting, setWpsRouting] = useState('');
  const [wpsResult, setWpsResult] = useState<SifResult | null>(null);

  const { data: run } = useQuery<PayrollRunRow | null>({
    queryKey: ['payroll_run', id],
    queryFn: () => getAdapter().payroll.getRun(id!),
    enabled: !!id,
  });
  const { data: items = [] } = useQuery<PayrollRunItemRow[]>({
    queryKey: ['payroll_run_items', id],
    queryFn: () => getAdapter().payroll.getItems(id!),
    enabled: !!id,
  });
  const { data: employees = [] } = useQuery<EmployeeRow[]>({
    queryKey: ['employees', company_id, true],
    queryFn: () => getAdapter().employees.list(company_id!, { includeInactive: true }),
    enabled: !!company_id,
  });
  const { data: banks = [] } = useQuery<BankAccountRow[]>({
    queryKey: ['bank_accounts', company_id],
    queryFn: () => getAdapter().bankAccounts.list(company_id!),
    enabled: !!company_id,
  });
  // P2 — employer WPS identifiers live on the company record.
  const { data: company } = useQuery({
    queryKey: ['company', company_id],
    queryFn: () => getAdapter().companies.getById(company_id!),
    enabled: !!company_id,
  });

  const empMap = Object.fromEntries(employees.map(e => [e.id, e]));
  const isDraft = run?.status === 'draft';

  useEffect(() => { setLines(items.map(toLine)); }, [items]);

  function setLine(idx: number, patch: Partial<LineState>) {
    setLines(ls => ls.map((l, i) => (i === idx ? { ...l, ...patch } : l)));
  }
  function removeLine(idx: number) {
    setLines(ls => ls.filter((_, i) => i !== idx));
  }

  const buildInserts = (): PayrollRunItemInsert[] => lines.map(l => {
    const p = (s: string) => parseFloat(s) || 0;
    return {
      company_id: company_id!, run_id: id!,
      employee_id: l.employee_id,
      basic_salary: p(l.basic), housing_allowance: p(l.housing),
      transport_allowance: p(l.transport), other_allowance: p(l.other),
      overtime: p(l.overtime), bonus: p(l.bonus),
      deductions: p(l.deductions), loan_repayment: p(l.loan),
    };
  });

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ['payroll_run', id] });
    qc.invalidateQueries({ queryKey: ['payroll_run_items', id] });
    qc.invalidateQueries({ queryKey: ['payroll_runs', company_id] });
  };

  const saveMutation = useMutation({
    mutationFn: () => getAdapter().payroll.updateRun(id!, buildInserts()),
    onSuccess: () => { refresh(); setError(null); navigate('/payroll/runs'); },
    onError: (e: Error) => setError(e.message),
  });

  const confirmMutation = useMutation({
    mutationFn: async () => {
      await getAdapter().payroll.updateRun(id!, buildInserts());   // save latest edits first
      return getAdapter().payroll.confirmRun(id!);
    },
    onSuccess: async () => { await invalidateBooks(); refresh(); setError(null); },
    onError: (e: Error) => setError(e.message),
  });

  const payMutation = useMutation({
    mutationFn: () => getAdapter().payroll.payRun(id!, payBankId, payDate),
    onSuccess: async () => { await invalidateBooks(); refresh(); setPayOpen(false); setError(null); },
    onError: (e: Error) => setError(e.message),
  });

  // phase131 — reverses the payment (if paid) and the accrual at their own
  // voucher dates; the run stays on file marked Void.
  const voidMutation = useMutation({
    mutationFn: () => getAdapter().payroll.voidRun(id!, voidReason.trim()),
    onSuccess: async () => { await invalidateBooks(); refresh(); setVoidOpen(false); setError(null); },
    onError: (e: Error) => setError(e.message),
  });

  const deleteMutation = useMutation({
    mutationFn: () => getAdapter().payroll.removeRun(id!),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['payroll_runs', company_id] });
      navigate('/payroll/runs');
    },
    onError: (e: Error) => setError(e.message),
  });

  if (!run) {
    return <div className="sb-ocean sb-docx"><div className="sb-card sb-empty">{t('common.loading')}</div></div>;
  }

  const totals = lines.reduce(
    (acc, l) => {
      const m = lineMath(l);
      const p = (s: string) => parseFloat(s) || 0;
      acc.gross += m.gross; acc.ded += p(l.deductions); acc.loan += p(l.loan); acc.net += m.net;
      return acc;
    },
    { gross: 0, ded: 0, loan: 0, net: 0 },
  );
  const busy = saveMutation.isPending || confirmMutation.isPending || payMutation.isPending || deleteMutation.isPending || voidMutation.isPending;

  // Column totals for the foot of the lines table (same lines as the strip).
  const FIELDS: Array<[keyof LineState, string]> = [
    ['basic', t('payOcean.col_basic')], ['housing', t('payOcean.f_housing')], ['transport', t('payOcean.f_transport')],
    ['other', t('payOcean.f_other')], ['overtime', t('payOcean.col_overtime')], ['bonus', t('payOcean.col_bonus')],
    ['deductions', t('payOcean.col_deductions')], ['loan', t('payOcean.col_loan')],
  ];
  const colSum = (key: keyof LineState) => lines.reduce((s, l) => s + (parseFloat(l[key]) || 0), 0);

  const paidFrom = (() => {
    if (!run.payment_journal_entry_id) return null;
    const ba = banks.find(b => b.id === run.bank_account_id);
    if (ba) return t('payOcean.paid_from', { name: ba.name, kind: ba.account_type === 'cash' ? t('payOcean.kind_cash') : t('payOcean.kind_bank') });
    return run.bank_account_id ? t('payOcean.paid_from_missing') : t('payOcean.paid_from_unknown');
  })();

  return (
    // Ocean Teal (UI v1.1): look only — same line maths, save / confirm /
    // pay / delete and WPS file as before.
    <div className="sb-ocean sb-docx" data-testid="payroll-run-ocean">
      <div className="sb-card sb-doc-bar">
        <div className="sb-doc-bar-id">
          <BackButton to="/payroll/runs" label={t('payOcean.runs_title')} />
          <h1 className="sb-doc-bar-no">{monthName(run.period_month)} <bdi dir="ltr">{run.period_year}</bdi></h1>
          <bdi dir="ltr" className="sb-acct-code">{run.run_number}</bdi>
          <StatusBadge status={run.status} />
        </div>
        <div className="sb-doc-bar-actions">
          {isDraft && (
            <>
              <Button variant="ghost" size="sm" onClick={() => deleteMutation.mutate()} disabled={busy}>
                <Trash2 size={15} aria-hidden="true" /> {t('payOcean.delete_draft')}
              </Button>
              <Button variant="secondary" size="sm" onClick={() => saveMutation.mutate()} disabled={busy}>
                <Save size={15} aria-hidden="true" /> {saveMutation.isPending ? t('common.saving') : t('common.save')}
              </Button>
              <Button size="sm" onClick={() => confirmMutation.mutate()} disabled={busy || lines.length === 0}>
                <CheckCircle2 size={15} aria-hidden="true" /> {confirmMutation.isPending ? t('payOcean.confirming') : t('payOcean.confirm_post')}
              </Button>
            </>
          )}
          {(run.status === 'confirmed' || run.status === 'paid') && (
            <Button variant="secondary" size="sm" onClick={() => {
              setWpsMolId(company?.mol_establishment_id ?? '');
              setWpsRouting(company?.wps_routing_code ?? '');
              setWpsResult(null);
              setWpsOpen(true);
            }} disabled={busy}>
              <Download size={15} aria-hidden="true" /> {t('payOcean.wps_file')}
            </Button>
          )}
          {run.status === 'confirmed' && (
            <Button size="sm" onClick={() => { setPayBankId(banks[0]?.id ?? ''); setPayOpen(true); }} disabled={busy}>
              <Landmark size={15} aria-hidden="true" /> {t('payOcean.pay_from_bank')}
            </Button>
          )}
          {(run.status === 'confirmed' || run.status === 'paid') && (
            <Button variant="ghost" size="sm" onClick={() => { setVoidReason(''); setError(null); setVoidOpen(true); }} disabled={busy}>
              <Ban size={15} aria-hidden="true" /> {t('staff.void_run')}
            </Button>
          )}
        </div>
      </div>

      {error && <p className="sb-alert sb-alert-danger" role="alert">{error}</p>}

      {/* ── Totals strip ── */}
      <div className="sb-card sb-rpt-card">
        <ReportFigures figures={[
          { label: t('payOcean.fig_gross'), value: <Num>{fmt(totals.gross)}</Num> },
          { label: t('payOcean.col_deductions'), value: <Num>{fmt(totals.ded)}</Num>, tone: totals.ded > 0 ? 'warn' : undefined },
          { label: t('payOcean.fig_loan'), value: <Num>{fmt(totals.loan)}</Num>, tone: totals.loan > 0 ? 'warn' : undefined },
          { label: t('payOcean.col_net'), value: <Num>{fmt(totals.net)}</Num>, tone: 'good' },
          ...(Number(run.total_gratuity) > 0
            ? [{ label: t('payOcean.fig_gratuity_accrued'), value: <Num>{fmt(Number(run.total_gratuity))}</Num>, tone: 'brand' as const }]
            : []),
        ]} />
        {(run.journal_entry_id || paidFrom) && (
          <p className="sb-rpt-hint">
            {run.journal_entry_id && <span>{t('payOcean.accrual_posted')} </span>}
            {paidFrom && <span>{paidFrom}</span>}
          </p>
        )}
      </div>

      {/* ── Lines ── */}
      <div className="sb-card sb-rpt-card">
        <div className="sb-rpt-card-head">
          <h2 className="sb-rpt-card-title">{t('payOcean.lines_title')}</h2>
          <span className="sb-rpt-card-meta">{t('payOcean.lines_count', { count: lines.length })}</span>
        </div>
        <ReportTableWrap>
          <table className="sb-rpt-table sb-rpt-flat sb-pay-lines" style={{ minWidth: 980 }}>
            <thead>
              <tr>
                <th>{t('payOcean.col_employee')}</th>
                {FIELDS.map(([k, label]) => <th key={k} className="num">{label}</th>)}
                <th className="num">{t('payOcean.col_net')}</th>
                {isDraft && <th aria-label={t('payOcean.remove_line')} />}
              </tr>
            </thead>
            <tbody>
              {lines.map((l, idx) => {
                const emp = empMap[l.employee_id];
                const m = lineMath(l);
                return (
                  <tr key={l.employee_id}>
                    <td>
                      <span className="sb-pay-namecode">
                        <span className="strong">{emp?.name ?? l.employee_id}</span>
                        {emp?.code && <bdi dir="ltr" className="code">{emp.code}</bdi>}
                      </span>
                    </td>
                    {FIELDS.map(([key]) => (
                      <td key={key} className="num">
                        {isDraft ? (
                          <input
                            type="number" min="0" step="0.01" dir="ltr" className="sb-pay-in"
                            aria-label={`${emp?.name ?? ''} ${FIELDS.find(f => f[0] === key)?.[1] ?? ''}`}
                            value={l[key]} onChange={e => setLine(idx, { [key]: e.target.value } as Partial<LineState>)}
                          />
                        ) : (
                          <Num className={(parseFloat(l[key]) || 0) === 0 ? 'muted' : undefined}>{fmt(parseFloat(l[key]) || 0)}</Num>
                        )}
                      </td>
                    ))}
                    <td className={`num strong ${m.net < 0 ? 'is-down' : ''}`}><Num>{fmt(m.net)}</Num></td>
                    {isDraft && (
                      <td className="num">
                        <button type="button" className="sb-icon-btn" onClick={() => removeLine(idx)}
                          title={t('payOcean.remove_line')} aria-label={t('payOcean.remove_line')}>
                          <X size={15} aria-hidden="true" />
                        </button>
                      </td>
                    )}
                  </tr>
                );
              })}
            </tbody>
            <tfoot>
              <tr className="sb-rpt-total">
                <td>{t('rptOcean.total')}</td>
                {FIELDS.map(([key]) => <td key={key} className="num"><Num>{fmt(colSum(key))}</Num></td>)}
                <td className="num"><Num>{fmt(totals.net)}</Num></td>
                {isDraft && <td />}
              </tr>
            </tfoot>
          </table>
        </ReportTableWrap>
        {isDraft && (
          <p className="sb-rpt-foot">
            {t('payOcean.confirm_explain')}{' '}
            <bdi dir="ltr"><strong>Dr 6100</strong> · <strong>Cr 1450</strong> · <strong>Cr 2350</strong></bdi>
          </p>
        )}
      </div>

      {/* ── Pay modal ── */}
      <Modal open={voidOpen} onClose={() => setVoidOpen(false)} title={t('staff.void_run_title', { run: run.run_number })}>
        <div className="sb-ocean sb-modal-form flex flex-col gap-4">
          <p className="sb-alert sb-alert-warn" style={{ fontWeight: 400 }}>
            {run.status === 'paid' ? t('staff.void_run_paid') : t('staff.void_run_confirmed')}
          </p>
          <Input label={t('staff.void_reason')} required value={voidReason} onChange={e => setVoidReason(e.target.value)} />
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setVoidOpen(false)} disabled={voidMutation.isPending}>{t('common.cancel')}</Button>
            <Button variant="danger" onClick={() => voidMutation.mutate()} disabled={voidMutation.isPending || !voidReason.trim()}>
              <Ban size={15} aria-hidden="true" /> {t('staff.void_run')}
            </Button>
          </div>
        </div>
      </Modal>

      <Modal open={payOpen} onClose={() => setPayOpen(false)}
        title={t('payOcean.pay_title', { run: run.run_number, amount: fmt(Number(run.total_net)) })}>
        <div className="sb-ocean sb-modal-form flex flex-col gap-4">
          <Select label={t('payOcean.f_pay_from')} value={payBankId} onChange={e => setPayBankId(e.target.value)}
            options={[{ value: '', label: t('payOcean.select_bank') }, ...banks.map(b => ({ value: b.id, label: b.name }))]} />
          <Input label={t('payOcean.f_payment_date')} type="date" value={payDate} onChange={e => setPayDate(e.target.value)} />
          <p className="sb-info-note" style={{ fontSize: 13 }}>
            {t('payOcean.pay_explain')} <bdi dir="ltr"><strong>Dr 2350 / Cr {t('payOcean.bank')}</strong></bdi>
          </p>
          <div className="flex justify-end gap-2 pt-1">
            <Button variant="ghost" onClick={() => setPayOpen(false)} disabled={payMutation.isPending}>{t('common.cancel')}</Button>
            <Button onClick={() => payMutation.mutate()} disabled={payMutation.isPending || !payBankId}>
              {payMutation.isPending ? t('payOcean.posting') : t('payOcean.confirm_payment')}
            </Button>
          </div>
        </div>
      </Modal>

      {/* ── WPS SIF export modal (P2) ── */}
      <Modal open={wpsOpen} onClose={() => setWpsOpen(false)} title={t('payOcean.wps_title', { run: run.run_number })}>
        <div className="sb-ocean sb-modal-form flex flex-col gap-4">
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            <Input label={t('payOcean.f_mol_establishment')} dir="ltr" value={wpsMolId} onChange={e => setWpsMolId(e.target.value)} placeholder={t('payOcean.f_mol_establishment_ph')} />
            <Input label={t('payOcean.f_employer_routing')} dir="ltr" value={wpsRouting} onChange={e => setWpsRouting(e.target.value)} placeholder={t('payOcean.f_routing_ph')} />
          </div>
          <p className="sb-info-note" style={{ fontSize: 13 }}>{t('payOcean.wps_explain')}</p>

          {wpsResult && (
            <div className={`sb-alert ${wpsResult.skipped.length > 0 ? 'sb-alert-warn' : 'sb-alert-good'}`}>
              <p style={{ margin: 0, fontWeight: 700 }}>
                {t('payOcean.wps_done', { file: wpsResult.fileName, count: wpsResult.edrCount })}{' '}
                <bdi dir="ltr">AED {wpsResult.total.toLocaleString('en-US', { minimumFractionDigits: 2 })}</bdi>
              </p>
              {wpsResult.skipped.length > 0 && (
                <ul style={{ margin: '6px 0 0', paddingInlineStart: 18 }}>
                  {wpsResult.skipped.map(s => (
                    <li key={s.name}>{t('payOcean.wps_missing', { name: s.name, fields: s.missing.join(', ') })}</li>
                  ))}
                </ul>
              )}
            </div>
          )}

          <div className="flex justify-end gap-2 pt-1">
            <Button variant="ghost" onClick={() => setWpsOpen(false)}>{t('common.close')}</Button>
            <Button
              disabled={!wpsMolId.trim() || !wpsRouting.trim()}
              onClick={async () => {
                const result = buildSif(run, items, employees, {
                  molEstablishmentId: wpsMolId, routingCode: wpsRouting,
                });
                setWpsResult(result);
                if (result.edrCount > 0) downloadSif(result);
                // Remember employer identifiers for next month.
                try {
                  await getAdapter().companies.update(company_id!, {
                    mol_establishment_id: wpsMolId.trim() || null,
                    wps_routing_code: wpsRouting.trim() || null,
                  });
                  qc.invalidateQueries({ queryKey: ['company', company_id] });
                } catch { /* non-fatal — file already downloaded */ }
              }}
            >
              <Download size={15} aria-hidden="true" /> {t('payOcean.wps_generate')}
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
