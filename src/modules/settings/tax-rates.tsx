/**
 * Tax Rates settings — Phase 14.17 (upgraded from read-only to full CRUD).
 *
 * - Lists all active + inactive rates for the company
 * - "Seed UAE defaults" button inserts Standard 5%, Zero-rated, Exempt when missing
 * - "+ Add rate" lets you create custom rates
 * - Toggle active/inactive inline
 */
import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { getAdapter } from '@/data/index';
import { useAuthStore } from '@/store/auth';
import { Button } from '@/ui/button';
import { Input } from '@/ui/input';
import { Badge } from '@/ui/badge';
import { PageHeader, Panel } from '@/ui/primitives';
import { theme } from '@/ui/theme';
import ImportExportButton from '@/modules/settings/import-export/ImportExportButton';
import type { TaxRateRow } from '@/data/adapter';

const CATEGORY_LABEL: Record<string, string> = {
  standard:    'Standard',
  zero_rated:  'Zero-rated',
  exempt:      'Exempt',
};

const CATEGORY_HINT: Record<string, string> = {
  standard:    'Default VAT rate (e.g. UAE 5%) — most goods and services.',
  zero_rated:  'Taxable at 0% — exports, certain education / healthcare. Reported on VAT return.',
  exempt:      'Outside the VAT system — financial services, residential rent. Not on VAT return.',
};

const TAX_TYPES = ['standard', 'zero_rated', 'exempt'] as const;

interface DraftRate {
  name: string;
  tax_type: string;
  rate: string;
}

