/**
 * Employees master — Payroll P1 (owner override 2026-06-13).
 *
 * Master data only (no GL impact). WPS-ready fields (MOL ID, IBAN) are
 * captured now so the P2 SIF export needs no schema change. Salary
 * structure = basic + 3 allowances; the monthly run copies these as a
 * starting point and stays editable per month.
 */
import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { getAdapter } from '@/data/index';
import { useAuthStore } from '@/store/auth';
import { Button } from '@/ui/button';
import { Modal } from '@/ui/modal';
import { PageHeader } from '@/ui/primitives';
import { theme } from '@/ui/theme';
import { computeGratuity, serviceLabel } from './gratuity';
import type { EmployeeRow, EmployeeInsert, BankAccountRow } from '@/data/adapter';

const fmt = (n: number) => n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

interface Draft {
  code: string; name: string; name_ar: string; designation: string;
  phone: string; email: string; emirates_id: string; mol_id: string;
  bank_name: string; iban: string; bank_routing_code: string; joining_date: string;
  basic_salary: string; housing_allowance: string; transport_allowance: string; other_allowance: string;
  is_active: boolean;
}

const emptyDraft = (code = ''): Draft => ({
  code, name: '', name_ar: '', designation: '', phone: '', email: '',
  emirates_id: '', mol_id: '', bank_name: '', iban: '', bank_routing_code: '', joining_date: '',
  basic_salary: '0', housing_allowance: '0', transport_allowance: '0', other_allowance: '0',
  is_active: true,
});

function toDraft(e: EmployeeRow): Draft {
  return {
    code: e.code ?? '', name: e.name, name_ar: e.name_ar ?? '', designation: e.designation ?? '',
    phone: e.phone ?? '', email: e.email ?? '', emirates_id: e.emirates_id ?? '', mol_id: e.mol_id ?? '',
    bank_name: e.bank_name ?? '', iban: e.iban ?? '', bank_routing_code: e.bank_routing_code ?? '',
    joining_date: (e.joining_date as string | null) ?? '',
    basic_salary: String(e.basic_salary), housing_allowance: String(e.housing_allowance),
    transport_allowance: String(e.transport_allowance), other_allowance: String(e.other_allowance),
    is_active: e.is_active,
  };
}

const inputCls = 'h-9 w-full rounded-card border border-border-subtle bg-surface-card px-3 text-sm text-ink-primary focus:outline-none focus:ring-2 focus:ring-brand-500';

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="mb-1 block text-xs font-medium text-ink-secondary">{label}</label>
      {children}
    </div>
  );
}

