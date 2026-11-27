/**
 * Employee directory helpers (phase164, HRMS H1): filtering, export columns
 * and the import template. Pure functions, unit-tested.
 */
import type { EmployeeRow } from '@/data/adapter';
import { expiryState } from './employee-360/draft';

export interface DirectoryFilter {
  search: string;
  branch_id: string;        // '' all, '__none' no branch
  department: string;       // '' all
  employment_type: string;  // '' all
  status: 'active' | 'inactive' | 'all';
  docs: boolean;            // only expired / due documents
}
export const emptyFilter: DirectoryFilter = { search: '', branch_id: '', department: '', employment_type: '', status: 'active', docs: false };

export const PAGE_SIZE = 50;

/** Worst document state for the given employee: expired beats soon. */
export function docState(e: EmployeeRow, gcc: boolean, today = new Date()): 'expired' | 'soon' | null {
  const st = [e.emirates_id_expiry, e.passport_expiry, ...(gcc ? [e.visa_expiry, e.labour_card_expiry] : [])]
    .map((d) => expiryState(d ?? '', today));
  return st.includes('expired') ? 'expired' : st.includes('soon') ? 'soon' : null;
}

export function filterEmployees(rows: EmployeeRow[], f: DirectoryFilter, gcc: boolean, today = new Date()): EmployeeRow[] {
  const q = f.search.trim().toLowerCase();
  return rows.filter((e) => {
    if (f.status === 'active' && !e.is_active) return false;
    if (f.status === 'inactive' && e.is_active) return false;
    if (f.branch_id === '__none' ? !!e.branch_id : f.branch_id && e.branch_id !== f.branch_id) return false;
    if (f.department && (e.department ?? '') !== f.department) return false;
    if (f.employment_type && (e.employment_type ?? '') !== f.employment_type) return false;
    if (f.docs && !docState(e, gcc, today)) return false;
    if (!q) return true;
    return [e.name, e.name_ar, e.code, e.phone, e.email, e.designation, e.department]
      .some((v) => (v ?? '').toLowerCase().includes(q));
  });
}

/** Columns shared by export and the import template, in this order. */
export const IMPORT_COLUMNS = [
  'code', 'name', 'name_ar', 'phone', 'email', 'designation', 'department', 'branch', 'warehouse',
  'employment_type', 'joining_date', 'gender', 'nationality',
  'basic_salary', 'housing_allowance', 'transport_allowance', 'other_allowance', 'manager_code',
] as const;

/** Rows for export: same columns as the template (names, not ids), plus status. */
export function toExportRows(rows: EmployeeRow[], branchName: (id: string | null) => string, whName: (id: string | null) => string,
  codeOf: (id: string | null) => string): Record<string, unknown>[] {
  return rows.map((e) => ({
    code: e.code ?? '', name: e.name, name_ar: e.name_ar ?? '', phone: e.phone ?? '', email: e.email ?? '',
    designation: e.designation ?? '', department: e.department ?? '', branch: branchName(e.branch_id),
    warehouse: whName(e.warehouse_id), employment_type: e.employment_type ?? '', joining_date: e.joining_date ?? '',
    gender: e.gender ?? '', nationality: e.nationality ?? '',
    basic_salary: Number(e.basic_salary), housing_allowance: Number(e.housing_allowance),
    transport_allowance: Number(e.transport_allowance), other_allowance: Number(e.other_allowance),
    manager_code: codeOf(e.reports_to_id), status: e.is_active ? 'active' : 'inactive',
  }));
}

/** Keep only template columns from a parsed file; blank cells dropped; header case and spaces ignored. */
export function normaliseImportRows(rows: Record<string, string>[]): Record<string, string>[] {
  const keyOf = (h: string) => h.trim().toLowerCase().replace(/\s+/g, '_');
  const allowed = new Set<string>(IMPORT_COLUMNS);
  return rows
    .map((r) => {
      const out: Record<string, string> = {};
      for (const [h, v] of Object.entries(r)) {
        const k = keyOf(h);
        const val = String(v ?? '').trim();
        if (allowed.has(k) && val !== '') out[k] = val;
      }
      return out;
    })
    .filter((r) => Object.keys(r).length > 0);
}
