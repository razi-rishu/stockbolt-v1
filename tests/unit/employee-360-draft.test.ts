// phase163 — Employee 360 form rules: expiry states, and the saved row keeps
// salary and status exactly while empty new fields are stored as null.
import { describe, expect, it } from 'vitest';
import { daysUntil, emptyDraft, expiryState, initials, packageOf, toDraft, toRow } from '@/modules/payroll/employee-360/draft';
import type { EmployeeRow } from '@/data/adapter';

const today = new Date(2026, 10, 26); // 26 Nov 2026

describe('expiry', () => {
  it('counts days and classifies', () => {
    expect(daysUntil('2027-01-06', today)).toBe(41);
    expect(expiryState('', today)).toBe('none');
    expect(expiryState('2026-11-25', today)).toBe('expired');
    expect(expiryState('2026-11-26', today)).toBe('soon');
    expect(expiryState('2027-01-25', today)).toBe('soon');   // 60 days
    expect(expiryState('2027-01-26', today)).toBe('ok');     // 61 days
    expect(daysUntil('not-a-date', today)).toBeNull();
  });
});

describe('draft <-> row', () => {
  it('a new draft saves empty new fields as null and keeps defaults', () => {
    const row = toRow({ ...emptyDraft('EMP-0009'), name: '  Sara  ' }, 'c1');
    expect(row.name).toBe('Sara');
    expect(row.code).toBe('EMP-0009');
    expect(row.branch_id).toBeNull();
    expect(row.visa_expiry).toBeNull();
    expect(row.pay_method).toBeNull();
    expect(row.employment_type).toBe('full_time');
    expect(row.is_active).toBe(true);
    expect(row.include_in_payroll).toBe(true);
  });
  it('an existing employee round-trips unchanged', () => {
    const e = {
      id: 'e1', company_id: 'c1', code: 'E1', name: 'Emp 1', name_ar: null, designation: 'Salesman', department: 'Sales',
      phone: null, email: null, emirates_id: '784', passport_no: null, mol_id: null, bank_name: 'ENBD', iban: 'AE07', bank_routing_code: null,
      joining_date: '2024-01-01', basic_salary: 3000, housing_allowance: 500, transport_allowance: 300, other_allowance: 200,
      is_active: true, include_in_payroll: false, notes: null, is_purchaser: false, reports_to_id: 'top', user_id: null,
      created_at: '', updated_at: '', photo_path: null, branch_id: null, warehouse_id: null, employment_type: null,
      nationality: null, date_of_birth: null, emergency_contact_name: null, emergency_contact_phone: null,
      emirates_id_expiry: null, passport_expiry: null, visa_no: null, visa_expiry: null, labour_card_no: null,
      labour_card_expiry: null, pay_method: null,
    } as unknown as EmployeeRow;
    const row = toRow(toDraft(e, undefined), 'c1');
    expect(row.basic_salary).toBe(3000);
    expect(row.housing_allowance).toBe(500);
    expect(row.include_in_payroll).toBe(false);
    expect(row.employment_type).toBeNull();
    expect(row.designation).toBe('Salesman');
    expect(packageOf(toDraft(e, undefined))).toBe(4000);
  });
  it('negative or junk salary becomes 0', () => {
    expect(toRow({ ...emptyDraft(), name: 'x', basic_salary: '-5', housing_allowance: 'abc' }, 'c').basic_salary).toBe(0);
  });
  it('initials', () => {
    expect(initials('ahmed rafiq')).toBe('AR');
    expect(initials('  ')).toBe('?');
  });
});
