import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useTranslation } from 'react-i18next';
import { getAdapter } from '@/data/index';
import { useAuthStore } from '@/store/auth';
import { Button } from '@/ui/button';
import { Card } from '@/ui/card';
import { useFormInvalidBanner } from '@/hooks/use-form-invalid-banner';
import { FormErrorBanner } from '@/ui/form-error-banner';
import {
  AuthShell,
  AuthField,
  AuthSubmitButton,
  GoogleButton,
  OrDivider,
  PasswordToggle,
  SafeNote,
  IconBolt,
  IconShield,
  IconChart,
  IconMail,
  IconLock,
  IconUser,
  type AuthMarketing,
} from './auth-shell';

const schema = z
  .object({
    first_name: z.string().min(1, 'First name is required'),
    last_name: z.string().min(1, 'Last name is required'),
    email: z.string().email(),
    password: z.string().min(8, 'Password must be at least 8 characters'),
    confirm_password: z.string(),
    agree: z.boolean().refine((v) => v, 'Please accept the terms to continue'),
  })
  .refine((d) => d.password === d.confirm_password, {
    message: 'Passwords do not match',
    path: ['confirm_password'],
  });
type FormValues = z.infer<typeof schema>;

// 0=weak 1=fair 2=good 3=strong
function passwordStrength(pw: string): 0 | 1 | 2 | 3 {
  let score = 0;
  if (pw.length >= 8) score++;
  if (pw.length >= 12) score++;
  if (/[A-Z]/.test(pw) && /[a-z]/.test(pw)) score++;
  if (/\d/.test(pw)) score++;
  if (/[^A-Za-z0-9]/.test(pw)) score++;
  return score <= 1 ? 0 : score === 2 ? 1 : score <= 4 ? 2 : 3;
}

const STRENGTH = [
  { key: 'strength_weak', width: '25%', bar: 'bg-danger-500', text: 'text-danger-600' },
  { key: 'strength_fair', width: '50%', bar: 'bg-warning-500', text: 'text-warning-600' },
  { key: 'strength_good', width: '75%', bar: 'bg-lime-500', text: 'text-lime-600' },
  { key: 'strength_strong', width: '100%', bar: 'bg-success-600', text: 'text-success-600' },
] as const;

