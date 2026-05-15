import { useTranslation } from 'react-i18next';

/**
 * One row in an accounting preview. Mirrors a general_ledger row but
 * is purely informational — never persisted.
 */
export interface PreviewLine {
  account_code: string;
  account_name: string;
  description?: string;
  debit:  number;
  credit: number;
}

const fmt = (n: number) => n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/**
 * Read-only "what will be posted to the GL when you click Confirm" panel.
 * Displayed on draft documents to give the user confidence before
 * irreversibly hitting the ledger.
 *
 * Caller is responsible for computing the lines via a doc-type-specific
 * builder (buildCustomerPaymentPreview, buildVendorPaymentPreview, etc.).
 * Those builders mirror the canonical confirm_* RPC logic — but the
 * preview is BEST-EFFORT and explicit about it:
 *   - It uses standard COA codes (1100/1200/2100/2400/1400). If a user
 *     has renamed accounts the names may differ in production posting.
 *   - It does NOT recompute discounts or taxes from raw inputs; the
 *     builder consumes already-computed totals from the editor state.
 *   - For sales invoices and vendor bills, COGS lines depend on MAC
 *     (moving average cost) which lives in the DB — preview is not
 *     yet supported for those.
 *
 * The hard truth: the confirm_* RPC is the source of truth. The preview
 * is a sanity check, not a contract. Keep it simple, mark clearly that
 * it's an estimate.
 */
