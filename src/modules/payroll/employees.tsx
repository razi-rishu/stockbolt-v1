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
import { useTranslation } from 'react-i18next';
import { Plus, UserRoundCheck } from 'lucide-react';
import { Button } from '@/ui/button';
import { Modal } from '@/ui/modal';
import { Input } from '@/ui/input';
import { Select } from '@/ui/select';
import { OceanPage, OceanTable } from '@/components/ocean-list';
import { ReportFigures } from '@/components/ocean-report';
import type { Column } from '@/ui/table';
import { computeGratuity, serviceLabel } from './gratuity';
import type { EmployeeRow, EmployeeInsert, BankAccountRow } from '@/data/adapter';
import { useArabicEnabled } from '@/hooks/use-arabic-enabled';

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

export default function EmployeesPage() {
  const { t } = useTranslation();
  const arabicOn = useArabicEnabled();   // India companies: English only
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
      if (!draft.name.trim()) throw new Error(t('payOcean.err_name'));
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

  const set = <K extends keyof Draft>(key: K) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setDraft(d => ({ ...d, [key]: e.target.value }));
  const num = (v: string) => parseFloat(v) || 0;
  // serviceLabel keeps its own arithmetic ("3 yr 9 mo"); the numbers are read
  // back out and put into a translated sentence so Arabic reads in order.
  const service = (d: string | null) => {
    const label = serviceLabel(d);
    if (label === '—') return label;
    const y = /(\d+) yr/.exec(label)?.[1];
    const m = /(\d+) mo/.exec(label)?.[1];
    if (y && m) return t('payOcean.service_ym', { y, m });
    if (y) return t('payOcean.service_y', { y });
    return t('payOcean.service_m', { m: m ?? '0' });
  };
  const gratuityOf = (e: EmployeeRow) => computeGratuity(e.joining_date as string | null, Number(e.basic_salary));

  const active = employees.filter(e => e.is_active);
  const monthlyPackage = active.reduce((s, e) => s + totalPackage(e), 0);
  const gratuityTotal = active.reduce((s, e) => s + gratuityOf(e), 0);

  const columns: Column<EmployeeRow>[] = [
    { key: 'name', header: t('payOcean.col_name'), render: e => (
      <span className="sb-pay-namecode">
        <span style={{ fontWeight: 700 }}>{e.name}</span>
        {e.code && <bdi dir="ltr" className="sb-acct-code">{e.code}</bdi>}
      </span>
    ) },
    { key: 'designation', header: t('payOcean.col_designation'), render: e => e.designation ?? '—' },
    { key: 'service', header: t('payOcean.col_service'), render: e => service(e.joining_date as string | null) },
    { key: 'basic', header: t('payOcean.col_basic'), align: 'end', render: e => <bdi dir="ltr" className="sb-dash-num" style={{ fontWeight: 500 }}>{fmt(Number(e.basic_salary))}</bdi> },
    { key: 'package', header: t('payOcean.col_package'), align: 'end', render: e => <bdi dir="ltr" className="sb-dash-num">{fmt(totalPackage(e))}</bdi> },
    { key: 'gratuity', header: t('payOcean.col_gratuity'), align: 'end', render: e => <bdi dir="ltr" className="sb-dash-num" style={{ color: 'var(--sb-primary-dark)' }}>{fmt(gratuityOf(e))}</bdi> },
    { key: 'status', header: '', render: e => (
      <span className={`sb-pill ${e.is_active ? 'sb-pill-good' : 'sb-pill-muted'}`}>{e.is_active ? t('common.active') : t('payOcean.inactive')}</span>
    ) },
  ];

  return (
    // Ocean Teal (UI v1.1): look only — same employee record, salary structure
    // and final settlement posting as before.
    <OceanPage
      testid="employees-ocean"
      title={t('payOcean.emp_title')}
      subtitle={t('payOcean.emp_count', { count: employees.length })}
      actions={
        <button type="button" className="sb-primary-btn sb-btn-inline" onClick={openNew}>
          <Plus size={18} aria-hidden="true" /> {t('payOcean.new_employee')}
        </button>
      }
      below={
        <label className="sb-pay-toggle">
          <input type="checkbox" checked={showInactive} onChange={e => setShowInactive(e.target.checked)} />
          {t('payOcean.show_inactive')}
        </label>
      }
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        {employees.length > 0 && (
          <div className="sb-card sb-rpt-card">
            <ReportFigures figures={[
              { label: t('payOcean.fig_active'), value: <bdi dir="ltr">{active.length}</bdi> },
              { label: t('payOcean.fig_monthly'), value: <bdi dir="ltr">{fmt(monthlyPackage)}</bdi>, tone: 'brand' },
              { label: t('payOcean.fig_gratuity'), value: <bdi dir="ltr">{fmt(gratuityTotal)}</bdi>, note: t('payOcean.fig_gratuity_note') },
            ]} />
          </div>
        )}

        {isLoading
          ? <div className="sb-card sb-empty">{t('common.loading')}</div>
          : <OceanTable
              columns={columns} rows={employees} keyFn={e => e.id} onRowClick={openEdit}
              rowMuted={e => !e.is_active} emptyMessage={t('payOcean.emp_empty')} cardTitleKey="name"
            />}
      </div>

      {/* ── Editor modal ── */}
      <Modal open={modalOpen} onClose={() => setModalOpen(false)}
        title={editingId ? t('payOcean.edit_employee') : t('payOcean.new_employee')} width="lg">
        <div className="sb-ocean sb-modal-form flex flex-col gap-4">
          {error && <p className="sb-alert sb-alert-danger" role="alert">{error}</p>}

          <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
            <Input label={t('payOcean.f_code')} dir="ltr" value={draft.code} onChange={set('code')} />
            <Input label={t('payOcean.f_name')} required autoFocus value={draft.name} onChange={set('name')} />
            {arabicOn && <Input label={t('payOcean.f_name_ar')} dir="rtl" value={draft.name_ar} onChange={set('name_ar')} />}
            <Input label={t('payOcean.col_designation')} placeholder={t('payOcean.f_designation_ph')} value={draft.designation} onChange={set('designation')} />
            <Input label={t('payOcean.f_phone')} dir="ltr" value={draft.phone} onChange={set('phone')} />
            <Input label={t('payOcean.f_email')} dir="ltr" type="email" value={draft.email} onChange={set('email')} />
            <Input label={t('payOcean.f_joining')} type="date" value={draft.joining_date} onChange={set('joining_date')} />
            <Input label={t('payOcean.f_emirates_id')} dir="ltr" value={draft.emirates_id} onChange={set('emirates_id')} />
            <Input label={t('payOcean.f_mol_id')} dir="ltr" value={draft.mol_id} onChange={set('mol_id')} />
            <Input label={t('payOcean.f_bank_name')} value={draft.bank_name} onChange={set('bank_name')} />
            <Input label={t('payOcean.f_routing')} dir="ltr" placeholder={t('payOcean.f_routing_ph')} value={draft.bank_routing_code} onChange={set('bank_routing_code')} />
            <Input label={t('payOcean.f_iban')} dir="ltr" placeholder="AE.." value={draft.iban} onChange={set('iban')} />
          </div>

          <div className="sb-pay-section">
            <p className="sb-acct-label">{t('payOcean.salary_structure')}</p>
            <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
              <Input label={t('payOcean.col_basic')} dir="ltr" type="number" min="0" step="0.01" value={draft.basic_salary} onChange={set('basic_salary')} />
              <Input label={t('payOcean.f_housing')} dir="ltr" type="number" min="0" step="0.01" value={draft.housing_allowance} onChange={set('housing_allowance')} />
              <Input label={t('payOcean.f_transport')} dir="ltr" type="number" min="0" step="0.01" value={draft.transport_allowance} onChange={set('transport_allowance')} />
              <Input label={t('payOcean.f_other')} dir="ltr" type="number" min="0" step="0.01" value={draft.other_allowance} onChange={set('other_allowance')} />
            </div>
            <p className="sb-pay-package">
              <span>{t('payOcean.package_month')}</span>
              <bdi dir="ltr" className="sb-dash-num">
                {fmt(num(draft.basic_salary) + num(draft.housing_allowance) + num(draft.transport_allowance) + num(draft.other_allowance))}
              </bdi>
            </p>
          </div>

          <label className="flex cursor-pointer items-center gap-2.5">
            <input type="checkbox" className="h-4 w-4" style={{ accentColor: 'var(--sb-primary)' }}
              checked={draft.is_active} onChange={e => setDraft(d => ({ ...d, is_active: e.target.checked }))} />
            <span style={{ fontSize: 14 }}>{t('payOcean.f_active')}</span>
          </label>

          <div className="flex flex-wrap items-center justify-between gap-2 pt-2">
            {editingId && draft.is_active ? (
              <Button variant="ghost" size="sm"
                onClick={() => { const e = employees.find(x => x.id === editingId); if (e) openSettle(e); }}
                title={t('payOcean.settle_hint')}>
                <UserRoundCheck size={15} aria-hidden="true" /> {t('payOcean.final_settlement')}
              </Button>
            ) : <span />}
            <div className="flex gap-2">
              <Button variant="ghost" onClick={() => setModalOpen(false)} disabled={saveMutation.isPending}>{t('common.cancel')}</Button>
              <Button onClick={() => saveMutation.mutate()} disabled={saveMutation.isPending || !draft.name.trim()}>
                {saveMutation.isPending ? t('common.saving') : t('common.save')}
              </Button>
            </div>
          </div>
        </div>
      </Modal>

      {/* ── Final Settlement (gratuity payout) ── */}
      <Modal open={!!settleEmp} onClose={() => setSettleEmp(null)}
        title={settleEmp ? t('payOcean.settle_title_for', { name: settleEmp.name }) : t('payOcean.final_settlement')}>
        <div className="sb-ocean sb-modal-form flex flex-col gap-4">
          {settleError && <p className="sb-alert sb-alert-danger" role="alert">{settleError}</p>}
          <p className="sb-info-note" style={{ fontSize: 13 }}>
            {t('payOcean.settle_body')} <strong><bdi dir="ltr">Dr 2360 / Cr {t('payOcean.bank')}</bdi></strong>. {t('payOcean.settle_adjust')}
          </p>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Input label={t('payOcean.f_gratuity_amount')} dir="ltr" type="number" min="0" step="0.01" value={settleAmount} onChange={e => setSettleAmount(e.target.value)} />
            <Input label={t('payOcean.f_settle_date')} type="date" value={settleDate} onChange={e => setSettleDate(e.target.value)} />
            <div className="sm:col-span-2">
              <Select label={t('payOcean.f_pay_from')} value={settleBankId} onChange={e => setSettleBankId(e.target.value)}
                options={[{ value: '', label: t('payOcean.select_bank') }, ...banks.map(b => ({ value: b.id, label: b.name }))]} />
            </div>
          </div>
          <div className="flex justify-end gap-2 pt-1">
            <Button variant="ghost" onClick={() => setSettleEmp(null)} disabled={settleMutation.isPending}>{t('common.cancel')}</Button>
            <Button onClick={() => settleMutation.mutate()}
              disabled={settleMutation.isPending || !settleBankId || !(parseFloat(settleAmount) > 0)}>
              {settleMutation.isPending ? t('payOcean.posting') : t('payOcean.pay_and_leave')}
            </Button>
          </div>
        </div>
      </Modal>
    </OceanPage>
  );
}
