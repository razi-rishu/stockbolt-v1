// phase164 (HRMS H1) — directory filters, import clean-up and history text.
import { describe, expect, it } from 'vitest';
import type { TFunction } from 'i18next';
import { docState, emptyFilter, filterEmployees, normaliseImportRows, toExportRows } from '@/modules/payroll/employee-directory';
import { describeEvent } from '@/modules/payroll/employee-360/history-text';
import type { EmployeeRow } from '@/data/adapter';

const today = new Date(2026, 10, 27);
const emp = (o: Partial<EmployeeRow>): EmployeeRow => ({
  id: 'x', company_id: 'c', code: null, name: 'N', name_ar: null, designation: null, department: null, phone: null, email: null,
  is_active: true, branch_id: null, warehouse_id: null, employment_type: null, reports_to_id: null,
  emirates_id_expiry: null, passport_expiry: null, visa_expiry: null, labour_card_expiry: null,
  basic_salary: 0, housing_allowance: 0, transport_allowance: 0, other_allowance: 0, ...o,
} as unknown as EmployeeRow);

const rows = [
  emp({ id: '1', name: 'Ravi Nair', code: 'HS001', branch_id: 'A', department: 'Sales', employment_type: 'permanent' }),
  emp({ id: '2', name: 'Aisha Khan', code: 'HS002', branch_id: 'B', department: 'HR', employment_type: 'probation', visa_expiry: '2026-12-20' }),
  emp({ id: '3', name: 'Old Timer', code: 'HS003', branch_id: null, department: 'Sales', is_active: false }),
  emp({ id: '4', name: 'Grace', email: 'grace@x.com', branch_id: 'A', passport_expiry: '2026-01-01' }),
];

describe('filterEmployees', () => {
  it('defaults to active only', () => expect(filterEmployees(rows, emptyFilter, true, today).map((e) => e.id)).toEqual(['1', '2', '4']));
  it('branch, no-branch, department, type, status', () => {
    expect(filterEmployees(rows, { ...emptyFilter, branch_id: 'A' }, true, today).map((e) => e.id)).toEqual(['1', '4']);
    expect(filterEmployees(rows, { ...emptyFilter, branch_id: '__none', status: 'all' }, true, today).map((e) => e.id)).toEqual(['3']);
    expect(filterEmployees(rows, { ...emptyFilter, department: 'Sales', status: 'all' }, true, today).map((e) => e.id)).toEqual(['1', '3']);
    expect(filterEmployees(rows, { ...emptyFilter, employment_type: 'probation' }, true, today).map((e) => e.id)).toEqual(['2']);
    expect(filterEmployees(rows, { ...emptyFilter, status: 'inactive' }, true, today).map((e) => e.id)).toEqual(['3']);
  });
  it('search matches name, code and email, case-insensitive', () => {
    expect(filterEmployees(rows, { ...emptyFilter, search: 'hs002' }, true, today).map((e) => e.id)).toEqual(['2']);
    expect(filterEmployees(rows, { ...emptyFilter, search: 'GRACE@' }, true, today).map((e) => e.id)).toEqual(['4']);
  });
  it('documents filter: visa only counts in the GCC', () => {
    expect(filterEmployees(rows, { ...emptyFilter, docs: true }, true, today).map((e) => e.id)).toEqual(['2', '4']);
    expect(filterEmployees(rows, { ...emptyFilter, docs: true }, false, today).map((e) => e.id)).toEqual(['4']);
    expect(docState(rows[3], true, today)).toBe('expired');
    expect(docState(rows[1], true, today)).toBe('soon');
  });
});

describe('import clean-up and export', () => {
  it('keeps template columns only, trims, drops blanks and empty rows, accepts "Basic Salary"', () => {
    expect(normaliseImportRows([
      { ' Name ': ' Sara ', 'Basic Salary': '5000', secret: 'x', code: '' },
      { name: '', code: '' },
    ])).toEqual([{ name: 'Sara', basic_salary: '5000' }]);
  });
  it('export uses names, not ids, and the manager code', () => {
    const out = toExportRows([emp({ code: 'A1', branch_id: 'b1', reports_to_id: 'm1', basic_salary: 100 })],
      (id) => (id === 'b1' ? 'Branch A' : ''), () => '', (id) => (id === 'm1' ? 'M01' : ''));
    expect(out[0]).toMatchObject({ code: 'A1', branch: 'Branch A', manager_code: 'M01', basic_salary: 100, status: 'active' });
  });
});

describe('describeEvent', () => {
  const t = ((k: string, o?: Record<string, unknown>) => `${k}${o ? ' ' + JSON.stringify(o) : ''}`) as unknown as TFunction;
  const refs = { branches: [{ id: 'b1', name: 'Head Office' }, { id: 'b2', name: 'Branch A' }], warehouses: [], team: [{ employee_id: 'm', code: 'E1', name: 'Boss' }] } as never;
  it('names branches and managers, formats salary, shows deactivation', () => {
    expect(describeEvent(t, { event_type: 'branch', old_value: 'b1', new_value: 'b2' }, refs)).toContain('"from":"Head Office","to":"Branch A"');
    expect(describeEvent(t, { event_type: 'manager', old_value: null, new_value: 'm' }, refs)).toContain('"to":"E1 · Boss"');
    expect(describeEvent(t, { event_type: 'salary', old_value: { basic_salary: 5000 }, new_value: { basic_salary: 5500 } }, refs)).toContain('"from":"5,000.00","to":"5,500.00"');
    expect(describeEvent(t, { event_type: 'status', old_value: true, new_value: false }, refs)).toBe('emp360.ev_deactivated');
  });
});
