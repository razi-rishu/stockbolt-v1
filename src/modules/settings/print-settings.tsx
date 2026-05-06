/**
 * Print Settings page — G1 (Phase 11)
 * Per-doc template picker, footer text EN+AR, field toggles, accent color.
 */
import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { getAdapter } from '@/data/index';
import { useAuthStore } from '@/store/auth';
import { Button } from '@/ui/button';
import { Input } from '@/ui/input';
import { Select } from '@/ui/select';
import type { PrintConfig } from '@/data/adapter';

const DEFAULT_CONFIG: PrintConfig = {
  invoice_template:     'classic',
  quote_template:       'classic',
  statement_template:   'classic',
  credit_note_template: 'classic',
  debit_note_template:  'classic',
  po_template:          'classic',
  bill_template:        'classic',
  footer_en:            '',
  footer_ar:            '',
  show_salesperson:     true,
  show_due_date:        true,
  show_bank_details:    true,
  accent_color:         '#4f46e5',
};

const INVOICE_TEMPLATES = [
  { value: 'classic',   label: 'Classic (A4)' },
  { value: 'bilingual', label: 'Bilingual (EN + AR)' },
  { value: 'thermal',   label: 'Thermal (80mm)' },
];

const DOC_TEMPLATES = [
  { value: 'classic',   label: 'Classic (A4)' },
  { value: 'bilingual', label: 'Bilingual (EN + AR)' },
];

const STATEMENT_TEMPLATES = [
  { value: 'classic', label: 'Classic (A4)' },
];

