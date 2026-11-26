/**
 * Employee 360 (phase163) — the form's working copy of one employee.
 *
 * Strings while editing (inputs), converted once on save. Same record and
 * salary structure as before; phase163 adds placement, identity, documents
 * and pay method. Nothing here posts to the ledger.
 */
import type { EmployeeInsert, EmployeeRow, SalespersonRow } from '@/data/adapter';

export const EMPLOYMENT_TYPES = ['full_time', 'part_time', 'contract', 'intern'] as const;
export const PAY_METHODS = ['wps', 'bank', 'cash', 'cheque'] as const;

export interface Draft {
  code: string; name: string; name_ar: string; designation: string; department: string;
  phone: string; email: string; nationality: string; date_of_birth: string;
  emergency_contact_name: string; emergency_contact_phone: string;
  branch_id: string; warehouse_id: string; employment_type: string; joining_date: string;
  emirates_id: string; emirates_id_expiry: string; passport_no: string; passport_expiry: string;
  visa_no: string; visa_expiry: string; labour_card_no: string; labour_card_expiry: string;
  mol_id: string; bank_name: string; iban: string; bank_routing_code: string; pay_method: string;
  basic_salary: string; housing_allowance: string; transport_allowance: string; other_allowance: string;
  notes: string;
  is_active: boolean; include_in_payroll: boolean;
  /** phase129 work roles (saved through the staff functions, not the row). */
  is_sales: boolean; commission_pct: string; is_purchaser: boolean;
  /** phase144 — saved through the Team functions (admins only). */
  reports_to_id: string; user_id: string;
}

export const emptyDraft = (code = ''): Draft => ({
  code, name: '', name_ar: '', designation: '', department: '', phone: '', email: '',
  nationality: '', date_of_birth: '', emergency_contact_name: '', emergency_contact_phone: '',
  branch_id: '', warehouse_id: '', employment_type: 'full_time', joining_date: '',
  emirates_id: '', emirates_id_expiry: '', passport_no: '', passport_expiry: '',
  visa_no: '', visa_expiry: '', labour_card_no: '', labour_card_expiry: '',
  mol_id: '', bank_name: '', iban: '', bank_routing_code: '', pay_method: '',
  basic_salary: '0', housing_allowance: '0', transport_allowance: '0', other_allowance: '0',
  notes: '', is_active: true, include_in_payroll: true,
  is_sales: false, commission_pct: '0', is_purchaser: false, reports_to_id: '', user_id: '',
});

const s = (v: unknown) => (v == null ? '' : String(v));

export function toDraft(e: EmployeeRow, sp: SalespersonRow | undefined): Draft {
  return {
    code: s(e.code), name: e.name, name_ar: s(e.name_ar), designation: s(e.designation), department: s(e.department),
    phone: s(e.phone), email: s(e.email), nationality: s(e.nationality), date_of_birth: s(e.date_of_birth),
    emergency_contact_name: s(e.emergency_contact_name), emergency_contact_phone: s(e.emergency_contact_phone),
    branch_id: s(e.branch_id), warehouse_id: s(e.warehouse_id), employment_type: s(e.employment_type),
    joining_date: s(e.joining_date),
    emirates_id: s(e.emirates_id), emirates_id_expiry: s(e.emirates_id_expiry),
    passport_no: s(e.passport_no), passport_expiry: s(e.passport_expiry),
    visa_no: s(e.visa_no), visa_expiry: s(e.visa_expiry),
    labour_card_no: s(e.labour_card_no), labour_card_expiry: s(e.labour_card_expiry),
    mol_id: s(e.mol_id), bank_name: s(e.bank_name), iban: s(e.iban), bank_routing_code: s(e.bank_routing_code),
    pay_method: s(e.pay_method),
    basic_salary: String(e.basic_salary), housing_allowance: String(e.housing_allowance),
    transport_allowance: String(e.transport_allowance), other_allowance: String(e.other_allowance),
    notes: s(e.notes), is_active: e.is_active, include_in_payroll: e.include_in_payroll !== false,
    is_sales: !!sp?.is_active, commission_pct: String(sp?.commission_pct ?? 0), is_purchaser: !!e.is_purchaser,
    reports_to_id: s(e.reports_to_id), user_id: s(e.user_id),
  };
}

const txt = (v: string) => v.trim() || null;
const day = (v: string) => v || null;
export const money = (v: string) => Math.max(0, parseFloat(v) || 0);

/** The row as stored. Roles, manager and login are saved separately. */
export function toRow(d: Draft, company_id: string): EmployeeInsert {
  return {
    company_id,
    code: txt(d.code), name: d.name.trim(), name_ar: txt(d.name_ar),
    designation: txt(d.designation), department: txt(d.department),
    phone: txt(d.phone), email: txt(d.email), nationality: txt(d.nationality), date_of_birth: day(d.date_of_birth),
    emergency_contact_name: txt(d.emergency_contact_name), emergency_contact_phone: txt(d.emergency_contact_phone),
    branch_id: d.branch_id || null, warehouse_id: d.warehouse_id || null,
    employment_type: d.employment_type || null, joining_date: day(d.joining_date),
    emirates_id: txt(d.emirates_id), emirates_id_expiry: day(d.emirates_id_expiry),
    passport_no: txt(d.passport_no), passport_expiry: day(d.passport_expiry),
    visa_no: txt(d.visa_no), visa_expiry: day(d.visa_expiry),
    labour_card_no: txt(d.labour_card_no), labour_card_expiry: day(d.labour_card_expiry),
    mol_id: txt(d.mol_id), bank_name: txt(d.bank_name), iban: txt(d.iban), bank_routing_code: txt(d.bank_routing_code),
    pay_method: d.pay_method || null,
    basic_salary: money(d.basic_salary), housing_allowance: money(d.housing_allowance),
    transport_allowance: money(d.transport_allowance), other_allowance: money(d.other_allowance),
    notes: txt(d.notes), is_active: d.is_active, include_in_payroll: d.include_in_payroll,
  };
}

export const packageOf = (d: Pick<Draft, 'basic_salary' | 'housing_allowance' | 'transport_allowance' | 'other_allowance'>) =>
  money(d.basic_salary) + money(d.housing_allowance) + money(d.transport_allowance) + money(d.other_allowance);

/** Days until a date (negative = past), or null when no date. */
export function daysUntil(date: string, today = new Date()): number | null {
  if (!date) return null;
  const t = Date.UTC(today.getFullYear(), today.getMonth(), today.getDate());
  const [y, m, dd] = date.split('-').map(Number);
  if (!y || !m || !dd) return null;
  return Math.round((Date.UTC(y, m - 1, dd) - t) / 86_400_000);
}

/** Expiry state: 'none' | 'expired' | 'soon' (within 60 days) | 'ok'. */
export function expiryState(date: string, today = new Date()): 'none' | 'expired' | 'soon' | 'ok' {
  const n = daysUntil(date, today);
  if (n === null) return 'none';
  if (n < 0) return 'expired';
  return n <= 60 ? 'soon' : 'ok';
}

export const initials = (name: string) =>
  name.trim().split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]!.toUpperCase()).join('') || '?';
