/**
 * Import / Export hub — Phase 14.11a.
 *
 * One settings page that consolidates bulk operations across every
 * master-data table. Three-step wizard for each module:
 *
 *   1. Pick module + format (CSV / XLSX)
 *   2. Either Download template OR Export current data OR Upload a file
 *   3. (Import only) Preview parsed rows with validation, choose
 *      duplicate policy, click Import to commit.
 *
 * 14.11a ships Products as the reference end-to-end implementation;
 * subsequent phases (14.11b+) plug additional modules into the same
 * shape (productsAdapter → contactsAdapter, coaAdapter, …).
 */

import { useState, useMemo } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useAuthStore } from '@/store/auth';
import { useCompanyCurrency } from '@/hooks/use-company-currency';
import { BackupCard } from './_backup-card';
import { BackButton } from '@/ui/back-button';
import { useTranslation } from 'react-i18next';
import { OceanPage } from '@/components/ocean-list';
import {
  downloadCSV, downloadXLSX, readPickedFile, type RawRow,
} from './_io';
import { productsAdapter, buildProductLookups, serializeProductsForExport } from './_adapters/products';
import { contactsAdapter, contactNaturalKey } from './_adapters/contacts';
import {
  taxRatesAdapter, unitsAdapter, brandsAdapter,
  salespeopleAdapter, warehousesAdapter, priceLevelsAdapter,
} from './_adapters/simple-masters';
import { categoriesAdapter, buildCategoryLookups, serializeCategoriesForExport } from './_adapters/categories';
import { coaAdapter, buildCoaLookups } from './_adapters/coa';
import { openingBalancesAdapter, buildOBLookups } from './_adapters/opening-balances';
import type { ModuleAdapter, ImportContext, ApplyResult, DuplicatePolicy } from './_adapters/types';

// Registry — each entry is the same ModuleAdapter contract. Adding a
// new module = drop a file in _adapters/, import here, add the loaders.
interface ModuleEntry {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  adapter: ModuleAdapter<any, any>;
  // Build the (module-specific) lookups map used by validate() + apply().
  buildLookups: (company_id: string) => Promise<Record<string, unknown>>;
  // Custom export serialiser when the adapter's stock serialize() needs
  // extra context (e.g. ID → name resolution).
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  exportSerialize: (rows: any[], company_id: string) => Promise<Record<string, string>[]>;
  // Natural-key extractor for dedup detection during validate().
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  naturalKey: (row: any) => string;
  // Optional — attach module-specific flags to the existing-map entry
  // (e.g. CoA stashes `is_system`). Default is just { id }.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  enrichExisting?: (row: any) => Record<string, unknown>;
}

// Default exportSerialize when the adapter's serialize() is sufficient.
// The second type-param of ModuleAdapter varies across modules; using
// `any` here is the variance edge-case the wizard accepts because each
// adapter is the only thing that introspects its own validated rows.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function plainExportSerialize<R>(
  rows: R[],
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  adapter: ModuleAdapter<R, any>,
): Promise<Record<string, string>[]> {
  return rows.map(r => adapter.serialize(r));
}
async function noLookups(): Promise<Record<string, unknown>> { return {}; }

