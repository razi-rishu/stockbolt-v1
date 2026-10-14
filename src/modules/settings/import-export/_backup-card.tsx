import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { getAdapter } from '@/data/index';
import { useAuthStore } from '@/store/auth';
import { hasPerm } from '@/lib/permissions';
import { Button } from '@/ui/button';
import { theme } from '@/ui/theme';
import { downloadBlob, downloadWorkbook } from '@/lib/io-export';
import { BACKUP_TABLES } from '@/lib/backup-manifest';
import type { BackupResult } from '@/data/adapter';

/**
 * "Download my data" — the whole company, in one file.
 *
 * WHY THIS IS NOT THE IMPORT/EXPORT WIZARD ABOVE IT
 * That wizard round-trips eight master-data tables: products, contacts, the
 * chart of accounts. Useful, and not a backup — it contains no invoice, no
 * payment, no ledger row. This reads all 89 tables the company owns.
 *
 * WHAT IT IS NOT
 * It is NOT a restore. Putting these rows back is a much harder problem than
 * taking them out: transactions would have to be replayed through the posting
 * engines, because inserting ledger rows directly would produce books that
 * balance only by coincidence. The file is for your records, your accountant,
 * and migrating off StockBolt — the honest claim, made in the UI.
 *
 * SECURITY
 * Runs as the signed-in user over the ordinary client, so RLS scopes every
 * read. The rows a user can export are exactly the rows they could already
 * read in the app. Gated on settings.write because a whole-company extract is
 * an owner-level action, not because the data boundary needs it.
 */
export function BackupCard() {
  const { t } = useTranslation();
  const { company_id, role, permissions } = useAuthStore();
  const [busy, setBusy] = useState(false);
  const [current, setCurrent] = useState<{ table: string; i: number } | null>(null);
  const [result, setResult] = useState<BackupResult | null>(null);
  const [error, setError] = useState('');

  const allowed = hasPerm(role, permissions, 'settings.write');
  if (!allowed) return null;

  const stamp = () => new Date().toISOString().slice(0, 10);
  const safeName = (r: BackupResult) =>
    `${r.company_name.replace(/[^\w-]+/g, '_')}-backup-${stamp()}`;

  async function run(format: 'json' | 'xlsx') {
    if (!company_id) return;
    setBusy(true); setError(''); setResult(null);
    try {
      const data = await getAdapter().backup.exportAll(
        company_id,
        (table, i) => setCurrent({ table, i }),
      );
      setResult(data);

      if (format === 'json') {
        // The lossless one: every column, every type, nothing flattened.
        downloadBlob(
          JSON.stringify(data, null, 2),
          `${safeName(data)}.json`,
          'application/json',
        );
      } else {
        await downloadWorkbook(
          data.tables.map(tb => ({ name: tb.table, rows: tb.rows })),
          `${safeName(data)}.xlsx`,
        );
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false); setCurrent(null);
    }
  }

  return (
    <div className="rounded-card border border-border-subtle bg-surface-card p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-sm font-semibold text-ink-primary">{t('backup.title')}</h2>
          <p className="mt-1 text-sm text-ink-secondary">{t('backup.blurb', { count: BACKUP_TABLES.length })}</p>
        </div>
        <div className="flex shrink-0 gap-2">
          <Button size="sm" disabled={busy} onClick={() => run('json')}>
            {busy ? t('backup.working') : t('backup.download_json')}
          </Button>
          <Button size="sm" variant="ghost" disabled={busy} onClick={() => run('xlsx')}>
            {t('backup.download_xlsx')}
          </Button>
        </div>
      </div>

      {/* A 89-table read is long enough that a silent button looks broken. */}
      {busy && current && (
        <p className="mt-3 text-xs text-ink-tertiary">
          {t('backup.reading', {
            table: current.table,
            n: current.i + 1,
            total: BACKUP_TABLES.length,
          })}
        </p>
      )}

      {error && (
        <p className="mt-3 text-xs" style={{ color: theme.danger }}>{error}</p>
      )}

      {result && !busy && (
        <div className="mt-3 space-y-1 text-xs">
          <p style={{ color: theme.success }}>
            {t('backup.done', { rows: result.total_rows, tables: result.tables.length })}
          </p>
          {/* A short backup that LOOKS complete is the failure this feature
              exists to avoid, so truncation is stated, not logged. */}
          {result.truncated_tables.length > 0 && (
            <p style={{ color: theme.danger }}>
              {t('backup.truncated', { tables: result.truncated_tables.join(', ') })}
            </p>
          )}
          {result.failed_tables.length > 0 && (
            <p style={{ color: theme.warn }}>
              {t('backup.failed', { tables: result.failed_tables.join(', ') })}
            </p>
          )}
        </div>
      )}

      <p className="mt-3 text-xs text-ink-tertiary">{t('backup.not_a_restore')}</p>
    </div>
  );
}
