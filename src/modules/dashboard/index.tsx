import { useTranslation } from 'react-i18next';
import { useAuthStore } from '@/store/auth';
import { LanguageToggle } from '@/components/language-toggle';
import { getAdapter } from '@/data/index';
import { useNavigate } from 'react-router-dom';
import { Button } from '@/ui/button';

export default function DashboardPage() {
  const { t } = useTranslation();
  const { email, clear } = useAuthStore();
  const navigate = useNavigate();

  async function handleSignOut() {
    await getAdapter().auth.signOut();
    clear();
    navigate('/login', { replace: true });
  }

  return (
    <div className="min-h-screen bg-surface-page">
      <header className="flex items-center justify-between border-b border-border-subtle bg-surface-card px-6 py-4">
        <div className="flex items-center gap-3">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-brand-500">
            <svg viewBox="0 0 24 24" fill="white" className="h-5 w-5">
              <path d="M13 2 3 14h7l-1 8 10-12h-7l1-8z" />
            </svg>
          </div>
          <span className="font-semibold text-ink-primary">StockBolt</span>
        </div>
        <div className="flex items-center gap-3">
          <LanguageToggle />
          <span className="text-sm text-ink-secondary">{email}</span>
          <Button variant="ghost" size="sm" onClick={handleSignOut}>
            {t('common.sign_out')}
          </Button>
        </div>
      </header>

      <main className="flex flex-col items-center justify-center py-24 text-center">
        <div className="mb-4 text-4xl">⚡</div>
        <h1 className="mb-2 text-2xl font-bold text-ink-primary">{t('dashboard.title')}</h1>
        <p className="text-ink-secondary">{t('dashboard.phase_note')}</p>
      </main>
    </div>
  );
}
