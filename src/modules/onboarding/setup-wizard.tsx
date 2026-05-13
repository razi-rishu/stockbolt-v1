import { useState } from 'react';
import { useNavigate, Navigate } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useTranslation } from 'react-i18next';
import { getAdapter } from '@/data/index';
import { useAuthStore } from '@/store/auth';
import { runOnboarding, type WizardData } from '@/core/onboarding';
import { Button } from '@/ui/button';
import { Input } from '@/ui/input';
import { Select } from '@/ui/select';
import { Card } from '@/ui/card';
import { LanguageToggle } from '@/components/language-toggle';

// ── Country / currency data ────────────────────────────────────────────────
const COUNTRIES = [
  { value: 'AE', label: 'UAE — United Arab Emirates', currency: 'AED' },
  { value: 'SA', label: 'Saudi Arabia',                currency: 'SAR' },
  { value: 'KW', label: 'Kuwait',                      currency: 'KWD' },
  { value: 'BH', label: 'Bahrain',                     currency: 'BHD' },
  { value: 'OM', label: 'Oman',                        currency: 'OMR' },
  { value: 'QA', label: 'Qatar',                       currency: 'QAR' },
  { value: 'IN', label: 'India',                       currency: 'INR' },
];

const MONTHS = [
  { value: '01', label: 'January' }, { value: '02', label: 'February' },
  { value: '03', label: 'March' },   { value: '04', label: 'April' },
  { value: '05', label: 'May' },     { value: '06', label: 'June' },
  { value: '07', label: 'July' },    { value: '08', label: 'August' },
  { value: '09', label: 'September' },{ value: '10', label: 'October' },
  { value: '11', label: 'November' }, { value: '12', label: 'December' },
];

// ── Zod schema (full wizard) ──────────────────────────────────────────────
// Defaults live in useForm defaultValues; schema only validates.
const schema = z.object({
  // Step 1
  full_name:         z.string().min(2, 'Required'),
  company_name:      z.string().min(2, 'Required'),
  company_name_ar:   z.string(),
  address:           z.string(),
  // Step 2
  country_code:      z.string().min(2),
  is_tax_registered: z.boolean(),
  tax_id:            z.string(),
  // Step 3
  currency:          z.string().min(3),
  fiscal_year_month: z.string(),
  // Step 4
  warehouse_name:    z.string().min(1, 'Required'),
  warehouse_name_ar: z.string(),
  warehouse_code:    z.string(),
  // Step 5
  bank_account_name:    z.string().min(1, 'Required'),
  bank_account_name_ar: z.string(),
  bank_account_type:    z.enum(['bank', 'cash']),
  bank_name:            z.string(),
  account_number:       z.string(),
  // Step 6
  load_sample_data: z.boolean(),
});
type FormValues = z.infer<typeof schema>;

const TOTAL_STEPS = 6;

// ── Step indicator ─────────────────────────────────────────────────────────
function StepIndicator({ current, total }: { current: number; total: number }) {
  return (
    <div className="mb-8 flex items-center justify-center gap-2">
      {Array.from({ length: total }, (_, i) => (
        <div
          key={i}
          className={`h-2 rounded-full transition-all ${
            i < current
              ? 'w-8 bg-brand-500'
              : i === current
              ? 'w-8 bg-brand-500'
              : 'w-2 bg-border-strong'
          }`}
        />
      ))}
    </div>
  );
}

