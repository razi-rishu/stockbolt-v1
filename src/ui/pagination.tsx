/**
 * Pagination — reusable page navigation bar.
 *
 * Usage:
 *   const [page, setPage] = useState(1);
 *   const paged = paginate(items, page, PAGE_SIZE);
 *
 *   return (
 *     <>
 *       {paged.map(item => <Row key={item.id} {...item} />)}
 *       <Pagination page={page} pageSize={PAGE_SIZE} total={items.length} onChange={setPage} />
 *     </>
 *   );
 */

interface PaginationProps {
  page:     number;
  pageSize: number;
  total:    number;
  onChange: (page: number) => void;
  className?: string;
}

export function Pagination({ page, pageSize, total, onChange, className = '' }: PaginationProps) {
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  if (totalPages <= 1) return null;

  const from = (page - 1) * pageSize + 1;
  const to   = Math.min(page * pageSize, total);

  return (
    <div className={`flex items-center justify-between px-4 py-2.5 text-sm ${className}`}>
      <span className="text-ink-tertiary">
        {from}–{to} of {total}
      </span>
      <div className="flex gap-1">
        <button
          disabled={page <= 1}
          onClick={() => onChange(page - 1)}
          className="rounded px-2 py-1 text-ink-secondary hover:bg-surface-muted disabled:opacity-30 disabled:cursor-not-allowed"
        >
          ‹ Prev
        </button>
        {/* Compact page pills — show at most 5 pages */}
        {pageNumbers(page, totalPages).map((p, i) =>
          p === '…' ? (
            <span key={`ellipsis-${i}`} className="px-2 py-1 text-ink-tertiary select-none">…</span>
          ) : (
            <button
              key={p}
              onClick={() => onChange(p as number)}
              className={`min-w-[2rem] rounded px-2 py-1 text-xs font-medium
                ${p === page
                  ? 'bg-brand-600 text-white'
                  : 'text-ink-secondary hover:bg-surface-muted'
                }`}
            >
              {p}
            </button>
          )
        )}
        <button
          disabled={page >= totalPages}
          onClick={() => onChange(page + 1)}
          className="rounded px-2 py-1 text-ink-secondary hover:bg-surface-muted disabled:opacity-30 disabled:cursor-not-allowed"
        >
          Next ›
        </button>
      </div>
    </div>
  );
}

/** Returns visible page numbers with '…' gaps for large page counts */
function pageNumbers(current: number, total: number): (number | '…')[] {
  if (total <= 7) return Array.from({ length: total }, (_, i) => i + 1);
  const pages: (number | '…')[] = [1];
  if (current > 3) pages.push('…');
  for (let p = Math.max(2, current - 1); p <= Math.min(total - 1, current + 1); p++) pages.push(p);
  if (current < total - 2) pages.push('…');
  pages.push(total);
  return pages;
}

/** Slices a full array to the current page window */
export function paginate<T>(items: T[], page: number, pageSize: number): T[] {
  const from = (page - 1) * pageSize;
  return items.slice(from, from + pageSize);
}
