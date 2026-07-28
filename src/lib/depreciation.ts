/**
 * AC-5A — depreciation math (pure; no DB, no React).
 *
 * The AUTHORITATIVE charge is computed server-side by run_depreciation() so the
 * GL is never at the mercy of the client. This module mirrors that math for the
 * on-screen schedule/preview and is locked by unit tests; keep it in lock-step
 * with the plpgsql in supabase/migrations/…phase60….sql.
 *
 * Conventions (per the approved AC-5 spec):
 *  • Monthly charge. Pro-rata by days in the acquisition (and disposal) month.
 *  • Straight-line: (cost − salvage) / useful_life_months, pro-rated.
 *  • Reducing-balance (WDV): opening book value × (annual_rate% / 12), pro-rated.
 *  • Never depreciate below salvage — the last charge is capped.
 */
export type DepreciationMethod = 'straight_line' | 'reducing_balance';

export interface DepreciationAsset {
  cost: number;
  salvage_value: number;
  useful_life_months: number;   // straight-line
  method: DepreciationMethod;
  wdv_rate: number;             // reducing-balance annual %, e.g. 15 = 15%/yr
  in_service_date: string;      // ISO yyyy-mm-dd
}

function round2(n: number): number { return Math.round((n + Number.EPSILON) * 100) / 100; }

/** yyyy-mm-dd → [year, month(1-12), day] as numbers (UTC-safe, no Date parsing pitfalls). */
function parts(iso: string): [number, number, number] {
  const [y, m, d] = iso.split('-').map(Number);
  return [y, m, d];
}
function daysInMonth(year: number, month1: number): number {
  return new Date(Date.UTC(year, month1, 0)).getUTCDate();
}
/** Whole days from ISO date a to b inclusive of both ends (b ≥ a). */
function inclusiveDays(aIso: string, bIso: string): number {
  const [ay, am, ad] = parts(aIso);
  const [by, bm, bd] = parts(bIso);
  const a = Date.UTC(ay, am - 1, ad);
  const b = Date.UTC(by, bm - 1, bd);
  return Math.round((b - a) / 86_400_000) + 1;
}

/**
 * Depreciation charge for the single calendar month that ends on `monthEnd`
 * (which must be the last day of its month), given depreciation booked so far.
 */
export function monthlyCharge(asset: DepreciationAsset, monthEnd: string, accumulatedBefore: number): number {
  const [ey, em] = parts(monthEnd);
  const dim = daysInMonth(ey, em);
  const monthStart = `${ey}-${String(em).padStart(2, '0')}-01`;
  const monthEndFull = `${ey}-${String(em).padStart(2, '0')}-${String(dim).padStart(2, '0')}`;

  // Not yet in service this month.
  if (asset.in_service_date > monthEndFull) return 0;

  const base = asset.cost - asset.salvage_value;
  const remaining = round2(base - accumulatedBefore);
  if (remaining <= 0) return 0;

  const effectiveStart = asset.in_service_date > monthStart ? asset.in_service_date : monthStart;
  const proRata = inclusiveDays(effectiveStart, monthEndFull) / dim;

  let charge: number;
  if (asset.method === 'straight_line') {
    charge = (base / asset.useful_life_months) * proRata;
  } else {
    const bookValue = asset.cost - accumulatedBefore;               // WDV opening book value
    charge = bookValue * (asset.wdv_rate / 100 / 12) * proRata;
  }
  return round2(Math.min(charge, remaining));
}

export interface ScheduleRow { period_end: string; charge: number; accumulated: number; book_value: number }

/** Last day of the month `offset` months after the given month-end. */
function addMonthEnd(monthEnd: string, offset: number): string {
  const [y, m] = parts(monthEnd);
  const idx = (m - 1) + offset;
  const ny = y + Math.floor(idx / 12);
  const nm = (idx % 12 + 12) % 12 + 1;
  return `${ny}-${String(nm).padStart(2, '0')}-${String(daysInMonth(ny, nm)).padStart(2, '0')}`;
}

/**
 * Full projected schedule from the first in-service month until fully
 * depreciated (or `maxMonths` cap). For the on-screen preview only.
 */
export function projectSchedule(asset: DepreciationAsset, maxMonths = 600): ScheduleRow[] {
  const [iy, im] = parts(asset.in_service_date);
  let periodEnd = `${iy}-${String(im).padStart(2, '0')}-${String(daysInMonth(iy, im)).padStart(2, '0')}`;
  const base = asset.cost - asset.salvage_value;
  const rows: ScheduleRow[] = [];
  let accumulated = 0;
  for (let i = 0; i < maxMonths && round2(base - accumulated) > 0; i++) {
    const charge = monthlyCharge(asset, periodEnd, accumulated);
    if (charge <= 0 && i > 0) break;
    accumulated = round2(accumulated + charge);
    rows.push({ period_end: periodEnd, charge, accumulated, book_value: round2(asset.cost - accumulated) });
    periodEnd = addMonthEnd(periodEnd, 1);
  }
  return rows;
}
