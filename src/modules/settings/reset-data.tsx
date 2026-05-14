import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { getAdapter } from '@/data/index';
import { useAuthStore } from '@/store/auth';
import { Button } from '@/ui/button';
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
    },
    onError: (e: Error) => {
      console.error('[reset] FAILED', e);
      setError(e.message || String(e) || 'Unknown error');
    },
  });

  function onConfirmReset() {
    console.log('[reset] click reset button', { canConfirm, isAdmin, role, expected, typed, expressMode });
    if (!canConfirm) {
      console.warn('[reset] aborted — canConfirm is false');
      return;
    }
    const ok = window.confirm(
      `${expressMode ? '[Express] ' : 'Final confirmation. '}Wipe ALL transactional data for "${expected}"?\n\n` +
      `This cannot be undone. Click OK to proceed.`
    );
    if (!ok) {
      console.log('[reset] aborted — user clicked Cancel on browser dialog');
      return;
    }
    setError(null);
    setResult(null);
    resetMutation.mutate();
  }

  if (result) {
    const total = Object.values(result.counts ?? {}).reduce((s: number, n) => s + Number(n ?? 0), 0);
    return (
      <div className="max-w-2xl space-y-6">
        <div>
          <h1 className="text-2xl font-bold text-slate-800">Reset complete</h1>
          <p className="text-sm text-slate-500 mt-1">
            Deleted {total} rows across {Object.keys(result.counts ?? {}).length} tables at{' '}
            {new Date(result.reset_at).toLocaleString()}.
          </p>
        </div>

        <div className="rounded-card border border-border-subtle bg-surface-card overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-surface-muted">
              <tr>
                <th className="px-4 py-2 text-left text-xs font-medium text-ink-secondary">Table</th>
                <th className="px-4 py-2 text-right text-xs font-medium text-ink-secondary">Rows deleted</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border-subtle">
              {Object.entries(result.counts ?? {})
                .sort(([, a], [, b]) => Number(b) - Number(a))
                .map(([table, count]) => (
                  <tr key={table}>
                    <td className="px-4 py-2 font-mono text-xs text-ink-secondary">{table}</td>
                    <td className="px-4 py-2 text-right font-mono">{Number(count).toLocaleString()}</td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>

        <div className="flex gap-2">
          <Button onClick={() => navigate('/dashboard')}>Go to Dashboard</Button>
          <Button variant="ghost" onClick={() => window.location.reload()}>Reload page</Button>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-2xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-800">Reset Company Data</h1>
        <p className="text-sm text-slate-500 mt-1">
          Destructive admin operation for testing. Wipes all transactions and
          operational data for this company.
        </p>
      </div>

      {!isAdmin && (
        <div className="rounded bg-yellow-50 border border-yellow-200 px-4 py-3 text-sm text-yellow-800">
          Only an <strong>admin</strong> can reset company data. Your role is <strong>{role ?? 'unknown'}</strong>.
        </div>
      )}

      {/* QA Express Mode — for the testing loop (seed → test → wipe → repeat).
           Skips the typed-name gate; server-side guards stay intact. */}
      <div className="rounded-lg border border-amber-200 bg-amber-50 p-3">
        <label className="flex items-start gap-3 cursor-pointer">
          <input
            type="checkbox"
            checked={expressMode}
            onChange={e => setExpressModePersist(e.target.checked)}
            className="mt-1 h-4 w-4 accent-amber-600"
          />
          <span className="text-sm">
            <strong className="text-amber-900">Express mode (QA)</strong>
            <span className="text-amber-800"> — skip the type-the-name gate so you can wipe in one click during testing. Server-side admin + name match still apply. Setting is persisted in this browser.</span>
          </span>
        </label>
      </div>

      <div className="rounded-card border border-red-300 bg-red-50 p-5 space-y-3">
        <h2 className="text-lg font-semibold text-red-700">⚠ This action cannot be undone</h2>
        <p className="text-sm text-red-800">
          The following will be <strong>permanently deleted</strong>:
        </p>
        <ul className="text-sm text-red-800 list-disc list-inside space-y-1">
          <li>All invoices, quotes, sales orders, credit notes, sales returns</li>
          <li>All vendor bills, POs, GRNs, debit notes</li>
          <li>All customer + vendor payments and their allocations</li>
          <li>All bank transfers, expenses, PDC cheques, POS sessions</li>
          <li>All stock transfers, inventory adjustments</li>
          <li>All journal entries, general ledger, stock ledger, bank reconciliations</li>
          <li>All customers, suppliers, products (with serials, compatibility, supplier codes)</li>
          <li>All attachments, notifications, document sequences (reset to 1000)</li>
          <li>All audit log entries (one final entry recording this reset will be kept)</li>
        </ul>
        <p className="text-sm text-red-800 pt-2 border-t border-red-200">
          The following will be <strong>preserved</strong>:
        </p>
        <ul className="text-sm text-red-800 list-disc list-inside space-y-1">
          <li>Your company record, your user profile, and onboarding state</li>
          <li>Chart of accounts</li>
          <li>Warehouses, units, categories, brands, vehicles, price levels</li>
          <li>Tax rates, payment methods, bank accounts (balances reset to zero)</li>
        </ul>
      </div>

      {error && (
        <div className="sticky top-2 z-10 rounded-lg border-2 border-red-500 bg-red-50 p-4 shadow-lg">
          <p className="text-sm font-bold text-red-800">Reset failed</p>
          <pre className="mt-2 whitespace-pre-wrap break-words text-xs text-red-700 font-mono">{error}</pre>
          <p className="mt-2 text-xs text-red-600">
            Also check the browser DevTools Console + Network tab for the underlying error
            (look for the POST request to <code className="font-mono bg-red-100 px-1 rounded">reset_company_data</code>).
          </p>
        </div>
      )}

      {resetMutation.isPending && (
        <div className="rounded-lg border-2 border-blue-500 bg-blue-50 p-4">
          <p className="text-sm font-semibold text-blue-800">Resetting… this may take a few seconds.</p>
        </div>
      )}

      <div className="rounded-card border border-border-subtle bg-surface-card p-5 space-y-4">
        {expressMode ? (
          <p className="text-sm text-ink-secondary">
            Express mode is ON — clicking the button below will wipe data for <strong className="font-mono">{expected || '…'}</strong> after a single browser confirmation. Uncheck Express above to require typed confirmation.
          </p>
        ) : (
          <div>
            <label className="block text-sm font-medium text-ink-primary mb-1">
              To confirm, type the company name <strong>exactly</strong>:
            </label>
            <p className="text-xs text-ink-tertiary mb-2">
              Expected: <span className="font-mono">{expected || '…'}</span>
            </p>
            <input
              type="text"
              value={typed}
              onChange={e => setTyped(e.target.value)}
              placeholder={expected}
              disabled={!isAdmin || resetMutation.isPending}
              className="w-full h-10 rounded-md border border-slate-300 px-3 text-sm font-mono disabled:bg-slate-50"
              autoComplete="off"
              autoCorrect="off"
              autoCapitalize="off"
              spellCheck={false}
            />
          </div>
        )}

        <div className="flex gap-2 pt-2">
          <Button variant="ghost" onClick={() => navigate('/dashboard')} disabled={resetMutation.isPending}>
            Cancel
          </Button>
          <Button
            disabled={!canConfirm || resetMutation.isPending}
            className={canConfirm ? 'bg-red-600 hover:bg-red-700' : ''}
            onClick={onConfirmReset}
          >
            {resetMutation.isPending ? 'Resetting…' : 'Reset all data'}
          </Button>
        </div>
      </div>
    </div>
  );
}
