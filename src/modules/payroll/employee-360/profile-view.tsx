/**
 * Employee 360 — the read-only profile (the default when an employee is
 * opened). Nothing here can change the record; editing needs the Edit button.
 * Sections show only what is stored today: attendance, leave requests,
 * performance and assets are not built yet, so they are not shown empty.
 */
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { Banknote, Building2, CalendarClock, History, IdCard as IdIcon, Phone, ShieldCheck, StickyNote, Wallet } from 'lucide-react';
import { getAdapter } from '@/data/index';
import type { EmployeePayLine, EmployeeRow, LeaveSalaryRow } from '@/data/adapter';
import { personLabel } from '../../settings/team/team-lists';
import { daysUntil, expiryState, packageOf, type Draft } from './draft';
import { roleNameOf, type EmployeeRefs } from './refs';
import { Timeline } from './timeline';

const fmt = (n: number) => n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const mask = (v: string) => (v.length > 4 ? `•••• ${v.slice(-4)}` : v);

function Field({ label, value, ltr }: { label: string; value: React.ReactNode; ltr?: boolean }) {
  const empty = value === '' || value === null || value === undefined;
  return (
    <div className="sb-e360-field">
      <dt>{label}</dt>
      <dd className={empty ? 'is-empty' : undefined}>{empty ? '—' : ltr ? <bdi dir="ltr">{value}</bdi> : value}</dd>
    </div>
  );
}

function Card({ icon, title, children, testid }: { icon: React.ReactNode; title: string; children: React.ReactNode; testid?: string }) {
  return (
    <section className="sb-card sb-e360-card" data-testid={testid}>
      <p className="sb-e360-sec">{icon} {title}</p>
      {children}
    </section>
  );
}

