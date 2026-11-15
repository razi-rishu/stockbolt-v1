/**
 * StockBolt Admin — platform-owner dashboard (cross-tenant).
 *
 * Reached only via the /admin route, which is guarded by RequirePlatformAdmin.
 * All data comes from the get_admin_dashboard RPC, which itself refuses any
 * caller that isn't in platform_admins — so this is never customer-reachable.
 */
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { ShieldCheck } from 'lucide-react';
import { OceanPage } from '@/components/ocean-list';
import { ReportCard, ReportFigures, ReportMessage, ReportTable, Num, type ReportColumn, type ReportFigure } from '@/components/ocean-report';
import { BackButton } from '@/ui/back-button';
import { formatDate } from '@/lib/locale';
import { getAdapter } from '@/data/index';
import type { AdminDashboard } from '@/data/adapter';

function fmtNum(n: number): string {
  return Number(n ?? 0).toLocaleString('en-US');
}
function fmtBytes(b: number): string {
  const n = Number(b ?? 0);
  if (n <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.min(units.length - 1, Math.floor(Math.log(n) / Math.log(1024)));
  return `${(n / Math.pow(1024, i)).toFixed(i === 0 ? 0 : 2)} ${units[i]}`;
}

export default function AdminDashboardPage() {
  const { t } = useTranslation();
  const { data, isLoading, isError, error } = useQuery<AdminDashboard>({
    queryKey: ['admin_dashboard'],
    queryFn: () => getAdapter().admin.getDashboard(),
    refetchOnWindowFocus: false,
  });

  const d = data;
  const notSet = t('adminOcean.not_set');
  // Platform growth first, then volume, then infrastructure and health.
  const growth: ReportFigure[] = d ? [
    { label: t('adminOcean.total_companies'), value: <Num>{fmtNum(d.total_companies)}</Num>, tone: 'brand' },
    { label: t('adminOcean.active_companies'), value: <Num>{fmtNum(d.active_companies)}</Num>, note: t('adminOcean.active_note'), tone: 'good' },
    { label: t('adminOcean.new_registrations'), value: <Num>{fmtNum(d.new_registrations)}</Num>, note: t('adminOcean.last_30') },
    { label: t('adminOcean.total_users'), value: <Num>{fmtNum(d.total_users)}</Num> },
  ] : [];
  const volume: ReportFigure[] = d ? [
    { label: t('adminOcean.total_invoices'), value: <Num>{fmtNum(d.total_invoices)}</Num> },
    { label: t('adminOcean.total_products'), value: <Num>{fmtNum(d.total_products)}</Num> },
    { label: t('adminOcean.db_usage'), value: <Num>{fmtBytes(d.database_bytes)}</Num> },
    { label: t('adminOcean.storage_usage'), value: <Num>{fmtBytes(d.storage_bytes)}</Num> },
  ] : [];
  const health: ReportFigure[] = d ? [
    { label: t('adminOcean.failed_logins'), value: <Num>{fmtNum(d.failed_logins_30d)}</Num>, note: t('adminOcean.last_30'), tone: d.failed_logins_30d > 0 ? 'bad' : undefined },
    { label: t('adminOcean.subscription'), value: d.subscription_status ?? notSet },
    { label: t('adminOcean.error_logs'), value: d.error_logs_count == null ? notSet : <Num>{fmtNum(d.error_logs_count)}</Num> },
    { label: t('adminOcean.support_tickets'), value: d.support_tickets_open == null ? notSet : <Num>{fmtNum(d.support_tickets_open)}</Num> },
  ] : [];

  type Recent = AdminDashboard['recent_companies'][number];
  const recentCols: ReportColumn<Recent>[] = [
    { key: 'name', header: t('adminOcean.col_company'), cls: 'strong', cell: c => c.name },
    { key: 'created', header: t('adminOcean.col_registered'), cls: 'muted', cell: c => <Num>{formatDate(c.created_at)}</Num> },
    { key: 'users', header: t('adminOcean.col_users'), num: true, cell: c => fmtNum(c.users) },
  ];

  return (
    // Ocean Teal (UI v1.1): look only — same RPC and figures. Standalone
    // route (no app frame), so the wrapper supplies the page background.
    <div className="sb-ocean sb-admin-shell">
    <OceanPage
      testid="admin-dashboard-ocean"
      title={t('adminOcean.title')}
      subtitle={<>
        {t('adminOcean.subtitle')}
        {d?.generated_at && <> · <Num>{t('adminOcean.as_of', { time: d.generated_at.replace('T', ' ').replace('Z', ' UTC') })}</Num></>}
      </>}
      back={<BackButton to="/dashboard" label={t('adminOcean.back_to_app')} />}
      actions={<span className="sb-pill sb-pill-good" style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}><ShieldCheck size={14} aria-hidden="true" /> {t('adminOcean.badge')}</span>}
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        {isLoading && <ReportCard><ReportMessage>{t('adminOcean.loading')}</ReportMessage></ReportCard>}
        {isError && <ReportCard><ReportMessage tone="bad">{String((error as Error)?.message ?? t('adminOcean.load_failed'))}</ReportMessage></ReportCard>}
        {d && (
          <>
            <div className="sb-card sb-rpt-card"><ReportFigures figures={growth} /></div>
            <div className="sb-card sb-rpt-card"><ReportFigures figures={volume} /></div>
            <div className="sb-card sb-rpt-card"><ReportFigures figures={health} /></div>
            <ReportCard title={t('adminOcean.recent')}>
              {d.recent_companies.length === 0
                ? <ReportMessage>{t('adminOcean.no_companies')}</ReportMessage>
                : <ReportTable columns={recentCols} rows={d.recent_companies} rowKey={c => c.id} minWidth={420} />}
            </ReportCard>
          </>
        )}
      </div>
    </OceanPage>
    </div>
  );
}
