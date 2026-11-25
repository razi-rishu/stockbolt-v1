/**
 * phase153 — Settings → Inventory Settings: the optional inventory features a
 * company uses. A switch only shows or hides a feature; it never deletes data.
 * Selling without stock is the existing company setting (also on the company
 * profile), not a copy of it.
 */
import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Loader2 } from 'lucide-react';
import { getAdapter } from '@/data/index';
import type { Company } from '@/data/adapter';
import { useAuthStore } from '@/store/auth';
import { useHasPermission } from '@/hooks/use-permissions';
import { useInventorySettings } from '@/hooks/use-inventory-settings';
import { useUnsavedChangesGuard } from '@/hooks/use-unsaved-changes-guard';
import { ALL_ON, INVENTORY_SWITCHES, OFF_BY_DEFAULT, type InventorySettings, type InventorySwitch } from '@/lib/inventory-settings';
import { OceanPage } from '@/components/ocean-list';

type Draft = InventorySettings & { sell_without_stock: boolean };

export default function InventorySettingsPage() {
  const { t } = useTranslation();
  const { company_id } = useAuthStore();
  const qc = useQueryClient();
  const canEdit = useHasPermission('settings.write');
  const { ready, ...current } = useInventorySettings();
  const [draft, setDraft] = useState<Draft>({ ...ALL_ON, sell_without_stock: false });
  const [dirty, setDirty] = useState(false);
  const [saved, setSaved] = useState(false);
  useUnsavedChangesGuard(dirty);

  const { data: company } = useQuery<Company | null>({
    queryKey: ['company', company_id],
    queryFn: () => getAdapter().companies.getById(company_id!),
    enabled: !!company_id,
  });
  const { data: warehouses = [] } = useQuery({
    queryKey: ['warehouses', company_id],
    queryFn: () => getAdapter().warehouses.list(company_id!),
    enabled: !!company_id,
  });
  // More than one warehouse in use: hiding transfers would strand the stock.
  const activeWarehouses = warehouses.filter((w) => w.is_active).length;
  const sellWithoutStock = (company as { allow_negative_stock?: boolean } | null | undefined)?.allow_negative_stock ?? false;

  const saved_state: Draft = { ...current, sell_without_stock: sellWithoutStock };
  const loaded = ready && !!company;
  const signature = JSON.stringify(saved_state);
  useEffect(() => {
    if (loaded && !dirty) setDraft(JSON.parse(signature) as Draft);
  }, [loaded, dirty, signature]);

  const save = useMutation({
    mutationFn: async () => {
      if (draft.sell_without_stock !== sellWithoutStock) {
        await getAdapter().companies.update(company_id!, { allow_negative_stock: draft.sell_without_stock } as never);
      }
      // These are sent only when they change (their columns are newer than the row).
      const row = Object.fromEntries(INVENTORY_SWITCHES
        .filter((k) => !OFF_BY_DEFAULT.has(k) || draft[k] !== current[k])
        .map((k) => [k, draft[k]])) as unknown as InventorySettings;
      await getAdapter().inventorySettings.save(company_id!, row);
    },
    onSuccess: async () => {
      await Promise.all([
        qc.invalidateQueries({ queryKey: ['inventory_settings', company_id] }),
        qc.invalidateQueries({ queryKey: ['company', company_id] }),
      ]);
      setDirty(false);
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
    },
  });

  const set = (k: keyof Draft, v: boolean) => { setDraft((d) => ({ ...d, [k]: v })); setDirty(true); setSaved(false); };
  const lockReason = (k: InventorySwitch): string | null =>
    k === 'transfers_enabled' && draft.transfers_enabled && activeWarehouses > 1
      ? t('inventorySettings.transfers_locked', { count: activeWarehouses }) : null;

  const label: Record<InventorySwitch, [string, string]> = {
    transfers_enabled: [t('inventorySettings.transfers'), t('inventorySettings.transfers_hint')],
    reorder_enabled:   [t('inventorySettings.reorder'),   t('inventorySettings.reorder_hint')],
    barcodes_enabled:  [t('inventorySettings.barcodes'),  t('inventorySettings.barcodes_hint')],
    brands_enabled:    [t('inventorySettings.brands'),    t('inventorySettings.brands_hint')],
    shelf_enabled:     [t('inventorySettings.shelf'),     t('inventorySettings.shelf_hint')],
    packs_enabled:     [t('inventorySettings.packs'),     t('inventorySettings.packs_hint')],
    repack_enabled:    [t('inventorySettings.repack'),    t('inventorySettings.repack_hint')],
  };

  return (
    <OceanPage title={t('inventorySettings.title')} subtitle={t('inventorySettings.subtitle')}>
      <section className="sb-card" data-testid="inventory-settings">
        <h2 className="sb-form-title">{t('inventorySettings.features')}</h2>
        <p className="sb-form-hint" style={{ marginBottom: 12 }}>{t('inventorySettings.features_hint')}</p>
        <div style={{ display: 'grid', gap: 10 }}>
          {INVENTORY_SWITCHES.map((k) => {
            const reason = lockReason(k);
            return (
              <label key={k} className="sb-check-row">
                <input type="checkbox" checked={draft[k]} disabled={!canEdit || !loaded || !!reason}
                  data-testid={`inv-${k}`} onChange={(e) => set(k, e.target.checked)} />
                <span className="sb-check-text">{label[k][0]}<span className="sb-form-hint">{reason ?? label[k][1]}</span>
                  {k === 'packs_enabled' && draft[k] && !current[k] && <span className="sb-form-hint" data-testid="packs-first">{t('inventorySettings.packs_on')}</span>}
                </span>
              </label>
            );
          })}
        </div>
      </section>

      <section className="sb-card">
        <h2 className="sb-form-title">{t('inventorySettings.rules')}</h2>
        <label className="sb-check-row" style={{ marginTop: 12 }}>
          <input type="checkbox" checked={draft.sell_without_stock} disabled={!canEdit || !loaded}
            data-testid="inv-sell_without_stock" onChange={(e) => set('sell_without_stock', e.target.checked)} />
          <span className="sb-check-text">{t('settings.company.allow_backorders')}<span className="sb-form-hint">{t('settings.company.allow_backorders_hint')}</span></span>
        </label>
      </section>

      {!canEdit && <p className="sb-info-note">{t('inventorySettings.read_only')}</p>}
      {save.error && <p className="sb-alert sb-alert-danger" role="alert">{/packs_in_use/.test(String(save.error)) ? t('inventorySettings.packs_in_use') : save.error instanceof Error ? save.error.message : String(save.error)}</p>}
      {saved && <p className="sb-alert sb-alert-good" role="status">{t('common.saved')}</p>}
      {canEdit && (
        <div className="sb-form-actions">
          <button type="button" className="sb-secondary-btn sb-btn-inline" disabled={!dirty || save.isPending}
            onClick={() => { setDirty(false); save.reset(); }}>{t('common.cancel')}</button>
          <button type="button" className="sb-primary-btn sb-btn-inline" disabled={!dirty || save.isPending} onClick={() => save.mutate()}>
            {save.isPending && <Loader2 size={18} className="sb-spin" aria-hidden="true" />}{t('common.save')}
          </button>
        </div>
      )}
    </OceanPage>
  );
}
