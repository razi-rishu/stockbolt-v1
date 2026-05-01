import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/types/database';
import type {
  DataAdapter,
  Company,
  Profile,
  CoaRow,
  CoaInsert,
  TaxRateInsert,
  PaymentMethodInsert,
  UnitInsert,
  WarehouseInsert,
  BankAccountInsert,
  CompanyUpdate,
  OnboardingRpcInput,
} from './adapter';
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

function assertNoError(error: { message: string } | null, context: string): void {
  if (error) throw new SupabaseDataError(`${context}: ${error.message}`);
}

export function createSupabaseAdapter(
  client: SupabaseClient<Database> = getSupabaseClient(),
): DataAdapter {
  return {
    // ── Auth ───────────────────────────────────────────────────────────────
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

      async getSession() {
        const { data } = await client.auth.getSession();
        const session = data.session;
        if (!session) return null;
        return { user_id: session.user.id, email: session.user.email ?? '' };
      },

      onAuthStateChange(callback) {
        const { data } = client.auth.onAuthStateChange((event, session) => {
          if (event === 'SIGNED_IN' || event === 'INITIAL_SESSION') {
            callback('SIGNED_IN', session?.user.id ?? null);
          } else if (event === 'SIGNED_OUT') {
            callback('SIGNED_OUT', null);
          }
        });
        return () => data.subscription.unsubscribe();
      },

      async sendPasswordResetEmail(email) {
        const { error } = await client.auth.resetPasswordForEmail(email, {
          redirectTo: `${window.location.origin}/reset-password`,
        });
        if (error) throw new SupabaseAuthError(error.message);
      },

      async updatePassword(password) {
        const { error } = await client.auth.updateUser({ password });
        if (error) throw new SupabaseAuthError(error.message);
      },
    },

    // ── Companies ──────────────────────────────────────────────────────────
    companies: {
      async list(): Promise<Company[]> {
        const { data, error } = await client.from('companies').select('*');
        assertNoError(error, 'companies.list');
        return data ?? [];
      },

      async getById(id): Promise<Company | null> {
        const { data, error } = await client
          .from('companies')
          .select('*')
          .eq('id', id)
          .maybeSingle();
        assertNoError(error, 'companies.getById');
        return data;
      },

      async update(id, data: CompanyUpdate) {
        const { error } = await client.from('companies').update(data).eq('id', id);
        assertNoError(error, 'companies.update');
      },

      async uploadLogo(company_id, file) {
        const ext = file.name.split('.').pop() ?? 'png';
        const path = `${company_id}/logo.${ext}`;
        const { error } = await client.storage
          .from('logos')
          .upload(path, file, { upsert: true, contentType: file.type });
        if (error) throw new SupabaseDataError(`uploadLogo: ${error.message}`);
        const { data } = client.storage.from('logos').getPublicUrl(path);
        return data.publicUrl;
      },
    },

    // ── Profiles ───────────────────────────────────────────────────────────
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
        assertNoError(error, 'profiles.getCurrent');
        return data;
      },
    },

    // ── Onboarding ─────────────────────────────────────────────────────────
    onboarding: {
      async createCompanyAndProfile(input: OnboardingRpcInput) {
        // complete_onboarding is a SECURITY DEFINER function added in Phase 1.
        // Types were generated after Phase 0 migrations — re-run supabase gen types
        // after db push to make this call fully typed.
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const { data, error } = await (client as any).rpc('complete_onboarding', {
          p_data: input,
        });
        if (error) throw new SupabaseDataError(`complete_onboarding: ${(error as { message: string }).message}`);
        const result = (data as unknown) as { company_id: string };
        return { company_id: result.company_id };
      },

      async insertCoaBatch(rows: CoaInsert[]): Promise<CoaRow[]> {
        const { data, error } = await client
          .from('chart_of_accounts')
          .insert(rows)
          .select();
        assertNoError(error, 'onboarding.insertCoaBatch');
        return (data ?? []) as CoaRow[];
      },

      async insertTaxRate(row: TaxRateInsert) {
        const { error } = await client.from('tax_rates').insert(row);
        assertNoError(error, 'onboarding.insertTaxRate');
      },

      async insertPaymentMethod(row: PaymentMethodInsert) {
        const { error } = await client.from('payment_methods').insert(row);
        assertNoError(error, 'onboarding.insertPaymentMethod');
      },

      async insertUnit(row: UnitInsert) {
        const { error } = await client.from('units_of_measure').insert(row);
        assertNoError(error, 'onboarding.insertUnit');
      },

      async insertWarehouse(row: WarehouseInsert) {
        const { data, error } = await client
          .from('warehouses')
          .insert(row)
          .select('id')
          .single();
        assertNoError(error, 'onboarding.insertWarehouse');
        return { id: data!.id };
      },

      async insertBankAccount(row: BankAccountInsert) {
        const { error } = await client.from('bank_accounts').insert(row);
        assertNoError(error, 'onboarding.insertBankAccount');
      },

      async getCoaByCodes(company_id, codes) {
        const { data, error } = await client
          .from('chart_of_accounts')
          .select('*')
          .eq('company_id', company_id)
          .in('code', codes);
        assertNoError(error, 'onboarding.getCoaByCodes');
        return (data ?? []) as CoaRow[];
      },
    },
  };
}
