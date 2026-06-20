import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Card } from '@/ui/card';
import { Button } from '@/ui/button';

/**
 * Shown after the user clicks the verification link in their email (Supabase
 * redirects here via emailRedirectTo = /verify-email). A clear success image +
 * message so they know the email was confirmed — previously they landed with
 * no confirmation at all.
 */
export default function EmailVerificationPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-surface-page p-4">
      <Card className="w-full max-w-md text-center" padding="lg">
        {/* Success illustration */}
        <svg viewBox="0 0 120 120" className="mx-auto mb-5 h-28 w-28" role="img" aria-label="Email verified">
          <circle cx="60" cy="60" r="56" fill="#ecfdf5" />
          <circle cx="60" cy="60" r="56" fill="none" stroke="#a7f3d0" strokeWidth="2" />
          {/* envelope */}
          <rect x="34" y="44" width="52" height="36" rx="5" fill="#fff" stroke="#10b981" strokeWidth="2.5" />
          <path d="M36 47l24 18 24-18" fill="none" stroke="#10b981" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
          {/* check badge */}
          <circle cx="84" cy="80" r="18" fill="#10b981" />
          <path d="M76 80.5l5.5 5.5L93 75" fill="none" stroke="#fff" strokeWidth="3.4" strokeLinecap="round" strokeLinejoin="round" />
        </svg>

        <h2 className="mb-2 text-2xl font-bold text-ink-primary">
          {t('auth.verification.title')}
        </h2>
        <p className="text-sm text-ink-secondary">{t('auth.verification.description')}</p>

        <Button className="mt-7 w-full" onClick={() => navigate('/dashboard')}>
          {t('auth.verification.continue') || 'Continue to StockBolt'}
        </Button>
        <button
          type="button"
          onClick={() => navigate('/login')}
          className="mt-3 text-sm text-brand-600 hover:text-brand-700"
        >
          {t('common.back_to_login')}
        </button>
      </Card>
    </div>
  );
}
