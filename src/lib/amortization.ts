/**
 * AC-6A — amortization schedule math (pure; no DB, no React).
 *
 * Prepaid expense, deferred revenue and accrued expense are one mechanic: a
 * total spread over N monthly periods, each posting a two-line journal entry
 * between a balance-sheet account and a P&L account. Only the DIRECTION differs
 * (see amortizationLegs).
 *
 * The AUTHORITATIVE installment is computed server-side by run_amortization()
 * so the GL never depends on the client. This module mirrors that math for the
 * on-screen preview and is locked by unit tests; keep it in lock-step with the
 * plpgsql in supabase/migrations/…phase61….sql.
 *
 * Numeric rule that matters: every installment is rounded to 2dp and the FINAL
 * period absorbs the remainder, so the installments always sum to the total
 * exactly — a schedule can never leave a stray fraction on the balance sheet.
 *
 * Deliberately simpler than depreciation: whole periods, straight-line, no
 * daily proration. Amortization schedules are agreed in whole months.
 */
export type AmortizationKind = 'prepaid_expense' | 'deferred_revenue' | 'accrued_expense';

export const AMORTIZATION_KINDS: readonly AmortizationKind[] =
  ['prepaid_expense', 'deferred_revenue', 'accrued_expense'] as const;

export function isAmortizationKind(v: unknown): v is AmortizationKind {
  return typeof v === 'string' && (AMORTIZATION_KINDS as readonly string[]).includes(v);
}

function round2(n: number): number { return Math.round((n + Number.EPSILON) * 100) / 100; }

/**
 * Split `total` into `periods` installments. Each is rounded to 2dp; the last
 * absorbs the rounding remainder so the sum is exactly `total`.
 */
export function installments(total: number, periods: number): number[] {
  const n = Math.max(1, Math.floor(periods));
  const t = round2(total);
  const base = round2(t / n);
  const out = new Array<number>(n);
  for (let i = 0; i < n - 1; i++) out[i] = base;
  out[n - 1] = round2(t - base * (n - 1));
  return out;
}

/** Last day of the month `offset` months after the month containing `iso`. */
function monthEndAfter(iso: string, offset: number): string {
  const [y, m] = iso.split('-').map(Number);
  const idx = (m - 1) + offset;
  const ny = y + Math.floor(idx / 12);
  const nm = ((idx % 12) + 12) % 12 + 1;
  const day = new Date(Date.UTC(ny, nm, 0)).getUTCDate();
  return `${ny}-${String(nm).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

export interface AmortizationSchedule {
  total_amount: number;
  periods: number;
  start_date: string;   // ISO; the first period ends at that month's end
}
export interface AmortizationRow {
  index: number;        // 1-based period number
  period_end: string;
  amount: number;
  cumulative: number;
  remaining: number;
}

/** The full projected schedule, first period ending in the start month. */
export function projectSchedule(s: AmortizationSchedule): AmortizationRow[] {
  const amounts = installments(s.total_amount, s.periods);
  const rows: AmortizationRow[] = [];
  let cumulative = 0;
  for (let i = 0; i < amounts.length; i++) {
    cumulative = round2(cumulative + amounts[i]);
    rows.push({
      index: i + 1,
      period_end: monthEndAfter(s.start_date, i),
      amount: amounts[i],
      cumulative,
      remaining: round2(round2(s.total_amount) - cumulative),
    });
  }
  return rows;
}

/**
 * The rows of a schedule that are DUE (not yet posted) up to `periodEnd`,
 * given how many installments have already been posted.
 */
export function duePeriods(s: AmortizationSchedule, postedCount: number, periodEnd: string): AmortizationRow[] {
  return projectSchedule(s).filter((r) => r.index > postedCount && r.period_end <= periodEnd);
}

/**
 * Which account is debited / credited for one installment.
 *  • prepaid_expense  — Dr P&L expense, Cr prepaid asset  (draws the asset down)
 *  • deferred_revenue — Dr deferred liability, Cr revenue  (draws the liability down)
 *  • accrued_expense  — Dr P&L expense, Cr accrued liability (builds the liability up)
 */
export function amortizationLegs(
  kind: AmortizationKind,
  bsAccountCode: string,
  plAccountCode: string,
): { debit_account_code: string; credit_account_code: string } {
  if (kind === 'deferred_revenue') {
    return { debit_account_code: bsAccountCode, credit_account_code: plAccountCode };
  }
  // prepaid_expense and accrued_expense both charge the P&L and credit the BS account
  return { debit_account_code: plAccountCode, credit_account_code: bsAccountCode };
}
