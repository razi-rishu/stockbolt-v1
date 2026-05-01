import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useTranslation } from 'react-i18next';
import { getAdapter } from '@/data/index';
import { Button } from '@/ui/button';
import { Input } from '@/ui/input';
import { Card } from '@/ui/card';

const schema = z.object({ email: z.string().email() });
type FormValues = z.infer<typeof schema>;

export default function ForgotPasswordPage() {
  const { t } = useTranslation();
  const [sent, setSent] = useState(false);
  const [serverError, setServerError] = useState('');

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>({ resolver: zodResolver(schema) });

  async function onSubmit(values: FormValues) {
    setServerError('');
    try {
      await getAdapter().auth.sendPasswordResetEmail(values.email);
      setSent(true);
    } catch {
      // Generic message to avoid email enumeration (AGENTS.md §12)
      setSent(true);
    }
  }

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-surface-page p-4">
      <Card className="w-full max-w-sm" padding="lg">
        <h2 className="mb-2 text-xl font-semibold text-ink-primary">
          {t('auth.forgot.title')}
        </h2>
        <p className="mb-6 text-sm text-ink-secondary">{t('auth.forgot.description')}</p>

        {sent ? (
          <>
            <p className="mb-4 rounded-lg bg-success-50 px-3 py-2 text-sm text-success-600">
              {t('auth.forgot.sent')}
            </p>
            <Link to="/login">
              <Button variant="secondary" className="w-full">
                {t('common.back_to_login')}
              </Button>
            </Link>
          </>
        ) : (
          <form onSubmit={handleSubmit(onSubmit)} className="flex flex-col gap-4">
            <Input
              label={t('auth.email')}
              type="email"
              autoComplete="email"
              required
              error={errors.email?.message}
              {...register('email')}
            />

            {serverError && (
              <p className="rounded-lg bg-danger-50 px-3 py-2 text-sm text-danger-600">
                {serverError}
              </p>
            )}

            <Button type="submit" loading={isSubmitting} className="w-full">
              {t('auth.forgot.submit')}
            </Button>

            <Link to="/login" className="text-center text-sm text-brand-500 hover:underline">
              {t('common.back_to_login')}
            </Link>
          </form>
        )}
      </Card>
    </div>
  );
}
