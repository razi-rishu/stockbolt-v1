// phase144 — Team helpers: the org-chart order, search by code or name, and the
// code preview that must match the server's _next_employee_code.
import { describe, it, expect } from 'vitest';
import type { TeamMember } from '../../src/data/adapter';
import {
  buildTree, chainOf, descendantsOf, matchesPerson, personLabel, previewNextCode, titleKeyOf, CODE_PREFIX_RE,
} from '../../src/modules/settings/team/team-lists';

const m = (id: string, code: string, name: string, reports_to_id: string | null, extra: Partial<TeamMember> = {}): TeamMember => ({
  employee_id: id, code, name, name_ar: null, designation: null, department: null, reports_to_id,
  is_active: true, has_sales: false, is_purchaser: false, user_id: null, user_name: null, user_email: null, ...extra,
});

// 001 Owner → 002 GM → 003 Sales Manager → 010 Salesman ; 001 → 004 Finance
const team = [
  m('e10', 'EMP-0010', 'Salesman Ali', 'e3'),
  m('e3', 'EMP-0003', 'Rashid', 'e2', { designation: 'Sales Manager' }),
  m('e1', 'EMP-0001', 'Owner', null),
  m('e4', 'EMP-0004', 'Anas', 'e1'),
  m('e2', 'EMP-0002', 'Nisamu', 'e1', { name_ar: 'نسامو' }),
];

describe('team tree', () => {
  it('lists the top first, then each manager followed by their team', () => {
    const order = buildTree(team).map((n) => `${n.depth}:${n.member.code}`);
    expect(order).toEqual(['0:EMP-0001', '1:EMP-0002', '2:EMP-0003', '3:EMP-0010', '1:EMP-0004']);
    expect(buildTree(team).find((n) => n.member.code === 'EMP-0001')!.reports).toBe(2);
  });

  it('puts someone whose manager is hidden under the top', () => {
    const order = buildTree(team.filter((x) => x.employee_id !== 'e3')).map((n) => `${n.depth}:${n.member.code}`);
    expect(order).toContain('1:EMP-0010');
  });

  it('knows who is below a person and the chain above them', () => {
    expect([...descendantsOf(team, 'e2')].sort()).toEqual(['e10', 'e3']);
    expect(chainOf(team, 'e10').map((x) => x.code)).toEqual(['EMP-0003', 'EMP-0002', 'EMP-0001']);
    expect(chainOf(team, 'e1')).toEqual([]);
  });
});

describe('finding a person', () => {
  it('matches "002", "2", the full code, and the English or Arabic name', () => {
    const nisamu = team.find((x) => x.code === 'EMP-0002')!;
    for (const q of ['002', 'EMP-0002', 'emp-0002', 'Nisamu', 'nisa', 'نسامو']) expect(matchesPerson(nisamu, q), q).toBe(true);
    expect(matchesPerson(nisamu, 'Rashid')).toBe(false);
    expect(personLabel(nisamu)).toBe('EMP-0002 · Nisamu');
  });

  it('recognises list titles whatever their case, and leaves free text alone', () => {
    expect(titleKeyOf('sales manager')).toBe('sales_manager');
    expect(titleKeyOf('Sales clerk')).toBeNull();
  });
});

describe('code preview (mirrors the server)', () => {
  const codes = ['EMP-0001', 'EMP-0002', 'EMP-0010', 'A12', null];
  it('default format continues after the highest code with that prefix', () => {
    expect(previewNextCode(codes, 'EMP-', 4, 1)).toBe('EMP-0011');
  });
  it('a new prefix starts again, from the start number', () => {
    expect(previewNextCode(codes, 'PP-', 3, 1)).toBe('PP-001');
    expect(previewNextCode(codes, 'PP-', 3, 50)).toBe('PP-050');
  });
  it('no prefix: only plain-number codes count; long numbers are never cut', () => {
    expect(previewNextCode(['001', '002', 'EMP-0009'], '', 3, 1)).toBe('003');
    expect(previewNextCode(['99999'], '', 3, 1)).toBe('100000');
  });
  it('prefix rule matches the database CHECK', () => {
    for (const ok of ['', 'EMP-', 'PP/', 'S_1.', 'ABCDEFGHIJ']) expect(CODE_PREFIX_RE.test(ok), ok).toBe(true);
    for (const bad of ['BAD PREFIX', 'TOO-LONG-PREFIX', 'é-']) expect(CODE_PREFIX_RE.test(bad), bad).toBe(false);
  });
});
