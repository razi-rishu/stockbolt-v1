/**
 * Team (phase144) — the pick-lists and the pure helpers behind the org chart.
 *
 * Job titles and departments are stored as their English name (the existing
 * free-text columns employees.designation / department), so older free-text
 * values keep working; a known name is shown translated, anything else as typed.
 */
import type { TFunction } from 'i18next';
import type { TeamMember } from '@/data/adapter';

export const JOB_TITLES = [
  { key: 'owner_ceo', en: 'Owner / CEO' },
  { key: 'general_manager', en: 'General Manager' },
  { key: 'finance_manager', en: 'Finance Manager' },
  { key: 'sales_manager', en: 'Sales Manager' },
  { key: 'purchase_manager', en: 'Purchase Manager' },
  { key: 'store_manager', en: 'Store Manager' },
  { key: 'branch_manager', en: 'Branch Manager' },
  { key: 'supervisor', en: 'Supervisor' },
  { key: 'accountant', en: 'Accountant' },
  { key: 'salesman', en: 'Salesman' },
  { key: 'storekeeper', en: 'Storekeeper' },
  { key: 'staff', en: 'Staff' },
] as const;

export const DEPARTMENTS = [
  { key: 'management', en: 'Management' },
  { key: 'sales', en: 'Sales' },
  { key: 'purchasing', en: 'Purchasing' },
  { key: 'accounts', en: 'Accounts' },
  { key: 'store', en: 'Store' },
  { key: 'hr', en: 'HR' },
] as const;

type TitleKey = (typeof JOB_TITLES)[number]['key'];
type DeptKey = (typeof DEPARTMENTS)[number]['key'];

// Literal t() calls so the i18n key test can see every one.
const titleNames = (t: TFunction): Record<TitleKey, string> => ({
  owner_ceo: t('teamOcean.t_owner_ceo'), general_manager: t('teamOcean.t_general_manager'),
  finance_manager: t('teamOcean.t_finance_manager'), sales_manager: t('teamOcean.t_sales_manager'),
  purchase_manager: t('teamOcean.t_purchase_manager'), store_manager: t('teamOcean.t_store_manager'),
  branch_manager: t('teamOcean.t_branch_manager'), supervisor: t('teamOcean.t_supervisor'),
  accountant: t('teamOcean.t_accountant'), salesman: t('teamOcean.t_salesman'),
  storekeeper: t('teamOcean.t_storekeeper'), staff: t('teamOcean.t_staff'),
});
const deptNames = (t: TFunction): Record<DeptKey, string> => ({
  management: t('teamOcean.d_management'), sales: t('teamOcean.d_sales'), purchasing: t('teamOcean.d_purchasing'),
  accounts: t('teamOcean.d_accounts'), store: t('teamOcean.d_store'), hr: t('teamOcean.d_hr'),
});

const norm = (s: string | null | undefined) => (s ?? '').trim().toLowerCase();

/** The list key of a stored title, or null when it was typed freely. */
export const titleKeyOf = (stored: string | null | undefined): TitleKey | null =>
  JOB_TITLES.find((x) => x.en.toLowerCase() === norm(stored))?.key ?? null;
export const deptKeyOf = (stored: string | null | undefined): DeptKey | null =>
  DEPARTMENTS.find((x) => x.en.toLowerCase() === norm(stored))?.key ?? null;

export function titleLabel(t: TFunction, stored: string | null | undefined): string {
  const k = titleKeyOf(stored);
  return k ? titleNames(t)[k] : (stored ?? '').trim();
}
export function deptLabel(t: TFunction, stored: string | null | undefined): string {
  const k = deptKeyOf(stored);
  return k ? deptNames(t)[k] : (stored ?? '').trim();
}
export const titleOptions = (t: TFunction) => JOB_TITLES.map((x) => ({ value: x.en, label: titleNames(t)[x.key] }));
export const deptOptions = (t: TFunction) => DEPARTMENTS.map((x) => ({ value: x.en, label: deptNames(t)[x.key] }));

/** "EMP-0002 · Nisamu" — how a person is shown everywhere. */
export const personLabel = (m: { code: string | null; name: string }) => (m.code ? `${m.code} · ${m.name}` : m.name);

/** Matches "002", "2", "EMP-0002" or any part of the name (English or Arabic). */
export function matchesPerson(m: TeamMember, query: string): boolean {
  const q = norm(query);
  if (!q) return true;
  return norm(m.code).includes(q) || norm(m.name).includes(q) || norm(m.name_ar).includes(q);
}

export interface TreeNode { member: TeamMember; depth: number; reports: number }

/**
 * Depth-first order of the org chart: the top first, then each manager followed
 * by their team (sorted by code). A person whose manager isn't in the list
 * (e.g. an inactive manager hidden by the filter) is shown under the top.
 */
export function buildTree(team: TeamMember[]): TreeNode[] {
  const byId = new Map(team.map((m) => [m.employee_id, m]));
  const kids = new Map<string, TeamMember[]>();
  const top = team.find((m) => m.reports_to_id === null) ?? null;
  for (const m of team) {
    if (m === top) continue;
    const parent = m.reports_to_id && byId.has(m.reports_to_id) ? m.reports_to_id : top?.employee_id ?? '';
    kids.set(parent, [...(kids.get(parent) ?? []), m]);
  }
  for (const list of kids.values()) list.sort((a, b) => (a.code ?? '').localeCompare(b.code ?? '', 'en', { numeric: true }));
  const out: TreeNode[] = [];
  const seen = new Set<string>();
  const walk = (m: TeamMember, depth: number) => {
    if (seen.has(m.employee_id)) return;
    seen.add(m.employee_id);
    out.push({ member: m, depth, reports: kids.get(m.employee_id)?.length ?? 0 });
    for (const k of kids.get(m.employee_id) ?? []) walk(k, depth + 1);
  };
  if (top) walk(top, 0);
  for (const m of kids.get('') ?? []) walk(m, 0);
  return out;
}

/** Everyone below this person (they can't become this person's manager). */
export function descendantsOf(team: TeamMember[], id: string): Set<string> {
  const out = new Set<string>();
  const stack = [id];
  while (stack.length) {
    const cur = stack.pop()!;
    for (const m of team) {
      if (m.reports_to_id === cur && !out.has(m.employee_id)) { out.add(m.employee_id); stack.push(m.employee_id); }
    }
  }
  return out;
}

/** The chain above a person: manager, their manager, … up to the top. */
export function chainOf(team: TeamMember[], id: string): TeamMember[] {
  const byId = new Map(team.map((m) => [m.employee_id, m]));
  const out: TeamMember[] = [];
  let cur = byId.get(id)?.reports_to_id ?? null;
  while (cur && out.length < 50) {
    const m = byId.get(cur);
    if (!m) break;
    out.push(m);
    cur = m.reports_to_id;
  }
  return out;
}

export const CODE_PREFIX_RE = /^[A-Za-z0-9/_.-]{0,10}$/;

/** Mirrors the server's _next_employee_code, for the live preview. */
export function previewNextCode(codes: (string | null)[], prefix: string, digits: number, start: number): string {
  const p = prefix.toUpperCase();
  let max = 0;
  for (const c of codes) {
    if (!c || c.slice(0, prefix.length).toUpperCase() !== p) continue;
    const rest = c.slice(prefix.length);
    if (/^[0-9]{1,15}$/.test(rest)) max = Math.max(max, Number(rest));
  }
  const n = Math.max(start, max + 1);
  const s = String(n);
  return prefix + (s.length >= digits ? s : s.padStart(digits, '0'));
}
