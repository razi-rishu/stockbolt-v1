/**
 * StockBolt Platform Control Center (phase142) — /admin/*.
 *
 * Owner-only: the route sits behind RequirePlatformAdmin (UI), and every
 * figure comes from RPCs that refuse anyone not in platform_admins (server).
 * Views ship as real data allows; Subscriptions, Support, Security and
 * Settings follow as their own steps (see docs/Admin_Control_Center_Metrics.md).
 */
import { NavLink, Navigate, Route, Routes } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { LayoutDashboard, Building2, Users, Activity, ShieldCheck } from 'lucide-react';
import { BackButton } from '@/ui/back-button';
import { OverviewView } from './views/overview';
import { BusinessesView } from './views/businesses';
import { BusinessDetailView } from './views/business-detail';
import { UsersView } from './views/users';
import { SystemView } from './views/system';

export default function ControlCenter() {
  const { t } = useTranslation();
  const tabs = [
    { to: '/admin', end: true, icon: <LayoutDashboard size={16} aria-hidden="true" />, label: t('adminCC.tab_overview') },
    { to: '/admin/businesses', end: false, icon: <Building2 size={16} aria-hidden="true" />, label: t('adminCC.tab_businesses') },
    { to: '/admin/users', end: false, icon: <Users size={16} aria-hidden="true" />, label: t('adminCC.tab_users') },
    { to: '/admin/system', end: false, icon: <Activity size={16} aria-hidden="true" />, label: t('adminCC.tab_system') },
  ];
  return (
    <div className="sb-ocean sb-admin-shell" data-testid="admin-control-center">
      <div className="sb-adm-wrap">
        <header className="sb-adm-top">
          <BackButton to="/dashboard" label={t('adminOcean.back_to_app')} />
          <div className="sb-adm-titles">
            <h1 className="sb-adm-title">{t('adminCC.title')}</h1>
            <p className="sb-adm-sub">{t('adminCC.subtitle')}</p>
          </div>
          <span className="sb-pill sb-pill-good sb-adm-badge"><ShieldCheck size={14} aria-hidden="true" /> {t('adminOcean.badge')}</span>
        </header>
        <nav className="sb-adm-tabs" aria-label={t('adminCC.title')}>
          {tabs.map((tb) => (
            <NavLink key={tb.to} to={tb.to} end={tb.end} className={({ isActive }) => `sb-adm-tab ${isActive ? 'is-on' : ''}`}>
              {tb.icon}<span>{tb.label}</span>
            </NavLink>
          ))}
        </nav>
        <Routes>
          <Route index element={<OverviewView />} />
          <Route path="businesses" element={<BusinessesView />} />
          <Route path="businesses/:id" element={<BusinessDetailView />} />
          <Route path="users" element={<UsersView />} />
          <Route path="system" element={<SystemView />} />
          <Route path="*" element={<Navigate to="/admin" replace />} />
        </Routes>
      </div>
    </div>
  );
}
