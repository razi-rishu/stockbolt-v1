/**
 * AppLayout — sidebar shell that wraps every authenticated, onboarded page
 * (2026-07 redesign, replacing the dark top-nav shell).
 *
 * Desktop: fixed white left sidebar — brand, accordion nav sections,
 * SHORTCUTS quick links, company chip pinned at the bottom — plus a white
 * top bar with global search (command palette), language, bell, settings
 * and the profile menu.
 *
 * Mobile: sidebar collapses into a drawer (hamburger in the top bar) that
 * renders the exact same sidebar content.
 */
import { useState, useEffect, useRef, type ReactNode } from 'react';
import { NavLink, Link, useNavigate, useLocation } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import { useAuthStore } from '@/store/auth';
import { getAdapter } from '@/data/index';
import { LanguageToggle } from '@/components/language-toggle';
import { hasPerm, type Permission } from '@/lib/permissions';
import { CompanyAvatar } from '@/components/company-avatar';
import { useShortcutContext } from '@/keyboard/shortcut-registry';
import { NotificationsBell } from '@/components/notifications-bell';
import { BrandMark } from '@/components/brand-logo';
import { useCompanyCurrency } from '@/hooks/use-company-currency';
import { fiscalYearLabel } from '@/lib/locale';

// ── Types ───────────────────────────────────────────────────────────────────
interface NavItem {
  to: string;
  label: string;
}

interface NavGroup {
  /** Group label shown as a small header inside the expanded section (optional) */
  label?: string;
  items: NavItem[];
  /** Phase 22 — hide this group unless the role has this permission */
  perm?: Permission;
}

interface NavSection {
  /** Sidebar row label */
  label: string;
  /** Sidebar row icon */
  icon: ReactNode;
  /** If set, the section is a single direct link (no accordion) */
  to?: string;
  /** Accordion contents grouped into subsections */
  groups?: NavGroup[];
  /** Phase 22 — hide this whole section unless the role has this permission */
  perm?: Permission;
}

