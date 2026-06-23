/**
 * Client-side role → permission matrix (Phase 22).
 *
 * This MIRRORS the role_permissions seed in
 * supabase/migrations/20260619000013_phase22_user_roles_foundation.sql.
 * The database is the security source of truth (RLS calls has_perm()); this
 * copy drives instant, offline-resilient UI gating (nav, routes, buttons).
 * Roles are fixed (5), so a typed constant is simpler and faster than fetching.
 * Keep the two in sync if the matrix changes.
 */
export type AppRole = 'admin' | 'accountant' | 'sales' | 'counter' | 'viewer';

export type Permission =
  | 'sales.read' | 'sales.write'
  | 'purchasing.read' | 'purchasing.write'
  | 'inventory.read' | 'inventory.write'
  | 'accounting.read' | 'accounting.write'
  | 'payroll.read' | 'payroll.write'
  | 'reports.read'
  | 'settings.read' | 'settings.write'
  | 'users.manage';

const ALL: Permission[] = [
  'sales.read', 'sales.write', 'purchasing.read', 'purchasing.write',
  'inventory.read', 'inventory.write', 'accounting.read', 'accounting.write',
  'payroll.read', 'payroll.write', 'reports.read', 'settings.read',
  'settings.write', 'users.manage',
];

export const ROLE_PERMISSIONS: Record<AppRole, Permission[]> = {
  admin: ALL,
  accountant: [
    'sales.read', 'purchasing.read', 'purchasing.write', 'inventory.read',
    'accounting.read', 'accounting.write', 'payroll.read', 'reports.read', 'settings.read',
  ],
  sales: ['sales.read', 'sales.write', 'inventory.read', 'reports.read'],
  counter: ['sales.read', 'sales.write', 'inventory.read'],
  viewer: [
    'sales.read', 'purchasing.read', 'inventory.read', 'accounting.read',
    'payroll.read', 'reports.read', 'settings.read',
  ],
};

export const ROLE_LABELS: Record<AppRole, string> = {
  admin: 'Admin',
  accountant: 'Accountant',
  sales: 'Salesperson',
  counter: 'Counter / Cashier',
  viewer: 'Viewer',
};

export const ROLE_DESCRIPTIONS: Record<AppRole, string> = {
  admin: 'Full access, including settings, accounting and user management.',
  accountant: 'Books, banking, purchasing and reports. No user management.',
  sales: 'Quotes, invoices, customers, payments and POS. Read-only inventory.',
  counter: 'POS / counter sales only. Read-only products.',
  viewer: 'Read-only across all modules. Cannot create or edit anything.',
};

export const ASSIGNABLE_ROLES: AppRole[] = ['admin', 'accountant', 'sales', 'counter', 'viewer'];

export function permsForRole(role: string | null | undefined): Permission[] {
  if (!role) return [];
  return ROLE_PERMISSIONS[role as AppRole] ?? [];
}

/** Admin always passes (matches the has_perm() short-circuit in SQL). */
export function roleHasPerm(role: string | null | undefined, perm: Permission): boolean {
  if (role === 'admin') return true;
  return permsForRole(role).includes(perm);
}

/**
 * Effective permission check (Phase 23). Admin short-circuits. If the live
 * permission list (loaded from my_permissions() — authoritative for CUSTOM
 * roles) is present, use it; otherwise fall back to the fixed-role matrix
 * (covers system roles before the list loads / offline).
 */
export function hasPerm(
  role: string | null | undefined,
  perms: string[] | null | undefined,
  perm: Permission,
): boolean {
  if (role === 'admin') return true;
  if (perms && perms.length) return perms.includes(perm);
  return roleHasPerm(role, perm);
}
