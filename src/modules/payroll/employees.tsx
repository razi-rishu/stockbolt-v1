/**
 * Employees master — Payroll P1 (owner override 2026-06-13).
 *
 * Master data only (no GL impact). WPS-ready fields (MOL ID, IBAN) are
 * captured now so the P2 SIF export needs no schema change. Salary
 * structure = basic + 3 allowances; the monthly run copies these as a
 * starting point and stays editable per month.
 *
 * phase129 — this is the ONE person record. Sales and Purchasing roles are
 * ticked here (or added from a sales / purchase document); a salesperson is
 * this employee's sales role, so renaming here renames them everywhere.
 * Delete only removes a record made by mistake (no payroll, loan, leave or
 * document history) — otherwise untick Active.
 *
 * phase163 — the list only; each person opens on the Employee 360 page.
 * phase164 (HRMS H1) — directory: search, branch / department / type / status
 * and document filters, 50 per page, export (CSV / Excel) and checked import.
 */
import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { getAdapter } from '@/data/index';
import { useAuthStore } from '@/store/auth';
import { useTranslation } from 'react-i18next';
import { Plus, Pencil, Download, Upload, Search, X } from 'lucide-react';
import { OceanPage, OceanTable } from '@/components/ocean-list';
import { ReportFigures } from '@/components/ocean-report';
import { Pagination, paginate } from '@/ui/pagination';
import type { Column } from '@/ui/table';
import { computeGratuity } from './gratuity';
import { useServiceLabel } from './use-service-label';
import type { BranchRow, EmployeeRow, SalespersonRow } from '@/data/adapter';
import { useCompanyCountry } from '@/hooks/use-company-currency';
import { useHasPermission } from '@/hooks/use-permissions';
import { downloadCSV, downloadXLSX } from '@/lib/io-export';
import { EMPLOYMENT_TYPES } from './employee-360/draft';
import { DirectoryFilter, emptyFilter, docState, filterEmployees, IMPORT_COLUMNS, PAGE_SIZE, toExportRows } from './employee-directory';
import { EmployeeImportModal } from './employee-import-modal';
import './employee-360/employee-360.css';

const fmt = (n: number) => n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const GCC = ['AE', 'SA', 'KW', 'BH', 'OM', 'QA'];

