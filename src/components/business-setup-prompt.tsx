/**
 * Business setup prompt — a company with no saved business configuration runs
 * with EVERY module on (legacy mode), whatever it actually does: companies
 * made before the Global wizard, from an older app build, or whose wizard save
 * failed. Admins are asked to choose their activities so StockBolt switches on
 * only what the business needs. Hidden once a configuration is saved; "Not
 * now" hides it for the rest of this browser session.
 */
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Sparkles } from 'lucide-react';
import { getAdapter } from '@/data/index';
import { useAuthStore } from '@/store/auth';
import { hasPerm } from '@/lib/permissions';
import { GLOBAL_ONBOARDING } from '@/core/global-config/flag';

export function BusinessSetupPrompt() {
  const { t } = useTranslation();
  const { company_id, role, permissions } = useAuthStore();
  const canWrite = hasPerm(role, permissions, 'settings.write');
  const key = `stockbolt.setup-prompt.hidden.${company_id ?? ''}`;
  const [hidden, setHidden] = useState(() => {
    try { return sessionStorage.getItem(key) === '1'; } catch { return false; }
  });
  // Same cached query as useEnabledModules. Only a successful read that found
  // nothing counts as "not set up" — a failed read must never nag.
  const { data, isSuccess } = useQuery({
    queryKey: ['company_configuration', company_id],
    queryFn: () => getAdapter().companyConfiguration.get(company_id!),
    enabled: !!company_id && GLOBAL_ONBOARDING && canWrite,
    staleTime: 5 * 60 * 1000,
  });

  if (!GLOBAL_ONBOARDING || !canWrite || hidden || !isSuccess || data) return null;

  const dismiss = () => {
    try { sessionStorage.setItem(key, '1'); } catch { /* private mode: hide for this view only */ }
    setHidden(true);
  };

  return (
    <section className="sb-card sb-setup-prompt" data-testid="business-setup-prompt" role="status">
      <span className="sb-setup-prompt-ico" aria-hidden="true"><Sparkles size={20} /></span>
      <div className="sb-setup-prompt-text">
        <strong>{t('setupPrompt.title')}</strong>
        <span>{t('setupPrompt.body')}</span>
      </div>
      <div className="sb-setup-prompt-actions">
        <Link to="/settings/business-configuration" className="sb-primary-btn sb-btn-inline" data-testid="business-setup-start">
          {t('setupPrompt.start')}
        </Link>
        <button type="button" className="sb-setup-prompt-later" onClick={dismiss}>{t('setupPrompt.later')}</button>
      </div>
    </section>
  );
}
