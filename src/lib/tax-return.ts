/**
 * AC-3 — VAT/GST Return: pure logic + types (no React, no data access).
 *
 * Holds the jurisdiction/account mapping, filing-period math, net computation
 * and the reconciliation helper. The return ENGINE (getTaxReturn) and the filing
 * RPCs reuse these; they add NO new accounting logic — tax amounts are already
 * posted to the GL and stored on document headers. This module only selects
 * which posted accounts to aggregate, resolves calendar periods, and
 * subtracts/compares.
 */

// ── Types ────────────────────────────────────────────────────────────────────
export type TaxJurisdiction = 'AE_VAT' | 'IN_GST';
export type FilingFrequency = 'monthly' | 'quarterly';
export type FilingStatus = 'draft' | 'filed' | 'reopened';

export interface FilingPeriod {
  period_type: FilingFrequency;
  period_start: string; // ISO yyyy-mm-dd
  period_end: string;
}

/** One reconciliation line: GL tax-account movement vs document-derived tax. */
export interface ReconcileResult {
  gl: number;
  documents: number;
  difference: number; // gl − documents
  matched: boolean;
}

export interface TaxReconciliation {
  output: ReconcileResult;
  input: ReconcileResult;
  matched: boolean;
}

export interface TaxReturnBox {
  code: string;
  label: string;
  taxable_amount: number;
  tax_amount: number;
}

/** The computed return for a period (read-only; posted GL only). */
export interface TaxReturn {
  jurisdiction: TaxJurisdiction;
  period_start: string;
  period_end: string;
  output_tax: number;
  input_tax: number;
  /** output_tax − input_tax (positive = payable, negative = refundable). */
  net_payable: number;
  output_boxes: TaxReturnBox[];
  input_boxes: TaxReturnBox[];
  reconciliation: TaxReconciliation;
}

/** A row of the tax_filings register (phase57 migration). */
export interface TaxFiling {
  id: string;
  company_id: string;
  jurisdiction: TaxJurisdiction;
  period_type: FilingFrequency;
  period_start: string;
  period_end: string;
  status: FilingStatus;
  output_tax: number;
  input_tax: number;
  net_payable: number;
  boxes: unknown;           // jsonb snapshot
  reconciliation: unknown;  // jsonb snapshot
  reference_number: string | null;
  notes: string | null;
  prior_lock_date: string | null;
  created_at: string | null;
  created_by: string | null;
  filed_at: string | null;
  filed_by: string | null;
  reopened_at: string | null;
  reopened_by: string | null;
  updated_at: string | null;
}

export interface TaxFileResult {
  filing_id: string;
  jurisdiction: TaxJurisdiction;
  status: string;
  period_start: string;
  period_end: string;
  net_payable: number;
  period_lock_date: string | null;
}

export interface TaxReopenResult {
  filing_id: string;
  status: string;
  period_lock_date: string | null;
}

// ── Jurisdiction ↔ tax accounts ──────────────────────────────────────────────
/**
 * India → IN_GST. Everything else (UAE + the other GCC states, which all levy
 * 5% VAT into the same 1500/2200 accounts) → AE_VAT. Matches seedTaxRates.
 */
export function jurisdictionForCountry(country_code: string | null | undefined): TaxJurisdiction {
  return (country_code ?? '').toUpperCase() === 'IN' ? 'IN_GST' : 'AE_VAT';
}

export function jurisdictionLabel(j: TaxJurisdiction): string {
  return j === 'IN_GST' ? 'India GST' : 'UAE VAT';
}

export interface TaxAccounts { output: string[]; input: string[] }
/**
 * The posted GL accounts each jurisdiction's tax lands in (from seedCOA /
 * seedTaxRates). UAE VAT: 2200 output / 1500 input. India GST: output
 * CGST+SGST+IGST (2210/2220/2230), input/ITC CGST+SGST+IGST (1510/1520/1530).
 */
export function taxAccountsFor(j: TaxJurisdiction): TaxAccounts {
  return j === 'IN_GST'
    ? { output: ['2210', '2220', '2230'], input: ['1510', '1520', '1530'] }
    : { output: ['2200'], input: ['1500'] };
}

/** Convenience: resolve country_code straight to its tax accounts. */
export function taxAccountsForCountry(country_code: string | null | undefined): TaxAccounts {
  return taxAccountsFor(jurisdictionForCountry(country_code));
}

// ── Filing period math (calendar; GCC VAT quarters are calendar by law) ──────
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

/** The calendar month/quarter that contains `anchorISO`. */
export function resolveFilingPeriod(frequency: FilingFrequency, anchorISO: string): FilingPeriod {
  const d = parseISO(anchorISO);
  const y = d.getFullYear();
  const m = d.getMonth();
  if (frequency === 'monthly') {
    return {
      period_type: 'monthly',
      period_start: isoOf(new Date(y, m, 1)),
      period_end: isoOf(new Date(y, m + 1, 0)),
    };
  }
  const qStart = Math.floor(m / 3) * 3;
  return {
    period_type: 'quarterly',
    period_start: isoOf(new Date(y, qStart, 1)),
    period_end: isoOf(new Date(y, qStart + 3, 0)),
  };
}

// ── Net + reconciliation ─────────────────────────────────────────────────────
export const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

/** output − input. Positive = payable to the authority; negative = refundable. */
export function netPayable(output: number, input: number): number {
  return round2(output - input);
}

/**
 * Compare a GL tax-account movement against the same tax derived from posted
 * source documents. Equal by construction unless a manual JE hit the tax
 * account, or a document's posted tax ≠ its header — exactly what to surface.
 */
export function reconcile(gl: number, documents: number, tol = 0.01): ReconcileResult {
  const difference = round2(gl - documents);
  return { gl: round2(gl), documents: round2(documents), difference, matched: Math.abs(difference) <= tol };
}

export function reconciliation(
  glOutput: number, docOutput: number,
  glInput: number, docInput: number,
  tol = 0.01,
): TaxReconciliation {
  const output = reconcile(glOutput, docOutput, tol);
  const input = reconcile(glInput, docInput, tol);
  return { output, input, matched: output.matched && input.matched };
}
