/**
 * Tax Rates settings — Phase 14.17 (upgraded from read-only to full CRUD).
 *
 * - Lists all active + inactive rates for the company
 * - "Seed UAE defaults" button inserts Standard 5%, Zero-rated, Exempt when missing
 * - "+ Add rate" lets you create custom rates
 * - Toggle active/inactive inline
 */
import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { getAdapter } from '@/data/index';
import { useAuthStore } from '@/store/auth';
import { useTranslation } from 'react-i18next';
import { Input } from '@/ui/input';
import type { Column } from '@/ui/table';
import { OceanPage, OceanTable } from '@/components/ocean-list';
import { Plus, Zap, Percent, BookOpen, Loader2 } from 'lucide-react';
import ImportExportButton from '@/modules/settings/import-export/ImportExportButton';
import type { TaxRateRow } from '@/data/adapter';

const CATEGORY_LABEL: Record<string, string> = {
  standard:    'Standard',
  zero_rated:  'Zero-rated',
  exempt:      'Exempt',
};

const CATEGORY_HINT: Record<string, string> = {
  standard:    'Default VAT rate (e.g. UAE 5%) — most goods and services.',
  zero_rated:  'Taxable at 0% — exports, certain education / healthcare. Reported on VAT return.',
  exempt:      'Outside the VAT system — financial services, residential rent. Not on VAT return.',
};

const TAX_TYPES = ['standard', 'zero_rated', 'exempt'] as const;

interface DraftRate {
  name: string;
  tax_type: string;
  rate: string;
}

