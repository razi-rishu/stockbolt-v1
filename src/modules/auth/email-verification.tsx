import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Card } from '@/ui/card';
import { Button } from '@/ui/button';

export default function EmailVerificationPage() {
  const { t } = useTranslation();

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-surface-page p-4">
      <Card className="w-full max-w-sm text-center" padding="lg">
        <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-brand-50">
          <svg viewBox="0 0 24 24" fill="none" className="h-8 w-8 text-brand-500" stroke="currentColor" strokeWidth="1.5">
            <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
        </div>
        <h2 className="mb-2 text-xl font-semibold text-ink-primary">
          {t('auth.verification.title')}
        </h2>
        <p className="text-sm text-ink-secondary">{t('auth.verification.description')}</p>
        <Link to="/login">
          <Button className="mt-6 w-full">{t('common.back_to_login')}</Button>
        </Link>
      </Card>
    </div>
  );
}
