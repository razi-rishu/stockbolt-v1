/**
 * Employee 360 — the form sections on the right: identity, placement, access
 * and work roles, pay, and status / notes. Pure inputs over the draft; saving
 * happens in the page.
 */
import { useTranslation } from 'react-i18next';
import { Banknote, Building2, IdCard as IdIcon, ShieldCheck, StickyNote } from 'lucide-react';
import { Input } from '@/ui/input';
import { Select } from '@/ui/select';
import type { BranchRow, Profile, TeamMember, WarehouseRow } from '@/data/adapter';
import { DEPARTMENTS, JOB_TITLES, personLabel } from '../../settings/team/team-lists';
import { EMPLOYMENT_TYPES, GENDERS, MARITAL, PAY_METHODS, packageOf, type Draft } from './draft';

export type SetField = (key: keyof Draft, value: string | boolean) => void;
interface Base { draft: Draft; set: SetField; readOnly: boolean }

const fmt = (n: number) => n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

function Check({ label, checked, onChange, disabled, testid, hint }: {
  label: string; checked: boolean; onChange: (v: boolean) => void; disabled?: boolean; testid?: string; hint?: string;
}) {
  return (
    <label className="sb-e360-check" title={hint}>
      <input type="checkbox" checked={checked} disabled={disabled} data-testid={testid}
        onChange={(e) => onChange(e.target.checked)} />
      <span>{label}</span>
    </label>
  );
}

export function IdentitySection({ draft, set, readOnly, arabicOn }: Base & { arabicOn: boolean }) {
  const { t } = useTranslation();
  const f = (k: keyof Draft) => (e: React.ChangeEvent<HTMLInputElement>) => set(k, e.target.value);
  return (
    <section className="sb-card sb-e360-card">
      <p className="sb-e360-sec"><IdIcon size={16} aria-hidden="true" /> {t('emp360.sec_identity')}</p>
      <div className="sb-e360-grid">
        <Input label={t('payOcean.f_name')} required autoFocus value={draft.name} onChange={f('name')} disabled={readOnly} data-testid="e360-name" />
        {arabicOn && <Input label={t('payOcean.f_name_ar')} dir="rtl" value={draft.name_ar} onChange={f('name_ar')} disabled={readOnly} />}
        <Input label={t('payOcean.f_code')} dir="ltr" value={draft.code} onChange={f('code')} disabled={readOnly} />
        <Input label={t('payOcean.f_phone')} dir="ltr" type="tel" value={draft.phone} onChange={f('phone')} disabled={readOnly} />
        <Input label={t('payOcean.f_email')} dir="ltr" type="email" value={draft.email} onChange={f('email')} disabled={readOnly} />
        <Input label={t('emp360.f_nationality')} value={draft.nationality} onChange={f('nationality')} disabled={readOnly} />
        <Input label={t('emp360.f_dob')} type="date" value={draft.date_of_birth} onChange={f('date_of_birth')} disabled={readOnly} />
        <Select label={t('emp360.f_gender')} value={draft.gender} disabled={readOnly}
          onChange={(e) => set('gender', e.target.value)}
          options={[{ value: '', label: t('emp360.not_set') }, ...GENDERS.map((k) => ({ value: k, label: t(`emp360.g_${k}`) }))]} />
        <Select label={t('emp360.f_marital')} value={draft.marital_status} disabled={readOnly}
          onChange={(e) => set('marital_status', e.target.value)}
          options={[{ value: '', label: t('emp360.not_set') }, ...MARITAL.map((k) => ({ value: k, label: t(`emp360.ms_${k}`) }))]} />
        <Input label={t('emp360.f_emergency_name')} value={draft.emergency_contact_name} onChange={f('emergency_contact_name')} disabled={readOnly} />
        <Input label={t('emp360.f_emergency_phone')} dir="ltr" type="tel" value={draft.emergency_contact_phone} onChange={f('emergency_contact_phone')} disabled={readOnly} />
      </div>
      <div style={{ marginTop: 12 }}>
        <Input label={t('emp360.f_address')} value={draft.address} onChange={f('address')} disabled={readOnly} />
      </div>
    </section>
  );
}