export function ProfileView({ draft, emp, refs, service, gcc, idLabel, canManage }: {
  draft: Draft; emp: EmployeeRow; refs: EmployeeRefs; service: string; gcc: boolean; idLabel: string; canManage: boolean;
}) {
  const { t } = useTranslation();
  const payQ = useQuery<EmployeePayLine[]>({
    queryKey: ['employee-pay', emp.id],
    queryFn: () => getAdapter().employees.payrollHistory(emp.id),
  });
  const leaveQ = useQuery<LeaveSalaryRow[]>({
    queryKey: ['leave_salary', emp.company_id],
    queryFn: () => getAdapter().payroll.listLeaveSalary(emp.company_id),
  });
  const leave = (leaveQ.data ?? []).filter((l) => l.employee_id === emp.id);

  const branch = refs.branches.find((b) => b.id === draft.branch_id)?.name;
  const wh = refs.warehouses.find((w) => w.id === draft.warehouse_id)?.name;
  const mgr = refs.team.find((m) => m.employee_id === draft.reports_to_id);
  const isTop = refs.team.find((m) => m.employee_id === emp.id)?.reports_to_id === null;
  const login = draft.user_id ? (refs.users.find((u) => u.id === draft.user_id)?.email ?? t('emp360.login_linked')) : t('teamOcean.no_login');
  const docs: { key: string; label: string; no: string; exp: string }[] = [
    { key: 'emirates_id', label: idLabel, no: draft.emirates_id, exp: draft.emirates_id_expiry },
    { key: 'passport', label: t('emp360.doc_passport'), no: draft.passport_no, exp: draft.passport_expiry },
    ...(gcc ? [
      { key: 'visa', label: t('emp360.doc_visa'), no: draft.visa_no, exp: draft.visa_expiry },
      { key: 'labour_card', label: t('emp360.doc_labour_card'), no: draft.labour_card_no, exp: draft.labour_card_expiry },
    ] : []),
  ];

  return (
    <div className="sb-e360-main" data-testid="e360-profile">
      <Card icon={<IdIcon size={16} aria-hidden="true" />} title={t('emp360.sec_personal')}>
        <dl className="sb-e360-dl">
          <Field label={t('payOcean.f_name')} value={draft.name} />
          {draft.name_ar && <Field label={t('payOcean.f_name_ar')} value={<span dir="rtl">{draft.name_ar}</span>} />}
          <Field label={t('payOcean.f_code')} value={draft.code} ltr />
          <Field label={t('emp360.f_nationality')} value={draft.nationality} />
          <Field label={t('emp360.f_dob')} value={draft.date_of_birth} ltr />
          <Field label={t('emp360.f_gender')} value={draft.gender ? t(`emp360.g_${draft.gender}`) : ''} />
          <Field label={t('emp360.f_marital')} value={draft.marital_status ? t(`emp360.ms_${draft.marital_status}`) : ''} />
        </dl>
      </Card>

      <Card icon={<Phone size={16} aria-hidden="true" />} title={t('emp360.sec_contact')}>
        <dl className="sb-e360-dl">
          <Field label={t('payOcean.f_phone')} value={draft.phone} ltr />
          <Field label={t('payOcean.f_email')} value={draft.email} ltr />
          <Field label={t('emp360.f_emergency_name')} value={draft.emergency_contact_name} />
          <Field label={t('emp360.f_emergency_phone')} value={draft.emergency_contact_phone} ltr />
          <Field label={t('emp360.f_address')} value={draft.address} />
        </dl>
      </Card>

      <Card icon={<Building2 size={16} aria-hidden="true" />} title={t('emp360.sec_employment')}>
        <dl className="sb-e360-dl">
          {refs.branches.length > 0 && <Field label={t('emp360.f_branch')} value={branch} />}
          <Field label={t('emp360.f_warehouse')} value={wh} />
          <Field label={t('staff.f_department')} value={draft.department} />
          <Field label={t('payOcean.col_designation')} value={draft.designation} />
          <Field label={t('teamOcean.reports_to')} value={isTop ? t('teamOcean.top') : mgr ? personLabel(mgr) : ''} />
          <Field label={t('emp360.f_employment_type')} value={draft.employment_type ? t(`emp360.et_${draft.employment_type}`) : ''} />
          <Field label={t('payOcean.f_joining')} value={draft.joining_date} ltr />
          <Field label={t('payOcean.col_service')} value={service === '—' ? '' : service} />
          <Field label={t('emp360.f_status')} value={draft.is_active ? t('common.active') : t('payOcean.inactive')} />
          <Field label={t('emp360.f_probation_end')} value={draft.probation_end} ltr />
          <Field label={t('emp360.f_confirmation')} value={draft.confirmation_date} ltr />
          <Field label={t('emp360.f_contract_start')} value={draft.contract_start} ltr />
          <Field label={t('emp360.f_contract_end')} value={draft.contract_end} ltr />
        </dl>
      </Card>

      <Card icon={<ShieldCheck size={16} aria-hidden="true" />} title={t('emp360.sec_access')}>
        <dl className="sb-e360-dl">
          <Field label={t('teamOcean.login')} value={canManage || !draft.user_id ? login : t('emp360.login_linked')} />
          <Field label={t('emp360.f_app_role')} value={roleNameOf(t, draft.user_id, refs) ?? ''} />
          <Field label={t('staff.role_sales')} value={draft.is_sales ? t('emp360.commission', { pct: draft.commission_pct || '0' }) : t('emp360.off')} />
          <Field label={t('staff.role_purchasing')} value={draft.is_purchaser ? t('emp360.on') : t('emp360.off')} />
          <Field label={t('teamOcean.in_payroll')} value={draft.include_in_payroll ? t('emp360.on') : t('emp360.off')} />
        </dl>
      </Card>

      <Card icon={<Banknote size={16} aria-hidden="true" />} title={t('emp360.sec_pay')} testid="e360-profile-pay">
        <dl className="sb-e360-dl">
          <Field label={t('payOcean.col_basic')} value={fmt(Number(draft.basic_salary) || 0)} ltr />
          <Field label={t('payOcean.f_housing')} value={fmt(Number(draft.housing_allowance) || 0)} ltr />
          <Field label={t('payOcean.f_transport')} value={fmt(Number(draft.transport_allowance) || 0)} ltr />
          <Field label={t('payOcean.f_other')} value={fmt(Number(draft.other_allowance) || 0)} ltr />
          <Field label={t('payOcean.package_month')} value={<strong>{fmt(packageOf(draft))}</strong>} ltr />
          <Field label={t('emp360.f_pay_method')} value={draft.pay_method ? t(`emp360.pm_${draft.pay_method}`) : ''} />
          <Field label={t('payOcean.f_bank_name')} value={draft.bank_name} />
          <Field label={t('payOcean.f_iban')} value={draft.iban ? mask(draft.iban) : ''} ltr />
          {gcc && <Field label={t('payOcean.f_mol_id')} value={draft.mol_id} ltr />}
        </dl>
      </Card>

      <Card icon={<CalendarClock size={16} aria-hidden="true" />} title={t('emp360.sec_documents')} testid="e360-profile-docs">
        <ul className="sb-e360-doclist">
          {docs.map((d) => {
            const st = expiryState(d.exp);
            const days = daysUntil(d.exp);
            return (
              <li key={d.key} data-state={st}>
                <span className="sb-e360-doc-name">{d.label}</span>
                <bdi dir="ltr" className="sb-e360-muted">{d.no || '—'}</bdi>
                <span className={`sb-e360-doc-when is-${st}`}>
                  {st === 'none' ? t('emp360.exp_none')
                    : st === 'expired' ? t('emp360.exp_expired', { count: -days! })
                    : st === 'soon' ? t('emp360.exp_soon', { count: days! })
                    : <bdi dir="ltr">{d.exp}</bdi>}
                </span>
              </li>
            );
          })}
        </ul>
        <p className="sb-e360-muted">{t('emp360.files_in_edit')}</p>
      </Card>

      <Card icon={<Wallet size={16} aria-hidden="true" />} title={t('emp360.sec_payroll_history')} testid="e360-profile-payroll">
        {(payQ.data ?? []).length === 0
          ? <p className="sb-e360-muted">{payQ.isLoading ? t('common.loading') : t('emp360.payroll_none')}</p>
          : (
            <div className="sb-e360-table-wrap">
              <table className="sb-e360-table">
                <thead><tr>
                  <th>{t('emp360.col_period')}</th><th>{t('emp360.col_run')}</th>
                  <th className="is-num">{t('payOcean.col_gross')}</th><th className="is-num">{t('payOcean.col_deductions')}</th>
                  <th className="is-num">{t('payOcean.col_net')}</th><th>{t('emp360.col_status')}</th>
                </tr></thead>
                <tbody>
                  {(payQ.data ?? []).map((l) => {
                    const gross = l.basic_salary + l.housing_allowance + l.transport_allowance + l.other_allowance + l.overtime + l.bonus;
                    const ded = l.deductions + l.loan_repayment;
                    return (
                      <tr key={l.id}>
                        <td><bdi dir="ltr">{`${l.period_year}-${String(l.period_month).padStart(2, '0')}`}</bdi></td>
                        <td><Link to={`/payroll/runs/${l.run_id}`} className="sb-e360-link"><bdi dir="ltr">{l.run_number}</bdi></Link></td>
                        <td className="is-num"><bdi dir="ltr">{fmt(gross)}</bdi></td>
                        <td className="is-num"><bdi dir="ltr">{fmt(ded)}</bdi></td>
                        <td className="is-num"><bdi dir="ltr">{fmt(gross - ded)}</bdi></td>
                        <td><span className="sb-pill sb-pill-muted">{t(`emp360.run_${l.run_status}`, { defaultValue: l.run_status })}</span></td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
      </Card>

      <Card icon={<History size={16} aria-hidden="true" />} title={t('emp360.sec_leave_history')} testid="e360-profile-leave">
        {leave.length === 0
          ? <p className="sb-e360-muted">{leaveQ.isLoading ? t('common.loading') : t('emp360.leave_none')}</p>
          : (
            <div className="sb-e360-table-wrap">
              <table className="sb-e360-table">
                <thead><tr>
                  <th>{t('emp360.col_from')}</th><th>{t('emp360.col_to')}</th><th className="is-num">{t('payOcean.days')}</th>
                  <th className="is-num">{t('emp360.col_amount')}</th><th>{t('emp360.col_status')}</th>
                </tr></thead>
                <tbody>
                  {leave.map((l) => (
                    <tr key={l.id}>
                      <td><bdi dir="ltr">{l.leave_from ?? '—'}</bdi></td>
                      <td><bdi dir="ltr">{l.leave_to ?? '—'}</bdi></td>
                      <td className="is-num"><bdi dir="ltr">{Number(l.days)}</bdi></td>
                      <td className="is-num"><bdi dir="ltr">{fmt(Number(l.amount))}</bdi></td>
                      <td><span className="sb-pill sb-pill-muted">{t(`emp360.run_${l.status}`, { defaultValue: l.status })}</span></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        <p className="sb-e360-muted">{t('emp360.leave_note')}</p>
      </Card>

      <Timeline employeeId={emp.id} refs={refs} />

      {draft.notes.trim() && (
        <Card icon={<StickyNote size={16} aria-hidden="true" />} title={t('emp360.f_notes')}>
          <p className="sb-e360-notes-view">{draft.notes}</p>
        </Card>
      )}
    </div>
  );
}
