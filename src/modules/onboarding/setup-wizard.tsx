import { useState } from 'react';
import type { ReactNode, CSSProperties } from 'react';
import { useNavigate } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useTranslation } from 'react-i18next';
import { getAdapter } from '@/data/index';
import { useAuthStore } from '@/store/auth';
import { runOnboarding, type WizardData } from '@/core/onboarding';
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

// ── Zod schema (Phase 14.14d/e — 3-step wizard) ───────────────────────────
const schema = z.object({
  company_name:      z.string().min(2, 'Required'),
  company_name_ar:   z.string(),
  address:           z.string(),
  country_code:      z.string().min(2),
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

const TOTAL_STEPS = 3;

function fiscalYearMonthFor(country_code: string): string {
  return country_code === 'IN' ? '04' : '01';
}

// ── Step metadata used by both the sidebar and the right-panel heading ────
const STEPS: ReadonlyArray<{ label: string; title: string; eyebrow: string; heading: string; sub: string }> = [
  {
    label:   'Step 1',
    title:   'Company basics',
    eyebrow: 'Getting started',
    heading: 'Tell us about\nyour company',
    sub:     'This appears on invoices, reports & documents.',
  },
  {
    label:   'Step 2',
    title:   'Country & tax',
    eyebrow: 'Where you operate',
    heading: 'Country & tax\nregistration',
    sub:     'Drives your currency, fiscal year, and VAT / GST setup.',
  },
  {
    label:   'Step 3',
    title:   'Review & create',
    eyebrow: 'Almost done',
    heading: 'Review and\ncreate',
    sub:     'Double-check before we set up your company.',
  },
];

// ── Main wizard ────────────────────────────────────────────────────────────
export default function SetupWizardPage() {
  const { t } = useTranslation();
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
      is_tax_registered: false,
      load_sample_data:  false,
    },
  });

  const country_code      = watch('country_code');
  const is_tax_registered = watch('is_tax_registered');

  const inferredCurrency =
    COUNTRIES.find((c) => c.value === country_code)?.currency ?? 'AED';

  // Phase 14.14e — 3 steps; tax_id validated on step 1 so the superRefine fires.
  const stepFields: (keyof FormValues)[][] = [
    ['company_name'],
    ['country_code', 'tax_id'],
    [],
  ];

  async function goNext() {
    const valid = await trigger(stepFields[step]);
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
        currency:          inferredCurrency,
        fiscal_year_start: `${currentYear}-${fyMonth}-01`,
        full_name:         '',
        warehouse_name:    'Main Warehouse',
        warehouse_name_ar: 'المستودع الرئيسي',
        warehouse_code:    'MAIN',
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

  return (
    <div style={pageWrapStyle}>
      <div style={cardWrapStyle}>
        {/* LEFT SIDEBAR — step indicator */}
        <aside style={sidebarStyle}>
          {/* Decorative circles */}
          <div style={{ ...decorCircleStyle, width: 180, height: 180, top: -50, right: -60, background: 'rgba(255,255,255,0.07)' }} />
          <div style={{ ...decorCircleStyle, width: 120, height: 120, bottom: 40, left: -30, background: 'rgba(255,255,255,0.05)' }} />

          {/* Logo */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: '2.5rem', position: 'relative', zIndex: 1 }}>
            <div style={logoIconStyle}>
              <svg viewBox="0 0 24 24" fill="white" style={{ width: 16, height: 16 }} aria-hidden="true">
                <path d="M13 2 3 14h7l-1 8 10-12h-7l1-8z" />
              </svg>
            </div>
            <span style={{ fontSize: 15, fontWeight: 600, color: '#fff', letterSpacing: '-0.01em' }}>StockBolt</span>
          </div>

          {/* Steps */}
          <div style={{ display: 'flex', flexDirection: 'column', position: 'relative', zIndex: 1 }}>
            {STEPS.map((s, i) => {
              const isActive  = i === step;
              const isDone    = i < step;
              const isPending = i > step;
              return (
                <div key={i} style={{ display: 'flex', alignItems: 'flex-start', gap: 12, padding: '14px 0', position: 'relative' }}>
                  {i < STEPS.length - 1 && (
                    <div style={{
                      position: 'absolute', left: 13, top: 38,
                      width: 1, height: 'calc(100% - 14px)',
                      background: 'rgba(255,255,255,0.2)',
                    }} />
                  )}
                  <div style={{
                    width: 27, height: 27, borderRadius: '50%',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    fontSize: isDone ? 13 : 12, fontWeight: 600, flexShrink: 0,
                    position: 'relative', zIndex: 1,
                    background: (isActive || isDone) ? '#fff' : 'rgba(255,255,255,0.15)',
                    color: (isActive || isDone) ? '#6c63ff' : 'rgba(255,255,255,0.6)',
                    boxShadow: isActive ? '0 0 0 4px rgba(255,255,255,0.25)' : 'none',
                    transition: 'all 0.2s ease',
                  }}>
                    {isDone ? '✓' : i + 1}
                  </div>
                  <div style={{ paddingTop: 2 }}>
                    <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.55)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 2 }}>
                      {s.label}
                    </div>
                    <div style={{ fontSize: 13, fontWeight: 500, color: isPending ? 'rgba(255,255,255,0.5)' : '#fff' }}>
                      {s.title}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>

          <div style={{ marginTop: 'auto', fontSize: 11, color: 'rgba(255,255,255,0.35)', paddingTop: '1rem', position: 'relative', zIndex: 1 }}>
            StockBolt ERP · Auto Parts
          </div>
        </aside>

        {/* RIGHT PANEL — form */}
        <div style={rightPanelStyle}>
          {/* Top row — language toggle */}
          <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: '1.5rem' }}>
            <LanguageToggle />
          </div>

          {/* Progress bar */}
          <div style={{ height: 3, background: '#f0f0f0', borderRadius: 99, marginBottom: '2rem', overflow: 'hidden' }}>
            <div style={{
              height: '100%',
              width: `${progress}%`,
              background: '#6c63ff',
              borderRadius: 99,
              transition: 'width 0.4s ease',
            }} />
          </div>

          {/* Heading */}
          <div style={{ marginBottom: '1.75rem' }}>
            <div style={{ fontSize: 11, fontWeight: 600, color: '#6c63ff', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 8 }}>
              {meta.eyebrow}
            </div>
            <div style={{ fontSize: 22, fontWeight: 600, color: '#111827', letterSpacing: '-0.02em', lineHeight: 1.2, whiteSpace: 'pre-line' }}>
              {meta.heading}
            </div>
            <div style={{ fontSize: 13, color: '#6b7280', marginTop: 6 }}>
              {meta.sub}
            </div>
          </div>

          <form onSubmit={handleSubmit(onSubmit, onInvalid)} style={{ display: 'flex', flexDirection: 'column', flex: 1 }}>
            {/* Fields */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '1.1rem', flex: 1 }}>

              {/* ── Step 1 — Company basics ───────────────────────────── */}
              {step === 0 && (
                <>
                  <Field label="Company Name (English)" required error={errors.company_name?.message}>
                    <input
                      type="text"
                      placeholder="e.g. Al Noor Auto Parts"
                      style={inputStyle}
                      {...register('company_name')}
                    />
                  </Field>

                  <Field label="Company Name (Arabic)" hint="Optional — shown on Arabic documents & receipts">
                    <input
                      type="text"
                      dir="rtl"
                      placeholder="النور لقطع غيار السيارات"
                      style={{ ...inputStyle, textAlign: 'right' }}
                      {...register('company_name_ar')}
                    />
                  </Field>

                  <Field label="Business Address">
                    <input
                      type="text"
                      placeholder="e.g. Sharjah Industrial Zone, UAE"
                      style={inputStyle}
                      {...register('address')}
                    />
                  </Field>
                </>
              )}

              {/* ── Step 2 — Country & tax ────────────────────────────── */}
              {step === 1 && (
                <>
                  <Field label="Country" required hint={`Currency ${inferredCurrency} · Fiscal year starts ${country_code === 'IN' ? 'April 1' : 'January 1'} · Change anytime in Settings → Company`}>
                    <select
                      value={country_code}
                      onChange={(e) => setValue('country_code', e.target.value)}
                      style={inputStyle}
                    >
                      {COUNTRIES.map((c) => (
                        <option key={c.value} value={c.value}>{c.label}</option>
                      ))}
                    </select>
                  </Field>

                  <label style={{ display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer', padding: '4px 0' }}>
                    <input
                      type="checkbox"
                      style={{ width: 16, height: 16, accentColor: '#6c63ff', cursor: 'pointer' }}
                      {...register('is_tax_registered')}
                    />
                    <span style={{ fontSize: 13, color: '#111827' }}>Registered for VAT / GST</span>
                  </label>

                  {is_tax_registered && (
                    <Field label="Tax Registration Number" required error={errors.tax_id?.message}>
                      <input
                        type="text"
                        placeholder="TRN / GSTIN / VAT Reg No."
                        style={inputStyle}
                        {...register('tax_id')}
                      />
                    </Field>
                  )}
                </>
              )}

              {/* ── Step 3 — Review & create ──────────────────────────── */}
              {step === 2 && (
                <>
                  <div style={summaryBoxStyle}>
                    <SummaryRow label="Company name" value={watch('company_name') || '—'} mono={false} />
                    {watch('company_name_ar') && (
                      <SummaryRow label="Company name (Arabic)" value={watch('company_name_ar')} mono={false} rtl />
                    )}
                    {watch('address') && (
                      <SummaryRow label="Address" value={watch('address')} mono={false} />
                    )}
                    <SummaryRow
                      label="Country"
                      value={COUNTRIES.find((c) => c.value === country_code)?.label ?? country_code}
                      mono={false}
                    />
                    <SummaryRow
                      label="Currency / fiscal year"
                      value={`${inferredCurrency} · ${country_code === 'IN' ? 'Apr – Mar' : 'Jan – Dec'}`}
                      mono
                    />
                    <SummaryRow
                      label="Tax registered"
                      value={is_tax_registered ? (watch('tax_id') || '—') : 'No'}
                      mono={is_tax_registered}
                    />
                  </div>

                  <div style={{ fontSize: 11, color: '#9ca3af', marginTop: 2 }}>
                    We'll also create a default <strong>Main Warehouse</strong> (code <span style={{ fontFamily: 'ui-monospace, SFMono-Regular, monospace' }}>MAIN</span>) and seed your chart of accounts, tax rates, and units of measure. Rename or add more from Settings after onboarding.
                  </div>

                  <div style={{ fontSize: 12, fontWeight: 600, color: '#111827', marginTop: '0.5rem' }}>Sample data</div>

                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                    <RadioCard
                      checked={!watch('load_sample_data')}
                      onChange={() => setValue('load_sample_data', false)}
                      title="Start with a clean slate"
                      body="Begin with no products, contacts, or transactions."
                    />
                    <RadioCard
                      checked={watch('load_sample_data')}
                      onChange={() => setValue('load_sample_data', true)}
                      title="Load sample data"
                      body="Adds demo brands (Bosch, Mahle, Mann), categories, and sample products."
                    />
                  </div>
                </>
              )}

              {/* Form-level error banner */}
              {error && (
                <div style={errorBannerStyle}>
                  {error}
                </div>
              )}
            </div>

            {/* Actions */}
            <div style={actionsRowStyle}>
              <button
                type="button"
                onClick={goBack}
                disabled={step === 0 || submitting}
                style={backBtnStyle(step === 0 || submitting)}
              >
                ← Back
              </button>

              {isLast ? (
                <button
                  type="submit"
                  disabled={submitting}
                  style={primaryBtnStyle(submitting)}
                >
                  {submitting ? 'Creating…' : 'Create company →'}
                </button>
              ) : (
                <button
                  type="button"
                  onClick={goNext}
                  style={primaryBtnStyle(false)}
                >
                  Continue →
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
interface FieldProps {
  label:    string;
  required?: boolean;
  hint?:    string;
  error?:   string;
  children: ReactNode;
}
function Field({ label, required, hint, error, children }: FieldProps) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <label style={fieldLabelStyle}>
        {label}
        {required && <span style={{ color: '#e24b4a', fontSize: 13, marginLeft: 4 }}>*</span>}
      </label>
      {children}
      {error
        ? <span style={{ fontSize: 11, color: '#e24b4a' }}>{error}</span>
        : hint
        ? <span style={{ fontSize: 11, color: '#9ca3af' }}>{hint}</span>
        : null}
    </div>
  );
}

function SummaryRow({ label, value, mono, rtl }: { label: string; value: string; mono?: boolean; rtl?: boolean }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, padding: '6px 0' }}>
      <span style={{ fontSize: 12, color: '#6b7280' }}>{label}</span>
      <span style={{
        fontSize: 13, color: '#111827', textAlign: 'right',
        fontFamily: mono ? 'ui-monospace, SFMono-Regular, monospace' : "'DM Sans', sans-serif",
        direction: rtl ? 'rtl' : 'ltr',
      }}>{value}</span>
    </div>
  );
}