export function AccountingPreview({ lines, currency }: { lines: PreviewLine[]; currency: string }) {
  const { t: _t } = useTranslation();
  void _t;
  const totalDr = lines.reduce((s, l) => s + l.debit, 0);
  const totalCr = lines.reduce((s, l) => s + l.credit, 0);
  const balanced = Math.abs(totalDr - totalCr) < 0.005;

  if (lines.length === 0) return null;

  return (
    <div className="rounded-card border border-border-subtle bg-surface-card overflow-hidden">
      <div className="border-b border-border-subtle px-5 py-3 bg-surface-muted/40">
        <h2 className="text-sm font-semibold text-ink-primary">Accounting Preview</h2>
        <p className="mt-0.5 text-xs text-ink-tertiary">
          What this document will post to the General Ledger when confirmed. Account names use the standard chart;
          if you've renamed accounts the posting will use your custom names — the codes and amounts match.
        </p>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border-subtle bg-surface-muted text-xs text-ink-tertiary">
              <th className="px-4 py-2 text-start font-medium">Account</th>
              <th className="px-4 py-2 text-start font-medium">Description</th>
              <th className="px-4 py-2 text-end font-medium">Debit</th>
              <th className="px-4 py-2 text-end font-medium">Credit</th>
            </tr>
          </thead>
          <tbody>
            {lines.map((line, idx) => (
              <tr key={idx} className="border-b border-border-subtle last:border-0">
                <td className="px-4 py-2">
                  <span className="font-mono text-xs text-ink-secondary">{line.account_code}</span>
                  <span className="ms-2 text-ink-primary">{line.account_name}</span>
                </td>
                <td className="px-4 py-2 text-ink-secondary">{line.description ?? '—'}</td>
                <td className="px-4 py-2 text-end font-mono text-green-700">
                  {line.debit > 0 ? `${currency} ${fmt(line.debit)}` : '—'}
                </td>
                <td className="px-4 py-2 text-end font-mono text-red-700">
                  {line.credit > 0 ? `${currency} ${fmt(line.credit)}` : '—'}
                </td>
              </tr>
            ))}
            <tr className="bg-surface-muted/60 font-semibold">
              <td colSpan={2} className="px-4 py-2 text-end text-ink-secondary">Totals</td>
              <td className="px-4 py-2 text-end font-mono text-green-800">{currency} {fmt(totalDr)}</td>
              <td className="px-4 py-2 text-end font-mono text-red-800">{currency} {fmt(totalCr)}</td>
            </tr>
            {!balanced && (
              <tr className="bg-red-50">
                <td colSpan={4} className="px-4 py-2 text-center text-red-700 text-xs">
                  Preview is not balanced (DR {fmt(totalDr)} ≠ CR {fmt(totalCr)}). Save would fail the
                  GL balance check.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ── Per-document builders ──────────────────────────────────────────────────

export interface CustomerPaymentPreviewInput {
  amount:               number;
  classification:       'against_invoice' | 'advance' | 'on_account';
  bank_account_name?:   string;
  allocated_total:      number;        // sum of payment_allocations.amount_applied
  payment_number?:      string;        // for description
}

/**
 * Build the preview lines for a customer payment.
 * Matches confirm_payment (Phase 4.4):
 *   - against_invoice: DR bank(amount) / CR AR(allocated) / CR 2400 Customer Advances(unallocated)
 *   - advance/on_account: DR bank(amount) / CR 2400 Customer Advances(amount)
 */
export function buildCustomerPaymentPreview(input: CustomerPaymentPreviewInput): PreviewLine[] {
  const lines: PreviewLine[] = [];
  if (input.amount <= 0) return lines;

  const desc = input.payment_number ? `Payment ${input.payment_number}` : 'Payment';
  const bankName = input.bank_account_name ?? '(no bank account picked)';

  // DR bank
  lines.push({
    account_code: '1100',
    account_name: bankName,
    description:  desc,
    debit:        input.amount,
    credit:       0,
  });

  if (input.classification === 'against_invoice') {
    if (input.allocated_total > 0) {
      lines.push({
        account_code: '1200',
        account_name: 'Accounts Receivable',
        description:  desc,
        debit:        0,
        credit:       input.allocated_total,
      });
    }
    const unallocated = +(input.amount - input.allocated_total).toFixed(2);
    if (unallocated > 0.005) {
      lines.push({
        account_code: '2400',
        account_name: 'Customer Advances',
        description:  `${desc} (unallocated)`,
        debit:        0,
        credit:       unallocated,
      });
    }
  } else {
    lines.push({
      account_code: '2400',
      account_name: 'Customer Advances',
      description:  `Customer Advance ${input.payment_number ?? ''}`.trim(),
      debit:        0,
      credit:       input.amount,
    });
  }

  return lines;
}

// ── Sales Invoice preview ────────────────────────────────────────────────
export interface SalesInvoicePreviewLine {
  product_id: string | null;
  quantity:   number;
  unit_price: number;
  discount_percent: number;
  tax_amount: number;
  /** MAC (moving avg cost) at time of preview. 0 = no cost basis → COGS deferred. */
  mac: number;
}
export interface SalesInvoicePreviewInput {
  lines:            SalesInvoicePreviewLine[];
  invoice_number?:  string;
}

/**
 * Build the preview lines for a sales invoice.
 * Mirrors confirm_invoice (Phase 4.2):
 *   - DR 1200 Accounts Receivable (grand total)
 *   - CR 4100 Sales Revenue (sum of line subtotals = qty × unit_price × (1−disc))
 *   - CR 2200 VAT Output (sum of tax_amount) — only if > 0
 *   - For each line with MAC > 0:
 *       DR 5100 COGS (qty × MAC)
 *       CR 1300 Inventory (qty × MAC)
 *     Aggregated into one DR / one CR for readability.
 *   - For lines with MAC = 0: deferred to deferred_cogs_queue at confirm.
 *     Surfaced in the preview as a note in the description, not as
 *     fake DR/CR lines.
 */
export function buildSalesInvoicePreview(input: SalesInvoicePreviewInput): PreviewLine[] {
  const lines: PreviewLine[] = [];
  const desc = input.invoice_number ? `Invoice ${input.invoice_number}` : 'Sales Invoice';

  let revenue = 0;
  let vat     = 0;
  let cogs    = 0;
  let deferredLines = 0;

  for (const l of input.lines) {
    const gross = l.quantity * l.unit_price;
    const net   = gross * (1 - (l.discount_percent || 0) / 100);
    revenue += net;
    vat     += l.tax_amount;
    if (l.mac > 0) cogs += l.quantity * l.mac;
    else if (l.product_id && l.quantity > 0) deferredLines++;
  }

  const total = revenue + vat;
  if (total <= 0 && cogs <= 0) return lines;

  // DR AR
  if (total > 0) {
    lines.push({
      account_code: '1200',
      account_name: 'Accounts Receivable',
      description:  desc,
      debit:        total,
      credit:       0,
    });
  }
  // CR Revenue
  if (revenue > 0) {
    lines.push({
      account_code: '4100',
      account_name: 'Sales Revenue',
      description:  desc,
      debit:        0,
      credit:       revenue,
    });
  }
  // CR VAT (if any)
  if (vat > 0.005) {
    lines.push({
      account_code: '2200',
      account_name: 'Output VAT Payable',
      description:  desc,
      debit:        0,
      credit:       vat,
    });
  }
  // COGS pair (aggregate)
  if (cogs > 0) {
    lines.push({
      account_code: '5100',
      account_name: 'Cost of Goods Sold',
      description:  `${desc} — COGS`,
      debit:        cogs,
      credit:       0,
    });
    lines.push({
      account_code: '1300',
      account_name: 'Inventory',
      description:  `${desc} — COGS`,
      debit:        0,
      credit:       cogs,
    });
  }
  // Deferred-COGS hint as a synthetic informational row (zero amount)
  if (deferredLines > 0) {
    lines.push({
      account_code: '—',
      account_name: 'COGS deferred',
      description:  `${deferredLines} line${deferredLines === 1 ? '' : 's'} have no MAC yet — COGS will post once stock is purchased`,
      debit:        0,
      credit:       0,
    });
  }
  return lines;
}

export interface VendorPaymentPreviewInput {
  amount:               number;
  classification:       'against_invoice' | 'advance' | 'on_account';
  bank_account_name?:   string;
  allocated_total:      number;
  payment_number?:      string;
}

/**
 * Build the preview lines for a vendor payment.
 * Matches confirm_vendor_payment (Phase 5.3):
 *   - against_invoice: DR AP(allocated) / DR 1400 Vendor Advances(unallocated) / CR bank(amount)
 *   - advance/on_account: DR 1400 Vendor Advances(amount) / CR bank(amount)
 */
export function buildVendorPaymentPreview(input: VendorPaymentPreviewInput): PreviewLine[] {
  const lines: PreviewLine[] = [];
  if (input.amount <= 0) return lines;

  const desc = input.payment_number ? `Vendor Payment ${input.payment_number}` : 'Vendor Payment';
  const bankName = input.bank_account_name ?? '(no bank account picked)';

  if (input.classification === 'against_invoice') {
    if (input.allocated_total > 0) {
      lines.push({
        account_code: '2100',
        account_name: 'Accounts Payable',
        description:  desc,
        debit:        input.allocated_total,
        credit:       0,
      });
    }
    const unallocated = +(input.amount - input.allocated_total).toFixed(2);
    if (unallocated > 0.005) {
      lines.push({
        account_code: '1400',
        account_name: 'Vendor Advances',
        description:  `${desc} (unallocated)`,
        debit:        unallocated,
        credit:       0,
      });
    }
  } else {
    lines.push({
      account_code: '1400',
      account_name: 'Vendor Advances',
      description:  `Vendor Advance ${input.payment_number ?? ''}`.trim(),
      debit:        input.amount,
      credit:       0,
    });
  }

  // CR bank (always the full amount)
  lines.push({
    account_code: '1100',
    account_name: bankName,
    description:  desc,
    debit:        0,
    credit:       input.amount,
  });

  return lines;
}
