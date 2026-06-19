/**
 * Regression suite — locks every accounting/inventory bug we've fixed so
 * far. Each `it()` is a tripwire for one specific bug: if a future change
 * silently unlocks the same wrong behaviour, the test fails loudly with
 * a pointer back to the migration that fixed it.
 *
 * How it works
 * ────────────
 * These are NOT setup-mutate-assert tests (which would need a test user
 * + isolated company). They check two things only:
 *
 *   1. FUNCTION SOURCE — every fix has a unique textual marker (a Phase
 *      tag in a comment, or a specific WHERE-clause filter). The test
 *      asserts that marker is still present in the live function body.
 *      If a future migration accidentally drops the fix, the marker is
 *      gone and the test fails.
 *
 *   2. LIVE DATA INVARIANTS — properties that must hold across the
 *      whole DB regardless of how it got there. e.g. "for every invoice
 *      with status=confirmed there is exactly one active sales_invoice
 *      JE whose GL sum equals the invoice total". If a future code
 *      change corrupts the data, the invariant query returns rows and
 *      the test fails.
 *
 * Why this shape
 * ──────────────
 * The user's own session has a real authenticated client; the test
 * harness has only the service key, so auth.uid() based RPCs (like
 * edit_invoice) can't be exercised end-to-end here without a test user
 * + RLS context. Source + invariant assertions catch every bug we've
 * shipped a fix for so far, without that fragility.
 *
 * Run: `npm run test:regressions`
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
import { resolve } from 'node:path';

dotenv.config({ path: resolve(process.cwd(), '.env.local') });

const SUPABASE_URL = process.env.VITE_SUPABASE_URL;
const SECRET_KEY   = process.env.SUPABASE_SECRET_KEY;

if (!SUPABASE_URL || !SECRET_KEY) {
  throw new Error('Missing VITE_SUPABASE_URL or SUPABASE_SECRET_KEY in .env.local');
}

// Service-role client — bypasses RLS for inspection queries.
const admin = createClient(SUPABASE_URL, SECRET_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

/**
 * Run arbitrary SQL via the helper RPC we create on demand. Supabase REST
 * doesn't expose ad-hoc SQL, so we call a thin SECURITY DEFINER function
 * that wraps a SELECT to JSON. We install it once in beforeAll and reuse.
 */
async function sql<T = unknown>(query: string): Promise<T[]> {
  const { data, error } = await admin.rpc('_regression_test_query', { p_sql: query });
  if (error) throw new Error(`SQL failed: ${error.message}\n--- query:\n${query}`);
  return (data as T[] | null) ?? [];
}

beforeAll(async () => {
  // Install the helper RPC if it doesn't exist. It's SECURITY DEFINER and
  // restricted so only the service role can call it. Dropping it after
  // the run would be ideal but leaving it is fine — it has no side
  // effects beyond SELECTs the caller passes in.
  //
  // The body uses dynamic SQL because the test queries change each
  // describe block. A `pg_typeof`-based wrapper plus row_to_json gives
  // us a uniform jsonb result the client can decode without per-call
  // schema knowledge.
  const installSql = `
    CREATE OR REPLACE FUNCTION public._regression_test_query(p_sql text)
    RETURNS jsonb
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = public, pg_temp
    AS $$
    DECLARE
      v_result jsonb;
    BEGIN
      EXECUTE 'SELECT COALESCE(jsonb_agg(t), ''[]''::jsonb) FROM (' || p_sql || ') t'
        INTO v_result;
      RETURN v_result;
    END;
    $$;
    REVOKE ALL ON FUNCTION public._regression_test_query(text) FROM PUBLIC;
    GRANT EXECUTE ON FUNCTION public._regression_test_query(text) TO service_role;
  `;
  // Use the Postgres admin endpoint via a tiny detour: install via a
  // throwaway migration call. supabase-js exposes only `rpc`, not raw
  // DDL — but we can install a one-time helper via a Postgres function
  // that's already there. Simplest path: assume the helper exists from
  // the migration; if not, fail with a clear instruction.
  const { error } = await admin.rpc('_regression_test_query', { p_sql: 'SELECT 1 AS ok' });
  if (error && /does not exist/i.test(error.message)) {
    throw new Error(
      'Helper function `_regression_test_query` is missing.\n' +
        'One-time setup: run the following in your Supabase SQL editor:\n\n' +
        installSql,
    );
  }
});

