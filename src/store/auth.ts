import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { Language } from '@/i18n/config';

interface AuthState {
  user_id: string | null;
  email: string | null;
  company_id: string | null;
  role: string | null;
  is_onboarded: boolean;
  language: Language;

  set_session(params: { user_id: string; email: string }): void;
  set_profile(params: { company_id: string; role: string }): void;
  set_onboarded(value: boolean): void;
  set_language(lang: Language): void;
  clear(): void;
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set) => ({
      user_id: null,
      email: null,
      company_id: null,
      role: null,
      is_onboarded: false,
      language: 'en',

      set_session: ({ user_id, email }) => set({ user_id, email }),
      set_profile: ({ company_id, role }) => set({ company_id, role }),
      set_onboarded: (is_onboarded) => set({ is_onboarded }),
      set_language: (language) => set({ language }),

      clear: () =>
        set({
          user_id: null,
          email: null,
          company_id: null,
          role: null,
          is_onboarded: false,
        }),
    }),
    {
      name: 'stockbolt-ui',
      // Phase 14.12b — persist auth state (not just language). Previously
      // only `language` was persisted; on every refresh the store reset
      // to its defaults (is_onboarded=false, company_id=null, etc.) and
      // we relied on useAuthInit's async bootstrap to restore them from
      // the Supabase session + a profiles read. If that read returned
      // null OR threw (RLS hiccup, network blip), the silent catch in
      // use-auth-init left is_onboarded=false and RequireOnboarded
      // bounced the operator to /setup — even when they were fully
      // onboarded and just hit refresh.
      //
      // We now persist the same fields Supabase already keeps in
      // localStorage (user_id, email) plus the application-side
      // identity (company_id, role, is_onboarded). The bootstrap
      // process is still authoritative: on a true sign-out the
      // onAuthStateChange handler calls clear() which wipes
      // everything from this persisted blob.
      partialize: (s) => ({
        language:    s.language,
        user_id:     s.user_id,
        email:       s.email,
        company_id:  s.company_id,
        role:        s.role,
        is_onboarded: s.is_onboarded,
      }),
    },
  ),
);
