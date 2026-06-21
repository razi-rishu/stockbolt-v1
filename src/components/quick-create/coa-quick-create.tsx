/**
 * CoaQuickCreate — Phase 13.02b.
 *
 * Modal popup for creating a chart-of-accounts row from inside any picker
 * dropdown. After save, calls onCreated(coaRow) so the host can auto-select
 * the new account.
 *
 * Designed to be reused everywhere a CoA dropdown lives — the expense line
 * picker (where it'll mostly create 6xxx operating accounts), the bank
 * account settings page (1xxx assets), the JE editor, etc. Caller pre-sets
 * `defaultType` + `defaultSubType` so the modal opens in the right preset
 * but the user can override.
 *
 * Fields kept minimal:
 *   Code (required) · Name (required) · Type · Sub-type · Active toggle
 *
 * NOT included (kept for the full CoA editor):
 *   - Parent account (hierarchy)
 *   - Arabic name (rarely needed for quick-create — edit later)
 *   - is_system flag (server-only)
 */
import { useState, useEffect } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Modal } from '@/ui/modal';
import { Input } from '@/ui/input';
import { Button } from '@/ui/button';
import { getAdapter } from '@/data/index';
import { useAuthStore } from '@/store/auth';
import { theme } from '@/ui/theme';
import type { CoaInsert, CoaRow } from '@/data/adapter';

// Mirrors the FLAT_TYPES list in the CoA editor so the picker UX is
// consistent. value = key, type/sub_type = what we actually write.
const TYPE_PRESETS: Array<{ value: string; label: string; type: string; sub_type: string | null }> = [
  { value: 'current_asset',         label: 'Current Asset',                  type: 'asset',     sub_type: 'current'   },
  { value: 'fixed_asset',           label: 'Fixed Asset',                    type: 'asset',     sub_type: 'fixed'     },
  { value: 'current_liability',     label: 'Current Liability',              type: 'liability', sub_type: 'current'   },
  { value: 'long_term_liability',   label: 'Long-term Liability',            type: 'liability', sub_type: 'long_term' },
  { value: 'equity',                label: 'Equity',                         type: 'equity',    sub_type: null        },
  { value: 'direct_income',         label: 'Direct Income (Sales)',          type: 'income',    sub_type: 'direct'    },
  { value: 'indirect_income',       label: 'Indirect Income (Other)',        type: 'income',    sub_type: 'indirect'  },
  { value: 'direct_expense',        label: 'Direct Expense (COGS)',          type: 'expense',   sub_type: 'direct'    },
  { value: 'indirect_expense',      label: 'Indirect Expense (Operating)',   type: 'expense',   sub_type: 'indirect'  },
];

// First digit of the code range per preset (StockBolt standard CoA numbering).
const PRESET_PREFIX: Record<string, string> = {
  current_asset: '1', fixed_asset: '1',
  current_liability: '2', long_term_liability: '2',
  equity: '3',
  direct_income: '4', indirect_income: '4',
  direct_expense: '5', indirect_expense: '6',
};

/** Suggest the next free 4-digit code in the preset's range (e.g. 6860). */
function suggestCode(preset: string, existing: string[]): string {
  const prefix = PRESET_PREFIX[preset] ?? '6';
  const taken = new Set(existing);
  const nums = existing.filter(c => /^\d{4}$/.test(c) && c.startsWith(prefix)).map(Number);
  const base = nums.length ? Math.max(...nums) : Number(prefix + '099');
  let cand = Math.ceil((base + 1) / 10) * 10;          // round up to a tidy x10
  while (taken.has(String(cand)) && cand < Number(prefix + '999')) cand += 10;
  while (taken.has(String(cand))) cand += 1;            // fall back to +1 if x10s exhausted
  return String(cand);
}

export interface CoaQuickCreateProps {
  open:        boolean;
  /** Pre-selected preset (e.g. 'indirect_expense' for the expense editor). */
  defaultPreset?: string;
  /** Initial value for the Name input — usually the host's search query. */
  initialName?: string;
  onClose:     () => void;
  onCreated:   (row: CoaRow) => void;
}

