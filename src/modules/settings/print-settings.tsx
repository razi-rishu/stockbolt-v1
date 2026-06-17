/**
 * Print Settings — customizable print template manager (Phase 15, Slice 3).
 *
 * Manage MULTIPLE named templates (create / duplicate / delete / set-as-default),
 * edit the selected one (style preset, colours, typography, logo, 16 section
 * toggles) with a LIVE A4 preview, and assign a default template per document
 * type (Sales Invoice → Modern, Quote → Corporate, …).
 *
 * The /print route reads these via printTemplates.getResolved: per-doc-type
 * default → company default → classic fallback. If the Phase 15 migration
 * hasn't run, the page shows a notice and disables editing.
 */
import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { getAdapter } from '@/data/index';
import { useAuthStore } from '@/store/auth';
import { Button } from '@/ui/button';
import { PageHeader } from '@/ui/primitives';
import { theme } from '@/ui/theme';
import { ConfigurableDocTemplate } from '@/modules/print/engine/ConfigurableDocTemplate';
import { SAMPLE_TAX_INVOICE } from '@/modules/print/_signature/sample-data';
import { STYLE_PRESETS, STYLE_ORDER } from '@/modules/print/engine/presets';
import {
  DEFAULT_TEMPLATE_SETTINGS, normalizeSettings,
  type PrintTemplate, type TemplateSettings, type TemplateStyle, type PrintDocumentType,
  type FontFamily, type FontSize, type LogoPosition, type LogoSize,
} from '@/modules/print/engine/types';

const FONTS: FontFamily[] = ['Inter', 'Roboto', 'Poppins', 'Open Sans'];
const SIZES: FontSize[]   = ['small', 'medium', 'large'];
const LOGO_POS: LogoPosition[] = ['left', 'center', 'right'];
const LOGO_SZ:  LogoSize[]     = ['small', 'medium', 'large'];

const TOGGLES: { key: keyof TemplateSettings; label: string }[] = [
  { key: 'showLogo',              label: 'Company logo' },
  { key: 'showReferenceNumber',   label: 'Reference number' },
  { key: 'showDueDate',           label: 'Due date' },
  { key: 'showCustomerTaxNumber', label: 'Customer tax number' },
  { key: 'showItemSku',           label: 'Item SKU' },
  { key: 'showItemDescription',   label: 'Item description (Arabic)' },
  { key: 'showUnitPrice',         label: 'Unit price' },
  { key: 'showDiscount',          label: 'Discount column' },
  { key: 'showTaxBreakdown',      label: 'Tax column + summary' },
  { key: 'showWarehouse',         label: 'Warehouse' },
  { key: 'showBankDetails',       label: 'Bank / payment details' },
  { key: 'showSalesperson',       label: 'Salesperson' },
  { key: 'showPaymentTerms',      label: 'Payment terms' },
  { key: 'showQR',                label: 'QR code' },
  { key: 'showSignature',         label: 'Signature block' },
  { key: 'showFooter',            label: 'Footer strip' },
];

const DOC_TYPES: { key: PrintDocumentType; label: string }[] = [
  { key: 'sales_invoice',    label: 'Sales Invoice' },
  { key: 'quotation',        label: 'Quotation' },
  { key: 'credit_note',      label: 'Credit Note' },
  { key: 'debit_note',       label: 'Debit Note' },
  { key: 'purchase_order',   label: 'Purchase Order' },
  { key: 'purchase_invoice', label: 'Purchase Invoice (Bill)' },
];

function newTemplateDraft(): Partial<PrintTemplate> & { name: string } {
  const c = STYLE_PRESETS.classic.defaultColors;
  return {
    name: 'New Template', template_style: 'classic',
    primary_color: c.primary, secondary_color: c.secondary, accent_color: c.accent, text_color: c.text,
    font_family: 'Inter', font_size: 'medium', logo_position: 'left', logo_size: 'medium',
    is_default: false, settings: { ...DEFAULT_TEMPLATE_SETTINGS },
  };
}

