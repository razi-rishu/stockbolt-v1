/**
 * Tax rates settings — Phase 12.45.
 *
 * Read-only listing of VAT rates currently configured for the company.
 * Full CRUD is deferred until the adapter exposes create/update — for
 * now the seed migration ships UAE 5% / Zero-rated / Exempt and the
 * page documents what each rate does. A clear "Coming soon: editable"
 * banner sets expectations.
 */
import { useQuery } from '@tanstack/react-query';
import { getAdapter } from '@/data/index';
import { useAuthStore } from '@/store/auth';
import { Table, type Column } from '@/ui/table';
import { Badge } from '@/ui/badge';
import { PageHeader, Panel } from '@/ui/primitives';
import { theme } from '@/ui/theme';
import ImportExportButton from '@/modules/settings/import-export/ImportExportButton';
import type { TaxRateRow } from '@/data/adapter';

// tax_type values used by the seed migration. UI displays a friendly label
// and a short description so non-accountants understand the categories.
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

export default function TaxRatesSettingsPage() {
  const { company_id } = useAuthStore();
  const { data: rates = [], isLoading } = useQuery<TaxRateRow[]>({
    queryKey: ['taxRates', company_id],
    queryFn:  () => getAdapter().taxRates.list(company_id!),
    enabled:  !!company_id,
  });

  const columns: Column<TaxRateRow>[] = [
    { key: 'name', header: 'Name', render: (r) => <span style={{ fontWeight: 600, color: theme.ink }}>{r.name}</span> },
    { key: 'category', header: 'Category', width: '140px', render: (r) => (
      <span style={{ fontSize: '12px', color: theme.inkMuted }}>{CATEGORY_LABEL[r.tax_type] ?? r.tax_type}</span>
    ) },
    { key: 'rate', header: 'Rate', align: 'end', width: '100px', render: (r) => (
      <span className="font-mono" style={{ fontWeight: 600, color: theme.ink }}>{Number(r.rate).toFixed(2)}%</span>
    ) },
    { key: 'status', header: '', width: '80px', render: (r) => (
      <Badge variant={r.is_active ? 'success' : 'muted'}>{r.is_active ? 'Active' : 'Inactive'}</Badge>
    ) },
    { key: 'description', header: 'Notes', render: (r) => (
      <span style={{ fontSize: '12px', color: theme.inkMuted }}>{CATEGORY_HINT[r.tax_type] ?? ''}</span>
    ) },
  ];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
      <PageHeader
        title="Tax Rates"
        subtitle={`${rates.length} rate${rates.length === 1 ? '' : 's'} configured — applied to invoice / quote / bill lines and reported on the VAT return.`}
        crumb="Settings · Sales"
        actions={<ImportExportButton moduleKey="taxRates" />}
      />

      <div style={{
        background: theme.warnSoft, border: `1px solid ${theme.warnBorder}`,
        borderRadius: '8px', padding: '10px 16px', fontSize: '13px', color: theme.warn,
      }}>
        <strong>Read-only for now.</strong> The default UAE rates (Standard 5%, Zero-rated, Exempt) ship with every new company.
        Editing and adding custom rates lands in a follow-up phase.
      </div>

      <Panel icon="📊" title="Configured rates">
        {isLoading
          ? <div style={{ padding: '24px 0', textAlign: 'center', fontSize: '13px', color: theme.inkFaint }}>Loading…</div>
          : <Table columns={columns} rows={rates} keyFn={(r) => r.id} emptyMessage="No tax rates configured. Run the company setup wizard to seed defaults." />
        }
      </Panel>

      <Panel icon="📚" title="What each category means">
        <ul style={{ margin: 0, padding: 0, listStyle: 'none', display: 'flex', flexDirection: 'column', gap: '10px' }}>
          {(['standard', 'zero_rated', 'exempt'] as const).map((cat) => (
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
