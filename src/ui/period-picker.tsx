/**
 * PeriodPicker — compact, self-contained period control for report headers
 * (Phase 46b). A single small trigger button (showing the active preset) opens
 * a menu of presets + an inline Custom range editor. Designed to sit inline in
 * a page-header row next to the Print/Excel actions, NOT in a full-width bar —
 * it takes no vertical space of its own.
 *
 * The menu renders through a portal to <body> with fixed positioning anchored
 * to the trigger, so it can never be clipped by an ancestor's `overflow:hidden`
 * (the old in-flow dropdown got swallowed by the report card / panel below it).
 *
 * mode="range" → Custom reveals From + To fields.
 * mode="asOf"  → Custom reveals a single "As of" field; host reads `.to`.
 *
 * Purely presentational — the parent owns usePeriodPicker state and re-runs its
 * query off the resolved from/to. Tailwind-classed so it drops into both
 * report-page styles (theme.ts group and plain-Tailwind group) unchanged.
 */
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { PERIOD_PRESETS, type PeriodPreset } from '@/hooks/use-period-picker';

interface PeriodPickerProps {
  mode?: 'range' | 'asOf';
  preset: PeriodPreset;
  from: string;
  to: string;
  onPresetChange: (p: PeriodPreset) => void;
  onCustomRange: (from: string, to: string) => void;
  /** Show an "All time" option (empty range) at the top — for list/browse pages
   *  that default to showing every row. Not used by reports. */
  allowAllTime?: boolean;
}

const LABELS: Record<PeriodPreset, string> = {
  ...Object.fromEntries(PERIOD_PRESETS.map((p) => [p.key, p.label])),
  all_time: 'All time',
  custom: 'Custom',
} as Record<PeriodPreset, string>;

// Sized to the longest option ('Custom range\u2026'), not to a round number.
// 224px left most of the menu empty beside 'Today'.
const MENU_W = 172;

const dateField =
  'h-7 w-full rounded-md border border-border-subtle bg-white px-2 text-xs text-ink-primary outline-none focus:border-brand-400';

/**
 * One row style for every option, so the spacing cannot drift between the
 * preset list and the custom affordance.
 *
 * The selected row is purple and medium-weight - readable at a glance
 * without a filled background behind it. A filled row in a 10-item menu
 * reads as a block of colour rather than as "this one".
 */
const row = (selected: boolean) =>
  'block w-full px-2.5 py-1 text-start text-[13px] leading-[18px] ' +
  (selected
    ? 'font-medium text-brand-600'
    : 'text-ink-secondary hover:bg-surface-subtle hover:text-ink-primary');

