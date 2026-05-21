/**
 * AppLayout — top-nav shell that wraps every authenticated, onboarded page.
 *
 * Replaces the previous left sidebar with a horizontal nav: brand on the
 * left, 6 nav sections in the middle (Dashboard + 5 dropdowns + Payroll
 * "coming in v2"), and tools on the right (bell, settings, language,
 * avatar menu).
 *
 * Mobile: collapses to a hamburger → side drawer with the same content
 * but in a stacked accordion view.
 */
import { useState, useEffect, useRef, type ReactNode } from 'react';
import { NavLink, Link, useNavigate, useLocation } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useAuthStore } from '@/store/auth';
import { getAdapter } from '@/data/index';
import { LanguageToggle } from '@/components/language-toggle';
import { NotificationsBell } from '@/components/notifications-bell';

// ── Types ───────────────────────────────────────────────────────────────────
interface NavItem {
  to: string;
  label: string;
}

interface NavGroup {
  /** Group label shown as a section header inside the dropdown (optional) */
  label?: string;
  items: NavItem[];
}

interface NavSection {
  /** Top-bar button label */
  label: string;
  /** If set, the section is a single direct link (no dropdown) */
  to?: string;
  /** Dropdown contents grouped into subsections */
  groups?: NavGroup[];
  /** Renders as greyed/disabled with a title-tooltip */
  disabled?: boolean;
  disabledHint?: string;
  /** Mega-menu (renders dropdown in 2/3 columns) */
  wide?: boolean;
}

// ── Icons ───────────────────────────────────────────────────────────────────
function BoltIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="white" className="h-5 w-5">
      <path d="M13 2 3 14h7l-1 8 10-12h-7l1-8z" />
    </svg>
  );
}
function ChevronDownIcon() {
  return (
    <svg viewBox="0 0 20 20" fill="currentColor" className="h-3.5 w-3.5">
      <path fillRule="evenodd" d="M5.23 7.21a.75.75 0 011.06.02L10 11.06l3.71-3.83a.75.75 0 011.08 1.04l-4.25 4.39a.75.75 0 01-1.08 0L5.21 8.27a.75.75 0 01.02-1.06z" clipRule="evenodd" />
    </svg>
  );
}
function CogIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-5 w-5">
      <path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  );
}
function MenuIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-5 w-5">
      <line x1="4" y1="6" x2="20" y2="6" /><line x1="4" y1="12" x2="20" y2="12" /><line x1="4" y1="18" x2="20" y2="18" />
    </svg>
  );
}
function XIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-5 w-5">
      <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
    </svg>
  );
}

