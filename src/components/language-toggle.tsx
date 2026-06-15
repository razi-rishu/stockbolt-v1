import { useTranslation } from 'react-i18next';
import { useAuthStore } from '@/store/auth';

/** Toggles between English and Arabic and flips document direction.
 *  variant="dark" renders white-on-transparent for the dark top nav. */
export function LanguageToggle({ className = '', variant = 'light' }: { className?: string; variant?: 'light' | 'dark' }) {
  const { i18n } = useTranslation();
  const { language, set_language } = useAuthStore();

  function toggle() {
    const next = language === 'en' ? 'ar' : 'en';
    set_language(next);
    i18n.changeLanguage(next);
  }

  const look = variant === 'dark'
    ? 'border-white/25 text-white/80 hover:bg-white/10 hover:text-white'
    : 'border-border-strong text-ink-secondary hover:bg-surface-muted';

  return (
    <button
      onClick={toggle}
      className={`rounded-pill border px-3 py-1 text-sm font-medium transition-colors ${look} ${className}`}
      aria-label="Toggle language"
    >
      {language === 'en' ? 'عربي' : 'English'}
    </button>
  );
}
