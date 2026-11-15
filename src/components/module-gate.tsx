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
import { Lock, PowerOff } from 'lucide-react';
import { OceanNotice } from '@/components/ocean-notice';
import { getModule, moduleForPath, pathAccess } from '@/core/global-config';
import { useEnabledModules } from '@/hooks/use-enabled-modules';
import { useBranchRestricted } from '@/hooks/use-branch-restricted';

/** global06 (B2): company-wide financial areas. A branch-restricted user is
 *  refused their data by the database; this says so instead of showing zeros. */
const COMPANY_WIDE_FINANCE = ['/reports', '/accounting', '/banking'];

export function ModuleGate({ children }: { children: ReactNode }) {
  const { t, i18n } = useTranslation();
  const { pathname } = useLocation();
  const { ready, modules } = useEnabledModules();
  const branch = useBranchRestricted();
  const owner = moduleForPath(pathname);

  if (branch.restricted && COMPANY_WIDE_FINANCE.some((p) => pathname === p || pathname.startsWith(p + '/'))) {
    return (
      <OceanNotice
        testid="branch-restricted" tone="warn" icon={<Lock size={22} />}
        title={t('global_config.branch_access.report_title')}
        actions={<Link to="/dashboard" className="sb-primary-btn sb-btn-inline">{t('global_config.gate.back')}</Link>}
      >
        {t('global_config.branch_access.report_body')}
      </OceanNotice>
    );
  }

  // Unowned paths render at once; owned ones wait for the configuration so a
  // disabled page never flashes before it is refused.
  if (!owner) return <>{children}</>;
  if (!ready) return <div className="sb-ocean sb-notice-wrap"><p className="sb-notice-loading">{t('global_config.gate.loading')}</p></div>;
  if (pathAccess(pathname, modules) !== 'module_disabled') return <>{children}</>;

  const name = getModule(owner.module)[i18n.language === 'ar' ? 'name_ar' : 'name'];
  return (
    <OceanNotice
      testid="module-disabled" icon={<PowerOff size={22} />}
      title={t('global_config.gate.title')}
      actions={<Link to="/dashboard" className="sb-primary-btn sb-btn-inline">{t('global_config.gate.back')}</Link>}
    >
      {t('global_config.gate.body', { module: name })}
    </OceanNotice>
  );
}
