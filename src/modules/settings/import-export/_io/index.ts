/**
 * Format-agnostic IO primitives for the import/export wizard.
 *
 * The implementation moved to `src/lib/io-export.ts` (Phase 46b) so shared
 * UI (report Export buttons) can reuse the download helpers without reaching
 * into this module's private folder. This file re-exports everything so the
 * import/export wizard's existing imports (`./_io`, `../_io`) keep working.
 */
export * from '@/lib/io-export';
