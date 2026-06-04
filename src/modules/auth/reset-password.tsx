import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useTranslation } from 'react-i18next';
import { getAdapter } from '@/data/index';
import { Button } from '@/ui/button';
import { Input } from '@/ui/input';
import { Card } from '@/ui/card';
import { useFormInvalidBanner } from '@/hooks/use-form-invalid-banner';
import { FormErrorBanner } from '@/ui/form-error-banner';

const schema = z
  .object({
    password: z.string().min(8, 'Password must be at least 8 characters'),
    confirm_password: z.string(),
  })
  .refine((d) => d.password === d.confirm_password, {
    message: 'Passwords do not match',
    path: ['confirm_password'],
  });
type FormValues = z.infer<typeof schema>;

export default function ResetPasswordPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [serverError, setServerError] = useState('');

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>({ resolver: zodResolver(schema) });
  const { onInvalid, bannerMessage, clearBanner } = useFormInvalidBanner('reset-password');

  async function onSubmit(values: FormValues) {
    setServerError('');
    try {
      await getAdapter().auth.updatePassword(values.password);
      navigate('/login', { replace: true });
    } catch (err) {
      setServerError(err instanceof Error ? err.message : t('auth.error.generic'));
    }
  }

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-surface-page p-4">
      <Card className="w-full max-w-sm" padding="lg">
        <h2 className="mb-6 text-xl font-semibold text-ink-primary">{t('auth.reset.title')}</h2>

        <form onSubmit={handleSubmit((v) => { clearBanner(); return onSubmit(v); }, onInvalid)} className="flex flex-col gap-4">
          <FormErrorBanner message={bannerMessage} onDismiss={clearBanner} />
          <Input
            label={t('auth.reset.new_password')}
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

          <Button type="submit" loading={isSubmitting} className="w-full">
            {t('auth.reset.submit')}
          </Button>
        </form>
      </Card>
    </div>
  );
}
