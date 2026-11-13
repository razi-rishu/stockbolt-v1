import { create } from 'zustand';

/**
 * UI-only layout state shared between the app shell and pages (no business
 * data — AGENTS.md 7.4).
 *
 * `innerNavCount` counts the inner side menus currently on screen (the
 * Settings rail, the new-product step rail…). While it is above zero the
 * website shell collapses its own main sidebar, so two side menus never
 * stand next to each other. Pages register through `useInnerNav()`.
 */
interface UiLayoutState {
  innerNavCount: number;
  /** Register one inner side menu; returns the matching unregister. */
  registerInnerNav: () => () => void;
}

export const useUiLayoutStore = create<UiLayoutState>((set) => ({
  innerNavCount: 0,
  registerInnerNav: () => {
    set((s) => ({ innerNavCount: s.innerNavCount + 1 }));
    let done = false;
    return () => {
      if (done) return;
      done = true;
      set((s) => ({ innerNavCount: Math.max(0, s.innerNavCount - 1) }));
    };
  },
}));
