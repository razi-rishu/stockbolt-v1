import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
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

// ── Zod schema (Phase 14.14d: tight 4-step wizard) ───────────────────────
// Operator feedback (2026-05-30):
//   - Personal name belongs in /register, not company setup.
//   - Tax ID should be required when "Registered for VAT/GST" is ticked.
//   - "Currency & fiscal year" step is unwanted — auto-derive from country.
//   - Final submit must be deliberate; no surprise auto-create.
const schema = z.object({
  // Step 1 — Company basics (no more personal name)
  company_name:      z.string().min(2, 'Required'),
  company_name_ar:   z.string(),
  address:           z.string(),
  // Step 2 — Country & tax
  country_code:      z.string().min(2),
  is_tax_registered: z.boolean(),
  tax_id:            z.string(),
  // Step 3 — First warehouse (kept; minimal)
  warehouse_name:    z.string().min(1, 'Required'),
  warehouse_name_ar: z.string(),
  warehouse_code:    z.string(),
  // Step 4 — Review + sample data choice
  load_sample_data:  z.boolean(),
}).superRefine((data, ctx) => {
  // Phase 14.14d — conditional required: tax_id mandatory when registered.
  // Using superRefine (not refine) so the error attaches to the tax_id
  // field, which means trigger('tax_id') catches it during step 2 → 3.
  if (data.is_tax_registered && data.tax_id.trim().length === 0) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'Tax registration number is required when registered for VAT/GST',
      path: ['tax_id'],
    });
  }
});
type FormValues = z.infer<typeof schema>;

const TOTAL_STEPS = 4;

