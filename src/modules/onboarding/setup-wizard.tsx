import { useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { ArrowLeft, ArrowRight, Check } from 'lucide-react';
import '@/styles/stockbolt-ocean-teal.css';
import { useNavigate } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useTranslation } from 'react-i18next';
import { getAdapter } from '@/data/index';
import { useAuthStore } from '@/store/auth';
import { runOnboarding, type WizardData } from '@/core/onboarding';
import { LanguageToggle } from '@/components/language-toggle';
import { BrandLogo } from '@/components/brand-logo';
import { isAppShell } from '@/lib/platform';
import { GLOBAL_ONBOARDING, useGlobalOnboarding } from './global-config/onboarding-steps';
import { AccountingStep } from './global-config/accounting-step';
import { useSetupDraft } from './global-config/use-setup-draft';
import { vatApplies } from '@/core/global-config/country-packs';

// ── Country / currency data ────────────────────────────────────────────────
// Country names are translated at render time (wizOcean.country_<code>).
const COUNTRIES = [
  { value: 'AE', currency: 'AED' },
  { value: 'SA', currency: 'SAR' },
  { value: 'KW', currency: 'KWD' },
  { value: 'BH', currency: 'BHD' },
  { value: 'OM', currency: 'OMR' },
  { value: 'QA', currency: 'QAR' },
  { value: 'IN', currency: 'INR' },
];
const COUNTRY_KEY: Record<string, string> = {
  AE: 'wizOcean.country_AE', SA: 'wizOcean.country_SA', KW: 'wizOcean.country_KW', BH: 'wizOcean.country_BH',
  OM: 'wizOcean.country_OM', QA: 'wizOcean.country_QA', IN: 'wizOcean.country_IN',
};

// ── Zod schema (Phase 14.14d/e — 3-step wizard) ───────────────────────────
const schema = z.object({
  company_name:      z.string().min(2, 'Required'),
  company_name_ar:   z.string(),
  address:           z.string(),
  country_code:      z.string().min(2),
  fiscal_year_start_month: z.string().min(2),
  is_tax_registered: z.boolean(),
  tax_id:            z.string(),
  load_sample_data:  z.boolean(),
}).superRefine((data, ctx) => {
  // tax_id conditional required when registered (Phase 14.14d)
  if (data.is_tax_registered && data.tax_id.trim().length === 0) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'Tax registration number is required when registered for VAT/GST',
      path: ['tax_id'],
    });
  }
});
type FormValues = z.infer<typeof schema>;
// The draft restores only these: anything else in a stored draft is ignored.
const FORM_KEYS: (keyof FormValues)[] = ['company_name', 'company_name_ar', 'address', 'country_code',
  'fiscal_year_start_month', 'is_tax_registered', 'tax_id', 'load_sample_data'];

// Global v1 — with VITE_GLOBAL_ONBOARDING on, the seven-step Smart Hybrid
// wizard: activities, modules, accounting (Phase 3) and branches (Phase 6)
// come between country and review, and the draft is saved and resumed
// (Phase 7). Off (the default), the three base steps exactly as before.
type StepKey = 'basics' | 'country' | 'activities' | 'modules' | 'accounting' | 'branches' | 'review';
const STEP_KEYS: readonly StepKey[] = GLOBAL_ONBOARDING
  ? ['basics', 'country', 'activities', 'modules', 'accounting', 'branches', 'review']
  : ['basics', 'country', 'review'];
const TOTAL_STEPS = STEP_KEYS.length;

function fiscalYearMonthFor(country_code: string): string {
  return country_code === 'IN' ? '04' : '01';
}

/** Month name in the screen language ('long' for the picker, 'short' for ranges). */
function monthName(m: number, lang: string, width: 'long' | 'short'): string {
  return new Date(2000, m - 1, 1).toLocaleString(lang, { month: width });
}

// Financial year runs 12 months from the chosen start month, e.g. '04' → "Apr – Mar".
function fyRangeLabel(month: string, lang: string): string {
  const start = Math.max(0, Math.min(11, parseInt(month, 10) - 1));
  return `${monthName(start + 1, lang, 'short')} – ${monthName(((start + 11) % 12) + 1, lang, 'short')}`;
}

