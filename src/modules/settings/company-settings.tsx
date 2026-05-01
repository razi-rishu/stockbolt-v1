import { useEffect, useRef, useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useTranslation } from 'react-i18next';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { getAdapter } from '@/data/index';
import { useAuthStore } from '@/store/auth';
import { Button } from '@/ui/button';
import { Input } from '@/ui/input';
import { Card } from '@/ui/card';

// Defaults live in useForm defaultValues; schema only validates.
const schema = z.object({
  name:              z.string().min(2, 'Required'),
  name_ar:           z.string(),
  address:           z.string(),
  is_tax_registered: z.boolean(),
  tax_id:            z.string(),
});
type FormValues = z.infer<typeof schema>;

export default function CompanySettingsPage() {
  const { t } = useTranslation();
  const { company_id } = useAuthStore();
  const queryClient = useQueryClient();
  const fileRef = useRef<HTMLInputElement>(null);
  const [logoUrl, setLogoUrl] = useState<string | null>(null);
  const [logoUploading, setLogoUploading] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);

  const { data: company, isLoading } = useQuery({
    queryKey: ['company', company_id],
    queryFn: () => getAdapter().companies.getById(company_id!),
    enabled: !!company_id,
  });

  const {
    register,
    reset,
    watch,
    handleSubmit,
    formState: { errors, isDirty, isSubmitting },
  } = useForm<FormValues>({ resolver: zodResolver(schema) });

  useEffect(() => {
    if (company) {
      reset({
        name: company.name,
        name_ar: company.name_ar ?? '',
        address: company.address ?? '',
        is_tax_registered: company.is_tax_registered,
        tax_id: company.tax_id ?? '',
      });
      setLogoUrl(company.logo_url);
    }
  }, [company, reset]);

  const saveMutation = useMutation({
    mutationFn: (values: FormValues) =>
      getAdapter().companies.update(company_id!, {
        name: values.name,
        name_ar: values.name_ar || null,
        address: values.address || null,
        is_tax_registered: values.is_tax_registered,
        tax_id: values.tax_id || null,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['company', company_id] });
      setSaveSuccess(true);
      setTimeout(() => setSaveSuccess(false), 3000);
    },
  });

  async function onSubmit(values: FormValues) {
    await saveMutation.mutateAsync(values);
  }

  async function handleLogoUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file || !company_id) return;

    const allowedTypes = ['image/jpeg', 'image/png', 'image/webp', 'image/svg+xml'];
    if (!allowedTypes.includes(file.type)) {
      alert(t('settings.company.logo_type_error'));
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      alert(t('settings.company.logo_size_error'));
      return;
    }

    setLogoUploading(true);
    try {
      const url = await getAdapter().companies.uploadLogo(company_id, file);
      await getAdapter().companies.update(company_id, { logo_url: url });
      setLogoUrl(url);
      queryClient.invalidateQueries({ queryKey: ['company', company_id] });
    } finally {
      setLogoUploading(false);
    }
  }

  const is_tax_registered = watch('is_tax_registered');

  if (isLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div className="h-6 w-6 animate-spin rounded-full border-2 border-brand-500 border-t-transparent" />
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-2xl px-4 py-8">
      <h1 className="mb-6 text-2xl font-bold text-ink-primary">{t('settings.company.title')}</h1>

      {/* Logo upload */}
      <Card className="mb-6">
        <h2 className="mb-4 text-base font-semibold text-ink-primary">{t('settings.company.logo')}</h2>
        <div className="flex items-center gap-4">
          <div className="flex h-20 w-20 items-center justify-center overflow-hidden rounded-card border border-border-subtle bg-surface-muted">
            {logoUrl ? (
              <img src={logoUrl} alt="Company logo" className="h-full w-full object-contain" />
            ) : (
              <svg viewBox="0 0 24 24" fill="none" className="h-8 w-8 text-ink-tertiary" stroke="currentColor" strokeWidth="1.5">
                <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 15.75l5.159-5.159a2.25 2.25 0 013.182 0l5.159 5.159m-1.5-1.5l1.409-1.409a2.25 2.25 0 013.182 0l2.909 2.909M13.5 12h.008v.008H13.5V12zm4.5 9H6a2.25 2.25 0 01-2.25-2.25V7.5A2.25 2.25 0 016 5.25h12A2.25 2.25 0 0120.25 7.5v11.25A2.25 2.25 0 0118 21z" />
              </svg>
            )}
          </div>
          <div>
            <Button
              variant="secondary"
              size="sm"
              loading={logoUploading}
              onClick={() => fileRef.current?.click()}
            >
              {t('settings.company.upload_logo')}
            </Button>
            <p className="mt-1 text-xs text-ink-tertiary">{t('settings.company.logo_hint')}</p>
            <input
              ref={fileRef}
              type="file"
              accept="image/jpeg,image/png,image/webp,image/svg+xml"
              className="hidden"
              onChange={handleLogoUpload}
            />
          </div>
        </div>
      </Card>

      {/* Company details form */}
      <Card>
        <form onSubmit={handleSubmit(onSubmit)} className="flex flex-col gap-4">
          <h2 className="text-base font-semibold text-ink-primary">{t('settings.company.details')}</h2>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Input
              label={t('settings.company.name')}
              required
              error={errors.name?.message}
              {...register('name')}
            />
            <Input
              label={t('settings.company.name_ar')}
              dir="rtl"
              error={errors.name_ar?.message}
              {...register('name_ar')}
            />
          </div>

          <Input
            label={t('settings.company.address')}
            error={errors.address?.message}
            {...register('address')}
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
              placeholder="TRN / GSTIN"
              error={errors.tax_id?.message}
              {...register('tax_id')}
            />
          )}

          {saveSuccess && (
            <p className="rounded-lg bg-success-50 px-3 py-2 text-sm text-success-600">
              {t('common.saved')}
            </p>
          )}

          {saveMutation.error && (
            <p className="rounded-lg bg-danger-50 px-3 py-2 text-sm text-danger-600">
              {saveMutation.error instanceof Error
                ? saveMutation.error.message
                : t('common.error')}
            </p>
          )}

          <div className="flex justify-end gap-3 pt-2">
            <Button
              type="button"
              variant="secondary"
              onClick={() => reset()}
              disabled={!isDirty}
            >
              {t('common.cancel')}
            </Button>
            <Button type="submit" loading={isSubmitting} disabled={!isDirty}>
              {t('common.save')}
            </Button>
          </div>
        </form>
      </Card>
    </div>
  );
}
