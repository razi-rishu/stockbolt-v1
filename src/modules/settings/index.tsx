/**
 * Settings hub — Phase 12.45.
 *
 * Single landing page that links to every configurable area in the
 * ERP. Grouped by domain (Company, Catalog, Sales/Tax, Accounting,
 * Printing, Admin) so a new owner can find what they need in one
 * scan. Each tile shows a live count from the relevant table where
 * useful (warehouses: N, brands: N, etc.).
 *
 * Sections deliberately mirror Abdul's mental model:
 *   1. Company & Location  - profile, branches/warehouses, currency, VAT
 *   2. Inventory & Catalog - units, categories, brands, vehicles, price levels
 *   3. Sales & Customers   - salespeople, tax rates, document numbering (v2)
 *   4. Accounting          - chart of accounts, period lock, bank accounts
 *   5. Printing & Hardware - print templates, scanners/printers (v2)
 *   6. Users & Permissions - users, roles (v2)
 *   7. System              - system health, reset data, audit log
 */
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { getAdapter } from '@/data/index';
import { useAuthStore } from '@/store/auth';
import { PageHeader } from '@/ui/primitives';
import { theme } from '@/ui/theme';

interface TileSpec {
  to:        string;
  icon:      string;
  title:     string;
  desc:      string;
  /** Optional count rendered as a small pill in the corner. */
  count?:    number | string;
  /** Marks the tile as not-yet-built; shows a "Coming soon" pill and disables nav. */
  comingSoon?: boolean;
}

interface SectionSpec {
  title: string;
  tiles: TileSpec[];
}

// ── Tile component ─────────────────────────────────────────────────────
function Tile({ tile }: { tile: TileSpec }) {
  const content = (
    <div
      style={{
        background: theme.card,
        border: `1px solid ${theme.border}`,
        borderRadius: '12px',
        boxShadow: theme.shadowSm,
        padding: '16px 18px',
        height: '100%',
        display: 'flex',
        gap: '12px',
        alignItems: 'flex-start',
        transition: 'box-shadow .15s, transform .15s, border-color .15s',
        cursor: tile.comingSoon ? 'not-allowed' : 'pointer',
        opacity: tile.comingSoon ? 0.55 : 1,
      }}
      onMouseEnter={(e) => {
        if (tile.comingSoon) return;
        (e.currentTarget as HTMLElement).style.boxShadow = theme.shadowMd;
        (e.currentTarget as HTMLElement).style.borderColor = theme.brand;
        (e.currentTarget as HTMLElement).style.transform = 'translateY(-1px)';
      }}
      onMouseLeave={(e) => {
        (e.currentTarget as HTMLElement).style.boxShadow = theme.shadowSm;
        (e.currentTarget as HTMLElement).style.borderColor = theme.border;
        (e.currentTarget as HTMLElement).style.transform = 'translateY(0)';
      }}
    >
      {/* Icon tile */}
      <div style={{
        height: '40px', width: '40px',
        background: 'linear-gradient(135deg, #f5f3ff, #ede9fe)',
        color: '#7c3aed',
        borderRadius: '10px',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontSize: '20px',
        flexShrink: 0,
      }}>{tile.icon}</div>

      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', justifyContent: 'space-between' }}>
          <h3 style={{
            margin: 0, fontSize: '13px', fontWeight: 700, color: theme.ink,
            letterSpacing: '-.005em',
          }}>{tile.title}</h3>
          {tile.comingSoon ? (
            <span style={{
              fontSize: '10px', fontWeight: 600,
              color: theme.warn, background: theme.warnSoft,
              border: `1px solid ${theme.warnBorder}`,
              padding: '2px 7px', borderRadius: '999px',
              whiteSpace: 'nowrap',
            }}>Coming soon</span>
          ) : tile.count !== undefined && (
            <span style={{
              fontSize: '11px', fontWeight: 700,
              color: theme.brandSoftText, background: theme.brandSoft,
              padding: '2px 7px', borderRadius: '999px',
              fontFamily: theme.fontMono,
            }}>{tile.count}</span>
          )}
        </div>
        <p style={{
          margin: '4px 0 0', fontSize: '12px', color: theme.inkMuted,
          lineHeight: 1.45,
        }}>{tile.desc}</p>
      </div>
    </div>
  );
  if (tile.comingSoon) return content;
  return <Link to={tile.to} style={{ textDecoration: 'none', color: 'inherit' }}>{content}</Link>;
}