// ── Step metadata used by both the rail and the panel heading ────────────
type StepMeta = { title: string; eyebrow: string; heading: string; sub: string };
export default function SetupWizardPage() {
  const { t, i18n } = useTranslation();
  const lang = i18n.language;
  const navigate = useNavigate();
  const { set_profile, set_onboarded } = useAuthStore();
  const [step, setStep] = useState(0);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  const {
    register,
    handleSubmit,
    watch,
    setValue,
    trigger,
    getValues,
    formState: { errors },
  } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      // Phase 14.13i — explicit '' defaults so untouched optional inputs
      // produce a valid `string` instead of `undefined`.
      company_name:      '',
      company_name_ar:   '',
      address:           '',
      tax_id:            '',
      country_code:      'AE',
      fiscal_year_start_month: '01',
      is_tax_registered: false,
      load_sample_data:  false,
    },
  });

  const country_code      = watch('country_code');
  const fiscal_year_start_month = watch('fiscal_year_start_month');
  const is_tax_registered = watch('is_tax_registered');

  const inferredCurrency =
    COUNTRIES.find((c) => c.value === country_code)?.currency ?? 'AED';

  const globalSetup = useGlobalOnboarding(country_code);
  const stepKey = STEP_KEYS[step];
  const STEPS: StepMeta[] = STEP_KEYS.map((k) => {
    if (k === 'activities') return { title: t('global_config.onboarding.activities_title'), eyebrow: t('global_config.onboarding.activities_title'), heading: t('global_config.onboarding.activities_heading'), sub: t('global_config.onboarding.activities_sub') };
    if (k === 'modules') return { title: t('global_config.onboarding.modules_title'), eyebrow: t('global_config.onboarding.modules_title'), heading: t('global_config.onboarding.modules_heading'), sub: t('global_config.onboarding.modules_sub') };
    if (k === 'accounting') return { title: t('global_config.accounting.title'), eyebrow: t('global_config.accounting.title'), heading: t('global_config.onboarding_more.accounting_heading'), sub: t('global_config.onboarding_more.accounting_sub') };
    if (k === 'branches') return { title: t('global_config.branches.title'), eyebrow: t('global_config.branches.title'), heading: t('global_config.onboarding_more.branches_heading'), sub: t('global_config.onboarding_more.branches_sub') };
    if (k === 'basics') return { title: t('wizOcean.basics_title'), eyebrow: t('wizOcean.basics_eyebrow'), heading: t('wizOcean.basics_heading'), sub: t('wizOcean.basics_sub') };
    if (k === 'country') return { title: t('wizOcean.country_title'), eyebrow: t('wizOcean.country_eyebrow'), heading: t('wizOcean.country_heading'), sub: t('wizOcean.country_sub') };
    return { title: t('wizOcean.review_title'), eyebrow: t('wizOcean.review_eyebrow'), heading: t('wizOcean.review_heading'), sub: t('wizOcean.review_sub') };
  });

  // The schema's messages are English keys of a kind; show them translated.
  const fieldError = (msg?: string) => (!msg ? undefined
    : msg === 'Required' ? t('wizOcean.err_required')
    : msg.startsWith('Tax registration number') ? t('wizOcean.err_tax_id')
    : msg);

  // Phase 14.14e — tax_id validated on the country step so the superRefine fires.
  const stepFields: Record<StepKey, (keyof FormValues)[]> = {
    basics: ['company_name'],
    country: ['country_code', 'tax_id'],
    activities: [],
    modules: [],
    accounting: ['fiscal_year_start_month'],
    branches: [],
    review: [],
  };

  // ── Phase 7: save and resume ──────────────────────────────────────────────
  // The draft is this wizard's input only; the company is created solely by
  // the explicit Create step. Restored once, then saved after every change.
  const draft = useSetupDraft('onboarding', GLOBAL_ONBOARDING);
  const restored = useRef(false);
  const [resumed, setResumed] = useState(false);
  const formValues = watch();
  const draftPayload = () => ({ form: getValues(), global: globalSetup.snapshot() });
  useEffect(() => {
    if (!GLOBAL_ONBOARDING || !draft.loaded || restored.current) return;
    restored.current = true;
    const d = draft.draft;
    if (!d || d.company_id) return; // an activated company finishes from Settings
    const form = (d.payload.form ?? {}) as Partial<FormValues>;
    for (const k of Object.keys(form) as (keyof FormValues)[]) {
      if (FORM_KEYS.includes(k)) setValue(k, form[k] as never);
    }
    globalSetup.restore((d.payload.global ?? {}) as Parameters<typeof globalSetup.restore>[0]);
    const at = STEP_KEYS.indexOf(d.step as StepKey);
    if (at >= 0 && at < TOTAL_STEPS - 1) setStep(at);
    setResumed(true);
  // eslint-disable-next-line react-hooks/exhaustive-deps -- restore exactly once, when the draft has loaded
  }, [draft.loaded]);
  const snapshotKey = JSON.stringify([formValues, globalSetup.snapshot(), step]);
  useEffect(() => {
    if (!GLOBAL_ONBOARDING || !restored.current || submitting) return;
    draft.save(STEP_KEYS[step], draftPayload());
  // eslint-disable-next-line react-hooks/exhaustive-deps -- snapshotKey captures every input
  }, [snapshotKey]);

  async function goNext() {
    const valid = await trigger(stepFields[stepKey]);
    if (valid && stepKey === 'activities') {
      const msg = globalSetup.activitiesError();
      if (msg) { setError(msg); return; }
    }
    if (valid) {
      setError('');
      setStep((s) => Math.min(s + 1, TOTAL_STEPS - 1));
    }
  }

  function goBack() {
    setError('');
    setStep((s) => Math.max(s - 1, 0));
  }

  // Phase 14.13i — surface zod failures instead of silent no-op.
  function onInvalid(formErrors: Record<string, unknown>) {
    // eslint-disable-next-line no-console
    console.warn('[setup-wizard] submit blocked by validation:', formErrors);
    const first = Object.values(formErrors).find(Boolean) as { message?: string } | undefined;
    setError(first?.message ? fieldError(first.message) ?? first.message : t('wizOcean.err_invalid'));
  }

  async function onSubmit(values: FormValues) {
    // Issue 3 — never create the company before the user reaches and clicks
    // "Finish Setup" on the last step. A stray Enter keypress (or any submit
    // event) on an earlier step otherwise satisfied the whole schema and
    // created the company with default AE/AED, skipping country selection.
    if (step !== TOTAL_STEPS - 1) {
      await goNext();
      return;
    }
    if (GLOBAL_ONBOARDING && !globalSetup.config.valid) {
      setError(t('global_config.onboarding.invalid'));
      return;
    }
    setSubmitting(true);
    setError('');
    try {
      const currentYear = new Date().getFullYear();
      const fyMonth = values.fiscal_year_start_month;
      const customWarehouse = GLOBAL_ONBOARDING ? globalSetup.branches.main_warehouse.trim() : '';
      const wizard: WizardData = {
        ...values,
        // Issue 2 — production companies always start empty. Sample data is
        // never seeded from onboarding (the underlying seeder stays in code
        // for existing demo accounts, but the wizard never triggers it).
        load_sample_data:  false,
        currency:          inferredCurrency,
        fiscal_year_start: `${currentYear}-${fyMonth}-01`,
        full_name:         '',
        warehouse_name:    customWarehouse || 'Main Warehouse',
        // A custom name has no Arabic translation: leave it empty so Arabic shows the name given.
        warehouse_name_ar: customWarehouse ? '' : 'المستودع الرئيسي',
        warehouse_code:    'MAIN',
      };

      const adapter = getAdapter();
      // Phase 7: the draft is saved before activation, so an interruption at
      // any point leaves something to resume from.
      if (GLOBAL_ONBOARDING) await draft.saveNow('review', draftPayload());
      const { company_id } = await runOnboarding(wizard, adapter);
      // Global v1 — only now does the company exist for the RPC to write to.
      if (GLOBAL_ONBOARDING) {
        await draft.saveNow('activating', draftPayload(), company_id);
        const saved = await globalSetup.saveAfterCreate();
        const located = await globalSetup.applyBranches(company_id);
        // All done: the draft goes. Otherwise it stays, pointing at the new
        // company, and Settings → Business Configuration offers to finish.
        if (saved && located) await draft.remove();
      }

      const profile = await adapter.profiles.getCurrent();
      if (profile) {
        set_profile({ company_id, role: profile.role });
      }
      set_onboarded(true);
      navigate('/dashboard', { replace: true });
    } catch (err) {
      const msg = err instanceof Error ? err.message : '';
      // phase111 — the session belongs to an Auth account that was deleted:
      // nothing was created. Sign out so the next sign-in gets a fresh session.
      if (msg.includes('account_not_found')) {
        setError(t('wizard.error.account_not_found'));
        setSubmitting(false);
        await getAdapter().auth.signOut().catch(() => undefined); // already invalid; the guard then shows sign-in
        return;
      }
      if (msg.includes('full_name_required')) {
        setError(t('wizard.error.full_name_required'));
        setSubmitting(false);
        return;
      }
      // A lost network response: the server may or may not have saved. Retrying
      // is safe since phase111 (it resumes instead of creating a second company).
      if (/failed to fetch|network|load failed/i.test(msg)) {
        setError(t('wizard.error.network'));
        setSubmitting(false);
        return;
      }
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

  const progress = ((step + 1) / TOTAL_STEPS) * 100;
  const meta = STEPS[step];
  const isLast = step === TOTAL_STEPS - 1;
  // Phones (the Android app, or a narrow browser) drop the side rail: the
  // steps move into a brand header and the buttons pin to the bottom.
  const isPhone = useIsPhone();
  const countryLabel = (code: string) => t(COUNTRY_KEY[code] ?? code, { defaultValue: code });
  const stepOf = t('wizard.step_of', { current: step + 1, total: STEPS.length });

  return (
    // Ocean Teal (UI v1.1): look only — same steps, validation, draft
    // save/resume and company creation as before.
    <div className={`sb-ocean sb-wiz ${isPhone ? 'is-phone' : ''}`} data-testid="setup-wizard-ocean">
      <div className="sb-wiz-card">
        {/* ── Side rail — step list (desktop) ── */}
        {!isPhone && (
          <aside className="sb-wiz-rail">
            <div className="sb-wiz-logo"><BrandLogo mark={30} text={14} tone="white" /></div>
            <ol className="sb-wiz-steps">
              {STEPS.map((s, i) => {
                const state = i === step ? 'is-active' : i < step ? 'is-done' : 'is-pending';
                return (
                  <li key={i} className={`sb-wiz-step ${state}`}>
                    <span className="sb-wiz-dot" aria-hidden="true">{i < step ? <Check size={14} /> : <bdi dir="ltr">{i + 1}</bdi>}</span>
                    <span className="sb-wiz-step-txt">
                      <span className="sb-wiz-step-no">{t('wizOcean.step_n', { n: i + 1 })}</span>
                      <span className="sb-wiz-step-title">{s.title}</span>
                    </span>
                  </li>
                );
              })}
            </ol>
            <p className="sb-wiz-tagline">{t('wizOcean.tagline')}</p>
          </aside>
        )}

        {/* ── Panel — form ── */}
        <div className="sb-wiz-panel">
          {isPhone ? (
            <header className="sb-wiz-phead">
              <div className="sb-wiz-phead-top">
                <BrandLogo mark={26} text={13} tone="white" />
                <div className="sb-wiz-lang"><LanguageToggle /></div>
              </div>
              <div className="sb-wiz-segs" aria-hidden="true">
                {STEPS.map((_, i) => <span key={i} className={i <= step ? 'is-on' : undefined} />)}
              </div>
              <p className="sb-wiz-phead-step">{stepOf} · <strong>{meta.title}</strong></p>
            </header>
          ) : (
            <>
              <div className="sb-wiz-top"><LanguageToggle /></div>
              <div className="sb-wiz-progress" role="progressbar" aria-valuenow={step + 1} aria-valuemin={1} aria-valuemax={STEPS.length} aria-label={stepOf}>
                <span style={{ width: `${progress}%` }} />
              </div>
            </>
          )}

          {/* Heading */}
          <div className="sb-wiz-head">
            <p className="sb-wiz-eyebrow">{meta.eyebrow}</p>
            <h1 className="sb-wiz-title">{meta.heading}</h1>
            <p className="sb-wiz-sub">{meta.sub}</p>
          </div>

          <form onSubmit={handleSubmit(onSubmit, onInvalid)} className="sb-wiz-form">
            <div className="sb-wiz-fields">

              {/* ── Step 1 — Company basics ── */}
              {stepKey === 'basics' && (
                <>
                  <Field label={t('wizOcean.f_company_name')} required error={fieldError(errors.company_name?.message)}>
                    <input type="text" className="sb-wiz-input" placeholder={t('wizOcean.f_company_name_ph')} {...register('company_name')} />
                  </Field>

                  <Field label={t('wizOcean.f_company_name_ar')} hint={t('wizOcean.f_company_name_ar_hint')}>
                    <input type="text" dir="rtl" className="sb-wiz-input" placeholder="النور لقطع غيار السيارات" {...register('company_name_ar')} />
                  </Field>

                  <Field label={t('wizOcean.f_address')}>
                    <input type="text" className="sb-wiz-input" placeholder={t('wizOcean.f_address_ph')} {...register('address')} />
                  </Field>
                </>
              )}

              {/* ── Step 2 — Country & tax ── */}
              {stepKey === 'country' && (
                <>
                  <Field label={t('wizOcean.f_country')} required hint={t('wizOcean.f_country_hint', { currency: inferredCurrency })}>
                    <select
                      value={country_code}
                      className="sb-wiz-input"
                      onChange={(e) => {
                        setValue('country_code', e.target.value);
                        // Suggest the country's usual financial-year start; user can still change it.
                        setValue('fiscal_year_start_month', fiscalYearMonthFor(e.target.value));
                        // phase123 — no VAT in Kuwait / Qatar: nothing to register for.
                        if (!vatApplies(e.target.value)) { setValue('is_tax_registered', false); setValue('tax_id', ''); }
                      }}
                    >
                      {COUNTRIES.map((c) => (
                        <option key={c.value} value={c.value}>{countryLabel(c.value)}</option>
                      ))}
                    </select>
                  </Field>

                  <Field
                    label={t('wizOcean.f_fy_start')}
                    required
                    hint={`${t('wizOcean.f_fy_runs', { range: fyRangeLabel(fiscal_year_start_month, lang) })} ${country_code === 'IN' ? t('wizOcean.f_fy_india') : t('wizOcean.f_fy_gcc')}`}
                  >
                    <select
                      value={fiscal_year_start_month}
                      className="sb-wiz-input"
                      onChange={(e) => setValue('fiscal_year_start_month', e.target.value)}
                    >
                      {Array.from({ length: 12 }, (_, i) => {
                        const v = String(i + 1).padStart(2, '0');
                        return <option key={v} value={v}>{monthName(i + 1, lang, 'long')}</option>;
                      })}
                    </select>
                  </Field>

                  {vatApplies(country_code) && (
                    <label className="sb-wiz-check">
                      <input type="checkbox" {...register('is_tax_registered')} />
                      <span>{t('wizOcean.f_tax_registered')}</span>
                    </label>
                  )}

                  {is_tax_registered && vatApplies(country_code) && (
                    <Field label={t('wizOcean.f_tax_id')} required error={fieldError(errors.tax_id?.message)}>
                      <input type="text" dir="ltr" className="sb-wiz-input" placeholder={t('wizOcean.f_tax_id_ph')} {...register('tax_id')} />
                    </Field>
                  )}
                </>
              )}

              {/* ── Global v1 — business activities and modules ── */}
              {resumed && stepKey !== 'review' && (
                <p className="sb-info-note" style={{ fontSize: 13, margin: 0 }} data-testid="draft-resumed">{t('global_config.draft.resumed')}</p>
              )}
              {stepKey === 'activities' && globalSetup.activitiesStep}
              {stepKey === 'modules' && globalSetup.modulesStep}
              {stepKey === 'accounting' && (
                <AccountingStep country_code={country_code} currency={inferredCurrency} fy_month={fiscal_year_start_month}
                  onFyMonth={(m) => setValue('fiscal_year_start_month', m)} />
              )}
              {stepKey === 'branches' && globalSetup.branchesStep}

              {/* ── Last step — Review & create ── */}
              {stepKey === 'review' && (
                <>
                  <dl className="sb-wiz-summary">
                    <SummaryRow label={t('wizOcean.r_company')} value={watch('company_name') || '—'} />
                    {watch('company_name_ar') && (
                      <SummaryRow label={t('wizOcean.f_company_name_ar')} value={watch('company_name_ar')} rtl />
                    )}
                    {watch('address') && (
                      <SummaryRow label={t('wizOcean.f_address')} value={watch('address')} />
                    )}
                    <SummaryRow label={t('wizOcean.f_country')} value={countryLabel(country_code)} />
                    <SummaryRow
                      label={t('wizOcean.r_currency_fy')}
                      value={`${inferredCurrency} · ${fyRangeLabel(fiscal_year_start_month, lang)}`}
                      ltr
                    />
                    <SummaryRow
                      label={t('wizOcean.r_tax_registered')}
                      value={is_tax_registered ? (watch('tax_id') || '—') : t('wizOcean.no')}
                      ltr={is_tax_registered}
                    />
                    {GLOBAL_ONBOARDING && (
                      <>
                        <SummaryRow label={t('global_config.onboarding.review_activities')} value={globalSetup.summary.activities || '—'} />
                        <SummaryRow label={t('global_config.onboarding.review_modules')} value={globalSetup.summary.modules} />
                        <SummaryRow label={t('global_config.branches.head_office')}
                          value={[globalSetup.branches.head_office.trim() || t('global_config.branches.head_office'), ...globalSetup.branches.extra].join(', ')} />
                        {globalSetup.config.modules.includes('inventory') && (
                          <SummaryRow label={t('global_config.branches.main_warehouse')} value={globalSetup.branches.main_warehouse.trim() || 'Main Warehouse'} />
                        )}
                      </>
                    )}
                  </dl>

                  <p className="sb-form-hint" style={{ margin: 0 }}>{t('wizOcean.review_note')}</p>
                </>
              )}

              {/* Form-level error banner */}
              {error && <p className="sb-alert sb-alert-danger" role="alert" style={{ margin: 0 }}>{error}</p>}
            </div>

            {/* Actions */}
            <div className="sb-wiz-actions">
              {isPhone ? (step > 0 && (
                <button type="button" onClick={goBack} disabled={submitting} aria-label={t('wizOcean.back')} className="sb-wiz-back is-icon">
                  <ArrowLeft size={20} className="sb-rtl-flip" aria-hidden="true" />
                </button>
              )) : (
                <button type="button" onClick={goBack} disabled={step === 0 || submitting} className="sb-wiz-back">
                  <ArrowLeft size={16} className="sb-rtl-flip" aria-hidden="true" /> {t('wizOcean.back')}
                </button>
              )}

              {/* Separate keys: without them React turns the clicked Continue
                  button into this submit button while the click is still being
                  handled (goNext's microtasks run before the browser's default
                  action), so arriving on the last step created the company
                  without the user ever pressing Create. */}
              {isLast ? (
                <button key="create" type="submit" disabled={submitting} className="sb-primary-btn sb-wiz-next">
                  {submitting ? t('wizOcean.creating') : t('wizOcean.create')} {!submitting && <ArrowRight size={17} className="sb-rtl-flip" aria-hidden="true" />}
                </button>
              ) : (
                <button key="next" type="button" onClick={goNext} className="sb-primary-btn sb-wiz-next">
                  {t('wizOcean.continue')} <ArrowRight size={17} className="sb-rtl-flip" aria-hidden="true" />
                </button>
              )}
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}

// ── Sub-components ─────────────────────────────────────────────────────────

/** The Android app, or any browser narrower than a tablet. */
function useIsPhone(): boolean {
  const query = '(max-width: 767px)';
  const [narrow, setNarrow] = useState(() => window.matchMedia(query).matches);
  useEffect(() => {
    const mq = window.matchMedia(query);
    const update = () => setNarrow(mq.matches);
    mq.addEventListener('change', update);
    return () => mq.removeEventListener('change', update);
  }, []);
  return narrow || isAppShell();
}

interface FieldProps {
  label:    string;
  required?: boolean;
  hint?:    string;
  error?:   string;
  children: ReactNode;
}
function Field({ label, required, hint, error, children }: FieldProps) {
  return (
    <div className="sb-wiz-field">
      <label className="sb-wiz-label">
        {label}
        {required && <span className="sb-wiz-req" aria-hidden="true">*</span>}
      </label>
      {children}
      {error
        ? <span className="sb-wiz-err">{error}</span>
        : hint
        ? <span className="sb-wiz-hint">{hint}</span>
        : null}
    </div>
  );
}

function SummaryRow({ label, value, rtl, ltr }: { label: string; value: string; rtl?: boolean; ltr?: boolean }) {
  return (
    <div className="sb-wiz-sumrow">
      <dt>{label}</dt>
      <dd dir={rtl ? 'rtl' : ltr ? 'ltr' : undefined}>{value}</dd>
    </div>
  );
}
