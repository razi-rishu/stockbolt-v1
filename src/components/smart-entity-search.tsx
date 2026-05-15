import { useState, useEffect, useRef, useCallback, useMemo, type ReactNode } from 'react';
import {
  useFloating,
  autoUpdate,
  flip,
  shift,
  offset,
  size as floatingSize,
  FloatingPortal,
} from '@floating-ui/react';
import { Z } from '@/ui/z-index';

/**
 * SmartEntitySearch — reusable ERP-grade combobox.
 *
 * Generic over T. Used for products / customers / suppliers / warehouses /
 * accounts. Replaces preload-everything dropdowns with server-side
 * debounced search and rich-list rendering.
 *
 * Phase D5 — Floating panel via @floating-ui/react.
 *   The dropdown is rendered through a FloatingPortal so it NEVER affects
 *   document flow. Inside an invoice line-item cell the row height stays
 *   fixed; inside a card with overflow:hidden the panel still appears
 *   above; inside a modal the panel layers correctly via z-index tokens.
 *
 *   Position is computed by floating-ui's `autoUpdate`, which correctly
 *   handles every edge case the hand-rolled version got wrong: nested
 *   scrollable ancestors (`<main className="overflow-y-auto">`), CSS
 *   transform/filter ancestors that break `position: fixed`, browser zoom,
 *   fractional pixels, and viewport resize. `flip()` auto-flips when space
 *   below is tight; `shift()` keeps the panel on screen horizontally;
 *   `size()` matches the panel width to the trigger (with a min floor).
 *
 *   Width defaults to max(triggerWidth, 320px); consumer can override
 *   via panelWidth or panelMinWidth.
 *
 * Behaviour:
 *   - 250ms debounce on keystrokes (stale-token race protection)
 *   - Min 1 char triggers a search
 *   - Empty query shows recent picks (localStorage)
 *   - Keyboard: ↑/↓ navigate, Enter selects, Esc closes, Tab moves on
 *   - Mouse: hover highlights, click selects
 *   - Caller controls row rendering (renderRow prop)
 *   - Caller can pass emptyState (Quick Create slot)
 *
 * ERP integrity: returns the same id the old dropdown did. Confirm RPCs,
 * allocations, inventory writes — all unchanged.
 */

export interface SmartEntitySearchProps<T> {
  /** Currently-selected id (controlled). null/empty = nothing selected. */
  value: string | null | undefined;
  /** Called when user picks a row OR clears. row=null when cleared. */
  onChange: (id: string | null, row: T | null) => void;
  /** Async search function. Should be debounced internally? No — component handles debouncing. */
  search: (query: string) => Promise<T[]>;
  /**
   * Optional resolver for value→row when the picker mounts with a value
   * but the user hasn't searched yet. Without this the input shows
   * "—" until the row is loaded; with it the label appears immediately.
   * Typically calls adapter.products.getById or similar.
   */
  resolveById?: (id: string) => Promise<T | null>;
  /** How to render each row in the dropdown list. */
  renderRow: (row: T, opts: { highlighted: boolean; query: string }) => ReactNode;
  /** How to render the SELECTED row's label inside the input when closed. */
  getDisplayLabel: (row: T) => string;
  /** Unique key for each row (usually id). Defaults to (row as any).id. */
  getKey?: (row: T) => string;
  /** Placeholder when no value picked. */
  placeholder?: string;
  /** Disable interaction. */
  disabled?: boolean;
  /** Optional element rendered when search produced 0 results. Use for Quick Create CTA. */
  emptyState?: (query: string) => ReactNode;
  /**
   * Optional localStorage key for "recent picks". Per company is the
   * caller's responsibility (suffix the company id). When provided, recent
   * rows show first when the dropdown opens before the user types.
   */
  recentKey?: string;
  /** Max number of recent items to keep. Default 5. */
  recentLimit?: number;
  /**
   * Dropdown panel width (CSS px). When omitted (default), the panel
   * auto-sizes to max(inputWidth, panelMinWidth). Pass an explicit number
   * when a fixed width is required (e.g. very narrow line-item cells where
   * the panel should still show product details legibly).
   */
  panelWidth?: number;
  /** Minimum auto-width floor when panelWidth is omitted. Default 320. */
  panelMinWidth?: number;
  /** Debounce in ms. Default 250. */
  debounceMs?: number;
  /** Min chars to trigger a search. Default 1. */
  minChars?: number;
  /**
   * Barcode auto-select. When enabled and the search returns exactly ONE
   * result whose `match_rank` is ≥ this threshold AND the query length is
   * ≥ minQueryLen, the result is auto-picked and the dropdown closes.
   *
   * Use the rank threshold 2.0 (set by search_products RPC for exact
   * barcode match). minQueryLen prevents premature auto-pick while typing.
   *
   * Pass undefined to disable. T must expose match_rank for this to work.
   */
  autoPickOnExact?: {
    rankAtLeast: number;
    minQueryLen: number;
    getRank: (row: T) => number;
  };
}

