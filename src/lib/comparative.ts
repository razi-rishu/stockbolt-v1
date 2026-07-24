/**
 * AC-2 — Comparative Financial Statements: pure logic layer.
 *
 * A comparative statement is the SAME report run for two periods, shown side by
 * side with variance. This module holds all the net-new logic — and it is
 * deliberately PURE (no React, no data access): the previous-period resolver
 * (date math) and the merge/variance functions. The report engine itself is
 * reused as-is (reports.getProfitAndLoss / getBalanceSheet / accounting.
 * getTrialBalance) — no accounting logic is duplicated here; we only subtract
 * (variance) and divide (variance %).
 *
 * Types live here (co-located with the merges that produce them) rather than in
 * adapter.ts, since these are presentation shapes, not data-layer contracts.
 */
import type { PeriodPreset, PeriodRange } from '@/hooks/use-period-picker';
import type {
  ProfitAndLoss, ProfitAndLossLine,
  BalanceSheet, BalanceSheetLine,
  TrialBalance, TrialBalanceLine,
} from '@/data/adapter';

// ── Types ────────────────────────────────────────────────────────────────────
export type CompareBasis = 'previous_period' | 'previous_year';

export interface ComparativeRange { current: PeriodRange; previous: PeriodRange }
export interface ComparativeAsOf  { current: string;      previous: string }

/** A current/previous figure pair with its variance. */
export interface ComparativeValue {
  current: number;
  previous: number;
  /** current − previous */
  variance: number;
  /** (variance / |previous|) × 100, or null when previous is 0 (see formatVariancePct). */
  variance_pct: number | null;
}

/** A merged P&L / Balance Sheet line (one account, both periods). */
export interface ComparativeLine extends ComparativeValue {
  account_code: string;
  account_name: string;
  account_type: string;
  sub_type?: string | null;
}

/** A merged Trial Balance line — Dr/Cr per period + signed net difference. */
export interface ComparativeTBLine {
  account_code: string;
  account_name: string;
  account_type: string;
  current_debit: number;
  current_credit: number;
  previous_debit: number;
  previous_credit: number;
  /** (curDr − curCr) − (prevDr − prevCr) */
  difference: number;
}

export interface ComparativePL {
  current_period: PeriodRange;
  previous_period: PeriodRange;
  lines: ComparativeLine[];
  revenue: ComparativeValue;
  cogs: ComparativeValue;
  gross_profit: ComparativeValue;
  other_income: ComparativeValue;
  operating_expenses: ComparativeValue;
  net_profit: ComparativeValue;
}

export interface ComparativeBS {
  current_as_of: string;
  previous_as_of: string;
  lines: ComparativeLine[];
  total_assets: ComparativeValue;
  total_liabilities: ComparativeValue;
  total_equity: ComparativeValue;
  current_assets: ComparativeValue;
  fixed_assets: ComparativeValue;
  current_liabilities: ComparativeValue;
  long_term_liabilities: ComparativeValue;
  working_capital: ComparativeValue;
}

export interface ComparativeTB {
  current_as_of: string;
  previous_as_of: string;
  lines: ComparativeTBLine[];
  total_debit: ComparativeValue;
  total_credit: ComparativeValue;
}

// ── Pure date helpers (local calendar, mirrors use-period-picker's iso()) ─────
function isoOf(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}
function parseISO(s: string): Date {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, (m ?? 1) - 1, d ?? 1);
}
const MS_PER_DAY = 86_400_000;