export default function PrintSettingsPage() {
  const navigate   = useNavigate();
  const company_id = useAuthStore(s => s.company_id);
  const adapter    = getAdapter();

  const [templates, setTemplates] = useState<PrintTemplate[]>([]);
  const [docDefaults, setDocDefaults] = useState<Record<string, string>>({});
  const [tpl, setTpl] = useState<PrintTemplate | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy,    setBusy]    = useState(false);
  const [saved,   setSaved]   = useState(false);
  const [error,   setError]   = useState<string | null>(null);
  const [needsMigration, setNeedsMigration] = useState(false);

  const reload = useCallback(async (selectId?: string) => {
    if (!company_id) return;
    try {
      const [rows, defaults] = await Promise.all([
        adapter.printTemplates.list(company_id),
        adapter.printTemplates.listDocTypeDefaults(company_id).catch(() => ({})),
      ]);
      if (rows.length === 0) { setNeedsMigration(true); return; }
      setNeedsMigration(false);
      setTemplates(rows.map(r => ({ ...r, settings: normalizeSettings(r.settings) })));
      setDocDefaults(defaults);
      const pick = rows.find(r => r.id === selectId) ?? rows.find(r => r.is_default) ?? rows[0];
      setTpl({ ...pick, settings: normalizeSettings(pick.settings) });
    } catch {
      setNeedsMigration(true);
    }
  }, [company_id, adapter]);

  useEffect(() => { reload().finally(() => setLoading(false)); }, [reload]);

  function setField<K extends keyof PrintTemplate>(key: K, value: PrintTemplate[K]) {
    setTpl(t => t ? { ...t, [key]: value } : t);
  }
  function setToggle(key: keyof TemplateSettings, value: boolean) {
    setTpl(t => t ? { ...t, settings: { ...t.settings, [key]: value } } : t);
  }
  function setFooter(key: 'footerEn' | 'footerAr', value: string) {
    setTpl(t => t ? { ...t, settings: { ...t.settings, [key]: value } } : t);
  }
  function chooseStyle(style: TemplateStyle) {
    const c = STYLE_PRESETS[style].defaultColors;
    setTpl(t => t ? { ...t, template_style: style, primary_color: c.primary, secondary_color: c.secondary, accent_color: c.accent, text_color: c.text } : t);
  }

  async function withBusy(fn: () => Promise<void>) {
    setBusy(true); setError(null); setSaved(false);
    try { await fn(); } catch (e) { setError(String(e)); } finally { setBusy(false); }
  }

  const handleSave = () => withBusy(async () => {
    if (!tpl?.id) return;
    await adapter.printTemplates.update(tpl.id, {
      name: tpl.name, template_style: tpl.template_style,
      primary_color: tpl.primary_color, secondary_color: tpl.secondary_color,
      accent_color: tpl.accent_color, text_color: tpl.text_color,
      font_family: tpl.font_family, font_size: tpl.font_size,
      logo_position: tpl.logo_position, logo_size: tpl.logo_size,
      settings: tpl.settings,
    });
    await reload(tpl.id);
    setSaved(true); setTimeout(() => setSaved(false), 3000);
  });

  const handleNew = () => withBusy(async () => {
    if (!company_id) return;
    const name = window.prompt('New template name:', 'New Template');
    if (!name) return;
    const created = await adapter.printTemplates.create(company_id, { ...newTemplateDraft(), name });
    await reload(created.id);
  });

  const handleDuplicate = () => withBusy(async () => {
    if (!tpl?.id) return;
    const created = await adapter.printTemplates.duplicate(tpl.id, `${tpl.name} copy`);
    await reload(created.id);
  });

  const handleDelete = () => withBusy(async () => {
    if (!tpl?.id) return;
    if (tpl.is_default) { setError('Cannot delete the default template. Set another template as default first.'); return; }
    if (!window.confirm(`Delete template "${tpl.name}"? This cannot be undone.`)) return;
    await adapter.printTemplates.remove(tpl.id);
    await reload();
  });

  const handleSetDefault = () => withBusy(async () => {
    if (!company_id || !tpl?.id) return;
    await adapter.printTemplates.setDefault(company_id, tpl.id);
    await reload(tpl.id);
  });

  const handleDocDefault = (docType: PrintDocumentType, templateId: string) => withBusy(async () => {
    if (!company_id) return;
    if (templateId) await adapter.printTemplates.setDocTypeDefault(company_id, docType, templateId);
    else await adapter.printTemplates.clearDocTypeDefault(company_id, docType);
    setDocDefaults(d => { const next = { ...d }; if (templateId) next[docType] = templateId; else delete next[docType]; return next; });
  });

  if (loading) {
    return <div className="flex h-64 items-center justify-center"><div className="h-5 w-5 animate-spin rounded-full border-2 border-brand-500 border-t-transparent" /></div>;
  }

  const card = 'rounded-card border border-border-subtle bg-surface-card p-5';
  const labelCls = 'mb-1 block text-xs font-medium text-ink-secondary';
  const selCls = 'h-9 w-full rounded-input border border-border-subtle bg-surface-input px-2 text-sm';

  return (
    <div style={{ maxWidth: '1240px', margin: '0 auto', padding: '8px 0', display: 'flex', flexDirection: 'column', gap: '20px' }}>
      <PageHeader
        title="Print Templates"
        subtitle="Create and customize templates, then assign a default for each document type. The preview updates as you change things."
        actions={<Button onClick={handleSave} disabled={busy || !tpl?.id}>{busy ? 'Working…' : 'Save template'}</Button>}
      />

      {needsMigration && (
        <div style={{ background: '#FFFBEB', border: '1px solid #FDE68A', borderRadius: 8, padding: '10px 16px', fontSize: 13, color: '#92400E' }}>
          Template customization needs the Phase 15 database migration
          (<code>20260617000001_phase15_print_templates.sql</code>). Run it in Supabase to enable this page.
        </div>
      )}
      {error && <div style={{ background: theme.dangerSoft, border: `1px solid ${theme.dangerBorder}`, borderRadius: 8, padding: '10px 16px', fontSize: 13, color: theme.danger }}>{error}</div>}
      {saved && <div style={{ background: theme.successSoft, border: `1px solid ${theme.successBorder}`, borderRadius: 8, padding: '10px 16px', fontSize: 13, color: theme.success }}>Saved.</div>}

      {tpl && (
        <>
          {/* Template manager bar */}
          <div className={card}>
            <div className="flex flex-wrap items-end gap-3">
              <div style={{ minWidth: 220 }}>
                <label className={labelCls}>Editing template</label>
                <select className={selCls} value={tpl.id}
                  onChange={e => { const sel = templates.find(t => t.id === e.target.value); if (sel) setTpl({ ...sel, settings: normalizeSettings(sel.settings) }); }}>
                  {templates.map(t => <option key={t.id} value={t.id}>{t.name}{t.is_default ? '  ★ default' : ''}</option>)}
                </select>
              </div>
              <Button variant="secondary" size="sm" onClick={handleNew} disabled={busy}>+ New</Button>
              <Button variant="secondary" size="sm" onClick={handleDuplicate} disabled={busy}>Duplicate</Button>
              <Button variant="secondary" size="sm" onClick={handleSetDefault} disabled={busy || tpl.is_default}>
                {tpl.is_default ? '★ Default' : 'Set as default'}
              </Button>
              <Button variant="secondary" size="sm" onClick={handleDelete} disabled={busy || tpl.is_default}>Delete</Button>
            </div>
          </div>

          {/* Per-document-type defaults matrix */}
          <div className={card}>
            <h2 className="text-sm font-semibold text-ink-primary">Document defaults</h2>
            <p className="mt-1 mb-3 text-xs text-ink-tertiary">Choose which template prints for each document type. Leave on “Company default” to use the ★ default.</p>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {DOC_TYPES.map(({ key, label }) => (
                <div key={key}>
                  <label className={labelCls}>{label}</label>
                  <select className={selCls} value={docDefaults[key] ?? ''} onChange={e => handleDocDefault(key, e.target.value)} disabled={busy}>
                    <option value="">Company default</option>
                    {templates.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
                  </select>
                </div>
              ))}
            </div>
          </div>

          <div className="grid grid-cols-1 gap-5 lg:grid-cols-[minmax(0,1fr)_480px]">
            {/* ── LEFT: controls ──────────────────────────────────────── */}
            <div className="flex flex-col gap-5">
              <div className={card}>
                <label className={labelCls}>Template name</label>
                <input className="h-9 w-full rounded-input border border-border-subtle bg-surface-input px-3 text-sm text-ink-primary focus:outline-none focus:ring-1 focus:ring-brand-500"
                  value={tpl.name} onChange={e => setField('name', e.target.value)} placeholder="e.g. UAE Invoice" />
              </div>

              <div className={card}>
                <h2 className="text-sm font-semibold text-ink-primary">Style</h2>
                <p className="mt-1 mb-3 text-xs text-ink-tertiary">Picking a style sets a matching palette — fine-tune below.</p>
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                  {STYLE_ORDER.map(style => {
                    const preset = STYLE_PRESETS[style];
                    const active = tpl.template_style === style;
                    return (
                      <button key={style} type="button" onClick={() => chooseStyle(style)} className="rounded-card border p-3 text-left transition"
                        style={{ borderColor: active ? preset.defaultColors.accent : '#e2e8f0', boxShadow: active ? `0 0 0 2px ${preset.defaultColors.accent}` : 'none', background: active ? '#fff' : 'transparent' }}>
                        <div style={{ display: 'flex', gap: 4, marginBottom: 6 }}>
                          {[preset.defaultColors.primary, preset.defaultColors.accent, preset.defaultColors.secondary].map((c, i) => (
                            <span key={i} style={{ width: 14, height: 14, borderRadius: 3, background: c, border: '1px solid rgba(0,0,0,.08)' }} />
                          ))}
                        </div>
                        <div className="text-sm font-medium text-ink-primary">{preset.label}</div>
                        <div className="text-[11px] leading-snug text-ink-tertiary">{preset.description}</div>
                      </button>
                    );
                  })}
                </div>
              </div>

              <div className={card}>
                <h2 className="text-sm font-semibold text-ink-primary">Colours</h2>
                <div className="mt-3 grid grid-cols-2 gap-4">
                  {([['primary_color', 'Primary'], ['secondary_color', 'Secondary'], ['accent_color', 'Accent'], ['text_color', 'Text']] as [keyof PrintTemplate, string][]).map(([key, label]) => (
                    <div key={key}>
                      <label className={labelCls}>{label}</label>
                      <div className="flex items-center gap-2">
                        <input type="color" value={String(tpl[key])} onChange={e => setField(key, e.target.value as PrintTemplate[typeof key])} style={{ width: 40, height: 34, border: 'none', background: 'none', cursor: 'pointer' }} />
                        <input className="h-9 w-full rounded-input border border-border-subtle bg-surface-input px-2 text-xs text-ink-primary focus:outline-none focus:ring-1 focus:ring-brand-500"
                          value={String(tpl[key])} onChange={e => setField(key, e.target.value as PrintTemplate[typeof key])} />
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              <div className={card}>
                <h2 className="text-sm font-semibold text-ink-primary">Typography &amp; logo</h2>
                <div className="mt-3 grid grid-cols-2 gap-4">
                  <div><label className={labelCls}>Font</label>
                    <select className={selCls} value={tpl.font_family} onChange={e => setField('font_family', e.target.value as FontFamily)}>{FONTS.map(f => <option key={f} value={f}>{f}</option>)}</select></div>
                  <div><label className={labelCls}>Font size</label>
                    <select className={selCls} value={tpl.font_size} onChange={e => setField('font_size', e.target.value as FontSize)}>{SIZES.map(s => <option key={s} value={s}>{s[0].toUpperCase() + s.slice(1)}</option>)}</select></div>
                  <div><label className={labelCls}>Logo position</label>
                    <select className={selCls} value={tpl.logo_position} onChange={e => setField('logo_position', e.target.value as LogoPosition)}>{LOGO_POS.map(p => <option key={p} value={p}>{p[0].toUpperCase() + p.slice(1)}</option>)}</select></div>
                  <div><label className={labelCls}>Logo size</label>
                    <select className={selCls} value={tpl.logo_size} onChange={e => setField('logo_size', e.target.value as LogoSize)}>{LOGO_SZ.map(s => <option key={s} value={s}>{s[0].toUpperCase() + s.slice(1)}</option>)}</select></div>
                </div>
                <p className="mt-3 text-xs text-ink-tertiary">Your logo lives in <button className="text-brand-600 underline" onClick={() => navigate('/settings/company')}>Company Profile</button>.</p>
              </div>

              <div className={card}>
                <h2 className="text-sm font-semibold text-ink-primary">Footer line</h2>
                <div className="mt-3 grid grid-cols-1 gap-4 sm:grid-cols-2">
                  <div><label className={labelCls}>Footer (English)</label>
                    <textarea className="w-full rounded-input border border-border-subtle bg-surface-input p-2 text-sm" rows={2} value={tpl.settings.footerEn} onChange={e => setFooter('footerEn', e.target.value)} placeholder="Bank: ENBD · IBAN: AE00… · Thank you" /></div>
                  <div><label className={labelCls}>Footer (Arabic)</label>
                    <textarea className="w-full rounded-input border border-border-subtle bg-surface-input p-2 text-sm" dir="rtl" rows={2} value={tpl.settings.footerAr} onChange={e => setFooter('footerAr', e.target.value)} /></div>
                </div>
              </div>

              <div className={card}>
                <h2 className="text-sm font-semibold text-ink-primary">Show on documents</h2>
                <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2">
                  {TOGGLES.map(({ key, label }) => (
                    <label key={key} className="flex cursor-pointer items-center gap-2">
                      <input type="checkbox" className="h-4 w-4 rounded border-border-subtle accent-brand-600" checked={!!tpl.settings[key]} onChange={e => setToggle(key, e.target.checked)} />
                      <span className="text-sm text-ink-primary">{label}</span>
                    </label>
                  ))}
                </div>
              </div>
            </div>

            {/* ── RIGHT: live preview ─────────────────────────────────── */}
            <div>
              <div className="sticky top-4">
                <div className="mb-2 flex items-center gap-2">
                  <span className="text-xs font-semibold uppercase tracking-wider text-ink-tertiary">Live preview</span>
                  <span className="rounded-pill bg-brand-50 px-2 py-0.5 text-[10px] font-semibold text-brand-700">{tpl.name}</span>
                </div>
                <div style={{ border: `1px solid ${theme.border}`, borderRadius: 10, overflow: 'hidden', background: '#F8FAFC', height: 660 }}>
                  <div style={{ transform: 'scale(0.54)', transformOrigin: 'top left', width: '210mm' }}>
                    <ConfigurableDocTemplate data={SAMPLE_TAX_INVOICE} template={tpl} />
                  </div>
                </div>
                <p className="mt-2 text-xs text-ink-tertiary">Sample data. Real documents use your own logo, company details and figures.</p>
              </div>
            </div>
          </div>

          <div className="flex justify-end">
            <Button onClick={handleSave} disabled={busy || !tpl?.id}>{busy ? 'Working…' : 'Save template'}</Button>
          </div>
        </>
      )}
    </div>
  );
}
