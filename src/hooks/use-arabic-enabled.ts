import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { useAuthStore } from '@/store/auth';
import { useCompanyCountry } from '@/hooks/use-company-currency';

/**
 * Arabic is offered to GCC companies; a company registered in India works in
 * English only. Based on the company's registered country (companies.
 * country_code). Before a company exists, or while it is still loading, the
 * answer is "yes" so GCC users never lose Arabic for a moment.
 *
 * Used to hide the language switch and the Arabic-only form fields
 * (name in Arabic, Arabic address, Arabic footer…). Data already stored in
 * those fields is left untouched — it is only not offered for editing.
 */
export function useArabicEnabled(): boolean {
  const country = useCompanyCountry();
  return country !== 'IN';
}

/**
 * For an India company, switch the interface back to English if Arabic is
 * still selected (e.g. remembered from an earlier session). Mounted once in
 * the app shell.
 */
export function useEnglishOnlyWhenArabicDisabled(): void {
  const arabicEnabled = useArabicEnabled();
  const { i18n } = useTranslation();
  const language = useAuthStore((s) => s.language);
  const setLanguage = useAuthStore((s) => s.set_language);
  useEffect(() => {
    if (arabicEnabled) return;
    if (language !== 'en') setLanguage('en');
    if (i18n.language !== 'en') void i18n.changeLanguage('en');
  }, [arabicEnabled, language, setLanguage, i18n]);
}
