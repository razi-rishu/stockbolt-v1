import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/types/database';
import { env } from '@/lib/env';

let _client: SupabaseClient<Database> | null = null;

/**
 * phase155 — tells the database this app understands packs (2 BOX = 24 PCS).
 * Without it, editing a document that has pack lines is refused: an older app
 * would save them back as single pieces. Table requests only — the auth,
 * storage and function endpoints have their own lists of allowed headers.
 */
export const UNITS_HEADER = 'x-stockbolt-units';

export function unitsAwareFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const url = input instanceof Request ? input.url : String(input);
  if (!url.startsWith(`${env.supabase_url.replace(/\/$/, '')}/rest/v1/`)) return fetch(input, init);
  const headers = new Headers(init?.headers ?? (input instanceof Request ? input.headers : undefined));
  headers.set(UNITS_HEADER, '1');
  return fetch(input, { ...init, headers });
}

export function getSupabaseClient(): SupabaseClient<Database> {
  if (!_client) {
    _client = createClient<Database>(env.supabase_url, env.supabase_publishable_key, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
      },
      global: { fetch: unitsAwareFetch },
    });
  }
  return _client;
}
