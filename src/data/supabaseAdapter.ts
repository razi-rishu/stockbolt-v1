import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/types/database';
import type { DataAdapter, Company, Profile } from './adapter';
import { getSupabaseClient } from './supabase-client';

class SupabaseAuthError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SupabaseAuthError';
  }
}

class SupabaseDataError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SupabaseDataError';
  }
}

export function createSupabaseAdapter(
  client: SupabaseClient<Database> = getSupabaseClient(),
): DataAdapter {
  return {
    auth: {
      async signUp({ email, password }) {
        const { data, error } = await client.auth.signUp({ email, password });
        if (error) throw new SupabaseAuthError(error.message);
        if (!data.user) throw new SupabaseAuthError('signUp returned no user');
        return { user_id: data.user.id };
      },

      async signIn({ email, password }) {
        const { data, error } = await client.auth.signInWithPassword({ email, password });
        if (error) throw new SupabaseAuthError(error.message);
        if (!data.user) throw new SupabaseAuthError('signIn returned no user');
        return { user_id: data.user.id };
      },

      async signOut() {
        const { error } = await client.auth.signOut();
        if (error) throw new SupabaseAuthError(error.message);
      },

      async getCurrentUserId() {
        const { data } = await client.auth.getUser();
        return data.user?.id ?? null;
      },
    },

    companies: {
      async list(): Promise<Company[]> {
        const { data, error } = await client.from('companies').select('*');
        if (error) throw new SupabaseDataError(error.message);
        return data ?? [];
      },

      async getById(id): Promise<Company | null> {
        const { data, error } = await client
          .from('companies')
          .select('*')
          .eq('id', id)
          .maybeSingle();
        if (error) throw new SupabaseDataError(error.message);
        return data;
      },
    },

    profiles: {
      async getCurrent(): Promise<Profile | null> {
        const { data: userData } = await client.auth.getUser();
        const userId = userData.user?.id;
        if (!userId) return null;
        const { data, error } = await client
          .from('profiles')
          .select('*')
          .eq('id', userId)
          .maybeSingle();
        if (error) throw new SupabaseDataError(error.message);
        return data;
      },
    },
  };
}
