import { useState, useEffect } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Modal } from '@/ui/modal';
import { Input } from '@/ui/input';
import { Button } from '@/ui/button';
import { getAdapter } from '@/data/index';
import { useAuthStore } from '@/store/auth';
import type { ContactInsert } from '@/data/adapter';
import { useCompanyCurrency } from '@/hooks/use-company-currency';
import { getRegionLabel } from '@/lib/locale';

// Countries StockBolt localises for (GCC + India). Phase 16.
const COUNTRIES: { code: string; label: string }[] = [
  { code: 'AE', label: 'United Arab Emirates' },
  { code: 'SA', label: 'Saudi Arabia' },
  { code: 'QA', label: 'Qatar' },
  { code: 'OM', label: 'Oman' },
  { code: 'BH', label: 'Bahrain' },
  { code: 'KW', label: 'Kuwait' },
  { code: 'IN', label: 'India' },
];

/**
 * ContactQuickCreate — modal popup for creating a customer or supplier
 * from inside a picker dropdown. After save, calls onCreated(id) so the
 * picker can auto-select the new contact and continue the workflow
 * without a page navigation.
 *
 * Fields kept minimal:
 *   name (required) · phone · email · TRN · address · credit_limit
 *
 * Anything else (Arabic name, payment terms, contact persons) can be
 * filled in later from the contact detail page. The point here is FAST.
 *
 * Accounting: no GL impact — contacts are master data only.
 */

export interface ContactQuickCreateProps {
  open:        boolean;
  type:        'customer' | 'supplier';
  /** Initial name from the search query — auto-populates the Name field. */
  initialName?: string;
  onClose:     () => void;
  onCreated:   (id: string) => void;
}

