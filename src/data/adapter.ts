import type { Database } from '@/types/database';

type Tables = Database['public']['Tables'];
export type Company = Tables['companies']['Row'];
export type Profile = Tables['profiles']['Row'];

export interface AuthAPI {
  signUp(params: { email: string; password: string }): Promise<{ user_id: string }>;
  signIn(params: { email: string; password: string }): Promise<{ user_id: string }>;
  signOut(): Promise<void>;
  getCurrentUserId(): Promise<string | null>;
}

export interface CompaniesAPI {
  list(): Promise<Company[]>;
  getById(id: string): Promise<Company | null>;
}

export interface ProfilesAPI {
  getCurrent(): Promise<Profile | null>;
}

/**
 * The single seam between UI/business code and the data backend.
 * Per AGENTS.md §7.3: UI components must import from this interface,
 * never `@supabase/supabase-js` directly.
 *
 * Phase 0 ships only the surface needed for the RLS verification test
 * (auth + minimal companies/profiles read). Subsequent phases extend
 * this interface with module-specific APIs.
 */
export interface DataAdapter {
  auth: AuthAPI;
  companies: CompaniesAPI;
  profiles: ProfilesAPI;
}
