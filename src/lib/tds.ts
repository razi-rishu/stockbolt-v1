/**
 * AC-7A — India TDS (tax deducted at source): pure logic + types.
 *
 * No React, no DB. Mirrors the rate resolution used by record_tds_deduction so
 * the UI can preview exactly what will post; the SQL remains authoritative.
 *
 * RATES ARE DATA, NOT LAW. Indian withholding rates change with each Finance
 * Act, so the section master is seeded with sensible defaults and is fully
 * editable per company (with effective_from dates). Nothing here hard-codes a
 * rate — the caller passes the section row it read from the database. Verify
 * seeded defaults against the current Finance Act before relying on them.
 */

/** Deductee class — 194C (and some others) charge individuals a lower rate. */
export type DeducteeType = 'individual_huf' | 'other';

/** Why the applied rate was chosen — surfaced in the UI and stored on the row. */
export type TdsRateReason = 'certificate' | 'no_pan_206aa' | 'section';

/** A row from the tds_sections master (only the fields the maths needs). */
export interface TdsSection {
  code: string;                       // '194C', '194J', …
  rate_individual: number;            // % for individual / HUF deductees
  rate_other: number;                 // % for companies, firms, etc.
  single_threshold: number;           // per-transaction exemption (0 = none)
  annual_threshold: number;           // aggregate-per-year exemption (0 = none)
}

export interface RateInput {
  section: TdsSection;
  deductee_type: DeducteeType;
  has_pan: boolean;
  /** Lower/nil deduction certificate rate u/s 197, if the vendor holds one. */
  lower_deduction_rate?: number | null;
}

export interface ResolvedRate { rate: number; reason: TdsRateReason }

/** §206AA penal rate when the deductee has furnished no PAN. */
export const NO_PAN_RATE = 20;

function round2(n: number): number { return Math.round((n + Number.EPSILON) * 100) / 100; }

/**
 * The rate that actually applies, in precedence order:
 *   1. A §197 lower-deduction certificate, if one is on file.
 *   2. §206AA — no PAN means the HIGHER of the section rate and 20%.
 *   3. The section rate for the deductee's class.
 *
 * (A §197 certificate is issued against a PAN, so it takes precedence over the
 * no-PAN penalty rather than being overridden by it.)
 */
export function resolveTdsRate(input: RateInput): ResolvedRate {
  const sectionRate = input.deductee_type === 'individual_huf'
    ? input.section.rate_individual
    : input.section.rate_other;

  if (input.lower_deduction_rate !== null && input.lower_deduction_rate !== undefined) {
    return { rate: input.lower_deduction_rate, reason: 'certificate' };
  }
  if (!input.has_pan) {
    return { rate: Math.max(sectionRate, NO_PAN_RATE), reason: 'no_pan_206aa' };
  }
  return { rate: sectionRate, reason: 'section' };
}

/** TDS on a base amount at a rate, to 2dp. */
export function tdsAmount(base: number, ratePercent: number): number {
  return round2((round2(base) * ratePercent) / 100);
}

export interface ThresholdInput {
  base: number;                 // this transaction's base
  ytd_base: number;             // already-deducted-against base this financial year
  single_threshold: number;
  annual_threshold: number;
}
export interface ThresholdResult { exempt: boolean; reason: string | null }

/**
 * Whether this transaction falls under the exemption thresholds.
 * Liability arises when EITHER the single-transaction threshold is crossed OR
 * the annual aggregate (including this transaction) crosses its threshold — so
 * it is exempt only when it clears neither. A threshold of 0 means "no
 * threshold", i.e. always deduct.
 */
export function checkThreshold(input: ThresholdInput): ThresholdResult {
  const singleCrossed = input.single_threshold > 0 && input.base >= input.single_threshold;
  const annualCrossed = input.annual_threshold > 0
    && round2(input.ytd_base + input.base) >= input.annual_threshold;

  if (input.single_threshold === 0 && input.annual_threshold === 0) {
    return { exempt: false, reason: null };   // no threshold on this section
  }
  if (singleCrossed || annualCrossed) return { exempt: false, reason: null };

  return {
    exempt: true,
    reason: `Below the ${input.single_threshold > 0 ? `single-payment (${input.single_threshold})` : ''}`
      + `${input.single_threshold > 0 && input.annual_threshold > 0 ? ' and ' : ''}`
      + `${input.annual_threshold > 0 ? `annual (${input.annual_threshold})` : ''} threshold`,
  };
}

/** Everything the UI needs to preview a deduction before it posts. */
export interface DeductionPreview {
  applicable: boolean;
  rate: number;
  reason: TdsRateReason;
  amount: number;
  exempt_reason: string | null;
  net_payable: number;          // what the vendor actually receives
}

export function previewDeduction(
  base: number,
  rate: RateInput,
  threshold: Omit<ThresholdInput, 'single_threshold' | 'annual_threshold'>,
): DeductionPreview {
  const resolved = resolveTdsRate(rate);
  const th = checkThreshold({
    ...threshold,
    single_threshold: rate.section.single_threshold,
    annual_threshold: rate.section.annual_threshold,
  });
  const amount = th.exempt ? 0 : tdsAmount(base, resolved.rate);
  return {
    applicable: !th.exempt,
    rate: resolved.rate,
    reason: resolved.reason,
    amount,
    exempt_reason: th.reason,
    net_payable: round2(round2(base) - amount),
  };
}

/**
 * The Indian financial year (1 Apr – 31 Mar) containing `iso`, as its start
 * year — FY2025-26 → 2025. Used to scope the annual threshold and to group
 * deductions for the quarterly return.
 */
export function indianFinancialYear(iso: string): number {
  const [y, m] = iso.split('-').map(Number);
  return m >= 4 ? y : y - 1;
}

/** The return quarter (Q1 = Apr-Jun … Q4 = Jan-Mar) for Form 26Q grouping. */
export function tdsQuarter(iso: string): 'Q1' | 'Q2' | 'Q3' | 'Q4' {
  const m = Number(iso.split('-')[1]);
  if (m >= 4 && m <= 6) return 'Q1';
  if (m >= 7 && m <= 9) return 'Q2';
  if (m >= 10 && m <= 12) return 'Q3';
  return 'Q4';
}
