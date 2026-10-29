/**
 * AppShell — the phone layout used inside the Android app (isAppShell()).
 *
 * The website keeps AppLayout's sidebar + top bar. In the app, the same pages
 * render inside a native-style frame instead:
 *   • a compact top bar: back arrow on sub-pages, the page title, search, alerts
 *   • bottom tabs for the four places people go most, plus "Menu"
 *   • Menu: a full-screen sheet with quick actions and every section of the app
 * Pages themselves are shared; phone-specific fitting (tables as cards, etc.)
 * lives in ./use-phone-tables and the html.app-shell rules in index.css.
 */
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Link, NavLink, useLocation, useNavigate } from 'react-router-dom';
import { useShortcutContext } from '@/keyboard/shortcut-registry';
import { NotificationsBell } from '@/components/notifications-bell';
import { CompanyAvatar } from '@/components/company-avatar';
import { BrandMark } from '@/components/brand-logo';
import { useBackHandler } from '@/navigation/use-back-handler';
import { usePhoneTables } from './use-phone-tables';

export interface ShellNavItem { to: string; label: string }
export interface ShellNavGroup { label?: string; items: ShellNavItem[] }
export interface ShellNavSection { label: string; icon: ReactNode; to?: string; groups?: ShellNavGroup[] }
export interface ShellShortcut { to: string; label: string; icon: ReactNode }

interface AppShellProps {
  sections: ShellNavSection[];
  shortcuts: ShellShortcut[];
  companyName: string;
  companySub: string;
  email: string | null;
  canSales: boolean;
  canInventory: boolean;
  onSignOut: () => void;
  children: ReactNode;
}

// ── Icons (22px, same stroke style as the sidebar) ──────────────────────────
function icon(paths: ReactNode, size = 22) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {paths}
    </svg>
  );
}
const HomeIcon     = () => icon(<><path d="M3 10.5 12 3l9 7.5" /><path d="M5 9.5V21h14V9.5" /><path d="M9.5 21v-6h5v6" /></>);
const SalesIcon    = () => icon(<><rect x="5" y="3" width="14" height="18" rx="2" /><path d="M9 8h6M9 12h6M9 16h3" /></>);
const StockIcon    = () => icon(<><path d="M21 8 12 3 3 8v8l9 5 9-5V8z" /><path d="M3 8l9 5 9-5M12 13v8" /></>);
const ContactsIcon = () => icon(<><circle cx="12" cy="8" r="3.5" /><path d="M5 19.5c1.2-3 4-4.5 7-4.5s5.8 1.5 7 4.5" /></>);
const MenuIcon     = () => icon(<><path d="M4 6h16M4 12h16M4 18h16" /></>);
const BackIcon     = () => icon(<><path d="M15 18l-6-6 6-6" /></>, 24);
const SearchIcon   = () => icon(<><circle cx="11" cy="11" r="6.5" /><path d="M16 16l4.5 4.5" /></>);
const CloseIcon    = () => icon(<><path d="M18 6 6 18M6 6l12 12" /></>, 24);
const ChevronIcon  = ({ open }: { open: boolean }) => (
  <svg viewBox="0 0 20 20" width="18" height="18" fill="currentColor" aria-hidden="true" style={{ transform: open ? 'rotate(180deg)' : undefined, transition: 'transform .15s' }}>
    <path fillRule="evenodd" d="M5.23 7.21a.75.75 0 011.06.02L10 11.06l3.71-3.83a.75.75 0 011.08 1.04l-4.25 4.39a.75.75 0 01-1.08 0L5.21 8.27a.75.75 0 01.02-1.06z" clipRule="evenodd" />
  </svg>
);

