/**
 * Global v1 Phase 6 (global06) — is the signed-in user branch-restricted?
 *
 * Asks the database (_branch_restricted), the same function every RLS policy
 * uses, so the UI can never disagree with what the server enforces. The UI only
 * uses it to explain an empty screen; security is the database's job.
 */
import { useQuery } from '@tanstack/react-query';
import { getAdapter } from '@/data/index';
import { useAuthStore } from '@/store/auth';

export function useBranchRestricted(): { restricted: boolean; ready: boolean } {
  const company_id = useAuthStore((s) => s.company_id);
  const { data, isLoading } = useQuery({
    queryKey: ['branch_restricted', company_id],
    queryFn: () => getAdapter().branches.isRestricted(),
    enabled: !!company_id,
    staleTime: 60 * 1000,
    retry: 1,
  });
  return { restricted: data === true, ready: !company_id || !isLoading };
}
