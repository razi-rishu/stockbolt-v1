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
      // Only persist language preference; auth state is managed by Supabase session
      partialize: (s) => ({ language: s.language }),
    },
  ),
);
