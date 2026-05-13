import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { getAdapter } from '@/data/index';
import { useAuthStore } from '@/store/auth';
import type { AuditLogLine } from '@/data/adapter';

/**
 * Per-document Activity feed. Reads from audit_logs filtered to a
 * specific (entity_type, entity_id) — created/confirmed/voided events
 * already get logged by the confirm_* / void_* RPCs (see Phase 4-9
 * migrations).
 *
 * This is a presentational summary, NOT the canonical audit trail —
 * that's the full report at /reports/audit-log. Used inline on
 * editors so the user doesn't have to context-switch to know who did
 * what when.
 */
export function ActivityLog({ entityType, entityId }: { entityType: string; entityId: string }) {
  const { company_id } = useAuthStore();
  const [showDiffs, setShowDiffs] = useState<Record<string, boolean>>({});

  const { data: rows = [], isLoading } = useQuery<AuditLogLine[]>({
    queryKey: ['entity_audit', company_id, entityType, entityId],
    queryFn:  () => getAdapter().reports.getEntityAuditLog(company_id!, entityType, entityId),
    enabled:  !!company_id && !!entityId,
  });

  if (isLoading) return null;
  if (rows.length === 0) return null;

  const actionColor = (action: string) => {
    if (action === 'create' || action === 'setup_completed') return 'bg-emerald-50 text-emerald-700';
    if (action === 'update')   return 'bg-blue-50 text-blue-700';
    if (action === 'confirm')  return 'bg-green-50 text-green-700';
    if (action === 'post_gl')  return 'bg-indigo-50 text-indigo-700';
    if (action === 'void' || action === 'delete' || action === 'reverse_gl') return 'bg-red-50 text-red-700';
    return 'bg-gray-50 text-gray-600';
  };

  return (
    <div className="rounded-card border border-border-subtle bg-surface-card overflow-hidden">
      <div className="border-b border-border-subtle px-5 py-3">
        <h2 className="text-sm font-semibold text-ink-primary">Activity</h2>
        <p className="mt-0.5 text-xs text-ink-tertiary">
          Who did what to this document, newest first. The full audit trail lives at Reports → Audit Log.
        </p>
      </div>
      <ul className="divide-y divide-border-subtle">
        {rows.map(r => {
          const open = !!showDiffs[r.id];
          const hasDiff = r.old_values || r.new_values;
          return (
            <li key={r.id} className="px-5 py-3 text-sm">
              <div className="flex items-center gap-3 flex-wrap">
                <span className={`rounded px-1.5 py-0.5 text-xs font-medium ${actionColor(r.action)}`}>
                  {r.action}
                </span>
                <span className="text-ink-secondary text-xs truncate max-w-[200px]">{r.user_email}</span>
                <span className="text-ink-tertiary text-xs ms-auto">
                  {new Date(r.created_at).toLocaleString()}
                </span>
                {hasDiff && (
                  <button
                    onClick={() => setShowDiffs(p => ({ ...p, [r.id]: !p[r.id] }))}
                    className="text-xs text-brand-600 hover:underline"
                  >
                    {open ? 'Hide details' : 'Show details'}
                  </button>
                )}
              </div>
              {open && hasDiff && (
                <div className="mt-2 grid grid-cols-1 md:grid-cols-2 gap-3 text-xs">
                  {r.old_values && (
                    <div>
                      <p className="mb-1 text-ink-tertiary">Before</p>
                      <pre className="rounded bg-red-50 p-2 text-red-800 overflow-auto max-h-32">
                        {JSON.stringify(r.old_values, null, 2)}
                      </pre>
                    </div>
                  )}
                  {r.new_values && (
                    <div>
                      <p className="mb-1 text-ink-tertiary">After</p>
                      <pre className="rounded bg-emerald-50 p-2 text-emerald-800 overflow-auto max-h-32">
                        {JSON.stringify(r.new_values, null, 2)}
                      </pre>
                    </div>
                  )}
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
