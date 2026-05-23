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
import { useNavigate } from 'react-router-dom';
import { useAuthStore } from '@/store/auth';
import { Button } from '@/ui/button';
import {
  downloadCSV, downloadXLSX, readPickedFile, type RawRow,
} from './_io';
import { productsAdapter, buildProductLookups, serializeProductsForExport } from './_adapters/products';
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
}

const MODULES: Record<string, ModuleEntry> = {
  products: {
    adapter: productsAdapter,
    buildLookups: async (cid) => buildProductLookups(cid) as unknown as Record<string, unknown>,
    exportSerialize: (rows, cid) => serializeProductsForExport(rows, cid),
    naturalKey: (r) => r.sku.toUpperCase(),
  },
  // 14.11b+ will add: contacts, coa, taxRates, units, brands, categories,
  // salespeople, warehouses, priceLevels, opening-balances bulk CSV.
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
  const navigate = useNavigate();
  const qc = useQueryClient();

  const [moduleKey, setModuleKey] = useState<string | null>(null);
  const [format,    setFormat]    = useState<'csv' | 'xlsx'>('csv');
  const [step,      setStep]      = useState<Step>('pick');
  const [policy,    setPolicy]    = useState<DuplicatePolicy>('skip');

  // Parsed file state.
  const [fileName,     setFileName]     = useState<string | null>(null);
  const [previewRows,  setPreviewRows]  = useState<PreviewRow[]>([]);
  const [parseError,   setParseError]   = useState<string | null>(null);
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
      setParseError('The file contains no data rows. Check that the first row is headers and there is data below.');
      return;
    }
    // Header sanity-check — soft warning if any required headers missing.
    const missing = adapter.headers.filter(h => !result.headers.includes(h)).filter(h => ['sku','name'].includes(h));
    if (missing.length > 0) {
      setParseError(`Missing required column(s): ${missing.join(', ')}. Download the template for the correct format.`);
      return;
    }

    // Build the import context.
    const lookups = await entry.buildLookups(company_id);
    const existingMap = new Map<string, { id: string }>();
    for (const r of existingRows) {
      existingMap.set(entry.naturalKey(r), { id: (r as { id: string }).id });
    }
    const ctx: ImportContext = { company_id, existing: existingMap, lookups };

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
      const ctx: ImportContext = { company_id, existing: existingMap, lookups };
      const result = await adapter.apply(valid as unknown[], ctx, policy);
      setApplyResult(result);
      setStep('done');
      // Invalidate the relevant caches so the list pages pick up new rows.
      await qc.invalidateQueries({ queryKey: ['products', company_id] });
      await qc.invalidateQueries({ queryKey: ['import_existing', moduleKey, company_id] });
    } catch (e) {
      setParseError(e instanceof Error ? e.message : 'Apply failed');
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
    <div className="space-y-6 pb-16">
      <div className="flex items-center gap-3">
        <button onClick={() => navigate('/settings')} className="text-sm text-ink-secondary hover:text-ink-primary">
          ← Settings
        </button>
        <span className="text-ink-tertiary">/</span>
        <h1 className="text-xl font-semibold text-ink-primary">Import / Export</h1>
      </div>

      <div className="rounded-card border border-border-subtle bg-surface-card p-5 text-sm text-ink-secondary">
        <p>
          Bulk-load master data from a spreadsheet, or export your current data
          for backup / reporting. Imports cover <strong className="text-ink-primary">master data only</strong>{' '}
          (no money posting). For migrating opening balances use the dedicated{' '}
          <button onClick={() => navigate('/settings/opening-balances')} className="text-brand-600 underline hover:text-brand-700">
            Opening Balances wizard
          </button>.
        </p>
        <p className="mt-2 text-xs text-ink-tertiary">
          Tip: start by downloading the template, fill it in, then upload — that
          way the column names and order are already correct.
        </p>
      </div>

      {/* Module picker */}
      <div className="rounded-card border border-border-subtle bg-surface-card overflow-hidden">
        <div className="border-b border-border-subtle px-5 py-3">
          <h2 className="text-sm font-semibold text-ink-primary">Pick a module</h2>
        </div>
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3 p-4">
          {Object.entries(MODULES).map(([key, entry]) => {
            const isActive = moduleKey === key;
            return (
              <button
                key={key}
                onClick={() => { setModuleKey(key); startOver(); }}
                style={{
                  border: `1px solid ${isActive ? '#6366F1' : '#E2E8F0'}`,
                  background: isActive ? '#EEF2FF' : '#FFF',
                  borderRadius: '12px',
                  padding: '14px 16px',
                  textAlign: 'left',
                  cursor: 'pointer',
                }}
              >
                <div style={{ fontSize: '22px' }}>{entry.adapter.icon}</div>
                <div style={{
                  marginTop: '6px', fontWeight: 600, fontSize: '13.5px',
                  color: isActive ? '#3730A3' : '#0F172A',
                }}>{entry.adapter.label}</div>
                <div style={{ marginTop: '2px', fontSize: '11.5px', color: '#64748B' }}>
                  {entry.adapter.description}
                </div>
              </button>
            );
          })}
          {/* Placeholder for upcoming modules */}
          <div style={{
            border: '1px dashed #CBD5E1', background: '#F8FAFC',
            borderRadius: '12px', padding: '14px 16px', color: '#94A3B8', fontSize: '11.5px',
          }}>
            More modules coming in 14.11b (contacts, chart of accounts, tax rates, units, brands, categories, …)
          </div>
        </div>
      </div>

      {/* Actions for the picked module */}
      {entry && adapter && (
        <>
          <div className="rounded-card border border-border-subtle bg-surface-card overflow-hidden">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border-subtle px-5 py-3">
              <h2 className="text-sm font-semibold text-ink-primary">
                {adapter.label} · {existingRows.length} record{existingRows.length === 1 ? '' : 's'} in system
              </h2>
              {/* Format toggle */}
              <div className="inline-flex rounded border border-slate-300 overflow-hidden text-xs font-semibold">
                {(['csv','xlsx'] as const).map(f => (
                  <button
                    key={f}
                    onClick={() => setFormat(f)}
                    style={{
                      padding: '5px 12px',
                      background: format === f ? '#EEF2FF' : '#FFF',
                      color:      format === f ? '#3730A3' : '#64748B',
                      borderLeft: f === 'xlsx' ? '1px solid #CBD5E1' : undefined,
                      textTransform: 'uppercase',
                    }}
                  >{f}</button>
                ))}
              </div>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3 p-4">
              <ActionCard
                title="1. Download template"
                description={`Empty ${format.toUpperCase()} with the right column headers + 1-2 example rows.`}
                cta={`Download ${format} template`}
                onClick={downloadTemplate}
              />
              <ActionCard
                title="2. Export current data"
                description={`Snapshot every ${adapter.label.toLowerCase()} row currently in the system.`}
                cta={existingRows.length === 0 ? 'No rows to export' : `Export ${existingRows.length} rows`}
                onClick={exportCurrent}
                disabled={existingRows.length === 0}
              />
              <ActionCard
                title="3. Upload a file"
                description="Fill in your file, then upload here. We validate every row and show a preview before anything is saved."
                cta={fileName ? `Replace: ${fileName}` : 'Choose file…'}
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
          </div>

          {parseError && (
            <div className="rounded-card border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-800">
              {parseError}
            </div>
          )}

          {/* Preview section */}
          {step === 'preview' && previewRows.length > 0 && (
            <div className="rounded-card border border-border-subtle bg-surface-card overflow-hidden">
              <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border-subtle px-5 py-3">
                <div>
                  <h2 className="text-sm font-semibold text-ink-primary">Preview — {fileName}</h2>
                  <div className="mt-1 text-xs text-ink-secondary">
                    <strong className="text-emerald-700">{validCount} valid</strong>
                    {errorCount > 0 && (
                      <> · <strong className="text-red-700">{errorCount} with errors</strong></>
                    )}
                    {dupCount > 0 && (
                      <> · <strong className="text-amber-700">{dupCount} duplicate</strong></>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  {dupCount > 0 && (
                    <div className="text-xs">
                      <label className="block mb-1 font-medium text-ink-secondary">On duplicate ({adapter.key === 'products' ? 'SKU' : 'natural key'} match):</label>
                      <select
                        value={policy}
                        onChange={(e) => setPolicy(e.target.value as DuplicatePolicy)}
                        className="border border-slate-300 rounded px-2 py-1 text-xs"
                      >
                        <option value="skip">Skip duplicates (default)</option>
                        <option value="update">Update existing rows</option>
                        <option value="error">Fail the import</option>
                      </select>
                    </div>
                  )}
                  <Button variant="ghost" size="sm" onClick={startOver}>Cancel</Button>
                  <Button
                    size="sm"
                    onClick={applyImport}
                    disabled={validCount === 0 || posting}
                  >
                    {posting ? 'Importing…' : `Import ${validCount} row${validCount === 1 ? '' : 's'}`}
                  </Button>
                </div>
              </div>
              <div className="overflow-x-auto max-h-[500px]">
                <table className="w-full text-xs">
                  <thead className="sticky top-0 bg-surface-muted">
                    <tr className="border-b border-border-subtle text-ink-tertiary">
                      <th className="px-2 py-1.5 text-end font-medium w-[40px]">#</th>
                      <th className="px-2 py-1.5 text-start font-medium w-[80px]">Status</th>
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
                            <span className="rounded-pill bg-red-100 px-1.5 py-0.5 text-[10px] font-semibold text-red-700">Error</span>
                          ) : p.isDuplicate ? (
                            <span className="rounded-pill bg-amber-100 px-1.5 py-0.5 text-[10px] font-semibold text-amber-700">Duplicate</span>
                          ) : (
                            <span className="rounded-pill bg-emerald-100 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-700">OK</span>
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
                  <div className="font-semibold text-red-800 mb-1">Errors found:</div>
                  <ul className="space-y-1 text-red-700 max-h-32 overflow-y-auto">
                    {previewRows
                      .map((p, idx) => ({ p, idx }))
                      .filter(({ p }) => !p.ok)
                      .slice(0, 20)
                      .map(({ p, idx }) => (
                        <li key={idx}>
                          <strong>Row {idx + 1}:</strong> {p.errors.join(', ')}
                        </li>
                      ))}
                    {errorCount > 20 && (
                      <li className="italic">…and {errorCount - 20} more</li>
                    )}
                  </ul>
                </div>
              )}
            </div>
          )}

          {/* Done state */}
          {step === 'done' && applyResult && (
            <div className="rounded-card border border-emerald-200 bg-emerald-50 p-5">
              <h2 className="text-sm font-semibold text-emerald-900">Import complete</h2>
              <div className="mt-2 grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
                <Stat label="Inserted" value={applyResult.inserted} good />
                <Stat label="Updated"  value={applyResult.updated}  good />
                <Stat label="Skipped"  value={applyResult.skipped} />
                <Stat label="Errors"   value={applyResult.errors.length} bad={applyResult.errors.length > 0} />
              </div>
              {applyResult.errors.length > 0 && (
                <div className="mt-3 text-xs text-emerald-900">
                  <strong>Per-row errors:</strong>
                  <ul className="mt-1 space-y-0.5 text-red-700 max-h-32 overflow-y-auto">
                    {applyResult.errors.map((e, i) => (
                      <li key={i}>Row {e.rowIndex + 1}: {e.message}</li>
                    ))}
                  </ul>
                </div>
              )}
              <div className="mt-4 flex gap-2">
                <Button size="sm" variant="ghost" onClick={startOver}>Import another file</Button>
                <Button size="sm" onClick={() => navigate('/catalog/products')}>View imported products →</Button>
              </div>
            </div>
          )}
        </>
      )}
    </div>
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
    <div
      style={{
        border: `1px solid ${accent ? '#6366F1' : '#E2E8F0'}`,
        background: accent ? '#EEF2FF' : '#FFF',
        borderRadius: '12px',
        padding: '14px 16px',
        display: 'flex', flexDirection: 'column', gap: '6px',
      }}
    >
      <div style={{ fontSize: '12.5px', fontWeight: 600, color: accent ? '#3730A3' : '#0F172A' }}>{title}</div>
      <div style={{ fontSize: '11.5px', color: '#64748B', flex: 1 }}>{description}</div>
      <Button size="sm" variant={accent ? 'primary' : 'ghost'} disabled={disabled} onClick={onClick}>
        {cta}
      </Button>
    </div>
  );
}

function Stat({ label, value, good, bad }: { label: string; value: number; good?: boolean; bad?: boolean }) {
  const color = bad ? '#B91C1C' : good ? '#047857' : '#475569';
  return (
    <div>
      <div className="text-[10.5px] font-semibold uppercase tracking-wider text-ink-tertiary">{label}</div>
      <div style={{ marginTop: '2px', fontSize: '20px', fontWeight: 700, color, fontVariantNumeric: 'tabular-nums' }}>
        {value}
      </div>
    </div>
  );
}
