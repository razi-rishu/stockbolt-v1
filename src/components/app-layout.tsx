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
import { navLinkEnabled } from '@/core/global-config';
import { useEnabledModules } from '@/hooks/use-enabled-modules';
import { CompanyAvatar } from '@/components/company-avatar';
import { useShortcutContext } from '@/keyboard/shortcut-registry';
import { NotificationsBell } from '@/components/notifications-bell';
import { BrandMark } from '@/components/brand-logo';
import { useCompanyCurrency, useProjectsEnabled } from '@/hooks/use-company-currency';
import { fiscalYearLabel } from '@/lib/locale';
import { useBackHandler } from '@/navigation/use-back-handler';
import { isAppShell } from '@/lib/platform';
import { AppShell } from '@/app-shell/AppShell';
import '@/styles/stockbolt-ocean-teal.css';

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
// A bank front: columns under a pediment. Deliberately not a card or a
// wallet — those read as payment, and this section is the institution.
const ProjectsIcon   = () => icn(<><rect x="2.5" y="7" width="19" height="13" rx="2" /><path d="M9 7V5a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v2" /><path d="M2.5 12h19" /></>);
const BankIcon       = () => icn(<><path d="M3 10h18M4 10 12 4l8 6" /><path d="M6 10v7M10 10v7M14 10v7M18 10v7" /><path d="M3 20h18" /></>);
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
  // phase104 — Projects is a per-tenant module. A company that has not asked
  // for job costing never sees the section at all; the page re-checks the same
  // flag, so a bookmarked URL cannot get in either. `perm` is filtered
  // separately below, so this is the module switch, not the permission check.
  const projectsEnabled = useProjectsEnabled();
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
          // Z3 — Sales Returns is gone from the menu: the credit note is the
          // document now, and two entries for one event was the confusion
          // this set out to remove. The ROUTES stay alive so every return
          // ever raised is still readable and printable at its own URL, and
          // the credit notes page links to the list while any exist.
          { to: '/sales/credit-notes', label: t('returns.credit_notes_title') },
          { to: '/pos', label: t('pos.counter_sales') },
        ],
      }],
    },

    ...(projectsEnabled
      ? [{
          label: t('nav.projects'),
          to: '/projects',
          icon: <ProjectsIcon />,
          perm: 'sales.read',
        } as NavSection]
      : []),

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
          { to: '/purchasing/expenses', label: t('banking.expenses_title') },
          // Z6 — mirror of Z3: the debit note is the document on this side
          // too. The ROUTES stay alive so every purchase return ever raised
          // is still readable, and the debit notes page links to the list
          // while any exist.
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
          label: t('navOcean.catalog'),
          items: [
            { to: '/products', label: t('nav.all_products') },
            { to: '/products/categories', label: t('nav.categories') },
            { to: '/products/brands', label: t('nav.brands') },
          ],
        },
        {
          label: t('navOcean.stock'),
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
      // 'Books' was only a heading to separate these from Banking. With
      // Banking promoted out, a lone labelled group is just a redundant
      // header, so this matches every other single-group section.
      groups: [
        {
          items: [
            { to: '/accounting/chart-of-accounts', label: t('nav.coa') },
            { to: '/accounting/journal-entries', label: t('nav.journal_entries') },
            { to: '/accounting/general-ledger', label: t('nav.general_ledger') },
            { to: '/accounting/period-lock', label: t('nav.period_lock') },
            { to: '/accounting/year-end-close', label: t('nav.year_end_close') },
            { to: '/accounting/tax-return', label: t('nav.tax_return') },
            { to: '/accounting/fixed-assets', label: t('nav.fixed_assets') },
            { to: '/accounting/amortization', label: t('nav.amortization') },
            { to: '/accounting/tds', label: t('nav.tds') },
          ],
        },
      ],
    },

    // Banking was a GROUP buried inside Accounting, which is where you look
    // for the chart of accounts, not for a cheque. It is its own section
    // now. Same permission as before (accounting.read), so nobody gains or
    // loses access — this moves where the links live, nothing else.
    {
      label: t('nav.banking'),
      icon: <BankIcon />,
      perm: 'accounting.read',
      groups: [{
        items: [
          // The accounts come first: a section called Banking that does not
          // list your banks is the obvious thing to look for and miss.
          // Phase 95 moved the page here properly, out of the Settings shell.
          { to: '/banking/bank-accounts', label: t('banking.accounts_title') },
          { to: '/banking/transfers', label: t('banking.transfers_title') },
          { to: '/banking/pdc-received', label: t('banking.pdc_received_title') },
          { to: '/banking/pdc-issued', label: t('banking.pdc_issued_title') },
          { to: '/banking/reconciliation', label: t('banking.reconciliation_title') },
        ],
      }],
    },

    // Payroll P1 (owner override 2026-06-13)
    {
      label: t('navOcean.payroll'),
      icon: <PayrollIcon />,
      perm: 'payroll.read',
      groups: [{
        items: [
          { to: '/payroll/runs', label: t('navOcean.payroll_runs') },
          { to: '/payroll/employees', label: t('navOcean.employees') },
          { to: '/payroll/leave-salary', label: t('navOcean.leave_salary') },
        ],
      }],
    },

    {
      label: t('nav.reports'),
      icon: <ReportsIcon />,
      perm: 'reports.read',
      groups: [
        {
          label: t('navOcean.rg_financial'),
          perm: 'accounting.read',
          items: [
            { to: '/reports/trial-balance', label: t('nav.trial_balance') },
            { to: '/reports/profit-loss', label: t('nav.profit_loss') },
            { to: '/reports/balance-sheet', label: t('nav.balance_sheet') },
            { to: '/reports/cash-flow', label: t('reports.cash_flow') },
            { to: '/reports/vat-return', label: t('reports.vat_return') },
          ],
        },
        ...(projectsEnabled
          ? [{
              label: t('projects.title'),
              items: [
                { to: '/reports/project-profitability', label: t('projects.report_title') },
              ],
            }]
          : []),
        {
          label: t('navOcean.rg_sales'),
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
          label: t('navOcean.rg_purchases'),
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
          label: t('navOcean.rg_inventory'),
          items: [
            { to: '/reports/stock-valuation', label: t('nav.stock_valuation') },
            { to: '/reports/fixed-asset-register', label: t('reports.far_title') },
            { to: '/reports/depreciation-schedule', label: t('reports.ds_title') },
            { to: '/reports/stock-movement', label: t('reports.stock_movement') },
            { to: '/reports/slow-moving', label: t('reports.slow_moving') },
            { to: '/reports/reorder', label: t('reports.reorder') },
            { to: '/reports/stock-aging', label: t('reports.stock_aging') },
            { to: '/reports/inventory-adjustment-report', label: t('reports.inventory_adjustment_report') },
            // R6a — covers BOTH trade directions, so it does not belong under
            // Sales or Purchases; its headline figure is an inventory write-off.
            { to: '/reports/returns-analysis', label: t('reports.returns_analysis') },
          ],
        },
        {
          label: t('navOcean.rg_banking'),
          items: [
            { to: '/reports/daily-cash', label: t('reports.daily_cash_title') },
            { to: '/reports/bank-recon', label: t('reports.bank_recon_title') },
          ],
        },
        {
          label: t('navOcean.rg_audit'),
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
// Ocean Teal (UI v1.1): every row carries its icon in a soft tile; the active
// section's tile turns teal. Same links, permissions and accordion as before.
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
  // Direct link (Dashboard, Projects)
  if (section.to) {
    return (
      <NavLink
        to={section.to}
        onClick={onNavigate}
        className={({ isActive }) => `sb-side-row ${isActive ? 'active' : ''}`}
      >
        <span className="sb-side-ico">{section.icon}</span>
        <span className="sb-side-label">{section.label}</span>
      </NavLink>
    );
  }

  const groups = section.groups ?? [];
  const sectionActive = groups.some((g) => g.items.some((it) => pathname.startsWith(it.to)));

  return (
    <div className={`sb-side-section ${open ? 'open' : ''}`}>
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        className={`sb-side-row ${sectionActive ? 'active' : ''}`}
      >
        <span className="sb-side-ico">{section.icon}</span>
        <span className="sb-side-label">{section.label}</span>
        <span className="sb-side-chev"><ChevronDownIcon className={open ? 'rotate-180' : ''} /></span>
      </button>
      {open && (
        <div className="sb-side-sub">
          {groups.map((g, gi) => (
            <div key={gi} className="sb-side-group">
              {g.label && <p className="sb-side-group-label">{g.label}</p>}
              {g.items.map((it) => (
                <NavLink
                  key={it.to}
                  to={it.to}
                  onClick={onNavigate}
                  className={({ isActive }) => `sb-side-item ${isActive ? 'active' : ''}`}
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

/** Quick-create links — sidebar "Shortcuts" on the web, quick actions in the app menu. */
function buildShortcuts(canSales: boolean, canPurchasing: boolean, t: (k: string) => string) {
  return [
    ...(canSales ? [
      { to: '/sales/invoices/new', label: t('sales.new_invoice'), icon: <InvoicePlusIcon /> },
    ] : []),
    ...(canPurchasing ? [
      { to: '/purchasing/bills/new', label: t('purchasing.new_bill'), icon: <BillIcon /> },
    ] : []),
    ...(canSales ? [
      { to: '/sales/payments/new', label: t('shortcutsOcean.record_receipt'), icon: <ReceiptIcon /> },
    ] : []),
    ...(canPurchasing ? [
      { to: '/purchasing/payments/new', label: t('purchasing.new_vp'), icon: <PaymentIcon /> },
    ] : []),
  ];
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
  const { t } = useTranslation();
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

  const shortcuts = buildShortcuts(canSales, canPurchasing, t);

  return (
    <div className="sb-side flex h-full flex-col">
      {/* Brand */}
      <Link to="/dashboard" onClick={onNavigate} className="sb-side-brand">
        <BrandMark size={34} />
        <span className="flex flex-col">
          <span className="sb-side-brand-name">STOCKBOLT</span>
          <span className="sb-side-brand-sub">{t('navOcean.tagline')}</span>
        </span>
      </Link>

      {/* Nav */}
      <nav className="sb-side-nav flex-1 overflow-y-auto" aria-label={t('navOcean.main_menu')}>
        <div className="flex flex-col gap-1">
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
          <div className="sb-side-shortcuts">
            <p className="sb-side-group-label" style={{ paddingInline: 6 }}>{t('navOcean.shortcuts')}</p>
            <div className="sb-side-short-grid">
              {shortcuts.map((s) => (
                <NavLink key={s.to} to={s.to} onClick={onNavigate} className="sb-side-short">
                  <span className="sb-side-short-ico">{s.icon}</span>
                  <span className="sb-side-short-label">{s.label}</span>
                </NavLink>
              ))}
            </div>
          </div>
        )}
      </nav>

      {/* Company chip */}
      <Link to="/settings/company" onClick={onNavigate} className="sb-side-company">
        <CompanyAvatar size={36} fallbackText={companyName || undefined} />
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="sb-side-company-name">{companyName || '—'}</span>
          <span className="sb-side-company-sub">{companySub}</span>
        </span>
        <span className="sb-side-chev"><UpDownIcon /></span>
      </Link>
    </div>
  );
}

// ── Search bar (opens the command palette) ──────────────────────────────────
function SearchBar() {
  const { t } = useTranslation();
  const { openPalette } = useShortcutContext();
  return (
    <button
      type="button"
      onClick={openPalette}
      aria-label={t('navOcean.open_search')}
      className="sb-top-search flex h-9 w-9 shrink-0 items-center justify-center gap-3 text-sm sm:h-11 sm:w-full sm:max-w-[520px] sm:shrink sm:justify-start sm:px-4"
    >
      <span className="sb-top-search-ico"><SearchIcon /></span>
      {/* Phones get the icon only, so the top bar fits the screen width. */}
      <span className="hidden flex-1 truncate text-start sm:block">{t('navOcean.search_ph')}</span>
      <kbd dir="ltr" className="sb-top-kbd hidden sm:inline">
        Ctrl + K
      </kbd>
    </button>
  );
}

// ── User menu dropdown ──────────────────────────────────────────────────────
function UserMenu({ email, companyName, onSignOut }: { email: string | null; companyName: string; onSignOut: () => void }) {
  const { t } = useTranslation();
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
        className="sb-top-user flex items-center gap-2 rounded-full py-1 pe-2 ps-1 transition-colors"
        aria-label={t('navOcean.user_menu')}
      >
        {/* Phase 28 — company logo if uploaded, else initials avatar. */}
        <CompanyAvatar size={32} fallbackText={email ?? undefined} />
        <span className="hidden max-w-[140px] truncate text-sm font-semibold text-ink-primary md:block">
          {companyName || email || '—'}
        </span>
        <span className="hidden text-ink-tertiary md:block"><ChevronDownIcon /></span>
      </button>
      {open && (
        <div className="sb-top-pop absolute end-0 z-50 mt-2 w-60 overflow-hidden">
          <div className="border-b border-border-subtle px-4 py-3">
            <p className="truncate text-xs text-ink-tertiary">{t('navOcean.signed_in_as')}</p>
            <p className="truncate text-sm font-medium text-ink-primary">{email ?? '—'}</p>
          </div>
          <ul className="py-1">
            <li>
              <Link
                to="/settings/company"
                onClick={() => setOpen(false)}
                className="sb-top-pop-item"
              >
                {t('navOcean.company_settings')}
              </Link>
            </li>
            <li>
              <Link
                to="/settings/system-health"
                onClick={() => setOpen(false)}
                className="sb-top-pop-item"
              >
                {t('navOcean.system_health')}
              </Link>
            </li>
            <li className="border-t border-border-subtle">
              <button
                type="button"
                onClick={() => { setOpen(false); onSignOut(); }}
                className="sb-top-pop-item is-danger"
              >
                {t('navOcean.sign_out')}
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

  // Global v1 — links into a module the company has switched off are hidden;
  // ModuleGate refuses the same URLs. A legacy company has every module on.
  const { modules } = useEnabledModules();
  const linkOn = (to: string) => navLinkEnabled(to, modules);

  // Phase 22 — hide nav sections/groups the role can't read (admin sees all).
  const sections = useNavSections(t)
    .filter((s) => !s.perm || hasPerm(role, permissions, s.perm))
    .filter((s) => !s.to || linkOn(s.to))
    .map((s) => s.groups
      ? { ...s, groups: s.groups
          .filter((g) => !g.perm || hasPerm(role, permissions, g.perm))
          .map((g) => ({ ...g, items: g.items.filter((it) => linkOn(it.to)) }))
          .filter((g) => g.items.length > 0) }
      : s)
    .filter((s) => s.to || (s.groups != null && s.groups.length > 0));

  const canSales = hasPerm(role, permissions, 'sales.read') && linkOn('/sales/invoices');
  const canPurchasing = hasPerm(role, permissions, 'purchasing.read') && linkOn('/purchasing/bills');

  const { data: company } = useQuery({
    queryKey: ['company', company_id],
    queryFn: () => getAdapter().companies.getById(company_id!),
    enabled: !!company_id,
  });
  const companyName = company?.name ?? '';
  const companySub = `${currency} · ${fiscalYearLabel(company?.fiscal_year_start)}`;

  // Close the mobile drawer whenever the route changes.
  useEffect(() => { setDrawerOpen(false); }, [location.pathname]);
  useBackHandler(drawerOpen, () => setDrawerOpen(false));

  async function handleSignOut() {
    await getAdapter().auth.signOut();
    clear();
    navigate('/login', { replace: true });
  }

  // Android app: phone layout with bottom tabs (src/app-shell). The website never takes this branch.
  if (isAppShell()) {
    return (
      <AppShell
        sections={sections}
        shortcuts={buildShortcuts(canSales, canPurchasing, t)}
        companyName={companyName}
        companySub={companySub}
        email={email}
        canSales={canSales}
        canInventory={hasPerm(role, permissions, 'inventory.read') && linkOn('/products')}
        onSignOut={handleSignOut}
      >
        {children}
      </AppShell>
    );
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
        <aside data-print-hide className="sb-ocean sb-side-aside hidden w-[248px] shrink-0 lg:block">
          {sidebarContent}
        </aside>
      )}

      {/* ── Mobile drawer ─────────────────────────────────────────────── */}
      {drawerOpen && (
        <div data-print-hide className="fixed inset-0 z-50 lg:hidden">
          <div className="absolute inset-0 bg-black/40" onClick={() => setDrawerOpen(false)} />
          <aside className="sb-ocean sb-side-aside absolute start-0 top-0 h-full w-[284px] shadow-xl">
            <button
              type="button"
              onClick={() => setDrawerOpen(false)}
              className="sb-top-iconbtn absolute end-3 top-5"
              aria-label={t('navOcean.close_menu')}
            >
              <XIcon />
            </button>
            {sidebarContent}
          </aside>
        </div>
      )}

      {/* ── Main column ───────────────────────────────────────────────── */}
      <div className="flex min-w-0 flex-1 flex-col">
        <header data-print-hide className="sb-ocean sb-top-bar z-30 flex h-16 shrink-0 items-center gap-3 px-4 lg:px-6">
          {/* Hamburger — opens the drawer on mobile, collapses the sidebar on desktop */}
          <button
            type="button"
            className="sb-top-iconbtn"
            onClick={() => {
              if (window.innerWidth >= 1024) setSidebarHidden((h) => !h);
              else setDrawerOpen(true);
            }}
            aria-label={t('navOcean.toggle_menu')}
          >
            <MenuIcon />
          </button>

          <SearchBar />

          <div className="ms-auto flex items-center gap-1.5">
            <LanguageToggle />
            <NotificationsBell />
            {/* Hidden on phones to fit the bar — Settings stays in the menu drawer and user menu. */}
            <Link
              to="/settings"
              className="sb-top-iconbtn hidden sm:flex"
              aria-label={t('nav.settings')}
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
