import { useTranslation } from 'react-i18next';
import { useAuthStore } from '@/store/auth';

/** Toggles between English and Arabic and flips document direction. */
export function LanguageToggle({ className = '' }: { className?: string }) {
  const { i18n } = useTranslation();
  const { language, set_language } = useAuthStore();

  function toggle() {
    const next = language === 'en' ? 'ar' : 'en';
    set_language(next);
    i18n.changeLanguage(next);
  }

  return (
    <button
      onClick={toggle}
      className={`rounded-pill border border-border-strong px-3 py-1 text-sm font-medium text-ink-secondary hover:bg-surface-muted ${className}`}
      aria-label="Toggle language"
    >
      {language === 'en' ? 'عربي' : 'English'}
    </button>
  );
}
