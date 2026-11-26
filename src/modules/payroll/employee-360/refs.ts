/**
 * Employee 360 — the lists the page needs (branches, warehouses, team, logins,
 * roles, sales roles, approvers) and the "Connected to" summary built from them.
 * Login, role and approver details are admin-only (users.manage), exactly as
 * on the Team and Approvals pages; others see less, never an error.
 */
import { useQuery } from '@tanstack/react-query';
import type { TFunction } from 'i18next';
import { getAdapter } from '@/data/index';
import type {
  ApprovalAuthority, BranchRow, EmployeeRow, Profile, RoleRow, SalespersonRow, TeamMember, WarehouseRow,
} from '@/data/adapter';
import { personLabel } from '../../settings/team/team-lists';
import { expiryState, type Draft } from './draft';
import type { Connection } from './id-card';

export interface EmployeeRefs {
  ready: boolean;
  branches: BranchRow[]; warehouses: WarehouseRow[]; team: TeamMember[];
  users: Profile[]; roles: RoleRow[]; authorities: ApprovalAuthority[] | null;
  bankNames: string[];
  salesRoleOf: (employee_id: string) => SalespersonRow | undefined;
}

export function useEmployeeRefs(company_id: string | null, canManage: boolean): EmployeeRefs {
  const on = !!company_id;
  const a = getAdapter;
  const branches = useQuery<BranchRow[]>({ queryKey: ['e360-branches', company_id], queryFn: () => a().branches.list(company_id!), enabled: on });
  const warehouses = useQuery<WarehouseRow[]>({ queryKey: ['e360-warehouses', company_id], queryFn: () => a().warehouses.list(company_id!), enabled: on });
  const team = useQuery<TeamMember[]>({ queryKey: ['team', company_id], queryFn: () => a().team.list(true), enabled: on });
  const users = useQuery<Profile[]>({ queryKey: ['users', company_id], queryFn: () => a().users.listUsers(company_id!), enabled: on && canManage });
  const roles = useQuery<RoleRow[]>({ queryKey: ['e360-roles', company_id], queryFn: () => a().users.listRoles(), enabled: on && canManage });
  const appr = useQuery({ queryKey: ['e360-approvers', company_id], queryFn: () => a().approvals.config(), enabled: on && canManage });
  const sales = useQuery<SalespersonRow[]>({
    queryKey: ['salespeople', company_id, true],
    queryFn: () => a().salespeople.list(company_id!, { include_inactive: true }), enabled: on,
  });
  const staff = useQuery<EmployeeRow[]>({
    queryKey: ['employees', company_id, true],
    queryFn: () => a().employees.list(company_id!, { includeInactive: true }), enabled: on,
  });
  const salesRows = sales.data ?? [];
  const bankNames = [...new Set((staff.data ?? []).map((e) => (e.bank_name ?? '').trim()).filter(Boolean))].sort();
  return {
    ready: sales.isFetched,
    branches: branches.data ?? [], warehouses: warehouses.data ?? [], team: team.data ?? [],
    users: users.data ?? [], roles: roles.data ?? [],
    authorities: canManage ? (appr.data?.authorities ?? []) : null,
    bankNames,
    salesRoleOf: (id) => salesRows.find((s) => s.employee_id === id),
  };
}

export function roleNameOf(t: TFunction, user_id: string, refs: EmployeeRefs): string | null {
  if (!user_id) return null;
  const u = refs.users.find((x) => x.id === user_id);
  if (!u?.role) return null;
  const r = refs.roles.find((x) => x.key === u.role);
  if (!r) return u.role;
  return r.is_system ? t(`settingsPages.users.sys.${r.key}`, { defaultValue: r.name }) : r.name;
}

const amt = (n: number) => n.toLocaleString('en-US', { maximumFractionDigits: 0 });

