/**
 * Print Settings — rebuilt 2026-06-13 to be self-explanatory.
 *
 * Every document uses the locked gold "Signature" template, so there are
 * no template pickers or colour pickers to puzzle over. What's left are
 * the few things that genuinely change a printout:
 *   - Footer text (EN / AR) — the line printed across the bottom
 *   - Field toggles — show/hide due date & bank details
 * …and a LIVE A4 preview on the right that updates as you type, so you
 * can see exactly what your documents will look like.
 *
 * The logo lives in Company Profile (shared across the app), so we link
 * there rather than duplicating the upload here.
 */
import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { getAdapter } from '@/data/index';
import { useAuthStore } from '@/store/auth';
import { Button } from '@/ui/button';
import { PageHeader } from '@/ui/primitives';
import { theme } from '@/ui/theme';
import { BoltDocTemplate } from '@/modules/print/_signature/templates/bolt-v4';
import { SAMPLE_TAX_INVOICE } from '@/modules/print/_signature/sample-data';
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
  accent_color:         '#F5C242',
};

export default function PrintSettingsPage() {
  const { t }      = useTranslation();
  const navigate   = useNavigate();
  const company_id = useAuthStore(s => s.company_id);
  const adapter    = getAdapter();

  const [config,  setConfig]  = useState<PrintConfig>(DEFAULT_CONFIG);
  const [loading, setLoading] = useState(true);
  const [saving,  setSaving]  = useState(false);
  const [saved,   setSaved]   = useState(false);
  const [error,   setError]   = useState<string | null>(null);

  useEffect(() => {
    if (!company_id) return;
    adapter.companies.getPrintConfig(company_id)
      .then(cfg => setConfig({ ...DEFAULT_CONFIG, ...cfg }))
      .catch(err => setError(String(err)))
      .finally(() => setLoading(false));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [company_id]);

  async function handleSave() {
    if (!company_id) return;
    setSaving(true); setError(null); setSaved(false);
    try {
      await adapter.companies.savePrintConfig(company_id, config);
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
    <div style={{ maxWidth: '1180px', margin: '0 auto', padding: '8px 0', display: 'flex', flexDirection: 'column', gap: '20px' }}>
      <PageHeader
        title={t('print.settings_title')}
        subtitle="Set the footer line and choose what shows on your printed documents. The preview on the right updates as you type."
        actions={
          <Button onClick={handleSave} disabled={saving}>
            {saving ? t('common.loading') : t('common.save')}
          </Button>
        }
      />

      {error && (
        <div style={{ background: theme.dangerSoft, border: `1px solid ${theme.dangerBorder}`, borderRadius: '8px', padding: '10px 16px', fontSize: '13px', color: theme.danger }}>{error}</div>
      )}
      {saved && (
        <div style={{ background: theme.successSoft, border: `1px solid ${theme.successBorder}`, borderRadius: '8px', padding: '10px 16px', fontSize: '13px', color: theme.success }}>{t('common.saved')}</div>
      )}

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-[minmax(0,1fr)_460px]">
        {/* ── LEFT: the controls ─────────────────────────────────────── */}
        <div className="flex flex-col gap-5">
          {/* Logo → Company Profile */}
          <div className="rounded-card border border-border-subtle bg-surface-card p-5">
            <h2 className="text-sm font-semibold text-ink-primary">Logo &amp; company details</h2>
            <p className="mt-1 text-xs text-ink-tertiary">
              Your logo, company name, address and TRN print at the top of every document.
              They live in your Company Profile.
            </p>
            <Button variant="secondary" size="sm" className="mt-3" onClick={() => navigate('/settings/company')}>
              Edit Company Profile →
            </Button>
          </div>

          {/* Footer text */}
          <div className="rounded-card border border-border-subtle bg-surface-card p-5">
            <h2 className="text-sm font-semibold text-ink-primary">Footer line</h2>
            <p className="mt-1 mb-3 text-xs text-ink-tertiary">
              Printed in the navy strip at the very bottom of each page — a good place for
              bank details or a thank-you note.
            </p>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div>
                <label className="mb-1 block text-xs font-medium text-ink-secondary">Footer (English)</label>
                <textarea
                  className="w-full rounded-input border border-border-subtle bg-surface-input p-2 text-sm text-ink-primary focus:outline-none focus:ring-1 focus:ring-brand-500"
                  rows={3}
                  value={config.footer_en}
                  onChange={e => set('footer_en', e.target.value)}
                  placeholder="e.g. Bank: ENBD · IBAN: AE00… · Thank you for your business"
                />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-ink-secondary">Footer (Arabic)</label>
                <textarea
                  className="w-full rounded-input border border-border-subtle bg-surface-input p-2 text-sm text-ink-primary focus:outline-none focus:ring-1 focus:ring-brand-500"
                  dir="rtl"
                  rows={3}
                  value={config.footer_ar}
                  onChange={e => set('footer_ar', e.target.value)}
                  placeholder="مثال: البنك: ENBD · رقم IBAN: AE00… · شكرًا لكم"
                />
              </div>
            </div>
          </div>

          {/* Field toggles */}
          <div className="rounded-card border border-border-subtle bg-surface-card p-5">
            <h2 className="text-sm font-semibold text-ink-primary">Show on documents</h2>
            <p className="mt-1 mb-3 text-xs text-ink-tertiary">Tick what should appear on the printout. Watch the preview change.</p>
            <div className="space-y-3">
              {([
                { key: 'show_due_date',     label: 'Due date', hint: 'Shows the payment due date next to the invoice date.' },
                { key: 'show_bank_details', label: 'Bank / payment details', hint: 'Shows the Payment Method block (account name, bank, number).' },
                { key: 'show_salesperson',  label: 'Salesperson', hint: 'Shows the salesperson name on sales documents.' },
              ] as { key: keyof PrintConfig; label: string; hint: string }[]).map(({ key, label, hint }) => (
                <label key={key} className="flex cursor-pointer items-start gap-3">
                  <input
                    type="checkbox"
                    className="mt-0.5 h-4 w-4 rounded border-border-subtle accent-brand-600"
                    checked={!!config[key]}
                    onChange={e => set(key, e.target.checked as PrintConfig[typeof key])}
                  />
                  <span className="text-sm">
                    <span className="block text-ink-primary">{label}</span>
                    <span className="block text-xs text-ink-tertiary">{hint}</span>
                  </span>
                </label>
              ))}
            </div>
          </div>
        </div>

        {/* ── RIGHT: live preview ────────────────────────────────────── */}
        <div>
          <div className="sticky top-4">
            <div className="mb-2 flex items-center gap-2">
              <span className="text-xs font-semibold uppercase tracking-wider text-ink-tertiary">Live preview</span>
              <span className="rounded-pill bg-brand-50 px-2 py-0.5 text-[10px] font-semibold text-brand-700">Sample invoice</span>
            </div>
            {/* A4 page scaled to fit the column. transform-origin top-left so
                the scaled page hugs the corner; the wrapper height is the
                scaled A4 height (297mm × scale). */}
            <div style={{
              border: `1px solid ${theme.border}`, borderRadius: '10px',
              overflow: 'hidden', background: '#F8FAFC', height: '620px',
            }}>
              <div style={{ transform: 'scale(0.52)', transformOrigin: 'top left', width: '210mm' }}>
                <BoltDocTemplate data={SAMPLE_TAX_INVOICE} config={config} />
              </div>
            </div>
            <p className="mt-2 text-xs text-ink-tertiary">
              This is a sample. Your real documents use your own logo, company details and data.
            </p>
          </div>
        </div>
      </div>

      <div className="flex justify-end">
        <Button onClick={handleSave} disabled={saving}>
          {saving ? t('common.loading') : t('common.save')}
        </Button>
      </div>
    </div>
  );
}