export function CoaQuickCreate({
  open, defaultPreset = 'indirect_expense', initialName = '', onClose, onCreated,
}: CoaQuickCreateProps) {
  const { company_id } = useAuthStore();
  const qc = useQueryClient();

  const [preset, setPreset] = useState(defaultPreset);
  const [code, setCode]     = useState('');
  const [name, setName]     = useState(initialName);
  const [isActive, setIsActive] = useState(true);
  const [error, setError]   = useState<string | null>(null);

  // Existing codes — so we can auto-suggest the next free one (the user no
  // longer has to know the numbering scheme).
  const { data: coaList = [] } = useQuery<CoaRow[]>({
    queryKey: ['coa', company_id],
    queryFn:  () => getAdapter().coa.list(company_id!),
    enabled:  !!company_id && open,
  });
  const existingCodes = coaList.map(c => c.code);

  // Reset whenever the modal opens (fresh state per open).
  useEffect(() => {
    if (open) {
      setPreset(defaultPreset);
      setName(initialName);
      setIsActive(true);
      setError(null);
    }
  }, [open, defaultPreset, initialName]);

  // Auto-fill the code with the next free one whenever the modal opens or the
  // preset (range) changes. The user can still type their own.
  useEffect(() => {
    if (open) setCode(suggestCode(preset, existingCodes));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, preset, coaList.length]);

  const saveMutation = useMutation({
    mutationFn: async () => {
      if (!code.trim()) throw new Error('Code is required (e.g. 6500)');
      if (!name.trim()) throw new Error('Name is required');
      const p = TYPE_PRESETS.find(t => t.value === preset);
      if (!p) throw new Error('Pick an account type');
      const row: CoaInsert = {
        company_id: company_id!,
        code: code.trim(),
        name: name.trim(),
        name_ar: null,
        type: p.type,
        sub_type: p.sub_type,
        parent_id: null,
        is_active: isActive,
        is_system: false,
      };
      return getAdapter().coa.create(row);
    },
    onSuccess: (created) => {
      // Invalidate every CoA query so all open pickers refresh their
      // dropdowns. Then hand the new row back to the caller.
      qc.invalidateQueries({ queryKey: ['coa', company_id] });
      qc.invalidateQueries({ queryKey: ['coa'] });
      onCreated(created);
    },
    onError: (e: Error) => setError(e.message),
  });

  return (
    <Modal open={open} onClose={onClose} title="Add new account" width="md">
      <form
        onSubmit={(e) => { e.preventDefault(); setError(null); saveMutation.mutate(); }}
        className="flex flex-col gap-4"
      >
        {/* Preset */}
        <div className="flex flex-col gap-1">
          <label style={{
            fontSize: '11px', fontWeight: 600, color: theme.inkMuted,
            textTransform: 'uppercase', letterSpacing: '.05em',
          }}>Type <span style={{ color: theme.danger }}>*</span></label>
          <select
            value={preset}
            onChange={e => setPreset(e.target.value)}
            style={{
              padding: '8px 30px 8px 10px', fontSize: '13px',
              border: `1px solid ${theme.border}`, borderRadius: '7px',
              background: '#fff', color: theme.ink, outline: 'none',
              appearance: 'none',
              backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 24 24' fill='none' stroke='%2394a3b8' stroke-width='2'%3E%3Cpolyline points='6 9 12 15 18 9'/%3E%3C/svg%3E")`,
              backgroundRepeat: 'no-repeat',
              backgroundPosition: 'right 10px center',
              cursor: 'pointer',
            }}
          >
            {TYPE_PRESETS.map(p => (
              <option key={p.value} value={p.value}>{p.label}</option>
            ))}
          </select>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <Input label="Code" required value={code} onChange={e => setCode(e.target.value)} placeholder="e.g. 6500" />
          <Input label="Name" required value={name} onChange={e => setName(e.target.value)} placeholder="e.g. Office Supplies" />
        </div>

        <label className="flex items-center gap-2 cursor-pointer select-none">
          <input
            type="checkbox"
            checked={isActive}
            onChange={e => setIsActive(e.target.checked)}
            className="h-4 w-4"
          />
          <span style={{ fontSize: '13px', color: theme.ink }}>Active</span>
        </label>

        {error && (
          <div style={{
            background: theme.dangerSoft, border: `1px solid ${theme.dangerBorder}`,
            borderRadius: '8px', padding: '8px 12px', fontSize: '12px', color: theme.danger,
          }}>{error}</div>
        )}

        <div className="flex justify-end gap-3 pt-2">
          <Button type="button" variant="secondary" onClick={onClose}>Cancel</Button>
          <Button type="submit" loading={saveMutation.isPending}>Add account</Button>
        </div>
      </form>
    </Modal>
  );
}
