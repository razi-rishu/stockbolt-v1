import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { getAdapter } from '@/data/index';
import { useAuthStore } from '@/store/auth';
import { OceanPage } from '@/components/ocean-list';
import type {
  ProductRow,
  VehicleMakeRow,
  VehicleModelRow,
  VehicleGenerationRow,
  VehicleVariantRow,
  VehicleEngineRow,
} from '@/data/adapter';

// Quality tier pills — Ocean tones, same tiers as the Products list.
const QUALITY_TONE: Record<string, string> = {
  genuine: '', oem: 'sb-pill-good', premium: 'sb-pill-warn', economy: 'sb-pill-muted',
};

const selectCls = 'sb-pc-select';

/**
 * Parts Catalog — cascading vehicle filter (Phase 32 / catalog C5).
 *
 * Make → Model → Generation → Variant, each populated from the level above (only
 * combinations that exist in the vehicle hierarchy). Results = products whose
 * product_compatibility covers the chosen vehicle. Matching is hierarchical: a
 * model- or generation-level compatibility row fits every generation/variant below
 * it (handled in `products.listByVehicle`). Model is the minimum to search;
 * generation/variant/year progressively narrow.
 */
export default function PartsCatalogPage() {
  const { t } = useTranslation();
  const { company_id } = useAuthStore();
  const navigate = useNavigate();
  const [makeId, setMakeId] = useState('');
  const [modelId, setModelId] = useState('');
  const [genId, setGenId] = useState('');
  const [varId, setVarId] = useState('');
  const [year, setYear] = useState('');

  const { data: makes = [] } = useQuery<VehicleMakeRow[]>({
    queryKey: ['vehicle_makes', company_id],
    queryFn: () => getAdapter().vehicleMakes.list(company_id!),
    enabled: !!company_id,
  });
  const { data: models = [] } = useQuery<VehicleModelRow[]>({
    queryKey: ['vehicle_models', makeId],
    queryFn: () => getAdapter().vehicleMakes.listModels(makeId),
    enabled: !!makeId,
  });
  const { data: generations = [] } = useQuery<VehicleGenerationRow[]>({
    queryKey: ['vehicle_generations', modelId],
    queryFn: () => getAdapter().vehicleMakes.listGenerations(modelId),
    enabled: !!modelId,
  });
  const { data: variants = [] } = useQuery<VehicleVariantRow[]>({
    queryKey: ['vehicle_variants', genId],
    queryFn: () => getAdapter().vehicleMakes.listVariants(genId),
    enabled: !!genId,
  });
  const { data: engines = [] } = useQuery<VehicleEngineRow[]>({
    queryKey: ['vehicle_engines', company_id],
    queryFn: () => getAdapter().vehicleMakes.listEngines(company_id!),
    enabled: !!company_id,
  });

  const yearNum = year ? parseInt(year, 10) : undefined;

  const { data: products = [], isFetching } = useQuery<ProductRow[]>({
    queryKey: ['catalog_products', company_id, modelId, genId, varId, yearNum],
    queryFn: () => getAdapter().products.listByVehicle(company_id!, {
      model_id: modelId, generation_id: genId || null, variant_id: varId || null, year: yearNum ?? null,
    }),
    enabled: !!company_id && !!modelId,
  });

  function variantLabel(v: VehicleVariantRow) {
    const eng = engines.find((e) => e.id === v.engine_id);
    const base = v.label || [eng?.engine_code, v.fuel_type, v.transmission].filter(Boolean).join(' · ') || t('parts_catalog.variant');
    const yr = (v.year_from || v.year_to) ? ` (${v.year_from ?? '…'}–${v.year_to ?? t('prodOcean.now')})` : '';
    return base + yr;
  }

  return (
    // Ocean Teal (UI v1.1): look only — same cascading filter and results.
    <OceanPage
      testid="parts-catalog-ocean"
      title={t('parts_catalog.title')}
      subtitle={modelId && !isFetching ? t('prodOcean.items_count', { count: products.length }) : undefined}
      below={
      /* Cascading vehicle filter */
      <div className="sb-pc-filters">
        <select value={makeId} onChange={(e) => { setMakeId(e.target.value); setModelId(''); setGenId(''); setVarId(''); }} className={selectCls}>
          <option value="">{t('parts_catalog.select_make')}</option>
          {makes.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
        </select>

        <select value={modelId} onChange={(e) => { setModelId(e.target.value); setGenId(''); setVarId(''); }} disabled={!makeId} className={selectCls}>
          <option value="">{t('parts_catalog.select_model')}</option>
          {models.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
        </select>

        <select value={genId} onChange={(e) => { setGenId(e.target.value); setVarId(''); }} disabled={!modelId} className={selectCls}>
          <option value="">{t('parts_catalog.all_generations')}</option>
          {generations.map((g) => <option key={g.id} value={g.id}>{g.name}{(g.year_from || g.year_to) ? ` (${g.year_from ?? '…'}–${g.year_to ?? t('prodOcean.now')})` : ''}</option>)}
        </select>

        <select value={varId} onChange={(e) => setVarId(e.target.value)} disabled={!genId} className={selectCls}>
          <option value="">{t('parts_catalog.all_variants')}</option>
          {variants.map((v) => <option key={v.id} value={v.id}>{variantLabel(v)}</option>)}
        </select>

        <input
          type="number"
          value={year}
          onChange={(e) => setYear(e.target.value)}
          placeholder={t('parts_catalog.year_optional')}
          min={1970}
          max={new Date().getFullYear() + 2}
          disabled={!modelId}
          className={`${selectCls} sb-pc-year`}
        />
      </div>
      }
    >

      {/* Results */}
      {!modelId && (
        <div className="sb-card sb-empty" style={{ textAlign: 'center' }}>{t('parts_catalog.select_make_hint')}</div>
      )}

      {modelId && isFetching && (
        <div className="sb-card sb-empty" style={{ textAlign: 'center' }}>{t('common.loading')}</div>
      )}

      {modelId && !isFetching && products.length === 0 && (
        <div className="sb-card sb-empty" style={{ textAlign: 'center' }}>{t('parts_catalog.no_results')}</div>
      )}

      {products.length > 0 && (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {products.map((p) => (
            <button
              key={p.id}
              onClick={() => navigate(`/products/${p.id}`)}
              type="button"
              className="sb-card sb-pc-card"
            >
              <div className="flex items-start justify-between gap-2">
                <bdi dir="ltr" className="sb-inv-no">{p.sku}</bdi>
                {p.quality_tier && (
                  <span className={`sb-pill ${QUALITY_TONE[p.quality_tier] ?? 'sb-pill-muted'}`} style={{ marginTop: 0 }}>
                    {t(`products.quality_${p.quality_tier}`)}
                  </span>
                )}
              </div>
              <div>
                <div style={{ fontWeight: 700, color: 'var(--sb-text)' }}>{p.name}</div>
                {p.name_ar && <div className="text-xs text-ink-tertiary" dir="rtl">{p.name_ar}</div>}
              </div>
              {p.oe_number && (
                <span className="sb-fx-name" style={{ fontSize: 12 }}>{t('prodOcean.oe')} <bdi dir="ltr" style={{ fontFamily: 'ui-monospace, monospace' }}>{p.oe_number}</bdi></span>
              )}
              <bdi dir="ltr" className="sb-dash-num" style={{ marginTop: 'auto', paddingTop: 4, fontSize: 16, textAlign: 'start' }}>
                {Number(p.selling_price).toFixed(2)}
              </bdi>
            </button>
          ))}
        </div>
      )}
    </OceanPage>
  );
}