const MODULES: Record<string, ModuleEntry> = {
  products: {
    adapter: productsAdapter,
    buildLookups: async (cid) => buildProductLookups(cid) as unknown as Record<string, unknown>,
    exportSerialize: (rows, cid) => serializeProductsForExport(rows, cid),
    naturalKey: (r) => r.sku.toUpperCase(),
  },
  contacts: {
    adapter: contactsAdapter,
    buildLookups: noLookups,
    exportSerialize: (rows) => plainExportSerialize(rows, contactsAdapter),
    naturalKey: (r) => contactNaturalKey(r),
  },
  coa: {
    adapter: coaAdapter,
    buildLookups: buildCoaLookups,
    exportSerialize: (rows) => plainExportSerialize(rows, coaAdapter),
    naturalKey: (r) => `code:${(r.code as string).toLowerCase()}`,
    // CoA stashes is_system so validate() can refuse to overwrite
    // protected rows during the apply step.
    enrichExisting: (r) => ({ is_system: r.is_system === true }),
  },
  taxRates: {
    adapter: taxRatesAdapter,
    buildLookups: noLookups,
    exportSerialize: (rows) => plainExportSerialize(rows, taxRatesAdapter),
    naturalKey: (r) => `name:${(r.name as string).toLowerCase()}`,
  },
  units: {
    adapter: unitsAdapter,
    buildLookups: noLookups,
    exportSerialize: (rows) => plainExportSerialize(rows, unitsAdapter),
    naturalKey: (r) => `code:${(r.code as string).toUpperCase()}`,
  },
  brands: {
    adapter: brandsAdapter,
    buildLookups: noLookups,
    exportSerialize: (rows) => plainExportSerialize(rows, brandsAdapter),
    naturalKey: (r) => `name:${(r.name as string).toLowerCase()}`,
  },
  categories: {
    adapter: categoriesAdapter,
    buildLookups: async (cid) => buildCategoryLookups(cid) as unknown as Record<string, unknown>,
    exportSerialize: (rows) => serializeCategoriesForExport(rows),
    naturalKey: (r) => `name:${(r.name as string).toLowerCase()}`,
  },
  salespeople: {
    adapter: salespeopleAdapter,
    buildLookups: noLookups,
    exportSerialize: (rows) => plainExportSerialize(rows, salespeopleAdapter),
    naturalKey: (r) => `name:${(r.name as string).toLowerCase()}`,
  },
  warehouses: {
    adapter: warehousesAdapter,
    buildLookups: noLookups,
    exportSerialize: (rows) => plainExportSerialize(rows, warehousesAdapter),
    naturalKey: (r) => `code:${(r.code as string).toLowerCase()}`,
  },
  priceLevels: {
    adapter: priceLevelsAdapter,
    buildLookups: noLookups,
    exportSerialize: (rows) => plainExportSerialize(rows, priceLevelsAdapter),
    naturalKey: (r) => `name:${(r.name as string).toLowerCase()}`,
  },
  // Phase 14.11d — bulk import of opening balances. No exportable rows
  // (openings live in invoices/bills/payments via the 14.09 wizard),
  // so "Export current" is a no-op for this module. The point is the
  // import path for bulk migration from a prior system.
  openingBalances: {
    adapter: openingBalancesAdapter,
    buildLookups: async (cid) => buildOBLookups(cid) as unknown as Record<string, unknown>,
    exportSerialize: async () => [],
    // No dedup — every row is a new posting; ImportContext.existing
    // stays empty so the duplicate banner never appears for this module.
    naturalKey: () => '',
  },
};

// ── Local types for the wizard ──────────────────────────────────────────────
type Step = 'pick' | 'upload' | 'preview' | 'done';

interface PreviewRow {
  raw:    RawRow;
  ok:     boolean;
  row?:   unknown;
  errors: string[];
  /** True when the parsed row matches an existing record by natural key. */
  isDuplicate: boolean;
}

