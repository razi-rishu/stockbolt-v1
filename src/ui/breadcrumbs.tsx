/**
 * <Breadcrumbs> — back-navigation trail for drill-down destination pages
 * (Document 7 — D1, req 11). e.g.  Reports › General Ledger › JE-1100.
 * The last crumb is the current page (not a link).
 */
import { Link } from 'react-router-dom';

export interface Crumb {
  label: string;
  to?: string;
}

export function Breadcrumbs({ items }: { items: Crumb[] }) {
  return (
    <nav className="mb-2.5 flex flex-wrap items-center gap-1.5 text-xs text-ink-tertiary">
      {items.map((c, i) => {
        const last = i === items.length - 1;
        return (
          <span key={i} className="inline-flex items-center gap-1.5">
            {i > 0 && <span aria-hidden className="text-ink-tertiary">›</span>}
            {c.to && !last ? (
              <Link to={c.to} className="text-brand-600 hover:underline">{c.label}</Link>
            ) : (
              <span className={last ? 'font-semibold text-ink-primary' : ''}>{c.label}</span>
            )}
          </span>
        );
      })}
    </nav>
  );
}