function RadioCard({ checked, onChange, title, body }: { checked: boolean; onChange: () => void; title: string; body: string }) {
  return (
    <label
      onClick={onChange}
      style={{
        display: 'flex', alignItems: 'flex-start', gap: 10,
        padding: 12, borderRadius: 10, cursor: 'pointer',
        border: checked ? '1.5px solid #6c63ff' : '1px solid #e5e7eb',
        background: checked ? '#f5f4ff' : '#fff',
        transition: 'all 0.15s ease',
      }}
    >
      <input
        type="radio"
        checked={checked}
        onChange={onChange}
        style={{ marginTop: 2, accentColor: '#6c63ff', cursor: 'pointer' }}
      />
      <div>
        <div style={{ fontSize: 13, fontWeight: 600, color: '#111827' }}>{title}</div>
        <div style={{ fontSize: 12, color: '#6b7280', marginTop: 2 }}>{body}</div>
      </div>
    </label>
  );
}

// ── Style helpers ──────────────────────────────────────────────────────────
const pageWrapStyle: CSSProperties = {
  minHeight: '100vh',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  background: '#f4f4f6',
  fontFamily: "'DM Sans', system-ui, -apple-system, sans-serif",
  padding: '2rem',
};

const cardWrapStyle: CSSProperties = {
  display: 'grid',
  gridTemplateColumns: '220px 1fr',
  borderRadius: 16,
  overflow: 'hidden',
  border: '1px solid #e4e4e7',
  background: '#fff',
  width: '100%',
  maxWidth: 760,
  boxShadow: '0 8px 40px rgba(108,99,255,0.10)',
  minHeight: 560,
};

