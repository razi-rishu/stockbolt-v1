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
 */
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { getAdapter } from '@/data/index';
import { useAuthStore } from '@/store/auth';
import { useTranslation } from 'react-i18next';
import { Plus, Pencil } from 'lucide-react';
import { OceanPage, OceanTable } from '@/components/ocean-list';
import { ReportFigures } from '@/components/ocean-report';
import type { Column } from '@/ui/table';
import { computeGratuity } from './gratuity';
import { useServiceLabel } from './use-service-label';
import type { EmployeeRow, SalespersonRow } from '@/data/adapter';
import { useCompanyCountry } from '@/hooks/use-company-currency';
import { expiryState } from './employee-360/draft';

const fmt = (n: number) => n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const GCC = ['AE', 'SA', 'KW', 'BH', 'OM', 'QA'];

export default function EmployeesPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { company_id } = useAuthStore();
  const [showInactive, setShowInactive] = useState(false);
  const gcc = GCC.includes(useCompanyCountry() ?? 'AE');

  const { data: employees = [], isLoading } = useQuery<EmployeeRow[]>({
    queryKey: ['employees', company_id, showInactive],
    queryFn: () => getAdapter().employees.list(company_id!, { includeInactive: showInactive }),
    enabled: !!company_id,
  });

  // phase129 — each employee's sales role (if any), active or not.
  const { data: salesRoles = [] } = useQuery<SalespersonRow[]>({
    queryKey: ['salespeople', company_id, true],
    queryFn: () => getAdapter().salespeople.list(company_id!, { include_inactive: true }),
    enabled: !!company_id,
  });
  const roleOf = (empId: string) => salesRoles.find(s => s.employee_id === empId);

  // phase163 — one page per person (Employee 360) instead of a popup.
  const openNew = () => navigate('/payroll/employees/new');
  const openEdit = (e: EmployeeRow) => navigate(`/payroll/employees/${e.id}`);

  const totalPackage = (e: EmployeeRow) =>
    Number(e.basic_salary) + Number(e.housing_allowance) + Number(e.transport_allowance) + Number(e.other_allowance);
  const service = useServiceLabel();
  const gratuityOf = (e: EmployeeRow) => computeGratuity(e.joining_date as string | null, Number(e.basic_salary));
  /** Worst document state: expired beats due soon. */
  const docState = (e: EmployeeRow) => {
    const st = [e.emirates_id_expiry, e.passport_expiry, ...(gcc ? [e.visa_expiry, e.labour_card_expiry] : [])]
      .map(d => expiryState(d ?? ''));
    return st.includes('expired') ? 'expired' : st.includes('soon') ? 'soon' : null;
  };

  const active = employees.filter(e => e.is_active);
  const monthlyPackage = active.reduce((s, e) => s + totalPackage(e), 0);
  const gratuityTotal = active.reduce((s, e) => s + gratuityOf(e), 0);
  const docAlerts = active.filter(e => docState(e)).length;

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
    { key: 'roles', header: t('staff.col_roles'), render: e => (
      <span style={{ display: 'inline-flex', gap: 4, flexWrap: 'wrap' }}>
        {roleOf(e.id)?.is_active && <span className="sb-pill sb-pill-good">{t('staff.role_sales')}</span>}
        {e.is_purchaser && <span className="sb-pill sb-pill-good">{t('staff.role_purchasing')}</span>}
      </span>
    ) },
    { key: 'service', header: t('payOcean.col_service'), render: e => service(e.joining_date as string | null) },
    { key: 'basic', header: t('payOcean.col_basic'), align: 'end', render: e => <bdi dir="ltr" className="sb-dash-num" style={{ fontWeight: 500 }}>{fmt(Number(e.basic_salary))}</bdi> },
    { key: 'package', header: t('payOcean.col_package'), align: 'end', render: e => <bdi dir="ltr" className="sb-dash-num">{fmt(totalPackage(e))}</bdi> },
    { key: 'gratuity', header: t('payOcean.col_gratuity'), align: 'end', render: e => <bdi dir="ltr" className="sb-dash-num" style={{ color: 'var(--sb-primary-dark)' }}>{fmt(gratuityOf(e))}</bdi> },
    { key: 'status', header: '', render: e => {
      const ds = e.is_active ? docState(e) : null;
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
    { key: 'edit', header: '', align: 'end', render: e => (
      <button type="button" className="sb-row-link text-brand-600"
        onClick={(ev) => { ev.stopPropagation(); openEdit(e); }}>
        <Pencil size={14} aria-hidden="true" /> {t('common.edit')}
      </button>
    ) },
  ];

  return (
    // Ocean Teal (UI v1.1): look only — same employee record and salary
    // structure as before. Editing, roles, documents and final settlement are
    // on the Employee 360 page (phase163).
    <OceanPage
      testid="employees-ocean"
      title={t('payOcean.emp_title')}
      subtitle={t('payOcean.emp_count', { count: employees.length })}
      actions={
        <button type="button" className="sb-primary-btn sb-btn-inline" onClick={openNew}>
          <Plus size={18} aria-hidden="true" /> {t('payOcean.new_employee')}
        </button>
      }
      below={
        <label className="sb-pay-toggle">
          <input type="checkbox" checked={showInactive} onChange={e => setShowInactive(e.target.checked)} />
          {t('payOcean.show_inactive')}
        </label>
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

        {isLoading
          ? <div className="sb-card sb-empty">{t('common.loading')}</div>
          : <OceanTable
              columns={columns} rows={employees} keyFn={e => e.id} onRowClick={openEdit}
              rowMuted={e => !e.is_active} emptyMessage={t('payOcean.emp_empty')} cardTitleKey="name"
            />}
      </div>
    </OceanPage>
  );
}
