/**
 * Opening Balances bulk-CSV adapter — Phase 14.11d.
 *
 * Companion to the per-row /settings/opening-balances wizard (14.09).
 * The per-row wizard is great for 5-10 manual entries; this adapter is
 * for "I have a CSV from my old system with 200 unpaid invoices".
 *
 * Scope: the four SUBSIDIARY opening types only:
 *   - ar_owed         Customer owes us X (unpaid invoice carried over)
 *   - ap_owed         We owe supplier X (unpaid bill carried over)
 *   - customer_credit Customer overpaid us
 *   - vendor_credit   We overpaid the supplier
 *
 * Direct GL opens (14.09b) + bank opens (14.09c) are kept exclusive to
 * the per-row wizard because they're typically one-shot entries (cash
 * on hand, accumulated depreciation, retained earnings) — not a list.
 *
 * Each row goes through the existing post_opening_balance RPC, so the
 * JEs match the per-row path exactly. Apply runs sequentially per row
 * so a single failure (bad contact, bad date) doesn't lose earlier
 * successes — same pattern as Phase 14.09's batch loop.
 */
import type { ModuleAdapter, ApplyResult, ValidationResult } from './types';
import type {
  OpeningBalanceInput, OpeningBalanceType, ContactRow,
} from '@/data/adapter';
import { getAdapter } from '@/data/index';

interface OBLookups {
  contactByCode: Map<string, ContactRow>;
  contactByName: Map<string, ContactRow>;
}

const HEADERS = [
  'type',           // ar_owed | ap_owed | customer_credit | vendor_credit
  'contact',        // resolved by code OR name
  'doc_number',     // original document # (becomes invoice/bill/payment number)
  'date',           // YYYY-MM-DD original date — drives aging
  'due_date',       // YYYY-MM-DD or empty (only meaningful for ar/ap)
  'amount',
  'currency',
  'notes',
] as const;

const TYPES: OpeningBalanceType[] = ['ar_owed','ap_owed','customer_credit','vendor_credit'];

function parseNumber(v: string | undefined): { ok: true; value: number } | { ok: false } {
  if (v == null || v.trim() === '') return { ok: false };
  const n = parseFloat(v.replace(/[, ]/g, ''));
  return isFinite(n) ? { ok: true, value: n } : { ok: false };
}

/** ISO sanity check. Accepts YYYY-MM-DD; lets browser/RPC catch other
 *  formats with a clearer error than client-side regex theater. */
function looksLikeDate(s: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(s);
}

// Synthetic OBRow type — we don't list "existing opening balances" as
// a master list (there isn't one — they're invoices/bills/payments).
// fetchAll returns empty so export shows just the template, and
// duplicate detection is effectively disabled (each row is a fresh post).
type OBRow = { id: string };

export const openingBalancesAdapter: ModuleAdapter<
  OBRow,
  OpeningBalanceInput
