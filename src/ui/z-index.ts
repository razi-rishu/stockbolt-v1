/**
 * Z-index layering tokens — single source of truth.
 *
 * Avoid hardcoding z-index numbers anywhere else. Pick a token from here
 * so the layering relationship stays consistent across the entire app:
 *
 *   base       — normal document flow
 *   raised     — cards, callouts that sit slightly above the page
 *   sticky     — sticky sidebars, table headers, app top-nav
 *   dropdown   — floating overlays: SmartEntitySearch panel, autocomplete,
 *                date pickers. Must sit above sticky elements.
 *   modal      — dialogs, full-screen overlays
 *   notification — toasts, alerts, things that should appear over modals
 *
 * Charter (Phase D5): all dropdown panels use Z.dropdown so they reliably
 * overlay sticky sidebars (Z.sticky) without competing with modals
 * (Z.modal) or notifications (Z.notification).
 */
export const Z = {
  base:         1,
  raised:       10,
  sticky:       50,
  dropdown:     1000,
  modal:        2000,
  notification: 3000,
} as const;

export type ZLayer = keyof typeof Z;