export default function ImportExportHub() {
  const { company_id } = useAuthStore();
  const company_currency = useCompanyCurrency();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [searchParams] = useSearchParams();

  // Phase 14.11c — page-level "Import / Export" buttons deep-link here
  // via ?module=products / contacts / coa / taxRates / units / brands /
  // categories / salespeople / warehouses / priceLevels. We pre-select
  // that module on mount so the operator lands on the right card.
  const initialModuleKey = (() => {
    const fromUrl = searchParams.get('module');
    return fromUrl && fromUrl in MODULES ? fromUrl : null;
  })();
  const [moduleKey, setModuleKey] = useState<string | null>(initialModuleKey);
  const [format,    setFormat]    = useState<'csv' | 'xlsx'>('csv');
  const [step,      setStep]      = useState<Step>('pick');
  const [policy,    setPolicy]    = useState<DuplicatePolicy>('skip');

  // Parsed file state.
  const [fileName,     setFileName]     = useState<string | null>(null);
  const [previewRows,  setPreviewRows]  = useState<PreviewRow[]>([]);
  const [parseError,   setParseError]   = useState<string | null>(null);
  const { t } = useTranslation();
  // Module names / blurbs come from each adapter in English (the fallback);
  // file column headers are part of the file format and stay as they are.
  const modLabel = (k: string, fallback: string) => t(`settingsPages.io.mod.${k}.label`, { defaultValue: fallback });
  const modDesc = (k: string, fallback: string) => t(`settingsPages.io.mod.${k}.desc`, { defaultValue: fallback });
  const [posting,      setPosting]      = useState(false);
  const [applyResult,  setApplyResult]  = useState<ApplyResult | null>(null);

  const entry  = moduleKey ? MODULES[moduleKey] : null;
  const adapter = entry?.adapter ?? null;

  // Pre-fetch existing rows for the chosen module so we can detect
  // duplicates during validate(). Also feeds the Export action.
  const { data: existingRows = [] } = useQuery({
    queryKey: ['import_existing', moduleKey, company_id],
    queryFn:  () => entry!.adapter.fetchAll(company_id!),
    enabled:  !!entry && !!company_id,
  });

  // ── Template download ─────────────────────────────────────────────────────
  function downloadTemplate() {
    if (!adapter) return;
    const rows = adapter.template();
    const filename = `${adapter.key}-template.${format}`;
    if (format === 'csv') downloadCSV(rows, adapter.headers, filename);
    else                  downloadXLSX(rows, adapter.headers, filename);
  }

  // ── Export ────────────────────────────────────────────────────────────────
  async function exportCurrent() {
    if (!entry || !adapter || !company_id) return;
    const rows = await entry.exportSerialize(existingRows, company_id);
    const filename = `${adapter.key}-${new Date().toISOString().slice(0,10)}.${format}`;
    if (format === 'csv') downloadCSV(rows, adapter.headers, filename);
    else                  await downloadXLSX(rows, adapter.headers, filename);
  }

  // ── File pick → parse → validate ──────────────────────────────────────────
  async function handleFile(file: File) {
    if (!entry || !adapter || !company_id) return;
    setParseError(null);
    setPreviewRows([]);
    setApplyResult(null);
    setFileName(file.name);

    const { result } = await readPickedFile(file);
    if (result.errors.length > 0) {
      setParseError(result.errors.join(' · '));
      return;
    }
    if (result.rows.length === 0) {
      setParseError(t('settingsPages.io.err_empty'));
      return;
    }
    // Header sanity-check — soft warning if any required headers missing.
    const missing = adapter.headers.filter(h => !result.headers.includes(h)).filter(h => ['sku','name'].includes(h));
    if (missing.length > 0) {
      setParseError(t('settingsPages.io.err_missing', { cols: missing.join(', ') }));
      return;
    }

    // Build the import context.
    const lookups = await entry.buildLookups(company_id);
    const existingMap = new Map<string, { id: string; [k: string]: unknown }>();
    for (const r of existingRows) {
      const base = { id: (r as { id: string }).id };
      const extra = entry.enrichExisting ? entry.enrichExisting(r) : {};
      existingMap.set(entry.naturalKey(r), { ...base, ...extra });
    }
    const ctx: ImportContext = { company_id, company_currency, existing: existingMap, lookups };

    const preview: PreviewRow[] = result.rows.map(raw => {
      const v = adapter.validate(raw, ctx);
      const key = entry.naturalKey({ sku: raw.sku });   // approximation; per-module
      return {
        raw,
        ok: v.ok,
        row: v.ok ? v.row : undefined,
        errors: v.ok ? [] : v.errors,
        isDuplicate: existingMap.has(key),
      };
    });
    setPreviewRows(preview);
    setStep('preview');
  }

  // ── Apply ────────────────────────────────────────────────────────────────
  async function applyImport() {
    if (!entry || !adapter || !company_id) return;
    const valid = previewRows.filter(p => p.ok).map(p => p.row);
    if (valid.length === 0) return;
    setPosting(true);
    try {
      const lookups = await entry.buildLookups(company_id);
      const existingMap = new Map<string, { id: string }>();
      for (const r of existingRows) {
        existingMap.set(entry.naturalKey(r), { id: (r as { id: string }).id });
      }
      const ctx: ImportContext = { company_id, company_currency, existing: existingMap, lookups };
      const result = await adapter.apply(valid as unknown[], ctx, policy);
      setApplyResult(result);
      setStep('done');
      // Invalidate the relevant caches so the list pages pick up new rows.
      await qc.invalidateQueries({ queryKey: ['products', company_id] });
      await qc.invalidateQueries({ queryKey: ['import_existing', moduleKey, company_id] });
    } catch (e) {
      setParseError(e instanceof Error ? e.message : t('settingsPages.io.err_apply'));
    } finally {
      setPosting(false);
    }
  }

  function startOver() {
    setStep('pick');
    setFileName(null);
    setPreviewRows([]);
    setApplyResult(null);
    setParseError(null);
  }

  const validCount   = useMemo(() => previewRows.filter(r => r.ok).length, [previewRows]);
  const errorCount   = useMemo(() => previewRows.filter(r => !r.ok).length, [previewRows]);
  const dupCount     = useMemo(() => previewRows.filter(r => r.isDuplicate).length, [previewRows]);

  // ── Render ───────────────────────────────────────────────────────────────
  return (
    // Ocean Teal (UI v1.1): look only — same modules, templates, export,
    // file parsing, validation preview, duplicate policy and import.
    <OceanPage
      testid="import-export-ocean"
      back={<BackButton to="/settings" label={t('settingsNav.title')} />}
      title={t('settingsNav.items.import_export.title')}
      subtitle={t('settingsNav.items.import_export.desc')}
    >
      <div className="sb-info-note">
        <p style={{ margin: 0 }}>
          {t('settingsPages.io.intro')}{' '}
          <button type="button" onClick={() => navigate('/settings/opening-balances')} className="sb-row-link text-brand-600" style={{ minHeight: 0, padding: 0, textDecoration: 'underline' }}>
            {t('settingsPages.io.ob_wizard')}
          </button>.
        </p>
        <p style={{ margin: '6px 0 0', fontSize: 13 }}>{t('settingsPages.io.tip')}</p>
      </div>

      {/* Module picker */}
      {/* Phase 102 — the whole company, not just the eight master-data
          modules below. Placed above the wizard because "get everything out"
          is the bigger question, and the wizard reads as the answer to it. */}
      <BackupCard />

      <section className="sb-card">
        <h2 className="sb-form-title" style={{ lineHeight: 1.3, marginBottom: 12 }}>{t('settingsPages.io.pick')}</h2>
        <div className="sb-io-grid">
          {Object.entries(MODULES).map(([key, entry]) => {
            const isActive = moduleKey === key;
            return (
              <button
                key={key}
                type="button"
                aria-pressed={isActive}
                onClick={() => { setModuleKey(key); startOver(); }}
                className={`sb-io-tile ${isActive ? 'is-on' : ''}`}
              >
                <span className="sb-io-emoji" aria-hidden="true">{entry.adapter.icon}</span>
                <span className="sb-io-name">{modLabel(key, entry.adapter.label)}</span>
                <span className="sb-io-desc">{modDesc(key, entry.adapter.description)}</span>
              </button>
            );
          })}
        </div>
      </section>

      {/* Actions for the picked module */}
      {entry && adapter && (
        <>
          <section className="sb-card">
            <div className="sb-users-head" style={{ marginBottom: 12 }}>
              <h2 className="sb-form-title" style={{ flex: 1, lineHeight: 1.3 }}>
                {modLabel(adapter.key, adapter.label)} <span className="sb-tab-count">{t('settingsPages.io.in_system', { count: existingRows.length })}</span>
              </h2>
              {/* Format toggle */}
              <div className="sb-seg" role="group" aria-label={t('settingsPages.io.format')}>
                {(['csv','xlsx'] as const).map(f => (
                  <button
                    key={f}
                    type="button"
                    aria-pressed={format === f}
                    className={format === f ? 'active' : ''}
                    onClick={() => setFormat(f)}
                  ><bdi dir="ltr">{f.toUpperCase()}</bdi></button>
                ))}
              </div>
            </div>
            <div className="sb-io-actions">
              <ActionCard
                title={t('settingsPages.io.a1_title')}
                description={t('settingsPages.io.a1_desc', { format: format.toUpperCase() })}
                cta={t('settingsPages.io.a1_cta', { format: format.toUpperCase() })}
                onClick={downloadTemplate}
              />
              <ActionCard
                title={t('settingsPages.io.a2_title')}
                description={t('settingsPages.io.a2_desc', { module: modLabel(adapter.key, adapter.label) })}
                cta={existingRows.length === 0 ? t('settingsPages.io.a2_none') : t('settingsPages.io.a2_cta', { count: existingRows.length })}
                onClick={exportCurrent}
                disabled={existingRows.length === 0}
              />
              <ActionCard
                title={t('settingsPages.io.a3_title')}
                description={t('settingsPages.io.a3_desc')}
                cta={fileName ? t('settingsPages.io.a3_replace', { file: fileName }) : t('settingsPages.io.a3_cta')}
                onClick={() => document.getElementById('ie-file-input')?.click()}
                accent
              />
              <input
                id="ie-file-input"
                type="file"
                accept=".csv,.xlsx,.xls,.txt"
                hidden
                onChange={async (e) => {
                  const f = e.target.files?.[0];
                  if (f) await handleFile(f);
                  e.target.value = '';
                }}
              />
            </div>
          </section>

          {parseError && <p className="sb-alert sb-alert-danger" role="alert">{parseError}</p>}

          {/* Preview section */}
          {step === 'preview' && previewRows.length > 0 && (
            <section className="sb-card" style={{ padding: 0, overflow: 'hidden' }}>
              <div className="sb-io-preview-head">
                <div style={{ minWidth: 0 }}>
                  <h2 className="sb-form-title" style={{ lineHeight: 1.3 }}>{t('settingsPages.io.preview')} — <bdi>{fileName}</bdi></h2>
                  <div className="sb-wh-badges" style={{ marginTop: 6 }}>
                    <span className="sb-pill sb-pill-good">{t('settingsPages.io.valid', { count: validCount })}</span>
                    {errorCount > 0 && <span className="sb-pill sb-pill-bad">{t('settingsPages.io.with_errors', { count: errorCount })}</span>}
                    {dupCount > 0 && <span className="sb-pill sb-pill-warn">{t('settingsPages.io.duplicates', { count: dupCount })}</span>}
                  </div>
                </div>
                <div className="sb-io-preview-actions">
                  {dupCount > 0 && (
                    <label className="sb-select-field">
                      <span className="sb-select-label">{adapter.key === 'products' ? t('settingsPages.io.on_dup_sku') : t('settingsPages.io.on_dup_key')}</span>
                      <select className="sb-field sb-print-input" value={policy} onChange={(e) => setPolicy(e.target.value as DuplicatePolicy)}>
                        <option value="skip">{t('settingsPages.io.pol_skip')}</option>
                        <option value="update">{t('settingsPages.io.pol_update')}</option>
                        <option value="error">{t('settingsPages.io.pol_error')}</option>
                      </select>
                    </label>
                  )}
                  <button type="button" className="sb-secondary-btn" onClick={startOver}>{t('common.cancel')}</button>
                  <button type="button" className="sb-primary-btn" onClick={applyImport} disabled={validCount === 0 || posting}>
                    {posting ? t('settingsPages.io.importing') : t('settingsPages.io.import_rows', { count: validCount })}
                  </button>
                </div>
              </div>
              <div className="overflow-x-auto max-h-[500px]">
                <table className="w-full text-xs">
                  <thead className="sticky top-0 bg-surface-muted">
                    <tr className="border-b border-border-subtle text-ink-tertiary">
                      <th className="px-2 py-1.5 text-end font-medium w-[40px]">#</th>
                      <th className="px-2 py-1.5 text-start font-medium w-[80px]">{t('settingsPages.io.status')}</th>
                      {adapter.headers.map(h => (
                        <th key={h} className="px-2 py-1.5 text-start font-medium whitespace-nowrap">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {previewRows.map((p, idx) => (
                      <tr
                        key={idx}
                        className="border-b border-border-subtle last:border-0"
                        style={{ background: !p.ok ? '#FEF2F2' : p.isDuplicate ? '#FFFBEB' : undefined }}
                      >
                        <td className="px-2 py-1.5 text-end text-ink-tertiary">{idx + 1}</td>
                        <td className="px-2 py-1.5">
                          {!p.ok ? (
                            <span className="sb-pill sb-pill-bad">{t('settingsPages.io.st_error')}</span>
                          ) : p.isDuplicate ? (
                            <span className="sb-pill sb-pill-warn">{t('settingsPages.io.st_dup')}</span>
                          ) : (
                            <span className="sb-pill sb-pill-good">{t('settingsPages.io.st_ok')}</span>
                          )}
                        </td>
                        {adapter.headers.map(h => (
                          <td key={h} className="px-2 py-1.5 text-ink-secondary whitespace-nowrap">
                            {p.raw[h] ?? ''}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {errorCount > 0 && (
                <div className="border-t border-border-subtle p-3 bg-red-50 text-xs">
                  <div className="font-semibold text-red-800 mb-1">{t('settingsPages.io.errors_found')}</div>
                  <ul className="space-y-1 text-red-700 max-h-32 overflow-y-auto">
                    {previewRows
                      .map((p, idx) => ({ p, idx }))
                      .filter(({ p }) => !p.ok)
                      .slice(0, 20)
                      .map(({ p, idx }) => (
                        <li key={idx}>
                          <strong>{t('settingsPages.io.row', { n: idx + 1 })}</strong> {p.errors.join(', ')}
                        </li>
                      ))}
                    {errorCount > 20 && (
                      <li className="italic">{t('settingsPages.io.and_more', { count: errorCount - 20 })}</li>
                    )}
                  </ul>
                </div>
              )}
            </section>
          )}

          {/* Done state */}
          {step === 'done' && applyResult && (
            <section className="sb-card sb-io-done">
              <h2 className="sb-form-title" style={{ lineHeight: 1.3 }}>{t('settingsPages.io.done')}</h2>
              <div className="sb-io-stats">
                <Stat label={t('settingsPages.io.inserted')} value={applyResult.inserted} good />
                <Stat label={t('settingsPages.io.updated')}  value={applyResult.updated}  good />
                <Stat label={t('settingsPages.io.skipped')}  value={applyResult.skipped} />
                <Stat label={t('settingsPages.io.errors')}   value={applyResult.errors.length} bad={applyResult.errors.length > 0} />
              </div>
              {applyResult.errors.length > 0 && (
                <div className="mt-3 text-xs">
                  <strong>{t('settingsPages.io.row_errors')}</strong>
                  <ul className="mt-1 space-y-0.5 text-red-700 max-h-32 overflow-y-auto">
                    {applyResult.errors.map((e, i) => (
                      <li key={i}>{t('settingsPages.io.row', { n: e.rowIndex + 1 })} {e.message}</li>
                    ))}
                  </ul>
                </div>
              )}
              <div className="sb-form-actions" style={{ justifyContent: 'flex-start', marginTop: 14 }}>
                <button type="button" className="sb-secondary-btn" onClick={startOver}>{t('settingsPages.io.another')}</button>
                <button type="button" className="sb-primary-btn sb-btn-inline" onClick={() => navigate('/catalog/products')}>{t('settingsPages.io.view_products')} <span className="sb-flip" aria-hidden="true">→</span></button>
              </div>
            </section>
          )}
        </>
      )}
    </OceanPage>
  );
}

// ── Tiny presentational helpers ────────────────────────────────────────────
function ActionCard({
  title, description, cta, onClick, disabled, accent,
}: {
  title: string; description: string; cta: string;
  onClick: () => void; disabled?: boolean; accent?: boolean;
}) {
  return (
    <div className={`sb-io-action ${accent ? 'is-on' : ''}`}>
      <div className="sb-io-name">{title}</div>
      <div className="sb-io-desc" style={{ flex: 1 }}>{description}</div>
      <button type="button" className={accent ? 'sb-primary-btn' : 'sb-secondary-btn'} disabled={disabled} onClick={onClick}>
        <bdi>{cta}</bdi>
      </button>
    </div>
  );
}

function Stat({ label, value, good, bad }: { label: string; value: number; good?: boolean; bad?: boolean }) {
  const color = bad ? 'var(--sb-danger)' : good ? 'var(--sb-success)' : 'var(--sb-text-secondary)';
  return (
    <div className="sb-stat">
      <div className="sb-info-label">{label}</div>
      <div style={{ marginTop: '2px', fontSize: '20px', fontWeight: 700, color, fontVariantNumeric: 'tabular-nums' }}>
        {value}
      </div>
    </div>
  );
}
