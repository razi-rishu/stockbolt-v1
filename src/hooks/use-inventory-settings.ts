/**
 * phase153 — the active company's optional inventory features. While loading,
 * or when they cannot be read, every feature counts as on: a failed read must
 * never hide something a user works with.
 */
import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { getAdapter } from '@/data/index';
import { useAuthStore } from '@/store/auth';
import { inventorySettingsFrom, type InventorySettings } from '@/lib/inventory-settings';

export function useInventorySettings(): InventorySettings & { ready: boolean } {
  const company_id = useAuthStore((s) => s.company_id);
  const { data, isLoading } = useQuery({
    queryKey: ['inventory_settings', company_id],
    queryFn: () => getAdapter().inventorySettings.get(company_id!),
    enabled: !!company_id,
    staleTime: 5 * 60 * 1000,
    retry: 1,
  });
  return useMemo(() => ({ ...inventorySettingsFrom(data), ready: !isLoading }), [data, isLoading]);
}
