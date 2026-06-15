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
import { Button } from '@/ui/button';
import { Modal } from '@/ui/modal';
import { theme } from '@/ui/theme';
import { buildSif, downloadSif, type SifResult } from './wps-sif';
import type {
  PayrollRunRow, PayrollRunItemRow, PayrollRunItemInsert,
  EmployeeRow, BankAccountRow,
} from '@/data/adapter';

const fmt = (n: number) => n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const MONTHS = ['January','February','March','April','May','June','July','August','September','October','November','December'];

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

const cellInput: React.CSSProperties = {
  width: '84px', padding: '5px 8px', fontSize: '12px', textAlign: 'end',
  border: `1px solid ${theme.border}`, borderRadius: '6px', outline: 'none',
  fontVariantNumeric: 'tabular-nums',
};

const STATUS_TONES: Record<string, { bg: string; text: string; border: string }> = {
  draft:     { bg: '#fffbeb', text: '#b45309', border: '#fde68a' },
  confirmed: { bg: '#f5f3ff', text: '#6d28d9', border: '#ddd6fe' },
  paid:      { bg: '#ecfdf5', text: '#047857', border: '#a7f3d0' },
  void:      { bg: '#fef2f2', text: '#dc2626', border: '#fecaca' },
};

export default function PayrollRunEditorPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const invalidateBooks = useInvalidateBooks();
  const { company_id } = useAuthStore();

  const [lines, setLines] = useState<LineState[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [payOpen, setPayOpen] = useState(false);
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

  const deleteMutation = useMutation({
    mutationFn: () => getAdapter().payroll.removeRun(id!),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['payroll_runs', company_id] });
      navigate('/payroll/runs');
    },
    onError: (e: Error) => setError(e.message),
  });

  if (!run) {
    return <p style={{ fontSize: '13px', color: theme.inkFaint, padding: '48px 0', textAlign: 'center' }}>Loading…</p>;
  }

  const tone = STATUS_TONES[run.status] ?? STATUS_TONES.draft;
  const totals = lines.reduce(
    (acc, l) => {
      const m = lineMath(l);
      const p = (s: string) => parseFloat(s) || 0;
      acc.gross += m.gross; acc.ded += p(l.deductions); acc.loan += p(l.loan); acc.net += m.net;
      return acc;
    },
    { gross: 0, ded: 0, loan: 0, net: 0 },
  );
  const busy = saveMutation.isPending || confirmMutation.isPending || payMutation.isPending || deleteMutation.isPending;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '20px', paddingBottom: '48px' }}>
      {/* ── Header ───────────────────────────────────────────────────── */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap' }}>
        <button onClick={() => navigate('/payroll/runs')} style={{ background: 'transparent', border: 'none', cursor: 'pointer', fontSize: '13px', color: '#64748b' }}>
          ← Payroll Runs
        </button>
        <span style={{ color: '#94a3b8' }}>/</span>
        <h1 style={{ margin: 0, fontSize: '20px', fontWeight: 700, color: theme.ink }}>
          {run.run_number} — {MONTHS[run.period_month - 1]} {run.period_year}
        </h1>
        <span style={{
          display: 'inline-block', padding: '3px 9px', borderRadius: '999px',
          fontSize: '11px', fontWeight: 600, textTransform: 'capitalize',
          background: tone.bg, color: tone.text, border: `1px solid ${tone.border}`,
        }}>{run.status}</span>
        <div style={{ marginInlineStart: 'auto', display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
          {isDraft && (
            <>
              <Button variant="ghost" size="sm" onClick={() => deleteMutation.mutate()} disabled={busy}>Delete draft</Button>
              <Button variant="secondary" size="sm" onClick={() => saveMutation.mutate()} disabled={busy}>
                {saveMutation.isPending ? 'Saving…' : 'Save'}
              </Button>
              <Button size="sm" onClick={() => confirmMutation.mutate()} disabled={busy || lines.length === 0}>
                {confirmMutation.isPending ? 'Confirming…' : 'Confirm (post to books)'}
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
              ⤓ WPS SIF file
            </Button>
          )}
          {run.status === 'confirmed' && (
            <Button size="sm" onClick={() => { setPayBankId(banks[0]?.id ?? ''); setPayOpen(true); }} disabled={busy}>
              Pay from bank…
            </Button>
          )}
        </div>
      </div>

      {error && (
        <div style={{ background: '#fef2f2', border: '1px solid #fecaca', borderRadius: '8px', padding: '10px 16px', fontSize: '13px', color: '#dc2626' }}>
          {error}
        </div>
      )}

      {/* ── Totals strip ─────────────────────────────────────────────── */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 160px), 1fr))', gap: '10px' }}>
        {([
          ['Gross Earnings', totals.gross, theme.ink],
          ['Deductions', totals.ded, '#b45309'],
          ['Loan Recovery', totals.loan, '#b45309'],
          ['Net Pay', totals.net, '#047857'],
        ] as Array<[string, number, string]>).map(([label, val, color]) => (
          <div key={label} style={{ background: '#fff', border: `1px solid ${theme.border}`, borderRadius: '12px', padding: '12px 16px', boxShadow: theme.shadowSm }}>
            <div style={{ fontSize: '10px', fontWeight: 700, color: theme.inkMuted, textTransform: 'uppercase', letterSpacing: '.06em' }}>{label}</div>
            <div className="font-mono" style={{ marginTop: '4px', fontSize: '18px', fontWeight: 700, color }}>{fmt(val)}</div>
          </div>
        ))}
        {Number(run.total_gratuity) > 0 && (
          <div style={{ background: '#fff', border: `1px solid ${theme.border}`, borderRadius: '12px', padding: '12px 16px', boxShadow: theme.shadowSm }}>
            <div style={{ fontSize: '10px', fontWeight: 700, color: theme.inkMuted, textTransform: 'uppercase', letterSpacing: '.06em' }}>Gratuity Accrued</div>
            <div className="font-mono" style={{ marginTop: '4px', fontSize: '18px', fontWeight: 700, color: '#6d28d9' }}>{fmt(Number(run.total_gratuity))}</div>
          </div>
        )}
      </div>

      {/* ── JE links ─────────────────────────────────────────────────── */}
      {(run.journal_entry_id || run.payment_journal_entry_id) && (
        <div style={{ fontSize: '12px', color: theme.inkMuted }}>
          {run.journal_entry_id && <span>Accrual posted to the books (see Accounting → Journal Entries). </span>}
          {run.payment_journal_entry_id && <span>Salary payment posted{run.bank_account_id ? ' from bank' : ''}.</span>}
        </div>
      )}

      {/* ── Items table ──────────────────────────────────────────────── */}
      <div className="overflow-x-auto bg-white" style={{ border: `1px solid ${theme.border}`, borderRadius: '12px', boxShadow: theme.shadowSm }}>
        <table className="w-full text-sm" style={{ minWidth: '980px' }}>
          <thead>
            <tr style={{ background: theme.panelHead, borderBottom: `1px solid ${theme.border}` }}>
              {['Employee', 'Basic', 'Housing', 'Transport', 'Other', 'Overtime', 'Bonus', 'Deductions', 'Loan', 'Net', ''].map((l, i) => (
                <th key={i} className="px-3 py-3" style={{
                  fontSize: '11px', fontWeight: 600, color: theme.inkMuted,
                  textTransform: 'uppercase', letterSpacing: '.05em',
                  textAlign: i === 0 ? 'start' : 'end', whiteSpace: 'nowrap',
                }}>{l}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {lines.map((l, idx) => {
              const emp = empMap[l.employee_id];
              const m = lineMath(l);
              const numCell = (key: keyof LineState) => (
                isDraft ? (
                  <input type="number" min="0" step="0.01" style={cellInput}
                    value={l[key]} onChange={e => setLine(idx, { [key]: e.target.value } as Partial<LineState>)} />
                ) : (
                  <span className="font-mono" style={{ fontSize: '12px' }}>{fmt(parseFloat(l[key]) || 0)}</span>
                )
              );
              return (
                <tr key={l.employee_id} style={{ borderTop: idx === 0 ? 'none' : '1px solid #f1f5f9' }}>
                  <td className="px-3 py-2" style={{ whiteSpace: 'nowrap' }}>
                    <span style={{ fontWeight: 500, color: theme.ink }}>{emp?.name ?? l.employee_id}</span>
                    {emp?.code && <span className="font-mono" style={{ marginInlineStart: '8px', fontSize: '10px', color: theme.inkFaint }}>{emp.code}</span>}
                  </td>
                  <td className="px-3 py-2" style={{ textAlign: 'end' }}>{numCell('basic')}</td>
                  <td className="px-3 py-2" style={{ textAlign: 'end' }}>{numCell('housing')}</td>
                  <td className="px-3 py-2" style={{ textAlign: 'end' }}>{numCell('transport')}</td>
                  <td className="px-3 py-2" style={{ textAlign: 'end' }}>{numCell('other')}</td>
                  <td className="px-3 py-2" style={{ textAlign: 'end' }}>{numCell('overtime')}</td>
                  <td className="px-3 py-2" style={{ textAlign: 'end' }}>{numCell('bonus')}</td>
                  <td className="px-3 py-2" style={{ textAlign: 'end' }}>{numCell('deductions')}</td>
                  <td className="px-3 py-2" style={{ textAlign: 'end' }}>{numCell('loan')}</td>
                  <td className="px-3 py-2 font-mono" style={{ textAlign: 'end', fontWeight: 700, color: m.net < 0 ? '#dc2626' : theme.ink }}>
                    {fmt(m.net)}
                  </td>
                  <td className="px-3 py-2" style={{ textAlign: 'end' }}>
                    {isDraft && (
                      <button onClick={() => removeLine(idx)} title="Remove from this run"
                        style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: theme.inkFaint, fontSize: '12px' }}>✕</button>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
          <tfoot>
            <tr style={{ borderTop: `2px solid ${theme.border}`, background: theme.panelHead, fontWeight: 700 }}>
              <td className="px-3 py-2.5" style={{ fontSize: '12px' }}>Total ({lines.length} employees)</td>
              <td colSpan={8} className="px-3 py-2.5 font-mono" style={{ textAlign: 'end', fontSize: '12px', color: theme.inkMuted }}>
                Gross {fmt(totals.gross)} · Deductions {fmt(totals.ded)} · Loans {fmt(totals.loan)}
              </td>
              <td className="px-3 py-2.5 font-mono" style={{ textAlign: 'end', color: '#047857' }}>{fmt(totals.net)}</td>
              <td />
            </tr>
          </tfoot>
        </table>
      </div>

      {isDraft && (
        <p style={{ fontSize: '12px', color: theme.inkFaint, margin: 0 }}>
          Confirm posts: <strong>Dr 6100 Salaries &amp; Benefits</strong> (gross − deductions)
          {' '}· <strong>Cr 1450 Employee Advances</strong> (loan recovery)
          {' '}· <strong>Cr 2350 Salaries Payable</strong> (net). Paying later settles 2350 from your bank.
        </p>
      )}

      {/* ── Pay modal ────────────────────────────────────────────────── */}
      <Modal open={payOpen} onClose={() => setPayOpen(false)} title={`Pay ${run.run_number} — ${fmt(Number(run.total_net))}`}>
        <div className="space-y-4">
          <div>
            <label className="mb-1 block text-xs font-medium text-ink-secondary">Pay from bank account</label>
            <select value={payBankId} onChange={e => setPayBankId(e.target.value)}
              className="h-9 w-full rounded-card border border-border-subtle bg-surface-card px-3 text-sm text-ink-primary focus:outline-none focus:ring-2 focus:ring-brand-500">
              <option value="">— select bank —</option>
              {banks.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
            </select>
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-ink-secondary">Payment date</label>
            <input type="date" value={payDate} onChange={e => setPayDate(e.target.value)}
              className="h-9 w-full rounded-card border border-border-subtle bg-surface-card px-3 text-sm text-ink-primary focus:outline-none focus:ring-2 focus:ring-brand-500" />
          </div>
          <p className="text-xs text-ink-tertiary">
            Posts Dr 2350 Salaries Payable / Cr bank for the net total. WPS SIF file export arrives in Payroll P2.
          </p>
          <div className="flex justify-end gap-2 pt-1">
            <Button variant="ghost" onClick={() => setPayOpen(false)} disabled={payMutation.isPending}>Cancel</Button>
            <Button onClick={() => payMutation.mutate()} disabled={payMutation.isPending || !payBankId}>
              {payMutation.isPending ? 'Posting…' : 'Confirm payment'}
            </Button>
          </div>
        </div>
      </Modal>

      {/* ── WPS SIF export modal (P2) ─────────────────────────────────── */}
      <Modal open={wpsOpen} onClose={() => setWpsOpen(false)} title={`WPS SIF file — ${run.run_number}`}>
        <div className="space-y-4">
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            <div>
              <label className="mb-1 block text-xs font-medium text-ink-secondary">Employer MOL establishment ID</label>
              <input value={wpsMolId} onChange={e => setWpsMolId(e.target.value)} placeholder="13-digit MOHRE ID"
                className="h-9 w-full rounded-card border border-border-subtle bg-surface-card px-3 text-sm text-ink-primary focus:outline-none focus:ring-2 focus:ring-brand-500" />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-ink-secondary">Employer bank routing code</label>
              <input value={wpsRouting} onChange={e => setWpsRouting(e.target.value)} placeholder="9-digit agent code"
                className="h-9 w-full rounded-card border border-border-subtle bg-surface-card px-3 text-sm text-ink-primary focus:outline-none focus:ring-2 focus:ring-brand-500" />
            </div>
          </div>
          <p className="text-xs text-ink-tertiary">
            Each employee line needs their <strong>MOL ID</strong>, <strong>IBAN</strong> and
            <strong> bank routing code</strong> (set on the Employees page). Both employer values
            are remembered on your company profile. Your bank/exchange validates the file on upload.
          </p>

          {wpsResult && (
            <div className={`rounded border px-3 py-2 text-xs ${wpsResult.skipped.length > 0 ? 'border-amber-300 bg-amber-50 text-amber-900' : 'border-emerald-300 bg-emerald-50 text-emerald-800'}`}>
              <p className="font-semibold">
                {wpsResult.fileName} downloaded — {wpsResult.edrCount} employee{wpsResult.edrCount === 1 ? '' : 's'}, AED {wpsResult.total.toLocaleString('en-US', { minimumFractionDigits: 2 })}
              </p>
              {wpsResult.skipped.length > 0 && (
                <ul className="mt-1 list-inside list-disc">
                  {wpsResult.skipped.map(s => (
                    <li key={s.name}>{s.name} — missing {s.missing.join(', ')}</li>
                  ))}
                </ul>
              )}
            </div>
          )}

          <div className="flex justify-end gap-2 pt-1">
            <Button variant="ghost" onClick={() => setWpsOpen(false)}>Close</Button>
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
              Generate &amp; download
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
