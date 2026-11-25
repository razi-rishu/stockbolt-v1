/**
 * Packs (phase155) for the document screens. While the company has packs
 * switched off (every company by default) nothing is read and `on` is false,
 * so each screen behaves exactly as before.
 */
import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { getAdapter } from '@/data/index';
import { useAuthStore } from '@/store/auth';
import { useInventorySettings } from '@/hooks/use-inventory-settings';
import { unitAllowsDecimals, type ProductUnitRow } from '@/lib/packs';

const NONE: ProductUnitRow[] = [];

export interface Packs {
  on: boolean;
  /** Still loading: a document must not be saved on half the facts. */
  loading: boolean;
  byId: (id: string | null | undefined) => ProductUnitRow | undefined;
  /** Active packs of a product, for selling or buying ('all': counting, showing stock). */
  forProduct: (product_id: string | null | undefined, side: 'sales' | 'purchases' | 'all') => ProductUnitRow[];
  byBarcode: (code: string) => ProductUnitRow | undefined;
  /** PCS, KG… or '' when the product has no unit. */
  unitCode: (unit_id: string | null | undefined) => string;
  allowsDecimals: (unit_id: string | null | undefined) => boolean;
}

export function usePacks(): Packs {
  const company_id = useAuthStore((s) => s.company_id);
  const { packs_enabled: on, ready } = useInventorySettings();
  const { data: rows, isLoading: l1 } = useQuery({
    queryKey: ['product_units', company_id],
    queryFn: () => getAdapter().productUnits.list(company_id!),
    enabled: !!company_id && on,
  });
  const { data: units, isLoading: l2 } = useQuery({
    queryKey: ['units', company_id],
    queryFn: () => getAdapter().units.list(company_id!),
    enabled: !!company_id && on,
  });
  return useMemo(() => {
    const all = on ? rows ?? NONE : NONE;
    const byId = new Map(all.map((r) => [r.id, r]));
    const byProduct = new Map<string, ProductUnitRow[]>();
    for (const r of all) if (r.is_active) byProduct.set(r.product_id, [...(byProduct.get(r.product_id) ?? []), r]);
    const unitById = new Map((on ? units ?? [] : []).map((u) => [u.id, u as { code: string; allows_decimals?: boolean | null }]));
    return {
      on,
      loading: !ready || (on && (l1 || l2)),
      byId: (id) => (id ? byId.get(id) : undefined),
      forProduct: (pid, side) => (pid ? (byProduct.get(pid) ?? NONE).filter((r) => (side === 'sales' ? r.for_sales : side === 'purchases' ? r.for_purchases : true)) : NONE),
      byBarcode: (code) => {
        const c = code.trim().toLowerCase();
        return c ? all.find((r) => r.is_active && r.barcode?.trim().toLowerCase() === c) : undefined;
      },
      unitCode: (id) => (id ? unitById.get(id)?.code ?? '' : ''),
      allowsDecimals: (id) => unitAllowsDecimals(id ? unitById.get(id) : null),
    };
  }, [on, ready, rows, units, l1, l2]);
}
