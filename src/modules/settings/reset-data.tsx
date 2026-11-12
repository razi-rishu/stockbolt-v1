import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { getAdapter } from '@/data/index';
import { useAuthStore } from '@/store/auth';
import { useTranslation } from 'react-i18next';
import { OceanPage } from '@/components/ocean-list';
import { AlertTriangle, Loader2 } from 'lucide-react';
import type { Company, ResetCompanyDataResult } from '@/data/adapter';

/**
 * Reset Company Data — destructive admin operation.
 *
 * Wipes every transactional + operational row scoped to the user's
 * company while preserving company, profiles, chart of accounts, and
 * onboarding masters (units, categories, brands, vehicles, warehouses,
 * price levels, tax rates, payment methods, bank accounts).
 *
 * UX safety layers:
 *   1. Visible role/admin gate — feedback if non-admin
 *   2. Big red warning block
 *   3. Must type the EXACT company name to confirm
 *   4. Confirm button stays disabled until name matches
 *   5. Server-side RPC double-checks all of the above
 *
 * After success: invalidates ALL react-query caches and forces a hard
 * navigation to /dashboard so stale data doesn't render.
 */
export default function ResetDataPage() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { t } = useTranslation();
  const { company_id, role } = useAuthStore();

  const [typed, setTyped] = useState('');
  const [result, setResult] = useState<ResetCompanyDataResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  // QA convenience: skip the typed-name gate. Confirmation is auto-passed
  // from company.name. Server-side RPC still validates admin + name match,
  // so this only relaxes UI friction — not safety guarantees. Persisted
  // to localStorage so QA users don't have to re-toggle every visit.
  const [expressMode, setExpressMode] = useState<boolean>(
    () => localStorage.getItem('stockbolt.qa.expressReset') === '1'
  );
  function setExpressModePersist(v: boolean) {
    setExpressMode(v);
    localStorage.setItem('stockbolt.qa.expressReset', v ? '1' : '0');
  }

  const { data: company } = useQuery<Company | null>({
    queryKey: ['company', company_id],
    queryFn:  () => getAdapter().companies.getById(company_id!),
    enabled:  !!company_id,
  });

  const isAdmin = role === 'admin';
  const expected = company?.name ?? '';
  // In express mode we pass company.name automatically. Otherwise the user
  // must type it exactly. Either way the RPC re-checks the value server-side.
  const effectiveConfirmation = expressMode ? expected : typed;
  const canConfirm = isAdmin && !!expected && effectiveConfirmation === expected;

  const resetMutation = useMutation({
    mutationFn: async () => {
      console.log('[reset] calling reset_company_data', { company_id, expressMode });
      const data = await getAdapter().admin.resetCompanyData(company_id!, effectiveConfirmation);
      console.log('[reset] RPC returned', data);
      return data;
    },
    onSuccess: (data) => {
      console.log('[reset] success — setting result', data);
      setResult(data);
      setError(null);
      qc.clear(); // invalidate everything — most data we cached is gone

      // Also wipe SmartEntitySearch's "recent picks" cache. Those live in
      // localStorage under keys like `recent_customer::<company>`,
      // `recent_supplier::<company>`, `recent_products::<company>`. After
      // a wipe the recents reference rows that no longer exist in DB —
      // they'd render at the top of every picker dropdown with stale
      // names and resolve to broken selections. Drop them all.
      try {
        const toDrop: string[] = [];
        for (let i = 0; i < localStorage.length; i++) {
          const k = localStorage.key(i);
          if (k && k.startsWith('recent_')) toDrop.push(k);
        }
        for (const k of toDrop) localStorage.removeItem(k);
        if (toDrop.length > 0) console.log('[reset] cleared', toDrop.length, 'recent_* localStorage keys');
      } catch {
        // localStorage can throw (Safari private mode, quota, etc.) — non-fatal.
      }
    },
    onError: (e: Error) => {
      console.error('[reset] FAILED', e);
      setError(e.message || String(e) || t('settingsPages.reset.unknown_error'));
    },
  });

  function onConfirmReset() {
    console.log('[reset] click reset button', { canConfirm, isAdmin, role, expected, typed, expressMode });
    if (!canConfirm) {
      console.warn('[reset] aborted — canConfirm is false');
      return;
    }
    const ok = window.confirm(
      (expressMode ? t('settingsPages.reset.confirm_express') : t('settingsPages.reset.confirm_final')) +
      ' ' + t('settingsPages.reset.confirm_body', { name: expected })
    );
    if (!ok) {
      console.log('[reset] aborted — user clicked Cancel on browser dialog');
      return;
    }
    setError(null);
    setResult(null);
    resetMutation.mutate();
  }

  // Ocean Teal (UI v1.1): look only — same admin gate, typed-name check,
  // browser confirmation, express mode and reset call as before.
  if (result) {
    const total = Object.values(result.counts ?? {}).reduce((s: number, n) => s + Number(n ?? 0), 0);
    return (
      <OceanPage
        narrow
        testid="reset-done-ocean"
        title={t('settingsPages.reset.done_title')}
        subtitle={t('settingsPages.reset.done_sub', { rows: total, tables: Object.keys(result.counts ?? {}).length, at: new Date(result.reset_at).toLocaleString() })}
      >
        <div className="sb-card sb-dtable-wrap">
          <table className="sb-dtable">
            <thead>
              <tr>
                <th>{t('settingsPages.reset.c_table')}</th>
                <th className="sb-num">{t('settingsPages.reset.c_rows')}</th>
              </tr>
            </thead>
            <tbody>
              {Object.entries(result.counts ?? {})
                .sort(([, a], [, b]) => Number(b) - Number(a))
                .map(([table, count]) => (
                  <tr key={table}>
                    <td><bdi dir="ltr" className="sb-mono sb-fx-name">{table}</bdi></td>
                    <td className="sb-num sb-mono"><bdi dir="ltr">{Number(count).toLocaleString()}</bdi></td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>

        <div className="sb-form-actions" style={{ justifyContent: 'flex-start' }}>
          <button type="button" className="sb-primary-btn" onClick={() => navigate('/dashboard')}>{t('settingsPages.reset.go_dashboard')}</button>
          <button type="button" className="sb-secondary-btn" onClick={() => window.location.reload()}>{t('settingsPages.reset.reload')}</button>
        </div>
      </OceanPage>
    );
  }

  const WIPED = ['w1', 'w2', 'w3', 'w4', 'w5', 'w6', 'w7', 'w8', 'w9', 'w10', 'w11'];

  return (
    <OceanPage narrow testid="reset-data-ocean" title={t('settingsNav.items.reset_data.title')} subtitle={t('settingsPages.reset.subtitle')}>
      {!isAdmin && (
        <p className="sb-alert sb-alert-warn" role="alert">{t('settingsPages.reset.admin_only', { role: role ?? t('settingsPages.reset.unknown') })}</p>
      )}

      {/* QA Express Mode — for the testing loop (seed → test → wipe → repeat).
           Skips the typed-name gate; server-side guards stay intact. */}
      <label className={`sb-check-row sb-reset-express ${expressMode ? 'is-on' : ''}`}>
        <input type="checkbox" checked={expressMode} onChange={e => setExpressModePersist(e.target.checked)} />
        <span className="sb-check-text">
          {t('settingsPages.reset.express')}
          <span className="sb-form-hint">{t('settingsPages.reset.express_hint')}</span>
        </span>
      </label>

      <section className="sb-card sb-reset-danger">
        <h2 className="sb-reset-title"><AlertTriangle size={22} aria-hidden="true" />{t('settingsPages.reset.cannot_undo')}</h2>
        <p>{t('settingsPages.reset.deleted_intro')}</p>
        <ul>
          {WIPED.map(k => <li key={k}>{t(`settingsPages.reset.${k}`)}</li>)}
        </ul>
        <p className="sb-reset-sep">{t('settingsPages.reset.kept_intro')}</p>
        <ul>
          <li>{t('settingsPages.reset.k1')}</li>
          <li>{t('settingsPages.reset.k2')}</li>
        </ul>
        <p className="sb-reset-note">{t('settingsPages.reset.after')}</p>
      </section>

      {error && (
        <div className="sb-alert sb-alert-danger sb-reset-error" role="alert">
          <p style={{ margin: 0, fontWeight: 700 }}>{t('settingsPages.reset.failed')}</p>
          <pre dir="ltr">{error}</pre>
          <p style={{ margin: 0, fontWeight: 400, fontSize: 13 }}>{t('settingsPages.reset.failed_hint')} <code dir="ltr">reset_company_data</code></p>
        </div>
      )}

      {resetMutation.isPending && (
        <p className="sb-info-note sb-btn-inline" role="status"><Loader2 size={18} className="sb-spin" aria-hidden="true" />{t('settingsPages.reset.resetting_long')}</p>
      )}

      <section className="sb-card sb-form">
        {expressMode ? (
          <p className="sb-form-hint" style={{ margin: 0, fontSize: 14 }}>
            {t('settingsPages.reset.express_on')} <bdi className="sb-mono" style={{ color: 'var(--sb-text)' }}>{expected || '…'}</bdi>
          </p>
        ) : (
          <label className="sb-select-field" style={{ maxWidth: 'none' }}>
            <span className="sb-select-label">{t('settingsPages.reset.type_name')}</span>
            <span className="sb-form-hint">{t('settingsPages.reset.expected')} <bdi className="sb-mono">{expected || '…'}</bdi></span>
            <input
              type="text"
              className="sb-field sb-mono"
              value={typed}
              onChange={e => setTyped(e.target.value)}
              placeholder={expected}
              disabled={!isAdmin || resetMutation.isPending}
              autoComplete="off"
              autoCorrect="off"
              autoCapitalize="off"
              spellCheck={false}
            />
          </label>
        )}

        <div className="sb-form-actions" style={{ marginTop: 14 }}>
          <button type="button" className="sb-secondary-btn" onClick={() => navigate('/dashboard')} disabled={resetMutation.isPending}>
            {t('common.cancel')}
          </button>
          <button type="button" className="sb-danger-btn" disabled={!canConfirm || resetMutation.isPending} onClick={onConfirmReset}>
            {resetMutation.isPending ? t('settingsPages.reset.resetting') : t('settingsPages.reset.reset_all')}
          </button>
        </div>
      </section>
    </OceanPage>
  );
}
