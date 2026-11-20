/**
 * Control Center — Users (phase142). The phase141 users explorer, with its
 * filter in the URL (?filter=) so Overview tiles and funnel steps open it
 * pre-filtered.
 */
import { useSearchParams } from 'react-router-dom';
import type { AdminUserFilter } from '@/data/adapter';
import { UsersExplorer } from '../admin-explorers';

const FILTERS: AdminUserFilter[] = ['all', 'new_7d', 'no_company', 'unverified', 'active_7d', 'inactive_30d'];

export function UsersView() {
  const [params, setParams] = useSearchParams();
  const raw = params.get('filter') as AdminUserFilter | null;
  const filter: AdminUserFilter = raw && FILTERS.includes(raw) ? raw : 'all';
  return (
    <div className="sb-adm" data-testid="admin-users-view">
      <UsersExplorer filter={filter} onFilter={(f) => setParams(f === 'all' ? {} : { filter: f }, { replace: true })} />
    </div>
  );
}
