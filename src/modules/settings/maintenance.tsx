import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { getAdapter } from '@/data';
import { useAuthStore } from '@/store/auth';
import { hasPerm } from '@/lib/permissions';
import { PageHeader } from '@/ui/primitives';
import type { DeferredCogsRepairResult, SubledgerRepairResult } from '@/data/adapter';

/**
 * AC-V2c — Accounting Maintenance.
 *
 * Operator surface for the two sell-before-buy repairs. It exists because both
 * RPCs resolve the tenant from auth.uid(): they cannot be run from the Supabase
 * SQL editor or under service_role, where auth.uid() is NULL and auth_require
 * fails with "forbidden". A signed-in session is the only way to invoke them —
 * and the flush repair additionally needs a real user so post_journal_entry can
 * stamp created_by.
 *
 * Both actions preview first and apply second. Apply stays disabled until a
 * preview has been run, so nobody posts a number they have not seen.
 */

function fmt(n: number) {
  return n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export default function MaintenancePage() {
  const { t } = useTranslation();
  const adapter = getAdapter();
  const role = useAuthStore(s => s.role);
  const permissions = useAuthStore(s => s.permissions);

  const canAccount   = hasPerm(role, permissions, 'accounting.write');
  const canInventory = hasPerm(role, permissions, 'inventory.write');

  // ── Subledger repair (GL-neutral) ─────────────────────────────────────────
  const [subPreview, setSubPreview] = useState<SubledgerRepairResult | null>(null);
  const [subBusy, setSubBusy]       = useState(false);
  const [subMsg, setSubMsg]         = useState<string | null>(null);

  const runSub = async (dryRun: boolean) => {
    setSubBusy(true); setSubMsg(null);
    try {
      const res = await adapter.systemHealth.repairCogsSubledger(dryRun);
      if (dryRun) {
        setSubPreview(res);
        if (res.rows === 0) setSubMsg(t('maint.nothing_to_do'));
      } else {
        setSubPreview(null);
        setSubMsg(t('maint.sub_applied', { rows: res.rows, value: fmt(res.value) }));
      }
    } catch (e) {
      setSubMsg(`❌ ${e instanceof Error ? e.message : String(e)}`);
    } finally { setSubBusy(false); }
  };

  // ── Deferred-COGS flush repair (POSTS to the GL) ──────────────────────────
  const [defPreview, setDefPreview] = useState<DeferredCogsRepairResult | null>(null);
  const [defBusy, setDefBusy]       = useState(false);
  const [defMsg, setDefMsg]         = useState<string | null>(null);
  const [defAck, setDefAck]         = useState(false);

  const runDef = async (dryRun: boolean) => {
    setDefBusy(true); setDefMsg(null);
    try {
      const res = await adapter.systemHealth.repairStrandedDeferredCogs(dryRun);
      if (dryRun) {
        setDefPreview(res);
        setDefAck(false);
        if (res.entries === 0) setDefMsg(t('maint.nothing_to_do'));
      } else {
        setDefPreview(null); setDefAck(false);
        setDefMsg(t('maint.def_applied', { entries: res.entries_posted, total: fmt(res.total) }));
      }
    } catch (e) {
      setDefMsg(`❌ ${e instanceof Error ? e.message : String(e)}`);
    } finally { setDefBusy(false); }
  };

  return (
    <div className="flex flex-col gap-5">
      <PageHeader title={t('maint.title')} subtitle={t('maint.subtitle')} />

      {/* ── GL-neutral repair ───────────────────────────────────────────── */}
      <section className="rounded-card border border-border-subtle bg-surface-card p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="max-w-2xl">
            <h2 className="text-sm font-semibold text-ink-primary">{t('maint.sub_title')}</h2>
            <p className="mt-1 text-xs text-ink-secondary">{t('maint.sub_desc')}</p>
            <p className="mt-1 text-xs font-medium text-success-600">{t('maint.gl_neutral')}</p>
          </div>
          <div className="flex gap-2">
            <button
              onClick={() => runSub(true)}
              disabled={subBusy || !canInventory}
              className="h-9 rounded-card border border-border-strong bg-surface-card px-4 text-sm text-ink-primary hover:bg-surface-muted disabled:opacity-50"
            >
              {subBusy ? t('common.loading') : t('maint.preview')}
            </button>
            <button
              onClick={() => runSub(false)}
              disabled={subBusy || !canInventory || !subPreview || subPreview.rows === 0}
              className="btn-primary h-9 px-4 text-sm font-semibold"
            >
              {t('maint.apply')}
            </button>
          </div>
        </div>

        {!canInventory && <p className="mt-3 text-xs text-danger-600">{t('maint.no_permission')}</p>}
        {subMsg && <p className="mt-3 text-sm text-ink-primary">{subMsg}</p>}

        {subPreview && subPreview.rows > 0 && (
          <div className="mt-3 overflow-x-auto rounded border border-border-subtle">
            <table className="w-full text-sm">
              <thead className="bg-surface-subtle text-xs uppercase tracking-wide text-ink-tertiary">
                <tr>
                  <th className="px-3 py-2 text-start">{t('maint.col_product')}</th>
                  <th className="px-3 py-2 text-end">{t('maint.col_qty')}</th>
                  <th className="px-3 py-2 text-end">{t('maint.col_unit_cost')}</th>
                  <th className="px-3 py-2 text-end">{t('maint.col_value')}</th>
                </tr>
              </thead>
              <tbody>
                {subPreview.plan.map(l => (
                  <tr key={l.stock_row_id} className="border-t border-border-subtle">
                    <td className="px-3 py-2 font-mono text-xs text-ink-secondary">{l.product_id.slice(0, 8)}…</td>
                    <td className="px-3 py-2 text-end text-ink-secondary">{l.quantity}</td>
                    <td className="px-3 py-2 text-end text-ink-secondary">{fmt(Number(l.unit_cost))}</td>
                    <td className="px-3 py-2 text-end font-medium text-ink-primary">{fmt(Number(l.total_cost))}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="border-t-2 border-border-strong bg-surface-subtle font-semibold text-ink-primary">
                  <td className="px-3 py-2" colSpan={3}>{t('maint.total')}</td>
                  <td className="px-3 py-2 text-end">{fmt(subPreview.value)}</td>
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </section>

      {/* ── GL-posting repair ───────────────────────────────────────────── */}
      <section className="rounded-card border border-border-subtle bg-surface-card p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="max-w-2xl">
            <h2 className="text-sm font-semibold text-ink-primary">{t('maint.def_title')}</h2>
            <p className="mt-1 text-xs text-ink-secondary">{t('maint.def_desc')}</p>
            <p className="mt-1 text-xs font-medium text-warning-600">{t('maint.posts_to_gl')}</p>
          </div>
          <div className="flex gap-2">
            <button
              onClick={() => runDef(true)}
              disabled={defBusy || !canAccount}
              className="h-9 rounded-card border border-border-strong bg-surface-card px-4 text-sm text-ink-primary hover:bg-surface-muted disabled:opacity-50"
            >
              {defBusy ? t('common.loading') : t('maint.preview')}
            </button>
            <button
              onClick={() => runDef(false)}
              disabled={defBusy || !canAccount || !defPreview || defPreview.entries === 0 || !defAck}
              className="btn-primary h-9 px-4 text-sm font-semibold"
            >
              {t('maint.apply')}
            </button>
          </div>
        </div>

        {!canAccount && <p className="mt-3 text-xs text-danger-600">{t('maint.no_permission')}</p>}
        {defMsg && <p className="mt-3 text-sm text-ink-primary">{defMsg}</p>}

        {defPreview && defPreview.entries > 0 && (
          <>
            <div className="mt-3 overflow-x-auto rounded border border-border-subtle">
              <table className="w-full text-sm">
                <thead className="bg-surface-subtle text-xs uppercase tracking-wide text-ink-tertiary">
                  <tr>
                    <th className="px-3 py-2 text-start">{t('maint.col_date')}</th>
                    <th className="px-3 py-2 text-end">{t('maint.col_rows')}</th>
                    <th className="px-3 py-2 text-end">{t('maint.col_amount')}</th>
                  </tr>
                </thead>
                <tbody>
                  {defPreview.plan.map(e => (
                    <tr key={`${e.bill_id}-${e.date}`} className="border-t border-border-subtle">
                      <td className="px-3 py-2 text-ink-secondary">{e.date}</td>
                      <td className="px-3 py-2 text-end text-ink-secondary">{e.rows}</td>
                      <td className="px-3 py-2 text-end font-medium text-ink-primary">{fmt(Number(e.amount))}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="border-t-2 border-border-strong bg-surface-subtle font-semibold text-ink-primary">
                    <td className="px-3 py-2" colSpan={2}>{t('maint.total')}</td>
                    <td className="px-3 py-2 text-end">{fmt(defPreview.total)}</td>
                  </tr>
                </tfoot>
              </table>
            </div>
            <label className="mt-3 flex items-center gap-2 text-xs text-ink-secondary">
              <input type="checkbox" checked={defAck} onChange={e => setDefAck(e.target.checked)} />
              {t('maint.def_ack', { total: fmt(defPreview.total) })}
            </label>
          </>
        )}
      </section>
    </div>
  );
}
