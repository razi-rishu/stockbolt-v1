import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { getAdapter } from '@/data/index';
import { useAuthStore } from '@/store/auth';
import { Button } from '@/ui/button';
import { Input } from '@/ui/input';
import { Modal } from '@/ui/modal';
import { Table, type Column } from '@/ui/table';
import type { VehicleMakeRow, VehicleModelRow } from '@/data/adapter';

export default function VehicleMakesPage() {
  const { t } = useTranslation();
  const { company_id } = useAuthStore();
  const qc = useQueryClient();

  // Makes state
  const [makeModal, setMakeModal] = useState(false);
  const [editingMake, setEditingMake] = useState<VehicleMakeRow | null>(null);
  const [makeName, setMakeName] = useState('');
  const [makeErr, setMakeErr] = useState('');

  // Models state (drill-down)
  const [selectedMake, setSelectedMake] = useState<VehicleMakeRow | null>(null);
  const [modelModal, setModelModal] = useState(false);
  const [editingModel, setEditingModel] = useState<VehicleModelRow | null>(null);
  const [modelName, setModelName] = useState('');
  const [modelChassis, setModelChassis] = useState('');

  const { data: makes = [], isLoading } = useQuery({
    queryKey: ['vehicle_makes', company_id],
    queryFn: () => getAdapter().vehicleMakes.list(company_id!),
    enabled: !!company_id,
  });

  const { data: models = [] } = useQuery({
    queryKey: ['vehicle_models', selectedMake?.id],
    queryFn: () => getAdapter().vehicleMakes.listModels(selectedMake!.id),
    enabled: !!selectedMake,
  });

  const createMake = useMutation({
    mutationFn: () => getAdapter().vehicleMakes.create({ company_id: company_id!, name: makeName }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['vehicle_makes', company_id] }); setMakeModal(false); },
  });

  const updateMake = useMutation({
    mutationFn: () => getAdapter().vehicleMakes.update(editingMake!.id, makeName),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['vehicle_makes', company_id] }); setMakeModal(false); },
  });

  const deleteMake = useMutation({
    mutationFn: (id: string) => getAdapter().vehicleMakes.remove(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['vehicle_makes', company_id] });
      if (selectedMake && deleteMake.variables === selectedMake.id) setSelectedMake(null);
    },
  });

  const createModel = useMutation({
    mutationFn: () => getAdapter().vehicleMakes.createModel({ make_id: selectedMake!.id, name: modelName, chassis_code: modelChassis || null }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['vehicle_models', selectedMake?.id] }); setModelModal(false); },
  });

  const updateModel = useMutation({
    mutationFn: () => getAdapter().vehicleMakes.updateModel(editingModel!.id, { name: modelName, chassis_code: modelChassis || null }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['vehicle_models', selectedMake?.id] }); setModelModal(false); },
  });

  const deleteModel = useMutation({
    mutationFn: (id: string) => getAdapter().vehicleMakes.removeModel(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['vehicle_models', selectedMake?.id] }),
  });

  function openAddMake() { setEditingMake(null); setMakeName(''); setMakeErr(''); setMakeModal(true); }
  function openEditMake(m: VehicleMakeRow) { setEditingMake(m); setMakeName(m.name); setMakeErr(''); setMakeModal(true); }

  function openAddModel() { setEditingModel(null); setModelName(''); setModelChassis(''); setModelModal(true); }
  function openEditModel(m: VehicleModelRow) { setEditingModel(m); setModelName(m.name); setModelChassis(m.chassis_code ?? ''); setModelModal(true); }

  async function saveMake() {
    if (!makeName.trim()) { setMakeErr(t('common.required')); return; }
    if (editingMake) await updateMake.mutateAsync();
    else await createMake.mutateAsync();
  }

  const makeColumns: Column<VehicleMakeRow>[] = [
    { key: 'name', header: t('catalog.vehicles.make'), render: (r) => <span className={`font-medium ${selectedMake?.id === r.id ? 'text-brand-600' : ''}`}>{r.name}</span> },
    {
      key: 'actions', header: '', width: '120px',
      render: (r) => (
        <div className="flex gap-2">
          <button onClick={(e) => { e.stopPropagation(); openEditMake(r); }} className="text-xs text-brand-600 hover:underline">{t('common.edit')}</button>
          <button onClick={(e) => { e.stopPropagation(); if (confirm(t('common.confirm_delete'))) deleteMake.mutate(r.id); }} className="text-xs text-danger-500 hover:underline">{t('common.delete')}</button>
        </div>
      ),
    },
  ];

  const modelColumns: Column<VehicleModelRow>[] = [
    { key: 'name', header: t('catalog.vehicles.model'), render: (r) => <span className="font-medium">{r.name}</span> },
    { key: 'chassis', header: t('catalog.vehicles.chassis'), render: (r) => r.chassis_code ?? '—' },
    {
      key: 'actions', header: '', width: '120px',
      render: (r) => (
        <div className="flex gap-2">
          <button onClick={(e) => { e.stopPropagation(); openEditModel(r); }} className="text-xs text-brand-600 hover:underline">{t('common.edit')}</button>
          <button onClick={(e) => { e.stopPropagation(); if (confirm(t('common.confirm_delete'))) deleteModel.mutate(r.id); }} className="text-xs text-danger-500 hover:underline">{t('common.delete')}</button>
        </div>
      ),
    },
  ];

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-xl font-bold text-ink-primary">{t('catalog.vehicles.title')}</h1>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        {/* Makes */}
        <div className="flex flex-col gap-3">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold text-ink-secondary">{t('catalog.vehicles.makes')}</h2>
            <Button size="sm" onClick={openAddMake}>{t('common.add')}</Button>
          </div>
          {isLoading
            ? <div className="py-8 text-center text-ink-tertiary">{t('common.loading')}</div>
            : <Table columns={makeColumns} rows={makes} keyFn={(r) => r.id} onRowClick={setSelectedMake} emptyMessage={t('catalog.vehicles.empty_makes')} />
          }
        </div>

        {/* Models */}
        <div className="flex flex-col gap-3">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold text-ink-secondary">
              {selectedMake ? `${t('catalog.vehicles.models_for')} ${selectedMake.name}` : t('catalog.vehicles.select_make')}
            </h2>
            {selectedMake && <Button size="sm" onClick={openAddModel}>{t('common.add')}</Button>}
          </div>
          {selectedMake
            ? <Table columns={modelColumns} rows={models} keyFn={(r) => r.id} emptyMessage={t('catalog.vehicles.empty_models')} />
            : <div className="rounded-card border border-border-subtle p-8 text-center text-sm text-ink-tertiary">{t('catalog.vehicles.select_make_hint')}</div>
          }
        </div>
      </div>

      {/* Make modal */}
      <Modal open={makeModal} onClose={() => setMakeModal(false)} title={editingMake ? t('catalog.vehicles.edit_make') : t('catalog.vehicles.add_make')}>
        <div className="flex flex-col gap-4">
          <Input label={t('catalog.vehicles.make_name')} required value={makeName} onChange={(e) => setMakeName(e.target.value)} error={makeErr} />
          <div className="flex justify-end gap-3 pt-2">
            <Button type="button" variant="secondary" onClick={() => setMakeModal(false)}>{t('common.cancel')}</Button>
            <Button loading={createMake.isPending || updateMake.isPending} onClick={saveMake}>{t('common.save')}</Button>
          </div>
        </div>
      </Modal>

      {/* Model modal */}
      <Modal open={modelModal} onClose={() => setModelModal(false)} title={editingModel ? t('catalog.vehicles.edit_model') : t('catalog.vehicles.add_model')}>
        <div className="flex flex-col gap-4">
          <Input label={t('catalog.vehicles.model_name')} required value={modelName} onChange={(e) => setModelName(e.target.value)} />
          <Input label={t('catalog.vehicles.chassis')} value={modelChassis} onChange={(e) => setModelChassis(e.target.value)} />
          <div className="flex justify-end gap-3 pt-2">
            <Button type="button" variant="secondary" onClick={() => setModelModal(false)}>{t('common.cancel')}</Button>
            <Button loading={createModel.isPending || updateModel.isPending} onClick={async () => { if (editingModel) await updateModel.mutateAsync(); else await createModel.mutateAsync(); }}>{t('common.save')}</Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
