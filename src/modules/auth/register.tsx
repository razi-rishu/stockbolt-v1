import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
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

const schema = z
  .object({
    email: z.string().email(),
    password: z.string().min(8, 'Password must be at least 8 characters'),
    confirm_password: z.string(),
  })
  .refine((d) => d.password === d.confirm_password, {
    message: 'Passwords do not match',
    path: ['confirm_password'],
  });
type FormValues = z.infer<typeof schema>;

export default function RegisterPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { set_session } = useAuthStore();
  const [serverError, setServerError] = useState('');
  const [emailSent, setEmailSent] = useState(false);

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>({ resolver: zodResolver(schema) });
  const { onInvalid, bannerMessage, clearBanner } = useFormInvalidBanner('register');

  async function onSubmit(values: FormValues) {
    setServerError('');
    try {
      const adapter = getAdapter();
      const { user_id } = await adapter.auth.signUp({
        email: values.email,
        password: values.password,
      });
      set_session({ user_id, email: values.email });
      setEmailSent(true);
    } catch (err) {
      setServerError(err instanceof Error ? err.message : t('auth.error.generic'));
    }
  }

  if (emailSent) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center bg-surface-page p-4">
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
        <h2 className="mb-6 text-xl font-semibold text-ink-primary">{t('auth.register.title')}</h2>

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
            autoComplete="new-password"
            required
            error={errors.password?.message}
            {...register('password')}
          />
          <Input
            label={t('auth.register.confirm_password')}
            type="password"
            autoComplete="new-password"
            required
            error={errors.confirm_password?.message}
            {...register('confirm_password')}
          />

          {serverError && (
            <p className="rounded-lg bg-danger-50 px-3 py-2 text-sm text-danger-600">
              {serverError}
            </p>
          )}

          <Button type="submit" loading={isSubmitting} className="mt-2 w-full">
            {t('auth.register.submit')}
          </Button>
        </form>

        <p className="mt-4 text-center text-sm text-ink-secondary">
          {t('auth.register.have_account')}{' '}
          <Link to="/login" className="text-brand-500 hover:underline">
            {t('auth.login.submit')}
          </Link>
        </p>
      </Card>
    </div>
  );
}