export function PlacementSection({ draft, set, readOnly, branches, warehouses, team, selfId, canManage }: Base & {
  branches: BranchRow[]; warehouses: WarehouseRow[]; team: TeamMember[]; selfId: string | null; canManage: boolean;
}) {
  const { t } = useTranslation();
  const f = (k: keyof Draft) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => set(k, e.target.value);
  const managers = team.filter((m) => m.is_active && m.employee_id !== selfId);
  const isTop = !!selfId && team.find((m) => m.employee_id === selfId)?.reports_to_id === null;
  return (
    <section className="sb-card sb-e360-card">
      <p className="sb-e360-sec"><Building2 size={16} aria-hidden="true" /> {t('emp360.sec_placement')}</p>
      <div className="sb-e360-grid">
        {branches.length > 0 && (
          <Select label={t('emp360.f_branch')} value={draft.branch_id} onChange={f('branch_id')} disabled={readOnly}
            options={[{ value: '', label: t('emp360.not_set') }, ...branches.filter((b) => b.is_active || b.id === draft.branch_id).map((b) => ({ value: b.id, label: b.name }))]} />
        )}
        <Select label={t('emp360.f_warehouse')} value={draft.warehouse_id} onChange={f('warehouse_id')} disabled={readOnly}
          options={[{ value: '', label: t('emp360.not_set') }, ...warehouses.filter((w) => w.is_active || w.id === draft.warehouse_id).map((w) => ({ value: w.id, label: w.name }))]} />
        {isTop ? (
          <Input label={t('teamOcean.reports_to')} value={t('teamOcean.top_no_manager')} disabled />
        ) : (
          <Select label={t('teamOcean.reports_to')} value={draft.reports_to_id} onChange={f('reports_to_id')}
            disabled={readOnly || !canManage}
            options={[{ value: '', label: selfId ? t('emp360.not_set') : t('emp360.reports_default') },
              ...managers.map((m) => ({ value: m.employee_id, label: personLabel(m) }))]} />
        )}
        <Input label={t('payOcean.col_designation')} list="e360-titles" value={draft.designation} onChange={f('designation')} disabled={readOnly} />
        <Input label={t('staff.f_department')} list="e360-depts" value={draft.department} onChange={f('department')} disabled={readOnly} />
        <Select label={t('emp360.f_employment_type')} value={draft.employment_type} onChange={f('employment_type')} disabled={readOnly}
          options={[{ value: '', label: t('emp360.not_set') }, ...EMPLOYMENT_TYPES.map((k) => ({ value: k, label: t(`emp360.et_${k}`) }))]} />
        <Input label={t('payOcean.f_joining')} type="date" value={draft.joining_date} onChange={f('joining_date')} disabled={readOnly} />
        <Input label={t('emp360.f_probation_end')} type="date" value={draft.probation_end} onChange={f('probation_end')} disabled={readOnly} />
        <Input label={t('emp360.f_confirmation')} type="date" value={draft.confirmation_date} onChange={f('confirmation_date')} disabled={readOnly} />
        <Input label={t('emp360.f_contract_start')} type="date" value={draft.contract_start} onChange={f('contract_start')} disabled={readOnly} />
        <Input label={t('emp360.f_contract_end')} type="date" value={draft.contract_end} onChange={f('contract_end')} disabled={readOnly} />
      </div>
      {draft.contract_start && draft.contract_end && draft.contract_end < draft.contract_start && (
        <p className="sb-e360-err" role="alert">{t('emp360.contract_order')}</p>
      )}
      <datalist id="e360-titles">{JOB_TITLES.map((x) => <option key={x.key} value={x.en} />)}</datalist>
      <datalist id="e360-depts">{DEPARTMENTS.map((x) => <option key={x.key} value={x.en} />)}</datalist>
      {!canManage && <p className="sb-e360-muted">{t('emp360.manager_admin_only')}</p>}
    </section>
  );
}

export function AccessSection({ draft, set, readOnly, users, team, selfId, canManage, roleName }: Base & {
  users: Profile[]; team: TeamMember[]; selfId: string | null; canManage: boolean; roleName: string | null;
}) {
  const { t } = useTranslation();
  const linkedTo = new Map(team.filter((m) => m.user_id).map((m) => [m.user_id!, m]));
  return (
    <section className="sb-card sb-e360-card">
      <p className="sb-e360-sec"><ShieldCheck size={16} aria-hidden="true" /> {t('emp360.sec_access')}</p>
      <div className="sb-e360-grid">
        {canManage ? (
          <label className="sb-gc-field">
            <span className="sb-gc-label">{t('teamOcean.login')}</span>
            <select className="sb-team-select" value={draft.user_id} disabled={readOnly} data-testid="e360-login"
              onChange={(e) => set('user_id', e.target.value)}>
              <option value="">{t('teamOcean.no_login')}</option>
              {users.filter((u) => u.is_active || u.id === draft.user_id).map((u) => {
                const other = linkedTo.get(u.id);
                const note = other && other.employee_id !== selfId ? ` (${t('teamOcean.now_linked_to', { who: personLabel(other) })})` : '';
                return <option key={u.id} value={u.id}>{`${u.full_name || u.email} · ${u.email}${note}`}</option>;
              })}
            </select>
          </label>
        ) : (
          <Input label={t('teamOcean.login')} value={draft.user_id ? t('emp360.login_linked') : t('teamOcean.no_login')} disabled />
        )}
        <Input label={t('emp360.f_app_role')} value={roleName ?? '—'} disabled />
      </div>
      <p className="sb-e360-muted">{t('emp360.access_hint')}</p>
      <div className="sb-e360-roles">
        <Check label={t('staff.role_sales')} checked={draft.is_sales} disabled={readOnly} testid="e360-sales"
          onChange={(v) => set('is_sales', v)} />
        {draft.is_sales && (
          <div style={{ width: 150 }}>
            <Input label={t('staff.f_commission')} dir="ltr" type="number" min="0" max="100" step="0.01" disabled={readOnly}
              value={draft.commission_pct} onChange={(e) => set('commission_pct', e.target.value)} />
          </div>
        )}
        <Check label={t('staff.role_purchasing')} checked={draft.is_purchaser} disabled={readOnly} testid="e360-purchaser"
          onChange={(v) => set('is_purchaser', v)} />
      </div>
    </section>
  );
}

