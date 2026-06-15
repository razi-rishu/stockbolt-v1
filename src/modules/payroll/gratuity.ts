/**
 * UAE end-of-service gratuity (EOSB) estimate — Payroll P3a.
 *
 * Standard limited-contract formula on BASIC salary:
 *   daily wage     = basic / 30
 *   first 5 years  = 21 days of basic per year
 *   beyond 5 years = 30 days of basic per year
 *   partial years  = pro-rated
 *   statutory cap  = 2 years' total basic salary
 *
 * This is the amount owed if the employee left today — what you'd pay at
 * Final Settlement. The monthly accrual (P2) is the running approximation
 * that builds the 2360 liability toward this figure.
 */
export function computeGratuity(joiningDate: string | null | undefined, basicSalary: number): number {
  if (!joiningDate || basicSalary <= 0) return 0;
  const start = new Date(joiningDate + (joiningDate.length === 10 ? 'T00:00:00' : ''));
  if (isNaN(start.getTime())) return 0;
  const now = new Date();
  const years = (now.getTime() - start.getTime()) / (365.25 * 24 * 3600 * 1000);
  if (years <= 0) return 0;

  const daily = basicSalary / 30;
  const first = Math.min(years, 5) * 21 * daily;
  const beyond = Math.max(0, years - 5) * 30 * daily;
  const gratuity = first + beyond;

  const cap = basicSalary * 24; // 2 years' basic
  return Math.round(Math.min(gratuity, cap) * 100) / 100;
}

export function serviceLabel(joiningDate: string | null | undefined): string {
  if (!joiningDate) return '—';
  const start = new Date(joiningDate + (joiningDate.length === 10 ? 'T00:00:00' : ''));
  if (isNaN(start.getTime())) return '—';
  const months = Math.max(0, Math.round((Date.now() - start.getTime()) / (30.44 * 24 * 3600 * 1000)));
  const y = Math.floor(months / 12), m = months % 12;
  if (y === 0) return `${m} mo`;
  if (m === 0) return `${y} yr`;
  return `${y} yr ${m} mo`;
}
