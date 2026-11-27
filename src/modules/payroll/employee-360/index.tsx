/**
 * Employee 360 (phase163) — one page per person, replacing the employee popup.
 *
 * Opening an employee shows the read-only PROFILE; changes need the Edit
 * button (or ?edit=1 from the list's Edit link). A new employee opens in edit.
 *
 * Left: a live ID card and "Connected to" (login, branch, manager, sales,
 * purchasing, payroll, approvals). Right: identity, placement, access and
 * work roles, pay, documents with expiry, status and notes.
 *
 * Saving reuses the existing paths: the employee row (payroll.write), work
 * roles through the staff functions (phase129), manager and login through the
 * Team functions (phase144, admins only). No ledger posting here; final
 * settlement keeps its own posting (Dr 2360 / Cr bank).
 */
import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Pencil, Power, Save, Trash2, UserRoundCheck } from 'lucide-react';
import { getAdapter } from '@/data/index';
import { useAuthStore } from '@/store/auth';
import { useHasPermission } from '@/hooks/use-permissions';
import { useUnsavedChangesGuard } from '@/hooks/use-unsaved-changes-guard';
import { useCompanyCountry } from '@/hooks/use-company-currency';
import { useArabicEnabled } from '@/hooks/use-arabic-enabled';
import { Button } from '@/ui/button';
import { BackButton } from '@/ui/back-button';
import type { EmployeeRow } from '@/data/adapter';
import { useServiceLabel } from '../use-service-label';
import { emptyDraft, toDraft, type Draft } from './draft';
import { useEmployeeRefs, buildConnections, roleNameOf } from './refs';
import { saveEmployee } from './save';
import { IdCard, Connections } from './id-card';
import { DocumentsCard } from './documents-card';
import { AccessSection, IdentitySection, PaySection, PlacementSection, StatusSection } from './sections';
import { FinalSettlementModal } from './final-settlement-modal';
import { ProfileView } from './profile-view';
import '@/styles/stockbolt-ocean-teal.css';
import './employee-360.css';

const GCC = ['AE', 'SA', 'KW', 'BH', 'OM', 'QA'];

