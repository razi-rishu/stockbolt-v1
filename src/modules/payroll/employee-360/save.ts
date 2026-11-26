/**
 * Employee 360 — save in the same order and through the same functions as the
 * old popup: the row, then work roles (staff functions, phase129), then
 * manager and login (Team functions, phase144 — admins only).
 */
import { getAdapter } from '@/data/index';
import type { EmployeeRow } from '@/data/adapter';
import { toRow, type Draft } from './draft';
import type { EmployeeRefs } from './refs';

export async function saveEmployee({ draft, before, company_id, canManage, refs }: {
  draft: Draft; before: EmployeeRow | null; company_id: string; canManage: boolean; refs: EmployeeRefs;
}): Promise<string> {
  if (!draft.name.trim()) throw new Error('err_name');
  const api = getAdapter();
  const row = toRow(draft, company_id);

  let id: string;
  let managerNow: string | null;
  if (before) {
    await api.employees.update(before.id, row);
    id = before.id;
    managerNow = before.reports_to_id;
  } else {
    const created = await api.employees.create(row);
    id = created.id;
    managerNow = created.reports_to_id;   // the server places a new person under the top
  }

  // Work roles — only what changed; an inactive person cannot be given a role.
  const sp = before ? refs.salesRoleOf(before.id) : undefined;
  const pct = Math.min(100, Math.max(0, parseFloat(draft.commission_pct) || 0));
  const wasSales = !!sp?.is_active;
  if (draft.is_active && draft.is_sales && (!wasSales || Number(sp?.commission_pct ?? 0) !== pct))
    await api.staff.assignRole(id, 'sales', true, pct);
  if (!draft.is_sales && wasSales) await api.staff.assignRole(id, 'sales', false);
  const wasBuyer = !!before?.is_purchaser;
  if (draft.is_active && draft.is_purchaser !== wasBuyer) await api.staff.assignRole(id, 'purchasing', draft.is_purchaser);
  if (!draft.is_active && !draft.is_purchaser && wasBuyer) await api.staff.assignRole(id, 'purchasing', false);

  // Team links (admins). The server refuses loops and logins from elsewhere.
  if (canManage) {
    if (draft.reports_to_id && draft.reports_to_id !== managerNow) await api.team.setManager(id, draft.reports_to_id);
    if (draft.user_id !== (before?.user_id ?? '')) await api.team.linkUser(id, draft.user_id || null);
  }
  return id;
}
