import { describe, it, expect } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { createSupabaseAdapter } from '@/data/supabaseAdapter';
import type { Database } from '@/types/database';

/**
 * Every refund in the app failed with:
 *
 *     Cannot read properties of undefined (reading 'rest')
 *
 * postRefund held `const rpcCall = client.rpc`, which DETACHES the method
 * from its object. supabase-js implements rpc() as `return this.rest.rpc(...)`,
 * so with `this` undefined it threw before a single request left the browser.
 * All four refunds route through that helper — customer advance, vendor
 * advance, customer credit (R5a), vendor credit (P4) — so none of them had
 * ever been able to post, and the failure was invisible from the server side
 * because nothing was ever sent.
 *
 * The stub below reproduces supabase-js faithfully in the one way that
 * matters: rpc() reads `this.rest`. ESM is strict mode, so a detached call
 * gets `this === undefined` and throws the identical TypeError. That makes
 * this a real regression test rather than a source-text lint.
 */

interface Recorded { rpc: string[] }

function makeStubClient(rec: Recorded) {
  return {
    // The property the real client dereferences through `this`.
    rest: { marker: true },
    rpc(fn: string, _args: Record<string, unknown>) {
      // Mirrors supabase-js: `return this.rest.rpc(...)`. Reading it is the
      // whole point — a detached call blows up right here.
      void (this as { rest: { marker: boolean } }).rest.marker;
      rec.rpc.push(fn);
      if (fn === 'get_next_document_number') {
        return Promise.resolve({ data: 'XXX-0001', error: null });
      }
      return Promise.resolve({
        data: { payment_id: 'pay-1', payment_number: 'XXX-0001' },
        error: null,
      });
    },
    from(_table: string) {
      return {
        insert: () => ({
          select: () => ({
            single: () => Promise.resolve({ data: { id: 'pay-1' }, error: null }),
          }),
        }),
        delete: () => ({ eq: () => Promise.resolve({ error: null }) }),
      };
    },
  };
}

const INPUT = {
  company_id:      'co-1',
  contact_id:      'ct-1',
  date:            '2026-09-26',
  amount:          131.25,
  currency:        'AED',
  bank_account_id: 'bank-1',
  reference:       null,
  notes:           null,
};

/** The four entry points, and the engine each must reach. */
const REFUNDS = [
  ['refundCustomerAdvance', 'confirm_customer_refund'],
  ['refundVendorAdvance',   'confirm_vendor_refund'],
  ['refundCustomerCredit',  'confirm_customer_credit_refund'],
  ['refundVendorCredit',    'confirm_vendor_credit_refund'],
] as const;

describe('refunds reach the posting engine', () => {
  for (const [method, rpc] of REFUNDS) {
    it(`${method} calls ${rpc} instead of throwing on a detached client`, async () => {
      const rec: Recorded = { rpc: [] };
      const adapter = createSupabaseAdapter(
        makeStubClient(rec) as unknown as SupabaseClient<Database>,
      );
      const api = adapter.payments as unknown as
        Record<string, (i: typeof INPUT) => Promise<unknown>>;

      await expect(api[method]!(INPUT)).resolves.toBeTruthy();
      // Number first, then the engine. Both go through the same helper, so
      // the first one was where it used to die.
      expect(rec.rpc).toEqual(['get_next_document_number', rpc]);
    });
  }

  it('a detached client.rpc really does throw the error users saw', () => {
    // Guards the stub itself: if this ever stops throwing, the tests above
    // are no longer proving anything.
    const rec: Recorded = { rpc: [] };
    const client = makeStubClient(rec);
    const detached = client.rpc;
    expect(() => detached('anything', {}))
      .toThrow(/Cannot read properties of undefined \(reading 'rest'\)/);
    // And the same call through the object is fine.
    expect(() => client.rpc('anything', {})).not.toThrow();
  });
});
