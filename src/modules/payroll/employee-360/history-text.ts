/**
 * Employee 360 — one readable line per employment history event (phase164).
 * Pure; unit-tested.
 */
import type { TFunction } from 'i18next';
import type { EmployeeEventRow } from '@/data/adapter';
import { personLabel } from '../../settings/team/team-lists';
import type { EmployeeRefs } from './refs';

const fmt = (n: unknown) => Number(n ?? 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
type J = Record<string, unknown> | string | number | boolean | null;

/** One readable line for an event. Ids become names; missing values show as a dash. */
export function describeEvent(t: TFunction, ev: Pick<EmployeeEventRow, 'event_type' | 'old_value' | 'new_value'>, refs: Pick<EmployeeRefs, 'branches' | 'warehouses' | 'team'>): string {
  const o = ev.old_value as J; const n = ev.new_value as J;
  const dash = '—';
  const name = (kind: 'branch' | 'warehouse' | 'manager', id: J) => {
    if (!id) return dash;
    if (kind === 'branch') return refs.branches.find((b) => b.id === id)?.name ?? dash;
    if (kind === 'warehouse') return refs.warehouses.find((w) => w.id === id)?.name ?? dash;
    const m = refs.team.find((x) => x.employee_id === id); return m ? personLabel(m) : dash;
  };
  const txt = (v: J) => (v === null || v === undefined || v === '' ? dash : String(v));
  const type = (v: J) => (v ? t(`emp360.et_${String(v)}`, { defaultValue: String(v) }) : dash);
  const obj = (v: J) => (v && typeof v === 'object' ? v as Record<string, unknown> : {});
  switch (ev.event_type) {
    case 'baseline': return t('emp360.ev_baseline');
    case 'joined': return t('emp360.ev_joined', { branch: name('branch', obj(n).branch_id as J), title: txt(obj(n).designation as J) });
    case 'branch': return t('emp360.ev_branch', { from: name('branch', o), to: name('branch', n) });
    case 'warehouse': return t('emp360.ev_warehouse', { from: name('warehouse', o), to: name('warehouse', n) });
    case 'department': return t('emp360.ev_department', { from: txt(o), to: txt(n) });
    case 'designation': return t('emp360.ev_designation', { from: txt(o), to: txt(n) });
    case 'manager': return t('emp360.ev_manager', { from: name('manager', o), to: name('manager', n) });
    case 'employment_type': return t('emp360.ev_type', { from: type(o), to: type(n) });
    case 'status': return n === true ? t('emp360.ev_reactivated') : t('emp360.ev_deactivated');
    case 'salary': return t('emp360.ev_salary', { from: fmt(obj(o).basic_salary), to: fmt(obj(n).basic_salary) });
    case 'probation': return t('emp360.ev_probation', { end: txt(obj(n).probation_end as J), confirmed: txt(obj(n).confirmation_date as J) });
    case 'contract': return t('emp360.ev_contract', { start: txt(obj(n).contract_start as J), end: txt(obj(n).contract_end as J) });
    default: return ev.event_type;
  }
}
