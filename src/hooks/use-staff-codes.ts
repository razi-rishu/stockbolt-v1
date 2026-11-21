/**
 * phase144 — people show as "EMP-0002 · Nisamu" in pickers, so "002" or the
 * name finds them. Salespeople rows carry no code (Sales users never read
 * employees), so the code comes from list_staff, which they may call.
 */
import { useQuery } from '@tanstack/react-query';
import { getAdapter } from '@/data/index';
import type { StaffRole } from '@/data/adapter';

/** employee_id → code for everyone with this role (inactive included). */
export function useStaffCodes(role: StaffRole, enabled = true): Map<string, string> {
  const { data = [] } = useQuery({
    queryKey: ['staff_codes', role],
    queryFn: () => getAdapter().staff.list(role, true),
    enabled,
    staleTime: 60_000,
  });
  return new Map(data.filter((r) => r.code).map((r) => [r.employee_id, r.code as string]));
}

/** "EMP-0002 · Nisamu", or just the name when there is no code. */
export const staffLabel = (code: string | null | undefined, name: string) => (code ? `${code} · ${name}` : name);
