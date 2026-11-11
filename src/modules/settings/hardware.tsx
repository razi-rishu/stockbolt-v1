/**
 * Settings → Barcode & Printer Setup (Hardware).
 *
 * Per-DEVICE configuration (saved in this browser via localStorage) because a
 * scanner/receipt printer belongs to a till, not the whole company. Ships with
 * working defaults; the "Test scan" box proves the mapping end-to-end against
 * the real product list before the user ever opens the POS.
 */
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { getAdapter } from '@/data/index';
import { useAuthStore } from '@/store/auth';
import { useTranslation } from 'react-i18next';
import { OceanPage } from '@/components/ocean-list';
import { ScanBarcode, Printer, Save, RotateCcw, CheckCircle2, XCircle } from 'lucide-react';
import {
  loadHardwareConfig, saveHardwareConfig, resolveScan, normalizeScan,
  DEFAULT_HARDWARE_CONFIG, type HardwareConfig, type ScanField,
} from '@/lib/hardware-config';
import type { ProductRow } from '@/data/adapter';

const FIELD_LABEL: Record<ScanField, string> = {
  barcode: 'Barcode',
  sku: 'SKU',
  oe_number: 'OE number',
  replacement_numbers: 'Replacement numbers',
};
const ALL_FIELDS: ScanField[] = ['barcode', 'sku', 'oe_number', 'replacement_numbers'];

