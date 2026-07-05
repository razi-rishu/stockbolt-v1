/**
 * Supabase service-role client + caller auth for the Vercel functions (SaaS M3).
 *
 * SUPABASE_SERVICE_ROLE_KEY must ONLY exist in Vercel env (server side) —
 * never in client code or the DB. The caller's identity is proven by their
 * Supabase access token (Authorization: Bearer <jwt>), which we verify with
 * auth.getUser() before doing anything on their behalf.
 */
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

let admin: SupabaseClient | null = null;

export function getAdminClient(): SupabaseClient {
  if (admin) return admin;
  const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SECRET_KEY;
  if (!url || !key) throw new Error('Supabase env vars not configured (SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY)');
  admin = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  return admin;
}

/** Verify the caller's Supabase JWT and resolve their company. Throws on failure. */
export async function getCaller(authorization: string | undefined): Promise<{ userId: string; companyId: string }> {
  const token = authorization?.startsWith('Bearer ') ? authorization.slice(7) : null;
  if (!token) throw new Error('Missing Authorization bearer token');
  const supa = getAdminClient();
  const { data, error } = await supa.auth.getUser(token);
  if (error || !data?.user) throw new Error('Invalid or expired session');
  const { data: profile, error: pErr } = await supa
    .from('profiles').select('company_id').eq('id', data.user.id).single();
  if (pErr || !profile?.company_id) throw new Error('No company for user');
  return { userId: data.user.id, companyId: profile.company_id as string };
}