/** Titles for pages that are not in the navigation menu. */
const EXTRA_TITLES: [string, string][] = [
  ['/settings', 'Settings'],
  ['/sales/invoices/new', 'New Invoice'],
  ['/sales/payments/new', 'Record Receipt'],
  ['/purchasing/bills/new', 'New Bill'],
  ['/purchasing/payments/new', 'New Payment'],
  ['/sales/returns', 'Sales Returns'],
  ['/purchasing/returns', 'Purchase Returns'],
  ['/accounting/journal-entries', 'Journal Entries'],
  ['/banking/expenses', 'Expenses'],
  ['/catalog', 'Catalog'],
  ['/admin', 'Admin'],
];

function flatten(sections: ShellNavSection[]): ShellNavItem[] {
  const out: ShellNavItem[] = [];
  for (const s of sections) {
    if (s.to) out.push({ to: s.to, label: s.label });
    for (const g of s.groups ?? []) out.push(...g.items);
  }
  for (const [to, label] of EXTRA_TITLES) out.push({ to, label });
  return out;
}

/** Longest menu entry that the current path starts with. */
function matchItem(items: ShellNavItem[], pathname: string): ShellNavItem | null {
  let best: ShellNavItem | null = null;
  for (const it of items) {
    if (pathname === it.to || pathname.startsWith(it.to + '/')) {
      if (!best || it.to.length > best.to.length) best = it;
    }
  }
  return best;
}

function historyIndex(): number {
  const state = window.history.state as { idx?: unknown } | null;
  return typeof state?.idx === 'number' ? state.idx : 0;
}

export function AppShell({
  sections, shortcuts, companyName, companySub, email, canSales, canInventory, onSignOut, children,
}: AppShellProps) {
  const location = useLocation();
  const navigate = useNavigate();
  const { openPalette } = useShortcutContext();
  const [menuOpen, setMenuOpen] = useState(false);

  usePhoneTables();

  // Page-level CSS (index.css, html.app-shell …) applies only while the shell is mounted.
  useEffect(() => {
    document.documentElement.classList.add('app-shell');
    return () => document.documentElement.classList.remove('app-shell');
  }, []);

  useEffect(() => { setMenuOpen(false); }, [location.pathname]);
  useBackHandler(menuOpen, () => setMenuOpen(false));

  const items = useMemo(() => flatten(sections), [sections]);
  const current = matchItem(items, location.pathname);
  const title = current?.label ?? 'StockBolt';
  // A page that is itself a menu entry is a "top" page; anything deeper
  // (a document, an editor) gets a back arrow.
  const isTopPage = !current || current.to === location.pathname;

  const goBack = () => {
    if (historyIndex() > 0) navigate(-1);
    else navigate(current?.to ?? '/dashboard', { replace: true });
  };

  const tabs = [
    { to: '/dashboard', label: 'Home', icon: <HomeIcon />, match: ['/dashboard'] },
    ...(canSales ? [{ to: '/sales/invoices', label: 'Sales', icon: <SalesIcon />, match: ['/sales', '/pos'] }] : []),
    ...(canInventory ? [{ to: '/products', label: 'Stock', icon: <StockIcon />, match: ['/products', '/inventory', '/catalog'] }] : []),
    { to: '/contacts/customers', label: 'Contacts', icon: <ContactsIcon />, match: ['/contacts'] },
  ];
  const activeTab = tabs.find((t) => t.match.some((m) => location.pathname.startsWith(m)));

  return (
    <div className="app-frame flex h-[100dvh] flex-col bg-surface-page">
      {/* ── Top bar ─────────────────────────────────────────────────────── */}
      <header
        data-print-hide
        className="z-30 flex shrink-0 items-center gap-1 border-b border-border-subtle bg-surface-card px-2"
        style={{ paddingTop: 'env(safe-area-inset-top)', minHeight: 56 }}
      >
        {isTopPage ? (
          <button type="button" onClick={() => setMenuOpen(true)} className="flex h-11 w-11 items-center justify-center rounded-full" aria-label="Open menu">
            <CompanyAvatar size={32} fallbackText={companyName || email || undefined} />
          </button>
        ) : (
          <button type="button" onClick={goBack} className="flex h-11 w-11 items-center justify-center rounded-full text-ink-primary active:bg-surface-muted" aria-label="Back">
            <BackIcon />
          </button>
        )}
        <h1 className="min-w-0 flex-1 truncate px-1 text-[17px] font-semibold text-ink-primary">{title}</h1>
        <button type="button" onClick={openPalette} className="flex h-11 w-11 items-center justify-center rounded-full text-ink-secondary active:bg-surface-muted" aria-label="Search">
          <SearchIcon />
        </button>
        <NotificationsBell />
      </header>

      {/* ── Page ───────────────────────────────────────────────────────── */}
      <main className="app-main min-w-0 flex-1 overflow-y-auto overflow-x-hidden px-3 pt-3" style={{ paddingBottom: 'calc(84px + env(safe-area-inset-bottom))' }}>
        {children}
      </main>

      {/* ── Bottom tabs ────────────────────────────────────────────────── */}
      <nav
        data-print-hide
        className="fixed inset-x-0 bottom-0 z-40 flex border-t border-border-subtle bg-surface-card"
        style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
        aria-label="Main"
      >
        {tabs.map((t) => {
          const active = activeTab?.to === t.to;
          return (
            <NavLink
              key={t.to}
              to={t.to}
              className={`flex h-16 flex-1 flex-col items-center justify-center gap-0.5 text-[11px] font-medium ${active ? 'text-brand-600' : 'text-ink-tertiary'}`}
            >
              <span className={`flex h-7 w-14 items-center justify-center rounded-full ${active ? 'bg-brand-50' : ''}`}>{t.icon}</span>
              {t.label}
            </NavLink>
          );
        })}
        <button
          type="button"
          onClick={() => setMenuOpen(true)}
          className={`flex h-16 flex-1 flex-col items-center justify-center gap-0.5 text-[11px] font-medium ${!activeTab ? 'text-brand-600' : 'text-ink-tertiary'}`}
        >
          <span className={`flex h-7 w-14 items-center justify-center rounded-full ${!activeTab ? 'bg-brand-50' : ''}`}><MenuIcon /></span>
          Menu
        </button>
      </nav>

      {menuOpen && (
        <MenuSheet
          sections={sections}
          shortcuts={shortcuts}
          companyName={companyName}
          companySub={companySub}
          email={email}
          pathname={location.pathname}
          onClose={() => setMenuOpen(false)}
          onSignOut={onSignOut}
        />
      )}
    </div>
  );
}

