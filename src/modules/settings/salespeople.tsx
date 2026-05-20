import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { getAdapter } from '@/data/index';
import { useAuthStore } from '@/store/auth';
import { Button } from '@/ui/button';
import { Input } from '@/ui/input';
import { PageHeader } from '@/ui/primitives';
import { theme } from '@/ui/theme';
import type { SalespersonRow } from '@/data/adapter';

const fmt = (n: number) => n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

interface FormState {
  name:           string;
  name_ar:        string;
  email:          string;
  phone:          string;
  commission_pct: string;
  notes:          string;
}
const empty: FormState = { name: '', name_ar: '', email: '', phone: '', commission_pct: '0', notes: '' };

/**
 * Salespeople management — Phase 12.16.
 *
 * Master list of sales staff that get tagged on invoices and quotes
 * for performance and commission reporting. Independent of profiles
 * (auth users) — a salesperson doesn't need to log in.
 *
 * - Active rows appear in invoice/quote Salesperson dropdowns.
 * - Deactivating a salesperson hides them from new pickers but does
 *   NOT remove them from historical sales (FK is ON DELETE SET NULL,
 *   and we soft-delete via is_active flag).
 */
export default function SalespeoplePage() {
  const qc = useQueryClient();
  const { company_id } = useAuthStore();

  const [showInactive, setShowInactive] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<FormState>(empty);
  const [showForm, setShowForm] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const { data: rows = [], isLoading } = useQuery<SalespersonRow[]>({
    queryKey: ['salespeople', company_id, showInactive],
    queryFn:  () => getAdapter().salespeople.list(company_id!, { include_inactive: showInactive }),
    enabled:  !!company_id,
  });

  function startNew() {
    setEditingId(null);
    setForm(empty);
    setError(null);
    setShowForm(true);
  }
  function startEdit(r: SalespersonRow) {
    setEditingId(r.id);
    setForm({
      name:            r.name,
      name_ar:         r.name_ar ?? '',
      email:           r.email ?? '',
      phone:           r.phone ?? '',
      commission_pct:  String(r.commission_pct ?? 0),
      notes:           r.notes ?? '',
    });
    setError(null);
    setShowForm(true);
  }
  function cancel() {
    setShowForm(false);
    setEditingId(null);
    setForm(empty);
    setError(null);
  }

  const saveMutation = useMutation({
    mutationFn: async () => {
      if (!form.name.trim()) throw new Error('Name is required');
      const pct = parseFloat(form.commission_pct) || 0;
      if (pct < 0 || pct > 100) throw new Error('Commission % must be between 0 and 100');

      const payload = {
        name:           form.name.trim(),
        name_ar:        form.name_ar.trim() || null,
        email:          form.email.trim() || null,
        phone:          form.phone.trim() || null,
        commission_pct: pct,
        notes:          form.notes.trim() || null,
      };

      if (editingId) {
        await getAdapter().salespeople.update(editingId, payload);
      } else {
        await getAdapter().salespeople.create({
          company_id: company_id!,
          is_active:  true,
          ...payload,
        });
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['salespeople'] });
      cancel();
    },
    onError: (e: Error) => setError(e.message),
  });

  const deactivateMutation = useMutation({
    mutationFn: (id: string) => getAdapter().salespeople.deactivate(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['salespeople'] }),
    onError: (e: Error) => setError(e.message),
  });
  const activateMutation = useMutation({
    mutationFn: (id: string) => getAdapter().salespeople.activate(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['salespeople'] }),
    onError: (e: Error) => setError(e.message),
  });

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
      <PageHeader
        title="Salespeople"
        subtitle="Master list of sales staff. Tagged on invoices and quotes for performance reports."
        actions={!showForm ? <Button onClick={startNew}>+ Add salesperson</Button> : undefined}
      />

      {error && (
        <div style={{
          background: theme.dangerSoft, border: `1px solid ${theme.dangerBorder}`,
          borderRadius: '8px', padding: '10px 16px', fontSize: '13px', color: theme.danger,
        }}>
          {error}
        </div>
      )}

      {/* Form (add / edit) */}
      {showForm && (
        <div className="rounded-card border border-border-subtle bg-surface-card p-5 space-y-4">
          <h2 className="text-sm font-semibold text-ink-primary">
            {editingId ? 'Edit salesperson' : 'New salesperson'}
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <Input label="Name *" required value={form.name}
              onChange={e => setForm(f => ({ ...f, name: e.target.value }))} />
            <Input label="Name (Arabic)" value={form.name_ar}
              onChange={e => setForm(f => ({ ...f, name_ar: e.target.value }))} />
            <Input label="Email" type="email" value={form.email}
              onChange={e => setForm(f => ({ ...f, email: e.target.value }))} />
            <Input label="Phone" value={form.phone}
              onChange={e => setForm(f => ({ ...f, phone: e.target.value }))} />
            <Input label="Commission %" type="number" min="0" max="100" step="0.01"
              value={form.commission_pct}
              onChange={e => setForm(f => ({ ...f, commission_pct: e.target.value }))} />
            <Input label="Notes" value={form.notes}
              onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} />
          </div>
          <div className="flex gap-2 pt-2">
            <Button variant="ghost" onClick={cancel}>Cancel</Button>
            <Button onClick={() => { setError(null); saveMutation.mutate(); }}
              disabled={saveMutation.isPending}>
              {saveMutation.isPending ? 'Saving…' : 'Save'}
            </Button>
          </div>
        </div>
      )}

      {/* Show-inactive toggle */}
      <label className="flex items-center gap-2 text-sm text-slate-600">
        <input type="checkbox" checked={showInactive}
          onChange={e => setShowInactive(e.target.checked)} />
        Show inactive
      </label>

      {/* List */}
      <div className="rounded-card border border-border-subtle bg-surface-card overflow-hidden">
        {isLoading ? (
          <p className="p-8 text-center text-sm text-slate-400">Loading…</p>
        ) : rows.length === 0 ? (
          <p className="p-8 text-center text-sm text-slate-500">
            No salespeople yet. Click <strong>Add salesperson</strong> above to create your first one.
          </p>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-surface-muted">
              <tr>
                <th className="px-4 py-2 text-left text-xs font-medium text-ink-secondary">Name</th>
                <th className="px-4 py-2 text-left text-xs font-medium text-ink-secondary">Email</th>
                <th className="px-4 py-2 text-left text-xs font-medium text-ink-secondary">Phone</th>
                <th className="px-4 py-2 text-right text-xs font-medium text-ink-secondary">Commission %</th>
                <th className="px-4 py-2 text-center text-xs font-medium text-ink-secondary">Status</th>
                <th className="px-4 py-2"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border-subtle">
              {rows.map(r => (
                <tr key={r.id} className={r.is_active ? '' : 'opacity-50'}>
                  <td className="px-4 py-2 text-ink-primary">
                    {r.name}
                    {r.name_ar && <span className="ms-2 text-xs text-ink-tertiary">({r.name_ar})</span>}
                  </td>
                  <td className="px-4 py-2 text-ink-secondary">{r.email ?? '—'}</td>
                  <td className="px-4 py-2 text-ink-secondary">{r.phone ?? '—'}</td>
                  <td className="px-4 py-2 text-right font-mono">{fmt(Number(r.commission_pct))}</td>
                  <td className="px-4 py-2 text-center">
                    <span className={`rounded-pill px-2 py-0.5 text-xs font-medium ${
                      r.is_active ? 'bg-emerald-50 text-emerald-700' : 'bg-gray-100 text-gray-600'
                    }`}>{r.is_active ? 'Active' : 'Inactive'}</span>
                  </td>
                  <td className="px-4 py-2 text-right whitespace-nowrap">
                    <Button variant="ghost" size="sm" onClick={() => startEdit(r)}>Edit</Button>
                    {r.is_active ? (
                      <Button variant="ghost" size="sm" className="text-red-600"
                        onClick={() => { if (window.confirm(`Deactivate "${r.name}"? They will be hidden from new invoice/quote pickers but stay on historical sales.`)) deactivateMutation.mutate(r.id); }}>
                        Deactivate
                      </Button>
                    ) : (
                      <Button variant="ghost" size="sm" onClick={() => activateMutation.mutate(r.id)}>
                        Reactivate
                      </Button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
