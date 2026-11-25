/**
 * The Settings entries this user may open: the company's modules and inventory
 * features, then the user's own rights. Price Levels shows only while the
 * company has some — no document reads them yet.
 */
import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { getAdapter } from '@/data/index';
import { useAuthStore } from '@/store/auth';
import { hasPerm } from '@/lib/permissions';
import { useEnabledModules } from '@/hooks/use-enabled-modules';
import { useInventorySettings } from '@/hooks/use-inventory-settings';
import { visibleSettingsSections, type SettingsNavSection } from '@/modules/settings/_nav';

export function useSettingsSections(): SettingsNavSection[] {
  const company_id = useAuthStore((s) => s.company_id);
  const role = useAuthStore((s) => s.role);
  const permissions = useAuthStore((s) => s.permissions);
  const { modules } = useEnabledModules();
  const inventory = useInventorySettings();
  const { data: priceLevels } = useQuery({
    queryKey: ['priceLevels', company_id],
    queryFn: () => getAdapter().priceLevels.list(company_id!),
    enabled: !!company_id,
    staleTime: 5 * 60 * 1000,
  });
  const hasPriceLevels = (priceLevels?.length ?? 0) > 0;
  return useMemo(() => visibleSettingsSections(modules, inventory, {
    can: (p) => hasPerm(role, permissions, p), isAdmin: role === 'admin', hasPriceLevels,
  }), [modules, inventory, role, permissions, hasPriceLevels]);
}