export default function TaxRatesSettingsPage() {
  const { company_id } = useAuthStore();
  const qc = useQueryClient();
  const { t } = useTranslation();
  // English constants above stay as the fallback text.
  const catLabel = (c: string) => t(`settingsPages.tax.cat.${c}`, { defaultValue: CATEGORY_LABEL[c] ?? c });
  const catHint = (c: string) => t(`settingsPages.tax.hint.${c}`, { defaultValue: CATEGORY_HINT[c] ?? '' });

  // Fetch ALL rates (active + inactive) for management view
  const { data: rates = [], isLoading } = useQuery<TaxRateRow[]>({
    queryKey: ['taxRates_all', company_id],
    queryFn:  () => getAdapter().taxRates.listAll(company_id!),
    enabled:  !!company_id,
  });

  const [showAdd, setShowAdd] = useState(false);
  const [draft, setDraft] = useState<DraftRate>({ name: '', tax_type: 'standard', rate: '5' });
  const [seedError, setSeedError] = useState<string | null>(null);

  // Seed defaults
  const seedMut = useMutation({
    mutationFn: () => getAdapter().taxRates.seedDefaults(company_id!),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['taxRates', company_id] });
      qc.invalidateQueries({ queryKey: ['taxRates_all', company_id] });
      setSeedError(null);
    },
    onError: (e: Error) => setSeedError(e.message),
  });

  // Create new rate
  const createMut = useMutation({
    mutationFn: () => getAdapter().taxRates.create({
      company_id: company_id!,
      name:       draft.name.trim(),
      tax_type:   draft.tax_type,
      rate:       parseFloat(draft.rate) || 0,
      is_active:  true,
    }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['taxRates', company_id] });
      qc.invalidateQueries({ queryKey: ['taxRates_all', company_id] });
      setShowAdd(false);
      setDraft({ name: '', tax_type: 'standard', rate: '5' });
    },
  });

  // Toggle active/inactive
  const toggleMut = useMutation({
    mutationFn: ({ id, is_active }: { id: string; is_active: boolean }) =>
      getAdapter().taxRates.update(id, { is_active }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['taxRates', company_id] });
      qc.invalidateQueries({ queryKey: ['taxRates_all', company_id] });
    },
  });

  const activeRates = rates.filter(r => r.is_active);

  const columns: Column<TaxRateRow>[] = [
    { key: 'name', header: t('settingsPages.tax.name'), render: (r) => <span style={{ fontWeight: 700 }}>{r.name}</span> },
    { key: 'cat', header: t('settingsPages.tax.category'), render: (r) => catLabel(r.tax_type) },
    { key: 'rate', header: t('settingsPages.tax.rate'), align: 'end', render: (r) => <bdi dir="ltr" className="sb-mono">{Number(r.rate).toFixed(2)}%</bdi> },
    { key: 'status', header: '', render: (r) => <span className={`sb-pill ${r.is_active ? 'sb-pill-good' : 'sb-pill-muted'}`}>{r.is_active ? t('common.active') : t('common.inactive')}</span> },
    {
      key: 'toggle', header: '', align: 'end',
      render: (r) => (
        <button type="button" className="sb-row-link text-brand-600" onClick={() => toggleMut.mutate({ id: r.id, is_active: !r.is_active })} disabled={toggleMut.isPending}>
          {r.is_active ? t('settingsPages.tax.deactivate') : t('settingsPages.tax.activate')}
        </button>
      ),
    },
  ];

  // Ocean Teal (UI v1.1): look only — same queries, seed, create and
  // activate / deactivate as before.
  return (
    <OceanPage
      testid="tax-rates-ocean"
      title={t('settingsNav.items.tax_rates.title')}
      subtitle={t('settingsPages.tax.subtitle', { count: activeRates.length })}
      actions={<>
        <button type="button" className="sb-secondary-btn sb-btn-inline" onClick={() => seedMut.mutate()} disabled={seedMut.isPending}>
          {seedMut.isPending ? <Loader2 size={18} className="sb-spin" aria-hidden="true" /> : <Zap size={18} aria-hidden="true" />}
          {seedMut.isPending ? t('settingsPages.tax.seeding') : t('settingsPages.tax.seed')}
        </button>
        <button type="button" className="sb-primary-btn sb-btn-inline" onClick={() => setShowAdd(true)}><Plus size={18} aria-hidden="true" />{t('settingsPages.tax.add')}</button>
        <span className="sb-clist-io"><ImportExportButton moduleKey="taxRates" /></span>
      </>}
    >
      {seedError && <p className="sb-alert sb-alert-danger" role="alert">{seedError}</p>}

      {/* Add new rate form */}
      {showAdd && (
        <section className="sb-card sb-form">
          <div className="sb-form-head">
            <span className="sb-form-icon" aria-hidden="true"><Plus size={20} /></span>
            <h2 className="sb-form-title">{t('settingsPages.tax.new_title')}</h2>
          </div>
          <div className="sb-tax-add">
            <Input
              id="tax-new-name"
              label={t('settingsPages.tax.name')}
              value={draft.name}
              onChange={e => setDraft(d => ({ ...d, name: e.target.value }))}
              placeholder={t('settingsPages.tax.name_ph')}
            />
            <label className="sb-select-field" style={{ maxWidth: 'none' }}>
              <span className="sb-select-label">{t('settingsPages.tax.category')}</span>
              <select className="sb-field" value={draft.tax_type} onChange={e => setDraft(d => ({ ...d, tax_type: e.target.value }))}>
                {TAX_TYPES.map(c => <option key={c} value={c}>{catLabel(c)}</option>)}
              </select>
            </label>
            <Input
              id="tax-new-rate"
              label={t('settingsPages.tax.rate_pct')}
              type="number"
              dir="ltr"
              value={draft.rate}
              onChange={e => setDraft(d => ({ ...d, rate: e.target.value }))}
              placeholder="5"
            />
          </div>
          {createMut.isError && <p className="sb-alert sb-alert-danger" role="alert" style={{ marginTop: 12 }}>{(createMut.error as Error).message}</p>}
          <div className="sb-form-actions" style={{ marginTop: 14 }}>
            <button type="button" className="sb-secondary-btn" onClick={() => setShowAdd(false)}>{t('common.cancel')}</button>
            <button type="button" className="sb-primary-btn sb-btn-inline" onClick={() => createMut.mutate()} disabled={createMut.isPending || !draft.name.trim()}>
              {createMut.isPending && <Loader2 size={18} className="sb-spin" aria-hidden="true" />}
              {createMut.isPending ? t('common.saving') : t('common.save')}
            </button>
          </div>
        </section>
      )}

      <section className="sb-section-card">
        <div className="sb-form-head" style={{ marginBottom: 0 }}>
          <span className="sb-form-icon" aria-hidden="true"><Percent size={20} /></span>
          <h2 className="sb-form-title">{t('settingsPages.tax.configured')}</h2>
        </div>
        {isLoading ? (
          <div className="sb-card sb-empty">{t('common.loading')}</div>
        ) : rates.length === 0 ? (
          <div className="sb-card sb-empty">
            {t('settingsPages.tax.empty')}{' '}
            <button type="button" className="sb-row-link text-brand-600" onClick={() => seedMut.mutate()}>{t('settingsPages.tax.seed_link')}</button>
          </div>
        ) : (
          <OceanTable columns={columns} rows={rates} keyFn={(r) => r.id} rowMuted={(r) => !r.is_active} />
        )}
      </section>

      <section className="sb-card">
        <div className="sb-form-head">
          <span className="sb-form-icon" aria-hidden="true"><BookOpen size={20} /></span>
          <h2 className="sb-form-title">{t('settingsPages.tax.meanings')}</h2>
        </div>
        <ul className="sb-tax-meanings">
          {TAX_TYPES.map(cat => (
            <li key={cat}>
              <span className="sb-pill">{catLabel(cat)}</span>
              <span>{catHint(cat)}</span>
            </li>
          ))}
        </ul>
      </section>
    </OceanPage>
  );
}