/** Shift a date by N calendar months, clamping the day (Jan 31 −1mo → Dec 31; +1mo → Feb 28). */
export function shiftMonthsISO(s: string, months: number): string {
  const d = parseISO(s);
  const idx = d.getFullYear() * 12 + d.getMonth() + months;
  const y = Math.floor(idx / 12);
  const m = ((idx % 12) + 12) % 12;
  const lastDay = new Date(y, m + 1, 0).getDate();
  return isoOf(new Date(y, m, Math.min(d.getDate(), lastDay)));
}
export function shiftYearsISO(s: string, years: number): string {
  return shiftMonthsISO(s, years * 12);
}
function shiftRange(win: PeriodRange, months: number): PeriodRange {
  return { from: shiftMonthsISO(win.from, months), to: shiftMonthsISO(win.to, months) };
}
/** The equal-length window ending the day before `win.from`. */
function equalLengthPreceding(win: PeriodRange): PeriodRange {
  const from = parseISO(win.from);
  const to = parseISO(win.to);
  const spanDays = Math.round((to.getTime() - from.getTime()) / MS_PER_DAY); // inclusive length − 1
  const prevTo = new Date(from); prevTo.setDate(prevTo.getDate() - 1);
  const prevFrom = new Date(prevTo); prevFrom.setDate(prevFrom.getDate() - spanDays);
  return { from: isoOf(prevFrom), to: isoOf(prevTo) };
}
/** Most recent fiscal-year start (month/day of `fyStartISO`) on or before `dateISO`. */
export function fiscalYearStartOnOrBefore(dateISO: string, fyStartISO: string): string {
  const d = parseISO(dateISO);
  const fy = parseISO(fyStartISO);
  let cand = new Date(d.getFullYear(), fy.getMonth(), fy.getDate());
  if (cand.getTime() > d.getTime()) cand = new Date(d.getFullYear() - 1, fy.getMonth(), fy.getDate());
  return isoOf(cand);
}
/** The full fiscal-year window [start, start+1yr−1day] containing `dateISO`. */
export function fiscalYearWindow(dateISO: string, fyStartISO: string): PeriodRange {
  const from = fiscalYearStartOnOrBefore(dateISO, fyStartISO);
  const startD = parseISO(from);
  const endD = new Date(startD.getFullYear() + 1, startD.getMonth(), startD.getDate());
  endD.setDate(endD.getDate() - 1);
  return { from, to: isoOf(endD) };
}

const YEAR_PRESETS = new Set<PeriodPreset>(['this_year', 'last_year']);
const MONTHS_FOR_PRESET: Partial<Record<PeriodPreset, number>> = {
  this_month: 1, last_month: 1,
  this_quarter: 3, last_quarter: 3,
  this_year: 12, last_year: 12,
};

/**
 * Resolve the comparative window pair for a RANGE report (P&L).
 * Fiscal-year-aware for the Year presets only (re-anchors to the fiscal year via
 * `fiscalYearStart`); month/quarter stay calendar; custom shifts by equal length.
 */
export function resolveComparativeRange(
  current: PeriodRange,
  preset: PeriodPreset,
  basis: CompareBasis,
  fiscalYearStart?: string | null,
): ComparativeRange {
  // Fiscal re-anchor of the CURRENT window for Year presets.
  let curWin = current;
  if (YEAR_PRESETS.has(preset) && fiscalYearStart) {
    if (preset === 'this_year') {
      curWin = { from: fiscalYearStartOnOrBefore(current.to, fiscalYearStart), to: current.to };
    } else {
      curWin = fiscalYearWindow(current.to, fiscalYearStart); // full prior fiscal year
    }
  }

  let previous: PeriodRange;
  if (basis === 'previous_year') {
    previous = shiftRange(curWin, -12);
  } else {
    const months = MONTHS_FOR_PRESET[preset];
    previous = months != null ? shiftRange(curWin, -months) : equalLengthPreceding(curWin);
  }
  return { current: curWin, previous };
}

/**
 * Resolve the comparative as-of pair for an AS-OF report (Balance Sheet, Trial
 * Balance). Previous = current shifted back one period (or one year). A single
 * point-in-time shift is fiscal-agnostic, so `fiscalYearStart` is accepted for
 * signature symmetry but not needed here.
 */
export function resolveComparativeAsOf(
  currentAsOf: string,
  preset: PeriodPreset,
  basis: CompareBasis,
  _fiscalYearStart?: string | null,
): ComparativeAsOf {
  let previous: string;
  if (basis === 'previous_year') {
    previous = shiftYearsISO(currentAsOf, -1);
  } else {
    const months = MONTHS_FOR_PRESET[preset] ?? 12; // default: prior year (standard BS comparative)
    previous = shiftMonthsISO(currentAsOf, -months);
  }
  return { current: currentAsOf, previous };
}

// ── Variance ─────────────────────────────────────────────────────────────────
const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

export function computeVariance(current: number, previous: number): number {
  return round2(current - previous);
}
/** Numeric variance %, or null when previous is 0 (see formatVariancePct for display). */
export function variancePct(current: number, previous: number): number | null {
  if (previous === 0) return null;
  return round2(((current - previous) / Math.abs(previous)) * 100);
}
/**
 * Display string for the variance %, per the AC-2A rule:
 *   previous 0 & current 0  → "—"
 *   previous 0 & current ≠ 0 → "New"
 *   otherwise               → signed percentage (e.g. "+12.3%", "−4.0%")
 */
export function formatVariancePct(current: number, previous: number): string {
  if (previous === 0 && current === 0) return '—';
  if (previous === 0) return 'New';
  const pct = ((current - previous) / Math.abs(previous)) * 100;
  const sign = pct > 0 ? '+' : pct < 0 ? '−' : '';
  return `${sign}${Math.abs(pct).toFixed(1)}%`;
}

