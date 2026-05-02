import type { JELine } from '@/data/adapter';

export class JournalValidationError extends Error {
  constructor(message: string) { super(message); this.name = 'JournalValidationError'; }
}

// ── Rule 1: balance ────────────────────────────────────────────────────────────
export function validateLines(lines: JELine[]): void {
  if (!lines || lines.length < 2) {
    throw new JournalValidationError('A journal entry must have at least 2 lines.');
  }

  let totalDebit  = 0;
  let totalCredit = 0;

  for (const line of lines) {
    // Rule 4: no negatives
    if (line.debit < 0 || line.credit < 0) {
      throw new JournalValidationError(
        `Negative amounts are not allowed (account ${line.account_code}). Use a reversal instead.`,
      );
    }

    // Rule 2: never both debit AND credit on the same line
    if (line.debit > 0 && line.credit > 0) {
      throw new JournalValidationError(
        `Account ${line.account_code} has both a debit and a credit on the same line.`,
      );
    }

    if (!line.account_code?.trim()) {
      throw new JournalValidationError('Every line must specify an account_code.');
    }

    totalDebit  += line.debit  ?? 0;
    totalCredit += line.credit ?? 0;
  }

  // Rule 1: balance within 0.01
  if (Math.abs(totalDebit - totalCredit) > 0.01) {
    throw new JournalValidationError(
      `Journal entry does not balance: debits ${totalDebit.toFixed(2)}, credits ${totalCredit.toFixed(2)}.`,
    );
  }
}

// ── Rule 3 + Part I: source_type mapping assertion ────────────────────────────
// Returns the account code prefix for a code: '1110' → '11' and '1'
function prefixes(code: string): string[] {
  const result: string[] = [code];
  for (let len = code.length - 1; len >= 1; len--) result.push(code.slice(0, len));
  return result;
}

function matchesAny(code: string, patterns: string[]): boolean {
  const p = prefixes(code);
  return patterns.some((pat) => p.includes(pat));
}

interface MappingRule {
  required_debit_prefix?: string[];    // at least one debit line must match
  required_credit_prefix?: string[];   // at least one credit line must match
  forbidden_debit_prefix?: string[];   // no debit line may match
  forbidden_credit_prefix?: string[];  // no credit line may match
}

const MAPPING_RULES: Record<string, MappingRule> = {
  sales_invoice: {
    required_debit_prefix:  ['1200'],
    required_credit_prefix: ['4'],          // 4xxx Sales Revenue
    forbidden_debit_prefix: ['11', '2100'], // No Bank/Cash or AP on debit
  },
  pos_cash_sale: {
    required_debit_prefix:  ['11'],         // 11xx Cash/Bank
    required_credit_prefix: ['4'],
    forbidden_debit_prefix: ['1200', '2100', '1300'],
  },
  pos_card_sale: {
    required_debit_prefix:  ['11'],
    required_credit_prefix: ['4'],
  },
  customer_receipt: {
    required_debit_prefix:    ['11'],       // Cash/Bank received
    forbidden_credit_prefix:  ['4', '1300'],
  },
  vendor_payment: {
    required_credit_prefix:   ['11'],       // Cash/Bank paid out
    forbidden_debit_prefix:   ['4', '1300'],
  },
  vendor_bill: {
    required_credit_prefix:   ['2100'],     // AP Cr
    forbidden_credit_prefix:  ['4', '1200'],
  },
  goods_receipt: {
    required_debit_prefix:    ['1300'],     // Inventory Dr
    required_credit_prefix:   ['2150'],     // GRN Accrual Cr
  },
  inventory_cogs: {
    required_debit_prefix:    ['5100'],     // COGS Dr
    required_credit_prefix:   ['1300'],     // Inventory Cr
  },
  bank_transfer: {
    required_debit_prefix:    ['11'],
    required_credit_prefix:   ['11'],
  },
  expense: {
    required_debit_prefix:    ['6'],        // 6xxx Expense
    forbidden_debit_prefix:   ['1200', '1300'],
  },
  customer_advance: {
    required_debit_prefix:    ['11'],
    required_credit_prefix:   ['2400'],
  },
  vendor_advance: {
    required_debit_prefix:    ['1400'],
    required_credit_prefix:   ['11'],
  },
  // These source types have no restrictions:
  manual: {},
  opening_balance: {},
  reversal: {},
};

export function assertMapping(source_type: string, lines: JELine[]): void {
  const rule = MAPPING_RULES[source_type];
  if (!rule) {
    // Unknown source type — allow (future-proofing)
    return;
  }

  const debitCodes  = lines.filter((l) => l.debit  > 0).map((l) => l.account_code);
  const creditCodes = lines.filter((l) => l.credit > 0).map((l) => l.account_code);

  if (rule.required_debit_prefix && !debitCodes.some((c) => matchesAny(c, rule.required_debit_prefix!))) {
    throw new JournalValidationError(
      `source_type '${source_type}' requires a debit to an account starting with ${rule.required_debit_prefix.join(' or ')}.`,
    );
  }
  if (rule.required_credit_prefix && !creditCodes.some((c) => matchesAny(c, rule.required_credit_prefix!))) {
    throw new JournalValidationError(
      `source_type '${source_type}' requires a credit to an account starting with ${rule.required_credit_prefix.join(' or ')}.`,
    );
  }
  if (rule.forbidden_debit_prefix) {
    const bad = debitCodes.find((c) => matchesAny(c, rule.forbidden_debit_prefix!));
    if (bad) {
      throw new JournalValidationError(
        `source_type '${source_type}' forbids debiting account ${bad}.`,
      );
    }
  }
  if (rule.forbidden_credit_prefix) {
    const bad = creditCodes.find((c) => matchesAny(c, rule.forbidden_credit_prefix!));
    if (bad) {
      throw new JournalValidationError(
        `source_type '${source_type}' forbids crediting account ${bad}.`,
      );
    }
  }
}
