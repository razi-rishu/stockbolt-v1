import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';

// Each production build gets an id, baked into the app and also written to
// /version.json. An open website tab polls that file: a different id means a
// newer deploy is live (src/lib/update-check.ts).
const BUILD_ID = new Date().toISOString();

function versionFile(): Plugin {
  return {
    name: 'stockbolt-version-file',
    apply: 'build',
    generateBundle() {
      this.emitFile({ type: 'asset', fileName: 'version.json', source: JSON.stringify({ build_id: BUILD_ID }) });
    },
  };
}

export default defineConfig({
  plugins: [react(), versionFile()],
  define: {
    __BUILD_ID__: JSON.stringify(BUILD_ID),
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
      '@core': path.resolve(__dirname, './src/core'),
      '@data': path.resolve(__dirname, './src/data'),
      '@modules': path.resolve(__dirname, './src/modules'),
      '@components': path.resolve(__dirname, './src/components'),
      '@ui': path.resolve(__dirname, './src/ui'),
      '@lib': path.resolve(__dirname, './src/lib'),
      '@i18n': path.resolve(__dirname, './src/i18n'),
      '@store': path.resolve(__dirname, './src/store'),
      '@types': path.resolve(__dirname, './src/types'),
    },
  },
  server: {
    port: 5173,
    open: false,
  },
  build: {
    rollupOptions: {
      output: {
        // Split rarely-changing vendor libraries into their own chunks so
        // returning browsers keep them cached across deploys — only the
        // (much smaller) app chunk changes when we ship. Route pages are
        // already lazy; recharts/xlsx/framer-motion split naturally.
        manualChunks: {
          'vendor-react': ['react', 'react-dom', 'react-router-dom'],
          'vendor-supabase': ['@supabase/supabase-js'],
          'vendor-state': ['@tanstack/react-query', 'zustand'],
          'vendor-i18n': ['i18next', 'react-i18next'],
        },
      },
    },
  },
});
