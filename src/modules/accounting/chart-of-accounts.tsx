import { useState, useEffect, useRef } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { getAdapter } from '@/data/index';
import { useAuthStore } from '@/store/auth';
import { Button } from '@/ui/button';
import { Input } from '@/ui/input';
import { Modal } from '@/ui/modal';
import ImportExportButton from '@/modules/settings/import-export/ImportExportButton';
import type { CoaRow } from '@/data/adapter';
import { useFormInvalidBanner } from '@/hooks/use-form-invalid-banner';
import { FormErrorBanner } from '@/ui/form-error-banner';
import { useCompanyCurrency } from '@/hooks/use-company-currency';

// ─── Flat 9-option Type dropdown ─────────────────────────────────────────────
// User-facing values map to (DB type, DB sub_type) tuples. The DB CHECK
// constraint stays ('asset','liability','equity','income','expense') — the
// finer Direct/Indirect and Current/Fixed/Long-term distinctions live in
// the existing sub_type column. This way the schema stays canonical while
// the UI is one-click.
type FlatType =
  | 'current_asset'
  | 'fixed_asset'
  | 'current_liability'
  | 'long_term_liability'
  | 'equity'
  | 'direct_income'
  | 'indirect_income'
  | 'direct_expense'
  | 'indirect_expense';

interface FlatTypeMeta {
  value: FlatType;
  label: string;
  type: 'asset' | 'liability' | 'equity' | 'income' | 'expense';
  sub_type: string | null;
  /** Section header used to group the COA list display */
  group: string;
  /** Tailwind classes for the row pill */
  pill: string;
  /** Sort key controlling section order */
  order: number;
}

const FLAT_TYPES: FlatTypeMeta[] = [
  { value: 'current_asset',         label: 'Current Asset',                  type: 'asset',     sub_type: 'current',   group: 'Current Assets',         pill: 'bg-blue-50 text-blue-700',     order: 1 },
  { value: 'fixed_asset',           label: 'Fixed Asset',                    type: 'asset',     sub_type: 'fixed',     group: 'Fixed Assets',           pill: 'bg-blue-50 text-blue-700',     order: 2 },
  { value: 'current_liability',     label: 'Current Liability',              type: 'liability', sub_type: 'current',   group: 'Current Liabilities',    pill: 'bg-red-50 text-red-700',       order: 3 },
  { value: 'long_term_liability',   label: 'Long-term Liability',            type: 'liability', sub_type: 'long_term', group: 'Long-term Liabilities',  pill: 'bg-red-50 text-red-700',       order: 4 },
  { value: 'equity',                label: 'Equity',                         type: 'equity',    sub_type: null,        group: 'Equity',                 pill: 'bg-purple-50 text-purple-700', order: 5 },
  { value: 'direct_income',         label: 'Direct Income (Sales)',          type: 'income',    sub_type: 'direct',    group: 'Direct Income',          pill: 'bg-green-50 text-green-700',   order: 6 },
  { value: 'indirect_income',       label: 'Indirect Income (Other Income)', type: 'income',    sub_type: 'indirect',  group: 'Indirect Income',        pill: 'bg-green-50 text-green-700',   order: 7 },
  { value: 'direct_expense',        label: 'Direct Expense (COGS)',          type: 'expense',   sub_type: 'direct',    group: 'Direct Expense (COGS)',  pill: 'bg-amber-50 text-amber-700',   order: 8 },
  { value: 'indirect_expense',      label: 'Indirect Expense (Operating)',   type: 'expense',   sub_type: 'indirect',  group: 'Indirect Expense',       pill: 'bg-amber-50 text-amber-700',   order: 9 },
];

/** Decode an account from the DB into its flat-type identity. */
function classifyAccount(a: { type: string; sub_type: string | null }): FlatTypeMeta {
  // Income/expense default to 'direct' when sub_type is missing — matches the P&L adapter.
  // Asset/liability default to 'current' for the same reason.
  if (a.type === 'income') {
    return FLAT_TYPES.find(t => t.type === 'income' && t.sub_type === (a.sub_type === 'indirect' ? 'indirect' : 'direct'))!;
  }
  if (a.type === 'expense') {
    return FLAT_TYPES.find(t => t.type === 'expense' && t.sub_type === (a.sub_type === 'indirect' ? 'indirect' : 'direct'))!;
  }
  if (a.type === 'asset') {
    return FLAT_TYPES.find(t => t.type === 'asset' && t.sub_type === (a.sub_type === 'fixed' ? 'fixed' : 'current'))!;
  }
  if (a.type === 'liability') {
    return FLAT_TYPES.find(t => t.type === 'liability' && t.sub_type === (a.sub_type === 'long_term' ? 'long_term' : 'current'))!;
  }
  return FLAT_TYPES.find(t => t.type === 'equity')!;
}

