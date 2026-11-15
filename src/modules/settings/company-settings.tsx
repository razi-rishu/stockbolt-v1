import { useEffect, useRef, useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useTranslation } from 'react-i18next';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { getAdapter } from '@/data/index';
import { useAuthStore } from '@/store/auth';
import { Input } from '@/ui/input';
import { useFormInvalidBanner } from '@/hooks/use-form-invalid-banner';
import { FormErrorBanner } from '@/ui/form-error-banner';
import { ImageIcon, Building2, Percent, Package, Coins, Landmark, Upload, Loader2 } from 'lucide-react';
import '@/styles/stockbolt-ocean-teal.css';
import { useArabicEnabled } from '@/hooks/use-arabic-enabled';
import { vatApplies } from '@/core/global-config/country-packs';
import {
  validateTaxRegistration, normaliseTaxId, taxRegistrationErrorKey, parseTaxRegistrationServerError,
  type TaxRegistrationError,
} from '@/core/global-config/tax-registration';

/** Ocean Teal card heading: icon square + title. */
function SectionHead({ icon, title, hint }: { icon: React.ReactNode; title: string; hint?: string }) {
  return (
    <div className="sb-form-head">
      <span className="sb-form-icon" aria-hidden="true">{icon}</span>
      <span style={{ minWidth: 0 }}>
        <h2 className="sb-form-title">{title}</h2>
        {hint && <p className="sb-form-hint">{hint}</p>}
      </span>
    </div>
  );
}

// Defaults live in useForm defaultValues; schema only validates.
const schema = z.object({
  name:              z.string().min(2, 'Required'),
  name_ar:           z.string(),
  address:           z.string(),
  address_ar:        z.string(),
  city:              z.string(),
  state:             z.string(),
  phone:             z.string(),
  email:             z.string().email('Invalid email').or(z.literal('')),
  is_tax_registered: z.boolean(),
  tax_id:            z.string(),
  prices_inclusive_of_tax: z.boolean(),
  allow_negative_stock: z.boolean(),
  rounding_step: z.enum(['0', '0.25', '0.5', '1']),
});
type FormValues = z.infer<typeof schema>;

/**
 * phase132 — the tax registration rule needs the company's country and its
 * saved values, which the static schema cannot see. It is only enforced when
 * the user changes the tax fields, exactly like the database trigger: a
 * company whose old number is missing or malformed can still save the rest
 * of its settings, and is asked to correct the number when it edits it.
 */
interface TaxRule { country: string; savedRegistered: boolean; savedTaxId: string }
function withTaxRule(rule: TaxRule) {
  return schema.superRefine((v, ctx) => {
    const touched = v.is_tax_registered !== rule.savedRegistered
      || normaliseTaxId(v.tax_id) !== normaliseTaxId(rule.savedTaxId);
    if (!touched) return;
    const err = validateTaxRegistration(rule.country, v.is_tax_registered, v.tax_id);
    if (err) ctx.addIssue({ code: z.ZodIssueCode.custom, message: `tax:${err}`, path: ['tax_id'] });
  });
}

