/**
 * WPS SIF generator — Payroll P2 (owner override 2026-06-13).
 *
 * Builds a UAE Wage Protection System Salary Information File from a
 * confirmed payroll run, per the MOHRE SIF layout:
 *
 *   EDR,<employee MOL ID>,<agent routing code>,<IBAN>,
 *       <pay start YYYY-MM-DD>,<pay end YYYY-MM-DD>,<days in period>,
 *       <fixed income>,<variable income>,<days on leave>
 *   SCR,<employer MOL est. ID>,<employer routing>,<file date YYYY-MM-DD>,
 *       <file time HHMM>,<salary month MMYYYY>,<EDR count>,<total salary>,
 *       AED,<reference>
 *
 * Mapping from StockBolt data:
 *   fixed income    = basic salary
 *   variable income = net pay − basic (allowances + OT + bonus − deductions
 *                     − loan recoveries), floored at 0
 *   leave days      = 0 (leave tracking arrives in Payroll P4)
 *
 * File name: <employerMolId><DDMMYYYY><HHMMSS>.SIF (MOHRE convention).
 * Each receiving bank/exchange validates on upload — fix any rejected
 * rows by completing the employee's MOL ID / IBAN / routing code.
 */
import type { EmployeeRow, PayrollRunRow, PayrollRunItemRow } from '@/data/adapter';

export interface SifEmployer {
  molEstablishmentId: string;
  routingCode: string;
}

export interface SifResult {
  fileName: string;
  content: string;
  edrCount: number;
  total: number;
  /** Employees skipped because MOL ID / IBAN / routing is missing. */
  skipped: Array<{ name: string; missing: string[] }>;
}

const two = (n: number) => String(n).padStart(2, '0');
const money = (n: number) => n.toFixed(2);

export function buildSif(
  run: PayrollRunRow,
  items: PayrollRunItemRow[],
  employees: EmployeeRow[],
  employer: SifEmployer,
): SifResult {
  const empMap = Object.fromEntries(employees.map(e => [e.id, e]));
  const y = run.period_year, m = run.period_month;
  const periodStart = `${y}-${two(m)}-01`;
  const daysInMonth = new Date(y, m, 0).getDate();
  const periodEnd = `${y}-${two(m)}-${two(daysInMonth)}`;

  const lines: string[] = [];
  const skipped: SifResult['skipped'] = [];
  let total = 0;

  for (const it of items) {
    const emp = empMap[it.employee_id];
    const missing: string[] = [];
    if (!emp?.mol_id?.trim())            missing.push('MOL ID');
    if (!emp?.iban?.trim())              missing.push('IBAN');
    if (!emp?.bank_routing_code?.trim()) missing.push('routing code');
    if (!emp || missing.length > 0) {
      skipped.push({ name: emp?.name ?? it.employee_id, missing });
      continue;
    }

    const gross = Number(it.basic_salary) + Number(it.housing_allowance)
      + Number(it.transport_allowance) + Number(it.other_allowance)
      + Number(it.overtime) + Number(it.bonus);
    const net = gross - Number(it.deductions) - Number(it.loan_repayment);
    if (net <= 0) { skipped.push({ name: emp.name, missing: ['net pay is zero'] }); continue; }

    const fixed = Math.min(Number(it.basic_salary), net);
    const variable = Math.max(0, net - fixed);
    total += net;

    lines.push([
      'EDR',
      emp.mol_id!.trim(),
      emp.bank_routing_code!.trim(),
      emp.iban!.replace(/\s+/g, ''),
      periodStart,
      periodEnd,
      String(daysInMonth),
      money(fixed),
      money(variable),
      '0',
    ].join(','));
  }

  const now = new Date();
  const fileDate = `${now.getFullYear()}-${two(now.getMonth() + 1)}-${two(now.getDate())}`;
  const fileTime = `${two(now.getHours())}${two(now.getMinutes())}`;

  lines.push([
    'SCR',
    employer.molEstablishmentId.trim(),
    employer.routingCode.trim(),
    fileDate,
    fileTime,
    `${two(m)}${y}`,
    String(lines.length),          // EDR count (SCR not yet appended)
    money(total),
    'AED',
    run.run_number,
  ].join(','));

  const stamp = `${two(now.getDate())}${two(now.getMonth() + 1)}${now.getFullYear()}${two(now.getHours())}${two(now.getMinutes())}${two(now.getSeconds())}`;
  return {
    fileName: `${employer.molEstablishmentId.trim()}${stamp}.SIF`,
    content: lines.join('\r\n') + '\r\n',
    edrCount: lines.length - 1,
    total,
    skipped,
  };
}

export function downloadSif(result: SifResult) {
  const blob = new Blob([result.content], { type: 'text/plain;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = result.fileName;
  a.click();
  URL.revokeObjectURL(a.href);
}
