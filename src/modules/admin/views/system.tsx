/**
 * Control Center — System health (phase142). Shows only what is genuinely
 * measured (phase20 get_admin_dashboard) and lists, plainly, what is not
 * instrumented yet — no estimated or invented figures.
 */
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { CheckCircle2, CircleSlash } from 'lucide-react';
import { getAdapter } from '@/data/index';
import type { AdminDashboard } from '@/data/adapter';
import { fmtInt } from '../admin-charts';

function fmtBytes(b: number): string {
  const n = Number(b ?? 0);
  if (n <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.min(units.length - 1, Math.floor(Math.log(n) / Math.log(1024)));
  return `${(n / Math.pow(1024, i)).toFixed(i === 0 ? 0 : 2)} ${units[i]}`;
}

// Literal keys so the i18n key test sees every one.
const MISSING = ['adminCC.miss_failed_logins', 'adminCC.miss_errors', 'adminCC.miss_uptime', 'adminCC.miss_api', 'adminCC.miss_email'] as const;

export function SystemView() {
  const { t } = useTranslation();
  const { data: d, isLoading, isError, error } = useQuery<AdminDashboard>({
    queryKey: ['admin_dashboard'],
    queryFn: () => getAdapter().admin.getDashboard(),
    refetchOnWindowFocus: false,
  });
  return (
    <div className="sb-adm" data-testid="admin-system">
      {isLoading && <div className="sb-card sb-adm-panel"><p className="sb-adm-empty">{t('adminOcean.loading')}</p></div>}
      {isError && <p className="sb-alert sb-alert-danger" role="alert">{String((error as Error)?.message ?? t('adminOcean.load_failed'))}</p>}
      {d && (
        <section className="sb-card sb-adm-panel">
          <h2 className="sb-adm-h">{t('adminCC.measured')}</h2>
          <div className="sb-adm-mini">
            <div className="sb-adm-mini-tile"><span>{t('adminOcean.db_usage')}</span><b dir="ltr">{fmtBytes(d.database_bytes)}</b></div>
            <div className="sb-adm-mini-tile"><span>{t('adminOcean.storage_usage')}</span><b dir="ltr">{fmtBytes(d.storage_bytes)}</b></div>
            <div className="sb-adm-mini-tile"><span>{t('adminOcean.total_invoices')}</span><b dir="ltr">{fmtInt(d.total_invoices)}</b></div>
            <div className="sb-adm-mini-tile"><span>{t('adminOcean.total_products')}</span><b dir="ltr">{fmtInt(d.total_products)}</b></div>
            <div className="sb-adm-mini-tile"><span>{t('adminOcean.total_users')}</span><b dir="ltr">{fmtInt(d.total_users)}</b></div>
          </div>
          <p className="sb-adm-foot"><CheckCircle2 size={14} className="sb-adm-ok" aria-hidden="true" /> {t('adminCC.measured_note')}</p>
        </section>
      )}
      <section className="sb-card sb-adm-panel">
        <h2 className="sb-adm-h">{t('adminCC.not_measured')}</h2>
        <p className="sb-adm-hint">{t('adminCC.not_measured_hint')}</p>
        <ul className="sb-adm-missing">
          {MISSING.map((k) => <li key={k}><CircleSlash size={15} aria-hidden="true" /><span>{t(k)}</span></li>)}
        </ul>
      </section>
    </div>
  );
}
