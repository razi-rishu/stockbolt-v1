/**
 * Finding C (phase119) — static guards over the migration files.
 *
 * The behaviour is proven on staging by tests/integration/finding-c-verification.
 * This keeps the repo from quietly undoing it later: a migration that hands
 * clients ledger write rights back, grants ledger_writer to a login role, or
 * redefines a posting function without SECURITY DEFINER / a pinned search_path
 * fails the pre-commit hook.
 */
import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const DIR = join(__dirname, '..', '..', 'supabase', 'migrations');
const files = readdirSync(DIR).filter((f) => f.endsWith('.sql')).sort();
const read = (f: string) => readFileSync(join(DIR, f), 'utf8').replace(/\r\n/g, '\n');
const P119 = files.find((f) => f.includes('phase119_finding_c_ledger_writer'));
const LEDGERS = ['general_ledger', 'journal_entries', 'stock_ledger', 'deferred_cogs_queue'];

describe('Finding C — ledger_writer (phase119)', () => {
  it('the phase119 migration exists', () => {
    expect(P119).toBeTruthy();
  });

  const sql = P119 ? read(P119) : '';
  const owned = [...sql.matchAll(/ALTER FUNCTION (public\.\w+\([^)]*\)) OWNER TO ledger_writer;/g)].map((m) => m[1]);

  it('moves exactly the 51 posting functions to ledger_writer', () => {
    expect(owned).toHaveLength(51);
    expect(new Set(owned).size).toBe(51);
    for (const name of ['post_journal_entry', 'reverse_journal_entry', 'confirm_invoice', 'confirm_vendor_bill', 'confirm_pos_sale', 'tg_retag_gl_project']) {
      expect(owned.some((f) => f.startsWith(`public.${name}(`)), name).toBe(true);
    }
  });

  it('each function: anon revoked first, then SECURITY DEFINER with a pinned search_path, then the owner change', () => {
    for (const f of owned) {
      const esc = f.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const revoke = sql.search(new RegExp(`REVOKE EXECUTE ON FUNCTION ${esc} FROM PUBLIC, anon;`));
      const definer = sql.search(new RegExp(`ALTER FUNCTION ${esc} SECURITY DEFINER SET search_path = public, pg_temp;`));
      const owner = sql.search(new RegExp(`ALTER FUNCTION ${esc} OWNER TO ledger_writer;`));
      expect(revoke, `${f} revoke`).toBeGreaterThan(-1);
      expect(definer, `${f} definer`).toBeGreaterThan(revoke);
      expect(owner, `${f} owner`).toBeGreaterThan(definer);
    }
  });

  it('ledger_writer is a closed role: no login, no RLS bypass, CREATE taken back', () => {
    expect(sql).toMatch(/CREATE ROLE ledger_writer NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS NOREPLICATION;/);
    expect(sql).toMatch(/rolcanlogin OR rolsuper OR rolbypassrls/); // refuses an existing unsafe role
    const grant = sql.indexOf('GRANT CREATE ON SCHEMA public TO ledger_writer;');
    const revoke = sql.indexOf('REVOKE CREATE ON SCHEMA public FROM ledger_writer;');
    expect(grant).toBeGreaterThan(-1);
    expect(revoke).toBeGreaterThan(grant);
  });

  it('clients lose write rights on the four ledgers in phase119', () => {
    expect(sql).toMatch(new RegExp(`REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON ${LEDGERS.map((t) => `public\\.${t}`).join(', ')} FROM PUBLIC, anon, authenticated;`));
  });

  it('no migration grants ledger_writer to a client or login role', () => {
    for (const f of files) {
      const bad = read(f).match(/GRANT\s+ledger_writer\s+TO\s+([^;]+);/gi) ?? [];
      for (const g of bad) expect(g, `${f}: ${g}`).toMatch(/TO\s+postgres\b/i);
    }
  });

  const later = P119 ? files.filter((f) => f > P119) : [];
  const names = owned.map((f) => f.slice('public.'.length, f.indexOf('(')));

  it('no later migration gives clients ledger write rights back', () => {
    for (const f of later) {
      const s = read(f);
      for (const t of LEDGERS) {
        const re = new RegExp(`GRANT[^;]*\\b(INSERT|UPDATE|DELETE|ALL)\\b[^;]*ON[^;]*\\b${t}\\b[^;]*TO[^;]*\\b(authenticated|anon|PUBLIC)\\b`, 'i');
        expect(re.test(s), `${f} re-grants ${t}`).toBe(false);
      }
    }
  });

  it('a later redefinition of a posting function keeps SECURITY DEFINER and a pinned search_path', () => {
    for (const f of later) {
      const s = read(f);
      // The header runs to the body's opening dollar quote ($function$, $$, $body$...).
      for (const m of s.matchAll(/CREATE OR REPLACE FUNCTION public\.(\w+)\s*\(([\s\S]*?)\bAS\s+\$[a-z_]*\$/gi)) {
        if (!names.includes(m[1])) continue;
        expect(m[2], `${f}: ${m[1]} must stay SECURITY DEFINER`).toMatch(/SECURITY DEFINER/);
        expect(m[2], `${f}: ${m[1]} must pin search_path`).toMatch(/SET search_path/);
      }
    }
  });
});
