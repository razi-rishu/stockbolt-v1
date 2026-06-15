/**
 * StatusBadge — Option B multi-color dot-badge system.
 *
 * Single source of truth for every status pill in the app.
 * Import this instead of defining inline StatusBadge functions per page.
 *
 *   import { StatusBadge } from '@/ui/status-badge';
 *   <StatusBadge status={row.status} />
 */

const palette: Record<string, { bg: string; text: string; border: string; dot: string; label?: string }> = {
  // Document lifecycle
  draft:     { bg: '#f4f4f5', text: '#71717a', border: '#d4d4d8', dot: '#a1a1aa' },
  confirmed: { bg: '#f0fdf4', text: '#15803d', border: '#bbf7d0', dot: '#16a34a' },
  posted:    { bg: '#f0fdf4', text: '#15803d', border: '#bbf7d0', dot: '#16a34a' },
  approved:  { bg: '#f0fdf4', text: '#15803d', border: '#bbf7d0', dot: '#16a34a' },
  received:  { bg: '#f0fdf4', text: '#15803d', border: '#bbf7d0', dot: '#16a34a' },
  void:      { bg: '#f4f4f5', text: '#71717a', border: '#d4d4d8', dot: '#a1a1aa' },
  voided:    { bg: '#f4f4f5', text: '#71717a', border: '#d4d4d8', dot: '#a1a1aa' },
  cancelled: { bg: '#f4f4f5', text: '#71717a', border: '#d4d4d8', dot: '#a1a1aa' },

  // Payment states
  paid:      { bg: '#f0fdf4', text: '#15803d', border: '#bbf7d0', dot: '#16a34a' },
  partial:   { bg: '#fffbeb', text: '#b45309', border: '#fde68a', dot: '#d97706' },
  overdue:   { bg: '#fff1f2', text: '#be123c', border: '#fecdd3', dot: '#be123c' },
  unpaid:    { bg: '#eff6ff', text: '#1d4ed8', border: '#bfdbfe', dot: '#2563eb' },

  // Inventory / purchasing
  open:      { bg: '#eff6ff', text: '#1d4ed8', border: '#bfdbfe', dot: '#2563eb' },
  closed:    { bg: '#f0fdf4', text: '#15803d', border: '#bbf7d0', dot: '#16a34a' },
  pending:   { bg: '#fffbeb', text: '#b45309', border: '#fde68a', dot: '#d97706' },
  partial_received: { bg: '#fffbeb', text: '#b45309', border: '#fde68a', dot: '#d97706', label: 'Partial' },

  // Banking
  reconciled:   { bg: '#f0fdf4', text: '#15803d', border: '#bbf7d0', dot: '#16a34a' },
  unreconciled: { bg: '#fffbeb', text: '#b45309', border: '#fde68a', dot: '#d97706' },
  cleared:      { bg: '#f0fdf4', text: '#15803d', border: '#bbf7d0', dot: '#16a34a' },
  bounced:      { bg: '#fff1f2', text: '#be123c', border: '#fecdd3', dot: '#be123c' },

  // Boolean-ish
  active:   { bg: '#f0fdf4', text: '#15803d', border: '#bbf7d0', dot: '#16a34a' },
  inactive: { bg: '#f4f4f5', text: '#71717a', border: '#d4d4d8', dot: '#a1a1aa' },
};

const DEFAULT = { bg: '#f4f4f5', text: '#71717a', border: '#d4d4d8', dot: '#a1a1aa' };

export function StatusBadge({ status }: { status: string }) {
  const key = (status ?? '').toLowerCase().replace(/\s+/g, '_');
  const p = palette[key] ?? DEFAULT;
  const label = p.label ?? (status.charAt(0).toUpperCase() + status.slice(1).replace(/_/g, ' '));
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: '5px',
      padding: '3px 9px', borderRadius: '999px',
      fontSize: '11px', fontWeight: 600,
      background: p.bg, color: p.text, border: `1px solid ${p.border}`,
      whiteSpace: 'nowrap',
    }}>
      <span style={{ width: '5px', height: '5px', borderRadius: '50%', background: p.dot, flexShrink: 0 }} />
      {label}
    </span>
  );
}
