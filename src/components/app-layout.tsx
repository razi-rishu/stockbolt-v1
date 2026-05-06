import { useState, type ReactNode } from 'react';
import { NavLink, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useAuthStore } from '@/store/auth';
import { getAdapter } from '@/data/index';
import { LanguageToggle } from '@/components/language-toggle';

interface NavItem {
  to: string;
  label: string;
  icon: ReactNode;
}

interface NavSection {
  title: string;
  items: NavItem[];
}

function BoltIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="white" className="h-5 w-5">
      <path d="M13 2 3 14h7l-1 8 10-12h-7l1-8z" />
    </svg>
  );
}

function DashboardIcon() {
  return (
    <svg className="h-4 w-4" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6">
      <rect x="2" y="2" width="7" height="7" rx="1.5" /><rect x="11" y="2" width="7" height="7" rx="1.5" />
      <rect x="2" y="11" width="7" height="7" rx="1.5" /><rect x="11" y="11" width="7" height="7" rx="1.5" />
    </svg>
  );
}

function BoxIcon() {
  return (
    <svg className="h-4 w-4" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6">
      <path strokeLinecap="round" strokeLinejoin="round" d="M10 2l8 4v8l-8 4-8-4V6l8-4z" />
      <path strokeLinecap="round" d="M10 14V8m-8-2l8 4 8-4" />
    </svg>
  );
}

function TagIcon() {
  return (
    <svg className="h-4 w-4" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6">
      <path strokeLinecap="round" strokeLinejoin="round" d="M9.293 2.293a1 1 0 011.414 0l6 6a1 1 0 010 1.414l-6 6a1 1 0 01-1.414 0l-6-6a1 1 0 010-1.414l6-6z" />
    </svg>
  );
}

function ShieldIcon() {
  return (
    <svg className="h-4 w-4" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6">
      <path strokeLinecap="round" strokeLinejoin="round" d="M10 2l7 3v5c0 3.5-3 6.5-7 8-4-1.5-7-4.5-7-8V5l7-3z" />
    </svg>
  );
}

function CarIcon() {
  return (
    <svg className="h-4 w-4" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6">
      <path strokeLinecap="round" d="M3 10l2-4h10l2 4M1 14h18M5 14v2m10-2v2" />
      <circle cx="6" cy="13" r="1.5" fill="currentColor" stroke="none" />
      <circle cx="14" cy="13" r="1.5" fill="currentColor" stroke="none" />
    </svg>
  );
}

function BookOpenIcon() {
  return (
    <svg className="h-4 w-4" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6">
      <path strokeLinecap="round" d="M3 4a1 1 0 011-1h5a1 1 0 011 1v12a1 1 0 01-1 1H4a1 1 0 01-1-1V4zM17 4a1 1 0 00-1-1h-5a1 1 0 00-1 1v12a1 1 0 001 1h5a1 1 0 001-1V4z" />
    </svg>
  );
}

function UsersIcon() {
  return (
    <svg className="h-4 w-4" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6">
      <path strokeLinecap="round" d="M13 6a3 3 0 11-6 0 3 3 0 016 0zM18 16a6 6 0 10-12 0" />
      <path strokeLinecap="round" d="M19 16a5 5 0 00-4-4.9" />
    </svg>
  );
}

function TruckIcon() {
  return (
    <svg className="h-4 w-4" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6">
      <path strokeLinecap="round" d="M1 5h12v8H1zM13 8l4 2v3h-4V8z" />
      <circle cx="5" cy="14" r="1.5" fill="currentColor" stroke="none" />
      <circle cx="14.5" cy="14" r="1.5" fill="currentColor" stroke="none" />
    </svg>
  );
}

function ClipboardIcon() {
  return (
    <svg className="h-4 w-4" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6">
      <rect x="4" y="3" width="12" height="14" rx="1.5" />
      <path strokeLinecap="round" d="M7 3v2h6V3" />
      <path strokeLinecap="round" d="M7 9h6M7 12h4" />
    </svg>
  );
}