const sidebarStyle: CSSProperties = {
  background: '#6c63ff',
  display: 'flex',
  flexDirection: 'column',
  padding: '2rem 1.5rem',
  position: 'relative',
  overflow: 'hidden',
};

const decorCircleStyle: CSSProperties = {
  position: 'absolute',
  borderRadius: '50%',
};

const logoIconStyle: CSSProperties = {
  width: 32, height: 32,
  background: 'rgba(255,255,255,0.18)',
  borderRadius: 8,
  display: 'flex', alignItems: 'center', justifyContent: 'center',
};

const rightPanelStyle: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  padding: '2.25rem 2.25rem 1.75rem',
  background: '#fff',
};

const inputStyle: CSSProperties = {
  width: '100%',
  height: 44,
  borderRadius: 10,
  border: '1px solid #e5e7eb',
  background: '#f9fafb',
  padding: '0 14px',
  fontSize: 14,
  color: '#111827',
  fontFamily: "'DM Sans', sans-serif",
  outline: 'none',
  boxSizing: 'border-box',
};

const fieldLabelStyle: CSSProperties = {
  fontSize: 11,
  fontWeight: 600,
  color: '#6b7280',
  textTransform: 'uppercase',
  letterSpacing: '0.07em',
  display: 'flex',
  alignItems: 'center',
};