// ── Icons (18px stroke, Lucide-style) ───────────────────────────────────────
const stroked = 'fill-none stroke-current';
function icn(paths: ReactNode, viewBox = '0 0 24 24') {
  return (
    <svg viewBox={viewBox} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className={`h-[18px] w-[18px] shrink-0 ${stroked}`}>
      {paths}
    </svg>
  );
}
const HomeIcon       = () => icn(<><path d="M3 10.5 12 3l9 7.5" /><path d="M5 9.5V21h14V9.5" /><path d="M9.5 21v-6h5v6" /></>);
const SalesIcon      = () => icn(<><rect x="5" y="3" width="14" height="18" rx="2" /><path d="M9 8h6M9 12h6M9 16h3" /></>);
const PurchasingIcon = () => icn(<><circle cx="9" cy="20" r="1.4" /><circle cx="18" cy="20" r="1.4" /><path d="M2 3h3l2.5 12.5a1.5 1.5 0 0 0 1.5 1.2h8.6a1.5 1.5 0 0 0 1.5-1.2L21 7H6" /></>);
const InventoryIcon  = () => icn(<><path d="M21 8 12 3 3 8v8l9 5 9-5V8z" /><path d="M3 8l9 5 9-5M12 13v8" /></>);
const AccountingIcon = () => icn(<><rect x="4" y="2.5" width="16" height="19" rx="2" /><path d="M8 7h8M8 11h.01M12 11h.01M16 11h.01M8 15h.01M12 15h.01M16 15h4.01" /></>);
const PayrollIcon    = () => icn(<><circle cx="9" cy="8.5" r="3.2" /><path d="M3.5 19.5c.9-3 3-4.5 5.5-4.5s4.6 1.5 5.5 4.5" /><circle cx="17" cy="9.5" r="2.4" /><path d="M16 14.6c2.3.2 3.9 1.6 4.6 4" /></>);
const ReportsIcon    = () => icn(<><path d="M4 20V10M10 20V4M16 20v-7M21 20H3" /></>);
const ContactsIcon   = () => icn(<><circle cx="12" cy="8" r="3.5" /><path d="M5 19.5c1.2-3 4-4.5 7-4.5s5.8 1.5 7 4.5" /></>);
const InvoicePlusIcon= () => icn(<><rect x="5" y="3" width="14" height="18" rx="2" /><path d="M12 9v6M9 12h6" /></>);
const BillIcon       = () => icn(<><path d="M6 2.5h12V21l-2.4-1.6L13.2 21l-2.4-1.6L8.4 21 6 19.4V2.5z" /><path d="M9.5 8h5M9.5 12h5" /></>);
const ReceiptIcon    = () => icn(<><circle cx="12" cy="12" r="9" /><path d="M12 7.5v9M15 10a2 2 0 0 0-2-2h-2.2a1.8 1.8 0 0 0 0 3.6h2.4a1.8 1.8 0 0 1 0 3.6H9" /></>);
const PaymentIcon    = () => icn(<><rect x="2.5" y="6" width="19" height="13" rx="2" /><path d="M2.5 10h19M6.5 15h4" /></>);
const SearchIcon     = () => icn(<><circle cx="11" cy="11" r="6.5" /><path d="M16 16l4.5 4.5" /></>);
const ChevronDownIcon = ({ className = '' }: { className?: string }) => (
  <svg viewBox="0 0 20 20" fill="currentColor" className={`h-3.5 w-3.5 shrink-0 transition-transform ${className}`}>
    <path fillRule="evenodd" d="M5.23 7.21a.75.75 0 011.06.02L10 11.06l3.71-3.83a.75.75 0 011.08 1.04l-4.25 4.39a.75.75 0 01-1.08 0L5.21 8.27a.75.75 0 01.02-1.06z" clipRule="evenodd" />
  </svg>
);
const UpDownIcon = () => icn(<><path d="M8 9l4-4 4 4M8 15l4 4 4-4" /></>);
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
    { label: t('nav.dashboard'), to: '/dashboard', icon: <HomeIcon /> },

    {
      label: t('nav.sales'),
      icon: <SalesIcon />,
      perm: 'sales.read',
      groups: [{
        items: [
          { to: '/sales/invoices', label: t('nav.invoices') },
          { to: '/sales/quotes', label: t('nav.quotes') },
          { to: '/sales/payments', label: t('nav.payments') },
          { to: '/sales/returns', label: t('returns.sales_returns_title') },
          { to: '/sales/credit-notes', label: t('returns.credit_notes_title') },
          { to: '/pos', label: t('pos.counter_sales') },
        ],
      }],
    },

    {
      label: t('purchasing.nav_title'),
      icon: <PurchasingIcon />,
      perm: 'purchasing.read',
      groups: [{
        items: [
          { to: '/purchasing/orders', label: t('purchasing.po_title') },
          { to: '/purchasing/grns', label: t('purchasing.grn_title') },
          { to: '/purchasing/bills', label: t('purchasing.bills_title') },
          { to: '/purchasing/payments', label: t('purchasing.vp_title') },
          { to: '/purchasing/expenses', label: 'Expenses' },
          { to: '/purchasing/debit-notes', label: t('returns.debit_notes_title') },
        ],
      }],
    },

    {
      label: t('nav.inventory'),
      icon: <InventoryIcon />,
      perm: 'inventory.read',
      groups: [
        {
          label: 'Catalog',
          items: [
            { to: '/products', label: t('nav.all_products') },
            { to: '/products/categories', label: t('nav.categories') },
            { to: '/products/brands', label: t('nav.brands') },
          ],
        },
        {
          label: 'Stock',
          items: [
            { to: '/inventory/transfers', label: t('inventory.transfers_title') },
            { to: '/inventory/adjustments', label: t('inventory.adjustments_title') },
            { to: '/inventory/stock-ledger', label: t('inventory.stock_ledger_title') },
          ],
        },
      ],
    },

    {
      label: t('nav.accounting'),
      icon: <AccountingIcon />,
      perm: 'accounting.read',
      groups: [
        {
          label: 'Books',
          items: [
            { to: '/accounting/chart-of-accounts', label: t('nav.coa') },
            { to: '/accounting/journal-entries', label: t('nav.journal_entries') },
            { to: '/accounting/general-ledger', label: t('nav.general_ledger') },
            { to: '/accounting/period-lock', label: t('nav.period_lock') },
          ],
        },
        {
          label: t('nav.banking'),
          items: [
            { to: '/banking/transfers', label: t('banking.transfers_title') },
            { to: '/banking/pdc-received', label: t('banking.pdc_received_title') },
            { to: '/banking/pdc-issued', label: t('banking.pdc_issued_title') },
            { to: '/banking/reconciliation', label: 'Bank Reconciliation' },
          ],
        },
      ],
    },

    // Payroll P1 (owner override 2026-06-13)
    {
      label: 'Payroll',
      icon: <PayrollIcon />,
      perm: 'payroll.read',
      groups: [{
        items: [
          { to: '/payroll/runs', label: 'Payroll Runs' },
          { to: '/payroll/employees', label: 'Employees' },
          { to: '/payroll/leave-salary', label: 'Leave Salary' },
        ],
      }],
    },

    {
      label: t('nav.reports'),
      icon: <ReportsIcon />,
      perm: 'reports.read',
      groups: [
        {
          label: 'Financial',
          perm: 'accounting.read',
          items: [
            { to: '/reports/trial-balance', label: t('nav.trial_balance') },
            { to: '/reports/profit-loss', label: t('nav.profit_loss') },
            { to: '/reports/balance-sheet', label: t('nav.balance_sheet') },
            { to: '/reports/cash-flow', label: t('reports.cash_flow') },
            { to: '/reports/vat-return', label: t('reports.vat_return') },
          ],
        },
        {
          label: 'Sales',
          items: [
            { to: '/reports/ar-aging', label: t('nav.ar_aging') },
            { to: '/reports/sales-by-customer', label: t('reports.sales_by_customer') },
            { to: '/reports/sales-by-product', label: t('reports.sales_by_product') },
            { to: '/reports/sales-by-brand', label: t('reports.sales_by_brand') },
            { to: '/reports/sales-by-vehicle', label: t('reports.sales_by_vehicle') },
            { to: '/reports/sales-by-salesperson', label: t('reports.sales_by_salesperson') },
            { to: '/reports/sales-trend', label: t('reports.sales_trend') },
            { to: '/reports/daily-sales', label: t('reports.daily_sales_summary') },
            { to: '/reports/pos-session', label: t('reports.pos_session_report') },
          ],
        },
        {
          label: 'Purchases',
          items: [
            { to: '/reports/ap-aging', label: t('reports.ap_aging') },
            { to: '/reports/supplier-statement', label: t('reports.supplier_statement') },
            { to: '/reports/grn-reconciliation', label: t('reports.grn_reconciliation') },
            { to: '/reports/purchases-by-supplier', label: t('reports.purchases_by_supplier') },
            { to: '/reports/purchases-by-product', label: t('reports.purchases_by_product') },
            { to: '/reports/outstanding-pos', label: t('reports.outstanding_pos') },
          ],
        },
        {
          label: 'Inventory',
          items: [
            { to: '/reports/stock-valuation', label: t('nav.stock_valuation') },
            { to: '/reports/stock-movement', label: t('reports.stock_movement') },
            { to: '/reports/slow-moving', label: t('reports.slow_moving') },
            { to: '/reports/reorder', label: t('reports.reorder') },
            { to: '/reports/stock-aging', label: t('reports.stock_aging') },
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
            { to: '/reports/audit-log', label: t('reports.audit_log') },
            { to: '/reports/reversal-trail', label: t('reports.reversal_trail') },
          ],
        },
      ],
    },

    {
      label: t('nav.contacts'),
      icon: <ContactsIcon />,
      groups: [
        { items: [{ to: '/contacts/customers', label: t('nav.customers') }], perm: 'sales.read' },
        { items: [{ to: '/contacts/suppliers', label: t('nav.suppliers') }], perm: 'purchasing.read' },
      ],
    },
  ];
}