interface RecentEntry<T> {
  id:        string;
  row:       T;
  picked_at: number;
}

export function SmartEntitySearch<T>(props: SmartEntitySearchProps<T>) {
  const {
    value,
    onChange,
    search,
    resolveById,
    renderRow,
    getDisplayLabel,
    getKey: getKeyProp,
    placeholder = 'Search…',
    disabled = false,
    emptyState,
    recentKey,
    recentLimit = 5,
    panelWidth,
    panelMinWidth = 320,
    debounceMs = 250,
    minChars = 1,
    autoPickOnExact,
  } = props;

  const getKey = useCallback(
    (row: T) => (getKeyProp ? getKeyProp(row) : (row as unknown as { id: string }).id),
    [getKeyProp],
  );

  // ── State ─────────────────────────────────────────────────────────────
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<T[]>([]);
  const [loading, setLoading] = useState(false);
  const [highlighted, setHighlighted] = useState(0);
  const [selectedRow, setSelectedRow] = useState<T | null>(null);
  const [recent, setRecent] = useState<RecentEntry<T>[]>([]);

  const inputRef    = useRef<HTMLInputElement>(null);
  const reqToken    = useRef(0); // stale-token to ignore late responses

  // ── Floating-UI positioning ──────────────────────────────────────────
  // `useFloating` returns a ref for the trigger (refs.setReference) and
  // for the floating panel (refs.setFloating), plus `floatingStyles` that
  // already contains the correct top/left/position values. `autoUpdate`
  // wires up listeners for every scrollable ancestor, resize, transform
  // change, etc., so the panel stays glued to the trigger no matter what.
  const [floatingWidth, setFloatingWidth] = useState<number | undefined>(undefined);
  const { refs, floatingStyles } = useFloating({
    open,
    onOpenChange: setOpen,
    placement: 'bottom-start',
    whileElementsMounted: autoUpdate,
    middleware: [
      offset(4),
      flip({ padding: 8 }),
      shift({ padding: 8 }),
      floatingSize({
        apply({ rects }) {
          // Width = explicit override, else max(trigger, min floor).
          const w = panelWidth ?? Math.max(rects.reference.width, panelMinWidth);
          setFloatingWidth(w);
        },
      }),
    ],
  });
  const containerRef = refs.setReference;
  const panelRef     = refs.setFloating;

  // pickRow used by the search effect for auto-pick — declared below.
  // We forward via ref so the effect doesn't need to depend on it.
  const pickRowRef  = useRef<(row: T) => void>(() => { /* set below */ });

  // ── Load recent picks on mount ────────────────────────────────────────
  useEffect(() => {
    if (!recentKey) return;
    try {
      const raw = localStorage.getItem(recentKey);
      if (!raw) return;
      const parsed = JSON.parse(raw) as RecentEntry<T>[];
      if (Array.isArray(parsed)) setRecent(parsed);
    } catch { /* ignore corrupt JSON */ }
  }, [recentKey]);

  // ── Resolve initial value (if not in recent / results) ────────────────
  useEffect(() => {
    if (!value) { setSelectedRow(null); return undefined; }
    // Already known via state or recent
    if (selectedRow && getKey(selectedRow) === value) return undefined;
    const inRecent = recent.find(r => r.id === value);
    if (inRecent) { setSelectedRow(inRecent.row); return undefined; }
    // Fall back to resolveById
    if (resolveById) {
      let cancelled = false;
      resolveById(value).then(row => {
        if (!cancelled && row) setSelectedRow(row);
      }).catch(() => { /* ignore — display will fall back to id slice */ });
      return () => { cancelled = true; };
    }
    return undefined;
  }, [value, recent, resolveById, getKey, selectedRow]);

  // ── Debounced search ──────────────────────────────────────────────────
  useEffect(() => {
    if (!open) return;
    const trimmed = query.trim();
    // Empty query → show recent (no search call)
    if (trimmed.length < minChars) {
      setResults([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    const myToken = ++reqToken.current;
    const t = setTimeout(() => {
      search(trimmed)
        .then(rows => {
          if (myToken !== reqToken.current) return; // stale — ignore
          // Barcode auto-pick: exactly one row whose rank is "exact match"
          // AND the user typed enough chars to look like a barcode scan.
          if (
            autoPickOnExact
            && rows.length === 1
            && trimmed.length >= autoPickOnExact.minQueryLen
            && autoPickOnExact.getRank(rows[0]) >= autoPickOnExact.rankAtLeast
          ) {
            pickRowRef.current(rows[0]);
            return;
          }
          setResults(rows);
          setHighlighted(0);
          setLoading(false);
        })
        .catch(() => {
          if (myToken !== reqToken.current) return;
          setResults([]);
          setLoading(false);
        });
    }, debounceMs);
    return () => clearTimeout(t);
  }, [query, open, search, debounceMs, minChars]);

  // ── Outside click to close ────────────────────────────────────────────
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      const target = e.target as Node;
      const inContainer = refs.reference.current instanceof Element
        && refs.reference.current.contains(target);
      const inPanel     = refs.floating.current?.contains(target);
      if (!inContainer && !inPanel) {
        setOpen(false);
        setQuery('');
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open, refs.reference, refs.floating]);

  // ── Visible list — search results OR recent ──────────────────────────
  const visibleRows: T[] = useMemo(() => {
    if (query.trim().length >= minChars) return results;
    return recent.map(r => r.row);
  }, [query, results, recent, minChars]);

  const isShowingRecent = query.trim().length < minChars && recent.length > 0;

  // ── Pick a row ────────────────────────────────────────────────────────
  const pickRow = useCallback((row: T) => {
    const id = getKey(row);
    setSelectedRow(row);
    setOpen(false);
    setQuery('');
    onChange(id, row);

    // Update recent
    if (recentKey) {
      setRecent(prev => {
        const next = [
          { id, row, picked_at: Date.now() },
          ...prev.filter(r => r.id !== id),
        ].slice(0, recentLimit);
        try { localStorage.setItem(recentKey, JSON.stringify(next)); } catch { /* quota */ }
        return next;
      });
    }
  }, [getKey, onChange, recentKey, recentLimit]);

  // Keep ref in sync so the search effect can call latest pickRow without
  // re-triggering on every callback identity change.
  useEffect(() => { pickRowRef.current = pickRow; }, [pickRow]);

  // ── Clear selection ───────────────────────────────────────────────────
  const clearSelection = useCallback(() => {
    setSelectedRow(null);
    setQuery('');
    onChange(null, null);
    inputRef.current?.focus();
  }, [onChange]);

  // ── Keyboard nav ──────────────────────────────────────────────────────
  const onKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (!open) setOpen(true);
      else setHighlighted(h => Math.min(h + 1, Math.max(0, visibleRows.length - 1)));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setHighlighted(h => Math.max(0, h - 1));
    } else if (e.key === 'Enter') {
      if (!open) return;
      e.preventDefault();
      const row = visibleRows[highlighted];
      if (row) pickRow(row);
    } else if (e.key === 'Escape') {
      if (open) { e.preventDefault(); setOpen(false); setQuery(''); }
    }
  }, [open, visibleRows, highlighted, pickRow]);

  // ── Render ────────────────────────────────────────────────────────────
  return (
    <div ref={containerRef} className="relative">
      {/* Closed state: show selected label as text + clear button.
           Open state: text input.
           Plain text-input look (no chrome-bordered "button" feel) —
           matches modern ERP convention. Clear (×) is inline-right. */}
      {!open ? (
        <div
          className={`relative w-full ${disabled ? 'opacity-60 pointer-events-none' : ''}`}
        >
          <input
            type="text"
            readOnly
            value={selectedRow ? getDisplayLabel(selectedRow) : ''}
            placeholder={placeholder}
            onClick={() => { setOpen(true); setTimeout(() => inputRef.current?.focus(), 0); }}
            onFocus={() => { setOpen(true); setTimeout(() => inputRef.current?.focus(), 0); }}
            className="w-full rounded-md border border-border-strong bg-surface-card px-3 py-1.5 text-xs text-ink-primary placeholder:text-ink-tertiary hover:border-brand-300 focus:border-brand-400 focus:outline-none focus:ring-1 focus:ring-brand-200 cursor-pointer"
          />
          {selectedRow && !disabled && (
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); clearSelection(); }}
              className="absolute end-2 top-1/2 -translate-y-1/2 text-ink-tertiary hover:text-red-500"
              aria-label="Clear selection"
            >×</button>
          )}
        </div>
      ) : (
        <input
          ref={inputRef}
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder={placeholder}
          className="w-full rounded-md border border-brand-400 bg-surface-card px-3 py-1.5 text-xs text-ink-primary placeholder:text-ink-tertiary focus:outline-none focus:ring-2 focus:ring-brand-200"
          autoComplete="off"
          autoCorrect="off"
          autoCapitalize="off"
          spellCheck={false}
        />
      )}

      {/* Dropdown panel — positioned by @floating-ui/react and rendered
           through FloatingPortal. The library wires up listeners for every
           scrollable ancestor, transform ancestor, resize, etc., so the
           panel stays glued to the trigger no matter what. */}
      {open && (
      <FloatingPortal>
        <div
          ref={panelRef}
          className="overflow-hidden rounded-lg border border-border-subtle bg-surface-card shadow-2xl"
          style={{
            ...floatingStyles,
            width:    floatingWidth,
            zIndex:   Z.dropdown,
          }}
        >
          <div className="max-h-[420px] overflow-y-auto">
            {/* Subtle header label — only shown when there's results context to label */}
            {(isShowingRecent || loading) && (
              <div className="sticky top-0 z-10 border-b border-border-subtle bg-surface-card px-4 py-2 text-[10px] uppercase tracking-wide text-ink-tertiary">
                {loading ? 'Searching…' : 'Recent'}
              </div>
            )}

            {/* Results */}
            {visibleRows.length > 0 ? (
              <ul className="py-1">
                {visibleRows.map((row, i) => {
                  const k = getKey(row);
                  const isHi = i === highlighted;
                  return (
                    <li
                      key={k}
                      onMouseEnter={() => setHighlighted(i)}
                      onMouseDown={(e) => { e.preventDefault(); pickRow(row); }}
                      className={`cursor-pointer px-4 py-2.5 transition-colors ${isHi ? 'bg-brand-500 text-white' : 'hover:bg-surface-muted text-ink-primary'}`}
                    >
                      {renderRow(row, { highlighted: isHi, query })}
                    </li>
                  );
                })}
              </ul>
            ) : !loading && query.trim().length >= minChars ? (
              <div className="px-4 py-6 text-center text-xs text-ink-tertiary">
                No results for "{query}"
              </div>
            ) : !loading && query.trim().length < minChars && recent.length === 0 ? (
              <div className="px-4 py-6 text-center text-xs text-ink-tertiary">
                Start typing to search…
              </div>
            ) : null}
          </div>

          {/* Persistent footer — Quick Create always available when the
               caller passes an emptyState slot. Single click whether the
               list is empty or full. */}
          {emptyState && (
            <div className="border-t border-border-subtle bg-surface-muted/40 px-4 py-2">
              {emptyState(query)}
            </div>
          )}
        </div>
      </FloatingPortal>
      )}
    </div>
  );
}

/**
 * Helper: highlight matching substring in a string. Returns ReactNode array
 * with <mark> wrapping the match. Case-insensitive.
 */
export function highlightMatch(text: string | null | undefined, query: string): ReactNode {
  if (!text) return null;
  if (!query.trim()) return text;
  const q = query.trim();
  const lower = text.toLowerCase();
  const idx = lower.indexOf(q.toLowerCase());
  if (idx < 0) return text;
  return (
    <>
      {text.slice(0, idx)}
      <mark className="bg-amber-100 text-ink-primary px-0.5 rounded-sm">{text.slice(idx, idx + q.length)}</mark>
      {text.slice(idx + q.length)}
    </>
  );
}