// Country-driven fiscal-year-start. India uses Apr-Mar; everything else
// (GCC) uses Jan-Dec. The operator no longer picks this — they can
// override later via Settings → Company.
function fiscalYearMonthFor(country_code: string): string {
  return country_code === 'IN' ? '04' : '01';
}

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
  const { set_profile, set_onboarded } = useAuthStore();
  const [step, setStep] = useState(0);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  // The "already onboarded → /dashboard" redirect is handled at the routing
  // level by RequireNotOnboarded (see src/components/require-not-onboarded.tsx).
  // Doing it inside this component with an early return broke the Rules of
  // Hooks (useForm below would be skipped on the redirect render).

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
      // Required-text fields default to '' (not undefined) so an untouched
      // <input> still produces a valid `string` for the zod resolver.
      company_name:      '',
      company_name_ar:   '',
      address:           '',
      tax_id:            '',
      warehouse_name:    '',
      warehouse_name_ar: '',
      // Sensible step defaults
      country_code:      'AE',
      is_tax_registered: false,
      load_sample_data:  false,
      warehouse_code:    'MAIN',
    },
  });

  const country_code = watch('country_code');
  const is_tax_registered = watch('is_tax_registered');

  // Derived from country (was its own wizard step before Phase 14.14d).
  const inferredCurrency =
    COUNTRIES.find((c) => c.value === country_code)?.currency ?? 'AED';

  function onCountryChange(code: string) {
    setValue('country_code', code);
  }

  // Phase 14.14d — 4 steps: Company basics → Country/Tax → Warehouse → Review.
  // We validate `tax_id` on step 1 too so the superRefine in the schema can
  // bark when the operator ticked "Registered for VAT/GST" but left the
  // number empty.
  const stepFields: (keyof FormValues)[][] = [
    ['company_name'],
    ['country_code', 'tax_id'],
    ['warehouse_name'],
    [],
  ];

  async function goNext() {
    const valid = await trigger(stepFields[step]);
    if (valid) setStep((s) => Math.min(s + 1, TOTAL_STEPS - 1));
  }

  function goBack() {
    setStep((s) => Math.max(s - 1, 0));
  }

  // Phase 14.13i — surface form-level validation failures. Without an
  // explicit onInvalid handler, handleSubmit silently swallows zod errors
  // (e.g. an optional `z.string()` field that's `undefined` in form state).
  // The Finish button then looks broken because nothing visible happens
  // on click. Log + show a generic message so we never get stuck again.
  function onInvalid(formErrors: Record<string, unknown>) {
    console.warn('[setup-wizard] submit blocked by validation:', formErrors);
    const first = Object.values(formErrors).find(Boolean) as { message?: string } | undefined;
    setError(first?.message || 'Please re-check the form — one or more fields look invalid.');
  }

  async function onSubmit(values: FormValues) {
    setSubmitting(true);
    setError('');
    try {
      const currentYear = new Date().getFullYear();
      const fyMonth = fiscalYearMonthFor(values.country_code);
      const wizard: WizardData = {
        ...values,
        // Phase 14.14d — both auto-derived from country, no longer collected
        // from the operator. They can change either via Settings → Company
        // after onboarding.
        currency:          inferredCurrency,
        fiscal_year_start: `${currentYear}-${fyMonth}-01`,
        // Phase 14.14d — personal name moved off the wizard. The profile
        // row keeps an empty string for now; operators set it on the
        // Profile settings page when ready. Drops a "why am I being asked
        // my own name to create a COMPANY?" UX confusion.
        full_name:         '',
        warehouse_name_ar: values.warehouse_name_ar ?? '',
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

        <form onSubmit={handleSubmit(onSubmit, onInvalid)}>
          {/* ── Step 1: Company basics (no personal name — Phase 14.14d) ── */}
          {step === 0 && (
            <div className="flex flex-col gap-4">
              <h2 className="text-lg font-semibold text-ink-primary">{t('wizard.step1.title')}</h2>
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
              <div>
                <Select
                  label={t('wizard.step2.country')}
                  required
                  options={COUNTRIES.map((c) => ({ value: c.value, label: c.label }))}
                  value={country_code}
                  onChange={(e) => onCountryChange(e.target.value)}
                />
                <p className="mt-1.5 text-xs text-ink-tertiary">
                  Currency <span className="font-mono">{inferredCurrency}</span> ·
                  Fiscal year starts {country_code === 'IN' ? 'April 1' : 'January 1'} ·
                  Change anytime in Settings → Company.
                </p>
              </div>
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
                  label="Tax registration number"
                  required
                  placeholder="TRN / GSTIN / VAT Reg No."
                  error={errors.tax_id?.message}
                  {...register('tax_id')}
                />
              )}
            </div>
          )}

          {/* ── Step 3: First warehouse (was step 4 — Phase 14.14d) ────── */}
          {step === 2 && (
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

          {/* ── Step 4: Review & create (was step 5; renamed Phase 14.14d)
                 Shows a summary of every input so the operator deliberately
                 confirms before company creation. Removes the "I clicked
                 Finish without realising what it did" footgun. */}
          {step === 3 && (
            <div className="flex flex-col gap-4">
              <h2 className="text-lg font-semibold text-ink-primary">Review and create</h2>
              <p className="text-sm text-ink-secondary">
                Double-check these details. Clicking <strong>Create company</strong> below sets up your
                company in the system. You can change anything later from Settings → Company.
              </p>

              <div className="rounded-card border border-border-subtle bg-surface-muted/40 p-4 text-sm">
                <dl className="space-y-2.5">
                  <div className="flex justify-between gap-3">
                    <dt className="text-ink-secondary">Company name</dt>
                    <dd className="font-medium text-ink-primary text-right">
                      {watch('company_name') || <span className="text-ink-tertiary italic">—</span>}
                    </dd>
                  </div>
                  {watch('company_name_ar') && (
                    <div className="flex justify-between gap-3">
                      <dt className="text-ink-secondary">Company name (Arabic)</dt>
                      <dd className="font-medium text-ink-primary text-right" dir="rtl">{watch('company_name_ar')}</dd>
                    </div>
                  )}
                  {watch('address') && (
                    <div className="flex justify-between gap-3">
                      <dt className="text-ink-secondary">Address</dt>
                      <dd className="font-medium text-ink-primary text-right">{watch('address')}</dd>
                    </div>
                  )}
                  <div className="flex justify-between gap-3">
                    <dt className="text-ink-secondary">Country</dt>
                    <dd className="font-medium text-ink-primary text-right">
                      {COUNTRIES.find((c) => c.value === country_code)?.label ?? country_code}
                    </dd>
                  </div>
                  <div className="flex justify-between gap-3">
                    <dt className="text-ink-secondary">Currency / fiscal year</dt>
                    <dd className="font-medium text-ink-primary text-right">
                      {inferredCurrency} · {country_code === 'IN' ? 'Apr–Mar' : 'Jan–Dec'}
                    </dd>
                  </div>
                  <div className="flex justify-between gap-3">
                    <dt className="text-ink-secondary">Tax registered</dt>
                    <dd className="font-medium text-ink-primary text-right">
                      {is_tax_registered
                        ? (watch('tax_id') || <span className="text-ink-tertiary italic">—</span>)
                        : 'No'}
                    </dd>
                  </div>
                  <div className="flex justify-between gap-3">
                    <dt className="text-ink-secondary">First warehouse</dt>
                    <dd className="font-medium text-ink-primary text-right">
                      {watch('warehouse_name')} <span className="text-ink-tertiary">({watch('warehouse_code') || 'MAIN'})</span>
                    </dd>
                  </div>
                </dl>
              </div>

              <p className="text-sm font-medium text-ink-primary mt-2">Sample data</p>
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
                {submitting ? 'Creating…' : 'Create company'}
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
