/**
 * AddNewButton — single source of truth for the "+ Add new …" affordance
 * shown inside picker dropdowns / empty states.
 *
 * Used by both SearchableSelect (via its `addNew` prop) and SmartEntitySearch
 * (via its `emptyState` callback) so the affordance looks identical no matter
 * which picker the user is interacting with.
 *
 * Visual contract (Phase 12.43):
 *   - 8px 12px padding
 *   - 12px medium-weight indigo-700 text
 *   - 16px solid indigo circle with white "+" glyph
 *   - hover background: indigo-50
 *   - when a query is supplied, label reads:  Add new <noun> "<query>"
 */
import type { CSSProperties } from 'react';

interface AddNewButtonProps {
  /** Singular noun shown in the label, e.g. "product", "customer". */
  noun: string;
  /** Current search query (may be empty). When set, shown in quotes. */
  query?: string;
  /** Click handler — receives the query so the modal can pre-seed itself. */
  onClick: (query: string) => void;
  /** Optional style overrides (e.g. width). */
  style?: CSSProperties;
}

export function AddNewButton({ noun, query = '', onClick, style }: AddNewButtonProps) {
  const trimmed = query.trim();
  return (
    <button
      type="button"
      onMouseDown={(e) => {
        // mouseDown so we beat any outside-click handler when this lives
        // inside a portaled dropdown panel.
        e.preventDefault();
        onClick(query);
      }}
      style={{
        width: '100%',
        display: 'flex',
        alignItems: 'center',
        gap: '8px',
        padding: '8px 12px',
        fontSize: '12px',
        fontWeight: 600,
        color: '#4338ca',
        background: 'transparent',
        border: 'none',
        cursor: 'pointer',
        textAlign: 'start',
        ...style,
      }}
      onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = '#eef2ff'; }}
      onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = 'transparent'; }}
    >
      <span style={{
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        width: '16px',
        height: '16px',
        borderRadius: '999px',
        background: '#6366f1',
        color: '#fff',
        fontSize: '11px',
        lineHeight: 1,
        flexShrink: 0,
      }}>+</span>
      <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
        Add new {noun}{trimmed ? ` "${trimmed}"` : ''}
      </span>
    </button>
  );
}
