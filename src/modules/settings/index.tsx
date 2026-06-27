/**
 * Settings hub — Phase 12.45, two-paned in Phase 32.x.
 *
 * Renders the card grid (right pane of the SettingsLayout). The section/item
 * spec lives in ./_nav so the hub cards and the pinned left rail stay in sync;
 * this file only layers the live row-counts onto each tile.
 */
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { getAdapter } from '@/data/index';
import { useAuthStore } from '@/store/auth';
import { PageHeader } from '@/ui/primitives';
import { theme } from '@/ui/theme';
import { SETTINGS_SECTIONS, type SettingsNavSection } from './_nav';

interface TileSpec {
  to:        string;
  icon:      string;
  title:     string;
  desc:      string;
  count?:    number | string;
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

  // Live counts — labelled as a pill on the relevant tile.
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

  const countByPath: Record<string, number> = {
    '/settings/warehouses':       warehouses.length,
    '/settings/units':            units.length,
    '/settings/categories':       categories.length,
    '/settings/brands':           brands.length,
    '/settings/vehicles':         vehicles.length,
    '/settings/price-levels':     priceLevels.length,
    '/settings/salespeople':      salespeople.length,
    '/settings/tax-rates':        taxRates.length,
    '/settings/chart-of-accounts': coa.length,
    '/settings/bank-accounts':    banks.length,
  };

  const sections: SectionSpec[] = SETTINGS_SECTIONS.map((s: SettingsNavSection) => ({
    title: s.title,
    tiles: s.items.map((it) => ({ ...it, count: countByPath[it.to] })),
  }));

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
