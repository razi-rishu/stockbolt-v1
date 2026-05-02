import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { getAdapter } from '@/data/index';
import { useAuthStore } from '@/store/auth';
import { Button } from '@/ui/button';
import type { JournalEntryRow } from '@/data/adapter';

function fmt(n: number) {
  return n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export default function JournalEntriesPage() {
  const { t } = useTranslation();
  const { company_id } = useAuthStore();
  const navigate = useNavigate();

  const { data: entries = [], isLoading } = useQuery({
    queryKey: ['journal_entries', company_id],
    queryFn: () => getAdapter().accounting.listJEs(company_id!, 100),
    enabled: !!company_id,
  });

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold text-ink-primary">{t('accounting.je_title')}</h1>
        <Button size="sm" onClick={() => navigate('/accounting/journal-entries/new')}>
          {t('accounting.new_je')}
        </Button>
      </div>

      {isLoading ? (
        <p className="text-sm text-ink-secondary">{t('common.loading')}</p>
      ) : entries.length === 0 ? (
        <p className="text-sm text-ink-tertiary">{t('accounting.je_empty')}</p>
      ) : (
        <div className="rounded-card border border-border-subtle bg-surface-card">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border-subtle bg-surface-muted text-xs text-ink-tertiary">
                <th className="px-4 py-2.5 text-start font-medium">{t('accounting.entry_number')}</th>
                <th className="px-4 py-2.5 text-start font-medium">{t('accounting.date')}</th>
                <th className="px-4 py-2.5 text-start font-medium">{t('accounting.description')}</th>
                <th className="px-4 py-2.5 text-start font-medium">{t('accounting.source_type')}</th>
                <th className="px-4 py-2.5 text-end font-medium">{t('accounting.debit')}</th>
                <th className="px-4 py-2.5 text-end font-medium">{t('accounting.status')}</th>
              </tr>
            </thead>
            <tbody>
              {(entries as JournalEntryRow[]).map((je) => (
                <tr
                  key={je.id}
                  className="cursor-pointer border-b border-border-subtle last:border-0 hover:bg-surface-muted/50"
                  onClick={() => navigate(`/accounting/journal-entries/${je.id}`)}
                >
                  <td className="px-4 py-2.5 font-mono text-xs text-brand-600">{je.entry_number}</td>
                  <td className="px-4 py-2.5 text-ink-secondary">{je.date}</td>
                  <td className="px-4 py-2.5 text-ink-primary">{je.description ?? '—'}</td>
                  <td className="px-4 py-2.5 text-ink-secondary capitalize">{(je as any).source_type ?? '—'}</td>
                  <td className="px-4 py-2.5 text-end font-mono text-ink-primary">{fmt(Number(je.total_debit))}</td>
                  <td className="px-4 py-2.5 text-end">
                    {(je as any).reversed_by_id ? (
                      <span className="rounded-pill bg-red-50 px-2 py-0.5 text-xs text-red-600">{t('accounting.reversed')}</span>
                    ) : (
                      <span className="rounded-pill bg-green-50 px-2 py-0.5 text-xs text-green-600">{t('accounting.posted')}</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