const FLAT_VALUES = FLAT_TYPES.map(t => t.value) as [FlatType, ...FlatType[]];

const schema = z.object({
  code:      z.string().min(1, 'Required'),
  name:      z.string().min(1, 'Required'),
  name_ar:   z.string(),
  flat_type: z.enum(FLAT_VALUES),
  // sub_type field is only used for Asset/Liability/Equity free-text tagging
  // (e.g. "cash", "bank"); for Income/Expense and current/fixed it's owned by flat_type.
  sub_type_extra: z.string(),
  parent_id: z.string().nullable(),
  // Phase 14.13d — when the picked parent is 1110 Bank Account (Main) or
  // 1100 Cash in Hand, we ALSO create a row in bank_accounts so the new
  // CoA shows up in payment / expense pickers immediately. These fields
  // are only meaningful when `also_bank_account` is true.
  also_bank_account: z.boolean().default(false),
  bank_account_type: z.string(),                  // 'bank' | 'cash'
  bank_account_number: z.string(),
  bank_name:           z.string(),
  bank_iban:           z.string(),
  bank_swift:          z.string(),
  bank_branch:         z.string(),
  bank_currency:       z.string(),
});
type FormValues = z.infer<typeof schema>;

// Codes that, when chosen as parent, trigger the "also a bank account?"
// flow. 1110 = Bank Account (Main), 1100 = Cash in Hand. Both are the
// canonical seed accounts those sub-rows nest under.
const BANK_PARENT_CODES = new Set(['1110', '1100']);

