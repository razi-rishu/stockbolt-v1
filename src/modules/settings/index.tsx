/**
 * Settings hub — Phase 12.45, two-paned in Phase 32.x.
 *
 * Renders the card grid (right pane of the SettingsLayout). The section/item
 * spec lives in ./_nav so the hub cards and the pinned left rail stay in sync;
 * this file only layers the live row-counts onto each tile.
 */
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Search, ChevronRight } from 'lucide-react';
import { getAdapter } from '@/data/index';
import { useAuthStore } from '@/store/auth';
import { visibleSettingsSections } from './_nav';
import { itemIcon, itemTitle, itemDesc, sectionTitle, itemKey } from './_nav-ocean';
import { useEnabledModules } from '@/hooks/use-enabled-modules';
import '@/styles/stockbolt-ocean-teal.css';

// ── Page ───────────────────────────────────────────────────────────────
export default function SettingsHubPage() {
  const { company_id } = useAuthStore();

  // Live counts — labelled as a pill on the relevant tile.
  const { data: warehouses      } = useQuery({ queryKey: ['warehouses',   company_id], queryFn: () => getAdapter().warehouses.list(company_id!),  enabled: !!company_id });
  const { data: units           } = useQuery({ queryKey: ['units',        company_id], queryFn: () => getAdapter().units.list(company_id!),       enabled: !!company_id });
  const { data: categories      } = useQuery({ queryKey: ['categories',   company_id], queryFn: () => getAdapter().categories.list(company_id!),  enabled: !!company_id });
  const { data: brands          } = useQuery({ queryKey: ['brands',       company_id], queryFn: () => getAdapter().brands.list(company_id!),      enabled: !!company_id });
  const { data: vehicles        } = useQuery({ queryKey: ['vehicleMakes', company_id], queryFn: () => getAdapter().vehicleMakes.list(company_id!), enabled: !!company_id });
  const { data: priceLevels     } = useQuery({ queryKey: ['priceLevels',  company_id], queryFn: () => getAdapter().priceLevels.list(company_id!), enabled: !!company_id });
  const { data: salespeople     } = useQuery({ queryKey: ['salespeople',  company_id], queryFn: () => getAdapter().salespeople.list(company_id!), enabled: !!company_id });
  const { data: taxRates        } = useQuery({ queryKey: ['taxRates',     company_id], queryFn: () => getAdapter().taxRates.list(company_id!),    enabled: !!company_id });
  const { data: coa             } = useQuery({ queryKey: ['coa',          company_id], queryFn: () => getAdapter().coa.list(company_id!),         enabled: !!company_id });

  // undefined while a list is still loading, so the tile shows no pill rather
  // than a misleading 0 (pilot finding: Units of Measure flashed 0, then 5).
  const countByPath: Record<string, number | undefined> = {
    '/settings/warehouses':       warehouses?.length,
    '/settings/units':            units?.length,
    '/settings/categories':       categories?.length,
    '/settings/brands':           brands?.length,
    '/settings/vehicles':         vehicles?.length,
    '/settings/price-levels':     priceLevels?.length,
    '/settings/salespeople':      salespeople?.length,
    '/settings/tax-rates':        taxRates?.length,
    '/settings/chart-of-accounts': coa?.length,
  };

  const { modules } = useEnabledModules();
  const { t } = useTranslation();
  const [q, setQ] = useState('');
  const query = q.trim().toLowerCase();

  // Same entries and visibility rules as before (./_nav); the search box only
  // filters what is shown, by the translated title and description.
  const sections = visibleSettingsSections(modules)
    .map((sec) => ({
      key: sec.title,
      title: sectionTitle(t, sec),
      tiles: sec.items.filter((it) => !query ||
        `${itemTitle(t, it)} ${itemDesc(t, it)} ${it.title}`.toLowerCase().includes(query)),
    }))
    .filter((sec) => sec.tiles.length > 0);

  return (
    <div className="sb-ocean sb-page sb-settings" data-testid="settings-hub-ocean" style={{ paddingBottom: 48 }}>
      <div className="sb-hero">
        <h1 className="sb-title" style={{ marginTop: 0 }}>{t('settingsNav.title')}</h1>
        <div className="sb-clist-count">{t('settingsNav.subtitle')}</div>
        <label className="sb-search">
          <Search size={18} className="sb-icon" aria-hidden="true" />
          <span className="sr-only">{t('settingsNav.search')}</span>
          <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder={t('settingsNav.search')} />
        </label>
      </div>
      <div className="sb-body" style={{ gap: 22 }}>
        {sections.length === 0 && <div className="sb-card sb-empty">{t('settingsNav.no_match')}</div>}
        {sections.map((sec) => (
          <section key={sec.key} aria-label={sec.title}>
            <h2 className="sb-set-section">{sec.title}</h2>
            <div className="sb-set-grid">
              {sec.tiles.map((it) => {
                const count = countByPath[it.to];
                const body = (
                  <>
                    <span className="sb-set-icon" aria-hidden="true">{itemIcon(it, 22)}</span>
                    <span className="sb-set-text">
                      <span className="sb-set-title">
                        {itemTitle(t, it)}
                        {count !== undefined && <span className="sb-tab-count">{count}</span>}
                        {it.comingSoon && <span className="sb-pill sb-pill-muted">{t('settingsNav.coming_soon')}</span>}
                      </span>
                      <span className="sb-set-desc">{itemDesc(t, it)}</span>
                    </span>
                    {!it.comingSoon && <ChevronRight size={18} className="sb-set-chevron sb-flip" aria-hidden="true" />}
                  </>
                );
                return it.comingSoon
                  ? <div key={it.to} className="sb-card sb-set-tile is-disabled" data-key={itemKey(it)}>{body}</div>
                  : <Link key={it.to} to={it.to} className="sb-card sb-set-tile" data-key={itemKey(it)}>{body}</Link>;
              })}
            </div>
          </section>
        ))}
      </div>
    </div>
  );
}
