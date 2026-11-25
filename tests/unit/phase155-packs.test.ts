/**
 * phase155 — packs. Locks the shape of the migration and the client header;
 * the numbers were proven on staging with the real functions.
 */
import { readFileSync } from 'fs';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/env', () => ({ env: { supabase_url: 'https://x.test/', supabase_publishable_key: 'k' } }));
import { UNITS_HEADER, unitsAwareFetch } from '@/data/supabase-client';

const sql = readFileSync('supabase/migrations/20261124000003_phase155_packs.sql', 'utf8').replace(/\r\n/g, '\n');
const code = sql.replace(/--[^\n]*/g, '');
const body = (fn: string) => {
  const i = code.indexOf(`FUNCTION public.${fn}(`);
  expect(i, fn).toBeGreaterThan(-1);
  return code.slice(i, code.indexOf('$function$;', i));
};

describe('phase155 packs — migration', () => {
  it('refuses to run over a function it was not built from', () => {
    expect((sql.match(/^ {4}\('[a-z_]+', '[0-9a-f]{32}'\)/gm) ?? []).length).toBe(9);
    expect(code.indexOf('$guard$')).toBeLessThan(code.indexOf('ALTER TABLE'));
  });
  it('is off for every company and changes no data', () => {
    expect(code).toMatch(/packs_enabled boolean NOT NULL DEFAULT false/);
    expect(code).not.toMatch(/DROP\s+(TABLE|COLUMN)|ALTER\s+COLUMN/i);
    expect(code).not.toMatch(/^\s*(UPDATE|INSERT INTO) public\.(products|inventory_settings|product_units|units_of_measure)\b/m);
  });
  it('a pack cannot exist without a value', () => {
    expect(code).toMatch(/factor\s+numeric\(18,6\) NOT NULL CHECK \(factor > 0/);
  });
  it.each(['confirm_invoice', 'edit_invoice', 'confirm_grn', 'confirm_vendor_bill', 'confirm_credit_note', 'confirm_debit_note'])(
    '%s moves base units, still as a pinned definer', (fn) => {
      const b = body(fn);
      expect(b).toMatch(/base_quantity/);
      expect(b).toMatch(/SECURITY DEFINER/);
      expect(b).toMatch(/SET search_path TO/);
    });
  it('both returnable views keep security_invoker', () => {
    expect((code.match(/returnable WITH \(security_invoker = true\)/g) ?? []).length).toBe(2);
  });
  it('an old app is stopped before its delete, and old return documents refuse packs', () => {
    const b = body('tg_pack_line');
    expect(b.indexOf('app_update_required: your company uses packs')).toBeLessThan(b.indexOf("IF TG_OP = 'DELETE' THEN RETURN OLD"));
    expect(body('tg_return_no_packs')).toMatch(/pack_return_not_supported/);
  });
});

describe('phase156 acceptance record', () => {
  const s156 = readFileSync('supabase/migrations/20261125000001_phase156_pack_acceptance.sql', 'utf8').replace(/--.*/g, '');
  it('is a pinned definer, closed to anon, limited to the caller’s company and permission', () => {
    expect(s156).toMatch(/SECURITY DEFINER\s+SET search_path TO 'public', 'pg_temp'/);
    expect(s156).toMatch(/REVOKE ALL ON FUNCTION public\.record_pack_acceptance\(text, uuid\) FROM PUBLIC, anon/);
    expect(s156).toMatch(/company_id = \$2/);
    expect(s156).toMatch(/NOT public\.has_perm\(v_perm\)/);
  });
  it('takes no text from the client and only adds a function', () => {
    expect(s156).toMatch(/record_pack_acceptance\(p_doc_type text, p_doc_id uuid\)/);
    expect(s156).not.toMatch(/ALTER TABLE|DROP |UPDATE public|DELETE FROM/);
  });
});

describe('phase155 packs — client header', () => {
  afterEach(() => vi.unstubAllGlobals());
  const sent = async (url: string, init?: RequestInit) => {
    const f = vi.fn().mockResolvedValue(new Response('{}'));
    vi.stubGlobal('fetch', f);
    await unitsAwareFetch(url, init);
    return new Headers((f.mock.calls[0][1] as RequestInit | undefined)?.headers);
  };
  it('is added to table requests and keeps the other headers', async () => {
    const h = await sent('https://x.test/rest/v1/invoice_items?id=eq.1', { headers: { apikey: 'k', Authorization: 'Bearer t' } });
    expect(h.get(UNITS_HEADER)).toBe('1');
    expect(h.get('apikey')).toBe('k');
    expect(h.get('authorization')).toBe('Bearer t');
  });
  it.each(['https://x.test/auth/v1/token', 'https://x.test/storage/v1/object', 'https://x.test/functions/v1/api', 'https://other.test/rest/v1/a'])(
    'is not added to %s', async (url) => expect((await sent(url)).get(UNITS_HEADER)).toBeNull());
});