// ── Section ────────────────────────────────────────────────────────────
function Section({ spec }: { spec: SectionSpec }) {
  return (
    <div>
      <h2 style={{
        margin: '0 0 12px',
        fontSize: '11px',
        fontWeight: 700,
        color: theme.inkMuted,
        textTransform: 'uppercase',
        letterSpacing: '.08em',
      }}>{spec.title}</h2>
      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))',
        gap: '12px',
      }}>
        {spec.tiles.map((t) => <Tile key={t.to} tile={t} />)}
      </div>
    </div>
  );
}

// ── Page ───────────────────────────────────────────────────────────────
export default function SettingsHubPage() {
  const { company_id } = useAuthStore();

  // Live counts — used to label each tile so the owner knows the state
  // of each section at a glance. Cheap list() calls, all cached by RQ.
  const { data: warehouses  = [] } = useQuery({ queryKey: ['warehouses',   company_id], queryFn: () => getAdapter().warehouses.list(company_id!),  enabled: !!company_id });
  const { data: units       = [] } = useQuery({ queryKey: ['units',        company_id], queryFn: () => getAdapter().units.list(company_id!),       enabled: !!company_id });
  const { data: categories  = [] } = useQuery({ queryKey: ['categories',   company_id], queryFn: () => getAdapter().categories.list(company_id!),  enabled: !!company_id });
  const { data: brands      = [] } = useQuery({ queryKey: ['brands',       company_id], queryFn: () => getAdapter().brands.list(company_id!),      enabled: !!company_id });
  const { data: vehicles    = [] } = useQuery({ queryKey: ['vehicleMakes', company_id], queryFn: () => getAdapter().vehicleMakes.list(company_id!), enabled: !!company_id });
  const { data: priceLevels = [] } = useQuery({ queryKey: ['priceLevels',  company_id], queryFn: () => getAdapter().priceLevels.list(company_id!), enabled: !!company_id });
  const { data: salespeople = [] } = useQuery({ queryKey: ['salespeople',  company_id], queryFn: () => getAdapter().salespeople.list(company_id!), enabled: !!company_id });
  const { data: taxRates    = [] } = useQuery({ queryKey: ['taxRates',     company_id], queryFn: () => getAdapter().taxRates.list(company_id!),    enabled: !!company_id });
  const { data: coa         = [] } = useQuery({ queryKey: ['coa',          company_id], queryFn: () => getAdapter().coa.list(company_id!),         enabled: !!company_id });
  const { data: banks       = [] } = useQuery({ queryKey: ['bankAccounts', company_id], queryFn: () => getAdapter().bankAccounts.list(company_id!), enabled: !!company_id });

  const sections: SectionSpec[] = [
    {
      title: 'Company & Location',
      tiles: [
        { to: '/settings/company',     icon: '🏢', title: 'Company Profile',  desc: 'Name, logo, tax number, currency, fiscal year start.' },
        { to: '/settings/billing',     icon: '💳', title: 'Billing & Subscription', desc: 'Your plan, trial, payment history and billing address.' },
        { to: '/settings/warehouses',  icon: '🏬', title: 'Warehouses & Branches', desc: 'Storage locations and default branch for new documents.', count: warehouses.length },
      ],
    },
    {
      title: 'Inventory & Catalog',
      tiles: [
        { to: '/settings/units',      icon: '📏', title: 'Units of Measure', desc: 'pcs, kg, m, box — used on product cards and invoices.', count: units.length },
        { to: '/products/categories', icon: '🗂️', title: 'Categories',       desc: 'Hierarchical product categories (Engine, Brakes…).',     count: categories.length },
        { to: '/products/brands',     icon: '🏷️', title: 'Brands',            desc: 'Manufacturer brands (Bosch, Denso, Genuine…).',          count: brands.length },
        { to: '/products/vehicles',   icon: '🚗', title: 'Vehicle Makes',     desc: 'Vehicle compatibility list for parts catalog.',          count: vehicles.length },
        { to: '/settings/price-levels', icon: '💰', title: 'Price Levels',    desc: 'Retail / Wholesale / Trade / Counter pricing tiers.',    count: priceLevels.length },
      ],
    },
    {
      title: 'Sales, Customers & Tax',
      tiles: [
        { to: '/settings/salespeople', icon: '👤', title: 'Salespeople',      desc: 'Master list tagged on invoices/quotes for commission reports.', count: salespeople.length },
        { to: '/settings/tax-rates',   icon: '📊', title: 'Tax Rates',         desc: 'VAT % rates (UAE 5%, zero-rated, exempt) used on lines.',      count: taxRates.length },
        { to: '/settings/exchange-rates', icon: '💱', title: 'Exchange Rates',  desc: 'Manual currency rates used to convert foreign documents to your base currency.' },
        { to: '/settings/numbering',   icon: '🔢', title: 'Document Numbering', desc: 'Format, padding and next-number for every document type.' },
      ],
    },
    {
      title: 'Accounting & Banking',
      tiles: [
        { to: '/accounting/chart-of-accounts', icon: '📒', title: 'Chart of Accounts', desc: 'GL accounts grouped by Asset / Liability / Equity / Income / Expense.', count: coa.length },
        { to: '/accounting/period-lock',       icon: '🔒', title: 'Period Lock',       desc: 'Close accounting periods so no one back-dates entries.' },
        { to: '/settings/bank-accounts',       icon: '🏦', title: 'Bank Accounts',     desc: 'Bank / cash accounts used to receive payments and post expenses.', count: banks.length },
        { to: '/settings/opening-balances',    icon: '⤵️', title: 'Opening Balances',  desc: 'Migrate unpaid invoices / bills / credits from a prior system. Posts to 3010 Opening Balance Equity.' },
        { to: '/settings/import-export',       icon: '📤', title: 'Import / Export',   desc: 'Bulk-load master data from CSV / Excel, or export your current data for backup / reporting.' },
      ],
    },
    {
      title: 'Printing & Hardware',
      tiles: [
        { to: '/settings/print',    icon: '🖨️', title: 'Print Templates', desc: 'Choose invoice/receipt template (Classic, Thermal POS, Trade).' },
        { to: '/settings/hardware', icon: '📷', title: 'Barcode & Printer Setup', desc: 'Configure barcode scanner and receipt printer connections.', comingSoon: true },
      ],
    },
    {
      title: 'Users & Permissions',
      tiles: [
        { to: '/settings/users', icon: '👥', title: 'Users & Roles', desc: 'Invite teammates, assign Admin / Accountant / Sales / Counter / Viewer roles.' },
      ],
    },
    {
      title: 'System & Admin',
      tiles: [
        { to: '/settings/system-health', icon: '✅', title: 'System Health',  desc: 'Runs invariant checks (TB balance, AR matches, stock matches GL).' },
        { to: '/reports/audit-log',      icon: '📋', title: 'Audit Log',      desc: 'Read-only trail of who-did-what across the ERP.' },
        { to: '/settings/reset-data',    icon: '🧹', title: 'Reset Company Data', desc: 'Destructive admin operation — wipes transactions for QA cycles.' },
      ],
    },
  ];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '32px', paddingBottom: '48px' }}>
      <PageHeader
        title="Settings"
        subtitle="Configure every area of StockBolt from one place — company, inventory, accounting, printing, users."
      />

      {sections.map((s) => <Section key={s.title} spec={s} />)}
    </div>
  );
}