export function buildConnections(t: TFunction, d: Draft, refs: EmployeeRefs, selfId: string | null,
  canManage: boolean, gcc: boolean): Connection[] {
  const out: Connection[] = [];
  const add = (key: string, label: string, value: string, state: Connection['state']) => out.push({ key, label, value, state });

  // Login and app role
  if (d.user_id) {
    const u = refs.users.find((x) => x.id === d.user_id);
    const role = roleNameOf(t, d.user_id, refs);
    add('login', t('teamOcean.login'), [u?.email ?? t('emp360.login_linked'), role].filter(Boolean).join(' · '), 'on');
  } else add('login', t('teamOcean.login'), t('teamOcean.no_login'), 'off');

  // Branch (only where the company has branches)
  if (refs.branches.length > 0) {
    const b = refs.branches.find((x) => x.id === d.branch_id);
    add('branch', t('emp360.f_branch'), b?.name ?? t('emp360.not_set'), b ? 'on' : 'warn');
  }

  // Reports to
  const me = selfId ? refs.team.find((m) => m.employee_id === selfId) : undefined;
  if (me && me.reports_to_id === null) add('manager', t('teamOcean.reports_to'), t('teamOcean.top'), 'on');
  else {
    const m = refs.team.find((x) => x.employee_id === d.reports_to_id);
    add('manager', t('teamOcean.reports_to'), m ? personLabel(m) : t('emp360.not_set'), m ? 'on' : selfId ? 'warn' : 'off');
  }

  // Work roles
  add('sales', t('staff.role_sales'), d.is_sales ? t('emp360.commission', { pct: d.commission_pct || '0' }) : t('emp360.off'), d.is_sales ? 'on' : 'off');
  add('purchasing', t('staff.role_purchasing'), d.is_purchaser ? t('emp360.on') : t('emp360.off'), d.is_purchaser ? 'on' : 'off');

  // Payroll
  if (!d.is_active || !d.include_in_payroll) add('payroll', t('emp360.conn_payroll'), t('emp360.off'), 'off');
  else if (gcc && d.pay_method === 'wps' && (!d.iban.trim() || !d.mol_id.trim()))
    add('payroll', t('emp360.conn_payroll'), t('emp360.wps_missing'), 'warn');
  else add('payroll', t('emp360.conn_payroll'), d.pay_method ? t(`emp360.pm_${d.pay_method}`) : t('emp360.on'), 'on');

  // Approvals (admins see who can approve)
  if (canManage && refs.authorities && selfId) {
    const mine = refs.authorities.filter((x) => x.employee_id === selfId);
    if (mine.length === 0) add('approver', t('emp360.conn_approver'), t('emp360.off'), 'off');
    else {
      const max = mine.some((x) => x.max_amount === null) ? null : Math.max(...mine.map((x) => Number(x.max_amount)));
      const problem = mine.find((x) => x.problem)?.problem;
      add('approver', t('emp360.conn_approver'),
        problem ? t('emp360.approver_problem') : max === null ? t('emp360.approver_any') : t('emp360.approver_upto', { amount: amt(max) }),
        problem ? 'warn' : 'on');
    }
  }

  // Documents
  const dates = [d.emirates_id_expiry, d.passport_expiry, ...(gcc ? [d.visa_expiry, d.labour_card_expiry] : [])];
  const st = dates.map((x) => expiryState(x));
  const expired = st.filter((x) => x === 'expired').length;
  const soon = st.filter((x) => x === 'soon').length;
  if (expired) add('documents', t('emp360.conn_documents'), t('emp360.docs_expired', { count: expired }), 'warn');
  else if (soon) add('documents', t('emp360.conn_documents'), t('emp360.docs_soon', { count: soon }), 'warn');
  else if (st.some((x) => x === 'ok')) add('documents', t('emp360.conn_documents'), t('emp360.docs_ok'), 'on');
  else add('documents', t('emp360.conn_documents'), t('emp360.exp_none'), 'off');
  return out;
}
