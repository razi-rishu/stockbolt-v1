/**
 * Period picker — shared preset-driven date range for reports and list
 * filters (Phase 46b). Replaces the raw `<input type="date">` From/To pairs
 * hand-rolled across ~30 report pages and several list pages.
 *
 * Generalizes the Dashboard's `PeriodToggle` ('today'/'month'/'year') into a
 * full accounting preset set. All math is **calendar-based** (calendar
 * quarter / calendar year) for v1 — GCC VAT quarters are fixed to the
 * calendar by law, so the VAT Return report should stay calendar even if a
 * fiscal-year-aware variant lands later (companies.fiscal_year_start exists
 * and is read-only, so that fast-follow needs no migration).
 *
 * As-of reports (Trial Balance, Aging, Stock Valuation) consume `.to` only —
 * for a past-period preset ("Last Month/Quarter/Year"), `.to` is the LAST day
 * of that period (a stale snapshot at period end), not today.
 */
import { useCallback, useState } from 'react';

export type PeriodPreset =
  | 'all_time'
  | 'today'
  | 'this_week'
  | 'this_month'
  | 'this_quarter'
  | 'this_year'
  | 'last_month'
  | 'last_quarter'
  | 'last_year'
  | 'custom';

export interface PeriodRange {
  from: string; // ISO yyyy-mm-dd
  to: string;   // ISO yyyy-mm-dd
}

// The presets offered in the UI, in display order. 'custom' is handled
// separately (it reveals the raw date fields), so it's not in this list.
export const PERIOD_PRESETS: { key: Exclude<PeriodPreset, 'custom'>; label: string }[] = [
  { key: 'today',        label: 'Today' },
  { key: 'this_week',    label: 'This Week' },
  { key: 'this_month',   label: 'This Month' },
  { key: 'this_quarter', label: 'This Quarter' },
  { key: 'this_year',    label: 'This Year' },
  { key: 'last_month',   label: 'Last Month' },
  { key: 'last_quarter', label: 'Last Quarter' },
  { key: 'last_year',    label: 'Last Year' },
];

// ── Pure date helpers (local time — the user's calendar, not UTC) ───────────
function iso(d: Date): string {
  // Local yyyy-mm-dd (avoids the UTC off-by-one that toISOString() causes
  // for users east/west of Greenwich).
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}
function startOfWeek(d: Date): Date {
  // Week starts Sunday (matches the Dashboard trend chart's day labels).
  const x = new Date(d);
  x.setDate(x.getDate() - x.getDay());
  return x;
}
function quarterStartMonth(monthIndex: number): number {
  return Math.floor(monthIndex / 3) * 3; // 0,3,6,9
}

/**
 * Resolve a preset into a concrete {from, to} range. Pure + exported so it's
 * testable and reusable (e.g. the Dashboard could adopt it later).
 * For 'custom', pass the raw values through unchanged.
 */
export function resolvePeriodRange(
  preset: PeriodPreset,
  customFrom?: string,
  customTo?: string,
): PeriodRange {
  const now = new Date();
  const y = now.getFullYear();
  const m = now.getMonth();

  switch (preset) {
    case 'all_time':
      // Empty range = no date bound. List pages treat this as "show every row".
      return { from: '', to: '' };

    case 'today':
      return { from: iso(now), to: iso(now) };

    case 'this_week':
      return { from: iso(startOfWeek(now)), to: iso(now) };

    case 'this_month':
      return { from: iso(new Date(y, m, 1)), to: iso(now) };

    case 'this_quarter': {
      const qs = quarterStartMonth(m);
      return { from: iso(new Date(y, qs, 1)), to: iso(now) };
    }

    case 'this_year':
      return { from: iso(new Date(y, 0, 1)), to: iso(now) };

    case 'last_month': {
      const from = new Date(y, m - 1, 1);
      const to = new Date(y, m, 0); // day 0 of this month = last day of prev
      return { from: iso(from), to: iso(to) };
    }

    case 'last_quarter': {
      const qs = quarterStartMonth(m);
      const from = new Date(y, qs - 3, 1);
      const to = new Date(y, qs, 0); // last day before this quarter
      return { from: iso(from), to: iso(to) };
    }

    case 'last_year':
      return { from: iso(new Date(y - 1, 0, 1)), to: iso(new Date(y - 1, 11, 31)) };

    case 'custom':
      return {
        from: customFrom || iso(new Date(y, m, 1)),
        to: customTo || iso(now),
      };
  }
}

interface PersistedState { preset: PeriodPreset; from: string; to: string }

function loadPersisted(storageKey: string, fallback: PeriodPreset): PersistedState {
  try {
    const raw = localStorage.getItem(storageKey);
    if (raw) {
      const parsed = JSON.parse(raw) as PersistedState;
      if (parsed.preset === 'custom' && parsed.from && parsed.to) {
        return { preset: 'custom', from: parsed.from, to: parsed.to };
      }
      if (parsed.preset && parsed.preset !== 'custom') {
        return { preset: parsed.preset, ...resolvePeriodRange(parsed.preset) };
      }
    }
  } catch { /* private mode / corrupt value — fall through to default */ }
  return { preset: fallback, ...resolvePeriodRange(fallback) };
}

/**
 * Stateful hook wrapping resolvePeriodRange + per-page persistence.
 * `storageKey` should be unique per host (e.g. `stockbolt.report.profit-loss.period`)
 * so different reports remember their own last-used preset independently.
 */
export function usePeriodPicker(storageKey: string, defaultPreset: PeriodPreset = 'this_month') {
  const [state, setState] = useState<PersistedState>(() => loadPersisted(storageKey, defaultPreset));

  const persist = useCallback((next: PersistedState) => {
    setState(next);
    try { localStorage.setItem(storageKey, JSON.stringify(next)); } catch { /* private mode */ }
  }, [storageKey]);

  const setPreset = useCallback((preset: PeriodPreset) => {
    if (preset === 'custom') {
      // Entering custom mode keeps the currently-resolved range as the
      // starting values so the fields aren't blank.
      persist({ preset: 'custom', from: state.from, to: state.to });
    } else {
      persist({ preset, ...resolvePeriodRange(preset) });
    }
  }, [persist, state.from, state.to]);

  const setCustomRange = useCallback((from: string, to: string) => {
    persist({ preset: 'custom', from, to });
  }, [persist]);

  return {
    preset: state.preset,
    from: state.from,
    to: state.to,
    setPreset,
    setCustomRange,
  };
}
