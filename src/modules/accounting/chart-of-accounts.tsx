import { useState, useEffect, useRef } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import type { Column } from '@/ui/table';
import { OceanPage, OceanTable } from '@/components/ocean-list';
import { Plus } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { getAdapter } from '@/data/index';
import { useAuthStore } from '@/store/auth';
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
// Phase 14.14s — codes moved to src/core/seeds/control-accounts.ts.
import { useArabicEnabled } from '@/hooks/use-arabic-enabled';
import {
  BANK_PARENT_CODE_SET as BANK_PARENT_CODES,
  BANK_PARENT_CODES as BANK_CODE,
} from '@/core/seeds/control-accounts';

export default function ChartOfAccountsPage() {
  const { t } = useTranslation();
  const arabicOn = useArabicEnabled();   // India companies: English only
  // English labels in FLAT_TYPES stay as the fallback text.
  const ftGroup = (ft: FlatTypeMeta) => t(`settingsPages.coa.group.${ft.value}`, { defaultValue: ft.group });
  const ftLabel = (ft: FlatTypeMeta | undefined) => (ft ? t(`settingsPages.coa.type.${ft.value}`, { defaultValue: ft.label }) : '');
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

  // Bank quick-create fields. Every reset() must include them: a reset with
  // partial values becomes the form's new defaults, and the schema rejects
  // the missing bank fields — which blocked "Add account" after any Edit or
  // Cancel until the page was reloaded.
  const BANK_DEFAULTS = {
    also_bank_account: false,
    bank_account_type: 'bank' as const,
    bank_account_number: '', bank_name: '', bank_iban: '',
    bank_swift: '', bank_branch: '', bank_currency: companyCurrency,
  };
  const { register, handleSubmit, reset, watch, setValue, formState: { errors, isSubmitting } } = useForm<FormValues>({
    resolver: zodResolver(schema) as any,
    defaultValues: {
      code: '', name: '', name_ar: '', flat_type: 'current_asset',
      sub_type_extra: '', parent_id: null,
      ...BANK_DEFAULTS,
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
      const existingCodes = new Set(accounts.map(a => a.code));
      let candidate = maxChild + 1;
      while (existingCodes.has(String(candidate))) candidate += 1;
      return String(candidate);
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
    // Then skip forward until we find a code not already taken.
    const existingCodes = new Set(accounts.map(a => a.code));
    let candidate = Math.ceil((maxCode + 1) / 10) * 10;
    while (existingCodes.has(String(candidate))) candidate += 10;
    return String(candidate);
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
  const inferredBankType   = parentRow?.code === BANK_CODE.CASH ? 'cash' : 'bank';

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

      // Phase 14.14p — atomic CoA + bank insert via single RPC. Replaces
      // the Phase 14.13d two-call pattern that could leave an orphan CoA
      // row if the bank insert failed. Postgres rolls back both halves
      // on any exception inside the RPC body.
      const result = await getAdapter().coa.createWithOptionalBank({
        coa: {
          company_id: company_id!,
          code: v.code,
          name: v.name,
          name_ar: v.name_ar || null,
          type: meta.type,
          sub_type,
          parent_id: v.parent_id || null,
          is_active: true,
          is_system: false,
        },
        bank: v.also_bank_account
          ? {
              account_type:    v.bank_account_type || 'bank',
              name:            v.name,
              name_ar:         v.name_ar || null,
              account_number:  v.bank_account_number.trim() || null,
              bank_name:       v.bank_name.trim() || null,
              iban:            v.bank_iban.trim() || null,
              swift_code:      v.bank_swift.trim() || null,
              branch:          v.bank_branch.trim() || null,
              currency:        v.bank_currency || companyCurrency,
              is_active:       true,
              is_default:      false,
              opening_balance: 0,
            }
          : null,
      });
      return result;
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
      ...BANK_DEFAULTS,
    });
    setOpen(true);
  }

  function closeModal() {
    setOpen(false);
    setEditing(null);
    reset({ code: '', name: '', name_ar: '', flat_type: 'current_asset', sub_type_extra: '', parent_id: null, ...BANK_DEFAULTS });
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

  const columns: Column<CoaRow>[] = [
    {
      key: 'code', header: t('accounting.code'), width: '120px',
      render: (a) => {
        // Phase 14.13 — indent child accounts visually so the hierarchy reads at a glance.
        const depth = depthById.get(a.id) ?? 0;
        return (
          <bdi dir="ltr" className="sb-mono">
            {depth > 0 && <span aria-hidden style={{ display: 'inline-block', width: `${depth * 16}px`, color: 'var(--sb-text-secondary)' }}>└</span>}
            {a.code}
          </bdi>
        );
      },
    },
    {
      key: 'name', header: t('accounting.account_name'),
      // Phase 14.10b — the name in the UI language; English when no Arabic name exists.
      render: (a) => (document.documentElement.dir === 'rtl' && a.name_ar ? <span dir="rtl">{a.name_ar}</span> : a.name),
    },
    { key: 'sub', header: t('accounting.sub_type'), render: (a) => (a.sub_type ? t(`settingsPages.coa.sub.${a.sub_type}`, { defaultValue: a.sub_type }) : '—') },
    {
      key: 'flags', header: '',
      render: (a) => (
        <span className="sb-wh-badges">
          {a.is_system && <span className="sb-pill sb-pill-muted">{t('accounting.system')}</span>}
          {a.is_active === false && <span className="sb-pill sb-pill-warn">{t('common.inactive')}</span>}
        </span>
      ),
    },
    {
      key: 'actions', header: '', align: 'end',
      render: (a) => {
        const inactive = a.is_active === false;
        return (
          <span className="sb-users-actions">
            <button type="button" onClick={() => startEdit(a)} className="sb-row-link text-brand-600">{t('common.edit')}</button>
            {!a.is_system && (inactive ? (
              <button type="button" className="sb-row-link text-brand-600" disabled={activateMutation.isPending}
                onClick={() => { setActionError(null); activateMutation.mutate(a.id); }}>{t('settingsPages.coa.activate')}</button>
            ) : (
              <button type="button" className="sb-row-link text-danger-500" disabled={deactivateMutation.isPending}
                onClick={() => {
                  if (!window.confirm(t('settingsPages.coa.confirm_deactivate', { code: a.code, name: a.name }))) return;
                  setActionError(null);
                  deactivateMutation.mutate(a.id);
                }}>{t('settingsPages.coa.deactivate')}</button>
            ))}
          </span>
        );
      },
    },
  ];

  // Ocean Teal (UI v1.1): look only — same accounts, grouping, hierarchy,
  // show-inactive filter, add / edit / activate / deactivate as before.
  return (
    <OceanPage
      testid="coa-ocean"
      title={t('settingsNav.items.chart_of_accounts.title')}
      subtitle={t('settingsNav.items.chart_of_accounts.desc')}
      actions={<>
        <span className="sb-clist-io"><ImportExportButton moduleKey="coa" /></span>
        <button type="button" className="sb-primary-btn sb-btn-inline" onClick={() => { setEditing(null); reset(); setActionError(null); setOpen(true); }}>
          <Plus size={18} aria-hidden="true" />{t('accounting.add_account')}
        </button>
      </>}
      below={
        <label className="sb-check-row" style={{ marginTop: 14, display: 'inline-flex' }}>
          <input type="checkbox" checked={showInactive} onChange={(e) => setShowInactive(e.target.checked)} />
          <span className="sb-check-text">{t('settingsPages.coa.show_inactive')}</span>
        </label>
      }
    >
      {actionError && <p className="sb-alert sb-alert-danger" role="alert">{actionError}</p>}

      {isLoading ? (
        <div className="sb-card sb-empty">{t('common.loading')}</div>
      ) : (
        FLAT_TYPES.map((ft) => (
          <section key={ft.value} className="sb-section-card">
            <div className="sb-users-head">
              <h2 className="sb-form-title">{ftGroup(ft)} <span className="sb-tab-count">{grouped[ft.value].length}</span></h2>
            </div>
            <OceanTable
              columns={columns}
              rows={grouped[ft.value]}
              keyFn={(a) => a.id}
              cardTitleKey="name"
              rowMuted={(a) => a.is_active === false}
              emptyMessage={t('accounting.no_accounts')}
            />
          </section>
        ))
      )}

      <Modal
        open={open}
        onClose={closeModal}
        title={editing
          ? t('settingsPages.coa.edit_title', { code: editing.code, name: editing.name })
          : t('accounting.add_account')}
      >
        <form
          onSubmit={handleSubmit((v) => {
            clearBanner();
            (editing ? editMutation : createMutation).mutate(v as FormValues);
          }, onInvalid)}
          className="sb-ocean sb-form sb-modal-form"
        >
          <FormErrorBanner message={bannerMessage} onDismiss={clearBanner} />
          {/* Phase 14.10 — banner explaining what's locked on system accounts. */}
          {editing?.is_system && (
            <p className="sb-alert sb-alert-warn" style={{ fontWeight: 400 }}>
              <strong>{t('settingsPages.coa.system_title')}</strong> {t('settingsPages.coa.system_body')}
            </p>
          )}
          {/* Phase 14.13f — permanence hint. Tell the operator, BEFORE they
               type anything, whether what they're about to add survives a
               company-data reset. Seed (system) accounts always survive.
               Custom accounts are cleared on reset. */}
          {!editing && (
            <p className="sb-info-note">
              <strong>{t('settingsPages.coa.reset_title')}</strong> {t('settingsPages.coa.reset_body')}
            </p>
          )}
          <div className="sb-form-grid">
            <div>
              <label className="sb-flabel">{t('accounting.code')}</label>
              <Input
                {...register('code')}
                dir="ltr"
                placeholder={t('settingsPages.coa.code_ph')}
                disabled={editing?.is_system === true}
              />
              {errors.code && <p className="sb-form-hint" style={{ color: 'var(--sb-danger)' }}>{errors.code.message}</p>}
            </div>
            <div>
              <label className="sb-flabel">{t('accounting.type')}</label>
              <select
                {...register('flat_type')}
                disabled={editing?.is_system === true}
                className="sb-field sb-print-input"
              >
                {FLAT_TYPES.map((ft) => (
                  <option key={ft.value} value={ft.value}>{ftLabel(ft)}</option>
                ))}
              </select>
            </div>
          </div>
          <div>
            <label className="sb-flabel">{t('accounting.account_name')}</label>
            <Input {...register('name')} placeholder={t('accounting.account_name')} />
            {errors.name && <p className="sb-form-hint" style={{ color: 'var(--sb-danger)' }}>{errors.name.message}</p>}
          </div>
          {arabicOn && (
          <div>
            <label className="sb-flabel">{t('accounting.account_name_ar')}</label>
            <Input {...register('name_ar')} dir="rtl" />
          </div>
          )}
          {/* Phase 14.13 — parent picker. Nest sub-accounts (e.g. specific
               bank accounts under "1100 Bank Account (Main)", or branch
               cash drawers under "1000 Cash in Hand"). Filtered to the
               same flat-type so an Asset can'\''t parent a Liability;
               descendants of the row being edited are filtered out so a
               cycle is impossible. Empty = top-level account. */}
          <div>
            <label className="sb-flabel">
              {t('settingsPages.coa.parent')} <span style={{ fontWeight: 400 }}>{t('settingsPages.coa.parent_hint')}</span>
            </label>
            <select
              {...register('parent_id', { setValueAs: (v) => v === '' ? null : v })}
              className="sb-field sb-print-input"
              disabled={editing?.is_system === true}
            >
              <option value="">{t('settingsPages.coa.top_level')}</option>
              {eligibleParents.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.code} — {p.name}
                </option>
              ))}
            </select>
            {eligibleParents.length === 0 && (
              <p className="sb-form-hint" style={{ marginTop: 6 }}>
                {t('settingsPages.coa.no_parents', { type: ftLabel(flatTypeMeta) })}
              </p>
            )}
          </div>
          {/* Phase 14.13d — Quick-create bank/cash account. When the picked
                parent is 1110 Bank Account (Main) or 1100 Cash in Hand, also
                create the matching bank_accounts row in one step. Without
                this, the new sub-CoA would not show up in payment / expense
                pickers (those read bank_accounts, not chart_of_accounts). */}
          {parentIsBankOrCash && !editing && (
            <div className="sb-hw-test">
              <label className="sb-check-row">
                <input
                  type="checkbox"
                  {...register('also_bank_account')}
                />
                <span className="sb-check-text">
                  {inferredBankType === 'cash' ? t('settingsPages.coa.also_cash') : t('settingsPages.coa.also_bank')}
                  <span className="sb-form-hint">{t('settingsPages.coa.also_hint')}</span>
                </span>
              </label>

              {watch('also_bank_account') && (
                <div className="sb-form-grid" style={{ marginTop: 4 }}>
                  <div style={{ gridColumn: '1 / -1' }}>
                    <span className="sb-flabel">{t('settingsPages.coa.acc_type')}</span>
                    <div className="sb-hw-papers">
                      <label className="sb-check-row">
                        <input type="radio" value="bank" {...register('bank_account_type')} />
                        <span className="sb-check-text">{t('settingsPages.coa.bank')}</span>
                      </label>
                      <label className="sb-check-row">
                        <input type="radio" value="cash" {...register('bank_account_type')} />
                        <span className="sb-check-text">{t('settingsPages.coa.cash')}</span>
                      </label>
                    </div>
                  </div>

                  {watch('bank_account_type') !== 'cash' && (
                    <>
                      <div>
                        <label className="sb-flabel">{t('settingsPages.coa.bank_name')}</label>
                        <Input {...register('bank_name')} placeholder={t('settingsPages.coa.bank_name_ph')} />
                      </div>
                      <div>
                        <label className="sb-flabel">{t('settingsPages.coa.acc_no')}</label>
                        <Input {...register('bank_account_number')} dir="ltr" placeholder="1234567890" />
                      </div>
                      <div>
                        <label className="sb-flabel">{t('settingsPages.coa.iban')}</label>
                        <Input {...register('bank_iban')} dir="ltr" placeholder="AE07 0331 2345 6789 0123 456" />
                      </div>
                      <div>
                        <label className="sb-flabel">{t('settingsPages.coa.swift')}</label>
                        <Input {...register('bank_swift')} dir="ltr" placeholder="ADCBAEAA" />
                      </div>
                      <div>
                        <label className="sb-flabel">{t('settingsPages.coa.branch')}</label>
                        <Input {...register('bank_branch')} placeholder={t('settingsPages.coa.branch_ph')} />
                      </div>
                    </>
                  )}

                  <div>
                    <label className="sb-flabel">{t('settingsPages.coa.currency')}</label>
                    <select
                      {...register('bank_currency')}
                      className="sb-field sb-print-input"
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
              <label className="sb-flabel">{t('accounting.sub_type')} <span style={{ fontWeight: 400 }}>{t('settingsPages.coa.optional')}</span></label>
              <Input {...register('sub_type_extra')} placeholder={t('settingsPages.coa.sub_type_ph')}
                     disabled={editing?.is_system === true} />
              <p className="sb-form-hint" style={{ marginTop: 6 }}>{t('settingsPages.coa.sub_type_hint')}</p>
            </div>
          )}
          {(createMutation.isError || editMutation.isError) && (
            <p className="sb-alert sb-alert-danger" role="alert">
              {String((createMutation.error as Error | undefined)?.message
                    ?? (editMutation.error   as Error | undefined)?.message
                    ?? t('common.error'))}
            </p>
          )}
          <div className="sb-form-actions">
            <button type="button" className="sb-secondary-btn" onClick={closeModal}>{t('common.cancel')}</button>
            <button
              type="submit"
              className="sb-primary-btn"
              disabled={isSubmitting || createMutation.isPending || editMutation.isPending}
            >
              {editing
                ? (editMutation.isPending ? '…' : t('settingsPages.coa.save_changes'))
                : (createMutation.isPending ? '…' : t('common.save'))}
            </button>
          </div>
        </form>
      </Modal>
    </OceanPage>
  );
}
