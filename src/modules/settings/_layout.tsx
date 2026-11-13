import { NavLink, Outlet, useLocation } from 'react-router-dom';
import { visibleSettingsSections } from './_nav';
import { useEnabledModules } from '@/hooks/use-enabled-modules';
import { useTranslation } from 'react-i18next';
import { itemIcon, itemTitle, sectionTitle } from './_nav-ocean';
import '@/styles/stockbolt-ocean-teal.css';
import { useInnerNav } from '@/hooks/use-inner-nav';

/**
 * Settings two-pane layout — pinned left nav rail + content Outlet.
 *
 * Wraps every /settings/* route so the section list stays visible while a
 * setting opens beside it (no more bouncing back to the hub). Below lg the
 * rail is hidden: stacked above the content it filled a phone screen and the
 * opened setting landed out of sight underneath. There, the hub (/settings)
 * is the menu and Back returns to it.
 */
export default function SettingsLayout() {
  const { pathname } = useLocation();
  const { modules } = useEnabledModules();
  const { t } = useTranslation();
  // The hub (/settings) shows the cards full-width; the pinned nav rail appears
  // only once you drill into a specific setting.
  const isHub = pathname === '/settings' || pathname === '/settings/';
  // With the rail on screen the main app sidebar steps aside (reopenable).
  useInnerNav(!isHub);
  if (isHub) return <Outlet />;

  return (
    <div className="flex flex-col gap-6 lg:flex-row lg:gap-8">
      {/* Left rail */}
      {/* Ocean Teal (UI v1.1) rail: same entries, routes and visibility. */}
      <aside className="sb-srail hidden lg:sticky lg:block lg:top-4 lg:max-h-[calc(100vh-5rem)] lg:w-64 lg:shrink-0 lg:overflow-y-auto lg:pe-1">
        <nav className="flex flex-col gap-5" aria-label={t('settingsNav.title')}>
          {visibleSettingsSections(modules).map((section) => (
            <div key={section.title}>
              <div className="sb-srail-section">{sectionTitle(t, section)}</div>
              <div className="flex flex-col gap-0.5">
                {section.items.map((item) =>
                  item.comingSoon ? (
                    <span
                      key={item.to}
                      className="sb-srail-item is-disabled"
                    >
                      <span className="sb-srail-icon">{itemIcon(item, 18)}</span>
                      {itemTitle(t, item)}
                    </span>
                  ) : (
                    <NavLink
                      key={item.to}
                      to={item.to}
                      end
                      className={({ isActive }) => `sb-srail-item ${isActive ? 'active' : ''}`}
                    >
                      <span className="sb-srail-icon">{itemIcon(item, 18)}</span>
                      {itemTitle(t, item)}
                    </NavLink>
                  ),
                )}
              </div>
            </div>
          ))}
        </nav>
      </aside>

      {/* Content */}
      <div className="min-w-0 flex-1">
        <Outlet />
      </div>
    </div>
  );
}
