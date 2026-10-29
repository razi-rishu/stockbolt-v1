import type { CapacitorConfig } from '@capacitor/cli';

/**
 * StockBolt Android shell. The APK bundles the same React build as
 * stockbolt.online and talks to the same Supabase project, so web and app
 * share one login and one set of records.
 */
const config: CapacitorConfig = {
  appId: 'online.stockbolt.app',
  appName: 'StockBolt',
  webDir: 'dist',
  android: {
    allowMixedContent: false,
  },
};

export default config;
