/**
 * Employee 360 — employment history (phase164). Reads employee_events, which
 * only the database writes (trigger on employees), so every change made from
 * any screen, import or Team action appears here. Read-only.
 */
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { History } from 'lucide-react';
import { getAdapter } from '@/data/index';
import type { EmployeeEventRow } from '@/data/adapter';
import type { EmployeeRefs } from './refs';
import { describeEvent } from './history-text';

export function Timeline({ employeeId, refs }: { employeeId: string; refs: EmployeeRefs }) {
  const { t } = useTranslation();
  const q = useQuery<EmployeeEventRow[]>({
    queryKey: ['employee-history', employeeId],
    queryFn: () => getAdapter().employees.history(employeeId),
  });
  const rows = q.data ?? [];
  return (
    <section className="sb-card sb-e360-card" data-testid="e360-timeline">
      <p className="sb-e360-sec"><History size={16} aria-hidden="true" /> {t('emp360.sec_history')}</p>
      {rows.length === 0
        ? <p className="sb-e360-muted">{q.isLoading ? t('common.loading') : t('emp360.history_none')}</p>
        : (
          <ol className="sb-e360-timeline">
            {rows.map((ev) => (
              <li key={ev.id} data-type={ev.event_type}>
                <span className="sb-e360-tl-dot" aria-hidden="true" />
                <div>
                  <p className="sb-e360-tl-text">{describeEvent(t, ev, refs)}</p>
                  <p className="sb-e360-muted" style={{ margin: 0 }}>
                    <bdi dir="ltr">{ev.created_at.slice(0, 10)}</bdi>
                    {ev.effective_date !== ev.created_at.slice(0, 10) && <> · {t('emp360.effective')} <bdi dir="ltr">{ev.effective_date}</bdi></>}
                  </p>
                </div>
              </li>
            ))}
          </ol>
        )}
    </section>
  );
}
