import { getAdapter } from '@/data/index';
import { useAuthStore } from '@/store/auth';
import { SmartEntitySearch, highlightMatch } from './smart-entity-search';
import type { ContactSearchRow, ContactRow } from '@/data/adapter';

/**
 * ContactPicker — thin wrapper around SmartEntitySearch for customers
 * and suppliers. Used on every editor that picks a contact.
 *
 * Search is server-side (D1 search_contacts RPC). Dropdown shows:
 *   Name (highlighted) ............... TRN/Tax ID
 *   phone · credit limit
 *
 * Outstanding / overdue / last payment are deliberately NOT in the
 * dropdown — they live on the customer/supplier insight panel that
 * appears below once the contact is picked. Keeps search fast.
 */
export interface ContactPickerProps {
  type:        'customer' | 'supplier';
  value:       string | null | undefined;
  onChange:    (id: string | null) => void;
  disabled?:   boolean;
  placeholder?: string;
  panelWidth?: number;
}

export function ContactPicker({
  type, value, onChange, disabled, placeholder, panelWidth = 380,
}: ContactPickerProps) {
  const { company_id } = useAuthStore();
  const label = type === 'customer' ? 'customer' : 'supplier';

  return (
    <SmartEntitySearch<ContactSearchRow>
      value={value}
      disabled={disabled}
      placeholder={placeholder ?? `Search ${label}, phone, TRN…`}
      panelWidth={panelWidth}
      recentKey={company_id ? `recent_${type}::${company_id}` : undefined}
      search={(q) => getAdapter().contacts.smartSearch({
        company_id: company_id!,
        q,
        type,
        limit: 20,
      })}
      resolveById={async (id) => {
        const row = await getAdapter().contacts.getById(id);
        if (!row) return null;
        return contactRowToSearchRow(row);
      }}
      onChange={(id) => onChange(id ?? null)}
      getDisplayLabel={(row) => row.name}
      getKey={(row) => row.id}
      renderRow={(row, { query }) => (
        <div className="space-y-0.5">
          <div className="flex items-baseline justify-between gap-2">
            <span className="text-xs font-medium text-ink-primary truncate">
              {highlightMatch(row.name, query)}
            </span>
            {row.tax_id && (
              <span className="text-[10px] font-mono text-ink-tertiary flex-none">
                TRN {highlightMatch(row.tax_id, query)}
              </span>
            )}
          </div>
          <div className="flex gap-2 text-[10px] text-ink-tertiary">
            {row.phone && <span>📞 {highlightMatch(row.phone, query)}</span>}
            {row.email && <span>✉ {row.email}</span>}
            {Number(row.credit_limit) > 0 && (
              <span>Limit {Number(row.credit_limit).toLocaleString('en-US', { minimumFractionDigits: 0 })}</span>
            )}
          </div>
        </div>
      )}
    />
  );
}

/** Convert a full ContactRow (from getById) to the SearchRow shape so the
 *  picker can resolve the selected label without an extra RPC. */
function contactRowToSearchRow(row: ContactRow): ContactSearchRow {
  return {
    id:           row.id,
    type:         row.type,
    name:         row.name,
    name_ar:      row.name_ar,
    phone:        row.phone,
    email:        row.email,
    tax_id:       row.tax_id,
    credit_limit: Number(row.credit_limit ?? 0),
    match_rank:   0,
  };
}