// ── Build the nav structure once per render (translated labels) ──────────────
function useNavSections(t: (k: string) => string): NavSection[] {
  return [
    { label: t('nav.dashboard'), to: '/dashboard' },

    {
      label: t('nav.sales'),
      groups: [{
        items: [
          { to: '/sales/invoices',     label: t('nav.invoices') },
          { to: '/sales/quotes',       label: t('nav.quotes') },
          { to: '/sales/payments',     label: t('nav.payments') },
          { to: '/sales/returns',      label: t('returns.sales_returns_title') },
          { to: '/sales/credit-notes', label: t('returns.credit_notes_title') },
          { to: '/contacts/customers', label: t('nav.customers') },
          { to: '/pos',                label: t('pos.counter_sales') },
        ],
      }],
    },

    {
      label: t('purchasing.nav_title'),
      groups: [{
        items: [
          { to: '/purchasing/orders',      label: t('purchasing.po_title') },
          { to: '/purchasing/grns',        label: t('purchasing.grn_title') },
          { to: '/purchasing/bills',       label: t('purchasing.bills_title') },
          { to: '/purchasing/payments',    label: t('purchasing.vp_title') },
          { to: '/purchasing/expenses',    label: 'Expenses' },
          { to: '/purchasing/debit-notes', label: t('returns.debit_notes_title') },
          { to: '/contacts/suppliers',     label: t('nav.suppliers') },
        ],
      }],
    },

    {
      label: t('nav.inventory'),
      groups: [
        {
          label: 'Catalog',
          items: [
            { to: '/products',            label: t('nav.all_products') },
            { to: '/products/categories', label: t('nav.categories') },
            { to: '/products/brands',     label: t('nav.brands') },
            { to: '/products/vehicles',   label: t('nav.vehicles') },
            { to: '/catalog',             label: t('nav.parts_catalog') },
          ],
        },
        {
          label: 'Stock',
          items: [
            { to: '/inventory/transfers',    label: t('inventory.transfers_title') },
            { to: '/inventory/adjustments',  label: t('inventory.adjustments_title') },
            { to: '/inventory/stock-ledger', label: t('inventory.stock_ledger_title') },
          ],
        },
      ],
    },

    {
      label: t('nav.accounting'),
      groups: [
        {
          label: 'Books',
          items: [
            { to: '/accounting/chart-of-accounts', label: t('nav.coa') },
            { to: '/accounting/journal-entries',   label: t('nav.journal_entries') },
            { to: '/accounting/general-ledger',    label: t('nav.general_ledger') },
            { to: '/accounting/period-lock',       label: t('nav.period_lock') },
          ],
        },
        {
          label: t('nav.banking'),
          items: [
            { to: '/banking/transfers',    label: t('banking.transfers_title') },
            { to: '/banking/expenses',     label: t('banking.expenses_title') },
            { to: '/banking/pdc-received', label: t('banking.pdc_received_title') },
            { to: '/banking/pdc-issued',   label: t('banking.pdc_issued_title') },
            { to: '/banking/reconciliation', label: 'Bank Reconciliation' },
          ],
        },
      ],
    },

    {
      label: 'Payroll',
      disabled: true,
      disabledHint: 'Coming in v2',
    },

    {
      label: t('nav.reports'),
      wide: true,
      groups: [
        {
          label: 'Financial',
          items: [
            { to: '/reports/trial-balance', label: t('nav.trial_balance') },
            { to: '/reports/profit-loss',   label: t('nav.profit_loss') },
            { to: '/reports/balance-sheet', label: t('nav.balance_sheet') },
            { to: '/reports/cash-flow',     label: t('reports.cash_flow') },
            { to: '/reports/vat-return',    label: t('reports.vat_return') },
          ],
        },
        {
          label: 'Sales',
          items: [
            { to: '/reports/ar-aging',              label: t('nav.ar_aging') },
            { to: '/reports/sales-by-customer',     label: t('reports.sales_by_customer') },
            { to: '/reports/sales-by-product',      label: t('reports.sales_by_product') },
            { to: '/reports/sales-by-brand',        label: t('reports.sales_by_brand') },
            { to: '/reports/sales-by-vehicle',      label: t('reports.sales_by_vehicle') },
            { to: '/reports/sales-by-salesperson',  label: t('reports.sales_by_salesperson') },
            { to: '/reports/sales-trend',           label: t('reports.sales_trend') },
            { to: '/reports/daily-sales',           label: t('reports.daily_sales_summary') },
            { to: '/reports/pos-session',           label: t('reports.pos_session_report') },
          ],
        },
        {
          label: 'Purchases',
          items: [
            { to: '/reports/ap-aging',             label: t('reports.ap_aging') },
            { to: '/reports/supplier-statement',   label: t('reports.supplier_statement') },
            { to: '/reports/grn-reconciliation',   label: t('reports.grn_reconciliation') },
            { to: '/reports/purchases-by-supplier',label: t('reports.purchases_by_supplier') },
            { to: '/reports/purchases-by-product', label: t('reports.purchases_by_product') },
            { to: '/reports/outstanding-pos',      label: t('reports.outstanding_pos') },
          ],
        },
        {
          label: 'Inventory',
          items: [
            { to: '/reports/stock-valuation',             label: t('nav.stock_valuation') },
            { to: '/reports/stock-movement',              label: t('reports.stock_movement') },
            { to: '/reports/slow-moving',                 label: t('reports.slow_moving') },
            { to: '/reports/reorder',                     label: t('reports.reorder') },
            { to: '/reports/stock-aging',                 label: t('reports.stock_aging') },
            { to: '/reports/inventory-adjustment-report', label: t('reports.inventory_adjustment_report') },
          ],
        },
        {
          label: 'Banking',
          items: [
            { to: '/reports/daily-cash', label: t('reports.daily_cash_title') },
            { to: '/reports/bank-recon', label: t('reports.bank_recon_title') },
          ],
        },
        {
          label: 'Audit',
          items: [
            { to: '/reports/audit-log',      label: t('reports.audit_log') },
            { to: '/reports/reversal-trail', label: t('reports.reversal_trail') },
          ],
        },
      ],
    },
  ];
}

