/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_DEPLOYMENT_MODE: 'cloud' | 'self_hosted';
  readonly VITE_SUPABASE_URL: string;
  readonly VITE_SUPABASE_PUBLISHABLE_KEY: string;
  readonly VITE_DEFAULT_LANGUAGE: 'en' | 'ar';
  readonly VITE_DEFAULT_COUNTRY: 'AE' | 'SA' | 'KW' | 'BH' | 'OM' | 'QA' | 'IN';
  readonly VITE_ENABLE_DEBUG_PANEL: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
