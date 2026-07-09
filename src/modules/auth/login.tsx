import { useState } from 'react';
import { Link, useNavigate, useLocation } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useTranslation } from 'react-i18next';
import { getAdapter } from '@/data/index';
import { useAuthStore } from '@/store/auth';
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
  IconCloud,
  type AuthMarketing,
} from './auth-shell';

const schema = z.object({
  email: z.string().email(),
  password: z.string().min(6),
});
type FormValues = z.infer<typeof schema>;

// "Remember me" = remember the email for next visit. Sessions themselves are
// always persisted by Supabase; this only prefills the email field.
const REMEMBER_KEY = 'stockbolt.auth.remembered_email';

export default function LoginPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const location = useLocation();
  const { set_session, set_profile, set_onboarded } = useAuthStore();
  const [serverError, setServerError] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [remember, setRemember] = useState(true);
  const [googleLoading, setGoogleLoading] = useState(false);

  const from = (location.state as { from?: { pathname: string } })?.from?.pathname ?? '/dashboard';

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: { email: localStorage.getItem(REMEMBER_KEY) ?? '' },
  });
  const { onInvalid, bannerMessage, clearBanner } = useFormInvalidBanner('login');

  async function onSubmit(values: FormValues) {
    setServerError('');
    try {
      const adapter = getAdapter();
      const { user_id } = await adapter.auth.signIn(values);
      if (remember) localStorage.setItem(REMEMBER_KEY, values.email);
      else localStorage.removeItem(REMEMBER_KEY);

      const session = await adapter.auth.getSession();
      if (session) set_session({ user_id, email: session.email });

      const profile = await adapter.profiles.getCurrent();
      if (profile) {
        set_profile({ company_id: profile.company_id, role: profile.role });
        set_onboarded(true);
        navigate(from, { replace: true });
      } else {
        set_onboarded(false);
        navigate('/setup', { replace: true });
      }
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

  const marketing: AuthMarketing = {
    line1: t('auth.login.heading_line1'),
    line2_pre: t('auth.login.heading_pre'),
    line2_accent: t('auth.login.heading_accent'),
    line2_post: t('auth.login.heading_post'),
    subtitle: t('auth.login.left_subtitle'),
    features: [
      { icon: <IconBolt />, title: t('auth.features.fast_title'), caption: t('auth.login.feature_fast') },
      { icon: <IconShield />, title: t('auth.features.secure_title'), caption: t('auth.login.feature_secure') },
      { icon: <IconChart />, title: t('auth.features.insights_title'), caption: t('auth.login.feature_insights') },
    ],
    quote: t('auth.login.testimonial'),
    author: t('auth.login.testimonial_author'),
  };

  return (
    <AuthShell
      marketing={marketing}
      topQuestion={t('auth.login.new_to')}
      topLinkLabel={t('auth.login.no_account')}
      topLinkTo="/register"
    >
      <h2 className="text-center text-[26px] font-extrabold tracking-tight text-ink-primary">
        {t('auth.login.title')}
      </h2>
      <p className="mt-1.5 text-center text-sm text-ink-secondary">{t('auth.login.subtitle')}</p>

      <div className="mt-7 flex flex-col gap-5">
        <GoogleButton label={t('auth.google.continue')} onClick={onGoogle} loading={googleLoading} />
        <OrDivider label={t('auth.or')} />

        <form
          onSubmit={handleSubmit((v) => { clearBanner(); return onSubmit(v); }, onInvalid)}
          className="flex flex-col gap-4"
        >
          <FormErrorBanner message={bannerMessage} onDismiss={clearBanner} />
          <AuthField
            label={t('auth.email')}
            icon={<IconMail />}
            type="email"
            autoComplete="email"
            placeholder={t('auth.login.email_placeholder')}
            required
            error={errors.email?.message}
            {...register('email')}
          />
          <AuthField
            label={t('auth.password')}
            icon={<IconLock />}
            type={showPassword ? 'text' : 'password'}
            autoComplete="current-password"
            placeholder={t('auth.login.password_placeholder')}
            required
            error={errors.password?.message}
            trailing={<PasswordToggle shown={showPassword} onToggle={() => setShowPassword((s) => !s)} />}
            {...register('password')}
          />

          <div className="flex items-center justify-between text-sm">
            <label className="flex cursor-pointer select-none items-center gap-2 text-ink-primary">
              <input
                type="checkbox"
                checked={remember}
                onChange={(e) => setRemember(e.target.checked)}
                className="h-4 w-4 rounded accent-brand-500"
              />
              {t('auth.login.remember_me')}
            </label>
            <Link to="/forgot-password" className="font-medium text-brand-500 hover:underline">
              {t('auth.login.forgot_password')}
            </Link>
          </div>

          {serverError && (
            <p className="rounded-lg bg-danger-50 px-3 py-2 text-sm text-danger-600">{serverError}</p>
          )}

          <AuthSubmitButton loading={isSubmitting}>{t('auth.login.submit')}</AuthSubmitButton>
        </form>

        {/* Trust strip */}
        <div className="mt-2 flex items-center gap-4" aria-hidden="true">
          <span className="h-px flex-1 bg-border-subtle" />
          <span className="text-xs font-medium text-ink-secondary">{t('auth.login.secure_login')}</span>
          <span className="h-px flex-1 bg-border-subtle" />
        </div>
        <div className="flex items-start justify-around text-center">
          {[
            { icon: <IconShield className="h-5 w-5" />, label: t('auth.login.badge_ssl') },
            { icon: <IconLock className="h-5 w-5" />, label: t('auth.login.badge_auth') },
            { icon: <IconCloud className="h-5 w-5" />, label: t('auth.login.badge_protected') },
          ].map((b) => (
            <div key={b.label} className="flex w-28 flex-col items-center gap-1.5 text-ink-tertiary">
              {b.icon}
              <span className="text-[11px] leading-tight text-ink-secondary">{b.label}</span>
            </div>
          ))}
        </div>

        <SafeNote text={t('auth.safe_note')} />
      </div>
    </AuthShell>
  );
}
