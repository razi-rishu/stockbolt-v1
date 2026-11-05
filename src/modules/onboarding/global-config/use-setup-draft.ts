/**
 * Global v1 Phase 7 — save and resume for the setup wizard.
 *
 * Loads the signed-in user's draft once and saves it again shortly after each
 * change. A draft is wizard input only (setup_drafts, global04): nothing in it
 * is a business record, and activation stays an explicit step that the server
 * re-validates. A failed draft save never blocks the wizard — the user just
 * loses resume for that change — so errors are logged, not shown.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { getAdapter } from '@/data/index';
import type { SetupDraftKind, SetupDraftRow } from '@/data/adapter';

const DELAY_MS = 800;

export function useSetupDraft(kind: SetupDraftKind, enabled = true) {
  // undefined = still loading; null = no draft.
  const [draft, setDraft] = useState<SetupDraftRow | null | undefined>(enabled ? undefined : null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!enabled) return;
    let live = true;
    getAdapter().setupDrafts.get(kind)
      .then((d) => { if (live) setDraft(d); })
      .catch((err) => { console.warn(`[setup draft] could not load the ${kind} draft:`, err); if (live) setDraft(null); });
    return () => { live = false; };
  }, [kind, enabled]);

  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);

  const saveNow = useCallback(async (step: string, payload: Record<string, unknown>, company_id: string | null = null) => {
    if (timer.current) { clearTimeout(timer.current); timer.current = null; }
    try { await getAdapter().setupDrafts.save(kind, step, payload, company_id); }
    catch (err) { console.warn(`[setup draft] could not save the ${kind} draft:`, err); }
  }, [kind]);

  /** Debounced: the last change within DELAY_MS wins. */
  const save = useCallback((step: string, payload: Record<string, unknown>, company_id: string | null = null) => {
    if (!enabled) return;
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => { void saveNow(step, payload, company_id); }, DELAY_MS);
  }, [enabled, saveNow]);

  const remove = useCallback(async () => {
    if (timer.current) { clearTimeout(timer.current); timer.current = null; }
    try { await getAdapter().setupDrafts.remove(kind); }
    catch (err) { console.warn(`[setup draft] could not remove the ${kind} draft:`, err); }
  }, [kind]);

  return { draft, loaded: draft !== undefined, save, saveNow, remove };
}