export default function HardwareSettingsPage() {
  const { company_id } = useAuthStore();
  const { t } = useTranslation();
  const fieldLabel = (f: ScanField) => t(`settingsPages.hardware.field_${f}`, { defaultValue: FIELD_LABEL[f] });
  const [cfg, setCfg] = useState<HardwareConfig>(() => loadHardwareConfig());
  const [saved, setSaved] = useState(false);
  const [testCode, setTestCode] = useState('');
  const [testResult, setTestResult] = useState<{ code: string; product: ProductRow | null } | null>(null);

  const { data: products = [] } = useQuery<ProductRow[]>({
    queryKey: ['products', company_id],
    queryFn: () => getAdapter().products.list(company_id!),
    enabled: !!company_id,
  });

  function save() {
    saveHardwareConfig(cfg);
    setSaved(true);
    setTimeout(() => setSaved(false), 3000);
  }
  function restoreDefaults() {
    setCfg(DEFAULT_HARDWARE_CONFIG);
    saveHardwareConfig(DEFAULT_HARDWARE_CONFIG);
    setSaved(true);
    setTimeout(() => setSaved(false), 3000);
  }
  function toggleField(f: ScanField, on: boolean) {
    setCfg(c => ({
      ...c,
      scanner: {
        ...c.scanner,
        // Keep the canonical priority order regardless of click order.
        matchFields: ALL_FIELDS.filter(x => (x === f ? on : c.scanner.matchFields.includes(x))),
      },
    }));
  }
  function runTest() {
    if (!testCode.trim()) return;
    setTestResult({ code: normalizeScan(testCode, cfg), product: resolveScan(testCode, products, cfg) });
    setTestCode('');
  }

  const PAPERS = [
    ['a4', t('settingsPages.hardware.paper_a4')],
    ['thermal80', t('settingsPages.hardware.paper_80')],
    ['thermal58', t('settingsPages.hardware.paper_58')],
  ] as const;

  // Ocean Teal (UI v1.1): look only — same per-device config, save / restore,
  // scan matching and test box as before.
  return (
    <OceanPage narrow testid="hardware-ocean" title={t('settingsNav.items.hardware.title')} subtitle={t('settingsPages.hardware.subtitle')}>
      {/* ── Barcode scanner ── */}
      <section className="sb-card sb-form">
        <div className="sb-form-head">
          <span className="sb-form-icon" aria-hidden="true"><ScanBarcode size={20} /></span>
          <span style={{ minWidth: 0 }}>
            <h2 className="sb-form-title">{t('settingsPages.hardware.scanner')}</h2>
            <p className="sb-form-hint">{t('settingsPages.hardware.scanner_hint')}</p>
          </span>
        </div>
        <div className="sb-form-stack">
          <label className="sb-check-row">
            <input type="checkbox" checked={cfg.scanner.enabled}
              onChange={e => setCfg(c => ({ ...c, scanner: { ...c.scanner, enabled: e.target.checked } }))} />
            <span className="sb-check-text">{t('settingsPages.hardware.enable_scan')}</span>
          </label>

          <fieldset className="sb-hw-fieldset">
            <legend className="sb-select-label">{t('settingsPages.hardware.match_fields')}</legend>
            <div className="sb-form-grid">
              {ALL_FIELDS.map((f, i) => (
                <label key={f} className="sb-check-row">
                  <input type="checkbox" checked={cfg.scanner.matchFields.includes(f)} onChange={e => toggleField(f, e.target.checked)} />
                  <span className="sb-check-text"><bdi dir="ltr" className="sb-hw-num">{i + 1}.</bdi> {fieldLabel(f)}</span>
                </label>
              ))}
            </div>
            <p className="sb-form-hint" style={{ marginTop: 8 }}>{t('settingsPages.hardware.exact')}</p>
          </fieldset>

          <div className="sb-hw-grid">
            <label className="sb-select-field" style={{ maxWidth: 'none' }}>
              <span className="sb-select-label">{t('settingsPages.hardware.min_length')}</span>
              <input type="number" min={1} max={30} dir="ltr" className="sb-field"
                value={cfg.scanner.minLength}
                onChange={e => setCfg(c => ({ ...c, scanner: { ...c.scanner, minLength: Math.max(1, Number(e.target.value) || 1) } }))} />
            </label>
            <label className="sb-select-field" style={{ maxWidth: 'none' }}>
              <span className="sb-select-label">{t('settingsPages.hardware.prefix')}</span>
              <input type="text" dir="ltr" className="sb-field" placeholder={t('settingsPages.hardware.usually_empty')}
                value={cfg.scanner.prefix}
                onChange={e => setCfg(c => ({ ...c, scanner: { ...c.scanner, prefix: e.target.value } }))} />
            </label>
            <label className="sb-select-field" style={{ maxWidth: 'none' }}>
              <span className="sb-select-label">{t('settingsPages.hardware.suffix')}</span>
              <input type="text" dir="ltr" className="sb-field" placeholder={t('settingsPages.hardware.usually_empty')}
                value={cfg.scanner.suffix}
                onChange={e => setCfg(c => ({ ...c, scanner: { ...c.scanner, suffix: e.target.value } }))} />
            </label>
          </div>

          {/* Test the mapping end-to-end */}
          <div className="sb-hw-test">
            <label className="sb-select-label" htmlFor="hw-test">{t('settingsPages.hardware.test_title')}</label>
            <div className="sb-hw-test-row">
              <input
                id="hw-test"
                type="text"
                className="sb-field"
                placeholder={t('settingsPages.hardware.test_ph')}
                value={testCode}
                onChange={e => setTestCode(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); runTest(); } }}
              />
              <button type="button" className="sb-secondary-btn" onClick={runTest}>{t('settingsPages.hardware.test')}</button>
            </div>
            {testResult && (
              <p className={`sb-hw-result ${testResult.product ? 'is-good' : 'is-bad'}`} role="status">
                {testResult.product
                  ? <><CheckCircle2 size={18} aria-hidden="true" /><span><bdi dir="ltr"><b>{testResult.code}</b> → {testResult.product.sku}</bdi> · {testResult.product.name}</span></>
                  : <><XCircle size={18} aria-hidden="true" /><span>{t('settingsPages.hardware.no_match', { code: testResult.code })}</span></>}
              </p>
            )}
          </div>
        </div>
      </section>

      {/* ── Receipt printer ── */}
      <section className="sb-card sb-form">
        <div className="sb-form-head">
          <span className="sb-form-icon" aria-hidden="true"><Printer size={20} /></span>
          <span style={{ minWidth: 0 }}>
            <h2 className="sb-form-title">{t('settingsPages.hardware.printer')}</h2>
            <p className="sb-form-hint">{t('settingsPages.hardware.printer_hint')}</p>
          </span>
        </div>
        <div className="sb-form-stack">
          <fieldset className="sb-hw-fieldset">
            <legend className="sb-select-label">{t('settingsPages.hardware.paper')}</legend>
            <div className="sb-hw-papers">
              {PAPERS.map(([v, l]) => (
                <label key={v} className={`sb-check-row ${cfg.printer.paper === v ? 'is-on' : ''}`}>
                  <input type="radio" name="paper"
                    checked={cfg.printer.paper === v}
                    onChange={() => setCfg(c => ({ ...c, printer: { ...c.printer, paper: v } }))} />
                  <span className="sb-check-text">{l}</span>
                </label>
              ))}
            </div>
          </fieldset>

          <label className="sb-check-row">
            <input type="checkbox" checked={cfg.printer.autoPrintAfterSale}
              onChange={e => setCfg(c => ({ ...c, printer: { ...c.printer, autoPrintAfterSale: e.target.checked } }))} />
            <span className="sb-check-text">{t('settingsPages.hardware.auto_print')}</span>
          </label>

          <label className="sb-select-field">
            <span className="sb-select-label">{t('settingsPages.hardware.copies')}</span>
            <input type="number" min={1} max={5} dir="ltr" className="sb-field" style={{ maxWidth: 160 }}
              value={cfg.printer.copies}
              onChange={e => setCfg(c => ({ ...c, printer: { ...c.printer, copies: Math.min(5, Math.max(1, Number(e.target.value) || 1)) } }))} />
            <span className="sb-form-hint">{t('settingsPages.hardware.copies_hint')}</span>
          </label>
        </div>
      </section>

      <div className="sb-form-actions" style={{ justifyContent: 'flex-start', alignItems: 'center' }}>
        <button type="button" className="sb-primary-btn sb-btn-inline" onClick={save}><Save size={18} aria-hidden="true" />{t('settingsPages.hardware.save')}</button>
        <button type="button" className="sb-secondary-btn sb-btn-inline" onClick={restoreDefaults}><RotateCcw size={18} aria-hidden="true" />{t('settingsPages.hardware.restore')}</button>
        {saved && <span className="sb-pill sb-pill-good" role="status">{t('settingsPages.hardware.saved')}</span>}
      </div>
    </OceanPage>
  );
}