export default function TaxRatesSettingsPage() {
  const { company_id } = useAuthStore();
  const qc = useQueryClient();

  // Fetch ALL rates (active + inactive) for management view
  const { data: rates = [], isLoading } = useQuery<TaxRateRow[]>({
    queryKey: ['taxRates_all', company_id],
    queryFn:  () => getAdapter().taxRates.listAll(company_id!),
    enabled:  !!company_id,
  });

  const [showAdd, setShowAdd] = useState(false);
  const [draft, setDraft] = useState<DraftRate>({ name: '', tax_type: 'standard', rate: '5' });
  const [seedError, setSeedError] = useState<string | null>(null);

  // Seed defaults
  const seedMut = useMutation({
    mutationFn: () => getAdapter().taxRates.seedDefaults(company_id!),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['taxRates', company_id] });
      qc.invalidateQueries({ queryKey: ['taxRates_all', company_id] });
      setSeedError(null);
    },
    onError: (e: Error) => setSeedError(e.message),
  });

  // Create new rate
  const createMut = useMutation({
    mutationFn: () => getAdapter().taxRates.create({
      company_id: company_id!,
      name:       draft.name.trim(),
      tax_type:   draft.tax_type,
      rate:       parseFloat(draft.rate) || 0,
      is_active:  true,
    }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['taxRates', company_id] });
      qc.invalidateQueries({ queryKey: ['taxRates_all', company_id] });
      setShowAdd(false);
      setDraft({ name: '', tax_type: 'standard', rate: '5' });
    },
  });

  // Toggle active/inactive
  const toggleMut = useMutation({
    mutationFn: ({ id, is_active }: { id: string; is_active: boolean }) =>
      getAdapter().taxRates.update(id, { is_active }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['taxRates', company_id] });
      qc.invalidateQueries({ queryKey: ['taxRates_all', company_id] });
    },
  });

  const activeRates = rates.filter(r => r.is_active);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
      <PageHeader
        title="Tax Rates"
        subtitle={`${activeRates.length} active rate${activeRates.length === 1 ? '' : 's'} — applied to invoice / quote / bill lines and reported on the VAT return.`}
        crumb="Settings · Sales"
        actions={
          <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
            <Button
              variant="secondary"
              size="sm"
              onClick={() => seedMut.mutate()}
              disabled={seedMut.isPending}
            >
              {seedMut.isPending ? 'Seeding…' : '⚡ Seed UAE defaults'}
            </Button>
            <Button size="sm" onClick={() => setShowAdd(true)}>+ Add rate</Button>
            <ImportExportButton moduleKey="taxRates" />
          </div>
        }
      />

      {seedError && (
        <div style={{ background: theme.dangerSoft, border: `1px solid ${theme.dangerBorder}`, borderRadius: '8px', padding: '10px 16px', fontSize: '13px', color: theme.danger }}>
          {seedError}
        </div>
      )}

      {/* Add new rate form */}
      {showAdd && (
        <Panel icon="➕" title="New tax rate">
          <div className="grid grid-cols-1 items-end gap-3 sm:grid-cols-2 lg:grid-cols-[1fr_1fr_120px_auto]">
            <Input
              label="Name"
              value={draft.name}
              onChange={e => setDraft(d => ({ ...d, name: e.target.value }))}
              placeholder="e.g. VAT 5%"
            />
            <div>
              <label style={{ fontSize: '12px', fontWeight: 600, color: theme.inkMuted, display: 'block', marginBottom: '4px' }}>Category</label>
              <select
                value={draft.tax_type}
                onChange={e => setDraft(d => ({ ...d, tax_type: e.target.value }))}
                style={{ width: '100%', padding: '8px 10px', border: `1px solid ${theme.border}`, borderRadius: '6px', fontSize: '13px', background: '#fff' }}
              >
                {TAX_TYPES.map(t => (
                  <option key={t} value={t}>{CATEGORY_LABEL[t]}</option>
                ))}
              </select>
            </div>
            <Input
              label="Rate %"
              type="number"
              value={draft.rate}
              onChange={e => setDraft(d => ({ ...d, rate: e.target.value }))}
              placeholder="5"
            />
            <div style={{ display: 'flex', gap: '8px', paddingBottom: '2px' }}>
              <Button
                size="sm"
                onClick={() => createMut.mutate()}
                disabled={createMut.isPending || !draft.name.trim()}
              >
                {createMut.isPending ? 'Saving…' : 'Save'}
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setShowAdd(false)}>Cancel</Button>
            </div>
          </div>
          {createMut.isError && (
            <div style={{ marginTop: '8px', fontSize: '12px', color: theme.danger }}>
              {(createMut.error as Error).message}
            </div>
          )}
        </Panel>
      )}

      <Panel icon="📊" title="Configured rates">
        {isLoading ? (
          <div style={{ padding: '24px 0', textAlign: 'center', fontSize: '13px', color: theme.inkFaint }}>Loading…</div>
        ) : rates.length === 0 ? (
          <div style={{ padding: '32px 0', textAlign: 'center', fontSize: '13px', color: theme.inkFaint }}>
            No tax rates yet.{' '}
            <button
              onClick={() => seedMut.mutate()}
              style={{ color: theme.brand, background: 'none', border: 'none', cursor: 'pointer', textDecoration: 'underline', fontSize: '13px' }}
            >
              Seed UAE defaults (VAT 5%, Zero-rated, Exempt)
            </button>
          </div>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}>
            <thead>
              <tr style={{ borderBottom: `1px solid ${theme.border}` }}>
                {['Name', 'Category', 'Rate', 'Status', ''].map(h => (
                  <th key={h} style={{ padding: '8px 12px', textAlign: h === 'Rate' ? 'right' : 'left', fontSize: '11px', fontWeight: 700, color: theme.inkMuted, textTransform: 'uppercase', letterSpacing: '0.05em' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rates.map(r => (
                <tr key={r.id} style={{ borderBottom: `1px solid ${theme.border}`, opacity: r.is_active ? 1 : 0.5 }}>
                  <td style={{ padding: '10px 12px', fontWeight: 600, color: theme.ink }}>{r.name}</td>
                  <td style={{ padding: '10px 12px', color: theme.inkMuted }}>{CATEGORY_LABEL[r.tax_type] ?? r.tax_type}</td>
                  <td style={{ padding: '10px 12px', textAlign: 'right', fontFamily: 'monospace', fontWeight: 600, color: theme.ink }}>{Number(r.rate).toFixed(2)}%</td>
                  <td style={{ padding: '10px 12px' }}>
                    <Badge variant={r.is_active ? 'success' : 'muted'}>{r.is_active ? 'Active' : 'Inactive'}</Badge>
                  </td>
                  <td style={{ padding: '10px 12px', textAlign: 'right' }}>
                    <button
                      onClick={() => toggleMut.mutate({ id: r.id, is_active: !r.is_active })}
                      disabled={toggleMut.isPending}
                      style={{ fontSize: '12px', color: theme.inkMuted, background: 'none', border: 'none', cursor: 'pointer', textDecoration: 'underline' }}
                    >
                      {r.is_active ? 'Deactivate' : 'Activate'}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Panel>

      <Panel icon="📚" title="What each category means">
        <ul style={{ margin: 0, padding: 0, listStyle: 'none', display: 'flex', flexDirection: 'column', gap: '10px' }}>
          {TAX_TYPES.map(cat => (
            <li key={cat} style={{ display: 'flex', gap: '12px', alignItems: 'flex-start' }}>
              <span style={{
                fontSize: '11px', fontWeight: 700, color: theme.brandSoftText,
                background: theme.brandSoft, padding: '2px 8px', borderRadius: '999px',
                whiteSpace: 'nowrap', flexShrink: 0,
              }}>{CATEGORY_LABEL[cat]}</span>
              <span style={{ fontSize: '13px', color: theme.ink }}>{CATEGORY_HINT[cat]}</span>
            </li>
          ))}
        </ul>
      </Panel>
    </div>
  );
}