// ── NavButton — a section in the top bar ────────────────────────────────────
function NavButton({
  section,
  isOpen,
  isActive,
  onToggle,
  onItemClick,
}: {
  section: NavSection;
  isOpen: boolean;
  isActive: boolean;
  onToggle: () => void;
  onItemClick: () => void;
}) {
  const navigate = useNavigate();

  // Direct link (Dashboard)
  if (section.to) {
    return (
      <NavLink
        to={section.to}
        onClick={onItemClick}
        className={({ isActive }) =>
          `flex items-center gap-1.5 rounded-full px-4 py-2 text-sm font-medium transition-colors ${
            isActive
              ? 'bg-brand-600 text-white'
              : 'text-ink-secondary hover:bg-surface-muted hover:text-ink-primary'
          }`
        }
      >
        {section.label}
      </NavLink>
    );
  }

  if (section.disabled) {
    return (
      <button
        type="button"
        disabled
        title={section.disabledHint}
        className="flex cursor-not-allowed items-center gap-1.5 rounded-full px-4 py-2 text-sm font-medium text-ink-tertiary/60"
      >
        {section.label}
        <ChevronDownIcon />
      </button>
    );
  }

  return (
    <button
      type="button"
      onClick={onToggle}
      className={`flex items-center gap-1.5 rounded-full px-4 py-2 text-sm font-medium transition-colors ${
        isActive
          ? 'bg-brand-50 text-brand-700'
          : isOpen
          ? 'bg-surface-muted text-ink-primary'
          : 'text-ink-secondary hover:bg-surface-muted hover:text-ink-primary'
      }`}
      onKeyDown={(e) => {
        if (e.key === 'ArrowDown' && !isOpen) onToggle();
        if (e.key === 'Enter') {
          // navigate to the first item on Enter
          const first = section.groups?.[0]?.items?.[0];
          if (first) navigate(first.to);
        }
      }}
      aria-haspopup="true"
      aria-expanded={isOpen}
    >
      {section.label}
      <ChevronDownIcon />
    </button>
  );
}

