import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { getAdapter } from '@/data';
import { useAuthStore } from '@/store/auth';
import type { InvariantResult, MalformedJE, ArMismatch, StockMismatch } from '@/data/adapter';

function fmt(n: number) {
  return n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export default function SystemHealthPage() {
  const { t } = useTranslation();
  const adapter = getAdapter();
  const navigate = useNavigate();
  const company_id = useAuthStore(s => s.company_id);

  const today = new Date().toISOString().slice(0, 10);
  const [asOf, setAsOf]     = useState(today);
  const [results, setResults] = useState<InvariantResult[]>([]);
  const [malformed, setMalformed] = useState<MalformedJE[]>([]);
  const [arMismatches, setArMismatches] = useState<ArMismatch[]>([]);
  const [stockMismatches, setStockMismatches] = useState<StockMismatch[]>([]);
  const [loading, setLoading] = useState(false);
  const [ran, setRan]         = useState(false);

  const run = async () => {
    if (!company_id) return;
    setLoading(true);
    try {
      const data = await adapter.systemHealth.check(company_id, asOf);
      setResults(data);
      // Fan out drill-down fetches in parallel for any failing invariant that has one.
      const jeBal = data.find(r => r.invariant === 'JE_BAL');
      const b1    = data.find(r => r.invariant === 'B1');
      const e1    = data.find(r => r.invariant === 'E1');

      const [jeList, arList, stockList] = await Promise.all([
        jeBal && !jeBal.pass ? adapter.systemHealth.findMalformedJEs(company_id, asOf)   : Promise.resolve([] as MalformedJE[]),
        b1    && !b1.pass    ? adapter.systemHealth.findArMismatches(company_id, asOf)   : Promise.resolve([] as ArMismatch[]),
        e1    && !e1.pass    ? adapter.systemHealth.findStockMismatches(company_id, asOf): Promise.resolve([] as StockMismatch[]),
      ]);
      setMalformed(jeList);
      setArMismatches(arList);
      setStockMismatches(stockList);
      setRan(true);
    } catch (e) { console.error(e); }
    finally { setLoading(false); }
  };

  // Track per-JE repair state so the button can show a spinner / disabled state
  const [repairing, setRepairing] = useState<Record<string, boolean>>({});
  const [repairMsg, setRepairMsg] = useState<string | null>(null);

  const repair = async (je_id: string) => {
    if (!company_id) return;
    setRepairing(r => ({ ...r, [je_id]: true }));
    setRepairMsg(null);
    try {
      const result = await adapter.systemHealth.repairVendorBillJE(je_id);
      setRepairMsg(`✅ ${result.status}: ${result.rows_added} row(s) added. Body now ${result.new_body_debit.toFixed(2)} DR / ${result.new_body_credit.toFixed(2)} CR.`);
      // Re-run the full check to refresh status + drop repaired rows from the table
      await run();
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setRepairMsg(`❌ Repair failed: ${msg}`);
    } finally {
      setRepairing(r => ({ ...r, [je_id]: false }));
    }
  };

  const allPass = results.length > 0 && results.every(r => r.pass);
  const failCount = results.filter(r => !r.pass).length;

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-xl font-semibold text-ink-primary">{t('settings.system_health')}</h1>
        <p className="mt-1 text-sm text-ink-secondary">{t('settings.system_health_desc')}</p>
      </div>

      <div className="flex flex-wrap items-end gap-3 rounded-lg border border-border bg-surface-card p-4">
        <div>
          <label className="block text-xs text-ink-secondary mb-1">{t('reports.as_of_date')}</label>
          <input type="date" value={asOf} onChange={e => setAsOf(e.target.value)} className="input-field h-9 text-sm" />
        </div>
        <button onClick={run} disabled={loading} className="btn-primary h-9 px-5 text-sm font-semibold">
          {loading ? t('settings.running_checks') : t('settings.run_health_check')}
        </button>
      </div>

      {ran && (
        <>
          {/* Summary banner */}
          <div className={`flex items-center gap-3 rounded-lg px-5 py-4 text-sm font-semibold ${allPass ? 'bg-emerald-50 text-emerald-800 border border-emerald-200' : 'bg-red-50 text-red-800 border border-red-200'}`}>
            <span className="text-2xl">{allPass ? '✅' : '❌'}</span>
            <span>
              {allPass
                ? t('settings.all_invariants_pass')
                : t('settings.invariants_failed', { n: failCount })}
            </span>
          </div>

          {/* Invariant table */}
          <div className="overflow-x-auto rounded-lg border border-border bg-surface-card shadow-sm">
            <table className="w-full text-sm">
              <thead className="bg-surface-subtle">
                <tr>
                  <th className="px-4 py-2 text-left font-medium text-ink-secondary">{t('settings.invariant')}</th>
                  <th className="px-4 py-2 text-left font-medium text-ink-secondary">{t('settings.check')}</th>
                  <th className="px-4 py-2 text-center font-medium text-ink-secondary">{t('common.status')}</th>
                  <th className="px-4 py-2 text-right font-medium text-ink-secondary">{t('settings.difference')}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {results.map(r => (
                  <tr key={r.invariant as string} className={r.pass ? '' : 'bg-red-50'}>
                    <td className="px-4 py-2 font-mono text-xs text-ink-secondary">{r.invariant as string}</td>
                    <td className="px-4 py-2 text-ink-primary">{r.name as string}</td>
                    <td className="px-4 py-2 text-center">
                      <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-semibold ${r.pass ? 'bg-emerald-100 text-emerald-700' : 'bg-red-100 text-red-700'}`}>
                        {r.pass ? t('common.pass') : t('common.fail')}
                      </span>
                    </td>
                    <td className="px-4 py-2 text-right text-ink-secondary text-xs">
                      {typeof r.difference === 'number' ? r.difference.toFixed(2) : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* ── Malformed JE drill-down (shown when JE_BAL fails) ──────── */}
          {malformed.length > 0 && (
            <div className="overflow-x-auto rounded-lg border border-red-200 bg-surface-card shadow-sm">
              <div className="border-b border-red-200 bg-red-50 px-4 py-3">
                <p className="font-semibold text-red-800">Malformed journal entries ({malformed.length})</p>
                <p className="mt-0.5 text-xs text-red-700">
                  These journal entries are out of balance. Click an entry number to inspect the
                  underlying source document. To fix, void + repost the source document (invoice,
                  bill, payment, etc.) — or post a manual reversing JE.
                </p>
              </div>
              <table className="w-full text-sm">
                <thead className="bg-surface-subtle">
                  <tr>
                    <th className="px-3 py-2 text-left font-medium text-ink-secondary">Entry #</th>
                    <th className="px-3 py-2 text-left font-medium text-ink-secondary">Date</th>
                    <th className="px-3 py-2 text-left font-medium text-ink-secondary">Source</th>
                    <th className="px-3 py-2 text-right font-medium text-ink-secondary">Hdr DR / CR</th>
                    <th className="px-3 py-2 text-right font-medium text-ink-secondary">Body DR / CR</th>
                    <th className="px-3 py-2 text-right font-medium text-ink-secondary">Δ internal</th>
                    <th className="px-3 py-2 text-left font-medium text-ink-secondary">Problem</th>
                    <th className="px-3 py-2 text-right font-medium text-ink-secondary">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {malformed.map(je => {
                    const canRepair = je.source_type === 'vendor_bill';
                    const isRepairing = !!repairing[je.je_id];
                    return (
                      <tr key={je.je_id} className="hover:bg-surface-muted/50">
                        <td className="px-3 py-2 font-mono text-xs">
                          <button
                            type="button"
                            onClick={() => navigate(`/accounting/journal-entries/${je.je_id}`)}
                            className="text-brand-600 hover:underline"
                          >
                            {je.entry_number}
                          </button>
                        </td>
                        <td className="px-3 py-2 text-ink-secondary">{je.date}</td>
                        <td className="px-3 py-2 text-ink-secondary capitalize">
                          {(je.source_type ?? '').replace(/_/g, ' ') || '—'}
                        </td>
                        <td className="px-3 py-2 text-right font-mono text-xs text-ink-secondary">
                          {fmt(je.header_debit)} / {fmt(je.header_credit)}
                        </td>
                        <td className="px-3 py-2 text-right font-mono text-xs text-ink-primary">
                          {fmt(je.body_debit)} / {fmt(je.body_credit)}
                        </td>
                        <td className="px-3 py-2 text-right font-mono text-xs font-semibold text-red-700">
                          {fmt(je.delta_internal)}
                        </td>
                        <td className="px-3 py-2 text-xs text-red-700">{je.problem}</td>
                        <td className="px-3 py-2 text-right">
                          {canRepair ? (
                            <button
                              type="button"
                              onClick={() => repair(je.je_id)}
                              disabled={isRepairing}
                              className="rounded-pill bg-brand-600 px-3 py-1 text-xs font-semibold text-white hover:bg-brand-700 disabled:opacity-50"
                              title="Re-derive the missing GL rows + stock movement from the underlying vendor bill"
                            >
                              {isRepairing ? '…' : 'Repair'}
                            </button>
                          ) : (
                            <span className="text-xs text-ink-tertiary" title="Auto-repair only supports vendor_bill JEs in v1">
                              Manual fix
                            </span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              {repairMsg && (
                <div className="border-t border-border-subtle bg-surface-muted px-4 py-2 text-xs">
                  {repairMsg}
                </div>
              )}
            </div>
          )}

          {/* ── B1 drill-down: per-customer AR drift ───────────────────── */}
          {arMismatches.length > 0 && (
            <div className="overflow-x-auto rounded-lg border border-red-200 bg-surface-card shadow-sm">
              <div className="border-b border-red-200 bg-red-50 px-4 py-3">
                <p className="font-semibold text-red-800">AR drift by customer ({arMismatches.length})</p>
                <p className="mt-0.5 text-xs text-red-700">
                  These customers have a difference between what the AR aging
                  calc says they owe and what GL 1200 says. Common cause:
                  an unlinked credit note, or an apply_advance allocation that
                  pointed at a now-voided invoice. Click the customer name to
                  inspect their statement.
                </p>
              </div>
              <table className="w-full text-sm">
                <thead className="bg-surface-subtle">
                  <tr>
                    <th className="px-3 py-2 text-left font-medium text-ink-secondary">Customer</th>
                    <th className="px-3 py-2 text-right font-medium text-ink-secondary">GL says (1200)</th>
                    <th className="px-3 py-2 text-right font-medium text-ink-secondary">Aging calc</th>
                    <th className="px-3 py-2 text-right font-medium text-ink-secondary">Δ</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {arMismatches.map(r => (
                    <tr key={r.contact_id ?? r.contact_name} className="hover:bg-surface-muted/50">
                      <td className="px-3 py-2">
                        {r.contact_id ? (
                          <button
                            type="button"
                            onClick={() => navigate(`/contacts/customers/${r.contact_id}`)}
                            className="text-brand-600 hover:underline"
                          >
                            {r.contact_name}
                          </button>
                        ) : (
                          <span className="text-ink-tertiary">{r.contact_name}</span>
                        )}
                      </td>
                      <td className="px-3 py-2 text-right font-mono text-xs text-ink-secondary">{fmt(r.gl_balance)}</td>
                      <td className="px-3 py-2 text-right font-mono text-xs text-ink-primary">{fmt(r.aging_balance)}</td>
                      <td className="px-3 py-2 text-right font-mono text-xs font-semibold text-red-700">{fmt(r.difference)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {/* ── E1 drill-down: per-product stock value drift ───────────── */}
          {stockMismatches.length > 0 && (
            <div className="overflow-x-auto rounded-lg border border-amber-200 bg-surface-card shadow-sm">
              <div className="border-b border-amber-200 bg-amber-50 px-4 py-3">
                <p className="font-semibold text-amber-800">Stock value drift by product ({stockMismatches.length})</p>
                <p className="mt-0.5 text-xs text-amber-700">
                  For each product, the latest "running qty × MAC" should
                  equal the sum of all its stock_ledger movements. A drift
                  usually means a stock row was written with a different
                  unit cost than the GL entry (the discount-on-vendor-bill
                  bug — now fixed for new bills). Click the product name
                  to inspect its stock ledger.
                </p>
              </div>
              <table className="w-full text-sm">
                <thead className="bg-surface-subtle">
                  <tr>
                    <th className="px-3 py-2 text-left font-medium text-ink-secondary">Product</th>
                    <th className="px-3 py-2 text-left font-medium text-ink-secondary">SKU</th>
                    <th className="px-3 py-2 text-right font-medium text-ink-secondary">Latest value (qty × MAC)</th>
                    <th className="px-3 py-2 text-right font-medium text-ink-secondary">Txn-sum</th>
                    <th className="px-3 py-2 text-right font-medium text-ink-secondary">Δ</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {stockMismatches.map(r => (
                    <tr key={r.product_id ?? r.sku} className="hover:bg-surface-muted/50">
                      <td className="px-3 py-2">
                        {r.product_id ? (
                          <button
                            type="button"
                            onClick={() => navigate(`/products/${r.product_id}`)}
                            className="text-brand-600 hover:underline"
                          >
                            {r.product_name}
                          </button>
                        ) : (
                          <span className="text-ink-tertiary">{r.product_name}</span>
                        )}
                      </td>
                      <td className="px-3 py-2 text-ink-secondary text-xs font-mono">{r.sku}</td>
                      <td className="px-3 py-2 text-right font-mono text-xs text-ink-primary">{fmt(r.stock_value)}</td>
                      <td className="px-3 py-2 text-right font-mono text-xs text-ink-secondary">{fmt(r.stock_txn_sum)}</td>
                      <td className="px-3 py-2 text-right font-mono text-xs font-semibold text-amber-700">{fmt(r.difference)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {!allPass && (
            <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-800">
              <p className="font-semibold">{t('settings.health_fail_action')}</p>
              <p className="mt-1 text-red-700">{t('settings.health_fail_desc')}</p>
            </div>
          )}
        </>
      )}
    </div>
  );
}