export function PeriodPicker({
  mode = 'range',
  preset,
  from,
  to,
  onPresetChange,
  onCustomRange,
  allowAllTime,
}: PeriodPickerProps) {
  const isCustom = preset === 'custom';
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);

  // Draft custom values — committed only on Apply so typing doesn't refetch.
  const [draftFrom, setDraftFrom] = useState(from);
  const [draftTo, setDraftTo] = useState(to);
  useEffect(() => { setDraftFrom(from); setDraftTo(to); }, [from, to]);

  // Anchor the portal menu to the trigger's current viewport rect.
  const place = () => {
    const el = triggerRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    let left = r.right - MENU_W;                 // right-align to the trigger
    if (left < 8) left = 8;
    if (left + MENU_W > window.innerWidth - 8) left = window.innerWidth - 8 - MENU_W;
    // Flip above the trigger when there is not room below. Horizontal
    // clamping was already here; without the vertical case the menu runs off
    // the bottom of a phone, which is where a filter bar usually sits.
    const menuH = menuRef.current?.offsetHeight ?? 300;
    const below = window.innerHeight - r.bottom - 8;
    const top = below < menuH && r.top > menuH
      ? r.top - menuH - 6
      : r.bottom + 6;
    setPos({ top, left });
  };

  useLayoutEffect(() => { if (open) place(); }, [open]);

  useEffect(() => {
    if (!open) return;
    // Keep the menu pinned to the trigger while the page scrolls/resizes
    // (capture:true catches the scrolling container's scroll, which doesn't bubble).
    const onScrollResize = () => place();
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (triggerRef.current?.contains(t) || menuRef.current?.contains(t)) return;
      setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    window.addEventListener('scroll', onScrollResize, true);
    window.addEventListener('resize', onScrollResize);
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('scroll', onScrollResize, true);
      window.removeEventListener('resize', onScrollResize);
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const choose = (p: PeriodPreset) => { onPresetChange(p); setOpen(false); };
  const applyCustom = () => {
    onCustomRange(mode === 'range' ? draftFrom : draftTo, draftTo);
    setOpen(false);
  };

  // Trigger label: preset name, or the resolved dates when in custom mode.
  const triggerLabel = isCustom
    ? (mode === 'range' ? `${from} → ${to}` : `As of ${to}`)
    : (LABELS[preset] ?? 'Select period');

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="listbox"
        aria-expanded={open}
        title="Change reporting period"
        className="inline-flex h-7 max-w-[220px] items-center gap-1 rounded-md border border-border-subtle bg-white px-2.5 text-xs font-medium text-ink-secondary hover:border-border-strong hover:text-ink-primary"
      >
        {/* The calendar glyph was decoration: the label already says the
            period, and every one of these sits in a filter bar. */}
        <span className="truncate">{triggerLabel}</span>
        <svg viewBox="0 0 20 20" className={`h-3 w-3 shrink-0 text-ink-tertiary ${open ? 'rotate-180' : ''}`} fill="currentColor">
          <path fillRule="evenodd" d="M5.23 7.21a.75.75 0 011.06.02L10 11.06l3.71-3.83a.75.75 0 011.08 1.04l-4.25 4.39a.75.75 0 01-1.08 0L5.21 8.27a.75.75 0 01.02-1.06z" clipRule="evenodd" />
        </svg>
      </button>

      {open && pos && createPortal(
        <div
          ref={menuRef}
          role="listbox"
          style={{ position: 'fixed', top: pos.top, left: pos.left, width: MENU_W, zIndex: 1000 }}
          className="rounded-lg border border-border-subtle bg-white py-1 shadow-md"
        >
          {/* All time is a preset like any other, so it is spaced like one.
              The divider that used to follow it made the menu read as three
              sections when it only has two kinds of thing: presets, and the
              custom range that opens inputs. */}
          {allowAllTime && (
            <button
              type="button"
              role="option"
              aria-selected={preset === 'all_time'}
              onClick={() => choose('all_time')}
              className={row(preset === 'all_time')}
            >
              All time
            </button>
          )}
          {PERIOD_PRESETS.map((p) => (
            <button
              key={p.key}
              type="button"
              role="option"
              aria-selected={preset === p.key}
              onClick={() => choose(p.key)}
              className={row(preset === p.key)}
            >
              {p.label}
            </button>
          ))}

          {/* The one divider that earns its place: everything above picks a
              period and closes; this one opens inputs. */}
          <div className="my-1 border-t border-border-subtle" />

          <button
            type="button"
            role="option"
            aria-selected={isCustom}
            onClick={() => onPresetChange('custom')}
            className={row(isCustom)}
          >
            Custom range…
          </button>

          {isCustom && (
            <div className="flex flex-col gap-1.5 border-t border-border-subtle px-2.5 pb-2 pt-1.5">
              {mode === 'range' && (
                <label className="flex flex-col gap-1">
                  <span className="text-[10px] font-semibold uppercase tracking-wide text-ink-tertiary">From</span>
                  <input type="date" value={draftFrom} onChange={(e) => setDraftFrom(e.target.value)} className={dateField} />
                </label>
              )}
              <label className="flex flex-col gap-1">
                <span className="text-[10px] font-semibold uppercase tracking-wide text-ink-tertiary">
                  {mode === 'range' ? 'To' : 'As of'}
                </span>
                <input type="date" value={draftTo} onChange={(e) => setDraftTo(e.target.value)} className={dateField} />
              </label>
              <button
                type="button"
                onClick={applyCustom}
                className="h-8 rounded-lg bg-brand-600 px-4 text-sm font-semibold text-white hover:bg-brand-700"
              >
                Apply
              </button>
            </div>
          )}
        </div>,
        document.body,
      )}
    </>
  );
}