// ── Menu sheet ──────────────────────────────────────────────────────────────
function MenuSheet({
  sections, shortcuts, companyName, companySub, email, pathname, onClose, onSignOut,
}: {
  sections: ShellNavSection[];
  shortcuts: ShellShortcut[];
  companyName: string;
  companySub: string;
  email: string | null;
  pathname: string;
  onClose: () => void;
  onSignOut: () => void;
}) {
  const owner = sections.find((s) => (s.groups ?? []).some((g) => g.items.some((it) => pathname.startsWith(it.to))));
  const [open, setOpen] = useState<string | null>(owner?.label ?? null);

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-surface-page" role="dialog" aria-label="Menu">
      <div className="flex shrink-0 items-center gap-2 border-b border-border-subtle bg-surface-card px-4" style={{ paddingTop: 'env(safe-area-inset-top)', minHeight: 56 }}>
        <BrandMark size={28} />
        <span className="flex-1 text-[15px] font-extrabold tracking-[0.08em] text-ink-primary">STOCKBOLT</span>
        <button type="button" onClick={onClose} className="flex h-11 w-11 items-center justify-center rounded-full text-ink-secondary active:bg-surface-muted" aria-label="Close menu">
          <CloseIcon />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto px-3 py-3" style={{ paddingBottom: 'calc(24px + env(safe-area-inset-bottom))' }}>
        {/* Company */}
        <Link to="/settings/company" onClick={onClose} className="mb-3 flex items-center gap-3 rounded-2xl border border-border-subtle bg-surface-card p-3">
          <CompanyAvatar size={44} fallbackText={companyName || email || undefined} />
          <span className="flex min-w-0 flex-1 flex-col">
            <span className="truncate text-[15px] font-semibold text-ink-primary">{companyName || '—'}</span>
            <span className="truncate text-xs text-ink-tertiary">{companySub}</span>
            {email && <span className="truncate text-xs text-ink-tertiary">{email}</span>}
          </span>
        </Link>

        {/* Quick actions */}
        {shortcuts.length > 0 && (
          <div className="mb-4 grid grid-cols-2 gap-2">
            {shortcuts.map((s) => (
              <Link key={s.to} to={s.to} onClick={onClose} className="flex items-center gap-2.5 rounded-2xl bg-brand-600 px-3 py-3 text-[13px] font-semibold text-white active:opacity-90">
                {s.icon}
                <span className="truncate">{s.label}</span>
              </Link>
            ))}
          </div>
        )}

        {/* Sections */}
        <div className="overflow-hidden rounded-2xl border border-border-subtle bg-surface-card">
          {sections.map((s, i) => {
            const border = i > 0 ? 'border-t border-border-subtle' : '';
            if (s.to) {
              return (
                <Link key={s.label} to={s.to} onClick={onClose} className={`flex min-h-[52px] items-center gap-3 px-4 text-[15px] font-medium text-ink-primary ${border}`}>
                  <span className="text-ink-secondary">{s.icon}</span>{s.label}
                </Link>
              );
            }
            const isOpen = open === s.label;
            return (
              <div key={s.label} className={border}>
                <button
                  type="button"
                  onClick={() => setOpen(isOpen ? null : s.label)}
                  aria-expanded={isOpen}
                  className="flex min-h-[52px] w-full items-center gap-3 px-4 text-start text-[15px] font-medium text-ink-primary"
                >
                  <span className="text-ink-secondary">{s.icon}</span>
                  <span className="flex-1">{s.label}</span>
                  <span className="text-ink-tertiary"><ChevronIcon open={isOpen} /></span>
                </button>
                {isOpen && (
                  <div className="pb-2">
                    {(s.groups ?? []).map((g, gi) => (
                      <div key={gi}>
                        {g.label && <p className="px-12 pb-1 pt-2 text-[11px] font-semibold uppercase tracking-wider text-ink-tertiary">{g.label}</p>}
                        {g.items.map((it) => {
                          const active = pathname === it.to || pathname.startsWith(it.to + '/');
                          return (
                            <Link
                              key={it.to}
                              to={it.to}
                              onClick={onClose}
                              className={`flex min-h-[44px] items-center px-12 text-[14px] ${active ? 'font-semibold text-brand-600' : 'text-ink-secondary'}`}
                            >
                              {it.label}
                            </Link>
                          );
                        })}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>

        <div className="mt-3 overflow-hidden rounded-2xl border border-border-subtle bg-surface-card">
          <Link to="/settings" onClick={onClose} className="flex min-h-[52px] items-center px-4 text-[15px] font-medium text-ink-primary">Settings</Link>
          <button type="button" onClick={onSignOut} className="flex min-h-[52px] w-full items-center border-t border-border-subtle px-4 text-start text-[15px] font-medium text-danger-600">
            Sign out
          </button>
        </div>

        {/* Google Play requires the privacy policy and account deletion to be reachable in the app. */}
        <div className="mt-3 flex flex-wrap justify-center gap-x-5 gap-y-1 text-[13px] text-ink-tertiary">
          <Link to="/privacy" onClick={onClose} className="py-2">Privacy Policy</Link>
          <Link to="/delete-account" onClick={onClose} className="py-2">Delete account</Link>
        </div>
      </div>
    </div>
  );
}
