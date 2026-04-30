import { env } from '@/lib/env';
import type { DataAdapter } from './adapter';
import { createSupabaseAdapter } from './supabaseAdapter';
import { createSelfHostedAdapter } from './selfHostedAdapter';

let _adapter: DataAdapter | null = null;

/**
 * Returns the active DataAdapter for the current deployment mode.
 * UI / business code must use this — never import `@supabase/supabase-js`
 * directly (AGENTS.md §7.3).
 */
export function getAdapter(): DataAdapter {
  if (!_adapter) {
    _adapter =
      env.deployment_mode === 'self_hosted'
        ? createSelfHostedAdapter()
        : createSupabaseAdapter();
  }
  return _adapter;
}

export type { DataAdapter, Company, Profile } from './adapter';
