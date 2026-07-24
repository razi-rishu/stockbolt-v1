/**
 * AC-2 — Comparative Financial Statements: period-control hook.
 *
 * Thin React wrapper around the pure resolvers in `@/lib/comparative`. Owns the
 * per-report "compare on/off" + basis state (persisted to localStorage) and,
 * given the current period from `usePeriodPicker`, returns the resolved
 * current/previous windows. It does NOT fetch — each report page fires its two
 * existing report queries (current + previous) using these windows, so the
 * current-period query reuses the cache it already had. No accounting logic
 * lives here; all of it stays in the reused report engine.
 */
import { useCallback, useMemo, useState } from 'react';
import type { PeriodPreset, PeriodRange } from '@/hooks/use-period-picker';
import {
  resolveComparativeRange, resolveComparativeAsOf, type CompareBasis,
  type ComparativeRange, type ComparativeAsOf,
} from '@/lib/comparative';

interface PersistedCompare { on: boolean; basis: CompareBasis }

function loadPersisted(storageKey: string): PersistedCompare {
  try {
    const raw = localStorage.getItem(storageKey);
    if (raw) {
      const p = JSON.parse(raw) as PersistedCompare;
      if (typeof p.on === 'boolean' && (p.basis === 'previous_period' || p.basis === 'previous_year')) {
        return p;
      }
    }
  } catch { /* private mode / corrupt — fall through */ }
  return { on: false, basis: 'previous_period' };
}

export interface UseComparativePeriods {
  compareOn: boolean;
  basis: CompareBasis;
  setCompareOn: (on: boolean) => void;
  setBasis: (basis: CompareBasis) => void;
  /** Current/previous windows for a RANGE report (P&L). */
  range: ComparativeRange;
  /** Current/previous as-of dates for an AS-OF report (Balance Sheet, Trial Balance). */
  asOf: ComparativeAsOf;
}

/**
 * @param storageKey       unique per report, e.g. `stockbolt.report.profit-loss.compare`
 * @param preset           the current PeriodPicker preset (drives previous-period math)
 * @param current          the current {from,to} from usePeriodPicker
 * @param fiscalYearStart  companies.fiscal_year_start (for fiscal-aware Year comparison)
 */
export function useComparativePeriods(args: {
  storageKey: string;
  preset: PeriodPreset;
  current: PeriodRange;
  fiscalYearStart?: string | null;
}): UseComparativePeriods {
  const { storageKey, preset, current, fiscalYearStart } = args;
  const [state, setState] = useState<PersistedCompare>(() => loadPersisted(storageKey));

  const persist = useCallback((next: PersistedCompare) => {
    setState(next);
    try { localStorage.setItem(storageKey, JSON.stringify(next)); } catch { /* private mode */ }
  }, [storageKey]);

  const setCompareOn = useCallback((on: boolean) => persist({ on, basis: state.basis }), [persist, state.basis]);
  const setBasis = useCallback((basis: CompareBasis) => persist({ on: state.on, basis }), [persist, state.on]);

  const range = useMemo(
    () => resolveComparativeRange(current, preset, state.basis, fiscalYearStart),
    [current, preset, state.basis, fiscalYearStart],
  );
  const asOf = useMemo(
    () => resolveComparativeAsOf(current.to, preset, state.basis, fiscalYearStart),
    [current.to, preset, state.basis, fiscalYearStart],
  );

  return { compareOn: state.on, basis: state.basis, setCompareOn, setBasis, range, asOf };
}
