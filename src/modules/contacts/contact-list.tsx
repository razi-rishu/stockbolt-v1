import { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { useSearchParams } from 'react-router-dom';
import { getAdapter } from '@/data/index';
import { getRegionLabel } from '@/lib/locale';
import { useAuthStore } from '@/store/auth';
import { useQuery as useCompanyQuery } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Button } from '@/ui/button';
import { Input } from '@/ui/input';
import { Modal } from '@/ui/modal';
import { contactMatches } from '@/lib/contact-search';
import { ALL_CURRENCIES } from '@/lib/currencies';
import { BUYER_TYPES, GST_STATE_CODES } from '@/lib/einvoice-metadata';
import type { ContactRow } from '@/data/adapter';
import { useFormInvalidBanner } from '@/hooks/use-form-invalid-banner';
import { FormErrorBanner } from '@/ui/form-error-banner';
import { DuplicateWarning } from '@/ui/duplicate-warning';
import { findContactDuplicates } from '@/lib/duplicate-check';
import { CustomerListOcean } from './customer-list-ocean';
import { useArabicEnabled } from '@/hooks/use-arabic-enabled';

const PAGE_SIZE = 50;

// Phase 16 — countries StockBolt localises geography for (GCC + India).
const GEO_COUNTRIES: { code: string; label: string }[] = [
  { code: 'AE', label: 'United Arab Emirates' },
  { code: 'SA', label: 'Saudi Arabia' },
  { code: 'QA', label: 'Qatar' },
  { code: 'OM', label: 'Oman' },
  { code: 'BH', label: 'Bahrain' },
  { code: 'KW', label: 'Kuwait' },
  { code: 'IN', label: 'India' },
];

const schema = z.object({
  name:                 z.string().min(1, 'Required'),
  name_ar:              z.string(),
  type:                 z.enum(['customer', 'supplier', 'both']),
  email:                z.string().email('Invalid email').or(z.literal('')),
  phone:                z.string(),
  mobile:               z.string(),
  currency:             z.string().min(3),
  tax_id:               z.string(),
  buyer_type:           z.string(),   // Phase 58 (AC-4A) — e-invoice buyer classification
  place_of_supply_code: z.string(),   // Phase 58 (AC-4A) — India GST state code
  pan:                  z.string(),   // Phase 62 (AC-7A) — India TDS vendor config
  tds_section_code:     z.string(),
  tds_deductee_type:    z.string(),
  lower_deduction_rate: z.string(),   // '' = no §197 certificate
  address_street:       z.string(),
  address_city:         z.string(),
  address_country:      z.string(),
  country_code:         z.string(),   // Phase 16 — structured geography
  region_id:            z.string(),
  contact_person_name:  z.string(),
  contact_person_phone: z.string(),
  credit_limit:         z.coerce.number().min(0),
  payment_terms_days:   z.coerce.number().min(0),
  payable_account_code: z.string(),   // supplier bills post here (2100 trade / 2110 rent / 2120 utilities)
  notes:                z.string(),
});
type FormValues = z.infer<typeof schema>;

interface ContactListPageProps {
  defaultType: 'customer' | 'supplier';
  titleKey: string;
  singularKey: string;
}

