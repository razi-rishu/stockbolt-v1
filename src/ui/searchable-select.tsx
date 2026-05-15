/**
 * SearchableSelect — a combobox with a typeahead filter.
 *
 * Renders a button showing the currently selected option (or a placeholder).
 * Clicking opens a dropdown with a search input that filters options by label
 * (case-insensitive substring match). Keyboard navigation: arrows to move,
 * Enter to select, Escape to close.
 *
 * Designed for cases where the option list grows large enough that scrolling
 * a native <select> becomes painful — e.g. picking a COA account from a
 * 50-item chart of accounts on a vendor bill line.
 *
 * Phase D5 — Floating panel via @floating-ui/react.
 *   The dropdown is rendered through a FloatingPortal and positioned by
 *   the library's `autoUpdate` machinery, which correctly handles every
 *   edge case the hand-rolled version got wrong: nested scrollable
 *   ancestors (`<main className="overflow-y-auto">`), CSS transform/filter
 *   ancestors that break `position: fixed`, browser zoom, fractional
 *   pixels, viewport resize. z-index uses the shared Z.dropdown token.
 */
import { useEffect, useRef, useState, useMemo } from 'react';
import {
  useFloating,
  autoUpdate,
  flip,
  shift,
  offset,
  size as floatingSize,
  FloatingPortal,
} from '@floating-ui/react';
import { Z } from './z-index';

export interface SearchableSelectOption {
  value: string;
  label: string;
}

interface Props {
  value: string;
  onChange: (value: string) => void;
  options: SearchableSelectOption[];
  placeholder?: string;
  disabled?: boolean;
  className?: string;
  /** Width of the dropdown panel in px. Defaults to max(triggerWidth, 288). */
  panelWidth?: number;
  /** Minimum auto-width floor when panelWidth is omitted. Default 288 (≈18rem). */
  panelMinWidth?: number;
}

export function SearchableSelect({
  value,
  onChange,
  options,
  placeholder = 'Select…',
  disabled = false,
  className = '',
  panelWidth,
  panelMinWidth = 288,
}: Props) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [highlightIdx, setHighlightIdx] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef  = useRef<HTMLUListElement>(null);

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
          const w = panelWidth ?? Math.max(rects.reference.width, panelMinWidth);
          setFloatingWidth(w);
        },
      }),
    ],
  });

  const selected = options.find((o) => o.value === value);
  const filtered = useMemo(() => {
    if (!query.trim()) return options;
    const q = query.toLowerCase();
    return options.filter((o) => o.label.toLowerCase().includes(q));
  }, [options, query]);

  // Keep highlight in range when filtered list changes
  useEffect(() => {
    setHighlightIdx(0);
  }, [query, open]);

  // Focus the search input when opened
  useEffect(() => {
    if (!open) return;
    const id = setTimeout(() => inputRef.current?.focus(), 0);
    return () => clearTimeout(id);
  }, [open]);

  // Close on outside click — must also exclude the portal panel
  useEffect(() => {
    if (!open) return;
    function onDocMouseDown(e: MouseEvent) {
      const target = e.target as Node;
      const inContainer = refs.reference.current instanceof Element
        && refs.reference.current.contains(target);
      const inPanel     = refs.floating.current?.contains(target);
      if (!inContainer && !inPanel) {
        setOpen(false);
        setQuery('');
      }
    }
    document.addEventListener('mousedown', onDocMouseDown);
    return () => document.removeEventListener('mousedown', onDocMouseDown);
  }, [open, refs.reference, refs.floating]);

  // Scroll the highlighted row into view
  useEffect(() => {
    if (!open || !listRef.current) return;
    const node = listRef.current.children[highlightIdx] as HTMLElement | undefined;
    if (node) node.scrollIntoView({ block: 'nearest' });
  }, [highlightIdx, open]);

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setHighlightIdx((i) => Math.min(i + 1, filtered.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setHighlightIdx((i) => Math.max(i - 1, 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const opt = filtered[highlightIdx];
      if (opt) {
        onChange(opt.value);
        setOpen(false);
        setQuery('');
      }
    } else if (e.key === 'Escape') {
      e.preventDefault();
      setOpen(false);
      setQuery('');
    }
  }

  return (
    <div className={`relative ${className}`}>
      <button
        ref={refs.setReference}
        type="button"
        disabled={disabled}
        onClick={() => !disabled && setOpen((o) => !o)}
        className="flex w-full items-center justify-between gap-1 rounded border border-border-strong bg-surface-subtle px-2 py-1 text-start text-xs text-ink-primary disabled:cursor-not-allowed disabled:opacity-60 hover:bg-surface-card focus:outline-none focus:ring-2 focus:ring-brand-500/40"
      >
        <span className={`truncate ${selected ? '' : 'text-ink-tertiary'}`}>
          {selected ? selected.label : placeholder}
        </span>
        <svg viewBox="0 0 20 20" className="h-3 w-3 flex-shrink-0 text-ink-tertiary" fill="currentColor">
          <path fillRule="evenodd" d="M5.23 7.21a.75.75 0 011.06.02L10 11.06l3.71-3.83a.75.75 0 011.08 1.04l-4.25 4.39a.75.75 0 01-1.08 0L5.21 8.27a.75.75 0 01.02-1.06z" clipRule="evenodd" />
        </svg>
      </button>

      {open && (
      <FloatingPortal>
        <div
          ref={refs.setFloating}
          className="max-h-64 overflow-hidden rounded-card border border-border-subtle bg-surface-card shadow-lg"
          style={{
            ...floatingStyles,
            width:    floatingWidth,
            zIndex:   Z.dropdown,
          }}
        >
          <div className="border-b border-border-subtle bg-surface-muted p-2">
            <input
              ref={inputRef}
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Search…"
              className="w-full rounded border border-border-strong bg-white px-2 py-1 text-xs text-ink-primary focus:border-brand-500 focus:outline-none"
            />
          </div>
          <ul ref={listRef} className="max-h-48 overflow-y-auto py-1">
            {filtered.length === 0 ? (
              <li className="px-3 py-2 text-xs text-ink-tertiary">No matches</li>
            ) : (
              filtered.map((o, i) => {
                const isSelected = o.value === value;
                const isHighlighted = i === highlightIdx;
                return (
                  <li
                    key={o.value}
                    onMouseEnter={() => setHighlightIdx(i)}
                    onMouseDown={(e) => {
                      // mouseDown (not click) so we beat the outside-click
                      // handler when this panel is portaled.
                      e.preventDefault();
                      onChange(o.value);
                      setOpen(false);
                      setQuery('');
                    }}
                    className={`cursor-pointer px-3 py-1.5 text-xs ${
                      isHighlighted
                        ? 'bg-brand-50 text-brand-700'
                        : isSelected
                        ? 'bg-surface-muted text-ink-primary'
                        : 'text-ink-primary hover:bg-surface-muted'
                    }`}
                  >
                    {o.label}
                  </li>
                );
              })
            )}
          </ul>
        </div>
      </FloatingPortal>
      )}
    </div>
  );
}
