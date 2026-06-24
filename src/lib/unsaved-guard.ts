/**
 * Tiny app-wide "there are unsaved edits" flag (Phase 27).
 *
 * The editors already track a local `dirty` boolean via useUnsavedChangesGuard.
 * That hook now also mirrors it here so a single global click-interceptor
 * (UnsavedNavGuard) can warn before ANY in-app navigation — nav-bar items,
 * breadcrumbs, any <Link> — not just the editor's own Back/Cancel buttons.
 *
 * Plain module (not a React store): the interceptor reads it imperatively on
 * each click, so no re-render/subscription is needed.
 */
let _dirty = false;

export const unsavedGuard = {
  setDirty(d: boolean) { _dirty = d; },
  isDirty(): boolean { return _dirty; },
};
