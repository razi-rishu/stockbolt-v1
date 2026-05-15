import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Modal } from '@/ui/modal';
import { Input } from '@/ui/input';
import { Button } from '@/ui/button';
import { getAdapter } from '@/data/index';
import { useAuthStore } from '@/store/auth';
import type { ContactInsert } from '@/data/adapter';

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
  const qc = useQueryClient();

  const [name, setName]               = useState(initialName ?? '');
  const [phone, setPhone]             = useState('');
  const [email, setEmail]             = useState('');
  const [taxId, setTaxId]             = useState('');
  const [address, setAddress]         = useState('');
  const [creditLimit, setCreditLimit] = useState('0');
  const [error, setError]             = useState<string | null>(null);

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
        tax_id:       taxId.trim() || null,
        address:      address.trim() || null,
        credit_limit: limit,
        currency:     'AED',           // default; can be changed on detail page
      } as unknown as ContactInsert;

      return getAdapter().contacts.create(row);
    },
    onSuccess: (row) => {
      qc.invalidateQueries({ queryKey: ['contacts'] });
      onCreated(row.id);
      // Reset for the next open
      setName(''); setPhone(''); setEmail('');
      setTaxId(''); setAddress(''); setCreditLimit('0');
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
            label="TRN / Tax ID"
            value={taxId}
            onChange={e => setTaxId(e.target.value)}
          />
          <Input
            label="Credit limit"
            type="number"
            min="0"
            step="0.01"
            value={creditLimit}
            onChange={e => setCreditLimit(e.target.value)}
          />
          <div className="md:col-span-2">
            <Input
              label="Address"
              value={address}
              onChange={e => setAddress(e.target.value)}
            />
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
