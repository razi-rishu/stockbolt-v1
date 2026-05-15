import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Modal } from '@/ui/modal';
import { Input } from '@/ui/input';
import { Button } from '@/ui/button';
import { getAdapter } from '@/data/index';
import { useAuthStore } from '@/store/auth';
import type { ProductInsert, CategoryRow, BrandRow } from '@/data/adapter';

/**
 * ProductQuickCreate — modal popup for creating a product from inside the
 * picker dropdown. After save, calls onCreated(id) so the picker can
 * auto-select the new product and drop it onto the invoice/bill line.
 *
 * Fields kept minimal:
 *   SKU (required) · Name (required) · Brand · Category ·
 *   Unit (optional) · Selling Price · OEM Number
 *
 * Inline create:
 *   - Brand: "+ Create new brand" button next to picker
 *   - Category: same
 *   These are also tiny mutations (one column: name) so we keep them
 *   inline rather than nested modals.
 *
 * NOT included (deliberate):
 *   - Opening stock — per AGENTS Rule 1, stock must come through a
 *     proper purchase/opening-balance flow. Quick-creating a product
 *     with stock would bypass GL. User posts inventory via a normal
 *     vendor bill afterwards.
 *   - Cost price — derived from MAC engine as soon as the first
 *     purchase posts. No need for a manual field.
 *   - Many display fields (barcode, weight, dimensions, etc) — set
 *     later from the product detail page.
 */

export interface ProductQuickCreateProps {
  open:        boolean;
  /** Initial SKU or name from the search query. We make a best guess: if
   *  it looks SKU-like (all caps + digits, < 25 chars), put it in SKU;
   *  otherwise put it in Name. */
  initialQuery?: string;
  onClose:     () => void;
  onCreated:   (id: string) => void;
}

function guessSplitQuery(q: string | undefined): { sku: string; name: string } {
  const trimmed = (q ?? '').trim();
  if (!trimmed) return { sku: '', name: '' };
  // SKU-like heuristic: short, mostly uppercase / digits / dashes
  const skuish = trimmed.length <= 25 && /^[A-Z0-9][A-Z0-9\-_/]+$/.test(trimmed);
  return skuish ? { sku: trimmed, name: '' } : { sku: '', name: trimmed };
}