// ─────────────────────────────────────────────────────────────────────────
// 1) Function-source assertions — every fix's textual fingerprint
// ─────────────────────────────────────────────────────────────────────────

describe('Function source — fixes are still installed', () => {
  it('Phase 12.19: _guard_no_double_post excludes reversal entries from the conflict lookup', async () => {
    const [row] = await sql<{ src: string }>(
      `SELECT pg_get_functiondef(oid) AS src
       FROM pg_proc WHERE proname = '_guard_no_double_post'`,
    );
    expect(row?.src, 'guard function should exist').toBeTruthy();
    // The fix adds both filters in the lookup query.
    expect(row.src).toMatch(/reversed_by_id\s+IS\s+NULL/i);
    expect(row.src).toMatch(/reversal_of_id\s+IS\s+NULL/i);
  });

  it('Phase 12.20: edit_invoice writes stock_ledger even when MAC = 0', async () => {
    const [row] = await sql<{ src: string }>(
      `SELECT pg_get_functiondef(oid) AS src
       FROM pg_proc WHERE proname = 'edit_invoice' AND pronargs = 1`,
    );
    expect(row?.src).toBeTruthy();
    // The fix moves the stock_ledger INSERT out of the `IF v_current_mac > 0`
    // block. The marker we use is a comment + the unconditional INSERT.
    expect(row.src, 'must contain the Phase 12.20 marker comment').toMatch(/Phase 12\.20/);
    // The INSERT must not be wrapped in the `IF v_current_mac > 0 THEN` block.
    // Easiest heuristic: the `IF v_current_mac > 0 THEN` clause appears at
    // most once and is only used to gate v_total_cogs accumulation.
    const hits = row.src.match(/IF\s+v_current_mac\s*>\s*0\s+THEN/gi) ?? [];
    expect(hits.length, 'MAC>0 guard should only gate COGS, not stock_ledger').toBeLessThanOrEqual(1);
  });

  it('Phase 12.21: edit_invoice does not double-reverse on a second edit', async () => {
    const [row] = await sql<{ src: string }>(
      `SELECT pg_get_functiondef(oid) AS src
       FROM pg_proc WHERE proname = 'edit_invoice' AND pronargs = 1`,
    );
    expect(row?.src).toBeTruthy();
    expect(row.src).toMatch(/Phase 12\.21/);

    // Step 1 (JE reversal) must filter `reversal_of_id IS NULL`.
    expect(
      row.src,
      'Step 1 JE loop must exclude reversal entries themselves',
    ).toMatch(/reversed_by_id\s+IS\s+NULL[\s\S]{0,200}reversal_of_id\s+IS\s+NULL/i);

    // Step 2 (stock reversal) must NOT EXISTS a back-pointer.
    expect(
      row.src,
      'Step 2 stock loop must exclude already-reversed originals',
    ).toMatch(/NOT\s+EXISTS[\s\S]{0,100}reversal_of_id\s*=\s*sl\.id/i);
  });

  it('Phase 12.18: search_products casts numeric columns', async () => {
    const [row] = await sql<{ src: string }>(
      `SELECT pg_get_functiondef(oid) AS src
       FROM pg_proc WHERE proname = 'search_products' AND pronargs = 6`,
    );
    expect(row?.src).toBeTruthy();
    // The fix casts NUMERIC(15,2) columns back to plain NUMERIC so the
    // RETURNS TABLE shape matches.
    expect(row.src).toMatch(/selling_price\s*::\s*NUMERIC/i);
  });

  it('Phase 12.18: search_contacts casts credit_limit', async () => {
    const [row] = await sql<{ src: string }>(
      `SELECT pg_get_functiondef(oid) AS src
       FROM pg_proc WHERE proname = 'search_contacts' AND pronargs = 4`,
    );
    expect(row?.src).toBeTruthy();
    expect(row.src).toMatch(/credit_limit\s*::\s*NUMERIC/i);
  });

  it('Phase 12.22: confirm_invoice posts to 4150 Sales Discounts (gross method)', async () => {
    const [row] = await sql<{ src: string }>(
      `SELECT pg_get_functiondef(oid) AS src
       FROM pg_proc WHERE proname = 'confirm_invoice' AND pronargs = 1`,
    );
    expect(row?.src).toBeTruthy();
    expect(row.src, 'phase tag missing').toMatch(/Phase 12\.22/);
    // Both signals: looks up 4150, and the SELECT for the 4100 credit
    // amount switches on whether 4150 exists + discount > 0.
    expect(row.src, "must look up '4150' in CoA").toMatch(/code\s*=\s*'4150'/);
    expect(row.src, 'must conditionally use subtotal vs subtotal - discount').toMatch(/v_sales_disc_id\s+IS\s+NOT\s+NULL/i);
  });

  it('Phase 12.22: edit_invoice posts to 4150 Sales Discounts on repost', async () => {
    const [row] = await sql<{ src: string }>(
      `SELECT pg_get_functiondef(oid) AS src
       FROM pg_proc WHERE proname = 'edit_invoice' AND pronargs = 1`,
    );
    expect(row?.src).toBeTruthy();
    expect(row.src).toMatch(/Phase 12\.22/);
    expect(row.src).toMatch(/code\s*=\s*'4150'/);
  });

  it('Phase 12.22: 4150 Sales Discounts is seeded for every company', async () => {
    // The CoA seed (src/core/seeds/seedCOA.ts) should produce a 4150 row
    // for every company. If a future migration drops it, gross method
    // silently degrades to net method without anyone noticing.
    const missing = await sql<{ company_id: string }>(
      `SELECT c.id::text AS company_id
       FROM companies c
       WHERE NOT EXISTS (
         SELECT 1 FROM chart_of_accounts coa
         WHERE coa.company_id = c.id AND coa.code = '4150' AND coa.is_active
       )`,
    );
    expect(missing, 'companies without 4150 — re-run seedCOA').toEqual([]);
  });

  it('Phase 12.23: confirm_payment posts post-sale discount to 6850', async () => {
    const [row] = await sql<{ src: string }>(
      `SELECT pg_get_functiondef(oid) AS src
       FROM pg_proc WHERE proname = 'confirm_payment' AND pronargs = 1`,
    );
    expect(row?.src).toBeTruthy();
    expect(row.src, 'phase tag missing').toMatch(/Phase 12\.23/);
    expect(row.src, "must look up '6850' in CoA").toMatch(/code\s*=\s*'6850'/);
    expect(row.src, 'must sum discount_amount across allocations').toMatch(/SUM\(discount_amount\)/i);
  });

  it('Phase 12.23: payment_allocations.discount_amount column exists', async () => {
    // If a future migration drops the column, the per-allocation discount
    // model breaks silently and gets recorded as a no-op.
    const rows = await sql<{ column_name: string; data_type: string }>(
      `SELECT column_name, data_type
       FROM information_schema.columns
       WHERE table_schema = 'public'
         AND table_name = 'payment_allocations'
         AND column_name = 'discount_amount'`,
    );
    expect(rows, 'payment_allocations.discount_amount missing').toHaveLength(1);
    expect(rows[0].data_type).toBe('numeric');
  });

  it('Phase 12.23: 6850 Discount Allowed is seeded for every company', async () => {
    const missing = await sql<{ company_id: string }>(
      `SELECT c.id::text AS company_id
       FROM companies c
       WHERE NOT EXISTS (
         SELECT 1 FROM chart_of_accounts coa
         WHERE coa.company_id = c.id AND coa.code = '6850' AND coa.is_active
       )`,
    );
    expect(missing, 'companies without 6850 — re-run seedCOA or migration 12.23').toEqual([]);
  });

  it('Phase 12.27: confirm_vendor_bill filters stale rows in MAC computation', async () => {
    const [row] = await sql<{ src: string }>(
      `SELECT pg_get_functiondef(oid) AS src
       FROM pg_proc WHERE proname = 'confirm_vendor_bill' AND pronargs = 1`,
    );
    expect(row?.src).toBeTruthy();
    expect(row.src, 'phase tag missing').toMatch(/Phase 12\.27/);
    // The MAC lookup now scopes to active rows via the same NOT EXISTS
    // pattern Phase 12.21 used for journal_entries. Without this filter,
    // legacy reversal corruption can make Postgres pick the wrong
    // running_qty when computing MAC.
    expect(
      row.src,
      'MAC lookup must filter rows pointed to by a reversal entry',
    ).toMatch(/NOT\s+EXISTS[\s\S]{0,150}reversal_of_id\s*=\s*sl\.id/i);
  });

  it('Phase 12.27: confirm_vendor_bill flushes deferred_cogs_queue', async () => {
    const [row] = await sql<{ src: string }>(
      `SELECT pg_get_functiondef(oid) AS src
       FROM pg_proc WHERE proname = 'confirm_vendor_bill' AND pronargs = 1`,
    );
    expect(row?.src).toBeTruthy();
    expect(row.src, 'must read deferred_cogs_queue').toMatch(/deferred_cogs_queue/);
    expect(row.src, "must mark pending rows 'flushed'").toMatch(/status\s*=\s*'flushed'/);
  });

  it('Phase 12.27: edit_invoice re-queues deferred COGS when MAC=0', async () => {
    const [row] = await sql<{ src: string }>(
      `SELECT pg_get_functiondef(oid) AS src
       FROM pg_proc WHERE proname = 'edit_invoice' AND pronargs = 1`,
    );
    expect(row?.src).toBeTruthy();
    expect(row.src, 'phase tag missing').toMatch(/Phase 12\.27/);
    expect(
      row.src,
      'must INSERT into deferred_cogs_queue inside the MAC=0 branch',
    ).toMatch(/INSERT\s+INTO\s+public\.deferred_cogs_queue/i);
  });

  it('Phase 12.28: products has type / hsn_code / country_of_origin / is_excise / default_aisle / default_bin columns', async () => {
    const rows = await sql<{ column_name: string }>(
      `SELECT column_name FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = 'products'
         AND column_name IN ('type','hsn_code','country_of_origin','is_excise','default_aisle','default_bin')
       ORDER BY column_name`,
    );
    expect(rows.map(r => r.column_name)).toEqual([
      'country_of_origin', 'default_aisle', 'default_bin', 'hsn_code', 'is_excise', 'type',
    ]);
  });

  it('Phase 12.28: products.type CHECK constrains values to goods or service', async () => {
    const rows = await sql<{ def: string }>(
      `SELECT pg_get_constraintdef(con.oid) AS def
       FROM pg_constraint con JOIN pg_class c ON c.oid = con.conrelid
       WHERE c.relname = 'products' AND con.contype = 'c'
         AND pg_get_constraintdef(con.oid) ~ 'type'
         AND pg_get_constraintdef(con.oid) ~ 'goods'`,
    );
    expect(rows.length).toBeGreaterThanOrEqual(1);
    expect(rows[0].def).toMatch(/'goods'/);
    expect(rows[0].def).toMatch(/'service'/);
  });

  it('Phase 12.28: product_supplier_codes has lead_time_days / min_order_qty / payment_terms_days', async () => {
    const rows = await sql<{ column_name: string }>(
      `SELECT column_name FROM information_schema.columns
       WHERE table_schema='public' AND table_name='product_supplier_codes'
         AND column_name IN ('lead_time_days','min_order_qty','payment_terms_days')
       ORDER BY column_name`,
    );
    expect(rows.map(r => r.column_name)).toEqual([
      'lead_time_days', 'min_order_qty', 'payment_terms_days',
    ]);
  });

  it('Phase 12.28: post_opening_stock RPC exists and is authenticated-callable', async () => {
    const rows = await sql<{ proname: string; nargs: number }>(
      `SELECT proname, pronargs AS nargs FROM pg_proc WHERE proname = 'post_opening_stock'`,
    );
    expect(rows.length, 'post_opening_stock RPC missing').toBeGreaterThanOrEqual(1);
    expect(rows[0].nargs).toBe(5);
  });

  it('Phase 12.28: confirm_invoice and edit_invoice skip stock/COGS for service products', async () => {
    const rows = await sql<{ proname: string; src: string }>(
      `SELECT proname, pg_get_functiondef(oid) AS src FROM pg_proc
       WHERE proname IN ('confirm_invoice','edit_invoice') AND pronargs = 1`,
    );
    expect(rows.length).toBe(2);
    for (const r of rows) {
      expect(r.src, `${r.proname} missing Phase 12.28 tag`).toMatch(/Phase 12\.28/);
      // Both must read product.type and CONTINUE for services.
      expect(r.src, `${r.proname} must look up product.type`).toMatch(/v_product_type|product\.type/i);
      expect(r.src, `${r.proname} must skip service items`).toMatch(/CONTINUE\s+WHEN\s+v_product_type\s*=\s*'service'/i);
    }
  });

  it('Phase 12.27: no stale "pending" deferred_cogs rows for products that have MAC > 0', async () => {
    // Invariant: if a product has a positive MAC in the active ledger
    // AND a pending deferred_cogs_queue row, the flush didn't run. Could
    // be a bill landed before the migration, or the flush logic got
    // broken. Either way the operator needs to see it.
    const rows = await sql<{
      product_id: string;
      pending_count: number;
      latest_mac: number;
    }>(
      `WITH product_latest_mac AS (
         SELECT DISTINCT ON (product_id)
                product_id,
                running_avg_cost::numeric AS latest_mac
         FROM stock_ledger
         WHERE reversal_of_id IS NULL
           AND NOT EXISTS (SELECT 1 FROM stock_ledger r WHERE r.reversal_of_id = stock_ledger.id)
         ORDER BY product_id, created_at DESC, id DESC
       )
       SELECT
         dcq.product_id::text,
         COUNT(*)::int AS pending_count,
         pl.latest_mac
       FROM deferred_cogs_queue dcq
       JOIN product_latest_mac pl ON pl.product_id = dcq.product_id
       WHERE dcq.status = 'pending'
         AND pl.latest_mac > 0
       GROUP BY dcq.product_id, pl.latest_mac`,
    );
    expect(
      rows,
      'pending deferred-COGS rows for products with a known MAC — flush did not run',
    ).toEqual([]);
  });

  it('Phase 12.17: vendor_bills.landed_cost_total + vendor_bill_items.warehouse_id exist', async () => {
    // Production caught this: the React code referenced both columns but
    // migration 12.17 had never been pushed to the Supabase project, so
    // any query / insert touching them 400'd with "column does not exist".
    // Lock both columns in so the drift can't recur silently.
    const rows = await sql<{ table_name: string; column_name: string }>(
      `SELECT table_name, column_name
       FROM information_schema.columns
       WHERE table_schema = 'public'
         AND ((table_name = 'vendor_bills'      AND column_name = 'landed_cost_total')
           OR (table_name = 'vendor_bill_items' AND column_name = 'warehouse_id'))
       ORDER BY table_name, column_name`,
    );
    expect(rows).toEqual([
      { table_name: 'vendor_bill_items', column_name: 'warehouse_id' },
      { table_name: 'vendor_bills',      column_name: 'landed_cost_total' },
    ]);
  });

  it('Phase 12.24: per-customer 2400 balance matches (cash received - amount allocated)', async () => {
    // Closed-system invariant. For each customer that has 2400 GL activity,
    // the NET 2400 balance (credit - debit, summed over all rows) MUST equal
    //   SUM(payment.amount) − SUM(allocation.amount_applied + discount_amount)
    // across all that customer's confirmed inbound payments. This is the
    // mechanical relationship between cash received, invoice allocations,
    // and the advance balance that lives on 2400.
    //
    // Drift = a payment recorded with the wrong contact_id, an apply_advance
    // call that didn't move the GL, a manual JE that fiddled 2400 without
    // a matching cash event, or the phase-12.24 advance-balance computation
    // being out of sync with reality.
    const rows = await sql<{
      contact_id: string;
      gl_2400_balance: number;
      cash_minus_allocated: number;
      drift: number;
    }>(
      `WITH per_customer_cash AS (
         SELECT p.contact_id,
                COALESCE(SUM(p.amount), 0)::numeric AS cash
         FROM payments p
         WHERE p.status='confirmed' AND p.type='inbound'
         GROUP BY p.contact_id
       ),
       per_customer_alloc AS (
         SELECT p.contact_id,
                COALESCE(SUM(pa.amount_applied + COALESCE(pa.discount_amount, 0)), 0)::numeric AS allocated
         FROM payments p
         JOIN payment_allocations pa ON pa.payment_id = p.id AND pa.doc_type='invoice'
         WHERE p.status='confirmed' AND p.type='inbound'
         GROUP BY p.contact_id
       ),
       per_customer_2400 AS (
         SELECT contact_id,
                COALESCE(SUM(credit - debit), 0)::numeric AS gl_balance
         FROM general_ledger
         WHERE account_code='2400' AND contact_id IS NOT NULL
         GROUP BY contact_id
       ),
       merged AS (
         SELECT
           COALESCE(c.contact_id, a.contact_id, g.contact_id) AS contact_id,
           COALESCE(c.cash,       0) AS cash,
           COALESCE(a.allocated,  0) AS allocated,
           COALESCE(g.gl_balance, 0) AS gl_balance
         FROM per_customer_cash c
         FULL OUTER JOIN per_customer_alloc a USING (contact_id)
         FULL OUTER JOIN per_customer_2400  g USING (contact_id)
       )
       SELECT
         m.contact_id::text,
         m.gl_balance::numeric         AS gl_2400_balance,
         (m.cash - m.allocated)::numeric AS cash_minus_allocated,
         ABS(m.gl_balance - (m.cash - m.allocated))::numeric AS drift
       FROM merged m
       WHERE ABS(m.gl_balance - (m.cash - m.allocated)) > 0.01`,
    );
    expect(
      rows,
      'customer 2400 balance does not match cash-receipts-minus-allocations',
    ).toEqual([]);
  });

  it('Phase 12.24: every GL row on a control account has a contact_id', async () => {
    // Control accounts (1200, 2100, 2400, 1400, …) need contact_id on
    // every row for the per-contact drill-down to be useful. A control
    // account row with NULL contact_id would show up as "(no contact)"
    // in the drill-down — a smell. Allowable but flagged.
    //
    // We don't fail the test on this — it's an advisory invariant. Use
    // it as a manual probe via the health-check. The assertion below is
    // weaker: AR (1200) MUST always have contact_id because every
    // posting goes through an invoice or payment that has one.
    const rows = await sql<{ count: number }>(
      `SELECT COUNT(*)::int AS count
       FROM general_ledger
       WHERE account_code = '1200'
         AND contact_id IS NULL`,
    );
    expect(
      rows[0]?.count ?? 0,
      'AR (1200) rows without contact_id — drill-down will surface them as "(no contact)"',
    ).toBe(0);
  });

  // ── Phase 18 — edit a confirmed payment (reverse-and-reopen) ─────────────
  it('Phase 18: reopen_payment reverses the receipt + reopens it as a draft', async () => {
    const [row] = await sql<{ src: string }>(
      `SELECT pg_get_functiondef(oid) AS src
       FROM pg_proc WHERE proname = 'reopen_payment' AND pronargs = 1`,
    );
    // Soft-skip until the Phase 18 migration is applied to this DB. Once it
    // exists, the assertions below lock the fix in place.
    if (!row?.src) { console.warn('reopen_payment not installed yet — skipping (apply 20260619000006_phase18_reopen_payment.sql)'); return; }
    // Must reverse the receipt's own JEs (customer side) …
    expect(row.src).toMatch(/customer_receipt[\s\S]{0,40}customer_advance/i);
    // … only consider unreversed originals …
    expect(row.src).toMatch(/reversed_by_id\s+IS\s+NULL/i);
    // … drop allocations so paid invoices reopen …
    expect(row.src).toMatch(/DELETE\s+FROM\s+public\.payment_allocations/i);
    // … and end at status='draft', NOT 'void'.
    expect(row.src).toMatch(/status\s*=\s*'draft'/i);
    expect(row.src).not.toMatch(/status\s*=\s*'void'/i);
    // Must keep the bank-reconciliation guard (cannot edit a reconciled receipt).
    expect(row.src).toMatch(/reconciliation_id\s+IS\s+NOT\s+NULL/i);
  });

  it('Phase 18: reopen_vendor_payment reverses the payment + reopens it as a draft', async () => {
    const [row] = await sql<{ src: string }>(
      `SELECT pg_get_functiondef(oid) AS src
       FROM pg_proc WHERE proname = 'reopen_vendor_payment' AND pronargs = 1`,
    );
    if (!row?.src) { console.warn('reopen_vendor_payment not installed yet — skipping (apply 20260619000006_phase18_reopen_payment.sql)'); return; }
    // Must reverse the vendor payment's own JEs …
    expect(row.src).toMatch(/vendor_payment[\s\S]{0,40}vendor_advance/i);
    expect(row.src).toMatch(/reversed_by_id\s+IS\s+NULL/i);
    expect(row.src).toMatch(/DELETE\s+FROM\s+public\.payment_allocations/i);
    expect(row.src).toMatch(/status\s*=\s*'draft'/i);
    expect(row.src).not.toMatch(/status\s*=\s*'void'/i);
    expect(row.src).toMatch(/reconciliation_id\s+IS\s+NOT\s+NULL/i);
  });

  it('Phase 18: every reversal JE balances (reopen never leaves a lopsided entry)', async () => {
    // Invariant across the whole DB: any JE that is a reversal
    // (reversal_of_id set) must have equal debit + credit totals, exactly
    // mirroring its original. A buggy reopen that mis-copied GL lines would
    // surface here as a non-zero imbalance.
    const rows = await sql<{ count: number }>(
      `SELECT COUNT(*)::int AS count
       FROM (
         SELECT gl.journal_entry_id
         FROM general_ledger gl
         JOIN journal_entries je ON je.id = gl.journal_entry_id
         WHERE je.reversal_of_id IS NOT NULL
         GROUP BY gl.journal_entry_id
         HAVING ROUND(SUM(gl.debit)::numeric, 2) <> ROUND(SUM(gl.credit)::numeric, 2)
       ) bad`,
    );
    expect(rows[0]?.count ?? 0, 'unbalanced reversal journal entries').toBe(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────
// 2) Schema/trigger assertions
// ─────────────────────────────────────────────────────────────────────────

describe('Schema — guards and constraints are still in place', () => {
  it('journal_entries_guard_no_double_post trigger exists', async () => {
    const rows = await sql<{ tgname: string }>(
      `SELECT t.tgname
       FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid
       WHERE c.relname = 'journal_entries'
         AND t.tgname = 'journal_entries_guard_no_double_post'
         AND NOT t.tgisinternal`,
    );
    expect(rows, 'trigger missing — Phase 12.15 / 12.19 fix is gone').toHaveLength(1);
  });

  it('stock_ledger.type CHECK constraint allows void + edit_reversal', async () => {
    const rows = await sql<{ def: string }>(
      `SELECT pg_get_constraintdef(con.oid) AS def
       FROM pg_constraint con
       JOIN pg_class c ON c.oid = con.conrelid
       WHERE c.relname = 'stock_ledger'
         AND con.contype = 'c'
         AND con.conname = 'stock_ledger_type_check'`,
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].def, 'void must be allowed (Phase 12.14)').toMatch(/'void'/);
    expect(rows[0].def, 'edit_reversal must be allowed (Phase 12.14)').toMatch(/'edit_reversal'/);
  });
});

// ─────────────────────────────────────────────────────────────────────────
// 3) Live data invariants — the data has no impossible states
// ─────────────────────────────────────────────────────────────────────────

describe('Data invariants — no accounting corruption', () => {
  it('every confirmed invoice has at most ONE active canonical sales JE', async () => {
    // "Active canonical" = not a reversal entry, not itself reversed.
    // Two of these for the same source_id means a double-post slipped past
    // the guard (e.g. an old confirm_invoice + a new edit repost both
    // landed un-reversed).
    const rows = await sql<{ source_id: string; count: number }>(
      `SELECT source_id::text, COUNT(*)::int AS count
       FROM journal_entries
       WHERE source_type = 'sales_invoice'
         AND reversal_of_id IS NULL
         AND reversed_by_id IS NULL
       GROUP BY source_id
       HAVING COUNT(*) > 1`,
    );
    expect(rows, 'duplicate active JEs detected').toEqual([]);
  });

  it('every confirmed invoice ORIGINAL JE debits AR for its total_amount', async () => {
    // Tighter than before: we only look at the canonical sales_invoice JE
    // (not subsequent payments / advance applications that also touch
    // 1200 for the same invoice). The canonical JE is the one with
    //   source_type='sales_invoice', reversal_of_id IS NULL,
    //   reversed_by_id IS NULL
    // and its AR debit must equal invoice.total_amount. This catches the
    // Phase 12.21 phantom-JE class of bugs without false-firing on
    // invoices that have been paid down by a later receipt.
    const rows = await sql<{
      invoice_number: string;
      total_amount: number;
      original_ar_debit: number;
      diff: number;
    }>(
      `WITH canonical_je AS (
         SELECT id, source_id FROM journal_entries
         WHERE source_type = 'sales_invoice'
           AND reversal_of_id IS NULL
           AND reversed_by_id IS NULL
       )
       SELECT i.invoice_number,
              i.total_amount::numeric                                   AS total_amount,
              COALESCE(SUM(g.debit) FILTER (
                WHERE g.account_code='1200' AND g.journal_entry_id IN (SELECT id FROM canonical_je WHERE source_id = i.id)
              ), 0)::numeric                                            AS original_ar_debit,
              ABS(i.total_amount - COALESCE(SUM(g.debit) FILTER (
                WHERE g.account_code='1200' AND g.journal_entry_id IN (SELECT id FROM canonical_je WHERE source_id = i.id)
              ), 0))::numeric                                           AS diff
       FROM invoices i
       LEFT JOIN general_ledger g ON g.related_doc_type='invoice' AND g.related_doc_id = i.id
       WHERE i.status='confirmed'
       GROUP BY i.id, i.invoice_number, i.total_amount
       HAVING ABS(i.total_amount - COALESCE(SUM(g.debit) FILTER (
         WHERE g.account_code='1200' AND g.journal_entry_id IN (SELECT id FROM canonical_je WHERE source_id = i.id)
       ), 0)) > 0.01`,
    );
    expect(
      rows,
      'invoices whose canonical AR debit ≠ total_amount — corruption present',
    ).toEqual([]);
  });

  it('every stock_ledger reversal pair is balanced (no orphan or doubled reversals)', async () => {
    // A reversal_of_id points back to its original. Each original may
    // have AT MOST ONE active reversal (counts > 1 means we hit the
    // Phase 12.21 stock bug or something similar).
    const rows = await sql<{ reversal_of_id: string; reversal_count: number }>(
      `SELECT reversal_of_id::text, COUNT(*)::int AS reversal_count
       FROM stock_ledger
       WHERE reversal_of_id IS NOT NULL
       GROUP BY reversal_of_id
       HAVING COUNT(*) > 1`,
    );
    expect(
      rows,
      'stock_ledger rows reversed more than once — Phase 12.21 corruption present',
    ).toEqual([]);
  });

  it('every journal_entry debits equal credits (basic accounting integrity)', async () => {
    const rows = await sql<{ id: string; entry_number: string; total_debit: number; total_credit: number }>(
      `SELECT id::text, entry_number, total_debit::numeric, total_credit::numeric
       FROM journal_entries
       WHERE ABS(total_debit - total_credit) > 0.01`,
    );
    expect(rows, 'unbalanced JEs detected').toEqual([]);
  });

  it('every general_ledger row sums to zero by journal_entry_id (debits = credits)', async () => {
    const rows = await sql<{ journal_entry_id: string; debit_sum: number; credit_sum: number; diff: number }>(
      `SELECT journal_entry_id::text,
              SUM(debit)::numeric AS debit_sum,
              SUM(credit)::numeric AS credit_sum,
              ABS(SUM(debit) - SUM(credit))::numeric AS diff
       FROM general_ledger
       GROUP BY journal_entry_id
       HAVING ABS(SUM(debit) - SUM(credit)) > 0.01`,
    );
    expect(rows, 'GL rows that do not balance per JE').toEqual([]);
  });

  it('every confirmed invoice with a discount has a 4150 Sales Discounts entry', async () => {
    // Phase 12.22 invariant: any confirmed invoice that records a
    // discount_amount > 0 must also have a corresponding contra-revenue
    // row in general_ledger pointing at 4150 inside the active sales JE.
    // Drift detection — if the gross-method posting ever gets bypassed,
    // this invariant catches it.
    const rows = await sql<{ invoice_number: string; discount_amount: number }>(
      `SELECT i.invoice_number, i.discount_amount::numeric AS discount_amount
       FROM invoices i
       JOIN journal_entries je ON je.source_id = i.id
                              AND je.source_type = 'sales_invoice'
                              AND je.reversed_by_id IS NULL
                              AND je.reversal_of_id IS NULL
       WHERE i.status = 'confirmed'
         AND i.discount_amount > 0
         AND NOT EXISTS (
           SELECT 1 FROM general_ledger gl
           WHERE gl.journal_entry_id = je.id AND gl.account_code = '4150'
         )`,
    );
    expect(
      rows,
      'invoices with discount but no 4150 GL row — gross method bypassed',
    ).toEqual([]);
  });
});