export function ContactListPage({ defaultType, singularKey }: ContactListPageProps) {
  const { t } = useTranslation();
  const arabicOn = useArabicEnabled();   // India companies: English only
  const { company_id } = useAuthStore();
  const [searchParams, setSearchParams] = useSearchParams();
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<ContactRow | null>(null);
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);

  const { data: company } = useCompanyQuery({
    queryKey: ['company', company_id],
    queryFn: () => getAdapter().companies.getById(company_id!),
    enabled: !!company_id,
  });

  const { data: contacts = [], isLoading } = useQuery({
    queryKey: ['contacts', company_id, defaultType],
    queryFn: () => getAdapter().contacts.list(company_id!, defaultType),
    enabled: !!company_id,
  });

  const defaultCurrency = company?.currency ?? 'AED';

  // Duplicate detection. Fetched only while the form is open, and across
  // EVERY contact rather than the type-filtered list behind the modal - a
  // customer sharing a supplier's mobile is exactly the collision worth
  // catching, and the filtered list would never see it.
  const { data: identities = [] } = useQuery({
    queryKey: ['contactIdentities', company_id],
    queryFn:  () => getAdapter().contacts.listIdentities(company_id!),
    enabled:  !!company_id && open,
  });

  const { onInvalid, bannerMessage, clearBanner } = useFormInvalidBanner('contact-list');
  const { register, handleSubmit, reset, watch, setValue, formState: { errors, isSubmitting } } = useForm<FormValues>({
    resolver: zodResolver(schema) as any,
    defaultValues: { name: '', name_ar: '', type: defaultType, email: '', phone: '', mobile: '', currency: defaultCurrency, tax_id: '', buyer_type: 'registered', place_of_supply_code: '', pan: '', tds_section_code: '', tds_deductee_type: 'other', lower_deduction_rate: '', address_street: '', address_city: '', address_country: '', country_code: '', region_id: '', contact_person_name: '', contact_person_phone: '', credit_limit: 0, payment_terms_days: 0, payable_account_code: '2100', notes: '' },
  });
  // Watched so the warning appears as the number is typed, not only on save.
  // Identifier fields only: the name is deliberately absent.
  const watchedPhone  = watch('phone');
  const watchedMobile = watch('mobile');
  const watchedEmail  = watch('email');
  const watchedTaxId  = watch('tax_id');
  const duplicateHits = findContactDuplicates(
    identities,
    { phone: watchedPhone, mobile: watchedMobile, email: watchedEmail, tax_id: watchedTaxId },
    editing?.id,
  );
  const watchedType = watch('type');

  // Phase 16 — Country → Region dependent dropdowns.
  const watchCountry = watch('country_code');
  const { data: regions = [], refetch: refetchRegions } = useQuery({
    queryKey: ['regions', company_id, watchCountry],
    queryFn: () => getAdapter().geography.listRegions(company_id!, watchCountry),
    enabled: !!company_id && !!watchCountry,
  });
  async function addRegionInline() {
    const name = window.prompt(`New ${getRegionLabel(watchCountry)} name:`);
    if (!name?.trim() || !company_id) return;
    const created = await getAdapter().geography.createRegion(company_id, { country_code: watchCountry, region_name: name.trim() });
    await refetchRegions();
    setValue('region_id', created.id);
  }

  function openAdd() {
    setEditing(null);
    reset({ name: '', name_ar: '', type: defaultType, email: '', phone: '', mobile: '', currency: defaultCurrency, tax_id: '', buyer_type: 'registered', place_of_supply_code: '', pan: '', tds_section_code: '', tds_deductee_type: 'other', lower_deduction_rate: '', address_street: '', address_city: '', address_country: '', country_code: '', region_id: '', contact_person_name: '', contact_person_phone: '', credit_limit: 0, payment_terms_days: 0, payable_account_code: '2100', notes: '' });
    setOpen(true);
  }

  function openEdit(row: ContactRow) {
    setEditing(row);
    reset({
      name: row.name, name_ar: row.name_ar ?? '', type: row.type as 'customer' | 'supplier' | 'both',
      email: row.email ?? '', phone: row.phone ?? '', mobile: row.mobile ?? '',
      currency: row.currency, tax_id: row.tax_id ?? '',
      buyer_type: row.buyer_type ?? 'registered', place_of_supply_code: row.place_of_supply_code ?? '',
      pan: row.pan ?? '', tds_section_code: row.tds_section_code ?? '',
      tds_deductee_type: row.tds_deductee_type ?? 'other',
      lower_deduction_rate: row.lower_deduction_rate === null || row.lower_deduction_rate === undefined
        ? '' : String(row.lower_deduction_rate),
      address_street: row.address_street ?? '', address_city: row.address_city ?? '', address_country: row.address_country ?? '',
      country_code: row.country_code ?? (row.address_country && row.address_country.length === 2 ? row.address_country.toUpperCase() : ''),
      region_id: row.region_id ?? '',
      contact_person_name: row.contact_person_name ?? '', contact_person_phone: row.contact_person_phone ?? '',
      credit_limit: row.credit_limit, payment_terms_days: row.payment_terms_days,
      payable_account_code: row.payable_account_code ?? '2100', notes: row.notes ?? '',
    });
    setOpen(true);
  }

  // Auto-open the edit modal when the page is reached with ?edit=<contact_id>
  // (used by the Edit button on the customer/supplier detail page).
  const editId = searchParams.get('edit');
  useEffect(() => {
    if (!editId || contacts.length === 0) return;
    const row = contacts.find((c) => c.id === editId);
    if (row) {
      openEdit(row);
      // Clear the param so refreshing the page doesn't keep re-opening the modal
      const next = new URLSearchParams(searchParams);
      next.delete('edit');
      setSearchParams(next, { replace: true });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editId, contacts]);

  const saveMutation = useMutation({
    mutationFn: async (values: FormValues) => {
      const row = {
        company_id: company_id!,
        name: values.name, name_ar: values.name_ar || null,
        type: values.type, email: values.email || null, phone: values.phone || null, mobile: values.mobile || null,
        currency: values.currency, tax_id: values.tax_id || null,
        buyer_type: values.buyer_type || 'registered',
        place_of_supply_code: values.place_of_supply_code || null,
        // Phase 62 (AC-7A) — India TDS vendor configuration
        pan: values.pan || null,
        tds_section_code: values.tds_section_code || null,
        tds_deductee_type: values.tds_deductee_type || 'other',
        lower_deduction_rate: values.lower_deduction_rate === '' ? null : Number(values.lower_deduction_rate),
        address_street: values.address_street || null, address_city: values.address_city || null,
        address_country: values.country_code || values.address_country || null,
        country_code: values.country_code || null, region_id: values.region_id || null,
        billing_address_ar: null,
        contact_person_name: values.contact_person_name || null, contact_person_phone: values.contact_person_phone || null,
        contact_person_email: null,
        credit_limit: values.credit_limit, payment_terms_days: values.payment_terms_days,
        payable_account_code: (values.type === 'supplier' || values.type === 'both')
          ? (values.payable_account_code || '2100') : '2100',
        notes: values.notes || null, is_active: true,
        address_state: null, address_postal: null, default_price_level_id: null,
      };
      if (editing) await getAdapter().contacts.update(editing.id, row);
      else await getAdapter().contacts.create(row);
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['contacts', company_id, defaultType] }); setOpen(false); },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => getAdapter().contacts.remove(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['contacts', company_id, defaultType] }),
  });

  // The matching rule lives in src/lib/contact-search.ts so it can be
  // tested without a database — this bug was invisible on screen.
  const filtered = contacts.filter((c) => contactMatches(c, search));


  // Ocean Teal (UI v1.1) — customers and suppliers. Same rows, search,
  // pagination, add / edit / delete and Import / Export.
  const oceanList = (
    <CustomerListOcean
      side={defaultType}
      rows={filtered}
      isLoading={isLoading}
      search={search}
      onSearch={(q) => { setSearch(q); setPage(1); }}
      page={page}
      pageSize={PAGE_SIZE}
      onPage={setPage}
      onAdd={openAdd}
      onEdit={openEdit}
      onDelete={(r) => deleteMutation.mutate(r.id)}
    />
  );

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
      {oceanList}

      <Modal open={open} onClose={() => setOpen(false)} title={editing ? t('contacts.edit') : `${t('common.add')} ${t(singularKey)}`} width="xl">
        <form onSubmit={handleSubmit((v) => { clearBanner(); return saveMutation.mutateAsync(v as FormValues); }, onInvalid)} className="flex flex-col gap-4">
          <FormErrorBanner message={bannerMessage} onDismiss={clearBanner} />
          {/* Identifiers only - never the name. Two customers really can
              both be called Mohammed Ali. */}
          <DuplicateWarning hits={duplicateHits} docType={defaultType} />
          <div className="grid grid-cols-2 gap-4">
            <Input label={t('contacts.name')} required error={errors.name?.message} {...register('name')} />
            {arabicOn && (
            <Input label={t('contacts.name_ar')} dir="rtl" {...register('name_ar')} />
            )}
          </div>

          <div className="flex flex-col gap-1">
            <label className="text-sm font-medium text-ink-primary">{t('contacts.type')}</label>
            <select className="h-10 rounded-input border border-border-strong bg-surface-subtle px-4 text-sm focus:border-brand-500 focus:outline-none" {...register('type')}>
              <option value="customer">{t('contacts.type_customer')}</option>
              <option value="supplier">{t('contacts.type_supplier')}</option>
              <option value="both">{t('contacts.type_both')}</option>
            </select>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <Input label={t('contacts.email')} type="email" error={errors.email?.message} {...register('email')} />
            <Input label={t('contacts.phone')} {...register('phone')} />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <Input label={t('contacts.mobile')} {...register('mobile')} />
            {/* Currency — dropdown sourced from the shared currency master list
                (same set as Settings → Exchange Rates), not free text. */}
            <div className="flex w-full flex-col gap-1">
              <label
                htmlFor="contact-currency"
                style={{ fontSize: '11px', fontWeight: 600, color: '#64748b', textTransform: 'uppercase', letterSpacing: '.05em', display: 'flex', gap: '3px', alignItems: 'center' }}
              >
                {t('contacts.currency')}<span style={{ color: '#ef4444' }}>*</span>
              </label>
              <select
                id="contact-currency"
                {...register('currency')}
                style={{ width: '100%', padding: '8px 10px', fontSize: '13px', border: '1px solid #e2e8f0', borderRadius: '7px', background: '#fff', color: '#1e293b', outline: 'none' }}
              >
                {/* Keep an existing non-standard value selectable so editing a
                    contact never silently rewrites its stored currency. */}
                {watch('currency') && !ALL_CURRENCIES.some(c => c.code === watch('currency')) && (
                  <option value={watch('currency')}>{watch('currency')}</option>
                )}
                {ALL_CURRENCIES.map(c => (
                  <option key={c.code} value={c.code}>{c.code} — {c.name}</option>
                ))}
              </select>
            </div>
          </div>
          <Input label={t('contacts.tax_id')} {...register('tax_id')} />

          {/* Phase 58 (AC-4A) — e-invoice buyer classification. Metadata only;
              does not affect posting/GL. Place of supply is India GST-specific. */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="mb-1 block text-xs font-medium text-ink-secondary">{t('contacts.buyer_type')}</label>
              <select
                className="h-9 w-full rounded-input border border-border-subtle bg-surface-input px-2 text-sm text-ink-primary focus:outline-none focus:ring-1 focus:ring-brand-500"
                {...register('buyer_type')}
              >
                {BUYER_TYPES.map((bt) => (
                  <option key={bt} value={bt}>{t(`contacts.buyer_type_${bt}`)}</option>
                ))}
              </select>
            </div>
            {watchCountry === 'IN' && (
              <div>
                <label className="mb-1 block text-xs font-medium text-ink-secondary">{t('contacts.place_of_supply')}</label>
                <select
                  className="h-9 w-full rounded-input border border-border-subtle bg-surface-input px-2 text-sm text-ink-primary focus:outline-none focus:ring-1 focus:ring-brand-500"
                  {...register('place_of_supply_code')}
                >
                  <option value="">{t('contacts.place_of_supply_select')}</option>
                  {GST_STATE_CODES.map((s) => (
                    <option key={s.code} value={s.code}>{s.code} — {s.name}</option>
                  ))}
                </select>
              </div>
            )}
          </div>

          {/* Phase 62 (AC-7B) — India TDS vendor config. Supplier-only, and only
              when the contact's country is India. Drives the rate the deduction
              panel proposes on a confirmed bill. */}
          {watchCountry === 'IN' && (watchedType === 'supplier' || watchedType === 'both') && (
            <div className="rounded-card border border-border-subtle p-3">
              <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-ink-tertiary">
                {t('tds.vendor_config')}
              </p>
              <div className="grid grid-cols-2 gap-4">
                <Input label={t('tds.f_pan')} placeholder="ABCDE1234F" {...register('pan')} />
                <Input label={t('tds.f_section_default')} placeholder="194C" {...register('tds_section_code')} />
                <div>
                  <label className="mb-1 block text-xs font-medium text-ink-secondary">{t('tds.f_deductee_type')}</label>
                  <select
                    className="h-9 w-full rounded-input border border-border-subtle bg-surface-input px-2 text-sm text-ink-primary focus:outline-none focus:ring-1 focus:ring-brand-500"
                    {...register('tds_deductee_type')}
                  >
                    <option value="other">{t('tds.deductee_other')}</option>
                    <option value="individual_huf">{t('tds.deductee_individual_huf')}</option>
                  </select>
                </div>
                <Input label={t('tds.f_lower_rate')} type="number" step="0.001" min="0" max="100"
                  placeholder={t('tds.f_lower_rate_ph')} {...register('lower_deduction_rate')} />
              </div>
              <p className="mt-2 text-xs text-ink-tertiary">{t('tds.no_pan_warning')}</p>
            </div>
          )}

          {/* Payable category — supplier-only. Bills for this supplier post
              to the chosen liability account (keeps rent / utilities out of
              trade AP on the Balance Sheet). */}
          {(watchedType === 'supplier' || watchedType === 'both') && (
            <div>
              <label className="mb-1 block text-xs font-medium text-ink-secondary">Payable category (where bills post)</label>
              <select
                className="h-10 w-full rounded-input border border-border-strong bg-surface-subtle px-4 text-sm focus:border-brand-500 focus:outline-none"
                {...register('payable_account_code')}
              >
                <option value="2100">Trade — Accounts Payable (2100)</option>
                <option value="2110">Rent &amp; Lease Payable (2110)</option>
                <option value="2120">Utilities Payable (2120)</option>
              </select>
              <p className="mt-1 text-xs text-ink-tertiary">
                Landlords → Rent &amp; Lease · DEWA/Etisalat → Utilities. Trade suppliers stay on 2100.
              </p>
            </div>
          )}

          <div className="border-t border-border-subtle pt-3">
            <p className="mb-3 text-xs font-semibold uppercase tracking-wider text-ink-tertiary">{t('contacts.address')}</p>
            <div className="grid grid-cols-2 gap-4">
              <Input label={t('contacts.address_street')} {...register('address_street')} />
              <Input label={t('contacts.address_city')} {...register('address_city')} />
            </div>
            {/* Phase 16 — structured Country → Region for geographic sales analysis */}
            <div className="mt-4 grid grid-cols-2 gap-4">
              <div>
                <label className="mb-1 block text-xs font-medium text-ink-secondary">Country</label>
                <select
                  className="h-9 w-full rounded-input border border-border-subtle bg-surface-input px-2 text-sm text-ink-primary focus:outline-none focus:ring-1 focus:ring-brand-500"
                  {...register('country_code')}
                  onChange={(e) => { setValue('country_code', e.target.value); setValue('region_id', ''); }}
                >
                  <option value="">Select country…</option>
                  {GEO_COUNTRIES.map(c => <option key={c.code} value={c.code}>{c.label}</option>)}
                </select>
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-ink-secondary">{getRegionLabel(watchCountry)}</label>
                <select
                  className="h-9 w-full rounded-input border border-border-subtle bg-surface-input px-2 text-sm text-ink-primary focus:outline-none focus:ring-1 focus:ring-brand-500 disabled:opacity-50"
                  value={watch('region_id')}
                  disabled={!watchCountry}
                  onChange={(e) => { if (e.target.value === '__new__') addRegionInline(); else setValue('region_id', e.target.value); }}
                >
                  <option value="">{watchCountry ? `Select ${getRegionLabel(watchCountry).toLowerCase()}…` : 'Pick a country first'}</option>
                  {regions.map(r => <option key={r.id} value={r.id}>{r.region_name}{r.is_system ? '' : ' (custom)'}</option>)}
                  {watchCountry && <option value="__new__">+ Add new {getRegionLabel(watchCountry).toLowerCase()}…</option>}
                </select>
              </div>
            </div>
          </div>

          <div className="border-t border-border-subtle pt-3">
            <p className="mb-3 text-xs font-semibold uppercase tracking-wider text-ink-tertiary">{t('contacts.contact_person')}</p>
            <div className="grid grid-cols-2 gap-4">
              <Input label={t('contacts.contact_person_name')} {...register('contact_person_name')} />
              <Input label={t('contacts.contact_person_phone')} {...register('contact_person_phone')} />
            </div>
          </div>

          <div className="border-t border-border-subtle pt-3">
            <p className="mb-3 text-xs font-semibold uppercase tracking-wider text-ink-tertiary">{t('contacts.financial')}</p>
            <div className="grid grid-cols-2 gap-4">
              <Input label={t('contacts.credit_limit')} type="number" step="0.01" {...register('credit_limit')} />
              <Input label={t('contacts.payment_terms_days')} type="number" {...register('payment_terms_days')} />
            </div>
          </div>

          {saveMutation.error && <p className="text-xs text-danger-500">{String(saveMutation.error)}</p>}
          <div className="flex justify-end gap-3 pt-2">
            <Button type="button" variant="secondary" onClick={() => setOpen(false)}>{t('common.cancel')}</Button>
            <Button type="submit" loading={isSubmitting}>{t('common.save')}</Button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