// ── NavDropdownPanel — popover with grouped items ───────────────────────────
function NavDropdownPanel({ section, onItemClick }: { section: NavSection; onItemClick: () => void }) {
  const groups = section.groups ?? [];
  const wide = section.wide;
  return (
    <div
      className={`absolute z-50 mt-2 rounded-2xl border border-border-subtle bg-surface-card p-2 shadow-xl ${
        wide ? 'w-[640px]' : 'w-56'
      }`}
    >
      <div className={wide ? 'grid grid-cols-3 gap-2' : 'flex flex-col'}>
        {groups.map((g, gi) => (
          <div key={gi}>
            {g.label && (
              <p className="px-3 pt-2 text-[10px] font-semibold uppercase tracking-wider text-ink-tertiary">
                {g.label}
              </p>
            )}
            <ul className="py-1">
              {g.items.map((it) => (
                <li key={it.to}>
                  <NavLink
                    to={it.to}
                    onClick={onItemClick}
                    className={({ isActive }) =>
                      `block rounded-card px-3 py-1.5 text-sm transition-colors ${
                        isActive
                          ? 'bg-brand-50 text-brand-700'
                          : 'text-ink-primary hover:bg-surface-muted'
                      }`
                    }
                  >
                    {it.label}
                  </NavLink>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── User menu dropdown ──────────────────────────────────────────────────────
function UserMenu({ email, onSignOut }: { email: string | null; onSignOut: () => void }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, [open]);

  const initial = (email ?? '?').charAt(0).toUpperCase();

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex h-9 w-9 items-center justify-center rounded-full text-sm font-semibold text-white shadow-sm hover:opacity-90"
        style={{ background: 'linear-gradient(135deg, #6366f1, #8b5cf6)' }}
        aria-label="User menu"
      >
        {initial}
      </button>
      {open && (
        <div className="absolute end-0 z-50 mt-2 w-56 overflow-hidden rounded-card border border-border-subtle bg-surface-card shadow-xl">
          <div className="border-b border-border-subtle px-4 py-3">
            <p className="truncate text-xs text-ink-tertiary">Signed in as</p>
            <p className="truncate text-sm font-medium text-ink-primary">{email ?? '—'}</p>
          </div>
          <ul className="py-1">
            <li>
              <Link
                to="/settings/company"
                onClick={() => setOpen(false)}
                className="block px-4 py-2 text-sm text-ink-primary hover:bg-surface-muted"
              >
                Company Settings
              </Link>
            </li>
            <li>
              <Link
                to="/settings/system-health"
                onClick={() => setOpen(false)}
                className="block px-4 py-2 text-sm text-ink-primary hover:bg-surface-muted"
              >
                System Health
              </Link>
            </li>
            <li className="border-t border-border-subtle">
              <button
                type="button"
                onClick={() => { setOpen(false); onSignOut(); }}
                className="block w-full px-4 py-2 text-start text-sm text-red-600 hover:bg-red-50"
              >
                Sign out
              </button>
            </li>
          </ul>
        </div>
      )}
    </div>
  );
}

// ── Settings dropdown ───────────────────────────────────────────────────────
function SettingsMenu() {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const { t } = useTranslation();
  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, [open]);

  // Top item links to the Settings hub (Phase 12.45) — single place that
  // shows every configurable area with a live count. The legacy items
  // below remain for quick-jump muscle memory.
  const settings: NavItem[] = [
    { to: '/settings',               label: 'All settings' },
    { to: '/settings/company',       label: t('nav.company') },
    { to: '/settings/warehouses',    label: t('nav.warehouses') },
    { to: '/settings/units',         label: t('nav.units') },
    { to: '/settings/price-levels',  label: t('nav.price_levels') },
    { to: '/settings/tax-rates',     label: 'Tax Rates' },
    { to: '/settings/bank-accounts', label: 'Bank Accounts' },
    { to: '/settings/print',         label: t('print.settings_title') },
    { to: '/settings/system-health', label: t('settings.system_health') },
    { to: '/settings/salespeople',   label: 'Salespeople' },
    { to: '/settings/reset-data',    label: 'Reset Data' },
  ];

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex h-9 w-9 items-center justify-center rounded-full text-ink-secondary hover:bg-surface-muted hover:text-ink-primary"
        aria-label="Settings"
      >
        <CogIcon />
      </button>
      {open && (
        <div className="absolute end-0 z-50 mt-2 w-56 overflow-hidden rounded-card border border-border-subtle bg-surface-card shadow-xl">
          <p className="border-b border-border-subtle bg-surface-muted px-4 py-2 text-[10px] font-semibold uppercase tracking-wide text-ink-tertiary">
            Settings
          </p>
          <ul className="py-1">
            {settings.map((s) => (
              <li key={s.to}>
                <Link
                  to={s.to}
                  onClick={() => setOpen(false)}
                  className="block px-4 py-2 text-sm text-ink-primary hover:bg-surface-muted"
                >
                  {s.label}
                </Link>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

// ── Mobile drawer (used when viewport is below the top-nav breakpoint) ─────
function MobileDrawer({
  open,
  onClose,
  sections,
  email,
  onSignOut,
}: {
  open: boolean;
  onClose: () => void;
  sections: NavSection[];
  email: string | null;
  onSignOut: () => void;
}) {
  if (!open) return null;
  const { t } = useTranslation();
  return (
    <div className="fixed inset-0 z-50 lg:hidden">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <aside className="absolute start-0 top-0 flex h-full w-72 flex-col border-e border-border-subtle bg-surface-card shadow-xl">
        {/* Drawer header */}
        <div className="flex items-center justify-between border-b border-border-subtle px-4 py-3">
          <div className="flex items-center gap-2.5">
            <div
              className="flex h-8 w-8 items-center justify-center rounded-lg shadow-sm"
              style={{ background: 'linear-gradient(135deg, #6366f1, #8b5cf6)' }}
            >
              <BoltIcon />
            </div>
            <span className="font-semibold text-ink-primary">StockBolt</span>
          </div>
          <button type="button" onClick={onClose} className="text-ink-secondary hover:text-ink-primary"><XIcon /></button>
        </div>

        {/* Drawer body — stacked sections */}
        <nav className="flex-1 overflow-y-auto p-3">
          {sections.map((section, si) => {
            if (section.disabled) {
              return (
                <div key={si} className="mb-3">
                  <p className="px-3 py-2 text-xs font-medium uppercase tracking-wider text-ink-tertiary/60">
                    {section.label} <span className="text-[10px]">({section.disabledHint})</span>
                  </p>
                </div>
              );
            }
            if (section.to) {
              return (
                <NavLink
                  key={si}
                  to={section.to}
                  onClick={onClose}
                  className={({ isActive }) =>
                    `mb-1 block rounded-card px-3 py-2 text-sm font-medium ${
                      isActive ? 'bg-brand-50 text-brand-700' : 'text-ink-primary hover:bg-surface-muted'
                    }`
                  }
                >
                  {section.label}
                </NavLink>
              );
            }
            return (
              <div key={si} className="mb-3">
                <p className="px-3 py-1 text-[10px] font-semibold uppercase tracking-wider text-ink-tertiary">
                  {section.label}
                </p>
                {(section.groups ?? []).flatMap((g) => g.items).map((it) => (
                  <NavLink
                    key={it.to}
                    to={it.to}
                    onClick={onClose}
                    className={({ isActive }) =>
                      `block rounded-card px-3 py-1.5 text-sm ${
                        isActive ? 'bg-brand-50 text-brand-700' : 'text-ink-secondary hover:bg-surface-muted hover:text-ink-primary'
                      }`
                    }
                  >
                    {it.label}
                  </NavLink>
                ))}
              </div>
            );
          })}
          <div className="mt-3 border-t border-border-subtle pt-3">
            <p className="px-3 py-1 text-[10px] font-semibold uppercase tracking-wider text-ink-tertiary">Settings</p>
            {(['company', 'warehouses', 'units', 'price-levels', 'print', 'system-health'] as const).map((key) => (
              <NavLink
                key={key}
                to={`/settings/${key}`}
                onClick={onClose}
                className="block rounded-card px-3 py-1.5 text-sm text-ink-secondary hover:bg-surface-muted hover:text-ink-primary"
              >
                {key.replace('-', ' ').replace(/\b\w/g, c => c.toUpperCase())}
              </NavLink>
            ))}
          </div>
        </nav>

        {/* Drawer footer */}
        <div className="border-t border-border-subtle p-3">
          <div className="mb-2 flex items-center justify-between gap-2">
            <span className="truncate text-xs text-ink-tertiary">{email ?? '—'}</span>
            <LanguageToggle />
          </div>
          <button
            type="button"
            onClick={onSignOut}
            className="w-full rounded-card border border-border-strong px-3 py-1.5 text-sm text-ink-secondary hover:bg-surface-muted"
          >
            {t('common.sign_out')}
          </button>
        </div>
      </aside>
    </div>
  );
}

// ── AppLayout ───────────────────────────────────────────────────────────────
interface AppLayoutProps {
  children: ReactNode;
}

export function AppLayout({ children }: AppLayoutProps) {
  const { t } = useTranslation();
  const { email, clear } = useAuthStore();
  const navigate = useNavigate();
  const location = useLocation();
  const [openIdx, setOpenIdx] = useState<number | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const navRef = useRef<HTMLDivElement>(null);
  const sections = useNavSections(t);

  // Close dropdowns on outside click or route change or Escape
  useEffect(() => { setOpenIdx(null); }, [location.pathname]);
  useEffect(() => {
    if (openIdx === null) return;
    const onClick = (e: MouseEvent) => {
      if (navRef.current && !navRef.current.contains(e.target as Node)) setOpenIdx(null);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpenIdx(null); };
    document.addEventListener('mousedown', onClick);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onClick);
      document.removeEventListener('keydown', onKey);
    };
  }, [openIdx]);

  // Detect which top-level section the current path belongs to, for the active style.
  const isSectionActive = (section: NavSection): boolean => {
    if (section.to) return location.pathname.startsWith(section.to);
    const items = (section.groups ?? []).flatMap((g) => g.items);
    return items.some((it) => location.pathname.startsWith(it.to));
  };

  async function handleSignOut() {
    await getAdapter().auth.signOut();
    clear();
    navigate('/login', { replace: true });
  }

  return (
    <div className="flex h-screen flex-col bg-surface-page">
      {/* ── 3px indigo→violet gradient bar (Phase 12.30 design system) ── */}
      <div
        className="h-[3px] shrink-0"
        style={{ background: 'linear-gradient(90deg, #6366f1, #8b5cf6)' }}
        aria-hidden="true"
      />

      {/* ── Top nav ───────────────────────────────────────────────────── */}
      <header
        ref={navRef}
        className="relative z-30 flex h-16 shrink-0 items-center gap-2 border-b border-border-subtle bg-surface-card px-4 shadow-sm lg:px-6"
      >
        {/* Mobile hamburger */}
        <button
          type="button"
          className="flex h-9 w-9 items-center justify-center rounded-full text-ink-secondary hover:bg-surface-muted hover:text-ink-primary lg:hidden"
          onClick={() => setDrawerOpen(true)}
          aria-label="Open menu"
        >
          <MenuIcon />
        </button>

        {/* Brand */}
        <Link to="/dashboard" className="flex items-center gap-2.5">
          <div
            className="flex h-8 w-8 items-center justify-center rounded-lg shadow-sm"
            style={{ background: 'linear-gradient(135deg, #6366f1, #8b5cf6)' }}
          >
            <BoltIcon />
          </div>
          <span className="hidden text-base font-bold text-ink-primary sm:block">StockBolt</span>
        </Link>

        {/* Desktop nav — sections */}
        <nav className="ms-4 hidden flex-1 items-center gap-1 lg:flex">
          {sections.map((section, idx) => {
            const isOpen = openIdx === idx;
            const isActive = isSectionActive(section);
            return (
              <div key={idx} className="relative">
                <NavButton
                  section={section}
                  isOpen={isOpen}
                  isActive={isActive}
                  onToggle={() => setOpenIdx(isOpen ? null : idx)}
                  onItemClick={() => setOpenIdx(null)}
                />
                {isOpen && section.groups && (
                  <NavDropdownPanel section={section} onItemClick={() => setOpenIdx(null)} />
                )}
              </div>
            );
          })}
        </nav>

        {/* Right tools */}
        <div className="ms-auto flex items-center gap-1">
          <LanguageToggle />
          <NotificationsBell />
          <SettingsMenu />
          <UserMenu email={email} onSignOut={handleSignOut} />
        </div>
      </header>

      {/* ── Mobile drawer ──────────────────────────────────────────────── */}
      <MobileDrawer
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        sections={sections}
        email={email}
        onSignOut={handleSignOut}
      />

      {/* ── Main content ──────────────────────────────────────────────── */}
      <main className="flex-1 overflow-y-auto p-4 md:p-6">
        {children}
      </main>
    </div>
  );
}