export default function PrintSettingsPage() {
  const { t }        = useTranslation();
  const { companyId } = useAuthStore();
  const adapter       = getAdapter();

  const [config,  setConfig]  = useState<PrintConfig>(DEFAULT_CONFIG);
  const [loading, setLoading] = useState(true);
  const [saving,  setSaving]  = useState(false);
  const [saved,   setSaved]   = useState(false);
  const [error,   setError]   = useState<string | null>(null);

  useEffect(() => {
    if (!companyId) return;
    adapter.companies.getPrintConfig(companyId)
      .then(cfg => setConfig({ ...DEFAULT_CONFIG, ...cfg }))
      .catch(err => setError(String(err)))
      .finally(() => setLoading(false));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [companyId]);

  async function handleSave() {
    if (!companyId) return;
    setSaving(true);
    setError(null);
    setSaved(false);
    try {
      await adapter.companies.savePrintConfig(companyId, config);
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
    } catch (err) {
      setError(String(err));
    } finally {
      setSaving(false);
    }
  }

  function set<K extends keyof PrintConfig>(key: K, value: PrintConfig[K]) {
    setConfig(c => ({ ...c, [key]: value }));
  }

  if (loading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <div className="h-5 w-5 animate-spin rounded-full border-2 border-brand-500 border-t-transparent" />
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-2xl space-y-6 p-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold text-ink-primary">{t('print.settings_title')}</h1>
          <p className="mt-1 text-sm text-ink-secondary">{t('print.settings_desc')}</p>
        </div>
        <Button onClick={handleSave} disabled={saving}>
          {saving ? t('common.loading') : t('common.save')}
        </Button>
      </div>

      {error && <div className="rounded-input bg-red-50 px-4 py-2 text-sm text-red-700">{error}</div>}
      {saved && <div className="rounded-input bg-green-50 px-4 py-2 text-sm text-green-700">{t('common.saved')}</div>}

      {/* Template selection */}
      <div className="rounded-card border border-border-subtle bg-surface-card p-5">
        <h2 className="mb-4 text-sm font-semibold text-ink-primary">{t('print.templates')}</h2>
        <div className="grid grid-cols-2 gap-4">
          <Select
            label={t('print.invoice_template')}
            options={INVOICE_TEMPLATES}
            value={config.invoice_template}
            onChange={e => set('invoice_template', e.target.value as PrintConfig['invoice_template'])}
          />
          <Select
            label={t('print.quote_template')}
            options={DOC_TEMPLATES}
            value={config.quote_template}
            onChange={e => set('quote_template', e.target.value as PrintConfig['quote_template'])}
          />
          <Select
            label={t('print.statement_template')}
            options={STATEMENT_TEMPLATES}
            value={config.statement_template}
            onChange={e => set('statement_template', e.target.value as PrintConfig['statement_template'])}
          />
          <Select
            label={t('print.credit_note_template')}
            options={DOC_TEMPLATES}
            value={config.credit_note_template}
            onChange={e => set('credit_note_template', e.target.value as PrintConfig['credit_note_template'])}
          />
          <Select
            label={t('print.debit_note_template')}
            options={DOC_TEMPLATES}
            value={config.debit_note_template}
            onChange={e => set('debit_note_template', e.target.value as PrintConfig['debit_note_template'])}
          />
          <Select
            label={t('print.po_template')}
            options={DOC_TEMPLATES}
            value={config.po_template}
            onChange={e => set('po_template', e.target.value as PrintConfig['po_template'])}
          />
          <Select
            label={t('print.bill_template')}
            options={DOC_TEMPLATES}
            value={config.bill_template}
            onChange={e => set('bill_template', e.target.value as PrintConfig['bill_template'])}
          />
        </div>
      </div>

      {/* Accent color */}
      <div className="rounded-card border border-border-subtle bg-surface-card p-5">
        <h2 className="mb-4 text-sm font-semibold text-ink-primary">{t('print.branding')}</h2>
        <div className="flex items-center gap-4">
          <div>
            <label className="mb-1 block text-xs font-medium text-ink-secondary">{t('print.accent_color')}</label>
            <input
              type="color"
              value={config.accent_color}
              onChange={e => set('accent_color', e.target.value)}
              className="h-10 w-20 cursor-pointer rounded border border-border-subtle"
            />
          </div>
          <div className="flex-1">
            <Input
              label={t('print.accent_color_hex')}
              value={config.accent_color}
              onChange={e => set('accent_color', e.target.value)}
              placeholder="#4f46e5"
            />
          </div>
          <div
            className="flex h-10 w-32 items-center justify-center rounded text-sm font-bold text-white"
            style={{ backgroundColor: config.accent_color }}
          >
            Preview
          </div>
        </div>
      </div>

      {/* Footer text */}
      <div className="rounded-card border border-border-subtle bg-surface-card p-5">
        <h2 className="mb-4 text-sm font-semibold text-ink-primary">{t('print.footer')}</h2>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="mb-1 block text-xs font-medium text-ink-secondary">{t('print.footer_en')}</label>
            <textarea
              className="w-full rounded-input border border-border-subtle bg-surface-input p-2 text-sm text-ink-primary focus:outline-none focus:ring-1 focus:ring-brand-500"
              rows={3}
              value={config.footer_en}
              onChange={e => set('footer_en', e.target.value)}
              placeholder="e.g. Bank: HSBC | IBAN: AE00… | Thank you for your business"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-ink-secondary">{t('print.footer_ar')}</label>
            <textarea
              className="w-full rounded-input border border-border-subtle bg-surface-input p-2 text-sm text-ink-primary focus:outline-none focus:ring-1 focus:ring-brand-500"
              dir="rtl"
              rows={3}
              value={config.footer_ar}
              onChange={e => set('footer_ar', e.target.value)}
              placeholder="مثال: البنك: HSBC | رقم IBAN: AE00… | شكرًا لكم"
            />
          </div>
        </div>
      </div>

      {/* Field toggles */}
      <div className="rounded-card border border-border-subtle bg-surface-card p-5">
        <h2 className="mb-4 text-sm font-semibold text-ink-primary">{t('print.fields')}</h2>
        <div className="space-y-3">
          {(
            [
              { key: 'show_salesperson',  label: t('print.show_salesperson') },
              { key: 'show_due_date',     label: t('print.show_due_date') },
              { key: 'show_bank_details', label: t('print.show_bank_details') },
            ] as { key: keyof PrintConfig; label: string }[]
          ).map(({ key, label }) => (
            <label key={key} className="flex cursor-pointer items-center gap-3">
              <input
                type="checkbox"
                className="h-4 w-4 rounded border-border-subtle text-brand-500"
                checked={!!config[key]}
                onChange={e => set(key, e.target.checked as PrintConfig[typeof key])}
              />
              <span className="text-sm text-ink-primary">{label}</span>
            </label>
          ))}
        </div>
      </div>

      {/* Save button (bottom) */}
      <div className="flex justify-end">
        <Button onClick={handleSave} disabled={saving}>
          {saving ? t('common.loading') : t('common.save')}
        </Button>
      </div>
    </div>
  );
}