export default function ChartOfAccountsPage() {
  const { t } = useTranslation();
  const { company_id } = useAuthStore();
  const qc = useQueryClient();
  const companyCurrency = useCompanyCurrency();    // Phase 14.14m — default for bank quick-create
  const [open, setOpen] = useState(false);
  // Phase 14.10 — edit mode. When set we render the same modal with
  // pre-filled values + update path instead of create.
  const [editing, setEditing] = useState<CoaRow | null>(null);
  // Phase 14.10 — show deactivated accounts toggle. Off by default so the
  // list stays clean.
  const [showInactive, setShowInactive] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  const { data: accounts = [], isLoading } = useQuery({
    queryKey: ['coa', company_id],
    queryFn: () => getAdapter().coa.list(company_id!),
    enabled: !!company_id,
  });

  // Phase 14.14l — surface zod failures instead of letting handleSubmit
  // silently no-op when an optional field is undefined / required field empty.
  const { onInvalid, bannerMessage, clearBanner } = useFormInvalidBanner('chart-of-accounts');

  const { register, handleSubmit, reset, watch, setValue, formState: { errors, isSubmitting } } = useForm<FormValues>({
    resolver: zodResolver(schema) as any,
    defaultValues: {
      code: '', name: '', name_ar: '', flat_type: 'current_asset',
      sub_type_extra: '', parent_id: null,
      also_bank_account: false,
      bank_account_type: 'bank',
      bank_account_number: '', bank_name: '', bank_iban: '',
      bank_swift: '', bank_branch: '', bank_currency: companyCurrency,
    },
  });

  const flatTypeValue = watch('flat_type');
  const parentIdValue = watch('parent_id');
  const flatTypeMeta = FLAT_TYPES.find(t => t.value === flatTypeValue);
  // Equity has no built-in sub_type; user can tag freely (e.g. "owner", "retained")
  const showSubTypeExtra = flatTypeMeta?.type === 'equity';

  // Phase 14.13 — eligible parents for the picker. Only accounts of the
  // SAME flat-type can be a parent (you wouldn't nest a Liability under
  // an Asset). When editing, the row itself is excluded (no self-parent)
  // along with anything that already has this row in its ancestry (no
  // cycles). System accounts ARE valid parents — e.g. nesting your own
  // bank subaccounts under "1100 Bank Account (Main)" is the whole point.
  const eligibleParents = (() => {
    if (!flatTypeMeta) return [];
    const sameFlat = accounts.filter(a => {
      if (a.id === editing?.id) return false;
      const m = classifyAccount(a);
      return m.value === flatTypeMeta.value;
    });
    // Cycle guard — when editing, exclude descendants of `editing`.
    if (editing) {
      const descendants = new Set<string>([editing.id]);
      let changed = true;
      while (changed) {
        changed = false;
        for (const a of accounts) {
          if (a.parent_id && descendants.has(a.parent_id) && !descendants.has(a.id)) {
            descendants.add(a.id);
            changed = true;
          }
        }
      }
      return sameFlat.filter(a => !descendants.has(a.id));
    }
    return sameFlat;
  })();

  // Phase 14.13b — auto-suggest a code based on the selected parent (or,
  // for top-level accounts, the next free code in the flat-type group).
  //
  // Algorithm:
  //   - With a parent: next = max(numeric child code) + 1. If no
  //     existing children: parent.code + 1. So 1110 → 1111, 1112, ...
  //   - No parent (top-level): next = max code in this flat-type's
  //     existing range, rounded UP to the next multiple of 10.
  //     So if the highest current asset is 1500, the next is 1510.
  //
  // The user can still type their own code — auto-fill only kicks in
  // when the field is empty (or when the previous suggestion is
  // detectably still in the field).
  const suggestedCode = (() => {
    if (!flatTypeMeta || editing) return '';     // edit mode: don't surprise the operator
    const sameFlat = accounts.filter(a => classifyAccount(a).value === flatTypeMeta.value);
    const numericOf = (c: string): number => {
      const n = parseInt(c, 10);
      return Number.isFinite(n) ? n : 0;
    };
    if (parentIdValue) {
      const parent = accounts.find(a => a.id === parentIdValue);
      if (!parent) return '';
      const children = accounts.filter(a => a.parent_id === parentIdValue);
      const maxChild = children.reduce((m, c) => Math.max(m, numericOf(c.code)), numericOf(parent.code));
      return String(maxChild + 1);
    }
    if (sameFlat.length === 0) {
      // First account of this type — start from a reasonable seed.
      const seeds: Record<string, number> = {
        current_asset: 1000, fixed_asset: 1500,
        current_liability: 2000, long_term_liability: 2500,
        equity: 3000,
        direct_income: 4000, indirect_income: 4200,
        direct_expense: 5000, indirect_expense: 6000,
      };
      return String(seeds[flatTypeMeta.value] ?? 1000);
    }
    const maxCode = sameFlat.reduce((m, a) => Math.max(m, numericOf(a.code)), 0);
    // Round up to next multiple of 10 so each top-level account leaves
    // room for ~9 sub-accounts before bumping into the next slot.
    return String(Math.ceil((maxCode + 1) / 10) * 10);
  })();

  // Re-emit the suggestion whenever parent / type changes, unless the
  // user has typed something that doesn't match the last suggestion
  // (i.e. they explicitly overrode the auto-value). lastSuggestedRef
  // tracks the most recent auto-emit so we know whether the current
  // code field value is "still auto" or "user-modified".
  const lastSuggestedRef = useRef<string>('');
  const currentCode = watch('code');
  useEffect(() => {
    if (editing) return;                                  // edit mode: never overwrite
    if (!suggestedCode) return;
    // Only auto-fill if the field is empty OR still holds the previous
    // suggestion (i.e. the user hasn't typed their own value).
    if (currentCode === '' || currentCode === lastSuggestedRef.current) {
      setValue('code', suggestedCode);
      lastSuggestedRef.current = suggestedCode;
    }
  }, [suggestedCode, currentCode, editing, setValue]);

  // Phase 14.13d — detect when the chosen parent is a bank/cash account
  // (1110 = Bank Account Main, 1100 = Cash in Hand). When it is, surface
  // a "Also add this as a bank/cash account" section so the new CoA row
  // becomes immediately usable in payment / expense pickers.
  const parentRow = parentIdValue ? accounts.find(a => a.id === parentIdValue) : undefined;
  const parentIsBankOrCash = !!parentRow && BANK_PARENT_CODES.has(parentRow.code);
  const inferredBankType   = parentRow?.code === '1100' ? 'cash' : 'bank';

  // Auto-toggle the "also create" checkbox on whenever a bank-or-cash
  // parent is picked, OFF otherwise. The operator can still uncheck it
  // if they really want a CoA-only row for some reason.
  const alsoBankPrev = useRef<boolean | null>(null);
  useEffect(() => {
    if (editing) return;
    if (parentIsBankOrCash && alsoBankPrev.current !== true) {
      setValue('also_bank_account', true);
      setValue('bank_account_type', inferredBankType);
      alsoBankPrev.current = true;
    } else if (!parentIsBankOrCash && alsoBankPrev.current !== false) {
      setValue('also_bank_account', false);
      alsoBankPrev.current = false;
    }
  }, [parentIsBankOrCash, inferredBankType, editing, setValue]);

  const createMutation = useMutation({
    mutationFn: async (v: FormValues) => {
      const meta = FLAT_TYPES.find(t => t.value === v.flat_type)!;
      // For Equity, accept user's free-text sub_type; for everything else, use the flat-type's mapping.
      const sub_type = meta.type === 'equity'
        ? (v.sub_type_extra.trim() || null)
        : meta.sub_type;
      const coaRow = await getAdapter().coa.create({
        company_id: company_id!,
        code: v.code,
        name: v.name,
        name_ar: v.name_ar || null,
        type: meta.type,
        sub_type,
        parent_id: v.parent_id || null,
        is_active: true,
        is_system: false,
      });

      // Phase 14.13d — when the operator ticked "Also add as a bank/cash
      // account", create the matching bank_accounts row pointing at the
      // CoA we just made. Failure here doesn't undo the CoA (transaction
      // not available client-side); we surface the error and let the
      // operator finish in /settings/bank-accounts manually.
      if (v.also_bank_account) {
        try {
          await getAdapter().bankAccounts.create({
            company_id:     company_id!,
            coa_account_id: coaRow.id,
            account_type:   v.bank_account_type || 'bank',
            name:           v.name,                   // mirror CoA name
            name_ar:        v.name_ar || null,
            account_number: v.bank_account_number.trim() || null,
            bank_name:      v.bank_name.trim() || null,
            iban:           v.bank_iban.trim() || null,
            swift_code:     v.bank_swift.trim() || null,
            branch:         v.bank_branch.trim() || null,
            currency:       v.bank_currency || companyCurrency,
            is_active:      true,
            is_default:     false,
            opening_balance: 0,
          });
        } catch (e) {
          // Re-throw with a friendlier message; the CoA row stays.
          throw new Error(
            `CoA "${v.code} ${v.name}" was created, but adding it as a bank account failed: ` +
            (e instanceof Error ? e.message : 'unknown error') +
            '. Finish it in Settings → Bank Accounts.'
          );
        }
      }

      return coaRow;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['coa', company_id] });
      // Bank-side caches — multiple pages (payment editor, expense
      // editor, settings/bank-accounts) read this list.
      qc.invalidateQueries({ queryKey: ['bankAccounts', company_id] });
      qc.invalidateQueries({ queryKey: ['bank_accounts', company_id] });
      setOpen(false);
      reset();
    },
  });

  // Phase 14.10 — edit existing CoA. System accounts get a tighter
  // payload (name + name_ar only) because their code/type are referenced
  // by RPCs hard-coded to specific codes (1200, 2400, 3010, etc.) and
  // renaming the type would break confirm_invoice and friends.
  const editMutation = useMutation({
    mutationFn: async (v: FormValues) => {
      if (!editing) throw new Error('No row in edit mode');
      const isSystem = editing.is_system;
      if (isSystem) {
        return getAdapter().coa.update(editing.id, {
          name:    v.name,
          name_ar: v.name_ar || null,
        });
      }
      const meta = FLAT_TYPES.find(t => t.value === v.flat_type)!;
      const sub_type = meta.type === 'equity'
        ? (v.sub_type_extra.trim() || null)
        : meta.sub_type;
      return getAdapter().coa.update(editing.id, {
        code:    v.code,
        name:    v.name,
        name_ar: v.name_ar || null,
        type:    meta.type,
        sub_type,
        parent_id: v.parent_id || null,
      });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['coa', company_id] });
      setEditing(null);
      setOpen(false);
      reset();
    },
  });

  const deactivateMutation = useMutation({
    mutationFn: (id: string) => getAdapter().coa.deactivate(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['coa', company_id] }),
    onError:   (e: Error) => setActionError(e.message),
  });
  const activateMutation = useMutation({
    mutationFn: (id: string) => getAdapter().coa.activate(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['coa', company_id] }),
    onError:   (e: Error) => setActionError(e.message),
  });

  // Open the modal in EDIT mode with the row's current values seeded.
  function startEdit(a: CoaRow) {
    setActionError(null);
    setEditing(a);
    const meta = classifyAccount(a);
    reset({
      code:      a.code,
      name:      a.name,
      name_ar:   a.name_ar ?? '',
      flat_type: meta.value,
      sub_type_extra: meta.type === 'equity' ? (a.sub_type ?? '') : '',
      parent_id: a.parent_id ?? null,
    });
    setOpen(true);
  }

  function closeModal() {
    setOpen(false);
    setEditing(null);
    reset({ code: '', name: '', name_ar: '', flat_type: 'current_asset', sub_type_extra: '', parent_id: null });
  }

  // Group accounts by flat type (each account decoded from its (type, sub_type) tuple)
  const grouped = FLAT_TYPES.reduce<Record<FlatType, CoaRow[]>>((acc, ft) => {
    acc[ft.value] = [];
    return acc;
  }, {} as Record<FlatType, CoaRow[]>);

  for (const a of accounts) {
    if (!showInactive && a.is_active === false) continue;
    const meta = classifyAccount(a);
    grouped[meta.value].push(a);
  }
  // Phase 14.13 — tree-sort within each flat group: top-level rows in
  // code order, with their children listed immediately under them
  // (recursively). depthById lets the row renderer indent children.
  const depthById = new Map<string, number>();
  for (const ft of FLAT_TYPES) {
    const all = grouped[ft.value];
    const byParent = new Map<string | null, CoaRow[]>();
    for (const a of all) {
      const key = a.parent_id ?? null;
      const arr = byParent.get(key) ?? [];
      arr.push(a);
      byParent.set(key, arr);
    }
    for (const [, arr] of byParent) arr.sort((a, b) => a.code.localeCompare(b.code));
    const out: CoaRow[] = [];
    const walk = (parentId: string | null, depth: number) => {
      const kids = byParent.get(parentId) ?? [];
      for (const k of kids) {
        out.push(k);
        depthById.set(k.id, depth);
        walk(k.id, depth + 1);
      }
    };
    walk(null, 0);
    // Orphans (parent_id points to a row outside this flat group or to a
    // deleted row) — append at the end as top-level so they stay visible.
    for (const a of all) {
      if (!depthById.has(a.id)) {
        out.push(a);
        depthById.set(a.id, 0);
      }
    }
    grouped[ft.value] = out;
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-xl font-semibold text-ink-primary">{t('accounting.coa_title')}</h1>
        <div className="flex items-center gap-3">
          <label className="flex items-center gap-1.5 text-xs text-ink-secondary cursor-pointer select-none">
            <input
              type="checkbox" className="h-3.5 w-3.5"
              checked={showInactive}
              onChange={(e) => setShowInactive(e.target.checked)}
            />
            <span>Show inactive</span>
          </label>
          <ImportExportButton moduleKey="coa" />
          <Button size="sm" onClick={() => { setEditing(null); reset(); setActionError(null); setOpen(true); }}>
            {t('accounting.add_account')}
          </Button>
        </div>
      </div>
      {actionError && (
        <div className="rounded-card border border-red-300 bg-red-50 px-4 py-2.5 text-sm text-red-700">
          {actionError}
        </div>
      )}

      {isLoading ? (
        <p className="text-sm text-ink-secondary">{t('common.loading')}</p>
      ) : (
        <div className="space-y-4">
          {FLAT_TYPES.map((ft) => (
            <div key={ft.value} className="rounded-card border border-border-subtle bg-surface-card">
              <div className="flex items-center gap-2 border-b border-border-subtle px-4 py-3">
                <span className={`rounded-pill px-2 py-0.5 text-xs font-medium ${ft.pill}`}>
                  {ft.group}
                </span>
                <span className="text-xs text-ink-tertiary">({grouped[ft.value].length})</span>
              </div>
              {grouped[ft.value].length === 0 ? (
                <p className="px-4 py-3 text-sm text-ink-tertiary">{t('accounting.no_accounts')}</p>
              ) : (
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border-subtle bg-surface-muted text-xs text-ink-tertiary">
                      <th className="px-4 py-2 text-start font-medium w-[110px]">{t('accounting.code')}</th>
                      <th className="px-4 py-2 text-start font-medium">{t('accounting.account_name')}</th>
                      <th className="px-4 py-2 text-start font-medium w-[140px]">{t('accounting.sub_type')}</th>
                      <th className="px-4 py-2 text-start font-medium w-[100px]">{t('accounting.system')}</th>
                      <th className="px-4 py-2 text-end font-medium w-[160px]">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {grouped[ft.value].map((a) => {
                      const inactive = a.is_active === false;
                      return (
                        <tr key={a.id}
                            className="border-b border-border-subtle last:border-0 hover:bg-surface-muted/50"
                            style={{ opacity: inactive ? 0.5 : 1 }}>
                          <td className="px-4 py-2.5 font-mono text-xs text-ink-primary">
                            {/* Phase 14.13 — indent child accounts visually so the hierarchy reads at a glance. */}
                            {(() => {
                              const depth = depthById.get(a.id) ?? 0;
                              if (depth === 0) return a.code;
                              return (
                                <span>
                                  <span
                                    aria-hidden
                                    style={{ display: 'inline-block', width: `${depth * 16}px`, color: '#94A3B8' }}
                                  >{'└'.padStart(1, ' ')}</span>
                                  {a.code}
                                </span>
                              );
                            })()}
                          </td>
                          <td className="px-4 py-2.5 text-ink-primary">
                            {/* Phase 14.10b — render the name in whichever
                                 language the UI is set to (i18next `dir`
                                 flips when the user toggles عربي). Falls
                                 back to the English name when the Arabic
                                 translation is missing. Previously this
                                 cell ALWAYS appended the Arabic name in
                                 parens after the English one, which
                                 leaked Arabic into the English view. */}
                            {document.documentElement.dir === 'rtl' && a.name_ar
                              ? <span dir="rtl">{a.name_ar}</span>
                              : a.name}
                          </td>
                          <td className="px-4 py-2.5 text-ink-secondary">{a.sub_type ?? '—'}</td>
                          <td className="px-4 py-2.5">
                            {a.is_system && (
                              <span className="rounded-pill bg-surface-muted px-1.5 py-0.5 text-xs text-ink-tertiary">
                                {t('accounting.system')}
                              </span>
                            )}
                            {inactive && (
                              <span className="ms-1 rounded-pill bg-amber-50 px-1.5 py-0.5 text-xs text-amber-700">
                                Inactive
                              </span>
                            )}
                          </td>
                          <td className="px-4 py-2.5 text-end">
                            <div className="inline-flex gap-3 text-xs">
                              <button
                                type="button"
                                onClick={() => startEdit(a)}
                                className="text-brand-600 hover:text-brand-700 font-medium"
                              >Edit</button>
                              {!a.is_system && (
                                inactive ? (
                                  <button
                                    type="button"
                                    onClick={() => { setActionError(null); activateMutation.mutate(a.id); }}
                                    className="text-emerald-600 hover:text-emerald-700 font-medium"
                                    disabled={activateMutation.isPending}
                                  >Activate</button>
                                ) : (
                                  <button
                                    type="button"
                                    onClick={() => {
                                      if (!window.confirm(`Deactivate ${a.code} ${a.name}?\nIt will be hidden from pickers but kept for audit history.`)) return;
                                      setActionError(null);
                                      deactivateMutation.mutate(a.id);
                                    }}
                                    className="text-red-600 hover:text-red-700 font-medium"
                                    disabled={deactivateMutation.isPending}
                                  >Deactivate</button>
                                )
                              )}
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              )}
            </div>
          ))}
        </div>
      )}

      <Modal
        open={open}
        onClose={closeModal}
        title={editing
          ? `Edit account ${editing.code} ${editing.name}`
          : t('accounting.add_account')}
      >
        <form
          onSubmit={handleSubmit((v) => {
            clearBanner();
            (editing ? editMutation : createMutation).mutate(v as FormValues);
          }, onInvalid)}
          className="space-y-4"
        >
          <FormErrorBanner message={bannerMessage} onDismiss={clearBanner} />
          {/* Phase 14.10 — banner explaining what's locked on system accounts. */}
          {editing?.is_system && (
            <div className="rounded-card border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
              <strong>System account.</strong> Code and type are locked because built-in
              postings (invoices, payments, GRNs) reference this account by code. You can
              still rename it in English / Arabic to match your local terminology.
            </div>
          )}
          {/* Phase 14.13f — permanence hint. Tell the operator, BEFORE they
               type anything, whether what they're about to add survives a
               company-data reset. Seed (system) accounts always survive.
               Custom accounts are cleared on reset. */}
          {!editing && (
            <div className="rounded-card border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-700">
              <strong>Cleared on Reset Company Data.</strong> Custom accounts you add here are wiped
              by Settings → Reset Company Data. The seeded system accounts (e.g. 1100, 1110, 1200)
              always survive.
            </div>
          )}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1 block text-xs font-medium text-ink-secondary">{t('accounting.code')}</label>
              <Input
                {...register('code')}
                placeholder="e.g. 1700"
                disabled={editing?.is_system === true}
              />
              {errors.code && <p className="mt-1 text-xs text-red-500">{errors.code.message}</p>}
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-ink-secondary">{t('accounting.type')}</label>
              <select
                {...register('flat_type')}
                disabled={editing?.is_system === true}
                className="h-9 w-full rounded-card border border-border-subtle bg-surface-card px-3 text-sm text-ink-primary focus:outline-none focus:ring-2 focus:ring-brand-500 disabled:bg-surface-muted disabled:text-ink-tertiary"
              >
                {FLAT_TYPES.map((ft) => (
                  <option key={ft.value} value={ft.value}>{ft.label}</option>
                ))}
              </select>
            </div>
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-ink-secondary">{t('accounting.account_name')}</label>
            <Input {...register('name')} placeholder={t('accounting.account_name')} />
            {errors.name && <p className="mt-1 text-xs text-red-500">{errors.name.message}</p>}
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-ink-secondary">{t('accounting.account_name_ar')}</label>
            <Input {...register('name_ar')} dir="rtl" />
          </div>
          {/* Phase 14.13 — parent picker. Nest sub-accounts (e.g. specific
               bank accounts under "1100 Bank Account (Main)", or branch
               cash drawers under "1000 Cash in Hand"). Filtered to the
               same flat-type so an Asset can'\''t parent a Liability;
               descendants of the row being edited are filtered out so a
               cycle is impossible. Empty = top-level account. */}
          <div>
            <label className="mb-1 block text-xs font-medium text-ink-secondary">
              Parent account <span className="text-ink-tertiary">(optional — leave blank for a top-level account)</span>
            </label>
            <select
              {...register('parent_id', { setValueAs: (v) => v === '' ? null : v })}
              className="h-9 w-full rounded-card border border-border-subtle bg-surface-card px-3 text-sm text-ink-primary focus:outline-none focus:ring-2 focus:ring-brand-500 disabled:bg-surface-muted disabled:text-ink-tertiary"
              disabled={editing?.is_system === true}
            >
              <option value="">— Top-level —</option>
              {eligibleParents.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.code} — {p.name}
                </option>
              ))}
            </select>
            {eligibleParents.length === 0 && (
              <p className="mt-1 text-xs text-ink-tertiary">
                No eligible parents yet for {flatTypeMeta?.label}. Add a top-level account of this type first.
              </p>
            )}
          </div>
          {/* Phase 14.13d — Quick-create bank/cash account. When the picked
                parent is 1110 Bank Account (Main) or 1100 Cash in Hand, also
                create the matching bank_accounts row in one step. Without
                this, the new sub-CoA would not show up in payment / expense
                pickers (those read bank_accounts, not chart_of_accounts). */}
          {parentIsBankOrCash && !editing && (
            <div className="rounded-card border border-brand-200 bg-brand-50/40 p-3">
              <label className="flex items-start gap-2 text-sm text-ink-primary">
                <input
                  type="checkbox"
                  className="mt-0.5"
                  {...register('also_bank_account')}
                />
                <span>
                  <span className="font-medium">
                    Also add this as a {inferredBankType === 'cash' ? 'cash drawer' : 'bank'} account
                  </span>
                  <span className="mt-0.5 block text-xs text-ink-secondary">
                    Creates a matching row in Settings → Bank Accounts so it
                    appears in payment, expense, and bank-transfer pickers.
                  </span>
                </span>
              </label>

              {watch('also_bank_account') && (
                <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <div className="sm:col-span-2">
                    <label className="mb-1 block text-xs font-medium text-ink-secondary">Account type</label>
                    <div className="flex items-center gap-4 text-sm">
                      <label className="flex items-center gap-1">
                        <input type="radio" value="bank" {...register('bank_account_type')} />
                        Bank
                      </label>
                      <label className="flex items-center gap-1">
                        <input type="radio" value="cash" {...register('bank_account_type')} />
                        Cash
                      </label>
                    </div>
                  </div>

                  {watch('bank_account_type') !== 'cash' && (
                    <>
                      <div>
                        <label className="mb-1 block text-xs font-medium text-ink-secondary">Bank name</label>
                        <Input {...register('bank_name')} placeholder="e.g. ADCB, IDBI" />
                      </div>
                      <div>
                        <label className="mb-1 block text-xs font-medium text-ink-secondary">Account number</label>
                        <Input {...register('bank_account_number')} placeholder="e.g. 1234567890" />
                      </div>
                      <div>
                        <label className="mb-1 block text-xs font-medium text-ink-secondary">IBAN</label>
                        <Input {...register('bank_iban')} placeholder="AE07 0331 2345 6789 0123 456" />
                      </div>
                      <div>
                        <label className="mb-1 block text-xs font-medium text-ink-secondary">SWIFT / BIC</label>
                        <Input {...register('bank_swift')} placeholder="ADCBAEAA" />
                      </div>
                      <div>
                        <label className="mb-1 block text-xs font-medium text-ink-secondary">Branch</label>
                        <Input {...register('bank_branch')} placeholder="e.g. Main branch" />
                      </div>
                    </>
                  )}

                  <div>
                    <label className="mb-1 block text-xs font-medium text-ink-secondary">Currency</label>
                    <select
                      {...register('bank_currency')}
                      className="h-9 w-full rounded-card border border-border-subtle bg-surface-card px-3 text-sm text-ink-primary focus:outline-none focus:ring-2 focus:ring-brand-500"
                    >
                      <option value="AED">AED — UAE Dirham</option>
                      <option value="SAR">SAR — Saudi Riyal</option>
                      <option value="QAR">QAR — Qatari Riyal</option>
                      <option value="KWD">KWD — Kuwaiti Dinar</option>
                      <option value="BHD">BHD — Bahraini Dinar</option>
                      <option value="OMR">OMR — Omani Rial</option>
                      <option value="INR">INR — Indian Rupee</option>
                      <option value="USD">USD — US Dollar</option>
                      <option value="EUR">EUR — Euro</option>
                      <option value="GBP">GBP — Pound Sterling</option>
                    </select>
                  </div>
                </div>
              )}
            </div>
          )}
          {showSubTypeExtra && (
            <div>
              <label className="mb-1 block text-xs font-medium text-ink-secondary">{t('accounting.sub_type')} <span className="text-ink-tertiary">(optional)</span></label>
              <Input {...register('sub_type_extra')} placeholder="e.g. owner, retained, drawings"
                     disabled={editing?.is_system === true} />
              <p className="mt-1 text-xs text-ink-tertiary">Free-text tag for grouping equity accounts.</p>
            </div>
          )}
          {(createMutation.isError || editMutation.isError) && (
            <p className="text-xs text-red-500">
              {String((createMutation.error as Error | undefined)?.message
                    ?? (editMutation.error   as Error | undefined)?.message
                    ?? t('common.error'))}
            </p>
          )}
          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="ghost" onClick={closeModal}>{t('common.cancel')}</Button>
            <Button
              type="submit"
              disabled={isSubmitting || createMutation.isPending || editMutation.isPending}
            >
              {editing
                ? (editMutation.isPending ? '…' : 'Save changes')
                : (createMutation.isPending ? '…' : t('common.save'))}
            </Button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