function ReceiptIcon() {
  return (
    <svg className="h-4 w-4" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6">
      <path strokeLinecap="round" d="M3 2h14v16l-2-1.5-2 1.5-2-1.5-2 1.5-2-1.5-2 1.5V2z" />
      <path strokeLinecap="round" d="M7 7h6M7 10h6M7 13h3" />
    </svg>
  );
}

function CreditCardIcon() {
  return (
    <svg className="h-4 w-4" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6">
      <rect x="1" y="4" width="18" height="12" rx="1.5" />
      <path strokeLinecap="round" d="M1 8h18" />
      <path strokeLinecap="round" d="M4 13h3" />
    </svg>
  );
}

function ArrowsIcon() {
  return (
    <svg className="h-4 w-4" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6">
      <path strokeLinecap="round" strokeLinejoin="round" d="M4 7h12M4 7l3-3M4 7l3 3M16 13H4M16 13l-3-3M16 13l-3 3" />
    </svg>
  );
}

function SliderIcon() {
  return (
    <svg className="h-4 w-4" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6">
      <path strokeLinecap="round" d="M3 5h14M3 10h14M3 15h14" />
      <circle cx="7" cy="5" r="2" fill="white" stroke="currentColor" strokeWidth="1.6" />
      <circle cx="13" cy="10" r="2" fill="white" stroke="currentColor" strokeWidth="1.6" />
      <circle cx="8" cy="15" r="2" fill="white" stroke="currentColor" strokeWidth="1.6" />
    </svg>
  );
}

function RegisterIcon() {
  return (
    <svg className="h-4 w-4" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6">
      <rect x="2" y="7" width="16" height="10" rx="1.5" />
      <path strokeLinecap="round" d="M6 7V5a4 4 0 018 0v2" />
      <path strokeLinecap="round" d="M7 12h2m2 0h2M10 10v4" />
    </svg>
  );
}

function CogIcon() {
  return (
    <svg className="h-4 w-4" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6">
      <circle cx="10" cy="10" r="3" />
      <path strokeLinecap="round" d="M10 1v3m0 12v3M1 10h3m12 0h3m-2.636-6.364l-2.121 2.121M6.757 13.243l-2.121 2.121m0-12.728l2.121 2.121M13.243 13.243l2.121 2.121" />
    </svg>
  );
}

function WarehouseIcon() {
  return (
    <svg className="h-4 w-4" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6">
      <path strokeLinecap="round" d="M2 8l8-5 8 5v9a1 1 0 01-1 1H3a1 1 0 01-1-1V8z" />
      <rect x="7" y="11" width="6" height="7" rx="0.5" />
    </svg>
  );
}

function RulerIcon() {
  return (
    <svg className="h-4 w-4" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6">
      <rect x="2" y="7" width="16" height="6" rx="1" />
      <path strokeLinecap="round" d="M5 7v2m5-2v3m5-3v2" />
    </svg>
  );
}

function PriceTagIcon() {
  return (
    <svg className="h-4 w-4" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6">
      <path strokeLinecap="round" d="M4 4h6l6 6-6 6-6-6V4z" />
      <circle cx="7" cy="7" r="1" fill="currentColor" stroke="none" />
    </svg>
  );
}

function LedgerIcon() {
  return (
    <svg className="h-4 w-4" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6">
      <rect x="3" y="2" width="14" height="16" rx="1.5" />
      <path strokeLinecap="round" d="M7 6h6M7 10h6M7 14h4" />
    </svg>
  );
}

function JournalIcon() {
  return (
    <svg className="h-4 w-4" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6">
      <rect x="4" y="2" width="12" height="16" rx="1" />
      <path strokeLinecap="round" d="M7 7h6M7 10h6M7 13h3" />
      <path strokeLinecap="round" d="M2 5h2M2 10h2M2 15h2" />
    </svg>
  );
}

function ChartIcon() {
  return (
    <svg className="h-4 w-4" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6">
      <path strokeLinecap="round" d="M2 14l4-4 4 2 4-6 4 2" />
      <path strokeLinecap="round" d="M2 17h16" />
    </svg>
  );
}

