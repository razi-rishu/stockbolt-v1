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
import { useTranslation } from 'react-i18next';
import { OceanPage } from '@/components/ocean-list';
import { theme } from '@/ui/theme';
import { ConfigurableDocTemplate } from '@/modules/print/engine/ConfigurableDocTemplate';
import { SAMPLE_TAX_INVOICE } from '@/modules/print/_signature/sample-data';
import { STYLE_PRESETS, STYLE_ORDER } from '@/modules/print/engine/presets';
import { useArabicEnabled } from '@/hooks/use-arabic-enabled';
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
  { key: 'payment_receipt',  label: 'Payment Receipt' },
  { key: 'payment_voucher',  label: 'Payment Voucher' },
  { key: 'delivery_note',    label: 'Goods Receipt' },
];

// The Elegant layout's starting palette: deep green, warm gold, slate text.
const ELEGANT_COLORS = { primary: '#103F37', secondary: '#5B6863', accent: '#C6A36B', text: '#1F2A27' };

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
  const { t } = useTranslation();
  const arabicOn = useArabicEnabled();   // India companies: English only
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
  // A company created after the phase15 seed has no templates yet: that is
  // not a missing migration. A settings.write user gets a default created on
  // first visit; anyone else sees that documents use the standard layout.
  const [noTemplates, setNoTemplates] = useState(false);
  const [company, setCompany] = useState<{ name?: string; logo_url?: string | null; tax_id?: string | null; country_code?: string | null } | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadingLh, setUploadingLh] = useState(false);
  const [uploadingHero, setUploadingHero] = useState(false);

  const reload = useCallback(async (selectId?: string) => {
    if (!company_id) return;
    try {
      const [rows, defaults] = await Promise.all([
        adapter.printTemplates.list(company_id),
        adapter.printTemplates.listDocTypeDefaults(company_id).catch(() => ({})),
      ]);
      setNeedsMigration(false);
      if (rows.length === 0) {
        try {
          const created = await adapter.printTemplates.create(company_id, { ...newTemplateDraft(), name: 'Default Template', is_default: true });
          rows.push(created);
        } catch {
          // Either another load created it first (one default per company), or
          // this user lacks settings.write. Re-read before deciding.
          rows.push(...await adapter.printTemplates.list(company_id));
          if (rows.length === 0) {
            setNoTemplates(true);   // nothing to edit; printing still uses the standard layout
            return;
          }
        }
      }
      setNoTemplates(false);
      setTemplates(rows.map(r => ({ ...r, settings: normalizeSettings(r.settings) })));
      setDocDefaults(defaults);
      const pick = rows.find(r => r.id === selectId) ?? rows.find(r => r.is_default) ?? rows[0];
      setTpl({ ...pick, settings: normalizeSettings(pick.settings) });
    } catch (e) {
      // Only a genuinely missing table means the migration is absent; any other
      // failure is shown as it is.
      const msg = e instanceof Error ? e.message : String(e);
      if (/print_templates/.test(msg) && /does not exist|schema cache/i.test(msg)) setNeedsMigration(true);
      else setError(msg);
    }
  }, [company_id, adapter]);

  useEffect(() => { reload().finally(() => setLoading(false)); }, [reload]);

  // Real company identity for the live preview (logo / name / TRN / country).
  useEffect(() => {
    if (!company_id) return;
    adapter.companies.getById(company_id)
      .then(c => { if (c) setCompany(c as typeof company); })
      .catch(() => {});
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [company_id]);

  async function handleLetterheadUpload(file: File | null) {
    if (!file || !company_id) return;
    if (!/^image\/(png|jpe?g)$/.test(file.type)) { setError('Letterhead must be a PNG or JPG image.'); return; }
    if (file.size > 5 * 1024 * 1024) { setError('Letterhead image must be 5 MB or smaller.'); return; }
    setUploadingLh(true); setError(null);
    try {
      const url = await adapter.printTemplates.uploadLetterhead(company_id, file);
      setSetting('letterheadUrl', url);
    } catch (e) { setError(String(e)); }
    finally { setUploadingLh(false); }
  }

  async function handleHeroUpload(file: File | null) {
    if (!file || !company_id) return;
    if (!/^image\/(png|jpe?g)$/.test(file.type)) { setError('Header photo must be a PNG or JPG image.'); return; }
    if (file.size > 5 * 1024 * 1024) { setError('Header photo must be 5 MB or smaller.'); return; }
    setUploadingHero(true); setError(null);
    try {
      const url = await adapter.printTemplates.uploadLetterhead(company_id, file);
      setSetting('heroImageUrl', url);
    } catch (e) { setError(String(e)); }
    finally { setUploadingHero(false); }
  }

  async function handleLogoUpload(file: File | null) {
    if (!file || !company_id) return;
    setUploading(true); setError(null);
    try {
      const url = await adapter.companies.uploadLogo(company_id, file);
      setCompany(c => ({ ...(c ?? {}), logo_url: url }));
    } catch (e) { setError(String(e)); }
    finally { setUploading(false); }
  }

  function setField<K extends keyof PrintTemplate>(key: K, value: PrintTemplate[K]) {
    setTpl(t => t ? { ...t, [key]: value } : t);
  }
  function setToggle(key: keyof TemplateSettings, value: boolean) {
    setTpl(t => t ? { ...t, settings: { ...t.settings, [key]: value } } : t);
  }
  function setFooter(key: 'footerEn' | 'footerAr' | 'paymentTermsEn' | 'paymentTermsAr' | 'bankAccountName' | 'bankName' | 'bankAccountNumber' | 'bankIban' | 'signatureLabel', value: string) {
    setTpl(t => t ? { ...t, settings: { ...t.settings, [key]: value } } : t);
  }
  function setSetting<K extends keyof TemplateSettings>(key: K, value: TemplateSettings[K]) {
    setTpl(t => t ? { ...t, settings: { ...t.settings, [key]: value } } : t);
  }
  function chooseStyle(style: TemplateStyle) {
    const c = STYLE_PRESETS[style].defaultColors;
    setTpl(t => t ? { ...t, template_style: style, primary_color: c.primary, secondary_color: c.secondary, accent_color: c.accent, text_color: c.text, settings: { ...t.settings, layout: 'standard' } } : t);
  }
  function chooseElegant() {
    const c = ELEGANT_COLORS;
    setTpl(t => t ? { ...t, primary_color: c.primary, secondary_color: c.secondary, accent_color: c.accent, text_color: c.text, settings: { ...t.settings, layout: 'elegant' } } : t);
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
    const name = window.prompt(t('settingsPages.print.prompt_new'), t('settingsPages.print.new_default_name'));
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
    if (tpl.is_default) { setError(t('settingsPages.print.err_delete_default')); return; }
    if (!window.confirm(t('settingsPages.print.confirm_delete', { name: tpl.name }))) return;
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

  // Ocean Teal (UI v1.1): look only — same templates, editor, uploads,
  // per-document defaults, save and live preview as before.
  const card = 'sb-card sb-print-card';
  const labelCls = 'sb-print-label';
  const selCls = 'sb-field sb-print-input';

  return (
    <OceanPage
      testid="print-templates-ocean"
      title={t('settingsNav.items.print.title')}
      subtitle={t('settingsPages.print.subtitle')}
      actions={<button type="button" className="sb-primary-btn" onClick={handleSave} disabled={busy || !tpl?.id}>{busy ? t('settingsPages.print.working') : t('settingsPages.print.save')}</button>}
    >
      <div className="sb-print">

      {needsMigration && (
        <p className="sb-alert sb-alert-warn">
          {t('settingsPages.print.needs_migration')} (<code dir="ltr">20260617000001_phase15_print_templates.sql</code>)
        </p>
      )}
      {noTemplates && (
        <p className="sb-info-note">{t('settingsPages.print.no_templates')}</p>
      )}
      {error && <p className="sb-alert sb-alert-danger" role="alert">{error}</p>}
      {saved && <p className="sb-alert sb-alert-good" role="status">{t('settingsPages.print.saved')}</p>}

      {tpl && (
        <>
          {/* Template manager bar */}
          <div className={card}>
            <div className="flex flex-wrap items-end gap-3">
              <div style={{ minWidth: 220 }}>
                <label className={labelCls} htmlFor="print-tpl">{t('settingsPages.print.editing')}</label>
                <select id="print-tpl" className={selCls} value={tpl.id}
                  onChange={e => { const sel = templates.find(x => x.id === e.target.value); if (sel) setTpl({ ...sel, settings: normalizeSettings(sel.settings) }); }}>
                  {templates.map(x => <option key={x.id} value={x.id}>{x.name}{x.is_default ? `  ★ ${t('settingsPages.print.default_lc')}` : ''}</option>)}
                </select>
              </div>
              <button type="button" className="sb-secondary-btn" onClick={handleNew} disabled={busy}>+ {t('settingsPages.print.new')}</button>
              <button type="button" className="sb-secondary-btn" onClick={handleDuplicate} disabled={busy}>{t('settingsPages.print.duplicate')}</button>
              <button type="button" className="sb-secondary-btn" onClick={handleSetDefault} disabled={busy || tpl.is_default}>
                {tpl.is_default ? `★ ${t('settingsPages.print.default')}` : t('settingsPages.print.set_default')}
              </button>
              <button type="button" className="sb-secondary-btn sb-btn-danger" onClick={handleDelete} disabled={busy || tpl.is_default}>{t('common.delete')}</button>
            </div>
          </div>

          {/* Per-document-type defaults matrix */}
          <div className={card}>
            <h2 className="sb-print-h2">{t('settingsPages.print.doc_defaults')}</h2>
            <p className="sb-print-hint">{t('settingsPages.print.doc_defaults_hint')}</p>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {DOC_TYPES.map(({ key, label }) => (
                <div key={key}>
                  <label className={labelCls} htmlFor={`print-doc-${key}`}>{t(`settingsPages.print.docs.${key}`, { defaultValue: label })}</label>
                  <select id={`print-doc-${key}`} className={selCls} value={docDefaults[key] ?? ''} onChange={e => handleDocDefault(key, e.target.value)} disabled={busy}>
                    <option value="">{t('settingsPages.print.company_default')}</option>
                    {templates.map(x => <option key={x.id} value={x.id}>{x.name}</option>)}
                  </select>
                </div>
              ))}
            </div>
          </div>

          <div className="grid grid-cols-1 gap-5 lg:grid-cols-[minmax(0,1fr)_480px]">
            {/* ── LEFT: controls ──────────────────────────────────────── */}
            <div className="flex flex-col gap-5">
              <div className={card}>
                <label className={labelCls} htmlFor="print-name">{t('settingsPages.print.name')}</label>
                <input id="print-name" className="sb-field sb-print-input"
                  value={tpl.name} onChange={e => setField('name', e.target.value)} placeholder={t('settingsPages.print.name_ph')} />
              </div>

              <div className={card}>
                <h2 className="sb-print-h2">{t('settingsPages.print.style')}</h2>
                <p className="sb-print-hint">{t('settingsPages.print.style_hint')}</p>
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                  {STYLE_ORDER.map(style => {
                    const preset = STYLE_PRESETS[style];
                    const active = tpl.settings.layout !== 'elegant' && tpl.template_style === style;
                    return (
                      <button key={style} type="button" onClick={() => chooseStyle(style)} className="rounded-card border p-3 text-start transition"
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
                  {(() => {
                    const active = tpl.settings.layout === 'elegant';
                    return (
                      <button type="button" onClick={chooseElegant} className="rounded-card border p-3 text-start transition"
                        style={{ borderColor: active ? ELEGANT_COLORS.accent : '#e2e8f0', boxShadow: active ? `0 0 0 2px ${ELEGANT_COLORS.accent}` : 'none', background: active ? '#fff' : 'transparent' }}>
                        <div style={{ display: 'flex', gap: 4, marginBottom: 6 }}>
                          {[ELEGANT_COLORS.primary, ELEGANT_COLORS.accent, ELEGANT_COLORS.secondary].map((c, i) => (
                            <span key={i} style={{ width: 14, height: 14, borderRadius: 3, background: c, border: '1px solid rgba(0,0,0,.08)' }} />
                          ))}
                        </div>
                        <div className="text-sm font-medium text-ink-primary">{t('settingsPages.print.elegant')}</div>
                        <div className="text-[11px] leading-snug text-ink-tertiary">{t('settingsPages.print.elegant_desc')}</div>
                      </button>
                    );
                  })()}
                </div>
              </div>

              {tpl.settings.layout === 'elegant' && (
                <div className={card}>
                  <h2 className="sb-print-h2">{t('settingsPages.print.elegant_layout')}</h2>
                  <p className="sb-print-hint">{t('settingsPages.print.elegant_hint')}</p>
                  <div className="flex flex-wrap items-center gap-4">
                    <div style={{ width: 120, height: 84, border: `1px dashed ${theme.border}`, borderRadius: 6, display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden', background: '#fff' }}>
                      {tpl.settings.heroImageUrl
                        ? <img src={tpl.settings.heroImageUrl} alt="header" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                        : <span className="px-1 text-center text-[11px] text-ink-tertiary">{t('settingsPages.print.no_hero')}</span>}
                    </div>
                    <div className="flex flex-col gap-2">
                      <label className="sb-secondary-btn sb-btn-inline sb-print-upload">
                        {uploadingHero ? t('settingsPages.print.uploading') : (tpl.settings.heroImageUrl ? t('settingsPages.print.replace_hero') : t('settingsPages.print.upload_hero'))}
                        <input type="file" accept="image/png,image/jpeg" className="hidden" disabled={uploadingHero}
                          onChange={e => { handleHeroUpload(e.target.files?.[0] ?? null); e.target.value = ''; }} />
                      </label>
                      {tpl.settings.heroImageUrl && (
                        <button type="button" className="text-start text-sm text-danger-600 hover:underline" onClick={() => setSetting('heroImageUrl', '')}>
                          {t('settingsPages.print.remove_hero')}
                        </button>
                      )}
                    </div>
                  </div>
                  <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
                    <div><label className={labelCls}>{t('settingsPages.print.tagline')}</label>
                      <input className="sb-field sb-print-input" value={tpl.settings.tagline} onChange={e => setSetting('tagline', e.target.value)} placeholder="PEOPLE | MOMENTS | EVENTS" /></div>
                    <div><label className={labelCls}>{t('settingsPages.print.subtitle_field')}</label>
                      <input className="sb-field sb-print-input" value={tpl.settings.subtitle} onChange={e => setSetting('subtitle', e.target.value)} placeholder="Events that bring people together" /></div>
                    <div><label className={labelCls}>{t('settingsPages.print.hero_words')}</label>
                      <textarea className="sb-field sb-print-input sb-print-area" rows={4} value={tpl.settings.heroWords} onChange={e => setSetting('heroWords', e.target.value)} placeholder={'Plan\nCreate\nCelebrate'} /></div>
                    <div><label className={labelCls}>{t('settingsPages.print.intro')}</label>
                      <textarea className="sb-field sb-print-input sb-print-area" rows={4} value={tpl.settings.introText} onChange={e => setSetting('introText', e.target.value)} placeholder="Thank you for considering us. We are pleased to provide the following quotation." /></div>
                    <div className="sm:col-span-2"><label className={labelCls}>{t('settingsPages.print.terms')}</label>
                      <textarea className="sb-field sb-print-input sb-print-area" rows={4} value={tpl.settings.termsEn} onChange={e => setSetting('termsEn', e.target.value)} /></div>
                    <label className="flex cursor-pointer items-center gap-2 sm:col-span-2">
                      <input type="checkbox" className="h-4 w-4 rounded border-border-subtle accent-brand-600"
                        checked={tpl.settings.showCustomerAcceptance} onChange={e => setSetting('showCustomerAcceptance', e.target.checked)} />
                      <span className="text-sm text-ink-primary">{t('settingsPages.print.acceptance')}</span>
                    </label>
                  </div>
                </div>
              )}

              <div className={card}>
                <h2 className="sb-print-h2">{t('settingsPages.print.colours')}</h2>
                <div className="mt-3 grid grid-cols-2 gap-4">
                  {([['primary_color', t('settingsPages.print.c_primary')], ['secondary_color', t('settingsPages.print.c_secondary')], ['accent_color', t('settingsPages.print.c_accent')], ['text_color', t('settingsPages.print.c_text')]] as [keyof PrintTemplate, string][]).map(([key, label]) => (
                    <div key={key}>
                      <label className={labelCls}>{label}</label>
                      <div className="flex items-center gap-2">
                        <input type="color" value={String(tpl[key])} onChange={e => setField(key, e.target.value as PrintTemplate[typeof key])} style={{ width: 40, height: 34, border: 'none', background: 'none', cursor: 'pointer' }} />
                        <input dir="ltr" aria-label={label} className="sb-field sb-print-input sb-mono"
                          value={String(tpl[key])} onChange={e => setField(key, e.target.value as PrintTemplate[typeof key])} />
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              <div className={card}>
                <h2 className="sb-print-h2">{t('settingsPages.print.typography')}</h2>
                <div className="mt-3 grid grid-cols-2 gap-4">
                  <div><label className={labelCls}>{t('settingsPages.print.font')}</label>
                    <select className={selCls} value={tpl.font_family} onChange={e => setField('font_family', e.target.value as FontFamily)}>{FONTS.map(f => <option key={f} value={f}>{f}</option>)}</select></div>
                  <div><label className={labelCls}>{t('settingsPages.print.font_size')}</label>
                    <select className={selCls} value={tpl.font_size} onChange={e => setField('font_size', e.target.value as FontSize)}>{SIZES.map(s => <option key={s} value={s}>{t(`settingsPages.print.opt_${s}`)}</option>)}</select></div>
                  <div><label className={labelCls}>{t('settingsPages.print.logo_pos')}</label>
                    <select className={selCls} value={tpl.logo_position} onChange={e => setField('logo_position', e.target.value as LogoPosition)}>{LOGO_POS.map(p => <option key={p} value={p}>{t(`settingsPages.print.opt_${p}`)}</option>)}</select></div>
                  <div><label className={labelCls}>{t('settingsPages.print.logo_size')}</label>
                    <select className={selCls} value={tpl.logo_size} onChange={e => setField('logo_size', e.target.value as LogoSize)}>{LOGO_SZ.map(s => <option key={s} value={s}>{t(`settingsPages.print.opt_${s}`)}</option>)}</select></div>
                </div>
              </div>

              <div className={card}>
                <h2 className="sb-print-h2">{t('settingsPages.print.logo')}</h2>
                <p className="sb-print-hint">{t('settingsPages.print.logo_hint')} <button type="button" className="sb-row-link text-brand-600" style={{ minHeight: 0, padding: 0 }} onClick={() => navigate('/settings/company')}>{t('settingsNav.items.company.title')}</button></p>
                <div className="flex items-center gap-4">
                  <div style={{ width: 96, height: 64, border: `1px dashed ${theme.border}`, borderRadius: 8, display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden', background: '#fff' }}>
                    {company?.logo_url
                      ? <img src={company.logo_url} alt="logo" style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain' }} />
                      : <span className="text-[11px] text-ink-tertiary">{t('settingsPages.print.no_logo')}</span>}
                  </div>
                  <label className="sb-secondary-btn sb-btn-inline sb-print-upload">
                    {uploading ? t('settingsPages.print.uploading') : (company?.logo_url ? t('settingsPages.print.replace_logo') : t('settingsPages.print.upload_logo'))}
                    <input type="file" accept="image/*" className="hidden" disabled={uploading}
                      onChange={e => handleLogoUpload(e.target.files?.[0] ?? null)} />
                  </label>
                </div>
              </div>

              {tpl.settings.layout !== 'elegant' && <div className={card}>
                <h2 className="sb-print-h2">{t('settingsPages.print.letterhead')}</h2>
                <p className="sb-print-hint">{t('settingsPages.print.letterhead_hint')}</p>
                <div className="flex flex-wrap items-center gap-4">
                  <div style={{ width: 84, height: 119, border: `1px dashed ${theme.border}`, borderRadius: 6, display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden', background: '#fff' }}>
                    {tpl.settings.letterheadUrl
                      ? <img src={tpl.settings.letterheadUrl} alt="letterhead" style={{ width: '100%', height: '100%', objectFit: 'fill' }} />
                      : <span className="px-1 text-center text-[11px] text-ink-tertiary">{t('settingsPages.print.no_letterhead')}</span>}
                  </div>
                  <div className="flex flex-col gap-2">
                    <label className="sb-secondary-btn sb-btn-inline sb-print-upload">
                      {uploadingLh ? t('settingsPages.print.uploading') : (tpl.settings.letterheadUrl ? t('settingsPages.print.replace_letterhead') : t('settingsPages.print.upload_letterhead'))}
                      <input type="file" accept="image/png,image/jpeg" className="hidden" disabled={uploadingLh}
                        onChange={e => { handleLetterheadUpload(e.target.files?.[0] ?? null); e.target.value = ''; }} />
                    </label>
                    {tpl.settings.letterheadUrl && (
                      <button type="button" className="text-start text-sm text-danger-600 hover:underline" onClick={() => setSetting('letterheadUrl', '')}>
                        {t('settingsPages.print.remove_letterhead')}
                      </button>
                    )}
                  </div>
                </div>
                {tpl.settings.letterheadUrl && (
                  <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
                    <div><label className={labelCls}>{t('settingsPages.print.lh_top')}</label>
                      <input type="number" min={0} max={150} className="sb-field sb-print-input"
                        value={tpl.settings.letterheadTopMm} onChange={e => setSetting('letterheadTopMm', Math.max(0, Math.min(150, Number(e.target.value) || 0)))} /></div>
                    <div><label className={labelCls}>{t('settingsPages.print.lh_bottom')}</label>
                      <input type="number" min={0} max={150} className="sb-field sb-print-input"
                        value={tpl.settings.letterheadBottomMm} onChange={e => setSetting('letterheadBottomMm', Math.max(0, Math.min(150, Number(e.target.value) || 0)))} /></div>
                    <label className="flex cursor-pointer items-center gap-2 sm:col-span-2">
                      <input type="checkbox" className="h-4 w-4 rounded border-border-subtle accent-brand-600"
                        checked={tpl.settings.letterheadHideCompany} onChange={e => setSetting('letterheadHideCompany', e.target.checked)} />
                      <span className="text-sm text-ink-primary">{t('settingsPages.print.lh_hide')}</span>
                    </label>
                    <p className="sb-print-hint sm:col-span-2">{t('settingsPages.print.letterhead_spaces_hint')}</p>
                  </div>
                )}
              </div>}

              <div className={card}>
                <h2 className="sb-print-h2">{t('settingsPages.print.footer_line')}</h2>
                <div className="mt-3 grid grid-cols-1 gap-4 sm:grid-cols-2">
                  <div><label className={labelCls}>{t('settingsPages.print.footer_en')}</label>
                    <textarea className="sb-field sb-print-input sb-print-area" rows={2} value={tpl.settings.footerEn} onChange={e => setFooter('footerEn', e.target.value)} placeholder="Bank: ENBD · IBAN: AE00… · Thank you" /></div>
                  {arabicOn && (
                  <div><label className={labelCls}>{t('settingsPages.print.footer_ar')}</label>
                    <textarea className="sb-field sb-print-input sb-print-area" dir="rtl" rows={2} value={tpl.settings.footerAr} onChange={e => setFooter('footerAr', e.target.value)} /></div>
                  )}
                </div>
              </div>

              <div className={card}>
                <h2 className="sb-print-h2">{t('settingsPages.print.payment_terms')}</h2>
                <p className="sb-print-hint">{t('settingsPages.print.payment_terms_hint')}</p>
                <div className="mt-1 grid grid-cols-1 gap-4 sm:grid-cols-2">
                  <div><label className={labelCls}>{t('settingsPages.print.terms_en')}</label>
                    <textarea className="sb-field sb-print-input sb-print-area" rows={2} value={tpl.settings.paymentTermsEn} onChange={e => setFooter('paymentTermsEn', e.target.value)} placeholder="Payment due within 30 days of invoice date." /></div>
                  {arabicOn && (
                  <div><label className={labelCls}>{t('settingsPages.print.terms_ar')}</label>
                    <textarea className="sb-field sb-print-input sb-print-area" dir="rtl" rows={2} value={tpl.settings.paymentTermsAr} onChange={e => setFooter('paymentTermsAr', e.target.value)} /></div>
                  )}
                </div>
              </div>

              <div className={card}>
                <h2 className="sb-print-h2">{t('settingsPages.print.bank')}</h2>
                <p className="sb-print-hint">{t('settingsPages.print.bank_hint')}</p>
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  <div><label className={labelCls}>{t('settingsPages.print.acc_name')}</label>
                    <input className="sb-field sb-print-input" value={tpl.settings.bankAccountName} onChange={e => setFooter('bankAccountName', e.target.value)} placeholder="Your Company Trading LLC" /></div>
                  <div><label className={labelCls}>{t('settingsPages.print.bank_name')}</label>
                    <input className="sb-field sb-print-input" value={tpl.settings.bankName} onChange={e => setFooter('bankName', e.target.value)} placeholder="Emirates NBD" /></div>
                  <div><label className={labelCls}>{t('settingsPages.print.acc_no')}</label>
                    <input className="sb-field sb-print-input" value={tpl.settings.bankAccountNumber} onChange={e => setFooter('bankAccountNumber', e.target.value)} placeholder="012-345-6789-001" /></div>
                  <div><label className={labelCls}>{t('settingsPages.print.iban')}</label>
                    <input className="sb-field sb-print-input" value={tpl.settings.bankIban} onChange={e => setFooter('bankIban', e.target.value)} placeholder="AE07 0331 2345 6789 0010 02" /></div>
                </div>
              </div>

              <div className={card}>
                <h2 className="sb-print-h2">{t('settingsPages.print.signature')}</h2>
                <p className="sb-print-hint">{t('settingsPages.print.signature_hint')}</p>
                <input className="sb-field sb-print-input sm:w-1/2" value={tpl.settings.signatureLabel} onChange={e => setFooter('signatureLabel', e.target.value)} placeholder="Authorised Signatory" />
              </div>

              <div className={card}>
                <h2 className="sb-print-h2">{t('settingsPages.print.show_on_docs')}</h2>
                <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2">
                  {TOGGLES.filter(({ key }) => arabicOn || key !== 'showItemDescription').map(({ key, label }) => (
                    <label key={key} className="flex cursor-pointer items-center gap-2">
                      <input type="checkbox" className="h-4 w-4 rounded border-border-subtle accent-brand-600" checked={!!tpl.settings[key]} onChange={e => setToggle(key, e.target.checked)} />
                      <span className="text-sm text-ink-primary">{t(`settingsPages.print.toggle.${String(key)}`, { defaultValue: label })}</span>
                    </label>
                  ))}
                </div>
              </div>
            </div>

            {/* ── RIGHT: live preview ─────────────────────────────────── */}
            <div>
              <div className="sticky top-4">
                <div className="mb-2 flex items-center gap-2">
                  <span className="sb-print-label" style={{ margin: 0 }}>{t('settingsPages.print.live_preview')}</span>
                  <span className="rounded-pill bg-brand-50 px-2 py-0.5 text-[10px] font-semibold text-brand-700">{tpl.name}</span>
                </div>
                <div style={{ border: `1px solid ${theme.border}`, borderRadius: 10, overflow: 'hidden', background: '#F8FAFC', height: 660 }}>
                  <div style={{ transform: 'scale(0.54)', transformOrigin: 'top left', width: '210mm' }}>
                    <ConfigurableDocTemplate data={{
                      ...SAMPLE_TAX_INVOICE,
                      // Sample banking stripped so the preview reflects the template's
                      // own Bank/payment fields (same source real documents use).
                      banking: null,
                      company: {
                        ...SAMPLE_TAX_INVOICE.company,
                        name:     company?.name     ?? SAMPLE_TAX_INVOICE.company.name,
                        logo_url: company?.logo_url ?? null,
                        trn:      company?.tax_id   ?? SAMPLE_TAX_INVOICE.company.trn,
                        country:  company?.country_code ?? SAMPLE_TAX_INVOICE.company.country,
                      },
                    }} template={tpl} />
                  </div>
                </div>
                <p className="sb-print-hint" style={{ marginTop: 8 }}>{t('settingsPages.print.sample_note')}</p>
              </div>
            </div>
          </div>

          <div className="sb-form-actions">
            <button type="button" className="sb-primary-btn" onClick={handleSave} disabled={busy || !tpl?.id}>{busy ? t('settingsPages.print.working') : t('settingsPages.print.save')}</button>
          </div>
        </>
      )}
      </div>
    </OceanPage>
  );
}
