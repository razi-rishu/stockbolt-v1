import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { getAdapter } from '@/data/index';
import { useAuthStore } from '@/store/auth';
import { Button } from '@/ui/button';
import { Input } from '@/ui/input';
import { Select } from '@/ui/select';
import { Modal } from '@/ui/modal';
import type { Column } from '@/ui/table';
import { OceanPage, OceanTable } from '@/components/ocean-list';
import { Upload, Search, Pencil, Trash2, ChevronRight } from 'lucide-react';
import Papa from 'papaparse';
import { downloadBlob } from '@/lib/io-export';
import type {
  VehicleMakeRow,
  VehicleModelRow,
  VehicleGenerationRow,
  VehicleVariantRow,
  VehicleEngineRow,
} from '@/data/adapter';

type TabKey = 'models' | 'generations' | 'variants' | 'engines';

const FUEL_OPTS = ['Petrol', 'Diesel', 'Hybrid', 'Electric', 'LPG', 'CNG'];
const TRANS_OPTS = ['Automatic', 'Manual', 'CVT', 'DCT', 'AMT'];
const DRIVE_OPTS = ['FWD', 'RWD', 'AWD', '4WD'];
const BODY_OPTS = ['Sedan', 'Hatchback', 'SUV', 'Coupe', 'Pickup', 'Van', 'Wagon', 'Convertible'];

function yearRange(from: number | null, to: number | null) {
  if (!from && !to) return '—';
  return `${from ?? '…'}–${to ?? 'now'}`;
}

/**
 * Vehicle Master — master-detail (Phase 32 / catalog C3).
 *
 * Left  : searchable Makes list (own + system-shared, read-only).
 * Right : the selected make with tabs Models · Generations · Variants · Engines.
 * Drill : Make → click a model → Generations → click a generation → Variants.
 * Engines are a reusable catalog (company + system) referenced by variants.
 *
 * System makes (company_id === null) are shared catalog → their whole tree is
 * read-only; `canEdit` gates every create/edit/delete in the right pane.
 */