export default function EmployeesPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { company_id } = useAuthStore();
  const canWrite = useHasPermission('payroll.write');
  const gcc = GCC.includes(useCompanyCountry() ?? 'AE');
  const [filter, setFilter] = useState<DirectoryFilter>(emptyFilter);
  const [page, setPage] = useState(1);
  const [importing, setImporting] = useState(false);
  const setF = <K extends keyof DirectoryFilter>(k: K, v: DirectoryFilter[K]) => { setFilter((f) => ({ ...f, [k]: v })); setPage(1); };

  // All employees once (filters are instant); inactive included for the status filter.
  const { data: employees = [], isLoading } = useQuery<EmployeeRow[]>({
    queryKey: ['employees', company_id, true],
    queryFn: () => getAdapter().employees.list(company_id!, { includeInactive: true }),
    enabled: !!company_id,
  });
  const { data: branches = [] } = useQuery<BranchRow[]>({
    queryKey: ['e360-branches', company_id],
    queryFn: () => getAdapter().branches.list(company_id!),
    enabled: !!company_id,
  });
  const { data: warehouses = [] } = useQuery({
    queryKey: ['e360-warehouses', company_id],
    queryFn: () => getAdapter().warehouses.list(company_id!),
    enabled: !!company_id,
  });

  // phase129 — each employee's sales role (if any), active or not.
  const { data: salesRoles = [] } = useQuery<SalespersonRow[]>({
    queryKey: ['salespeople', company_id, true],
    queryFn: () => getAdapter().salespeople.list(company_id!, { include_inactive: true }),
    enabled: !!company_id,
  });
  const roleOf = (empId: string) => salesRoles.find(s => s.employee_id === empId);

  // Row / card click opens the read-only profile; only the Edit link opens the form.
  const openProfile = (e: EmployeeRow) => navigate(`/payroll/employees/${e.id}`);
  const openEdit = (e: EmployeeRow) => navigate(`/payroll/employees/${e.id}?edit=1`);
  const openNew = () => navigate('/payroll/employees/new');

  const totalPackage = (e: EmployeeRow) =>
    Number(e.basic_salary) + Number(e.housing_allowance) + Number(e.transport_allowance) + Number(e.other_allowance);
  const service = useServiceLabel();
  const gratuityOf = (e: EmployeeRow) => computeGratuity(e.joining_date as string | null, Number(e.basic_salary));
  const branchName = (id: string | null) => branches.find(b => b.id === id)?.name ?? '';

  const shown = useMemo(() => filterEmployees(employees, filter, gcc), [employees, filter, gcc]);
  const pageRows = paginate(shown, page, PAGE_SIZE);
  const departments = useMemo(() => [...new Set(employees.map(e => (e.department ?? '').trim()).filter(Boolean))].sort(), [employees]);
  const active = employees.filter(e => e.is_active);
  const monthlyPackage = active.reduce((s, e) => s + totalPackage(e), 0);
  const gratuityTotal = active.reduce((s, e) => s + gratuityOf(e), 0);
  const docAlerts = active.filter(e => docState(e, gcc)).length;
  const filtered = JSON.stringify(filter) !== JSON.stringify(emptyFilter);

  function doExport(kind: 'csv' | 'xlsx') {
    const codeOf = (id: string | null) => employees.find(x => x.id === id)?.code ?? '';
    const whName = (id: string | null) => warehouses.find(w => w.id === id)?.name ?? '';
    const rows = toExportRows(shown, branchName, whName, codeOf);
    const headers = [...IMPORT_COLUMNS, 'status'];
    const name = `employees-${new Date().toISOString().slice(0, 10)}`;
    if (kind === 'csv') downloadCSV(rows, headers, `${name}.csv`); else void downloadXLSX(rows, headers, `${name}.xlsx`);
  }

  const columns: Column<EmployeeRow>[] = [
    { key: 'name', header: t('payOcean.col_name'), render: e => (
      <span className="sb-pay-namecode">
        <span style={{ fontWeight: 700 }}>{e.name}</span>
        {e.code && <bdi dir="ltr" className="sb-acct-code">{e.code}</bdi>}
      </span>
    ) },
    { key: 'designation', header: t('payOcean.col_designation'), render: e => (
      <span>
        {e.designation ?? '—'}
        {e.department && <span className="sb-fx-name" style={{ display: 'block', fontSize: 12 }}>{e.department}</span>}
      </span>
    ) },
    ...(branches.length > 0 ? [{ key: 'branch', header: t('emp360.f_branch'), render: (e: EmployeeRow) => branchName(e.branch_id) || '—' }] : []),
    { key: 'roles', header: t('staff.col_roles'), render: e => (
      <span style={{ display: 'inline-flex', gap: 4, flexWrap: 'wrap' }}>
        {roleOf(e.id)?.is_active && <span className="sb-pill sb-pill-good">{t('staff.role_sales')}</span>}
        {e.is_purchaser && <span className="sb-pill sb-pill-good">{t('staff.role_purchasing')}</span>}
      </span>
    ) },
    { key: 'service', header: t('payOcean.col_service'), render: e => service(e.joining_date as string | null) },
    { key: 'package', header: t('payOcean.col_package'), align: 'end', render: e => <bdi dir="ltr" className="sb-dash-num">{fmt(totalPackage(e))}</bdi> },
    { key: 'gratuity', header: t('payOcean.col_gratuity'), align: 'end', render: e => <bdi dir="ltr" className="sb-dash-num" style={{ color: 'var(--sb-primary-dark)' }}>{fmt(gratuityOf(e))}</bdi> },
    { key: 'status', header: '', render: e => {
      const ds = e.is_active ? docState(e, gcc) : null;
      return (
        <span style={{ display: 'inline-flex', gap: 4, flexWrap: 'wrap' }}>
          <span className={`sb-pill ${e.is_active ? 'sb-pill-good' : 'sb-pill-muted'}`}>{e.is_active ? t('common.active') : t('payOcean.inactive')}</span>
          {ds && (
            <span className="sb-pill" data-testid="emp-doc-alert"
              style={{ background: ds === 'expired' ? 'var(--sb-danger-bg)' : 'var(--sb-background)', color: ds === 'expired' ? 'var(--sb-danger)' : 'var(--sb-warning)', border: '1px solid currentColor' }}>
              {ds === 'expired' ? t('emp360.list_doc_expired') : t('emp360.list_doc_soon')}
            </span>
          )}
        </span>
      );
    } },
    ...(canWrite ? [{ key: 'edit', header: '', align: 'end' as const, render: (e: EmployeeRow) => (
      <button type="button" className="sb-row-link text-brand-600"
        onClick={(ev) => { ev.stopPropagation(); openEdit(e); }}>
        <Pencil size={14} aria-hidden="true" /> {t('common.edit')}
      </button>
    ) }] : []),
  ];

  return (
    // Ocean Teal (UI v1.1): look only — same employee record and salary
    // structure as before. Editing, roles, documents and final settlement are
    // on the Employee 360 page (phase163).
    <OceanPage
      testid="employees-ocean"
      title={t('payOcean.emp_title')}
      subtitle={filtered ? t('empDir.showing', { shown: shown.length, total: employees.length }) : t('payOcean.emp_count', { count: active.length })}
      actions={
        <>
          <button type="button" className="sb-gc-btn" onClick={() => doExport('xlsx')} disabled={shown.length === 0} data-testid="emp-export">
            <Download size={16} aria-hidden="true" /> {t('empDir.export')}
          </button>
          {canWrite && (
            <button type="button" className="sb-gc-btn" onClick={() => setImporting(true)} data-testid="emp-import-open">
              <Upload size={16} aria-hidden="true" /> {t('empDir.import')}
            </button>
          )}
          {canWrite && (
            <button type="button" className="sb-primary-btn sb-btn-inline" onClick={openNew}>
              <Plus size={18} aria-hidden="true" /> {t('payOcean.new_employee')}
            </button>
          )}
        </>
      }
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        {employees.length > 0 && (
          <div className="sb-card sb-rpt-card">
            <ReportFigures figures={[
              { label: t('payOcean.fig_active'), value: <bdi dir="ltr">{active.length}</bdi> },
              { label: t('payOcean.fig_monthly'), value: <bdi dir="ltr">{fmt(monthlyPackage)}</bdi>, tone: 'brand' },
              { label: t('payOcean.fig_gratuity'), value: <bdi dir="ltr">{fmt(gratuityTotal)}</bdi>, note: t('payOcean.fig_gratuity_note') },
              ...(docAlerts > 0 ? [{ label: t('emp360.fig_doc_alerts'), value: <bdi dir="ltr">{docAlerts}</bdi>, note: t('emp360.fig_doc_alerts_note') }] : []),
            ]} />
          </div>
        )}

        <div className="sb-card sb-empdir-filters" data-testid="emp-filters">
          <label className="sb-empdir-search">
            <Search size={16} aria-hidden="true" />
            <input type="search" value={filter.search} placeholder={t('empDir.search_ph')} aria-label={t('empDir.search_ph')}
              onChange={(e) => setF('search', e.target.value)} data-testid="emp-search" />
          </label>
          {branches.length > 0 && (
            <select className="sb-team-select" value={filter.branch_id} onChange={(e) => setF('branch_id', e.target.value)} aria-label={t('emp360.f_branch')} data-testid="emp-f-branch">
              <option value="">{t('empDir.all_branches')}</option>
              {branches.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
              <option value="__none">{t('empDir.no_branch')}</option>
            </select>
          )}
          <select className="sb-team-select" value={filter.department} onChange={(e) => setF('department', e.target.value)} aria-label={t('staff.f_department')} data-testid="emp-f-dept">
            <option value="">{t('empDir.all_departments')}</option>
            {departments.map(d => <option key={d} value={d}>{d}</option>)}
          </select>
          <select className="sb-team-select" value={filter.employment_type} onChange={(e) => setF('employment_type', e.target.value)} aria-label={t('emp360.f_employment_type')} data-testid="emp-f-type">
            <option value="">{t('empDir.all_types')}</option>
            {EMPLOYMENT_TYPES.map(k => <option key={k} value={k}>{t(`emp360.et_${k}`)}</option>)}
          </select>
          <select className="sb-team-select" value={filter.status} onChange={(e) => setF('status', e.target.value as DirectoryFilter['status'])} aria-label={t('emp360.f_status')} data-testid="emp-f-status">
            <option value="active">{t('empDir.status_active')}</option>
            <option value="inactive">{t('empDir.status_inactive')}</option>
            <option value="all">{t('empDir.status_all')}</option>
          </select>
          <label className="sb-e360-check" style={{ fontSize: 13 }}>
            <input type="checkbox" checked={filter.docs} onChange={(e) => setF('docs', e.target.checked)} data-testid="emp-f-docs" />
            <span>{t('empDir.docs_only')}</span>
          </label>
          {filtered && (
            <button type="button" className="sb-e360-link" onClick={() => { setFilter(emptyFilter); setPage(1); }}>
              <X size={14} aria-hidden="true" /> {t('empDir.clear')}
            </button>
          )}
        </div>

        {isLoading
          ? <div className="sb-card sb-empty">{t('common.loading')}</div>
          : <OceanTable
              columns={columns} rows={pageRows} keyFn={e => e.id} onRowClick={openProfile}
              rowMuted={e => !e.is_active} emptyMessage={filtered ? t('empDir.no_match') : t('payOcean.emp_empty')} cardTitleKey="name"
            />}
        {shown.length > PAGE_SIZE && <Pagination page={page} pageSize={PAGE_SIZE} total={shown.length} onChange={setPage} />}
      </div>
      {importing && <EmployeeImportModal onClose={() => setImporting(false)} />}
    </OceanPage>
  );
}