function LockIcon() {
  return (
    <svg className="h-4 w-4" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6">
      <rect x="4" y="9" width="12" height="9" rx="1.5" />
      <path strokeLinecap="round" d="M7 9V6a3 3 0 016 0v3" />
    </svg>
  );
}

function SidebarNavLink({ to, icon, label }: { to: string; icon: ReactNode; label: string }) {
  return (
    <NavLink
      to={to}
      className={({ isActive }) =>
        `flex items-center gap-2.5 rounded-card px-3 py-2 text-sm transition-colors ${
          isActive
            ? 'bg-brand-50 font-medium text-brand-600'
            : 'text-ink-secondary hover:bg-surface-muted hover:text-ink-primary'
        }`
      }
    >
      {icon}
      {label}
    </NavLink>
  );
}

interface AppLayoutProps {
  children: ReactNode;
}

export function AppLayout({ children }: AppLayoutProps) {
  const { t } = useTranslation();
  const { email, clear } = useAuthStore();
  const navigate = useNavigate();
  const [sidebarOpen, setSidebarOpen] = useState(false);

  async function handleSignOut() {
    await getAdapter().auth.signOut();
    clear();
    navigate('/login', { replace: true });
  }

  const sections: NavSection[] = [
    {
      title: '',
      items: [
        { to: '/dashboard', label: t('nav.dashboard'), icon: <DashboardIcon /> },
      ],
    },
    {
      title: t('nav.products'),
      items: [
        { to: '/products', label: t('nav.all_products'), icon: <BoxIcon /> },
        { to: '/products/categories', label: t('nav.categories'), icon: <TagIcon /> },
        { to: '/products/brands', label: t('nav.brands'), icon: <ShieldIcon /> },
        { to: '/products/vehicles', label: t('nav.vehicles'), icon: <CarIcon /> },
        { to: '/catalog', label: t('nav.parts_catalog'), icon: <BookOpenIcon /> },
      ],
    },
    {
      title: t('nav.contacts'),
      items: [
        { to: '/contacts/customers', label: t('nav.customers'), icon: <UsersIcon /> },
        { to: '/contacts/suppliers', label: t('nav.suppliers'), icon: <TruckIcon /> },
      ],
    },
    {
      title: t('nav.sales'),
      items: [
        { to: '/sales/invoices',      label: t('nav.invoices'),                    icon: <JournalIcon /> },
        { to: '/sales/quotes',        label: t('nav.quotes'),                      icon: <LedgerIcon /> },
        { to: '/sales/payments',      label: t('nav.payments'),                    icon: <ChartIcon /> },
        { to: '/sales/returns',       label: t('returns.sales_returns_title'),     icon: <ArrowsIcon /> },
        { to: '/sales/credit-notes',  label: t('returns.credit_notes_title'),      icon: <ReceiptIcon /> },
      ],
    },
    {
      title: t('purchasing.nav_title'),
      items: [
        { to: '/purchasing/orders',      label: t('purchasing.po_title'),    icon: <ClipboardIcon /> },
        { to: '/purchasing/grns',        label: t('purchasing.grn_title'),   icon: <TruckIcon /> },
        { to: '/purchasing/bills',       label: t('purchasing.bills_title'), icon: <ReceiptIcon /> },
        { to: '/purchasing/payments',    label: t('purchasing.vp_title'),    icon: <CreditCardIcon /> },
        { to: '/purchasing/debit-notes', label: t('returns.debit_notes_title'), icon: <ArrowsIcon /> },
      ],
    },
    {
      title: t('nav.inventory'),
      items: [
        { to: '/inventory/transfers',   label: t('inventory.transfers_title'),   icon: <ArrowsIcon /> },
        { to: '/inventory/adjustments', label: t('inventory.adjustments_title'), icon: <SliderIcon /> },
        { to: '/inventory/stock-ledger',label: t('inventory.stock_ledger_title'),icon: <LedgerIcon /> },
      ],
    },
    {
      title: t('nav.pos'),
      items: [
        { to: '/pos', label: t('pos.counter_sales'), icon: <RegisterIcon /> },
      ],
    },
    {
      title: t('nav.banking'),
      items: [
        { to: '/banking/transfers',    label: t('banking.transfers_title'),    icon: <ArrowsIcon /> },
        { to: '/banking/expenses',     label: t('banking.expenses_title'),     icon: <ReceiptIcon /> },
        { to: '/banking/pdc-received', label: t('banking.pdc_received_title'), icon: <CreditCardIcon /> },
        { to: '/banking/pdc-issued',   label: t('banking.pdc_issued_title'),   icon: <CreditCardIcon /> },
      ],
    },
    {
      title: t('nav.accounting'),
      items: [
        { to: '/accounting/chart-of-accounts', label: t('nav.coa'), icon: <LedgerIcon /> },
        { to: '/accounting/journal-entries', label: t('nav.journal_entries'), icon: <JournalIcon /> },
        { to: '/accounting/general-ledger', label: t('nav.general_ledger'), icon: <BookOpenIcon /> },
        { to: '/accounting/period-lock', label: t('nav.period_lock'), icon: <LockIcon /> },
      ],
    },
    {
      title: t('nav.reports'),
      items: [
        { to: '/reports/trial-balance',        label: t('nav.trial_balance'),          icon: <ChartIcon /> },
        { to: '/reports/profit-loss',          label: t('nav.profit_loss'),            icon: <ChartIcon /> },
        { to: '/reports/balance-sheet',        label: t('nav.balance_sheet'),          icon: <LedgerIcon /> },
        { to: '/reports/ar-aging',             label: t('nav.ar_aging'),               icon: <UsersIcon /> },
        { to: '/reports/ap-aging',             label: t('reports.ap_aging'),           icon: <TruckIcon /> },
        { to: '/reports/stock-valuation',      label: t('nav.stock_valuation'),        icon: <BoxIcon /> },
        { to: '/reports/supplier-statement',   label: t('reports.supplier_statement'), icon: <ReceiptIcon /> },
        { to: '/reports/grn-reconciliation',         label: t('reports.grn_reconciliation'),          icon: <ClipboardIcon /> },
        { to: '/reports/stock-movement',             label: t('reports.stock_movement'),              icon: <ArrowsIcon /> },
        { to: '/reports/slow-moving',                label: t('reports.slow_moving'),                 icon: <BoxIcon /> },
        { to: '/reports/reorder',                    label: t('reports.reorder'),                     icon: <TruckIcon /> },
        { to: '/reports/stock-aging',                label: t('reports.stock_aging'),                 icon: <ChartIcon /> },
        { to: '/reports/inventory-adjustment-report',label: t('reports.inventory_adjustment_report'), icon: <SliderIcon /> },
        { to: '/reports/pos-session',                label: t('reports.pos_session_report'),          icon: <RegisterIcon /> },
        { to: '/reports/daily-sales',                label: t('reports.daily_sales_summary'),         icon: <ChartIcon /> },
        { to: '/reports/daily-cash',                 label: t('reports.daily_cash_title'),            icon: <ChartIcon /> },
        { to: '/reports/bank-recon',                 label: t('reports.bank_recon_title'),            icon: <LedgerIcon /> },
        { to: '/reports/sales-by-customer',          label: t('reports.sales_by_customer'),           icon: <ChartIcon /> },
        { to: '/reports/sales-by-product',           label: t('reports.sales_by_product'),            icon: <ChartIcon /> },
        { to: '/reports/sales-by-brand',             label: t('reports.sales_by_brand'),              icon: <ChartIcon /> },
        { to: '/reports/sales-by-vehicle',           label: t('reports.sales_by_vehicle'),            icon: <ChartIcon /> },
        { to: '/reports/sales-by-salesperson',       label: t('reports.sales_by_salesperson'),        icon: <ChartIcon /> },
        { to: '/reports/sales-trend',                label: t('reports.sales_trend'),                 icon: <ChartIcon /> },
        { to: '/reports/purchases-by-supplier',      label: t('reports.purchases_by_supplier'),       icon: <LedgerIcon /> },
        { to: '/reports/purchases-by-product',       label: t('reports.purchases_by_product'),        icon: <LedgerIcon /> },
        { to: '/reports/outstanding-pos',            label: t('reports.outstanding_pos'),             icon: <ClipboardIcon /> },
        { to: '/reports/vat-return',                 label: t('reports.vat_return'),                  icon: <ReceiptIcon /> },
        { to: '/reports/cash-flow',                  label: t('reports.cash_flow'),                   icon: <ChartIcon /> },
        { to: '/reports/audit-log',                  label: t('reports.audit_log'),                   icon: <JournalIcon /> },
        { to: '/reports/reversal-trail',             label: t('reports.reversal_trail'),              icon: <JournalIcon /> },
      ],
    },
    {
      title: t('nav.settings'),
      items: [
        { to: '/settings/company',       label: t('nav.company'),       icon: <CogIcon /> },
        { to: '/settings/warehouses',    label: t('nav.warehouses'),    icon: <WarehouseIcon /> },
        { to: '/settings/units',         label: t('nav.units'),         icon: <RulerIcon /> },
        { to: '/settings/price-levels',  label: t('nav.price_levels'),  icon: <PriceTagIcon /> },
        { to: '/settings/system-health', label: t('settings.system_health'), icon: <CogIcon /> },
        { to: '/settings/print',         label: t('print.settings_title'),   icon: <CogIcon /> },
      ],
    },
  ];

  const sidebarContent = (
    <nav className="flex h-full flex-col">
      {/* Logo */}
      <div className="flex items-center gap-2.5 px-4 py-5">
        <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-brand-500">
          <BoltIcon />
        </div>
        <span className="font-semibold text-ink-primary">StockBolt</span>
      </div>

      {/* Nav sections */}
      <div className="flex-1 overflow-y-auto px-3 pb-4">
        {sections.map((section, si) => (
          <div key={si} className={si > 0 ? 'mt-5' : ''}>
            {section.title && (
              <p className="mb-1 px-3 text-xs font-semibold uppercase tracking-wider text-ink-tertiary">
                {section.title}
              </p>
            )}
            <div className="flex flex-col gap-0.5">
              {section.items.map((item) => (
                <SidebarNavLink key={item.to} {...item} />
              ))}
            </div>
          </div>
        ))}
      </div>

      {/* User footer */}
      <div className="border-t border-border-subtle px-3 py-3">
        <div className="flex items-center justify-between gap-2">
          <span className="truncate text-xs text-ink-tertiary">{email}</span>
          <button
            onClick={handleSignOut}
            className="shrink-0 rounded-pill px-2.5 py-1 text-xs text-ink-secondary transition-colors hover:bg-surface-muted hover:text-ink-primary"
          >
            {t('common.sign_out')}
          </button>
        </div>
      </div>
    </nav>
  );

  return (
    <div className="flex h-screen bg-surface-page">
      {/* Sidebar — desktop */}
      <aside className="hidden w-56 shrink-0 flex-col border-e border-border-subtle bg-surface-card lg:flex">
        {sidebarContent}
      </aside>

      {/* Sidebar — mobile overlay */}
      {sidebarOpen && (
        <div className="fixed inset-0 z-40 lg:hidden">
          <div className="absolute inset-0 bg-black/40" onClick={() => setSidebarOpen(false)} />
          <aside className="absolute start-0 top-0 h-full w-56 border-e border-border-subtle bg-surface-card">
            {sidebarContent}
          </aside>
        </div>
      )}

      {/* Main area */}
      <div className="flex flex-1 flex-col overflow-hidden">
        {/* Top bar */}
        <header className="flex h-14 shrink-0 items-center justify-between border-b border-border-subtle bg-surface-card px-4">
          <button
            className="flex h-8 w-8 items-center justify-center rounded-card text-ink-secondary hover:bg-surface-muted lg:hidden"
            onClick={() => setSidebarOpen(true)}
          >
            <svg className="h-5 w-5" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6">
              <path strokeLinecap="round" d="M3 5h14M3 10h14M3 15h14" />
            </svg>
          </button>
          <div className="flex-1" />
          <LanguageToggle />
        </header>

        {/* Page content */}
        <main className="flex-1 overflow-y-auto p-6">
          {children}
        </main>
      </div>
    </div>
  );
}
