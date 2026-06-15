/**
 * Shared design tokens — Phase 12.30.
 *
 * Adopted from the user-provided InventoryItemForm.jsx sample so the rest
 * of the ERP can re-use the same indigo-accent / soft-grey / inline-CSS
 * look that the product wizard already wears. Every new module-level
 * primitive should reach for these constants instead of hard-coding hex.
 */

export const theme = {
  // Brand & accent — violet
  brand: '#7c3aed',          // violet-600
  brandDeep: '#6d28d9',      // violet-700 (hover / active)
  brandSoft: '#f5f3ff',      // violet-50 (chip fill / hover bg)
  brandSoftText: '#5b21b6',  // violet-800 (chip text)
  brandRing: 'rgba(124,58,237,.10)', // focus ring
  brandGradient: 'linear-gradient(90deg, #7c3aed, #a78bfa)', // top progress bar

  // Surfaces
  page:       '#f8fafc',     // slate-50  — page bg
  card:       '#ffffff',     // surface card
  muted:      '#f1f5f9',     // slate-100 — hover / chip
  panelHead:  '#f8fafc',     // slate-50  — panel header strip

  // Text
  ink:        '#1e293b',     // slate-900 (primary text)
  inkMuted:   '#64748b',     // slate-500 (secondary text / labels)
  inkFaint:   '#94a3b8',     // slate-400 (placeholder / tertiary)

  // Borders
  border:     '#e2e8f0',     // slate-200
  borderStrong: '#cbd5e1',   // slate-300

  // Status
  success:    '#15803d',
  successSoft:'#f0fdf4',
  successBorder:'#bbf7d0',
  warn:       '#b45309',
  warnSoft:   '#fffbeb',
  warnBorder: '#fde68a',
  danger:     '#dc2626',
  dangerSoft: '#fef2f2',
  dangerBorder:'#fecaca',
  info:       '#1d4ed8',
  infoSoft:   '#eff6ff',
  infoBorder: '#bfdbfe',
  purple:     '#6d28d9',
  purpleSoft: '#f5f3ff',
  purpleBorder:'#ddd6fe',

  // Radii
  radius:     '7px',
  radiusLg:   '12px',
  radiusXl:   '16px',
  radiusPill: '999px',

  // Shadows
  shadowSm:   '0 1px 2px rgba(15,23,42,.04)',
  shadowMd:   '0 2px 8px rgba(15,23,42,.06)',
  shadowLg:   '0 10px 30px rgba(15,23,42,.10)',

  // Typography
  font:       '"Inter", system-ui, -apple-system, "Segoe UI", sans-serif',
  fontMono:   '"JetBrains Mono", ui-monospace, SFMono-Regular, Menlo, monospace',
  fontXs:     '11px',
  fontSm:     '12px',
  fontBase:   '13px',
  fontMd:     '14px',
  fontLg:     '16px',

  // Spacing
  gap2: '4px',
  gap3: '8px',
  gap4: '12px',
  gap5: '16px',
  gap6: '24px',
} as const;

/** Base style for text inputs / selects / textareas. Apply focus ring on top. */
export const inputBaseStyle: React.CSSProperties = {
  width: '100%',
  padding: '8px 10px',
  fontSize: theme.fontBase,
  border: `1px solid ${theme.border}`,
  borderRadius: theme.radius,
  background: '#fff',
  color: theme.ink,
  outline: 'none',
  transition: 'border-color .15s, box-shadow .15s',
  fontFamily: theme.font,
};

/** Tiny uppercase label that sits above wizard / form fields. */
export const labelStyle: React.CSSProperties = {
  fontSize: theme.fontXs,
  fontWeight: 600,
  color: theme.inkMuted,
  textTransform: 'uppercase',
  letterSpacing: '.05em',
  marginBottom: '4px',
  display: 'flex',
  gap: '3px',
  alignItems: 'center',
};

/** Style to merge into an input/select/textarea on focus. */
export function focusRing(focused: boolean): React.CSSProperties {
  return focused
    ? { borderColor: theme.brand, boxShadow: `0 0 0 3px ${theme.brandRing}` }
    : {};
}
