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
import { Card } from '@/ui/card';
import { Button } from '@/ui/button';
import { PageHeader } from '@/ui/primitives';
import { theme } from '@/ui/theme';
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

  const label: React.CSSProperties = { fontSize: 12, fontWeight: 600, color: theme.inkMuted, display: 'block', marginBottom: 4 };
  const inputCls = 'h-9 rounded-input border border-border-subtle bg-surface-input px-3 text-sm';

  return (
    <div style={{ maxWidth: 760, margin: '0 auto', padding: '8px 0' }}>
      <div style={{ marginBottom: 20 }}>
        <PageHeader
          title="Barcode & Printer Setup"
          subtitle="Settings for the scanner and receipt printer attached to THIS device (each till keeps its own)."
        />
      </div>

      {/* ── Barcode scanner ── */}
      <Card className="mb-6">
        <h2 style={{ fontSize: 15, fontWeight: 600, color: theme.ink, margin: '0 0 4px' }}>Barcode scanner</h2>
        <p style={{ fontSize: 12, color: theme.inkMuted, margin: '0 0 14px' }}>
          Works with any USB/Bluetooth scanner that types like a keyboard (that's almost all of them).
          On the POS screen, a scan finds the product and adds it to the cart automatically.
        </p>

        <label style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 14, cursor: 'pointer' }}>
          <input
            type="checkbox"
            className="h-4 w-4 rounded border-border-subtle accent-brand-600"
            checked={cfg.scanner.enabled}
            onChange={e => setCfg(c => ({ ...c, scanner: { ...c.scanner, enabled: e.target.checked } }))}
          />
          <span style={{ fontSize: 13, color: theme.ink }}>Enable scanning on the POS screen</span>
        </label>

        <div style={{ marginBottom: 14 }}>
          <span style={label}>Match a scanned code against (checked fields, in this order)</span>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {ALL_FIELDS.map((f, i) => (
              <label key={f} style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
                <input
                  type="checkbox"
                  className="h-4 w-4 rounded border-border-subtle accent-brand-600"
                  checked={cfg.scanner.matchFields.includes(f)}
                  onChange={e => toggleField(f, e.target.checked)}
                />
                <span style={{ fontSize: 13, color: theme.ink }}>
                  <span style={{ color: theme.inkFaint, fontFamily: 'monospace', fontSize: 11, marginRight: 6 }}>{i + 1}.</span>
                  {FIELD_LABEL[f]}
                </span>
              </label>
            ))}
          </div>
          <p style={{ fontSize: 11, color: theme.inkFaint, margin: '6px 0 0' }}>
            Matches are exact (never partial), so a scan can't add the wrong part.
          </p>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 12, marginBottom: 16 }}>
          <div>
            <span style={label}>Minimum code length</span>
            <input type="number" min={1} max={30} className={inputCls} style={{ width: '100%' }}
              value={cfg.scanner.minLength}
              onChange={e => setCfg(c => ({ ...c, scanner: { ...c.scanner, minLength: Math.max(1, Number(e.target.value) || 1) } }))} />
          </div>
          <div>
            <span style={label}>Strip prefix (if your scanner adds one)</span>
            <input type="text" className={inputCls} style={{ width: '100%' }} placeholder="usually empty"
              value={cfg.scanner.prefix}
              onChange={e => setCfg(c => ({ ...c, scanner: { ...c.scanner, prefix: e.target.value } }))} />
          </div>
          <div>
            <span style={label}>Strip suffix</span>
            <input type="text" className={inputCls} style={{ width: '100%' }} placeholder="usually empty"
              value={cfg.scanner.suffix}
              onChange={e => setCfg(c => ({ ...c, scanner: { ...c.scanner, suffix: e.target.value } }))} />
          </div>
        </div>

        {/* Test the mapping end-to-end */}
        <div style={{ border: `1px dashed ${theme.border}`, borderRadius: 10, padding: '12px 14px', background: '#fafafa' }}>
          <span style={label}>Test your scanner + mapping</span>
          <div style={{ display: 'flex', gap: 8 }}>
            <input
              type="text"
              className={inputCls}
              style={{ flex: 1 }}
              placeholder="Click here, then scan a product (or type a code and press Enter)"
              value={testCode}
              onChange={e => setTestCode(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); runTest(); } }}
            />
            <Button size="sm" variant="secondary" onClick={runTest}>Test</Button>
          </div>
          {testResult && (
            <p style={{ fontSize: 13, margin: '10px 0 0', color: testResult.product ? '#047857' : '#b91c1c' }}>
              {testResult.product
                ? <>✓ <b>{testResult.code}</b> → {testResult.product.sku} · {testResult.product.name}</>
                : <>✗ No product matches "<b>{testResult.code}</b>" — check the product's barcode/SKU or the mapping above.</>}
            </p>
          )}
        </div>
      </Card>

      {/* ── Receipt printer ── */}
      <Card className="mb-6">
        <h2 style={{ fontSize: 15, fontWeight: 600, color: theme.ink, margin: '0 0 4px' }}>Receipt printer</h2>
        <p style={{ fontSize: 12, color: theme.inkMuted, margin: '0 0 14px' }}>
          Printing uses the browser's print dialog — pick your receipt printer there once and the
          browser remembers it for this site.
        </p>

        <div style={{ marginBottom: 14 }}>
          <span style={label}>Paper size</span>
          <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap' }}>
            {([['a4', 'A4 (regular printer)'], ['thermal80', '80mm thermal roll'], ['thermal58', '58mm thermal roll']] as const).map(([v, l]) => (
              <label key={v} style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer' }}>
                <input type="radio" name="paper" className="accent-brand-600"
                  checked={cfg.printer.paper === v}
                  onChange={() => setCfg(c => ({ ...c, printer: { ...c.printer, paper: v } }))} />
                <span style={{ fontSize: 13, color: theme.ink }}>{l}</span>
              </label>
            ))}
          </div>
        </div>

        <label style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 14, cursor: 'pointer' }}>
          <input
            type="checkbox"
            className="h-4 w-4 rounded border-border-subtle accent-brand-600"
            checked={cfg.printer.autoPrintAfterSale}
            onChange={e => setCfg(c => ({ ...c, printer: { ...c.printer, autoPrintAfterSale: e.target.checked } }))}
          />
          <span style={{ fontSize: 13, color: theme.ink }}>Open the print dialog automatically after each POS sale</span>
        </label>

        <div style={{ width: 160 }}>
          <span style={label}>Copies</span>
          <input type="number" min={1} max={5} className={inputCls} style={{ width: '100%' }}
            value={cfg.printer.copies}
            onChange={e => setCfg(c => ({ ...c, printer: { ...c.printer, copies: Math.min(5, Math.max(1, Number(e.target.value) || 1)) } }))} />
          <p style={{ fontSize: 11, color: theme.inkFaint, margin: '4px 0 0' }}>Set in the print dialog too if your driver ignores this.</p>
        </div>
      </Card>

      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <Button onClick={save}>Save settings</Button>
        <Button variant="secondary" onClick={restoreDefaults}>Restore defaults</Button>
        {saved && <span style={{ fontSize: 13, color: '#047857' }}>Saved on this device ✓</span>}
      </div>
    </div>
  );
}
