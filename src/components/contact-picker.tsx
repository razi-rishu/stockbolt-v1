import { useState } from 'react';
import { getAdapter } from '@/data/index';
import { useAuthStore } from '@/store/auth';
import { SmartEntitySearch, highlightMatch } from './smart-entity-search';
import { ContactQuickCreate } from './quick-create/contact-quick-create';
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

  // Quick Create modal state
  const [qcOpen, setQcOpen] = useState(false);
  const [qcSeed, setQcSeed] = useState('');

  return (
    <>
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
      emptyState={(query) => (
        <button
          type="button"
          onClick={() => { setQcSeed(query); setQcOpen(true); }}
          className="flex w-full items-center gap-2 text-xs font-medium text-brand-600 hover:text-brand-700"
        >
          <span className="flex h-4 w-4 items-center justify-center rounded-full bg-brand-100 text-brand-700">+</span>
          Add new {label}{query ? ` "${query}"` : ''}
        </button>
      )}
      renderRow={(row, { highlighted, query }) => {
        const titleCls  = highlighted ? 'text-white'      : 'text-ink-primary';
        const subCls    = highlighted ? 'text-white/80'   : 'text-ink-tertiary';
        const limitCls  = highlighted ? 'text-white/90'   : 'text-ink-secondary';
        return (
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0 flex-1">
              <div className={`text-sm font-medium truncate ${titleCls}`}>
                {highlightMatch(row.name, query)}
              </div>
              <div className={`mt-0.5 text-[11px] truncate ${subCls}`}>
                {row.phone && <>📞 {highlightMatch(row.phone, query)}</>}
                {row.email && <> · ✉ {row.email}</>}
                {row.tax_id && <> · TRN {highlightMatch(row.tax_id, query)}</>}
              </div>
            </div>
            {Number(row.credit_limit) > 0 && (
              <div className="flex-none text-end">
                <div className={`text-[10px] uppercase tracking-wide ${subCls}`}>
                  Credit Limit
                </div>
                <div className={`text-sm font-semibold ${limitCls}`}>
                  {Number(row.credit_limit).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                </div>
              </div>
            )}
          </div>
        );
      }}
    />
    <ContactQuickCreate
      open={qcOpen}
      type={type}
      initialName={qcSeed}
      onClose={() => setQcOpen(false)}
      onCreated={(id) => { setQcOpen(false); onChange(id); }}
    />
    </>
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
