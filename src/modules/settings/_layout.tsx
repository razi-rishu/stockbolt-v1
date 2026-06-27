import { NavLink, Outlet, useLocation } from 'react-router-dom';
import { SETTINGS_SECTIONS } from './_nav';

/**
 * Settings two-pane layout — pinned left nav rail + content Outlet.
 *
 * Wraps every /settings/* route so the section list stays visible while a
 * setting opens beside it (no more bouncing back to the hub). On narrow
 * screens the rail stacks above the content.
 */
export default function SettingsLayout() {
  const { pathname } = useLocation();
  // The hub (/settings) shows the cards full-width; the pinned nav rail appears
  // only once you drill into a specific setting.
  if (pathname === '/settings' || pathname === '/settings/') return <Outlet />;

  return (
    <div className="flex flex-col gap-6 lg:flex-row lg:gap-8">
      {/* Left rail */}
      <aside className="lg:sticky lg:top-4 lg:max-h-[calc(100vh-5rem)] lg:w-60 lg:shrink-0 lg:overflow-y-auto lg:pr-1">
        <nav className="flex flex-col gap-5">
          {SETTINGS_SECTIONS.map((section) => (
            <div key={section.title}>
              <div className="mb-1.5 px-2.5 text-[10px] font-bold uppercase tracking-[0.08em] text-ink-tertiary">
                {section.title}
              </div>
              <div className="flex flex-col gap-0.5">
                {section.items.map((item) =>
                  item.comingSoon ? (
                    <span
                      key={item.to}
                      className="flex cursor-not-allowed items-center gap-2 rounded-lg px-2.5 py-1.5 text-sm text-ink-tertiary opacity-50"
                    >
                      <span className="text-base leading-none">{item.icon}</span>
                      {item.title}
                    </span>
                  ) : (
                    <NavLink
                      key={item.to}
                      to={item.to}
                      end
                      className={({ isActive }) =>
                        `flex items-center gap-2 rounded-lg px-2.5 py-1.5 text-sm transition-colors ${
                          isActive
                            ? 'bg-brand-50 font-semibold text-brand-700'
                            : 'text-ink-secondary hover:bg-slate-50 hover:text-ink-primary'
                        }`
                      }
                    >
                      <span className="text-base leading-none">{item.icon}</span>
                      {item.title}
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