// ── Sidebar ─────────────────────────────────────────────────────────────────
const rowBase = 'flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition-colors';
const rowIdle = 'text-ink-secondary hover:bg-surface-subtle hover:text-ink-primary';
const rowActive = 'bg-brand-50 text-brand-600';

function SidebarSection({
  section,
  open,
  onToggle,
  onNavigate,
  pathname,
}: {
  section: NavSection;
  open: boolean;
  onToggle: () => void;
  onNavigate: () => void;
  pathname: string;
}) {
  // Direct link (Dashboard)
  if (section.to) {
    return (
      <NavLink
        to={section.to}
        onClick={onNavigate}
        className={({ isActive }) => `${rowBase} ${isActive ? rowActive : rowIdle}`}
      >
        {section.icon}
        {section.label}
      </NavLink>
    );
  }

  const groups = section.groups ?? [];
  const sectionActive = groups.some((g) => g.items.some((it) => pathname.startsWith(it.to)));

  return (
    <div>
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        className={`${rowBase} ${sectionActive && !open ? rowActive : rowIdle}`}
      >
        {section.icon}
        <span className="flex-1 text-start">{section.label}</span>
        <ChevronDownIcon className={open ? 'rotate-180' : ''} />
      </button>
      {open && (
        <div className="mb-1 mt-0.5 flex flex-col gap-0.5 border-s border-border-subtle ps-4 ms-[21px]">
          {groups.map((g, gi) => (
            <div key={gi} className="flex flex-col gap-0.5">
              {g.label && (
                <p className="px-3 pb-0.5 pt-2 text-[10px] font-semibold uppercase tracking-wider text-ink-tertiary">
                  {g.label}
                </p>
              )}
              {g.items.map((it) => (
                <NavLink
                  key={it.to}
                  to={it.to}
                  onClick={onNavigate}
                  className={({ isActive }) =>
                    `block rounded-lg px-3 py-1.5 text-[13px] transition-colors ${
                      isActive ? 'bg-brand-50 font-medium text-brand-600' : 'text-ink-secondary hover:bg-surface-subtle hover:text-ink-primary'
                    }`
                  }
                >
                  {it.label}
                </NavLink>
              ))}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function SidebarContent({
  sections,
  onNavigate,
  companyName,
  companySub,
  canSales,
  canPurchasing,
}: {
  sections: NavSection[];
  onNavigate: () => void;
  companyName: string;
  companySub: string;
  canSales: boolean;
  canPurchasing: boolean;
}) {
  const location = useLocation();
  const [openSection, setOpenSection] = useState<string | null>(null);

  // Auto-open the accordion section that owns the current route.
  useEffect(() => {
    const owner = sections.find(
      (s) => !s.to && (s.groups ?? []).some((g) => g.items.some((it) => location.pathname.startsWith(it.to))),
    );
    if (owner) setOpenSection(owner.label);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.pathname]);

  const shortcuts = [
    ...(canSales ? [
      { to: '/sales/invoices/new', label: 'New Invoice', icon: <InvoicePlusIcon /> },
    ] : []),
    ...(canPurchasing ? [
      { to: '/purchasing/bills/new', label: 'New Bill', icon: <BillIcon /> },
    ] : []),
    ...(canSales ? [
      { to: '/sales/payments/new', label: 'Record Receipt', icon: <ReceiptIcon /> },
    ] : []),
    ...(canPurchasing ? [
      { to: '/purchasing/payments/new', label: 'New Payment', icon: <PaymentIcon /> },
    ] : []),
  ];

  return (
    <div className="flex h-full flex-col">
      {/* Brand */}
      <Link to="/dashboard" onClick={onNavigate} className="flex items-center gap-2.5 px-5 pb-4 pt-5">
        <BrandMark size={34} />
        <span className="flex flex-col">
          <span className="text-[14px] font-extrabold leading-tight tracking-[0.08em] text-ink-primary">STOCKBOLT</span>
          <span className="text-[11px] leading-tight text-ink-tertiary">Auto Parts ERP</span>
        </span>
      </Link>

      {/* Nav */}
      <nav className="flex-1 overflow-y-auto px-3 pb-4">
        <div className="flex flex-col gap-0.5">
          {sections.map((section) => (
            <SidebarSection
              key={section.label}
              section={section}
              open={openSection === section.label}
              onToggle={() => setOpenSection((cur) => (cur === section.label ? null : section.label))}
              onNavigate={onNavigate}
              pathname={location.pathname}
            />
          ))}
        </div>

        {shortcuts.length > 0 && (
          <div className="mt-6">
            <p className="px-3 pb-1.5 text-[10px] font-semibold uppercase tracking-[0.12em] text-ink-tertiary">
              Shortcuts
            </p>
            <div className="flex flex-col gap-0.5">
              {shortcuts.map((s) => (
                <NavLink
                  key={s.to}
                  to={s.to}
                  onClick={onNavigate}
                  className={`${rowBase} !py-2 text-[13px] ${rowIdle}`}
                >
                  {s.icon}
                  {s.label}
                </NavLink>
              ))}
            </div>
          </div>
        )}
      </nav>

      {/* Company chip */}
      <Link
        to="/settings/company"
        onClick={onNavigate}
        className="flex items-center gap-2.5 border-t border-border-subtle px-4 py-3.5 transition-colors hover:bg-surface-subtle"
      >
        <CompanyAvatar size={34} fallbackText={companyName || undefined} />
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="truncate text-[13px] font-semibold text-ink-primary">{companyName || '—'}</span>
          <span className="truncate text-[11px] text-ink-tertiary">{companySub}</span>
        </span>
        <span className="text-ink-tertiary"><UpDownIcon /></span>
      </Link>
    </div>
  );
}

// ── Search bar (opens the command palette) ──────────────────────────────────
function SearchBar() {
  const { openPalette } = useShortcutContext();
  return (
    <button
      type="button"
      onClick={openPalette}
      aria-label="Open global search"
      className="flex h-11 w-full max-w-[520px] items-center gap-3 rounded-xl border border-border-subtle bg-white px-4 text-sm text-ink-tertiary transition-colors hover:border-border-strong"
    >
      <span className="text-ink-tertiary"><SearchIcon /></span>
      <span className="flex-1 truncate text-start">Search anything...</span>
      <kbd className="hidden rounded-md border border-border-subtle bg-surface-subtle px-1.5 py-0.5 text-[11px] font-medium text-ink-tertiary sm:inline">
        Ctrl + K
      </kbd>
    </button>
  );
}

// ── User menu dropdown ──────────────────────────────────────────────────────
function UserMenu({ email, companyName, onSignOut }: { email: string | null; companyName: string; onSignOut: () => void }) {
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

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex items-center gap-2 rounded-full py-1 pe-2 ps-1 transition-colors hover:bg-surface-muted"
        aria-label="User menu"
      >
        {/* Phase 28 — company logo if uploaded, else initials avatar. */}
        <CompanyAvatar size={32} fallbackText={email ?? undefined} />
        <span className="hidden max-w-[140px] truncate text-sm font-semibold text-ink-primary md:block">
          {companyName || email || '—'}
        </span>
        <span className="hidden text-ink-tertiary md:block"><ChevronDownIcon /></span>
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

// ── AppLayout ───────────────────────────────────────────────────────────────
interface AppLayoutProps {
  children: ReactNode;
}

export function AppLayout({ children }: AppLayoutProps) {
  const { t } = useTranslation();
  const { email, clear, role, permissions, company_id } = useAuthStore();
  const navigate = useNavigate();
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [sidebarHidden, setSidebarHidden] = useState(false);
  const location = useLocation();
  const currency = useCompanyCurrency();

  // Phase 22 — hide nav sections/groups the role can't read (admin sees all).
  const sections = useNavSections(t)
    .filter((s) => !s.perm || hasPerm(role, permissions, s.perm))
    .map((s) => s.groups
      ? { ...s, groups: s.groups.filter((g) => !g.perm || hasPerm(role, permissions, g.perm)) }
      : s)
    .filter((s) => s.to || (s.groups != null && s.groups.length > 0));

  const canSales = hasPerm(role, permissions, 'sales.read');
  const canPurchasing = hasPerm(role, permissions, 'purchasing.read');

  const { data: company } = useQuery({
    queryKey: ['company', company_id],
    queryFn: () => getAdapter().companies.getById(company_id!),
    enabled: !!company_id,
  });
  const companyName = company?.name ?? '';
  const companySub = `${currency} · ${fiscalYearLabel(company?.fiscal_year_start)}`;

  // Close the mobile drawer whenever the route changes.
  useEffect(() => { setDrawerOpen(false); }, [location.pathname]);

  async function handleSignOut() {
    await getAdapter().auth.signOut();
    clear();
    navigate('/login', { replace: true });
  }

  const sidebarContent = (
    <SidebarContent
      sections={sections}
      onNavigate={() => setDrawerOpen(false)}
      companyName={companyName}
      companySub={companySub}
      canSales={canSales}
      canPurchasing={canPurchasing}
    />
  );

  return (
    <div className="flex h-screen bg-surface-page">
      {/* ── Desktop sidebar ───────────────────────────────────────────── */}
      {/* data-print-hide: the only functioning print-hide attribute app-wide
          (see src/index.css @media print). Without this, any in-app
          window.print() call — including a report's own Print button —
          prints the sidebar/topbar chrome along with the content. */}
      {!sidebarHidden && (
        <aside data-print-hide className="hidden w-[236px] shrink-0 border-e border-border-subtle bg-surface-card lg:block">
          {sidebarContent}
        </aside>
      )}

      {/* ── Mobile drawer ─────────────────────────────────────────────── */}
      {drawerOpen && (
        <div data-print-hide className="fixed inset-0 z-50 lg:hidden">
          <div className="absolute inset-0 bg-black/40" onClick={() => setDrawerOpen(false)} />
          <aside className="absolute start-0 top-0 h-full w-[280px] border-e border-border-subtle bg-surface-card shadow-xl">
            <button
              type="button"
              onClick={() => setDrawerOpen(false)}
              className="absolute end-3 top-5 text-ink-secondary hover:text-ink-primary"
              aria-label="Close menu"
            >
              <XIcon />
            </button>
            {sidebarContent}
          </aside>
        </div>
      )}

      {/* ── Main column ───────────────────────────────────────────────── */}
      <div className="flex min-w-0 flex-1 flex-col">
        <header data-print-hide className="z-30 flex h-16 shrink-0 items-center gap-3 border-b border-border-subtle bg-surface-card px-4 lg:px-6">
          {/* Hamburger — opens the drawer on mobile, collapses the sidebar on desktop */}
          <button
            type="button"
            className="flex h-9 w-9 items-center justify-center rounded-lg text-ink-secondary hover:bg-surface-muted hover:text-ink-primary"
            onClick={() => {
              if (window.innerWidth >= 1024) setSidebarHidden((h) => !h);
              else setDrawerOpen(true);
            }}
            aria-label="Toggle menu"
          >
            <MenuIcon />
          </button>

          <SearchBar />

          <div className="ms-auto flex items-center gap-1.5">
            <LanguageToggle />
            <NotificationsBell />
            <Link
              to="/settings"
              className="flex h-9 w-9 items-center justify-center rounded-full text-ink-secondary hover:bg-surface-muted hover:text-ink-primary"
              aria-label="Settings"
            >
              <CogIcon />
            </Link>
            <UserMenu email={email} companyName={companyName} onSignOut={handleSignOut} />
          </div>
        </header>

        {/* Inner wrapper caps page width so forms don't stretch edge-to-edge
            on large monitors. 1536px (not 1280) because line-item editors
            (invoice/bill/PO) have 10+ columns that get crushed any narrower. */}
        <main className="flex-1 overflow-y-auto p-4 md:p-8">
          <div style={{ maxWidth: '1536px', margin: '0 auto', width: '100%' }}>
            {children}
          </div>
        </main>
      </div>
    </div>
  );
}