export default function EmployeesPage() {
  const { company_id } = useAuthStore();
  const qc = useQueryClient();
  const [modalOpen, setModalOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft>(emptyDraft());
  const [error, setError] = useState<string | null>(null);
  const [showInactive, setShowInactive] = useState(false);

  const { data: employees = [], isLoading } = useQuery<EmployeeRow[]>({
    queryKey: ['employees', company_id, showInactive],
    queryFn: () => getAdapter().employees.list(company_id!, { includeInactive: showInactive }),
    enabled: !!company_id,
  });

  const { data: banks = [] } = useQuery<BankAccountRow[]>({
    queryKey: ['bank_accounts', company_id],
    queryFn: () => getAdapter().bankAccounts.list(company_id!),
    enabled: !!company_id,
  });

  // ── Final Settlement (gratuity payout) state ──
  const [settleEmp, setSettleEmp] = useState<EmployeeRow | null>(null);
  const [settleAmount, setSettleAmount] = useState('');
  const [settleBankId, setSettleBankId] = useState('');
  const [settleDate, setSettleDate] = useState(new Date().toISOString().slice(0, 10));
  const [settleError, setSettleError] = useState<string | null>(null);

  const settleMutation = useMutation({
    mutationFn: () => getAdapter().payroll.settleGratuity(
      settleEmp!.id, parseFloat(settleAmount) || 0, settleBankId,
      { date: settleDate, deactivate: true },
    ),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['employees'] });
      setSettleEmp(null);
      setSettleError(null);
    },
    onError: (e: Error) => setSettleError(e.message),
  });

  function openSettle(e: EmployeeRow) {
    setSettleEmp(e);
    setSettleAmount(String(computeGratuity(e.joining_date as string | null, Number(e.basic_salary))));
    setSettleBankId(banks[0]?.id ?? '');
    setSettleDate(new Date().toISOString().slice(0, 10));
    setSettleError(null);
    setModalOpen(false);
  }

  const saveMutation = useMutation({
    mutationFn: async () => {
      if (!draft.name.trim()) throw new Error('Name is required');
      const row: EmployeeInsert = {
        company_id: company_id!,
        code: draft.code.trim() || null,
        name: draft.name.trim(),
        name_ar: draft.name_ar.trim() || null,
        designation: draft.designation.trim() || null,
        phone: draft.phone.trim() || null,
        email: draft.email.trim() || null,
        emirates_id: draft.emirates_id.trim() || null,
        mol_id: draft.mol_id.trim() || null,
        bank_name: draft.bank_name.trim() || null,
        iban: draft.iban.trim() || null,
        bank_routing_code: draft.bank_routing_code.trim() || null,
        joining_date: draft.joining_date || null,
        basic_salary: parseFloat(draft.basic_salary) || 0,
        housing_allowance: parseFloat(draft.housing_allowance) || 0,
        transport_allowance: parseFloat(draft.transport_allowance) || 0,
        other_allowance: parseFloat(draft.other_allowance) || 0,
        is_active: draft.is_active,
      };
      if (editingId) await getAdapter().employees.update(editingId, row);
      else await getAdapter().employees.create(row);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['employees'] });
      setModalOpen(false);
      setError(null);
    },
    onError: (e: Error) => setError(e.message),
  });

  async function openNew() {
    setEditingId(null);
    setError(null);
    let code = '';
    try { code = await getAdapter().employees.getNextCode(company_id!); } catch { /* optional */ }
    setDraft(emptyDraft(code));
    setModalOpen(true);
  }

  function openEdit(e: EmployeeRow) {
    setEditingId(e.id);
    setError(null);
    setDraft(toDraft(e));
    setModalOpen(true);
  }

  const totalPackage = (e: EmployeeRow) =>
    Number(e.basic_salary) + Number(e.housing_allowance) + Number(e.transport_allowance) + Number(e.other_allowance);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
      <PageHeader
        title="Employees"
        subtitle={`${employees.length} ${employees.length === 1 ? 'employee' : 'employees'}`}
        actions={<Button size="sm" onClick={openNew}>+ New Employee</Button>}
      />

      <label className="flex w-fit cursor-pointer select-none items-center gap-2 text-xs text-ink-secondary">
        <input type="checkbox" className="h-3.5 w-3.5 rounded accent-brand-600"
          checked={showInactive} onChange={e => setShowInactive(e.target.checked)} />
        Show inactive
      </label>

      {isLoading ? (
        <p style={{ fontSize: '13px', color: theme.inkFaint, padding: '48px 0', textAlign: 'center' }}>Loading…</p>
      ) : employees.length === 0 ? (
        <p style={{ fontSize: '13px', color: theme.inkFaint, padding: '48px 0', textAlign: 'center' }}>
          No employees yet. Add your team to start running payroll.
        </p>
      ) : (
        <div className="overflow-x-auto bg-white" style={{ border: `1px solid ${theme.border}`, borderRadius: '12px', boxShadow: theme.shadowSm }}>
          <table className="w-full text-sm">
            <thead>
              <tr style={{ background: theme.panelHead, borderBottom: `1px solid ${theme.border}` }}>
                {['Code', 'Name', 'Designation', 'Service', 'Basic', 'Package', 'Gratuity (est.)', 'Status'].map((l, i) => (
                  <th key={l} className="px-4 py-3" style={{
                    fontSize: '11px', fontWeight: 600, color: theme.inkMuted,
                    textTransform: 'uppercase', letterSpacing: '.06em',
                    textAlign: i >= 4 && i <= 6 ? 'end' : 'start', whiteSpace: 'nowrap',
                  }}>{l}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {employees.map((e, idx) => (
                <tr key={e.id} onClick={() => openEdit(e)} className="cursor-pointer"
                  style={{ borderTop: idx === 0 ? 'none' : '1px solid #f1f5f9', opacity: e.is_active ? 1 : 0.55, transition: 'background-color .12s' }}
                  onMouseEnter={(ev) => { (ev.currentTarget as HTMLElement).style.background = theme.panelHead; }}
                  onMouseLeave={(ev) => { (ev.currentTarget as HTMLElement).style.background = ''; }}
                >
                  <td className="px-4 py-3 font-mono" style={{ fontSize: '12px', color: theme.brandSoftText, fontWeight: 600 }}>{e.code ?? '—'}</td>
                  <td className="px-4 py-3" style={{ color: theme.ink, fontWeight: 500 }}>{e.name}</td>
                  <td className="px-4 py-3" style={{ color: theme.inkMuted, fontSize: '13px' }}>{e.designation ?? '—'}</td>
                  <td className="px-4 py-3" style={{ color: theme.inkMuted, fontSize: '13px' }}>{serviceLabel(e.joining_date as string | null)}</td>
                  <td className="px-4 py-3 font-mono" style={{ textAlign: 'end' }}>{fmt(Number(e.basic_salary))}</td>
                  <td className="px-4 py-3 font-mono" style={{ textAlign: 'end', fontWeight: 600 }}>{fmt(totalPackage(e))}</td>
                  <td className="px-4 py-3 font-mono" style={{ textAlign: 'end', color: '#6d28d9' }}>
                    {fmt(computeGratuity(e.joining_date as string | null, Number(e.basic_salary)))}
                  </td>
                  <td className="px-4 py-3">
                    <span style={{
                      display: 'inline-block', padding: '3px 9px', borderRadius: '999px',
                      fontSize: '11px', fontWeight: 600,
                      background: e.is_active ? '#ecfdf5' : '#f4f4f5',
                      color: e.is_active ? '#047857' : '#71717a',
                      border: `1px solid ${e.is_active ? '#a7f3d0' : '#e4e4e7'}`,
                    }}>{e.is_active ? 'Active' : 'Inactive'}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* ── Editor modal ─────────────────────────────────────────────── */}
      <Modal open={modalOpen} onClose={() => setModalOpen(false)}
        title={editingId ? 'Edit employee' : 'New employee'} width="lg">
        <div className="space-y-4">
          {error && <div className="rounded border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>}

          <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
            <Field label="Code"><input className={inputCls} value={draft.code} onChange={e => setDraft(d => ({ ...d, code: e.target.value }))} /></Field>
            <Field label="Name *"><input className={inputCls} value={draft.name} autoFocus onChange={e => setDraft(d => ({ ...d, name: e.target.value }))} /></Field>
            <Field label="Name (Arabic)"><input className={inputCls} dir="rtl" value={draft.name_ar} onChange={e => setDraft(d => ({ ...d, name_ar: e.target.value }))} /></Field>
            <Field label="Designation"><input className={inputCls} value={draft.designation} placeholder="e.g. Storekeeper" onChange={e => setDraft(d => ({ ...d, designation: e.target.value }))} /></Field>
            <Field label="Phone"><input className={inputCls} value={draft.phone} onChange={e => setDraft(d => ({ ...d, phone: e.target.value }))} /></Field>
            <Field label="Email"><input className={inputCls} type="email" value={draft.email} onChange={e => setDraft(d => ({ ...d, email: e.target.value }))} /></Field>
            <Field label="Joining date"><input className={inputCls} type="date" value={draft.joining_date} onChange={e => setDraft(d => ({ ...d, joining_date: e.target.value }))} /></Field>
            <Field label="Emirates ID"><input className={inputCls} value={draft.emirates_id} onChange={e => setDraft(d => ({ ...d, emirates_id: e.target.value }))} /></Field>
            <Field label="MOL ID (WPS)"><input className={inputCls} value={draft.mol_id} onChange={e => setDraft(d => ({ ...d, mol_id: e.target.value }))} /></Field>
            <Field label="Bank name"><input className={inputCls} value={draft.bank_name} onChange={e => setDraft(d => ({ ...d, bank_name: e.target.value }))} /></Field>
            <Field label="Routing code (WPS)"><input className={inputCls} value={draft.bank_routing_code} placeholder="9-digit agent code" onChange={e => setDraft(d => ({ ...d, bank_routing_code: e.target.value }))} /></Field>
            <Field label="IBAN (WPS payout)"><input className={inputCls} value={draft.iban} placeholder="AE.." onChange={e => setDraft(d => ({ ...d, iban: e.target.value }))} /></Field>
          </div>

          <div className="border-t border-border-subtle pt-3">
            <p className="mb-2 text-[10.5px] font-semibold uppercase tracking-wider text-ink-tertiary">Monthly salary structure</p>
            <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
              <Field label="Basic"><input className={inputCls} type="number" min="0" step="0.01" value={draft.basic_salary} onChange={e => setDraft(d => ({ ...d, basic_salary: e.target.value }))} /></Field>
              <Field label="Housing"><input className={inputCls} type="number" min="0" step="0.01" value={draft.housing_allowance} onChange={e => setDraft(d => ({ ...d, housing_allowance: e.target.value }))} /></Field>
              <Field label="Transport"><input className={inputCls} type="number" min="0" step="0.01" value={draft.transport_allowance} onChange={e => setDraft(d => ({ ...d, transport_allowance: e.target.value }))} /></Field>
              <Field label="Other"><input className={inputCls} type="number" min="0" step="0.01" value={draft.other_allowance} onChange={e => setDraft(d => ({ ...d, other_allowance: e.target.value }))} /></Field>
            </div>
            <p className="mt-2 text-xs text-ink-tertiary">
              Package: <span className="font-mono font-semibold text-ink-primary">
                {fmt((parseFloat(draft.basic_salary) || 0) + (parseFloat(draft.housing_allowance) || 0) + (parseFloat(draft.transport_allowance) || 0) + (parseFloat(draft.other_allowance) || 0))}
              </span> / month
            </p>
          </div>

          <label className="flex cursor-pointer items-center gap-2.5">
            <input type="checkbox" className="h-4 w-4 rounded accent-brand-600"
              checked={draft.is_active} onChange={e => setDraft(d => ({ ...d, is_active: e.target.checked }))} />
            <span className="text-sm text-ink-primary">Active (included in new payroll runs)</span>
          </label>

          <div className="flex items-center justify-between gap-2 pt-2">
            {editingId && draft.is_active ? (
              <Button variant="ghost" size="sm"
                onClick={() => { const e = employees.find(x => x.id === editingId); if (e) openSettle(e); }}
                title="Pay end-of-service gratuity and mark the employee as left">
                Final Settlement →
              </Button>
            ) : <span />}
            <div className="flex gap-2">
              <Button variant="ghost" onClick={() => setModalOpen(false)} disabled={saveMutation.isPending}>Cancel</Button>
              <Button onClick={() => saveMutation.mutate()} disabled={saveMutation.isPending || !draft.name.trim()}>
                {saveMutation.isPending ? 'Saving…' : 'Save'}
              </Button>
            </div>
          </div>
        </div>
      </Modal>

      {/* ── Final Settlement (gratuity payout) ─────────────────────────── */}
      <Modal open={!!settleEmp} onClose={() => setSettleEmp(null)}
        title={settleEmp ? `Final Settlement — ${settleEmp.name}` : 'Final Settlement'}>
        <div className="space-y-4">
          {settleError && <div className="rounded border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-700">{settleError}</div>}
          <p className="text-xs text-ink-tertiary">
            Pays end-of-service gratuity from a bank account and marks the employee as left
            (inactive). Posts <strong className="text-ink-secondary">Dr 2360 Gratuity Accrual / Cr bank</strong>.
            The amount is the estimated EOSB entitlement — adjust if your final calculation differs.
          </p>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Field label="Gratuity amount">
              <input className={inputCls} type="number" min="0" step="0.01" value={settleAmount}
                onChange={e => setSettleAmount(e.target.value)} />
            </Field>
            <Field label="Settlement date">
              <input className={inputCls} type="date" value={settleDate} onChange={e => setSettleDate(e.target.value)} />
            </Field>
            <div className="sm:col-span-2">
              <Field label="Pay from bank">
                <select className={inputCls} value={settleBankId} onChange={e => setSettleBankId(e.target.value)}>
                  <option value="">— select bank —</option>
                  {banks.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
                </select>
              </Field>
            </div>
          </div>
          <div className="flex justify-end gap-2 pt-1">
            <Button variant="ghost" onClick={() => setSettleEmp(null)} disabled={settleMutation.isPending}>Cancel</Button>
            <Button onClick={() => settleMutation.mutate()}
              disabled={settleMutation.isPending || !settleBankId || !(parseFloat(settleAmount) > 0)}>
              {settleMutation.isPending ? 'Posting…' : 'Pay & mark as left'}
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