export default function RegisterPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { set_session } = useAuthStore();
  const [serverError, setServerError] = useState('');
  const [emailSent, setEmailSent] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [googleLoading, setGoogleLoading] = useState(false);

  const {
    register,
    handleSubmit,
    watch,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>({ resolver: zodResolver(schema), defaultValues: { agree: false } });
  const { onInvalid, bannerMessage, clearBanner } = useFormInvalidBanner('register');

  const password = watch('password') ?? '';
  const strength = STRENGTH[passwordStrength(password)];

  async function onSubmit(values: FormValues) {
    setServerError('');
    try {
      const adapter = getAdapter();
      const { user_id } = await adapter.auth.signUp({
        email: values.email,
        password: values.password,
        first_name: values.first_name.trim(),
        last_name: values.last_name.trim(),
      });
      set_session({ user_id, email: values.email });
      setEmailSent(true);
    } catch (err) {
      setServerError(err instanceof Error ? err.message : t('auth.error.generic'));
    }
  }

  async function onGoogle() {
    setServerError('');
    setGoogleLoading(true);
    try {
      await getAdapter().auth.signInWithOAuth('google');
      // On success the browser navigates to Google; keep the spinner running.
    } catch (err) {
      setServerError(err instanceof Error ? err.message : t('auth.error.generic'));
      setGoogleLoading(false);
    }
  }

  if (emailSent) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center bg-[#ECEEF9] p-4">
        <Card className="w-full max-w-sm text-center" padding="lg">
          <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-success-50">
            <svg viewBox="0 0 24 24" fill="none" className="h-8 w-8 text-success-500" stroke="currentColor" strokeWidth="2">
              <path strokeLinecap="round" strokeLinejoin="round" d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
            </svg>
          </div>
          <h2 className="mb-2 text-xl font-semibold text-ink-primary">{t('auth.register.check_email')}</h2>
          <p className="text-sm text-ink-secondary">{t('auth.register.verify_prompt')}</p>
          <Button variant="secondary" className="mt-6 w-full" onClick={() => navigate('/login')}>
            {t('auth.register.go_to_login')}
          </Button>
        </Card>
      </div>
    );
  }

  const marketing: AuthMarketing = {
    line1: t('auth.register.heading_line1'),
    line2_pre: t('auth.register.heading_pre'),
    line2_accent: t('auth.register.heading_accent'),
    line2_post: t('auth.register.heading_post'),
    subtitle: t('auth.register.left_subtitle'),
    features: [
      { icon: <IconBolt />, title: t('auth.features.fast_title'), caption: t('auth.register.feature_fast') },
      { icon: <IconShield />, title: t('auth.features.secure_title'), caption: t('auth.register.feature_secure') },
      { icon: <IconChart />, title: t('auth.features.insights_title'), caption: t('auth.register.feature_insights') },
    ],
    quote: t('auth.register.testimonial'),
    author: t('auth.register.testimonial_author'),
  };

  return (
    <AuthShell
      marketing={marketing}
      topQuestion={t('auth.register.have_account')}
      topLinkLabel={t('auth.register.signin_link')}
      topLinkTo="/login"
    >
      <h2 className="text-center text-[26px] font-extrabold tracking-tight text-ink-primary">
        {t('auth.register.title')}
      </h2>
      <p className="mt-1.5 text-center text-sm text-ink-secondary">{t('auth.register.subtitle')}</p>

      <div className="mt-7 flex flex-col gap-5">
        <GoogleButton label={t('auth.google.signup')} onClick={onGoogle} loading={googleLoading} />
        <OrDivider label={t('auth.or')} />

        <form
          onSubmit={handleSubmit((v) => { clearBanner(); return onSubmit(v); }, onInvalid)}
          className="flex flex-col gap-4"
        >
          <FormErrorBanner message={bannerMessage} onDismiss={clearBanner} />

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <AuthField
              label={t('auth.register.first_name')}
              icon={<IconUser />}
              autoComplete="given-name"
              placeholder={t('auth.register.first_name_placeholder')}
              required
              error={errors.first_name?.message}
              {...register('first_name')}
            />
            <AuthField
              label={t('auth.register.last_name')}
              icon={<IconUser />}
              autoComplete="family-name"
              placeholder={t('auth.register.last_name_placeholder')}
              required
              error={errors.last_name?.message}
              {...register('last_name')}
            />
          </div>

          <AuthField
            label={t('auth.email')}
            icon={<IconMail />}
            type="email"
            autoComplete="email"
            placeholder={t('auth.register.email_placeholder')}
            required
            error={errors.email?.message}
            {...register('email')}
          />

          <div className="flex flex-col gap-2">
            <AuthField
              label={t('auth.password')}
              icon={<IconLock />}
              type={showPassword ? 'text' : 'password'}
              autoComplete="new-password"
              placeholder={t('auth.register.password_placeholder')}
              required
              error={errors.password?.message}
              trailing={<PasswordToggle shown={showPassword} onToggle={() => setShowPassword((s) => !s)} />}
              {...register('password')}
            />
            {password.length > 0 && (
              <div>
                <div className="h-1.5 w-full overflow-hidden rounded-full bg-border-subtle">
                  <div
                    className={`h-full rounded-full transition-all duration-300 ${strength.bar}`}
                    style={{ width: strength.width }}
                  />
                </div>
                <p className="mt-1 text-xs text-ink-secondary">
                  {t('auth.register.strength')}{' '}
                  <span className={`font-semibold ${strength.text}`}>{t(`auth.register.${strength.key}`)}</span>
                </p>
              </div>
            )}
          </div>

          <AuthField
            label={t('auth.register.confirm_password')}
            icon={<IconLock />}
            type={showConfirm ? 'text' : 'password'}
            autoComplete="new-password"
            placeholder={t('auth.register.confirm_placeholder')}
            required
            error={errors.confirm_password?.message}
            trailing={<PasswordToggle shown={showConfirm} onToggle={() => setShowConfirm((s) => !s)} />}
            {...register('confirm_password')}
          />

          <div className="flex flex-col gap-1">
            <label className="flex cursor-pointer select-none items-start gap-2 text-sm text-ink-primary">
              <input type="checkbox" className="mt-0.5 h-4 w-4 rounded accent-brand-500" {...register('agree')} />
              <span>
                {t('auth.register.agree_pre')}{' '}
                <span className="font-medium text-brand-500">{t('auth.register.terms')}</span>{' '}
                {t('auth.register.and')}{' '}
                <span className="font-medium text-brand-500">{t('auth.register.privacy')}</span>
              </span>
            </label>
            {errors.agree && <p className="text-xs text-danger-600">{errors.agree.message}</p>}
          </div>

          {serverError && (
            <p className="rounded-lg bg-danger-50 px-3 py-2 text-sm text-danger-600">{serverError}</p>
          )}

          <AuthSubmitButton loading={isSubmitting}>{t('auth.register.submit')}</AuthSubmitButton>
        </form>

        <SafeNote text={t('auth.safe_note')} />
      </div>
    </AuthShell>
  );
}