export default function VehicleMakesPage() {
  const { t } = useTranslation();
  const { company_id } = useAuthStore();
  const qc = useQueryClient();

  // ── selection / drill state ──────────────────────────────
  const [search, setSearch] = useState('');
  const [selectedMake, setSelectedMake] = useState<VehicleMakeRow | null>(null);
  const [selectedModel, setSelectedModel] = useState<VehicleModelRow | null>(null);
  const [selectedGen, setSelectedGen] = useState<VehicleGenerationRow | null>(null);
  const [tab, setTab] = useState<TabKey>('models');

  const makeIsSystem = !!selectedMake && selectedMake.company_id === null;
  const canEdit = !!selectedMake && !makeIsSystem;

  // ── queries ──────────────────────────────────────────────
  const { data: makes = [], isLoading: makesLoading } = useQuery({
    queryKey: ['vehicle_makes', company_id],
    queryFn: () => getAdapter().vehicleMakes.list(company_id!),
    enabled: !!company_id,
  });
  const { data: models = [] } = useQuery({
    queryKey: ['vehicle_models', selectedMake?.id],
    queryFn: () => getAdapter().vehicleMakes.listModels(selectedMake!.id),
    enabled: !!selectedMake,
  });
  const { data: generations = [] } = useQuery({
    queryKey: ['vehicle_generations', selectedModel?.id],
    queryFn: () => getAdapter().vehicleMakes.listGenerations(selectedModel!.id),
    enabled: !!selectedModel,
  });
  const { data: variants = [] } = useQuery({
    queryKey: ['vehicle_variants', selectedGen?.id],
    queryFn: () => getAdapter().vehicleMakes.listVariants(selectedGen!.id),
    enabled: !!selectedGen,
  });
  const { data: engines = [] } = useQuery({
    queryKey: ['vehicle_engines', company_id],
    queryFn: () => getAdapter().vehicleMakes.listEngines(company_id!),
    enabled: !!company_id,
  });

  // ── makes ────────────────────────────────────────────────
  const [makeModal, setMakeModal] = useState(false);
  const [editingMake, setEditingMake] = useState<VehicleMakeRow | null>(null);
  const [makeName, setMakeName] = useState('');
  const [makeErr, setMakeErr] = useState('');

  const createMake = useMutation({
    mutationFn: () => getAdapter().vehicleMakes.create({ company_id: company_id!, name: makeName.trim() }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['vehicle_makes', company_id] }); setMakeModal(false); },
  });
  const updateMake = useMutation({
    mutationFn: () => getAdapter().vehicleMakes.update(editingMake!.id, makeName.trim()),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['vehicle_makes', company_id] }); setMakeModal(false); },
  });
  const deleteMake = useMutation({
    mutationFn: (id: string) => getAdapter().vehicleMakes.remove(id),
    onSuccess: (_d, id) => {
      qc.invalidateQueries({ queryKey: ['vehicle_makes', company_id] });
      if (selectedMake?.id === id) { setSelectedMake(null); setSelectedModel(null); setSelectedGen(null); }
    },
  });

  function openAddMake() { setEditingMake(null); setMakeName(''); setMakeErr(''); setMakeModal(true); }
  function openEditMake(m: VehicleMakeRow) { setEditingMake(m); setMakeName(m.name); setMakeErr(''); setMakeModal(true); }
  async function saveMake() {
    if (!makeName.trim()) { setMakeErr(t('common.required')); return; }
    if (editingMake) await updateMake.mutateAsync(); else await createMake.mutateAsync();
  }

  // ── models ───────────────────────────────────────────────
  const [modelModal, setModelModal] = useState(false);
  const [editingModel, setEditingModel] = useState<VehicleModelRow | null>(null);
  const [modelForm, setModelForm] = useState({ name: '', chassis_code: '', body_type: '' });

  const saveModelMut = useMutation({
    mutationFn: async () => {
      // `body_type` isn't in the generated insert type yet (Phase 32) → cast.
      const payload: any = {
        name: modelForm.name.trim(),
        chassis_code: modelForm.chassis_code.trim() || null,
        body_type: modelForm.body_type || null,
      };
      if (editingModel) await getAdapter().vehicleMakes.updateModel(editingModel.id, payload);
      else await getAdapter().vehicleMakes.createModel({ make_id: selectedMake!.id, ...payload });
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['vehicle_models', selectedMake?.id] }); setModelModal(false); },
  });
  const deleteModel = useMutation({
    mutationFn: (id: string) => getAdapter().vehicleMakes.removeModel(id),
    onSuccess: (_d, id) => {
      qc.invalidateQueries({ queryKey: ['vehicle_models', selectedMake?.id] });
      if (selectedModel?.id === id) { setSelectedModel(null); setSelectedGen(null); }
    },
  });
  function openAddModel() { setEditingModel(null); setModelForm({ name: '', chassis_code: '', body_type: '' }); setModelModal(true); }
  function openEditModel(m: VehicleModelRow) {
    setEditingModel(m);
    setModelForm({ name: m.name, chassis_code: m.chassis_code ?? '', body_type: (m as any).body_type ?? '' });
    setModelModal(true);
  }

  // ── generations ──────────────────────────────────────────
  const [genModal, setGenModal] = useState(false);
  const [editingGen, setEditingGen] = useState<VehicleGenerationRow | null>(null);
  const [genForm, setGenForm] = useState({ name: '', code: '', year_from: '', year_to: '' });

  const saveGenMut = useMutation({
    mutationFn: async () => {
      const payload = {
        name: genForm.name.trim(),
        code: genForm.code.trim() || null,
        year_from: genForm.year_from ? Number(genForm.year_from) : null,
        year_to: genForm.year_to ? Number(genForm.year_to) : null,
      };
      if (editingGen) await getAdapter().vehicleMakes.updateGeneration(editingGen.id, payload);
      else await getAdapter().vehicleMakes.createGeneration({ model_id: selectedModel!.id, ...payload });
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['vehicle_generations', selectedModel?.id] }); setGenModal(false); },
  });
  const deleteGen = useMutation({
    mutationFn: (id: string) => getAdapter().vehicleMakes.removeGeneration(id),
    onSuccess: (_d, id) => {
      qc.invalidateQueries({ queryKey: ['vehicle_generations', selectedModel?.id] });
      if (selectedGen?.id === id) setSelectedGen(null);
    },
  });
  function openAddGen() { setEditingGen(null); setGenForm({ name: '', code: '', year_from: '', year_to: '' }); setGenModal(true); }
  function openEditGen(g: VehicleGenerationRow) {
    setEditingGen(g);
    setGenForm({ name: g.name, code: g.code ?? '', year_from: g.year_from?.toString() ?? '', year_to: g.year_to?.toString() ?? '' });
    setGenModal(true);
  }

  // ── variants ─────────────────────────────────────────────
  const emptyVar = { label: '', engine_id: '', transmission: '', drive_type: '', fuel_type: '', year_from: '', year_to: '', chassis_code: '' };
  const [varModal, setVarModal] = useState(false);
  const [editingVar, setEditingVar] = useState<VehicleVariantRow | null>(null);
  const [varForm, setVarForm] = useState(emptyVar);

  const saveVarMut = useMutation({
    mutationFn: async () => {
      const payload = {
        label: varForm.label.trim() || null,
        engine_id: varForm.engine_id || null,
        transmission: varForm.transmission || null,
        drive_type: varForm.drive_type || null,
        fuel_type: varForm.fuel_type || null,
        year_from: varForm.year_from ? Number(varForm.year_from) : null,
        year_to: varForm.year_to ? Number(varForm.year_to) : null,
        chassis_code: varForm.chassis_code.trim() || null,
      };
      if (editingVar) await getAdapter().vehicleMakes.updateVariant(editingVar.id, payload);
      else await getAdapter().vehicleMakes.createVariant({ generation_id: selectedGen!.id, ...payload });
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['vehicle_variants', selectedGen?.id] }); setVarModal(false); },
  });
  const deleteVar = useMutation({
    mutationFn: (id: string) => getAdapter().vehicleMakes.removeVariant(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['vehicle_variants', selectedGen?.id] }),
  });
  function openAddVar() { setEditingVar(null); setVarForm(emptyVar); setVarModal(true); }
  function openEditVar(v: VehicleVariantRow) {
    setEditingVar(v);
    setVarForm({
      label: v.label ?? '', engine_id: v.engine_id ?? '', transmission: v.transmission ?? '',
      drive_type: v.drive_type ?? '', fuel_type: v.fuel_type ?? '',
      year_from: v.year_from?.toString() ?? '', year_to: v.year_to?.toString() ?? '', chassis_code: v.chassis_code ?? '',
    });
    setVarModal(true);
  }

  // ── engines (reusable catalog) ───────────────────────────
  const emptyEng = { engine_code: '', displacement_cc: '', fuel_type: '', power_hp: '', description: '' };
  const [engModal, setEngModal] = useState(false);
  const [editingEng, setEditingEng] = useState<VehicleEngineRow | null>(null);
  const [engForm, setEngForm] = useState(emptyEng);
  const [engErr, setEngErr] = useState('');

  const saveEngMut = useMutation({
    mutationFn: async () => {
      const payload = {
        engine_code: engForm.engine_code.trim(),
        displacement_cc: engForm.displacement_cc ? Number(engForm.displacement_cc) : null,
        fuel_type: engForm.fuel_type || null,
        power_hp: engForm.power_hp ? Number(engForm.power_hp) : null,
        description: engForm.description.trim() || null,
      };
      if (editingEng) await getAdapter().vehicleMakes.updateEngine(editingEng.id, payload);
      else await getAdapter().vehicleMakes.createEngine({ company_id: company_id!, ...payload });
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['vehicle_engines', company_id] }); setEngModal(false); },
  });
  const deleteEng = useMutation({
    mutationFn: (id: string) => getAdapter().vehicleMakes.removeEngine(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['vehicle_engines', company_id] }),
  });
  function openAddEng() { setEditingEng(null); setEngForm(emptyEng); setEngErr(''); setEngModal(true); }
  function openEditEng(e: VehicleEngineRow) {
    setEditingEng(e);
    setEngForm({ engine_code: e.engine_code, displacement_cc: e.displacement_cc?.toString() ?? '', fuel_type: e.fuel_type ?? '', power_hp: e.power_hp?.toString() ?? '', description: e.description ?? '' });
    setEngErr('');
    setEngModal(true);
  }
  async function saveEng() {
    if (!engForm.engine_code.trim()) { setEngErr(t('common.required')); return; }
    await saveEngMut.mutateAsync();
  }

  // ── vehicle import (C8) ──────────────────────────────────
  const [importOpen, setImportOpen] = useState(false);
  const [importRows, setImportRows] = useState<any[]>([]);
  const [importErr, setImportErr] = useState('');
  const [importResult, setImportResult] = useState<any>(null);

  const importMut = useMutation({
    mutationFn: () => getAdapter().vehicleMakes.importVehicles(importRows),
    onSuccess: (res) => {
      setImportResult(res);
      setImportRows([]);
      qc.invalidateQueries({ queryKey: ['vehicle_makes', company_id] });
      if (selectedMake) qc.invalidateQueries({ queryKey: ['vehicle_models', selectedMake.id] });
    },
  });

  // CSV header (any case / spacing / underscores) → our row key.
  const IMPORT_MAP: Record<string, string> = {
    make: 'make', model: 'model', generation: 'generation', gen: 'generation',
    yearfrom: 'year_from', fromyear: 'year_from', yearto: 'year_to', toyear: 'year_to',
    engine: 'engine_code', enginecode: 'engine_code', fuel: 'fuel', fueltype: 'fuel',
    transmission: 'transmission', trans: 'transmission', gearbox: 'transmission',
    drive: 'drive', drivetype: 'drive', chassis: 'chassis', chassiscode: 'chassis',
  };

  function parseImportCsv(text: string) {
    setImportErr(''); setImportResult(null);
    if (!text.trim()) { setImportRows([]); return; }
    const parsed = Papa.parse<Record<string, string>>(text, { header: true, skipEmptyLines: true });
    const rows = (parsed.data || []).map((raw) => {
      const out: Record<string, string> = {};
      for (const [h, v] of Object.entries(raw)) {
        const k = IMPORT_MAP[h.toLowerCase().replace(/[\s_]+/g, '')];
        if (k && v != null) out[k] = String(v).trim();
      }
      return out;
    }).filter((row) => row.make && row.model);
    if (rows.length === 0) { setImportErr(t('catalog.vehicles.import_none')); setImportRows([]); return; }
    setImportRows(rows);
  }

  function downloadImportTemplate() {
    const csv = 'Make,Model,Generation,Year From,Year To,Engine Code,Fuel,Transmission,Drive,Chassis\nToyota,Corolla,E170,2013,2018,2ZR-FE,Petrol,Automatic,FWD,NRE170\n';
    downloadBlob(csv, 'vehicle-import-template.csv', 'text/csv');
  }

  function openImport() { setImportRows([]); setImportErr(''); setImportResult(null); setImportOpen(true); }

  // ── navigation helpers ───────────────────────────────────
  function selectMake(m: VehicleMakeRow) { setSelectedMake(m); setSelectedModel(null); setSelectedGen(null); setTab('models'); }
  function drillToGenerations(m: VehicleModelRow) { setSelectedModel(m); setSelectedGen(null); setTab('generations'); }
  function drillToVariants(g: VehicleGenerationRow) { setSelectedGen(g); setTab('variants'); }

  const engineLabel = (id: string | null) => (id ? engines.find((x) => x.id === id)?.engine_code ?? '—' : '—');
  const selOpts = (arr: string[], placeholder: string) => [{ value: '', label: placeholder }, ...arr.map((x) => ({ value: x, label: x }))];
  const filteredMakes = makes.filter((m) => m.name.toLowerCase().includes(search.trim().toLowerCase()));

  // ── action cell (edit/delete, or a "shared" tag when read-only) ──
  const actionCell = (onEdit: () => void, onDelete: () => void, readOnly: boolean) =>
    readOnly ? (
      <span className="text-xs text-ink-tertiary">{t('catalog.vehicles.shared')}</span>
    ) : (
      <div className="flex justify-end gap-2">
        <button onClick={(e) => { e.stopPropagation(); onEdit(); }} className="text-xs text-brand-600 hover:underline">{t('common.edit')}</button>
        <button onClick={(e) => { e.stopPropagation(); if (confirm(t('common.confirm_delete'))) onDelete(); }} className="text-xs text-danger-500 hover:underline">{t('common.delete')}</button>
      </div>
    );

  const modelColumns: Column<VehicleModelRow>[] = [
    { key: 'name', header: t('catalog.vehicles.model'), render: (r) => <span className="font-medium">{r.name}</span> },
    { key: 'body', header: t('catalog.vehicles.body_type'), render: (r) => (r as any).body_type ?? '—' },
    { key: 'chassis', header: t('catalog.vehicles.chassis'), render: (r) => r.chassis_code ?? '—' },
    { key: 'actions', header: '', width: '110px', align: 'end', render: (r) => actionCell(() => openEditModel(r), () => deleteModel.mutate(r.id), !canEdit) },
  ];
  const genColumns: Column<VehicleGenerationRow>[] = [
    { key: 'name', header: t('catalog.vehicles.generation'), render: (r) => <span className="font-medium">{r.name}</span> },
    { key: 'code', header: t('catalog.vehicles.code'), render: (r) => r.code ?? '—' },
    { key: 'years', header: t('catalog.vehicles.years'), render: (r) => yearRange(r.year_from, r.year_to) },
    { key: 'actions', header: '', width: '110px', align: 'end', render: (r) => actionCell(() => openEditGen(r), () => deleteGen.mutate(r.id), !canEdit) },
  ];
  const varColumns: Column<VehicleVariantRow>[] = [
    { key: 'label', header: t('catalog.vehicles.variant'), render: (r) => <span className="font-medium">{r.label || engineLabel(r.engine_id)}</span> },
    { key: 'engine', header: t('catalog.vehicles.engine'), render: (r) => engineLabel(r.engine_id) },
    { key: 'trans', header: t('catalog.vehicles.transmission'), render: (r) => r.transmission ?? '—' },
    { key: 'drive', header: t('catalog.vehicles.drive_type'), render: (r) => r.drive_type ?? '—' },
    { key: 'fuel', header: t('catalog.vehicles.fuel_type'), render: (r) => r.fuel_type ?? '—' },
    { key: 'years', header: t('catalog.vehicles.years'), render: (r) => yearRange(r.year_from, r.year_to) },
    { key: 'actions', header: '', width: '110px', align: 'end', render: (r) => actionCell(() => openEditVar(r), () => deleteVar.mutate(r.id), !canEdit) },
  ];
  const engColumns: Column<VehicleEngineRow>[] = [
    { key: 'code', header: t('catalog.vehicles.engine_code'), render: (r) => <span className="font-medium">{r.engine_code}</span> },
    { key: 'disp', header: t('catalog.vehicles.displacement'), render: (r) => (r.displacement_cc ? `${r.displacement_cc} cc` : '—') },
    { key: 'fuel', header: t('catalog.vehicles.fuel_type'), render: (r) => r.fuel_type ?? '—' },
    { key: 'power', header: t('catalog.vehicles.power_hp'), render: (r) => (r.power_hp ? `${r.power_hp} hp` : '—') },
    { key: 'actions', header: '', width: '110px', align: 'end', render: (r) => actionCell(() => openEditEng(r), () => deleteEng.mutate(r.id), r.company_id === null) },
  ];

  const tabs: { key: TabKey; label: string }[] = [
    { key: 'models', label: t('catalog.vehicles.tab_models') },
    { key: 'generations', label: t('catalog.vehicles.tab_generations') },
    { key: 'variants', label: t('catalog.vehicles.tab_variants') },
    { key: 'engines', label: t('catalog.vehicles.tab_engines') },
  ];

  // Ocean Teal (UI v1.1): look only — same makes → models → generations →
  // variants drill-down, engines, shared (read-only) rows, import and forms.
  return (
    <OceanPage
      testid="vehicle-makes-ocean"
      title={t('settingsNav.items.vehicles.title')}
      subtitle={t('settingsPages.vehicles.count', { count: makes.length })}
      actions={
        <button type="button" className="sb-secondary-btn sb-btn-inline" onClick={openImport}><Upload size={18} aria-hidden="true" />{t('catalog.vehicles.import')}</button>
      }
    >
      <div className="sb-vm-grid">
        {/* ── LEFT: makes ── */}
        <div className="flex flex-col gap-3">
          <div className="sb-vm-head">
            <h2 className="sb-set-section" style={{ margin: 0 }}>{t('catalog.vehicles.makes')}</h2>
            <Button size="sm" onClick={openAddMake}>{t('common.add')}</Button>
          </div>
          <label className="sb-search" style={{ marginTop: 0 }}>
            <Search size={18} className="sb-icon" aria-hidden="true" />
            <span className="sr-only">{t('catalog.vehicles.search_makes')}</span>
            <input type="search" placeholder={t('catalog.vehicles.search_makes')} value={search} onChange={(e) => setSearch(e.target.value)} />
          </label>
          <div className="sb-card" style={{ padding: 0, overflow: 'hidden' }}>
            {makesLoading ? (
              <div className="sb-empty">{t('common.loading')}</div>
            ) : filteredMakes.length === 0 ? (
              <div className="sb-empty">{t('catalog.vehicles.empty_makes')}</div>
            ) : (
              <ul className="sb-vm-makes">
                {filteredMakes.map((m) => {
                  const active = selectedMake?.id === m.id;
                  const sys = m.company_id === null;
                  return (
                    <li key={m.id}>
                      <div
                        role="button"
                        tabIndex={0}
                        aria-current={active ? 'true' : undefined}
                        onClick={() => selectMake(m)}
                        onKeyDown={(e) => { if ((e.key === 'Enter' || e.key === ' ') && e.target === e.currentTarget) { e.preventDefault(); selectMake(m); } }}
                        className={`sb-vm-make ${active ? 'active' : ''}`}
                      >
                        <span className="sb-vm-make-name">
                          {m.name}
                          {sys && <span className="sb-pill sb-pill-muted">{t('catalog.vehicles.shared')}</span>}
                        </span>
                        {!sys && (
                          <span className="sb-vm-make-actions">
                            <button type="button" onClick={(e) => { e.stopPropagation(); openEditMake(m); }} className="sb-icon-btn" aria-label={`${t('common.edit')} ${m.name}`}><Pencil size={16} aria-hidden="true" /></button>
                            <button type="button" onClick={(e) => { e.stopPropagation(); if (confirm(t('common.confirm_delete'))) deleteMake.mutate(m.id); }} className="sb-icon-btn sb-danger" aria-label={`${t('common.delete')} ${m.name}`}><Trash2 size={16} aria-hidden="true" /></button>
                          </span>
                        )}
                        <ChevronRight size={18} className="sb-icon sb-flip" aria-hidden="true" />
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </div>

        {/* ── RIGHT: detail ── */}
        <div className="flex flex-col gap-4">
          {!selectedMake ? (
            <div className="sb-card sb-empty" style={{ padding: 40, textAlign: 'center' }}>
              {t('catalog.vehicles.select_make_hint')}
            </div>
          ) : (
            <>
              {/* breadcrumb */}
              <nav className="sb-vm-crumb" aria-label={selectedMake.name}>
                <button type="button" onClick={() => setTab('models')} className="sb-row-link is-strong">{selectedMake.name}</button>
                {selectedModel && (<><ChevronRight size={16} className="sb-flip" aria-hidden="true" /><button type="button" onClick={() => setTab('generations')} className="sb-row-link">{selectedModel.name}</button></>)}
                {selectedGen && (<><ChevronRight size={16} className="sb-flip" aria-hidden="true" /><button type="button" onClick={() => setTab('variants')} className="sb-row-link">{selectedGen.name}</button></>)}
                {makeIsSystem && <span className="sb-pill sb-pill-muted">{t('catalog.vehicles.system_readonly')}</span>}
              </nav>

              {/* tabs */}
              <div className="sb-tabs sb-vm-tabs" role="tablist">
                {tabs.map((tb) => (
                  <button
                    key={tb.key}
                    type="button"
                    role="tab"
                    aria-selected={tab === tb.key}
                    onClick={() => setTab(tb.key)}
                    className={`sb-tab ${tab === tb.key ? 'active' : ''}`}
                  >
                    {tb.label}
                  </button>
                ))}
              </div>

              {/* MODELS */}
              {tab === 'models' && (
                <div className="flex flex-col gap-3">
                  <div className="sb-vm-head">
                    <h3 className="sb-vm-title">{t('catalog.vehicles.tab_models')}</h3>
                    {canEdit && <Button size="sm" onClick={openAddModel}>{t('common.add')}</Button>}
                  </div>
                  <p className="sb-form-hint">{t('catalog.vehicles.click_model_hint')}</p>
                  <OceanTable columns={modelColumns} rows={models} keyFn={(r) => r.id} onRowClick={drillToGenerations} emptyMessage={t('catalog.vehicles.empty_models')} />
                </div>
              )}

              {/* GENERATIONS */}
              {tab === 'generations' && (
                <div className="flex flex-col gap-3">
                  {!selectedModel ? (
                    <div className="sb-card sb-empty" style={{ textAlign: 'center' }}>{t('catalog.vehicles.select_model_hint')}</div>
                  ) : (
                    <>
                      <div className="sb-vm-head">
                        <h3 className="sb-vm-title">{t('catalog.vehicles.generations_of')} {selectedModel.name}</h3>
                        {canEdit && <Button size="sm" onClick={openAddGen}>{t('common.add')}</Button>}
                      </div>
                      <p className="sb-form-hint">{t('catalog.vehicles.click_gen_hint')}</p>
                      <OceanTable columns={genColumns} rows={generations} keyFn={(r) => r.id} onRowClick={drillToVariants} emptyMessage={t('catalog.vehicles.empty_generations')} />
                    </>
                  )}
                </div>
              )}

              {/* VARIANTS */}
              {tab === 'variants' && (
                <div className="flex flex-col gap-3">
                  {!selectedGen ? (
                    <div className="sb-card sb-empty" style={{ textAlign: 'center' }}>{t('catalog.vehicles.select_gen_hint')}</div>
                  ) : (
                    <>
                      <div className="sb-vm-head">
                        <h3 className="sb-vm-title">{t('catalog.vehicles.variants_of')} {selectedGen.name}</h3>
                        {canEdit && <Button size="sm" onClick={openAddVar}>{t('common.add')}</Button>}
                      </div>
                      <OceanTable columns={varColumns} rows={variants} keyFn={(r) => r.id} emptyMessage={t('catalog.vehicles.empty_variants')} />
                    </>
                  )}
                </div>
              )}

              {/* ENGINES */}
              {tab === 'engines' && (
                <div className="flex flex-col gap-3">
                  <div className="sb-vm-head">
                    <h3 className="sb-vm-title">{t('catalog.vehicles.tab_engines')}</h3>
                    <Button size="sm" onClick={openAddEng}>{t('common.add')}</Button>
                  </div>
                  <p className="sb-form-hint">{t('catalog.vehicles.engines_hint')}</p>
                  <OceanTable columns={engColumns} rows={engines} keyFn={(r) => r.id} emptyMessage={t('catalog.vehicles.empty_engines')} />
                </div>
              )}
            </>
          )}
        </div>
      </div>

      {/* ── modals ── */}
      {/* make */}
      <Modal open={makeModal} onClose={() => setMakeModal(false)} title={editingMake ? t('catalog.vehicles.edit_make') : t('catalog.vehicles.add_make')}>
        <div className="sb-ocean sb-form sb-modal-form">
          <Input label={t('catalog.vehicles.make_name')} required value={makeName} onChange={(e) => setMakeName(e.target.value)} error={makeErr} />
          <div className="flex justify-end gap-3 pt-2">
            <Button type="button" variant="secondary" onClick={() => setMakeModal(false)}>{t('common.cancel')}</Button>
            <Button loading={createMake.isPending || updateMake.isPending} onClick={saveMake}>{t('common.save')}</Button>
          </div>
        </div>
      </Modal>

      {/* model */}
      <Modal open={modelModal} onClose={() => setModelModal(false)} title={editingModel ? t('catalog.vehicles.edit_model') : t('catalog.vehicles.add_model')}>
        <div className="sb-ocean sb-form sb-modal-form">
          <Input label={t('catalog.vehicles.model_name')} required value={modelForm.name} onChange={(e) => setModelForm({ ...modelForm, name: e.target.value })} />
          <Select label={t('catalog.vehicles.body_type')} options={selOpts(BODY_OPTS, t('catalog.vehicles.any'))} value={modelForm.body_type} onChange={(e) => setModelForm({ ...modelForm, body_type: e.target.value })} />
          <Input label={t('catalog.vehicles.chassis')} value={modelForm.chassis_code} onChange={(e) => setModelForm({ ...modelForm, chassis_code: e.target.value })} />
          <div className="flex justify-end gap-3 pt-2">
            <Button type="button" variant="secondary" onClick={() => setModelModal(false)}>{t('common.cancel')}</Button>
            <Button loading={saveModelMut.isPending} disabled={!modelForm.name.trim()} onClick={() => saveModelMut.mutate()}>{t('common.save')}</Button>
          </div>
        </div>
      </Modal>

      {/* generation */}
      <Modal open={genModal} onClose={() => setGenModal(false)} title={editingGen ? t('catalog.vehicles.edit_generation') : t('catalog.vehicles.add_generation')}>
        <div className="sb-ocean sb-form sb-modal-form">
          <Input label={t('catalog.vehicles.gen_name')} required value={genForm.name} onChange={(e) => setGenForm({ ...genForm, name: e.target.value })} placeholder="E170" />
          <Input label={t('catalog.vehicles.code')} value={genForm.code} onChange={(e) => setGenForm({ ...genForm, code: e.target.value })} />
          <div className="grid grid-cols-2 gap-3">
            <Input label={t('catalog.vehicles.year_from')} type="number" value={genForm.year_from} onChange={(e) => setGenForm({ ...genForm, year_from: e.target.value })} />
            <Input label={t('catalog.vehicles.year_to')} type="number" value={genForm.year_to} onChange={(e) => setGenForm({ ...genForm, year_to: e.target.value })} />
          </div>
          <div className="flex justify-end gap-3 pt-2">
            <Button type="button" variant="secondary" onClick={() => setGenModal(false)}>{t('common.cancel')}</Button>
            <Button loading={saveGenMut.isPending} disabled={!genForm.name.trim()} onClick={() => saveGenMut.mutate()}>{t('common.save')}</Button>
          </div>
        </div>
      </Modal>

      {/* variant */}
      <Modal open={varModal} onClose={() => setVarModal(false)} title={editingVar ? t('catalog.vehicles.edit_variant') : t('catalog.vehicles.add_variant')}>
        <div className="sb-ocean sb-form sb-modal-form">
          <Input label={t('catalog.vehicles.variant_label')} value={varForm.label} onChange={(e) => setVarForm({ ...varForm, label: e.target.value })} placeholder={t('catalog.vehicles.variant_label_ph')} />
          <Select
            label={t('catalog.vehicles.engine')}
            options={[{ value: '', label: t('catalog.vehicles.no_engine') }, ...engines.map((e) => ({ value: e.id, label: e.engine_code + (e.displacement_cc ? ` · ${e.displacement_cc}cc` : '') }))]}
            value={varForm.engine_id}
            onChange={(e) => setVarForm({ ...varForm, engine_id: e.target.value })}
          />
          <div className="grid grid-cols-2 gap-3">
            <Select label={t('catalog.vehicles.transmission')} options={selOpts(TRANS_OPTS, '—')} value={varForm.transmission} onChange={(e) => setVarForm({ ...varForm, transmission: e.target.value })} />
            <Select label={t('catalog.vehicles.drive_type')} options={selOpts(DRIVE_OPTS, '—')} value={varForm.drive_type} onChange={(e) => setVarForm({ ...varForm, drive_type: e.target.value })} />
          </div>
          <Select label={t('catalog.vehicles.fuel_type')} options={selOpts(FUEL_OPTS, '—')} value={varForm.fuel_type} onChange={(e) => setVarForm({ ...varForm, fuel_type: e.target.value })} />
          <div className="grid grid-cols-2 gap-3">
            <Input label={t('catalog.vehicles.year_from')} type="number" value={varForm.year_from} onChange={(e) => setVarForm({ ...varForm, year_from: e.target.value })} />
            <Input label={t('catalog.vehicles.year_to')} type="number" value={varForm.year_to} onChange={(e) => setVarForm({ ...varForm, year_to: e.target.value })} />
          </div>
          <Input label={t('catalog.vehicles.chassis')} value={varForm.chassis_code} onChange={(e) => setVarForm({ ...varForm, chassis_code: e.target.value })} />
          <div className="flex justify-end gap-3 pt-2">
            <Button type="button" variant="secondary" onClick={() => setVarModal(false)}>{t('common.cancel')}</Button>
            <Button loading={saveVarMut.isPending} onClick={() => saveVarMut.mutate()}>{t('common.save')}</Button>
          </div>
        </div>
      </Modal>

      {/* engine */}
      <Modal open={engModal} onClose={() => setEngModal(false)} title={editingEng ? t('catalog.vehicles.edit_engine') : t('catalog.vehicles.add_engine')}>
        <div className="sb-ocean sb-form sb-modal-form">
          <Input label={t('catalog.vehicles.engine_code')} required value={engForm.engine_code} onChange={(e) => setEngForm({ ...engForm, engine_code: e.target.value })} error={engErr} placeholder="1ZZ-FE" />
          <div className="grid grid-cols-2 gap-3">
            <Input label={t('catalog.vehicles.displacement')} type="number" value={engForm.displacement_cc} onChange={(e) => setEngForm({ ...engForm, displacement_cc: e.target.value })} />
            <Input label={t('catalog.vehicles.power_hp')} type="number" value={engForm.power_hp} onChange={(e) => setEngForm({ ...engForm, power_hp: e.target.value })} />
          </div>
          <Select label={t('catalog.vehicles.fuel_type')} options={selOpts(FUEL_OPTS, '—')} value={engForm.fuel_type} onChange={(e) => setEngForm({ ...engForm, fuel_type: e.target.value })} />
          <Input label={t('catalog.vehicles.description')} value={engForm.description} onChange={(e) => setEngForm({ ...engForm, description: e.target.value })} />
          <div className="flex justify-end gap-3 pt-2">
            <Button type="button" variant="secondary" onClick={() => setEngModal(false)}>{t('common.cancel')}</Button>
            <Button loading={saveEngMut.isPending} onClick={saveEng}>{t('common.save')}</Button>
          </div>
        </div>
      </Modal>

      {/* import */}
      <Modal open={importOpen} onClose={() => setImportOpen(false)} title={t('catalog.vehicles.import_title')}>
        <div className="sb-ocean sb-form sb-modal-form">
          <p className="sb-form-hint">{t('catalog.vehicles.import_hint')}</p>
          <div className="flex items-center gap-3">
            <input
              type="file"
              accept=".csv,text/csv"
              className="text-sm"
              onChange={(e) => { const f = e.target.files?.[0]; if (f) f.text().then(parseImportCsv); e.target.value = ''; }}
            />
            <button type="button" onClick={downloadImportTemplate} className="text-xs text-brand-600 hover:underline">{t('catalog.vehicles.import_template')}</button>
          </div>
          <textarea
            placeholder={t('catalog.vehicles.import_paste')}
            onChange={(e) => parseImportCsv(e.target.value)}
            rows={5}
            className="w-full rounded-input border border-border-strong bg-surface-subtle px-3 py-2 font-mono text-xs focus:border-brand-500 focus:outline-none"
          />
          {importErr && <p className="text-xs text-danger-500">{importErr}</p>}
          {importRows.length > 0 && !importResult && <p className="text-sm text-ink-secondary">{t('catalog.vehicles.import_ready', { n: importRows.length })}</p>}
          {importResult && (
            <div className="rounded-card border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-700">
              {t('catalog.vehicles.import_done', { rows: importResult.rows, makes: importResult.makes_created, models: importResult.models_created, gens: importResult.generations_created, variants: importResult.variants_created })}
            </div>
          )}
          {importMut.error && <p className="text-xs text-danger-500">{String(importMut.error)}</p>}
          <div className="flex justify-end gap-3 pt-2">
            <Button type="button" variant="secondary" onClick={() => setImportOpen(false)}>{t('common.cancel')}</Button>
            <Button loading={importMut.isPending} disabled={importRows.length === 0} onClick={() => importMut.mutate()}>{t('catalog.vehicles.import_cta', { n: importRows.length })}</Button>
          </div>
        </div>
      </Modal>
    </OceanPage>
  );
}
