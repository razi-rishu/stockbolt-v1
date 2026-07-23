/**
 * Phase 0 — RLS multi-tenant verification test (THE GATE).
 *
 * Per Doc 5 Phase 0 verification:
 *   "Sign up two users (test1@..., test2@...) in two different companies.
 *    Insert a row into companies table for each. Try to query the other's
 *    company from each user's session. Both queries must return zero rows."
 *
 * If this test fails, RLS is misconfigured and Phase 1 cannot start.
 *
 * SECRET KEY: required for the admin operations (creating users with
 * email auto-confirmed and creating the bootstrap company/profile rows
 * before the user exists in any tenant). Loaded from .env.local. The
 * non-VITE-prefixed name keeps Vite from ever shipping it to a browser
 * build — this key bypasses RLS and must never reach client code.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
import { resolve } from 'node:path';
import { randomUUID } from 'node:crypto';

import type { Database } from '@/types/database';
import { assertNotProductionTarget } from './_env-guard';

// Load .env.local explicitly (Vitest runs in Node, no Vite env loading).
dotenv.config({ path: resolve(process.cwd(), '.env.local') });

const SUPABASE_URL = process.env.VITE_SUPABASE_URL;
const PUBLISHABLE_KEY = process.env.VITE_SUPABASE_PUBLISHABLE_KEY;
const SECRET_KEY = process.env.SUPABASE_SECRET_KEY;

if (!SUPABASE_URL) throw new Error('Missing VITE_SUPABASE_URL in .env.local');
if (!PUBLISHABLE_KEY) throw new Error('Missing VITE_SUPABASE_PUBLISHABLE_KEY in .env.local');
if (!SECRET_KEY) {
  throw new Error(
    'Missing SUPABASE_SECRET_KEY in .env.local. ' +
      'Copy the Secret key from Supabase dashboard → API Keys → Secret keys (default).',
  );
}

interface Tenant {
  id: string;
  email: string;
  password: string;
  user_id: string;
  company_id: string;
  client: SupabaseClient<Database>;
}

const ADMIN: SupabaseClient<Database> = createClient<Database>(SUPABASE_URL, SECRET_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

async function provisionTenant(label: 'A' | 'B'): Promise<Tenant> {
  const tag = randomUUID().slice(0, 8);
  const email = `phase0-${label.toLowerCase()}-${tag}@stockbolt.test`;
  const password = `Phase0!${tag}`;

  // 1. Create the auth user with email auto-confirmed (admin bypasses confirmation).
  const { data: created, error: createErr } = await ADMIN.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });
  if (createErr || !created.user) throw new Error(`createUser failed: ${createErr?.message}`);
  const user_id = created.user.id;

  // 2. Insert a company for this tenant (admin client bypasses RLS).
  const company_id = randomUUID();
  const { error: companyErr } = await ADMIN.from('companies').insert({
    id: company_id,
    name: `Phase 0 Test Company ${label} (${tag})`,
    country_code: 'AE',
    currency: 'AED',
    base_currency: 'AED',
  });
  if (companyErr) throw new Error(`company insert failed: ${companyErr.message}`);

  // 3. Insert the profile linking auth user to the company.
  const { error: profileErr } = await ADMIN.from('profiles').insert({
    id: user_id,
    company_id,
    full_name: `Tenant ${label}`,
    email,
    role: 'admin',
  });
  if (profileErr) throw new Error(`profile insert failed: ${profileErr.message}`);

  // 4. Build a regular (non-admin) client signed in as this user.
  const client = createClient<Database>(SUPABASE_URL!, PUBLISHABLE_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { error: signInErr } = await client.auth.signInWithPassword({ email, password });
  if (signInErr) throw new Error(`signIn failed: ${signInErr.message}`);

  return { id: tag, email, password, user_id, company_id, client };
}

async function teardownTenant(t: Tenant): Promise<void> {
  await t.client.auth.signOut().catch(() => undefined);
  await ADMIN.from('profiles').delete().eq('id', t.user_id);
  await ADMIN.from('companies').delete().eq('id', t.company_id);
  await ADMIN.auth.admin.deleteUser(t.user_id).catch(() => undefined);
}

describe('Phase 0 — RLS multi-tenant isolation', () => {
  let A: Tenant;
  let B: Tenant;

  beforeAll(async () => {
    // H4 P0: refuse to create/delete real users+companies against production.
    assertNotProductionTarget(SUPABASE_URL);
    A = await provisionTenant('A');
    B = await provisionTenant('B');
  });

  afterAll(async () => {
    if (A) await teardownTenant(A);
    if (B) await teardownTenant(B);
  });

  it('Tenant A sees its own company (sanity check)', async () => {
    const { data, error } = await A.client.from('companies').select('id, name');
    expect(error).toBeNull();
    expect(data).not.toBeNull();
    expect(data!.length).toBe(1);
    expect(data![0]!.id).toBe(A.company_id);
  });

  it('Tenant B sees its own company (sanity check)', async () => {
    const { data, error } = await B.client.from('companies').select('id, name');
    expect(error).toBeNull();
    expect(data!.length).toBe(1);
    expect(data![0]!.id).toBe(B.company_id);
  });

  it('Tenant A cannot see Tenant B’s company by id', async () => {
    const { data, error } = await A.client.from('companies').select('*').eq('id', B.company_id);
    expect(error).toBeNull();
    expect(data).toEqual([]);
  });

  it('Tenant B cannot see Tenant A’s company by id', async () => {
    const { data, error } = await B.client.from('companies').select('*').eq('id', A.company_id);
    expect(error).toBeNull();
    expect(data).toEqual([]);
  });

  it('Tenant A cannot UPDATE Tenant B’s company', async () => {
    const { data, error } = await A.client
      .from('companies')
      .update({ name: 'HIJACKED' })
      .eq('id', B.company_id)
      .select();
    // Either RLS rejects the write entirely (error) or the update affects 0 rows
    // (no error, but no rows returned). Both are acceptable; what's NOT acceptable
    // is the row actually changing.
    if (!error) {
      expect(data).toEqual([]);
    }
    // Confirm B's company name is untouched (verified via admin client).
    const { data: bData } = await ADMIN.from('companies').select('name').eq('id', B.company_id).single();
    expect(bData?.name).not.toBe('HIJACKED');
  });

  it('Tenant A cannot INSERT a row into Tenant B’s company_id', async () => {
    const { error } = await A.client.from('audit_logs').insert({
      company_id: B.company_id,
      action: 'create',
      entity_type: 'invoice',
    });
    // RLS WITH CHECK should reject this insert.
    expect(error).not.toBeNull();
  });
});