export default function CompanySettingsPage() {
  const { t } = useTranslation();
  const arabicOn = useArabicEnabled();   // India companies: English only
  const { company_id } = useAuthStore();
  const queryClient = useQueryClient();
  const fileRef = useRef<HTMLInputElement>(null);
  const [logoUrl, setLogoUrl] = useState<string | null>(null);
  const [logoUploading, setLogoUploading] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);

  const { data: company, isLoading } = useQuery({
    queryKey: ['company', company_id],
    queryFn: () => getAdapter().companies.getById(company_id!),
    enabled: !!company_id,
  });
  const country = company?.country_code ?? '';
  const taxRule = useRef<TaxRule>({ country: '', savedRegistered: false, savedTaxId: '' });
  taxRule.current = {
    country,
    savedRegistered: !!company?.is_tax_registered,
    savedTaxId: company?.tax_id ?? '',
  };
  // A saved registration that would not pass today: shown, never blocking.
  const savedTaxProblem: TaxRegistrationError | null = company
    ? validateTaxRegistration(country, company.is_tax_registered, company.tax_id)
    : null;
  const taxMsg = (msg?: string) => (msg?.startsWith('tax:')
    ? t(taxRegistrationErrorKey(country, msg.slice(4) as TaxRegistrationError))
    : msg);

  const {
    register,
    reset,
    watch,
    trigger,
    handleSubmit,
    formState: { errors, isDirty, isSubmitting },
  } = useForm<FormValues>({
    // Resolved per validation so it always sees the loaded company.
    resolver: (values, ctx, opts) => zodResolver(withTaxRule(taxRule.current))(values, ctx, opts),
  });
  const { onInvalid, bannerMessage, clearBanner } = useFormInvalidBanner('company-settings');

  useEffect(() => {
    if (company) {
      reset({
        name: company.name,
        name_ar: company.name_ar ?? '',
        address: company.address ?? '',
        address_ar: company.address_ar ?? '',
        city: company.city ?? '',
        state: company.state ?? '',
        phone: company.phone ?? '',
        email: company.email ?? '',
        is_tax_registered: company.is_tax_registered,
        tax_id: company.tax_id ?? '',
        prices_inclusive_of_tax: company.prices_inclusive_of_tax,
        allow_negative_stock: (company as { allow_negative_stock?: boolean }).allow_negative_stock ?? false,
        rounding_step: String(Number((company as { rounding_step?: number }).rounding_step ?? 0)) as FormValues['rounding_step'],
      });
      setLogoUrl(company.logo_url);
    }
  }, [company, reset]);

  const saveMutation = useMutation({
    mutationFn: (values: FormValues) =>
      getAdapter().companies.update(company_id!, {
        name: values.name,
        name_ar: values.name_ar || null,
        address: values.address || null,
        address_ar: values.address_ar || null,
        city: values.city || null,
        state: values.state || null,
        phone: values.phone || null,
        email: values.email || null,
        is_tax_registered: values.is_tax_registered,
        tax_id: values.tax_id || null,
        prices_inclusive_of_tax: values.prices_inclusive_of_tax,
        // Phase 30 — not yet in generated DB types; cast like setPeriodLock.
        allow_negative_stock: values.allow_negative_stock,
        // Phase 46 — cash rounding step for document grand totals.
        rounding_step: parseFloat(values.rounding_step),
      } as any),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['company', company_id] });
      setSaveSuccess(true);
      setTimeout(() => setSaveSuccess(false), 3000);
    },
  });

  async function onSubmit(values: FormValues) {
    await saveMutation.mutateAsync(values);
  }

  async function handleLogoUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file || !company_id) return;

    const allowedTypes = ['image/jpeg', 'image/png', 'image/webp', 'image/svg+xml'];
    if (!allowedTypes.includes(file.type)) {
      alert(t('settings.company.logo_type_error'));
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      alert(t('settings.company.logo_size_error'));
      return;
    }

    setLogoUploading(true);
    try {
      const url = await getAdapter().companies.uploadLogo(company_id, file);
      await getAdapter().companies.update(company_id, { logo_url: url });
      setLogoUrl(url);
      queryClient.invalidateQueries({ queryKey: ['company', company_id] });
    } finally {
      setLogoUploading(false);
    }
  }

  const is_tax_registered = watch('is_tax_registered');

  if (isLoading) {
    return (
      <div className="sb-ocean sb-page" style={{ display: 'flex', justifyContent: 'center', padding: 48 }}>
        <Loader2 size={24} className="sb-icon sb-spin" aria-label={t('common.loading')} />
      </div>
    );
  }

  const inv = (k: keyof FormValues) => ({ 'aria-invalid': errors[k] ? true : undefined });

  // Ocean Teal (UI v1.1): look only. Same form, fields, validation, save,
  // logo upload and read-only finance block as before.
  return (
    <div className="sb-ocean sb-page sb-form sb-company" data-testid="company-settings-ocean" style={{ paddingBottom: 48 }}>
      <div className="sb-hero">
        <h1 className="sb-title" style={{ marginTop: 0 }}>{t('settingsNav.items.company.title')}</h1>
        <div className="sb-clist-count">{t('settingsPages.company.subtitle')}</div>
      </div>

      <div className="sb-body sb-form-body">
        {/* Logo upload */}
        <section className="sb-card">
          <SectionHead icon={<ImageIcon size={20} />} title={t('settings.company.logo')} />
          <div className="sb-logo-row">
            <div className="sb-logo-box">
              {logoUrl ? (
                <img src={logoUrl} alt={t('settingsPages.company.logo_alt')} />
              ) : (
                <ImageIcon size={30} aria-hidden="true" />
              )}
            </div>
            <div style={{ minWidth: 0 }}>
              <button
                type="button"
                className="sb-secondary-btn sb-btn-inline"
                disabled={logoUploading}
                onClick={() => fileRef.current?.click()}
              >
                {logoUploading ? <Loader2 size={18} className="sb-spin" aria-hidden="true" /> : <Upload size={18} aria-hidden="true" />}
                {t('settings.company.upload_logo')}
              </button>
              <p className="sb-form-hint" style={{ marginTop: 6 }}>{t('settings.company.logo_hint')}</p>
              <input
                ref={fileRef}
                type="file"
                accept="image/jpeg,image/png,image/webp,image/svg+xml"
                className="hidden"
                onChange={handleLogoUpload}
              />
            </div>
          </div>
        </section>

        {/* Company details form */}
        {/* noValidate: the schema validates every field and shows translated
            messages; the browser's own pop-up would also block a company whose
            OLD tax number is incomplete from saving anything else. */}
        <form noValidate onSubmit={handleSubmit((v) => { clearBanner(); return onSubmit(v); }, onInvalid)} className="sb-form-body">
          <section className="sb-card">
            <FormErrorBanner message={bannerMessage} onDismiss={clearBanner} />
            <SectionHead icon={<Building2 size={20} />} title={t('settings.company.details')} />
            <div className="sb-form-grid">
              <Input label={t('settings.company.name')} required error={errors.name?.message} {...inv('name')} {...register('name')} />
              {arabicOn && (
              <Input label={t('settings.company.name_ar')} dir="rtl" error={errors.name_ar?.message} {...register('name_ar')} />
              )}
              <Input label={t('settings.company.address')} error={errors.address?.message} {...register('address')} />
              {arabicOn && (
              <Input label={t('settings.company.address_ar')} dir="rtl" error={errors.address_ar?.message} {...register('address_ar')} />
              )}
              <Input label={t('settings.company.city')} error={errors.city?.message} {...register('city')} />
              <Input label={t('settings.company.state')} error={errors.state?.message} {...register('state')} />
              <Input label={t('settings.company.phone')} type="tel" dir="ltr" placeholder="+971 …" error={errors.phone?.message} {...register('phone')} />
              <Input label={t('settings.company.email')} type="email" dir="ltr" placeholder="info@company.com" error={errors.email?.message} {...inv('email')} {...register('email')} />
            </div>
          </section>

          {/* Tax & VAT */}
          <section className="sb-card">
            <SectionHead icon={<Percent size={20} />} title={t('settings.company.tax_section')} />
            <div className="sb-form-stack">
              {/* No VAT in Kuwait / Qatar: the option is only shown there to a
                  company already marked registered, so it can untick it. */}
              {(vatApplies(country) || company?.is_tax_registered) && (
                <label className="sb-check-row">
                  <input type="checkbox" {...register('is_tax_registered')} />
                  <span className="sb-check-text">{t('wizard.step2.tax_registered')}</span>
                </label>
              )}
              {!vatApplies(country) && (
                <p className="sb-form-hint" style={{ margin: 0 }}>{t('taxReg.not_available')}</p>
              )}
              {is_tax_registered && vatApplies(country) && (
                <Input label={t('wizard.step2.tax_id')} required placeholder="TRN / GSTIN" dir="ltr"
                  autoComplete="off" aria-invalid={!!errors.tax_id}
                  hint={t(`taxReg.hint_${country}`, { defaultValue: '' }) || undefined}
                  error={taxMsg(errors.tax_id?.message)} {...register('tax_id', {
                          // Clear the message as soon as the number becomes valid.
                          onChange: () => { if (errors.tax_id) void trigger('tax_id'); },
                        })} />
              )}
              {savedTaxProblem && !errors.tax_id && (
                <p className="sb-alert sb-alert-warn" role="status" style={{ margin: 0, fontWeight: 400 }}>
                  {t('taxReg.saved_incomplete')} {t(taxRegistrationErrorKey(country, savedTaxProblem))}
                </p>
              )}
              <label className="sb-check-row">
                <input type="checkbox" {...register('prices_inclusive_of_tax')} />
                <span className="sb-check-text">
                  {t('settings.company.prices_inclusive')}
                  <span className="sb-form-hint">{t('settings.company.prices_inclusive_hint')}</span>
                </span>
              </label>
            </div>
          </section>

          {/* Inventory — Phase 30 backorder policy */}
          <section className="sb-card">
            <SectionHead icon={<Package size={20} />} title={t('settings.company.inventory_section')} />
            <label className="sb-check-row">
              <input type="checkbox" {...register('allow_negative_stock')} />
              <span className="sb-check-text">
                {t('settings.company.allow_backorders')}
                <span className="sb-form-hint">{t('settings.company.allow_backorders_hint')}</span>
              </span>
            </label>
          </section>

          {/* Phase 46 — cash rounding for document grand totals */}
          <section className="sb-card">
            <SectionHead icon={<Coins size={20} />} title={t('settings.company.rounding_section')} hint={t('settings.company.rounding_step_hint')} />
            <label className="sb-select-field">
              <span className="sb-select-label">{t('settings.company.rounding_step')}</span>
              <select {...register('rounding_step')} className="sb-field">
                <option value="0">{t('settings.company.rounding_off')}</option>
                <option value="0.25">0.25</option>
                <option value="0.5">0.50</option>
                <option value="1">1.00</option>
              </select>
            </label>
          </section>

          {saveSuccess && <p className="sb-alert sb-alert-good" role="status">{t('common.saved')}</p>}

          {saveMutation.error && (
            <p className="sb-alert sb-alert-danger" role="alert">
              {saveMutation.error instanceof Error
                ? (parseTaxRegistrationServerError(saveMutation.error.message)
                    ? t(taxRegistrationErrorKey(country, parseTaxRegistrationServerError(saveMutation.error.message)!))
                    : saveMutation.error.message)
                : t('common.error')}
            </p>
          )}

          <div className="sb-form-actions">
            <button type="button" className="sb-secondary-btn" onClick={() => reset()} disabled={!isDirty}>
              {t('common.cancel')}
            </button>
            <button type="submit" className="sb-primary-btn sb-btn-inline" disabled={!isDirty || isSubmitting}>
              {isSubmitting && <Loader2 size={18} className="sb-spin" aria-hidden="true" />}
              {t('common.save')}
            </button>
          </div>
        </form>

        {/* Finance — read-only. Set during onboarding; changing currency,
            fiscal year or costing method after transactions exist would
            corrupt the books, so these are display-only here. */}
        <section className="sb-card">
          <SectionHead icon={<Landmark size={20} />} title={t('settings.company.finance_section')} hint={t('settings.company.finance_hint')} />
          <div className="sb-info-grid sb-finance-grid">
            <div>
              <div className="sb-info-label">{t('settings.company.currency')}</div>
              <div className="sb-info-value"><bdi dir="ltr">{(company as { base_currency?: string } | null)?.base_currency ?? company?.currency ?? '—'}</bdi></div>
              <div className="sb-form-hint">{t('settingsPages.company.base_currency_hint')}</div>
            </div>
            <div>
              <div className="sb-info-label">{t('settings.company.country')}</div>
              <div className="sb-info-value"><bdi dir="ltr">{company?.country_code ?? '—'}</bdi></div>
            </div>
            <div>
              <div className="sb-info-label">{t('settings.company.fiscal_year_start')}</div>
              <div className="sb-info-value"><bdi dir="ltr">{company?.fiscal_year_start ?? '—'}</bdi></div>
            </div>
            <div>
              <div className="sb-info-label">{t('settings.company.costing_method')}</div>
              <div className="sb-info-value" style={{ textTransform: 'uppercase' }}><bdi dir="ltr">{company?.costing_method ?? 'MAC'}</bdi></div>
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}
