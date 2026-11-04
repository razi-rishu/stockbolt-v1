/**
 * ModuleGate — Global v1 route gating. Wraps every authenticated page (see
 * WithAppLayout in App.tsx), so a bookmarked or typed URL into a disabled
 * module is refused the same way the sidebar hides it.
 *
 * Read views of existing records (`<area>/<uuid>`) stay open: turning a module
 * off never hides the documents it already produced. Paths no module owns
 * (dashboard, settings, financial reports) are never gated.
 */
import type { ReactNode } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Card } from '@/ui/card';
import { getModule, moduleForPath, pathAccess } from '@/core/global-config';
import { useEnabledModules } from '@/hooks/use-enabled-modules';

export function ModuleGate({ children }: { children: ReactNode }) {
  const { t, i18n } = useTranslation();
  const { pathname } = useLocation();
  const { ready, modules } = useEnabledModules();
  const owner = moduleForPath(pathname);

  // Unowned paths render at once; owned ones wait for the configuration so a
  // disabled page never flashes before it is refused.
  if (!owner) return <>{children}</>;
  if (!ready) return <p className="p-4 text-sm text-ink-secondary">{t('global_config.gate.loading')}</p>;
  if (pathAccess(pathname, modules) !== 'module_disabled') return <>{children}</>;

  const name = getModule(owner.module)[i18n.language === 'ar' ? 'name_ar' : 'name'];
  return (
    <Card padding="md" data-testid="module-disabled" className="mx-auto max-w-xl space-y-3">
      <h1 className="text-lg font-semibold text-ink-primary">{t('global_config.gate.title')}</h1>
      <p className="text-sm text-ink-secondary">{t('global_config.gate.body', { module: name })}</p>
      <Link to="/dashboard" className="inline-block rounded-pill bg-brand-500 px-4 py-2 text-sm text-white">
        {t('global_config.gate.back')}
      </Link>
    </Card>
  );
}