export function makeValue(current: number, previous: number): ComparativeValue {
  return {
    current: round2(current),
    previous: round2(previous),
    variance: computeVariance(current, previous),
    variance_pct: variancePct(current, previous),
  };
}

// ── Line merge (P&L / Balance Sheet share this shape) ────────────────────────
interface NamedLine { account_code: string; account_name: string; account_type: string; sub_type?: string | null }

function mergeValueLines<L extends NamedLine>(
  cur: L[],
  prev: L[],
  valueOf: (l: L) => number,
): ComparativeLine[] {
  const prevByCode = new Map(prev.map((l) => [l.account_code, l]));
  const out: ComparativeLine[] = [];
  const seen = new Set<string>();

  for (const l of cur) {
    seen.add(l.account_code);
    const p = prevByCode.get(l.account_code);
    out.push({
      account_code: l.account_code,
      account_name: l.account_name,
      account_type: l.account_type,
      sub_type: l.sub_type ?? null,
      ...makeValue(valueOf(l), p ? valueOf(p) : 0),
    });
  }
  // Accounts that had activity last period but none this period still matter.
  for (const l of prev) {
    if (seen.has(l.account_code)) continue;
    out.push({
      account_code: l.account_code,
      account_name: l.account_name,
      account_type: l.account_type,
      sub_type: l.sub_type ?? null,
      ...makeValue(0, valueOf(l)),
    });
  }
  return out;
}

// ── Merge functions ──────────────────────────────────────────────────────────
export function mergeComparativeProfitAndLoss(cur: ProfitAndLoss, prev: ProfitAndLoss): ComparativePL {
  return {
    current_period: { from: cur.period_start, to: cur.period_end },
    previous_period: { from: prev.period_start, to: prev.period_end },
    lines: mergeValueLines<ProfitAndLossLine>(cur.lines, prev.lines, (l) => l.amount),
    revenue: makeValue(cur.revenue, prev.revenue),
    cogs: makeValue(cur.cogs, prev.cogs),
    gross_profit: makeValue(cur.gross_profit, prev.gross_profit),
    other_income: makeValue(cur.other_income, prev.other_income),
    operating_expenses: makeValue(cur.operating_expenses, prev.operating_expenses),
    net_profit: makeValue(cur.net_profit, prev.net_profit),
  };
}

export function mergeComparativeBalanceSheet(cur: BalanceSheet, prev: BalanceSheet): ComparativeBS {
  return {
    current_as_of: cur.as_of_date,
    previous_as_of: prev.as_of_date,
    lines: mergeValueLines<BalanceSheetLine>(cur.lines, prev.lines, (l) => l.balance),
    total_assets: makeValue(cur.total_assets, prev.total_assets),
    total_liabilities: makeValue(cur.total_liabilities, prev.total_liabilities),
    total_equity: makeValue(cur.total_equity, prev.total_equity),
    current_assets: makeValue(cur.current_assets, prev.current_assets),
    fixed_assets: makeValue(cur.fixed_assets, prev.fixed_assets),
    current_liabilities: makeValue(cur.current_liabilities, prev.current_liabilities),
    long_term_liabilities: makeValue(cur.long_term_liabilities, prev.long_term_liabilities),
    working_capital: makeValue(cur.working_capital, prev.working_capital),
  };
}

export function mergeComparativeTrialBalance(cur: TrialBalance, prev: TrialBalance): ComparativeTB {
  const prevByCode = new Map(prev.lines.map((l) => [l.account_code, l]));
  const lines: ComparativeTBLine[] = [];
  const seen = new Set<string>();

  const push = (c: TrialBalanceLine | null, p: TrialBalanceLine | null) => {
    const base = (c ?? p)!;
    const cd = c?.debit ?? 0, cc = c?.credit ?? 0, pd = p?.debit ?? 0, pc = p?.credit ?? 0;
    lines.push({
      account_code: base.account_code,
      account_name: base.account_name,
      account_type: base.account_type,
      current_debit: round2(cd),
      current_credit: round2(cc),
      previous_debit: round2(pd),
      previous_credit: round2(pc),
      difference: round2((cd - cc) - (pd - pc)),
    });
  };

  for (const c of cur.lines) { seen.add(c.account_code); push(c, prevByCode.get(c.account_code) ?? null); }
  for (const p of prev.lines) { if (!seen.has(p.account_code)) push(null, p); }

  return {
    current_as_of: cur.as_of_date,
    previous_as_of: prev.as_of_date,
    lines,
    total_debit: makeValue(cur.total_debit, prev.total_debit),
    total_credit: makeValue(cur.total_credit, prev.total_credit),
  };
}
