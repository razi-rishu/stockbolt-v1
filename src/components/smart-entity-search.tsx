import { useState, useEffect, useRef, useCallback, useMemo, type ReactNode } from 'react';

/**
 * SmartEntitySearch — reusable ERP-grade combobox.
 *
 * Single component, generic over T, used for products / customers / suppliers
 * / warehouses / accounts. Replaces the preload-everything SearchableSelect
 * with a server-side debounced search and rich-list dropdown.
 *
 * Behaviour:
 *   - 250ms debounce on keystrokes (with stale-token race protection)
 *   - Min 1 char triggers a search
 *   - Empty query shows recent picks (from localStorage)
 *   - Keyboard: ↑/↓ navigate, Enter selects, Esc closes, Tab moves on
 *   - Mouse: hover highlights, click selects
 *   - Caller controls row rendering (passes renderRow) — same component
 *     can show product rows, contact rows, anything
 *   - Caller can provide an empty-state slot (typically a Quick Create
 *     button — D4)
 *
 * NOT included here (deferred):
 *   - Barcode scan auto-select (D4)
 *   - Pinned items (D4)
 *
 * ERP integrity: returns the same id the old SearchableSelect did.
 * Confirm RPCs, allocations, inventory writes — all unchanged.
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
  /** Dropdown panel width (CSS px). Default 320. */
  panelWidth?: number;
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
    panelWidth = 320,
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
  const containerRef = useRef<HTMLDivElement>(null);
  const reqToken    = useRef(0); // stale-token to ignore late responses
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
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
        setQuery('');
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

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
           Open state: show input. */}
      {!open ? (
        <button
          type="button"
          disabled={disabled}
          onClick={() => { if (!disabled) { setOpen(true); setTimeout(() => inputRef.current?.focus(), 0); } }}
          className={
            'flex w-full items-center justify-between rounded border border-border-strong bg-surface-subtle ' +
            'px-2 py-1 text-xs text-start disabled:opacity-60 hover:border-brand-300 transition-colors ' +
            (selectedRow ? 'text-ink-primary' : 'text-ink-tertiary')
          }
        >
          <span className="truncate">{selectedRow ? getDisplayLabel(selectedRow) : placeholder}</span>
          {selectedRow && !disabled ? (
            <span
              onClick={(e) => { e.stopPropagation(); clearSelection(); }}
              className="ms-2 flex-none text-ink-tertiary hover:text-red-500 cursor-pointer"
              aria-label="Clear selection"
            >×</span>
          ) : (
            <span className="ms-2 flex-none text-ink-tertiary">▾</span>
          )}
        </button>
      ) : (
        <input
          ref={inputRef}
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder={placeholder}
          className="w-full rounded border border-brand-400 bg-surface-card px-2 py-1 text-xs text-ink-primary focus:outline-none focus:ring-1 focus:ring-brand-500"
          autoComplete="off"
          autoCorrect="off"
          autoCapitalize="off"
          spellCheck={false}
        />
      )}

      {/* Dropdown panel */}
      {open && (
        <div
          className="absolute z-50 mt-1 max-h-[420px] overflow-y-auto rounded-lg border border-border-strong bg-surface-card shadow-xl"
          style={{ width: panelWidth }}
        >
          {/* Header label */}
          {(isShowingRecent || loading || visibleRows.length > 0) && (
            <div className="sticky top-0 border-b border-border-subtle bg-surface-muted/60 px-3 py-1.5 text-[10px] uppercase tracking-wide text-ink-tertiary">
              {loading ? 'Searching…' : isShowingRecent ? 'Recent' : `${visibleRows.length} result${visibleRows.length === 1 ? '' : 's'}`}
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
                    className={`cursor-pointer px-3 py-2 transition-colors ${isHi ? 'bg-brand-50' : 'hover:bg-surface-muted'}`}
                  >
                    {renderRow(row, { highlighted: isHi, query })}
                  </li>
                );
              })}
            </ul>
          ) : !loading && query.trim().length >= minChars ? (
            <div className="px-3 py-4 text-center">
              <p className="text-xs text-ink-tertiary">No results for "{query}"</p>
              {emptyState && <div className="mt-3">{emptyState(query)}</div>}
            </div>
          ) : !loading && query.trim().length < minChars && recent.length === 0 ? (
            <div className="px-3 py-4 text-center text-xs text-ink-tertiary">
              Start typing to search…
            </div>
          ) : null}
        </div>
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