// ── Main wizard ────────────────────────────────────────────────────────────
export default function SetupWizardPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { set_profile, set_onboarded, is_onboarded } = useAuthStore();
  const [step, setStep] = useState(0);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  // If the user is already onboarded, bounce them BEFORE the wizard renders.
  // (Previously this used useEffect, which fires AFTER paint — causing a
  // one-frame flash of the wizard on every refresh.) <Navigate> is processed
  // during render by react-router, so nothing visible paints.
  if (is_onboarded) {
    return <Navigate to="/dashboard" replace />;
  }

  const {
    register,
    handleSubmit,
    watch,
    setValue,
    trigger,
    formState: { errors },
  } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      country_code: 'AE',
      currency: 'AED',
      fiscal_year_month: '01',
      bank_account_type: 'bank',
      is_tax_registered: false,
      load_sample_data: false,
      warehouse_code: 'MAIN',
    },
  });

  const country_code = watch('country_code');
  const is_tax_registered = watch('is_tax_registered');
  const bank_account_type = watch('bank_account_type');

  // Auto-update currency when country changes
  function onCountryChange(code: string) {
    setValue('country_code', code);
    const c = COUNTRIES.find((c) => c.value === code);
    if (c) setValue('currency', c.currency);
  }

  // Step field validation groups
  const stepFields: (keyof FormValues)[][] = [
    ['full_name', 'company_name'],
    ['country_code'],
    ['currency', 'fiscal_year_month'],
    ['warehouse_name'],
    ['bank_account_name'],
    [],
  ];

  async function goNext() {
    const valid = await trigger(stepFields[step]);
    if (valid) setStep((s) => Math.min(s + 1, TOTAL_STEPS - 1));
  }

  function goBack() {
    setStep((s) => Math.max(s - 1, 0));
  }

  async function onSubmit(values: FormValues) {
    setSubmitting(true);
    setError('');
    try {
      const currentYear = new Date().getFullYear();
      const wizard: WizardData = {
        ...values,
        fiscal_year_start: `${currentYear}-${values.fiscal_year_month}-01`,
        warehouse_name_ar: values.warehouse_name_ar ?? '',
        bank_account_name_ar: values.bank_account_name_ar ?? '',
      };

      const adapter = getAdapter();
      const { company_id } = await runOnboarding(wizard, adapter);

      const profile = await adapter.profiles.getCurrent();
      if (profile) {
        set_profile({ company_id, role: profile.role });
      }
      set_onboarded(true);
      navigate('/dashboard', { replace: true });
    } catch (err) {
      const msg = err instanceof Error ? err.message : '';
      // If the RPC says the user is already onboarded, treat it as success —
      // just hydrate the store from the existing profile and go to the dashboard.
      if (msg.toLowerCase().includes('already onboarded')) {
        try {
          const adapter = getAdapter();
          const profile = await adapter.profiles.getCurrent();
          if (profile) {
            set_profile({ company_id: profile.company_id, role: profile.role });
          }
          set_onboarded(true);
          navigate('/dashboard', { replace: true });
          return;
        } catch {
          // fall through to show error below
        }
      }
      setError(msg || t('wizard.error.generic'));
      setSubmitting(false);
    }
  }

  return (
    <div className="flex min-h-screen flex-col items-center bg-surface-page px-4 py-8">
      <div className="mb-4 flex w-full max-w-lg justify-end">
        <LanguageToggle />
      </div>

      <div className="mb-6 flex flex-col items-center gap-2">
        <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-brand-500">
          <svg viewBox="0 0 24 24" fill="white" className="h-6 w-6">
            <path d="M13 2 3 14h7l-1 8 10-12h-7l1-8z" />
          </svg>
        </div>
        <span className="text-sm font-medium text-ink-secondary">{t('wizard.setup_prompt')}</span>
      </div>

      <Card className="w-full max-w-lg" padding="lg">
        <StepIndicator current={step} total={TOTAL_STEPS} />

        <form onSubmit={handleSubmit(onSubmit)}>
          {/* ── Step 1: Company basics ────────────────────────────────── */}
          {step === 0 && (
            <div className="flex flex-col gap-4">
              <h2 className="text-lg font-semibold text-ink-primary">{t('wizard.step1.title')}</h2>
              <Input
                label={t('wizard.step1.full_name')}
                required
                placeholder="John Smith"
                error={errors.full_name?.message}
                {...register('full_name')}
              />
              <Input
                label={t('wizard.step1.company_name')}
                required
                placeholder="Al Noor Auto Parts"
                error={errors.company_name?.message}
                {...register('company_name')}
              />
              <Input
                label={t('wizard.step1.company_name_ar')}
                placeholder="النور لقطع غيار السيارات"
                dir="rtl"
                error={errors.company_name_ar?.message}
                {...register('company_name_ar')}
              />
              <Input
                label={t('wizard.step1.address')}
                placeholder="Dubai, UAE"
                error={errors.address?.message}
                {...register('address')}
              />
            </div>
          )}

          {/* ── Step 2: Country & tax ─────────────────────────────────── */}
          {step === 1 && (
            <div className="flex flex-col gap-4">
              <h2 className="text-lg font-semibold text-ink-primary">{t('wizard.step2.title')}</h2>
              <Select
                label={t('wizard.step2.country')}
                required
                options={COUNTRIES.map((c) => ({ value: c.value, label: c.label }))}
                value={country_code}
                onChange={(e) => onCountryChange(e.target.value)}
              />
              <label className="flex items-center gap-3 cursor-pointer">
                <input
                  type="checkbox"
                  className="h-4 w-4 rounded border-border-strong text-brand-500"
                  {...register('is_tax_registered')}
                />
                <span className="text-sm text-ink-primary">{t('wizard.step2.tax_registered')}</span>
              </label>
              {is_tax_registered && (
                <Input
                  label={t('wizard.step2.tax_id')}
                  placeholder="TRN / GSTIN / VAT Reg No."
                  error={errors.tax_id?.message}
                  {...register('tax_id')}
                />
              )}
            </div>
          )}

          {/* ── Step 3: Currency & fiscal year ───────────────────────── */}
          {step === 2 && (
            <div className="flex flex-col gap-4">
              <h2 className="text-lg font-semibold text-ink-primary">{t('wizard.step3.title')}</h2>
              <Input
                label={t('wizard.step3.currency')}
                readOnly
                value={watch('currency')}
                hint={t('wizard.step3.currency_hint')}
              />
              <Select
                label={t('wizard.step3.fiscal_year_start')}
                options={MONTHS}
                error={errors.fiscal_year_month?.message}
                {...register('fiscal_year_month')}
              />
            </div>
          )}

          {/* ── Step 4: First warehouse ───────────────────────────────── */}
          {step === 3 && (
            <div className="flex flex-col gap-4">
              <h2 className="text-lg font-semibold text-ink-primary">{t('wizard.step4.title')}</h2>
              <Input
                label={t('wizard.step4.warehouse_name')}
                required
                placeholder="Main Warehouse"
                error={errors.warehouse_name?.message}
                {...register('warehouse_name')}
              />
              <Input
                label={t('wizard.step4.warehouse_name_ar')}
                placeholder="المستودع الرئيسي"
                dir="rtl"
                {...register('warehouse_name_ar')}
              />
              <Input
                label={t('wizard.step4.warehouse_code')}
                placeholder="MAIN"
                error={errors.warehouse_code?.message}
                {...register('warehouse_code')}
              />
            </div>
          )}

          {/* ── Step 5: Bank/cash account ─────────────────────────────── */}
          {step === 4 && (
            <div className="flex flex-col gap-4">
              <h2 className="text-lg font-semibold text-ink-primary">{t('wizard.step5.title')}</h2>
              <Select
                label={t('wizard.step5.account_type')}
                options={[
                  { value: 'bank', label: t('wizard.step5.type_bank') },
                  { value: 'cash', label: t('wizard.step5.type_cash') },
                ]}
                {...register('bank_account_type')}
              />
              <Input
                label={t('wizard.step5.account_name')}
                required
                placeholder={bank_account_type === 'cash' ? 'Petty Cash' : 'Emirates NBD — Current'}
                error={errors.bank_account_name?.message}
                {...register('bank_account_name')}
              />
              <Input
                label={t('wizard.step5.account_name_ar')}
                placeholder={bank_account_type === 'cash' ? 'النقدية' : 'الإمارات دبي الوطني'}
                dir="rtl"
                {...register('bank_account_name_ar')}
              />
              {bank_account_type === 'bank' && (
                <>
                  <Input
                    label={t('wizard.step5.bank_name')}
                    placeholder="Emirates NBD"
                    {...register('bank_name')}
                  />
                  <Input
                    label={t('wizard.step5.account_number')}
                    placeholder="1234567890"
                    {...register('account_number')}
                  />
                </>
              )}
            </div>
          )}

          {/* ── Step 6: Sample data ───────────────────────────────────── */}
          {step === 5 && (
            <div className="flex flex-col gap-4">
              <h2 className="text-lg font-semibold text-ink-primary">{t('wizard.step6.title')}</h2>
              <p className="text-sm text-ink-secondary">{t('wizard.step6.description')}</p>

              <div className="flex flex-col gap-3">
                <label
                  className={`flex cursor-pointer items-start gap-3 rounded-card border-2 p-4 transition-colors ${
                    !watch('load_sample_data') ? 'border-brand-500 bg-brand-50' : 'border-border-subtle'
                  }`}
                >
                  <input
                    type="radio"
                    value="false"
                    checked={!watch('load_sample_data')}
                    onChange={() => setValue('load_sample_data', false)}
                    className="mt-0.5 text-brand-500"
                  />
                  <div>
                    <p className="font-medium text-ink-primary">{t('wizard.step6.start_blank')}</p>
                    <p className="text-sm text-ink-secondary">{t('wizard.step6.start_blank_hint')}</p>
                  </div>
                </label>
                <label
                  className={`flex cursor-pointer items-start gap-3 rounded-card border-2 p-4 transition-colors ${
                    watch('load_sample_data') ? 'border-brand-500 bg-brand-50' : 'border-border-subtle'
                  }`}
                >
                  <input
                    type="radio"
                    value="true"
                    checked={watch('load_sample_data')}
                    onChange={() => setValue('load_sample_data', true)}
                    className="mt-0.5 text-brand-500"
                  />
                  <div>
                    <p className="font-medium text-ink-primary">{t('wizard.step6.load_sample')}</p>
                    <p className="text-sm text-ink-secondary">{t('wizard.step6.load_sample_hint')}</p>
                  </div>
                </label>
              </div>
            </div>
          )}

          {error && (
            <p className="mt-4 rounded-lg bg-danger-50 px-3 py-2 text-sm text-danger-600">
              {error}
            </p>
          )}

          {/* ── Navigation ────────────────────────────────────────────── */}
          <div className="mt-8 flex justify-between gap-3">
            <Button
              type="button"
              variant="secondary"
              onClick={goBack}
              disabled={step === 0}
            >
              {t('common.back')}
            </Button>

            {step < TOTAL_STEPS - 1 ? (
              <Button type="button" onClick={goNext}>
                {t('common.next')}
              </Button>
            ) : (
              <Button type="submit" loading={submitting}>
                {t('wizard.finish')}
              </Button>
            )}
          </div>
        </form>
      </Card>

      <p className="mt-4 text-xs text-ink-tertiary">
        {t('wizard.step_of', { current: step + 1, total: TOTAL_STEPS })}
      </p>
    </div>
  );
}