> = {
  key: 'openingBalances',
  label: 'Opening balances',
  description: 'Bulk-migrate unpaid AR / AP / credits-on-file from a CSV. Each row posts its own JE keyed to the original date so aging works.',
  icon: '⤵️',
  headers: [...HEADERS],

  template: () => [
    {
      type: 'ar_owed',
      contact: 'Khaleej Auto Parts LLC',
      doc_number: 'INV-OLD-441',
      date: '2025-12-15',
      due_date: '2026-01-14',
      amount: '1250.00',
      currency: 'AED',
      notes: 'migrated from Tally',
    },
    {
      type: 'ap_owed',
      contact: 'Castrol Distributor',
      doc_number: 'BILL-OLD-87',
      date: '2025-11-30',
      due_date: '2026-01-14',
      amount: '3400.00',
      currency: 'AED',
      notes: '',
    },
    {
      type: 'customer_credit',
      contact: 'CUST-0002',
      doc_number: 'OB-CR-001',
      date: '2025-12-01',
      due_date: '',
      amount: '125.00',
      currency: 'AED',
      notes: 'overpayment carried',
    },
  ],

  // No "list" — opening balances aren't a master list (they live in
  // invoices/vendor_bills/payments). Export returns empty so the
  // wizard's "Export current" action becomes a no-op for this module.
  fetchAll: async () => [],
  serialize: () => ({}),

  validate: (raw, ctx): ValidationResult<OpeningBalanceInput> => {
    const errors: string[] = [];
    const lk = ctx.lookups as unknown as OBLookups;

    const type = (raw.type ?? '').trim().toLowerCase();
    if (!TYPES.includes(type as OpeningBalanceType)) {
      errors.push(`type "${raw.type}" must be one of: ${TYPES.join(', ')}`);
    }

    const contactRef = (raw.contact ?? '').trim();
    if (!contactRef) errors.push('contact is required');
    let contact_id = '';
    if (contactRef) {
      // Try by code first (operator-controlled), then by name.
      const byCode = lk.contactByCode.get(contactRef.toLowerCase());
      const byName = lk.contactByName.get(contactRef.toLowerCase());
      const found  = byCode ?? byName;
      if (!found) {
        errors.push(`contact "${contactRef}" not found — add the customer/supplier first under /contacts`);
      } else {
        // Sanity check: type vs contact side. Customer-only opens must
        // point at a customer (or "both"); supplier-only at a supplier.
        if ((type === 'ar_owed' || type === 'customer_credit')
            && found.type !== 'customer' && found.type !== 'both') {
          errors.push(`contact "${contactRef}" is a ${found.type} but type "${type}" expects a customer`);
        }
        if ((type === 'ap_owed' || type === 'vendor_credit')
            && found.type !== 'supplier' && found.type !== 'both') {
          errors.push(`contact "${contactRef}" is a ${found.type} but type "${type}" expects a supplier`);
        }
        contact_id = found.id;
      }
    }

    const docNumber = (raw.doc_number ?? '').trim();
    if (!docNumber) errors.push('doc_number is required');

    const date = (raw.date ?? '').trim();
    if (!date) errors.push('date is required');
    else if (!looksLikeDate(date)) errors.push(`date "${date}" must be YYYY-MM-DD`);
    else if (date > new Date().toISOString().slice(0, 10)) {
      errors.push('date cannot be in the future');
    }

    const due = (raw.due_date ?? '').trim();
    if (due) {
      if (!looksLikeDate(due)) errors.push(`due_date "${due}" must be YYYY-MM-DD`);
      else if (due < date) errors.push('due_date is before the document date');
    }

    const amtR = parseNumber(raw.amount);
    if (!amtR.ok) errors.push(`amount "${raw.amount}" is not a positive number`);
    else if (amtR.value <= 0) errors.push('amount must be greater than zero');

    if (errors.length) return { ok: false, errors };

    return {
      ok: true,
      row: {
        type:       type as OpeningBalanceType,
        contact_id,
        doc_number: docNumber,
        date,
        due_date:   due || null,
        amount:     amtR.ok ? amtR.value : 0,
        currency:   raw.currency?.trim() || 'AED',
        notes:      raw.notes?.trim() || null,
      },
    };
  },

  apply: async (rows, _ctx): Promise<ApplyResult> => {
    const out: ApplyResult = { inserted: 0, updated: 0, skipped: 0, errors: [] };
    const api = getAdapter().openingBalances;
    for (let i = 0; i < rows.length; i++) {
      try {
        await api.post(rows[i]);
        out.inserted++;
      } catch (e) {
        out.errors.push({
          rowIndex: i,
          message: e instanceof Error ? e.message : 'Unknown error',
        });
      }
    }
    return out;
  },
};

export async function buildOBLookups(company_id: string): Promise<OBLookups> {
  const contacts = await getAdapter().contacts.list(company_id, 'both');
  const contactByCode = new Map<string, ContactRow>();
  const contactByName = new Map<string, ContactRow>();
  for (const c of contacts) {
    if (c.code) contactByCode.set(c.code.toLowerCase(), c);
    contactByName.set(c.name.toLowerCase(), c);
  }
  return { contactByCode, contactByName };
}