const summaryBoxStyle: CSSProperties = {
  borderRadius: 10,
  border: '1px solid #e5e7eb',
  background: '#f9fafb',
  padding: '12px 14px',
  display: 'flex',
  flexDirection: 'column',
};

const actionsRowStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  marginTop: '2rem',
  paddingTop: '1.25rem',
  borderTop: '1px solid #f0f0f0',
};

function backBtnStyle(disabled: boolean): CSSProperties {
  return {
    fontSize: 13,
    color: disabled ? '#d1d5db' : '#6b7280',
    background: 'none',
    border: '1px solid #e5e7eb',
    borderRadius: 99,
    padding: '9px 18px',
    cursor: disabled ? 'not-allowed' : 'pointer',
    fontFamily: "'DM Sans', sans-serif",
    display: 'flex',
    alignItems: 'center',
    gap: 6,
  };
}

function primaryBtnStyle(loading: boolean): CSSProperties {
  return {
    background: loading ? '#a5a0ff' : '#6c63ff',
    color: '#fff',
    border: 'none',
    borderRadius: 99,
    padding: '11px 28px',
    fontSize: 14,
    fontWeight: 600,
    cursor: loading ? 'wait' : 'pointer',
    fontFamily: "'DM Sans', sans-serif",
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    letterSpacing: '-0.01em',
  };
}

const errorBannerStyle: CSSProperties = {
  marginTop: '0.75rem',
  padding: '10px 14px',
  borderRadius: 10,
  border: '1px solid #fecaca',
  background: '#fef2f2',
  color: '#b91c1c',
  fontSize: 13,
  lineHeight: 1.4,
};