export function ProductQuickCreate({
  open, initialQuery, onClose, onCreated,
}: ProductQuickCreateProps) {
  const { company_id } = useAuthStore();
  const qc = useQueryClient();
  const initial = guessSplitQuery(initialQuery);

  const [sku, setSku]           = useState(initial.sku);
  const [name, setName]         = useState(initial.name);
  const [brandId, setBrandId]   = useState('');
  const [categoryId, setCategoryId] = useState('');
  const [sellingPrice, setSellingPrice] = useState('0');
  const [oeNumber, setOeNumber] = useState('');
  const [error, setError]       = useState<string | null>(null);

  // Inline create state
  const [newBrandName, setNewBrandName]       = useState('');
  const [showNewBrand, setShowNewBrand]       = useState(false);
  const [newCategoryName, setNewCategoryName] = useState('');
  const [showNewCategory, setShowNewCategory] = useState(false);

  const { data: brands = [] } = useQuery<BrandRow[]>({
    queryKey: ['brands', company_id],
    queryFn: () => getAdapter().brands.list(company_id!),
    enabled: !!company_id,
  });
  const { data: categories = [] } = useQuery<CategoryRow[]>({
    queryKey: ['categories', company_id],
    queryFn: () => getAdapter().categories.list(company_id!),
    enabled: !!company_id,
  });

  // Reset key — if user opens this with a new query string, refresh defaults
  useState(() => {
    if (initialQuery !== undefined) {
      const g = guessSplitQuery(initialQuery);
      setSku(g.sku); setName(g.name);
    }
  });

  const createBrandMutation = useMutation({
    mutationFn: async () => {
      if (!newBrandName.trim()) throw new Error('Brand name required');
      return getAdapter().brands.create({
        company_id: company_id!,
        name:       newBrandName.trim(),
        name_ar:    null,
        logo_url:   null,
        is_active:  true,
      });
    },
    onSuccess: (b) => {
      qc.invalidateQueries({ queryKey: ['brands'] });
      setBrandId(b.id);
      setShowNewBrand(false);
      setNewBrandName('');
    },
    onError: (e: Error) => setError(`Brand: ${e.message}`),
  });

  const createCategoryMutation = useMutation({
    mutationFn: async () => {
      if (!newCategoryName.trim()) throw new Error('Category name required');
      return getAdapter().categories.create({
        company_id: company_id!,
        parent_id:  null,
        name:       newCategoryName.trim(),
        name_ar:    null,
        sort_order: 0,
        is_active:  true,
      });
    },
    onSuccess: (c) => {
      qc.invalidateQueries({ queryKey: ['categories'] });
      setCategoryId(c.id);
      setShowNewCategory(false);
      setNewCategoryName('');
    },
    onError: (e: Error) => setError(`Category: ${e.message}`),
  });

  const createMutation = useMutation({
    mutationFn: async () => {
      if (!sku.trim())  throw new Error('SKU is required');
      if (!name.trim()) throw new Error('Name is required');
      const price = parseFloat(sellingPrice) || 0;
      if (price < 0) throw new Error('Selling price cannot be negative');

      const row = {
        company_id:     company_id!,
        sku:            sku.trim(),
        name:           name.trim(),
        name_ar:        null,
        oe_number:      oeNumber.trim() || null,
        brand_id:       brandId || null,
        category_id:    categoryId || null,
        unit_id:        null,
        selling_price:  price,
        is_active:      true,
      } as ProductInsert;

      return getAdapter().products.create(row);
    },
    onSuccess: (row) => {
      qc.invalidateQueries({ queryKey: ['products'] });
      onCreated(row.id);
      // Reset
      setSku(''); setName(''); setBrandId(''); setCategoryId('');
      setSellingPrice('0'); setOeNumber(''); setError(null);
    },
    onError: (e: Error) => setError(e.message),
  });

  return (
    <Modal open={open} onClose={onClose} title="Quick create product" width="lg">
      <div className="space-y-4">
        {error && (
          <div className="rounded border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-700">
            {error}
          </div>
        )}

        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <Input
            label="SKU *"
            required
            value={sku}
            onChange={e => setSku(e.target.value)}
            autoFocus
          />
          <Input
            label="OEM number"
            value={oeNumber}
            onChange={e => setOeNumber(e.target.value)}
          />
          <div className="md:col-span-2">
            <Input
              label="Product name *"
              required
              value={name}
              onChange={e => setName(e.target.value)}
            />
          </div>

          {/* Brand with inline create */}
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">Brand</label>
            {showNewBrand ? (
              <div className="flex gap-2">
                <input
                  type="text"
                  value={newBrandName}
                  onChange={e => setNewBrandName(e.target.value)}
                  placeholder="New brand name"
                  autoFocus
                  className="flex-1 h-9 rounded-md border border-slate-300 px-3 text-sm"
                />
                <Button size="sm" onClick={() => createBrandMutation.mutate()} disabled={createBrandMutation.isPending}>
                  {createBrandMutation.isPending ? '…' : 'Add'}
                </Button>
                <Button size="sm" variant="ghost" onClick={() => { setShowNewBrand(false); setNewBrandName(''); }}>
                  ✕
                </Button>
              </div>
            ) : (
              <div className="flex gap-2">
                <select
                  className="flex-1 h-9 rounded-md border border-slate-300 px-2 text-sm"
                  value={brandId}
                  onChange={e => setBrandId(e.target.value)}
                >
                  <option value="">— None —</option>
                  {brands.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
                </select>
                <Button size="sm" variant="ghost" onClick={() => setShowNewBrand(true)}>
                  + New
                </Button>
              </div>
            )}
          </div>

          {/* Category with inline create */}
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">Category</label>
            {showNewCategory ? (
              <div className="flex gap-2">
                <input
                  type="text"
                  value={newCategoryName}
                  onChange={e => setNewCategoryName(e.target.value)}
                  placeholder="New category name"
                  autoFocus
                  className="flex-1 h-9 rounded-md border border-slate-300 px-3 text-sm"
                />
                <Button size="sm" onClick={() => createCategoryMutation.mutate()} disabled={createCategoryMutation.isPending}>
                  {createCategoryMutation.isPending ? '…' : 'Add'}
                </Button>
                <Button size="sm" variant="ghost" onClick={() => { setShowNewCategory(false); setNewCategoryName(''); }}>
                  ✕
                </Button>
              </div>
            ) : (
              <div className="flex gap-2">
                <select
                  className="flex-1 h-9 rounded-md border border-slate-300 px-2 text-sm"
                  value={categoryId}
                  onChange={e => setCategoryId(e.target.value)}
                >
                  <option value="">— None —</option>
                  {categories.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
                <Button size="sm" variant="ghost" onClick={() => setShowNewCategory(true)}>
                  + New
                </Button>
              </div>
            )}
          </div>

          <Input
            label="Selling price"
            type="number"
            min="0"
            step="0.01"
            value={sellingPrice}
            onChange={e => setSellingPrice(e.target.value)}
          />
        </div>

        {/* Reminder about stock */}
        <div className="rounded border border-blue-200 bg-blue-50 px-3 py-2 text-xs text-blue-800">
          <strong>Opening stock not set here.</strong> Post stock through a normal purchase
          bill so MAC and GL update correctly. The product will start at zero on-hand.
        </div>

        <div className="flex justify-end gap-2 pt-2">
          <Button variant="ghost" onClick={onClose} disabled={createMutation.isPending}>
            Cancel
          </Button>
          <Button
            onClick={() => { setError(null); createMutation.mutate(); }}
            disabled={createMutation.isPending || !sku.trim() || !name.trim()}
          >
            {createMutation.isPending ? 'Creating…' : 'Create & add to line'}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