export function PaySection({ draft, set, readOnly, gcc, banks }: Base & { gcc: boolean; banks: string[] }) {
  const { t } = useTranslation();
  const f = (k: keyof Draft) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => set(k, e.target.value);
  const methods = PAY_METHODS.filter((m) => gcc || m !== 'wps');
  const bankPaid = draft.pay_method === '' || draft.pay_method === 'wps' || draft.pay_method === 'bank';
  return (
    <section className="sb-card sb-e360-card">
      <p className="sb-e360-sec"><Banknote size={16} aria-hidden="true" /> {t('emp360.sec_pay')}
        <span className="sb-pill sb-pill-muted">{t('emp360.payroll_only')}</span></p>
      <div className="sb-e360-grid sb-e360-grid-4">
        <Input label={t('payOcean.col_basic')} dir="ltr" type="number" min="0" step="0.01" value={draft.basic_salary} onChange={f('basic_salary')} disabled={readOnly} />
        <Input label={t('payOcean.f_housing')} dir="ltr" type="number" min="0" step="0.01" value={draft.housing_allowance} onChange={f('housing_allowance')} disabled={readOnly} />
        <Input label={t('payOcean.f_transport')} dir="ltr" type="number" min="0" step="0.01" value={draft.transport_allowance} onChange={f('transport_allowance')} disabled={readOnly} />
        <Input label={t('payOcean.f_other')} dir="ltr" type="number" min="0" step="0.01" value={draft.other_allowance} onChange={f('other_allowance')} disabled={readOnly} />
      </div>
      <p className="sb-pay-package">
        <span>{t('payOcean.package_month')}</span>
        <bdi dir="ltr" className="sb-dash-num">{fmt(packageOf(draft))}</bdi>
      </p>
      <div className="sb-e360-grid">
        <Select label={t('emp360.f_pay_method')} value={draft.pay_method} onChange={f('pay_method')} disabled={readOnly}
          options={[{ value: '', label: t('emp360.not_set') }, ...methods.map((k) => ({ value: k, label: t(`emp360.pm_${k}`) }))]} />
        {bankPaid && <Input label={t('payOcean.f_bank_name')} list="e360-banks" value={draft.bank_name} onChange={f('bank_name')} disabled={readOnly} />}
        {bankPaid && <Input label={t('payOcean.f_iban')} dir="ltr" placeholder={gcc ? 'AE..' : ''} value={draft.iban} onChange={f('iban')} disabled={readOnly} />}
        {gcc && bankPaid && <Input label={t('payOcean.f_mol_id')} dir="ltr" value={draft.mol_id} onChange={f('mol_id')} disabled={readOnly} />}
        {gcc && bankPaid && <Input label={t('payOcean.f_routing')} dir="ltr" placeholder={t('payOcean.f_routing_ph')} value={draft.bank_routing_code} onChange={f('bank_routing_code')} disabled={readOnly} />}
      </div>
      <datalist id="e360-banks">{banks.map((b) => <option key={b} value={b} />)}</datalist>
    </section>
  );
}

export function StatusSection({ draft, set, readOnly }: Base) {
  const { t } = useTranslation();
  return (
    <section className="sb-card sb-e360-card">
      <p className="sb-e360-sec"><StickyNote size={16} aria-hidden="true" /> {t('emp360.sec_status')}</p>
      <div className="sb-e360-roles">
        <Check label={t('payOcean.f_active')} checked={draft.is_active} disabled={readOnly} testid="e360-active"
          onChange={(v) => set('is_active', v)} />
        <Check label={t('teamOcean.in_payroll')} hint={t('teamOcean.in_payroll_hint')} checked={draft.include_in_payroll}
          disabled={readOnly} testid="e360-in-payroll" onChange={(v) => set('include_in_payroll', v)} />
      </div>
      <label className="sb-gc-field" style={{ marginTop: 10 }}>
        <span className="sb-gc-label">{t('emp360.f_notes')}</span>
        <textarea className="sb-e360-notes" rows={3} value={draft.notes} disabled={readOnly}
          placeholder={t('emp360.notes_ph')} onChange={(e) => set('notes', e.target.value)} />
      </label>
    </section>
  );
}
