/**
 * useShortcutAction — let an editor page register a context action that the
 * global manager invokes on the matching shortcut (Phase 1).
 *
 *   useShortcutAction('save', () => saveMutation.mutate(), !saveMutation.isPending);
 *
 * The handler is kept in a ref so re-registration isn't needed every render;
 * pass `enabled=false` to temporarily unregister (e.g. while saving / in view
 * mode). Auto-unregisters on unmount.
 */
import { useEffect, useRef } from 'react';
import { useShortcutContext, type ShortcutActionId } from './shortcut-registry';

export function useShortcutAction(id: ShortcutActionId, handler: () => void, enabled = true) {
  const { registerAction } = useShortcutContext();
  const handlerRef = useRef(handler);
  handlerRef.current = handler;

  useEffect(() => {
    if (!enabled) return;
    const unregister = registerAction(id, () => handlerRef.current());
    return unregister;
  }, [id, enabled, registerAction]);
}
