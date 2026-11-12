import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { getAdapter } from '@/data';
import { useAuthStore } from '@/store/auth';
import { OceanPage } from '@/components/ocean-list';
import { ShieldCheck, ShieldAlert, Loader2 } from 'lucide-react';
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
    // Ocean Teal (UI v1.1): look only — same checks, drill-downs and repair.
    <OceanPage testid="system-health-ocean" title={t('settingsNav.items.system_health.title')} subtitle={t('settings.system_health_desc')}>
      <section className="sb-card sb-health-run">
        <label className="sb-select-field">
          <span className="sb-select-label">{t('reports.as_of_date')}</span>
          <input type="date" dir="ltr" className="sb-field" value={asOf} onChange={e => setAsOf(e.target.value)} aria-label={t('reports.as_of_date')} />
        </label>
        <button type="button" onClick={run} disabled={loading} className="sb-primary-btn sb-btn-inline">
          {loading ? <Loader2 size={18} className="sb-spin" aria-hidden="true" /> : <ShieldCheck size={18} aria-hidden="true" />}
          {loading ? t('settings.running_checks') : t('settings.run_health_check')}
        </button>
      </section>

      {ran && (
        <>
          {/* Summary banner */}
          <div className={`sb-alert ${allPass ? 'sb-alert-good' : 'sb-alert-danger'} sb-health-summary`} role="status">
            {allPass ? <ShieldCheck size={22} aria-hidden="true" /> : <ShieldAlert size={22} aria-hidden="true" />}
            <span>
              {allPass
                ? t('settings.all_invariants_pass')
                : t('settings.invariants_failed', { n: failCount })}
            </span>
          </div>

          {/* Invariant table */}
          <div className="sb-card sb-dtable-wrap">
            <table className="sb-dtable">
              <thead>
                <tr>
                  <th>{t('settings.invariant')}</th>
                  <th>{t('settings.check')}</th>
                  <th style={{ textAlign: 'center' }}>{t('common.status')}</th>
                  <th className="sb-num">{t('settings.difference')}</th>
                </tr>
              </thead>
              <tbody>
                {results.map(r => (
                  <tr key={r.invariant as string} className={r.pass ? '' : 'is-bad'}>
                    <td><bdi dir="ltr" className="sb-mono sb-fx-name">{r.invariant as string}</bdi></td>
                    <td>{r.name as string}</td>
                    <td style={{ textAlign: 'center' }}>
                      <span className={`sb-pill ${r.pass ? 'sb-pill-good' : 'sb-pill-bad'}`}>
                        {r.pass ? t('common.pass') : t('common.fail')}
                      </span>
                    </td>
                    <td className="sb-num">
                      <bdi dir="ltr">{typeof r.difference === 'number' ? r.difference.toFixed(2) : '—'}</bdi>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* ── Malformed JE drill-down (shown when JE_BAL fails) ──────── */}
          {malformed.length > 0 && (
            <div className="sb-card sb-dtable-wrap sb-drill is-bad">
              <div className="sb-drill-head">
                <p className="sb-drill-title">{t('settingsPages.health.je_title')} <span className="sb-tab-count">{malformed.length}</span></p>
                <p className="sb-form-hint">{t('settingsPages.health.je_desc')}</p>
              </div>
              <table className="sb-dtable">
                <thead>
                  <tr>
                    <th>{t('settingsPages.health.c_entry')}</th>
                    <th>{t('settingsPages.health.c_date')}</th>
                    <th>{t('settingsPages.health.c_source')}</th>
                    <th className="sb-num">{t('settingsPages.health.c_hdr')}</th>
                    <th className="sb-num">{t('settingsPages.health.c_body')}</th>
                    <th className="sb-num">{t('settingsPages.health.c_delta_int')}</th>
                    <th>{t('settingsPages.health.c_problem')}</th>
                    <th className="sb-num">{t('settingsPages.health.c_action')}</th>
                  </tr>
                </thead>
                <tbody>
                  {malformed.map(je => {
                    const canRepair = je.source_type === 'vendor_bill';
                    const isRepairing = !!repairing[je.je_id];
                    return (
                      <tr key={je.je_id}>
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
                        <td className="sb-num sb-mono">
                          {fmt(je.header_debit)} / {fmt(je.header_credit)}
                        </td>
                        <td className="sb-num sb-mono">
                          {fmt(je.body_debit)} / {fmt(je.body_credit)}
                        </td>
                        <td className="sb-num sb-mono sb-bad">
                          {fmt(je.delta_internal)}
                        </td>
                        <td className="px-3 py-2 text-xs text-red-700">{je.problem}</td>
                        <td className="px-3 py-2 text-right">
                          {canRepair ? (
                            <button
                              type="button"
                              onClick={() => repair(je.je_id)}
                              disabled={isRepairing}
                              className="sb-primary-btn" style={{ minHeight: 36, padding: '0 14px', fontSize: 13 }}
                              title={t('settingsPages.health.repair_title')}
                            >
                              {isRepairing ? '…' : t('settingsPages.health.repair')}
                            </button>
                          ) : (
                            <span className="sb-fx-name" title={t('settingsPages.health.manual_title')}>
                              {t('settingsPages.health.manual')}
                            </span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              {repairMsg && (
                <div className="sb-drill-foot">
                  {repairMsg}
                </div>
              )}
            </div>
          )}

          {/* ── B1 drill-down: per-customer AR drift ───────────────────── */}
          {arMismatches.length > 0 && (
            <div className="sb-card sb-dtable-wrap sb-drill is-bad">
              <div className="sb-drill-head">
                <p className="sb-drill-title">{t('settingsPages.health.ar_title')} <span className="sb-tab-count">{arMismatches.length}</span></p>
                <p className="sb-form-hint">{t('settingsPages.health.ar_desc')}</p>
              </div>
              <table className="sb-dtable">
                <thead>
                  <tr>
                    <th>{t('settingsPages.health.c_customer')}</th>
                    <th className="sb-num">{t('settingsPages.health.c_gl1200')}</th>
                    <th className="sb-num">{t('settingsPages.health.c_aging')}</th>
                    <th className="sb-num">Δ</th>
                  </tr>
                </thead>
                <tbody>
                  {arMismatches.map(r => (
                    <tr key={r.contact_id ?? r.contact_name}>
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
                      <td className="sb-num sb-mono">{fmt(r.gl_balance)}</td>
                      <td className="sb-num sb-mono">{fmt(r.aging_balance)}</td>
                      <td className="sb-num sb-mono sb-bad">{fmt(r.difference)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {/* ── E1 drill-down: per-product stock value drift ───────────── */}
          {stockMismatches.length > 0 && (
            <div className="sb-card sb-dtable-wrap sb-drill is-warn">
              <div className="sb-drill-head">
                <p className="sb-drill-title">{t('settingsPages.health.stock_title')} <span className="sb-tab-count">{stockMismatches.length}</span></p>
                <p className="sb-form-hint">{t('settingsPages.health.stock_desc')}</p>
              </div>
              <table className="sb-dtable">
                <thead>
                  <tr>
                    <th>{t('settingsPages.health.c_product')}</th>
                    <th>{t('settingsPages.health.c_sku')}</th>
                    <th className="sb-num">{t('settingsPages.health.c_latest')}</th>
                    <th className="sb-num">{t('settingsPages.health.c_txn')}</th>
                    <th className="sb-num">Δ</th>
                  </tr>
                </thead>
                <tbody>
                  {stockMismatches.map(r => (
                    <tr key={r.product_id ?? r.sku}>
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
                      <td className="sb-num sb-mono">{fmt(r.stock_value)}</td>
                      <td className="sb-num sb-mono">{fmt(r.stock_txn_sum)}</td>
                      <td className="sb-num sb-mono sb-warn">{fmt(r.difference)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {!allPass && (
            <div className="sb-alert sb-alert-danger" style={{ fontWeight: 400 }}>
              <p style={{ margin: 0, fontWeight: 700 }}>{t('settings.health_fail_action')}</p>
              <p style={{ margin: '4px 0 0' }}>{t('settings.health_fail_desc')}</p>
            </div>
          )}
        </>
      )}
    </OceanPage>
  );
}
