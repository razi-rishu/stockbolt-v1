/**
 * PostgREST caps a response at roughly 1,000 rows and says nothing about it —
 * you get a short array and no error. Every report that fetched the ledger with
 * a plain .select() and summed it in JavaScript was therefore correct only
 * while the company stayed small, and would have started understating silently
 * rather than failing.
 *
 * A wrong Trial Balance at least looks wrong: it stops netting to zero. The
 * Balance Sheet is worse, because it folds income and expense into a synthetic
 * equity line, so it would still BALANCE while showing truncated numbers. The
 * VAT and tax returns are worse again — those get filed.
 *
 * This is the paging idiom getOwnerDashboard already used, extracted so every
 * caller shares one implementation and one cap.
 *
 * It takes a FACTORY rather than a query, because a supabase-js builder can
 * only be awaited once: each page has to be built fresh with its own .range().
 */

export const PAGE_SIZE = 1000;
/** 25 pages = 25,000 rows. Past that a report belongs in SQL, not the browser. */
export const MAX_PAGES = 25;

export interface PageResult<T> { data: T[] | null; error: { message: string } | null }

export async function fetchAllPages<T>(
  context: string,
  makePage: (from: number, to: number) => PromiseLike<PageResult<T>>,
  onError: (error: { message: string } | null, context: string) => void,
): Promise<T[]> {
  const out: T[] = [];
  for (let i = 0; i < MAX_PAGES; i++) {
    const { data, error } = await makePage(i * PAGE_SIZE, (i + 1) * PAGE_SIZE - 1);
    onError(error, context);
    const rows = data ?? [];
    out.push(...rows);
    // A short page means the end of the set. Asking for one more would cost a
    // round trip to learn nothing.
    if (rows.length < PAGE_SIZE) return out;
  }
  // Loud on purpose. Silently returning 25,000 of 30,000 rows is the exact
  // failure this helper exists to prevent, so if the cap is ever reached the
  // caller must hear about it rather than quietly publishing a short number.
  console.warn(
    `${context}: reached the ${MAX_PAGES * PAGE_SIZE}-row cap. The figures are ` +
    `computed from the first ${MAX_PAGES * PAGE_SIZE} rows only and may be understated. ` +
    `This report needs to aggregate in SQL.`,
  );
  return out;
}