export default function Employee360Page() {
  const { t } = useTranslation();
  const { id: routeId } = useParams<{ id: string }>();
  const isNew = !routeId || routeId === 'new';
  const navigate = useNavigate();
  const [search, setSearch] = useSearchParams();
  const editing = isNew || search.get('edit') === '1';
  const setEditing = (on: boolean) => {
    const next = new URLSearchParams(search);
    if (on) next.set('edit', '1'); else next.delete('edit');
    setSearch(next, { replace: true });
  };
  const qc = useQueryClient();
  const { company_id } = useAuthStore();
  const canWrite = useHasPermission('payroll.write');
  const canManage = useHasPermission('users.manage');
  const country = useCompanyCountry() ?? 'AE';
  const gcc = GCC.includes(country);
  const arabicOn = useArabicEnabled();
  const service = useServiceLabel();

  const empQ = useQuery<EmployeeRow | null>({
    queryKey: ['employee', routeId],
    queryFn: () => getAdapter().employees.get(routeId!),
    enabled: !isNew,
  });
  const refs = useEmployeeRefs(company_id, canManage);
  const emp = empQ.data ?? null;

  const [draft, setDraft] = useState<Draft | null>(null);
  const [base, setBase] = useState<string>('');
  const [error, setError] = useState<string | null>(null);
  const [settling, setSettling] = useState(false);

  // Load once per employee (and the next code for a new one).
  useEffect(() => {
    if (isNew) {
      let live = true;
      getAdapter().employees.getNextCode(company_id!).catch(() => '').then((code) => {
        if (!live) return;
        const d = emptyDraft(code);
        setDraft(d); setBase(JSON.stringify(d));
      });
      return () => { live = false; };
    }
    if (emp && refs.ready) {
      const d = toDraft(emp, refs.salesRoleOf(emp.id));
      setDraft(d); setBase(JSON.stringify(d));
    }
    return undefined;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isNew, emp?.id, emp?.updated_at, refs.ready]);

  const dirty = editing && !!draft && JSON.stringify(draft) !== base;
  const confirmLeave = useUnsavedChangesGuard(dirty);
  const readOnly = !canWrite;
  const set = (key: keyof Draft, value: string | boolean) => setDraft((d) => (d ? { ...d, [key]: value } : d));

  const save = useMutation({
    mutationFn: () => saveEmployee({ draft: draft!, before: emp, company_id: company_id!, canManage, refs }),
    onSuccess: (savedId) => {
      for (const k of ['employees', 'employee', 'employee-history', 'salespeople', 'staff', 'team']) qc.invalidateQueries({ queryKey: [k] });
      setError(null);
      setBase(JSON.stringify(draft));
      // Back to the profile after saving.
      navigate(`/payroll/employees/${savedId}`, { replace: true });
    },
    onError: (e: Error) => setError(e.message === 'err_name' ? t('payOcean.err_name') : e.message),
  });

  const remove = useMutation({
    mutationFn: () => getAdapter().staff.deleteEmployee(emp!.id),
    onSuccess: () => {
      for (const k of ['employees', 'salespeople', 'team']) qc.invalidateQueries({ queryKey: [k] });
      setBase(JSON.stringify(draft));
      navigate('/payroll/employees');
    },
    onError: (e: Error) => setError(e.message),
  });

  const activeToggle = useMutation({
    mutationFn: (on: boolean) => getAdapter().employees.update(emp!.id, { is_active: on }),
    onSuccess: () => { for (const k of ['employees', 'employee', 'employee-history', 'team', 'salespeople']) qc.invalidateQueries({ queryKey: [k] }); setError(null); },
    onError: (e: Error) => setError(e.message),
  });

  const photo = useMutation({
    mutationFn: async (file: File | null) => {
      if (file) await getAdapter().employees.uploadPhoto(company_id!, emp!.id, file);
      else if (emp?.photo_path) await getAdapter().employees.removePhoto(emp.id, emp.photo_path);
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['employee', routeId] }),
    onError: (e: Error) => setError(e.message === 'employee_file_type' ? t('emp360.photo_type')
      : e.message === 'employee_file_size' ? t('emp360.file_size') : e.message),
  });

  const connections = useMemo(() => (draft ? buildConnections(t, draft, refs, emp?.id ?? null, canManage, gcc) : []),
    [t, draft, refs, emp?.id, canManage, gcc]);

  if (!isNew && empQ.isFetched && !emp) {
    return <div className="sb-ocean sb-card sb-empty">{t('emp360.not_found')}</div>;
  }
  if (!draft) return <div className="sb-ocean sb-card sb-empty">{t('common.loading')}</div>;

  const busy = save.isPending || remove.isPending || photo.isPending || activeToggle.isPending;
  const branchName = refs.branches.find((b) => b.id === draft.branch_id)?.name;
  const whName = refs.warehouses.find((w) => w.id === draft.warehouse_id)?.name;
  const idLabel = country === 'AE' ? t('payOcean.f_emirates_id') : t('emp360.doc_national_id');

  return (
    <div className="sb-ocean sb-docx sb-e360" data-testid="employee-360">
      <div className="sb-card sb-doc-bar">
        <div className="sb-doc-bar-id">
          <BackButton to="/payroll/employees" label={t('payOcean.emp_title')} confirm={confirmLeave} />
          <h1 className="sb-doc-bar-no">{isNew ? t('emp360.title_new') : draft.name || t('payOcean.edit_employee')}</h1>
          {editing && !isNew && <span className="sb-pill sb-pill-good" data-testid="e360-editing">{t('emp360.editing')}</span>}
          {dirty && <span className="sb-pill sb-pill-muted">{t('emp360.unsaved')}</span>}
        </div>
        {canWrite && !editing && emp && (
          <div className="sb-doc-bar-actions" data-testid="e360-view-actions">
            {draft.is_active && (
              <Button size="sm" variant="ghost" disabled={busy} title={t('payOcean.settle_hint')} onClick={() => setSettling(true)}>
                <UserRoundCheck size={15} aria-hidden="true" /> {t('payOcean.final_settlement')}
              </Button>
            )}
            <Button size="sm" variant="ghost" disabled={busy} data-testid="e360-toggle-active"
              onClick={() => { if (window.confirm(draft.is_active ? t('emp360.confirm_deactivate', { name: draft.name }) : t('emp360.confirm_reactivate', { name: draft.name }))) activeToggle.mutate(!draft.is_active); }}>
              <Power size={15} aria-hidden="true" /> {draft.is_active ? t('emp360.deactivate') : t('emp360.reactivate')}
            </Button>
            <Button size="sm" variant="ghost" style={{ color: 'var(--sb-danger)' }} disabled={busy} title={t('staff.delete_hint')}
              onClick={() => { if (window.confirm(t('staff.confirm_delete', { name: draft.name }))) { setError(null); remove.mutate(); } }}>
              <Trash2 size={15} aria-hidden="true" /> {t('common.delete')}
            </Button>
            <Button size="sm" variant="primary" disabled={busy} onClick={() => setEditing(true)} data-testid="e360-edit">
              <Pencil size={15} aria-hidden="true" /> {t('common.edit')}
            </Button>
          </div>
        )}
        {canWrite && editing && (
          <div className="sb-doc-bar-actions" data-testid="e360-edit-actions">
            <Button size="sm" variant="ghost" disabled={busy}
              onClick={() => {
                if (dirty && !window.confirm(t('emp360.discard_confirm'))) return;
                if (isNew) { setBase(JSON.stringify(draft)); navigate('/payroll/employees'); return; }
                setDraft(JSON.parse(base) as Draft); setError(null); setEditing(false);
              }}>
              {t('common.cancel')}
            </Button>
            <Button size="sm" variant="primary" disabled={busy || !draft.name.trim() || (!dirty && !isNew)}
              onClick={() => save.mutate()} data-testid="e360-save">
              <Save size={15} aria-hidden="true" /> {save.isPending ? t('common.saving') : t('emp360.save')}
            </Button>
          </div>
        )}
      </div>

      {error && <p className="sb-alert sb-alert-danger" role="alert">{error}</p>}

      <div className="sb-e360-layout">
        <aside className="sb-e360-side">
          <IdCard draft={draft} place={[branchName, whName].filter(Boolean).join(' · ')}
            service={service(draft.joining_date || null)} photoPath={emp?.photo_path ?? null}
            canEditPhoto={canWrite && editing} savedYet={!!emp} busy={busy}
            onPhoto={(f) => photo.mutate(f)} onRemovePhoto={() => photo.mutate(null)} />
          <Connections items={connections} />
        </aside>
        {!editing && emp ? (
          <ProfileView draft={draft} emp={emp} refs={refs} service={service(draft.joining_date || null)}
            gcc={gcc} idLabel={idLabel} canManage={canManage} />
        ) : (
          <div className="sb-e360-main">
            <IdentitySection draft={draft} set={set} readOnly={readOnly} arabicOn={arabicOn} />
            <PlacementSection draft={draft} set={set} readOnly={readOnly} branches={refs.branches} warehouses={refs.warehouses}
              team={refs.team} selfId={emp?.id ?? null} canManage={canManage} />
            <AccessSection draft={draft} set={set} readOnly={readOnly} users={refs.users} team={refs.team}
              selfId={emp?.id ?? null} canManage={canManage} roleName={roleNameOf(t, draft.user_id, refs)} />
            <PaySection draft={draft} set={set} readOnly={readOnly} gcc={gcc} banks={refs.bankNames} />
            <DocumentsCard draft={draft} set={set} idLabel={idLabel} gcc={gcc} employeeId={emp?.id ?? null}
              companyId={company_id!} canWrite={canWrite} readOnly={readOnly} />
            <StatusSection draft={draft} set={set} readOnly={readOnly} />
          </div>
        )}
      </div>

      {settling && emp && (
        <FinalSettlementModal employee={emp} onClose={() => setSettling(false)} onDone={() => setSettling(false)} />
      )}
    </div>
  );
}
