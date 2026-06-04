import { useState } from 'react';
import { Link, useNavigate, useLocation } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useTranslation } from 'react-i18next';
import { getAdapter } from '@/data/index';
import { useAuthStore } from '@/store/auth';
import { Button } from '@/ui/button';
import { Input } from '@/ui/input';
import { Card } from '@/ui/card';
import { LanguageToggle } from '@/components/language-toggle';
import { useFormInvalidBanner } from '@/hooks/use-form-invalid-banner';
import { FormErrorBanner } from '@/ui/form-error-banner';

const schema = z.object({
  email: z.string().email(),
  password: z.string().min(6),
});
type FormValues = z.infer<typeof schema>;

export default function LoginPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const location = useLocation();
  const { set_session, set_profile, set_onboarded } = useAuthStore();
  const [serverError, setServerError] = useState('');

  const from = (location.state as { from?: { pathname: string } })?.from?.pathname ?? '/dashboard';

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>({ resolver: zodResolver(schema) });
  const { onInvalid, bannerMessage, clearBanner } = useFormInvalidBanner('login');

  async function onSubmit(values: FormValues) {
    setServerError('');
    try {
      const adapter = getAdapter();
      const { user_id } = await adapter.auth.signIn(values);
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

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-surface-page p-4">
      <div className="mb-6 flex w-full max-w-sm justify-end">
        <LanguageToggle />
      </div>

      <div className="mb-8 flex flex-col items-center gap-2">
        <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-brand-500">
          <svg viewBox="0 0 24 24" fill="white" className="h-7 w-7">
            <path d="M13 2 3 14h7l-1 8 10-12h-7l1-8z" />
          </svg>
        </div>
        <h1 className="text-2xl font-bold text-ink-primary">StockBolt</h1>
      </div>

      <Card className="w-full max-w-sm" padding="lg">
        <h2 className="mb-6 text-xl font-semibold text-ink-primary">{t('auth.login.title')}</h2>

        <form onSubmit={handleSubmit((v) => { clearBanner(); return onSubmit(v); }, onInvalid)} className="flex flex-col gap-4">
          <FormErrorBanner message={bannerMessage} onDismiss={clearBanner} />
          <Input
            label={t('auth.email')}
            type="email"
            autoComplete="email"
            required
            error={errors.email?.message}
            {...register('email')}
          />
          <Input
            label={t('auth.password')}
            type="password"
            autoComplete="current-password"
            required
            error={errors.password?.message}
            {...register('password')}
          />

          {serverError && (
            <p className="rounded-lg bg-danger-50 px-3 py-2 text-sm text-danger-600">
              {serverError}
            </p>
          )}

          <Button type="submit" loading={isSubmitting} className="mt-2 w-full">
            {t('auth.login.submit')}
          </Button>
        </form>

        <div className="mt-4 flex justify-between text-sm">
          <Link to="/forgot-password" className="text-brand-500 hover:underline">
            {t('auth.login.forgot_password')}
          </Link>
          <Link to="/register" className="text-brand-500 hover:underline">
            {t('auth.login.no_account')}
          </Link>
        </div>
      </Card>
    </div>
  );
}