export function ContactQuickCreate({
  open, type, initialName, onClose, onCreated,
}: ContactQuickCreateProps) {
  const { company_id } = useAuthStore();
  const companyCurrency = useCompanyCurrency();    // Phase 14.14m
  const qc = useQueryClient();

  const [name, setName]               = useState(initialName ?? '');
  const [phone, setPhone]             = useState('');
  const [email, setEmail]             = useState('');
  // VAT/GST registered toggle — UI affordance only. The contacts table has
  // no boolean for this; "registered" is implied by tax_id being present
  // (same convention as statements + print templates). Unchecked → tax_id
  // saved as null.
  const [taxRegistered, setTaxRegistered] = useState(false);
  const [taxId, setTaxId]             = useState('');
  const [address, setAddress]         = useState('');
  const [creditLimit, setCreditLimit] = useState('0');
  const [error, setError]             = useState<string | null>(null);

  // Phase 16 — geography: Country → Region dependent dropdowns.
  const [country, setCountry]   = useState('');
  const [regionId, setRegionId] = useState('');

  // Default the country to the company's country once known.
  const { data: company } = useQuery({
    queryKey: ['company', company_id],
    queryFn: () => getAdapter().companies.getById(company_id!),
    enabled: !!company_id,
  });
  useEffect(() => {
    const cc = (company as { country_code?: string } | null)?.country_code;
    if (cc && !country) setCountry(cc);
  }, [company, country]);

  const { data: regions = [], refetch: refetchRegions } = useQuery({
    queryKey: ['regions', company_id, country],
    queryFn: () => getAdapter().geography.listRegions(company_id!, country),
    enabled: !!company_id && !!country,
  });

  async function handleRegionChange(value: string) {
    if (value === '__new__') {
      const name = window.prompt(`New ${getRegionLabel(country)} name:`);
      if (!name?.trim() || !company_id) return;
      const created = await getAdapter().geography.createRegion(company_id, { country_code: country, region_name: name.trim() });
      await refetchRegions();
      setRegionId(created.id);
    } else {
      setRegionId(value);
    }
  }

  // Reset when the initial name prop changes (different search query)
  useState(() => { if (initialName !== undefined) setName(initialName); });

  const createMutation = useMutation({
    mutationFn: async () => {
      if (!name.trim()) throw new Error('Name is required');
      const limit = parseFloat(creditLimit) || 0;
      if (limit < 0) throw new Error('Credit limit cannot be negative');

      const row = {
        company_id:   company_id!,
        type,
        name:         name.trim(),
        phone:        phone.trim() || null,
        email:        email.trim() || null,
        tax_id:       taxRegistered ? (taxId.trim() || null) : null,
        // contacts has no single `address` column — the quick-create's
        // one-line address goes into address_street; city/country can be
        // filled in later from the contact detail page.
        address_street: address.trim() || null,
        credit_limit: limit,
        currency:     companyCurrency, // Phase 14.14m — company's base currency, editable on detail page
        // Phase 16 — structured geography
        country_code: country || null,
        region_id:    regionId || null,
        address_country: country || null,
      } as unknown as ContactInsert;

      return getAdapter().contacts.create(row);
    },
    onSuccess: (row) => {
      qc.invalidateQueries({ queryKey: ['contacts'] });
      onCreated(row.id);
      // Reset for the next open
      setName(''); setPhone(''); setEmail('');
      setTaxRegistered(false); setTaxId(''); setAddress(''); setCreditLimit('0');
      setRegionId('');
      setError(null);
    },
    onError: (e: Error) => setError(e.message),
  });

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={type === 'customer' ? 'Quick create customer' : 'Quick create supplier'}
      width="lg"
    >
      <div className="space-y-4">
        {error && (
          <div className="rounded border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-700">
            {error}
          </div>
        )}

        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <div className="md:col-span-2">
            <Input
              label="Name *"
              required
              value={name}
              onChange={e => setName(e.target.value)}
              autoFocus
            />
          </div>
          <Input
            label="Phone"
            value={phone}
            onChange={e => setPhone(e.target.value)}
          />
          <Input
            label="Email"
            type="email"
            value={email}
            onChange={e => setEmail(e.target.value)}
          />
          <Input
            label="Credit limit"
            type="number"
            min="0"
            step="0.01"
            value={creditLimit}
            onChange={e => setCreditLimit(e.target.value)}
          />
          <div className="md:col-span-2 flex flex-wrap items-end gap-3">
            <label className="flex items-center gap-2.5 cursor-pointer pb-2">
              <input
                type="checkbox"
                className="h-4 w-4 rounded border-border-strong text-brand-500"
                checked={taxRegistered}
                onChange={e => setTaxRegistered(e.target.checked)}
              />
              <span className="text-sm text-ink-primary whitespace-nowrap">Registered for VAT / GST</span>
            </label>
            {taxRegistered && (
              <div className="flex-1 min-w-[200px]">
                <Input
                  label="TRN / Tax ID"
                  value={taxId}
                  onChange={e => setTaxId(e.target.value)}
                  placeholder="e.g. 100123456700003"
                  autoFocus
                />
              </div>
            )}
          </div>
          <div className="md:col-span-2">
            <Input
              label="Address"
              value={address}
              onChange={e => setAddress(e.target.value)}
            />
          </div>

          {/* Phase 16 — geography */}
          <div>
            <label className="mb-1 block text-xs font-medium text-ink-secondary">Country</label>
            <select
              className="h-9 w-full rounded-input border border-border-subtle bg-surface-input px-2 text-sm text-ink-primary focus:outline-none focus:ring-1 focus:ring-brand-500"
              value={country}
              onChange={e => { setCountry(e.target.value); setRegionId(''); }}
            >
              <option value="">Select country…</option>
              {COUNTRIES.map(c => <option key={c.code} value={c.code}>{c.label}</option>)}
            </select>
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-ink-secondary">{getRegionLabel(country)}</label>
            <select
              className="h-9 w-full rounded-input border border-border-subtle bg-surface-input px-2 text-sm text-ink-primary focus:outline-none focus:ring-1 focus:ring-brand-500 disabled:opacity-50"
              value={regionId}
              disabled={!country}
              onChange={e => handleRegionChange(e.target.value)}
            >
              <option value="">{country ? `Select ${getRegionLabel(country).toLowerCase()}…` : 'Pick a country first'}</option>
              {regions.map(r => <option key={r.id} value={r.id}>{r.region_name}{r.is_system ? '' : ' (custom)'}</option>)}
              {country && <option value="__new__">+ Add new {getRegionLabel(country).toLowerCase()}…</option>}
            </select>
          </div>
        </div>

        <div className="flex justify-end gap-2 pt-2">
          <Button variant="ghost" onClick={onClose} disabled={createMutation.isPending}>
            Cancel
          </Button>
          <Button
            onClick={() => { setError(null); createMutation.mutate(); }}
            disabled={createMutation.isPending || !name.trim()}
          >
            {createMutation.isPending ? 'Creating…' : 'Create & select'}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
