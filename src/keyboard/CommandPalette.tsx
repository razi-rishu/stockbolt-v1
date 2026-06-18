/**
 * CommandPalette — spotlight global search (mod + /).
 *
 * Searches customers, suppliers, products and invoices (company-scoped) plus
 * "go to" navigation, and jumps to the chosen result. Datasets for an SMB are
 * small, so we fetch once on open and filter in-memory. ARIA combobox/listbox
 * roles; ↑/↓ to move, Enter to open, Esc to close. RTL-safe (logical layout).
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { getAdapter } from '@/data/index';
import { useAuthStore } from '@/store/auth';

interface Result { id: string; label: string; sub: string; route: string; }

const NAV_RESULTS: Result[] = [
  { id: 'nav-dash', label: 'Dashboard',          sub: 'Go to', route: '/dashboard' },
  { id: 'nav-inv',  label: 'Sales · Invoices',   sub: 'Go to', route: '/sales/invoices' },
  { id: 'nav-bills',label: 'Purchasing · Bills',  sub: 'Go to', route: '/purchasing/bills' },
  { id: 'nav-prod', label: 'Inventory · Products',sub: 'Go to', route: '/products' },
  { id: 'nav-coa',  label: 'Accounting · Chart of Accounts', sub: 'Go to', route: '/accounting/chart-of-accounts' },
  { id: 'nav-rep',  label: 'Reports',            sub: 'Go to', route: '/reports/trial-balance' },
  { id: 'nav-cust', label: 'Customers',          sub: 'Go to', route: '/contacts/customers' },
  { id: 'nav-supp', label: 'Suppliers',          sub: 'Go to', route: '/contacts/suppliers' },
];

export function CommandPalette({ open, onClose }: { open: boolean; onClose: () => void }) {
  const navigate = useNavigate();
  const company_id = useAuthStore(s => s.company_id);
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  const { data: contacts = [] } = useQuery({
    queryKey: ['palette-contacts', company_id],
    queryFn: () => getAdapter().contacts.list(company_id!, 'both'),
    enabled: open && !!company_id, staleTime: 60_000,
  });
  const { data: products = [] } = useQuery({
    queryKey: ['palette-products', company_id],
    queryFn: () => getAdapter().products.list(company_id!),
    enabled: open && !!company_id, staleTime: 60_000,
  });
  const { data: invoices = [] } = useQuery({
    queryKey: ['palette-invoices', company_id],
    queryFn: () => getAdapter().invoices.list(company_id!),
    enabled: open && !!company_id, staleTime: 30_000,
  });

  const results = useMemo<Result[]>(() => {
    const q = query.trim().toLowerCase();
    const match = (s: string) => s.toLowerCase().includes(q);
    if (!q) return NAV_RESULTS;
    const out: Result[] = [];
    for (const n of NAV_RESULTS) if (match(n.label)) out.push(n);
    for (const c of contacts) {
      if (out.length > 40) break;
      if (match(c.name ?? '')) {
        const supplier = c.type === 'supplier';
        out.push({
          id: `c-${c.id}`, label: c.name ?? '—',
          sub: supplier ? 'Supplier' : 'Customer',
          route: `${supplier ? '/contacts/suppliers' : '/contacts/customers'}/${c.id}`,
        });
      }
    }
    for (const p of products) {
      if (out.length > 60) break;
      if (match(p.name ?? '') || match((p as { sku?: string }).sku ?? '')) {
        out.push({ id: `p-${p.id}`, label: p.name ?? '—', sub: `Product${(p as { sku?: string }).sku ? ' · ' + (p as { sku?: string }).sku : ''}`, route: `/products/${p.id}` });
      }
    }
    for (const inv of invoices) {
      if (out.length > 80) break;
      const numField = (inv as { invoice_number?: string }).invoice_number ?? '';
      if (match(numField)) out.push({ id: `i-${inv.id}`, label: numField || 'Invoice', sub: 'Invoice', route: `/sales/invoices/${inv.id}` });
    }
    return out;
  }, [query, contacts, products, invoices]);

  // Reset + focus on open; clamp active when results change.
  useEffect(() => { if (open) { setQuery(''); setActive(0); setTimeout(() => inputRef.current?.focus(), 0); } }, [open]);
  useEffect(() => { setActive(0); }, [query]);

  if (!open) return null;

  function choose(r: Result | undefined) {
    if (!r) return;
    navigate(r.route);
    onClose();
  }

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'ArrowDown') { e.preventDefault(); setActive(a => Math.min(a + 1, results.length - 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActive(a => Math.max(a - 1, 0)); }
    else if (e.key === 'Enter') { e.preventDefault(); choose(results[active]); }
    else if (e.key === 'Escape') { e.preventDefault(); onClose(); }
  }

  return createPortal(
    <div className="fixed inset-0 z-[60] flex items-start justify-center p-4 pt-[12vh]">
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={onClose} />
      <div role="dialog" aria-label="Global search" className="relative w-full max-w-xl overflow-hidden rounded-card bg-surface-card shadow-elevated">
        <input
          ref={inputRef}
          role="combobox" aria-expanded="true" aria-controls="palette-list" aria-autocomplete="list"
          className="w-full border-b border-border-subtle bg-transparent px-4 py-3 text-sm text-ink-primary outline-none placeholder:text-ink-tertiary"
          placeholder="Search customers, products, invoices… or jump to a page"
          value={query}
          onChange={e => setQuery(e.target.value)}
          onKeyDown={onKeyDown}
        />
        <ul id="palette-list" role="listbox" className="max-h-[50vh] overflow-y-auto py-1">
          {results.length === 0 && (
            <li className="px-4 py-6 text-center text-sm text-ink-tertiary">No matches.</li>
          )}
          {results.map((r, i) => (
            <li
              key={r.id} role="option" aria-selected={i === active}
              onMouseEnter={() => setActive(i)}
              onClick={() => choose(r)}
              className={`flex cursor-pointer items-center justify-between gap-3 px-4 py-2 text-sm ${i === active ? 'bg-brand-50 text-brand-700' : 'text-ink-primary'}`}
            >
              <span className="min-w-0 flex-1 truncate">{r.label}</span>
              <span className="shrink-0 text-[11px] text-ink-tertiary">{r.sub}</span>
            </li>
          ))}
        </ul>
      </div>
    </div>,
    document.body,
  );
}
