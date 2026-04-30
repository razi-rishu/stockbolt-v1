type DeploymentMode = 'cloud' | 'self_hosted';
type Language = 'en' | 'ar';
type CountryCode = 'AE' | 'SA' | 'KW' | 'BH' | 'OM' | 'QA' | 'IN';

function required(key: keyof ImportMetaEnv): string {
  const value = import.meta.env[key];
  if (!value || typeof value !== 'string') {
    throw new Error(
      `Missing required environment variable: ${key}. ` +
        `Copy .env.example to .env.local and fill in the values.`,
    );
  }
  return value;
}

export const env = {
  deployment_mode: (import.meta.env.VITE_DEPLOYMENT_MODE ?? 'cloud') as DeploymentMode,
  supabase_url: required('VITE_SUPABASE_URL'),
  supabase_publishable_key: required('VITE_SUPABASE_PUBLISHABLE_KEY'),
  default_language: (import.meta.env.VITE_DEFAULT_LANGUAGE ?? 'en') as Language,
  default_country: (import.meta.env.VITE_DEFAULT_COUNTRY ?? 'AE') as CountryCode,
  enable_debug_panel: import.meta.env.VITE_ENABLE_DEBUG_PANEL === 'true',
} as const;
