/**
 * Expense editor — Phase 13.02 (redesigned Phase 13.02d).
 *
 * Deliberately NOT shaped like the invoice / bill editor. Those editors
 * are wide structured grids because invoices are complex multi-product
 * transactions with customer terms, per-line tax, warehouse, COGS, etc.
 *
 * An expense is a simpler event: "I spent X on Y, paid from Z". So this
 * editor takes a different shape:
 *
 *   ┌─────────────────────────────────────────────┐
 *   │  ← Expenses / EXP-0042    [Draft]   [Save]  │
 *   ├─────────────────────────────────────────────┤
 *   │                                             │
 *   │           AED                  100.00       │   <- single amount focal point
 *   │           Tax 5%   =           5.00         │
 *   │           Total                105.00       │
 *   │                                             │
 *   │  ──  Where the money went  ──               │
 *   │  6200 Rent & Utilities · indirect       ⌄  │   <- prominent account picker
 *   │                                             │
 *   │  ──  Quick context  ──                      │
 *   │  Date  | Paid from   | Vendor               │
 *   │  Reference (optional)                       │
 *   │  Description                                │
 *   │                                             │
 *   │  ──  Split across categories?   [ + Split ] │
 *   │  (collapsed by default; opens grid)         │
 *   │                                             │
 *   │  ──  Bill back to customer?    [Billable]  │
 *   │  Customer:  Al-Madina Auto                  │
 *   │                                             │
 *   └─────────────────────────────────────────────┘
 *
 * Differences from the invoice editor:
 *   - Single column, max 720 px, centered — not full-width.
 *   - Big AMOUNT focal point at the top (the thing that matters).
 *   - "Where the money went" = ONE expense-account picker by default.
 *     Multi-line is opt-in via a "Split" toggle for the rare case.
 *   - Quick context (date / paid-from / vendor) is one tight row, not
 *     a 4-column form card.
 *   - "Billable" is its own collapsible section, not a per-line toggle
 *     hidden inside a grid.
 *
 * Differences from the Zoho reference (which the user explicitly didn't
 * want copied):
 *   - No left sidebar / drag-drop receipt zone.
 *   - No place-of-supply / tax-treatment dropdowns (UAE-only for now).
 *   - "Itemize" is renamed "Split" with inline disclosure, not a link
 *     that mode-switches the whole form.
 *
 * Confirm calls the multi-line-aware confirm_expense RPC (Phase
 * 13.01b). Whether the editor was in single or split mode is decided
 * by the RPC reading expense_items — if items exist, multi-line; else,
 * legacy single-line.
 */
import { useEffect, useMemo, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { getAdapter } from '@/data/index';
import { useAuthStore } from '@/store/auth';
import { useCompanyCurrency } from '@/hooks/use-company-currency';
import { useInvalidateBooks } from '@/hooks/use-invalidate-books';
import { useUnsavedChangesGuard } from '@/hooks/use-unsaved-changes-guard';
import { Button } from '@/ui/button';
import { SearchableSelect } from '@/ui/searchable-select';
import { ContactPicker } from '@/components/contact-picker';
import { CoaQuickCreate } from '@/components/quick-create/coa-quick-create';
import { theme } from '@/ui/theme';
// Phase 14.06 — Signature template view mode for saved expenses.
import { BoltDocTemplate } from '@/modules/print/_signature/templates/bolt-v4';
import { usePrintConfig } from '@/hooks/use-print-config';
import { expenseToDocumentData } from '@/modules/print/_signature/adapters';
import '@/modules/print/_signature/print.css';
import type {
  BankAccountRow, CoaRow, ExpenseRow, ExpenseItemRow,
  ExpenseItemInsert, ContactRow, Company,
} from '@/data/adapter';

const fmt = (n: number) =>
  n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const round2 = (n: number) => Math.round(n * 100) / 100;

// ── Line state ─────────────────────────────────────────────────────────────
interface LineRow {
  _key: number;
  expense_account_id: string;
  description: string;
  quantity: string;
  unit_amount: string;
  tax_rate: string;
  is_billable: boolean;
  customer_id: string;
}

let _keySeq = 0;
const newLine = (): LineRow => ({
  _key: ++_keySeq,
  expense_account_id: '',
  description: '',
  quantity: '1',
  unit_amount: '0',
  tax_rate: '0',
  is_billable: false,
  customer_id: '',
});

function calcLine(l: LineRow) {
  const qty = parseFloat(l.quantity) || 0;
  const unit = parseFloat(l.unit_amount) || 0;
  const rate = parseFloat(l.tax_rate) || 0;
  const sub = round2(qty * unit);
  const tax = round2(sub * (rate / 100));
  return { line_subtotal: sub, tax_amount: tax, line_total: round2(sub + tax) };
}

// ── Section divider that matches the editor's vibe ─────────────────────────
function SectionLabel({ children, action }: { children: React.ReactNode; action?: React.ReactNode }) {
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: '12px',
      margin: '20px 0 10px',
    }}>
      <span style={{
        fontSize: '11px', fontWeight: 700, color: theme.inkMuted,
        textTransform: 'uppercase', letterSpacing: '.08em',
        whiteSpace: 'nowrap',
      }}>{children}</span>
      <span style={{ flex: 1, height: '1px', background: theme.border }} />
      {action}
    </div>
  );
}

// ── Page ───────────────────────────────────────────────────────────────────
export default function ExpenseEditorPage() {
  const { t } = useTranslation();
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const printConfig = usePrintConfig();
  const companyCurrency = useCompanyCurrency();   // Issue 1 — localize money to tenant currency
  const qc = useQueryClient();
  const invalidateBooks = useInvalidateBooks();   // Phase 14.14k
  const { company_id } = useAuthStore();
  const isNew = !id || id === 'new';
  const today = new Date().toISOString().slice(0, 10);

  // Header state
  const [date, setDate]           = useState(today);
  const [paidFromId, setPaidFromId] = useState('');
  const [supplierId, setSupplierId] = useState('');
  const [reference, setReference] = useState('');
  const [description, setDescription] = useState('');
  const [voidReason, setVoidReason] = useState('');

  // Lines (always at least 1 — the "primary" expense category)
  const [lines, setLines]   = useState<LineRow[]>([newLine()]);
  const [splitOpen, setSplitOpen] = useState(false);

  const [error, setError]   = useState<string | null>(null);
  const [dirty, setDirty]   = useState(false);
  const confirmLeave = useUnsavedChangesGuard(dirty);

  // Quick-create CoA state
  const [coaQcOpen,    setCoaQcOpen]    = useState(false);
  const [coaQcSeed,    setCoaQcSeed]    = useState('');
  const [coaQcLineKey, setCoaQcLineKey] = useState<number | null>(null);

  // Reference data
  const { data: bankAccounts = [] } = useQuery<BankAccountRow[]>({
    queryKey: ['bank_accounts', company_id],
    queryFn:  () => getAdapter().bankAccounts.list(company_id!),
    enabled: !!company_id,
  });
  const { data: coa = [] } = useQuery<CoaRow[]>({
    queryKey: ['coa', company_id],
    queryFn:  () => getAdapter().coa.list(company_id!),
    enabled:  !!company_id,
  });
  const { data: customers = [] } = useQuery<ContactRow[]>({
    queryKey: ['contacts', company_id, 'customer'],
    queryFn:  () => getAdapter().contacts.list(company_id!, 'customer'),
    enabled:  !!company_id,
  });
  // Phase 14.06 — reference data for Signature template.
  const { data: suppliers = [] } = useQuery<ContactRow[]>({
    queryKey: ['contacts', company_id, 'supplier'],
    queryFn:  () => getAdapter().contacts.list(company_id!, 'supplier'),
    enabled:  !!company_id,
  });
  const { data: companyRow } = useQuery<Company | null>({
    queryKey: ['company', company_id],
    queryFn:  () => getAdapter().companies.getById(company_id!),
    enabled:  !!company_id,
  });

  // Phase 14.06 — view-first mode for saved expenses.
  const [viewMode, setViewMode] = useState(!isNew);

  // Existing record (edit mode)
  const { data: expense } = useQuery<ExpenseRow>({
    queryKey: ['expense', id],
    queryFn:  () => getAdapter().expenses.getById(id!),
    enabled:  !isNew && !!id,
  });
  const { data: items = [] } = useQuery<ExpenseItemRow[]>({
    queryKey: ['expense_items', id],
    queryFn:  () => getAdapter().expenses.getItems(id!),
    enabled:  !isNew && !!id,
  });
  const { data: nextNumber } = useQuery<string>({
    queryKey: ['next_number', 'EXP', company_id],
    queryFn:  () => getAdapter().expenses.getNextNumber(company_id!),
    enabled:  !!company_id && isNew,
  });

  // Populate state when loaded
  useEffect(() => {
    if (!expense) return;
    setDate(expense.date);
    setPaidFromId(expense.paid_from_account_id);
    setSupplierId(expense.supplier_id ?? '');
    setReference(expense.reference ?? '');
    setDescription(expense.description ?? '');
  }, [expense]);

  useEffect(() => {
    if (items.length > 0) {
      const mapped = items.map(it => ({
        _key: ++_keySeq,
        expense_account_id: it.expense_account_id,
        description: it.description ?? '',
        quantity: String(it.quantity),
        unit_amount: String(it.unit_amount),
        tax_rate: String(it.tax_rate),
        is_billable: it.is_billable,
        customer_id: it.customer_id ?? '',
      }));
      setLines(mapped);
      // Auto-open the Split section if the record has > 1 line.
      if (mapped.length > 1) setSplitOpen(true);
      return;
    }
    // No line items → legacy single-line expense (e.g. one created in the
    // old Banking → Expenses screen before the merge). Seed one line from
    // the expense header so it opens correctly here.
    if (expense?.expense_account_id) {
      const amt = Number(expense.amount) || 0;
      const taxAmt = Number(expense.tax_amount) || 0;
      const rate = amt > 0 ? Math.round((taxAmt / amt) * 10000) / 100 : 0;
      setLines([{
        _key: ++_keySeq,
        expense_account_id: expense.expense_account_id,
        description: expense.description ?? '',
        quantity: '1',
        unit_amount: String(amt),
        tax_rate: String(rate),
        is_billable: false,
        customer_id: '',
      }]);
    }
  }, [items, expense]);

  // Computed totals
  const totals = useMemo(() => {
    let sub = 0, tax = 0;
    for (const l of lines) {
      const c = calcLine(l);
      sub += c.line_subtotal;
      tax += c.tax_amount;
    }
    return { subtotal: round2(sub), tax: round2(tax), total: round2(sub + tax) };
  }, [lines]);

  // Reference options
  const isDraft = isNew || expense?.status === 'draft';
  const isConfirmed = expense?.status === 'confirmed';
  const isVoid  = expense?.status === 'void';

  const bankOpts = bankAccounts.map(b => ({ value: b.id, label: `${b.name} · ${b.account_type === 'cash' ? 'Cash' : 'Bank'}` }));
  // Group-sorted by sub_type then code (Phase 13.02c). Direct accounts first
  // so the eye sees COGS-style entries before operating expenses.
  const subOrder = (st: string | null) =>
    st === 'direct' ? 0 : st === 'indirect' ? 1 : 2;
  const expenseAccountOpts = coa
    .filter(a => a.is_active && a.type === 'expense')
    .sort((a, b) => {
      const d = subOrder(a.sub_type) - subOrder(b.sub_type);
      return d !== 0 ? d : a.code.localeCompare(b.code);
    })
    .map(a => ({
      value: a.id,
      label: `${a.code}  ${a.name}${a.sub_type ? `  ·  ${a.sub_type}` : ''}`,
    }));
  const customerOpts = customers.map(c => ({ value: c.id, label: c.name }));

  // ── Mutations ────────────────────────────────────────────────────────────
  const saveMutation = useMutation({
    mutationFn: async () => {
      if (!paidFromId) throw new Error('Paid From is required');
      if (lines.length === 0) throw new Error('At least one line is required');
      for (const l of lines) {
        if (!l.expense_account_id) throw new Error('Pick an expense category');
        if (l.is_billable && !l.customer_id) throw new Error('Billable lines need a customer');
      }

      const itemInserts: ExpenseItemInsert[] = lines.map((l, idx) => {
        const c = calcLine(l);
        return {
          sort_order: idx,
          expense_account_id: l.expense_account_id,
          description: l.description || null,
          quantity: parseFloat(l.quantity) || 0,
          unit_amount: parseFloat(l.unit_amount) || 0,
          tax_rate: parseFloat(l.tax_rate) || 0,
          tax_amount: c.tax_amount,
          line_subtotal: c.line_subtotal,
          line_total: c.line_total,
          is_billable: l.is_billable,
          customer_id: l.is_billable ? l.customer_id : null,
        };
      });

      const headerCommon = {
        company_id:           company_id!,
        date,
        paid_from_account_id: paidFromId,
        supplier_id:          supplierId || null,
        reference:            reference || null,
        description:          description || '(no description)',
        expense_account_id:   itemInserts[0].expense_account_id,
        amount:               totals.subtotal,
        tax_amount:           totals.tax,
        total_amount:         totals.total,
      };

      // Phase 14.14q — atomic header + items via single RPC. Replaces the
      // previous three-call pattern (create/update header → replaceItems)
      // that could leave a header in the DB with stale or no items if the
      // item-replace failed. Now both halves run in one Postgres
      // transaction — either both commit or both roll back.
      // The RPC accepts a partial header for the update path (header
      // columns are merged onto the existing row), so we cast through
      // `unknown` — the update path doesn't need expense_number.
      const header = isNew
        ? { ...headerCommon, expense_number: nextNumber! }
        : (headerCommon as unknown as Parameters<ReturnType<typeof getAdapter>['expenses']['saveWithItems']>[0]['header']);
      const expenseId = await getAdapter().expenses.saveWithItems({
        id: isNew ? null : id!,
        header,
        items: itemInserts,
      });
      return expenseId;
    },
    onSuccess: async (expenseId) => {
      setDirty(false);
      await invalidateBooks();
      qc.invalidateQueries({ queryKey: ['expenses', company_id] });
      qc.invalidateQueries({ queryKey: ['expense', expenseId] });
      qc.invalidateQueries({ queryKey: ['expense_items', expenseId] });
      if (isNew) navigate('/purchasing/expenses');
    },
    onError: (e: Error) => setError(e.message),
  });

  const confirmMutation = useMutation({
    mutationFn: async () => { await getAdapter().expenses.confirm(id!); },
    onSuccess: async () => {
      await invalidateBooks();
      qc.invalidateQueries({ queryKey: ['expenses', company_id] });
      qc.invalidateQueries({ queryKey: ['expense', id] });
    },
    onError: (e: Error) => setError(e.message),
  });

  const voidMutation = useMutation({
    mutationFn: async () => { await getAdapter().expenses.void(id!, voidReason || undefined); },
    onSuccess: async () => {
      await invalidateBooks();
      qc.invalidateQueries({ queryKey: ['expenses', company_id] });
      qc.invalidateQueries({ queryKey: ['expense', id] });
    },
    onError: (e: Error) => setError(e.message),
  });

  // Line helpers
  const setLine = (k: number, patch: Partial<LineRow>) => {
    setLines(prev => prev.map(l => l._key === k ? { ...l, ...patch } : l));
    setDirty(true);
  };
  const removeLine = (k: number) => {
    setLines(prev => prev.length > 1 ? prev.filter(l => l._key !== k) : prev);
    setDirty(true);
  };
  const addLine = () => { setLines(prev => [...prev, newLine()]); setDirty(true); };

  // Primary line = first line. When split is closed, lines[0] is the only
  // line; when split is open the user can add more.
  const primary = lines[0];
  const primaryCalc = calcLine(primary);

  // Status pill
  const statusPill = (s?: string) => {
    if (!s) return null;
    const map: Record<string, { bg: string; text: string; border: string }> = {
      draft:     { bg: '#fffbeb', text: '#b45309', border: '#fde68a' },
      confirmed: { bg: '#f0fdf4', text: '#15803d', border: '#bbf7d0' },
      void:      { bg: '#fef2f2', text: '#dc2626', border: '#fecaca' },
    };
    const p = map[s] ?? { bg: theme.muted, text: theme.inkMuted, border: theme.border };
    return (
      <span style={{
        display: 'inline-block', padding: '3px 9px', borderRadius: '999px',
        fontSize: '11px', fontWeight: 600, textTransform: 'capitalize',
        background: p.bg, color: p.text, border: `1px solid ${p.border}`,
      }}>{s}</span>
    );
  };

  // Phase 14.06 — view-mode renderer (Signature template).
  if (viewMode && !isNew && expense) {
    const doc = expenseToDocumentData({
      expense,
      items,
      supplier: expense.supplier_id ? suppliers.find(s => s.id === expense.supplier_id) ?? null : null,
      company:  companyRow ?? null,
      coa,
      bankAccounts,
    });
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: '16px', paddingBottom: '32px' }}>
        <div
          data-no-print="true"
          style={{ display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap' }}
        >
          <button onClick={() => { if (confirmLeave()) navigate('/purchasing/expenses'); }} style={{
            background: 'transparent', border: 'none', cursor: 'pointer',
            fontSize: '13px', color: theme.inkMuted,
          }}>← Expenses</button>
          <span style={{ color: theme.inkFaint }}>/</span>
          <h1 style={{ margin: 0, fontSize: '20px', fontWeight: 700, color: theme.ink, letterSpacing: '-.01em' }}>
            {expense.expense_number}
          </h1>
          {statusPill(expense.status)}
          <div style={{ marginInlineStart: 'auto', display: 'flex', gap: '8px' }}>
            {isDraft && (
              <Button size="sm" onClick={() => setViewMode(false)}>
                ✎ {t('common.edit') || 'Edit'}
              </Button>
            )}
            {expense?.id && (
              <Button variant="ghost" size="sm" onClick={() => window.print()}>
                🖨 {t('print.print') || 'Print'}
              </Button>
            )}
          </div>
        </div>
        <div className="signature-canvas" style={{ borderRadius: '12px', overflow: 'auto' }}>
          <BoltDocTemplate data={doc} config={printConfig} />
        </div>
      </div>
    );
  }

  return (
    <div style={{
      maxWidth: '720px', margin: '0 auto',
      display: 'flex', flexDirection: 'column', gap: '14px',
      paddingBottom: '64px',
    }}>
      {/* Top crumb + actions */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap' }}>
        <button
          onClick={() => { if (confirmLeave()) navigate('/purchasing/expenses'); }}
          style={{ background: 'transparent', border: 'none', cursor: 'pointer', fontSize: '13px', color: theme.inkMuted }}
        >← Expenses</button>
        <span style={{ color: theme.inkFaint }}>/</span>
        <h1 style={{ margin: 0, fontSize: '20px', fontWeight: 700, color: theme.ink, letterSpacing: '-.01em' }}>
          {isNew ? 'New expense' : (expense?.expense_number ?? '…')}
        </h1>
        {!isNew && statusPill(expense?.status)}
        <div style={{ marginInlineStart: 'auto', display: 'flex', gap: '8px' }}>
          {!isNew && expense && (
            <Button variant="ghost" size="sm" onClick={() => setViewMode(true)}>
              {t('common.view') || 'View'}
            </Button>
          )}
          <Button variant="ghost" size="sm" onClick={() => { if (confirmLeave()) navigate('/purchasing/expenses'); }}>
            {t('common.cancel')}
          </Button>
          {isDraft && (
            <Button size="sm" onClick={() => { setError(null); saveMutation.mutate(); }} disabled={saveMutation.isPending}>
              {saveMutation.isPending ? t('common.saving') : t('common.save')}
            </Button>
          )}
          {!isNew && expense?.status === 'draft' && (
            <Button size="sm" onClick={() => { setError(null); confirmMutation.mutate(); }} disabled={confirmMutation.isPending}>
              {confirmMutation.isPending ? '…' : 'Confirm'}
            </Button>
          )}
          {isConfirmed && (
            <Button variant="danger" size="sm" onClick={() => {
              const r = prompt('Void reason (optional):');
              setVoidReason(r ?? '');
              if (r !== null) voidMutation.mutate();
            }}>Void</Button>
          )}
        </div>
      </div>

      {error && (
        <div style={{
          background: theme.dangerSoft, border: `1px solid ${theme.dangerBorder}`,
          borderRadius: '8px', padding: '10px 16px', fontSize: '13px', color: theme.danger,
        }}>{error}</div>
      )}

      {/* ── Main receipt card ── */}
      <div style={{
        background: theme.card,
        border: `1px solid ${theme.border}`,
        borderRadius: '16px',
        boxShadow: '0 1px 3px rgba(9,9,11,.05), 0 10px 30px -12px rgba(124,58,237,.18)',
        overflow: 'hidden',
      }}>
        {/* ── Hero: deep-violet amount band ── */}
        <div style={{
          background: 'linear-gradient(135deg, #2e1065 0%, #5b21b6 55%, #7c3aed 100%)',
          padding: '24px 28px 22px',
          color: '#fff',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '16px', flexWrap: 'wrap' }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', minWidth: 0 }}>
              <span style={{ fontSize: '10px', fontWeight: 700, letterSpacing: '.12em', textTransform: 'uppercase', color: 'rgba(255,255,255,.6)' }}>
                Expense Amount
              </span>
              <div style={{ display: 'flex', alignItems: 'baseline', gap: '10px' }}>
                <span style={{ fontSize: '18px', fontWeight: 700, color: 'rgba(255,255,255,.7)' }}>{companyCurrency}</span>
                <input
                  type="number" min="0" step="0.01"
                  value={primary.unit_amount}
                  disabled={!isDraft}
                  onChange={e => setLine(primary._key, { unit_amount: e.target.value })}
                  style={{
                    fontFamily: theme.fontMono,
                    fontSize: '40px', fontWeight: 800, letterSpacing: '-.02em',
                    color: '#fff',
                    border: 'none', outline: 'none', background: 'transparent',
                    padding: 0, width: '260px', maxWidth: '52vw',
                  }}
                  placeholder="0.00"
                />
              </div>
            </div>
            {/* Tax-rate pill */}
            <div style={{
              display: 'inline-flex', alignItems: 'center', gap: '6px',
              padding: '7px 12px', borderRadius: '999px',
              background: 'rgba(255,255,255,.12)', border: '1px solid rgba(255,255,255,.22)',
            }}>
              <span style={{ fontSize: '10px', fontWeight: 700, letterSpacing: '.06em', textTransform: 'uppercase', color: 'rgba(255,255,255,.7)' }}>Tax</span>
              <input
                type="number" min="0" max="100" step="0.01"
                value={primary.tax_rate}
                disabled={!isDraft}
                onChange={e => setLine(primary._key, { tax_rate: e.target.value })}
                style={{
                  fontFamily: theme.fontMono, fontSize: '15px', fontWeight: 700,
                  color: '#fff', border: 'none', outline: 'none', background: 'transparent',
                  width: '44px', textAlign: 'end',
                }}
                placeholder="0"
              />
              <span style={{ fontSize: '13px', color: 'rgba(255,255,255,.7)' }}>%</span>
            </div>
          </div>

          {/* computed summary chips */}
          <div style={{
            marginTop: '16px', paddingTop: '14px',
            borderTop: '1px solid rgba(255,255,255,.15)',
            display: 'flex', alignItems: 'baseline', gap: '24px', flexWrap: 'wrap',
            fontSize: '12px', color: 'rgba(255,255,255,.7)',
          }}>
            <span>Subtotal <span className="font-mono" style={{ color: '#fff', fontWeight: 600, marginInlineStart: '4px' }}>{fmt(splitOpen ? totals.subtotal : primaryCalc.line_subtotal)}</span></span>
            <span>Tax <span className="font-mono" style={{ color: '#fff', fontWeight: 600, marginInlineStart: '4px' }}>{fmt(splitOpen ? totals.tax : primaryCalc.tax_amount)}</span></span>
            <span style={{ marginInlineStart: 'auto', fontSize: '15px', fontWeight: 800, color: '#fff' }}>
              <span style={{ fontSize: '11px', fontWeight: 600, color: 'rgba(255,255,255,.7)', marginInlineEnd: '6px' }}>Total</span>
              {companyCurrency} <span className="font-mono">{fmt(splitOpen ? totals.total : primaryCalc.line_total)}</span>
            </span>
          </div>
        </div>

        {/* ── Body ── */}
        <div style={{ padding: '22px 28px 26px' }}>

        {/* ── Where the money went ── */}
        <SectionLabel>Where the money went</SectionLabel>

        {!splitOpen && (
          <>
            <SearchableSelect
              options={expenseAccountOpts}
              value={primary.expense_account_id}
              onChange={(v) => setLine(primary._key, { expense_account_id: v })}
              disabled={!isDraft}
              placeholder="Pick an expense category…"
              panelWidth={420}
              addNew={isDraft ? {
                noun: 'expense account',
                onClick: (q) => {
                  setCoaQcLineKey(primary._key);
                  setCoaQcSeed(q);
                  setCoaQcOpen(true);
                },
              } : undefined}
            />
            <div style={{ marginTop: '10px' }}>
              <input
                type="text"
                placeholder="Memo for this expense (optional)"
                value={primary.description}
                disabled={!isDraft}
                onChange={e => setLine(primary._key, { description: e.target.value })}
                style={{
                  width: '100%', padding: '8px 12px', fontSize: '13px',
                  border: `1px solid ${theme.border}`, borderRadius: '8px',
                  outline: 'none', background: !isDraft ? theme.muted : '#fff',
                }}
              />
            </div>
          </>
        )}

        {splitOpen && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            {lines.map((line) => {
              const c = calcLine(line);
              return (
                <div key={line._key} style={{
                  background: theme.page,
                  border: `1px solid ${theme.border}`,
                  borderRadius: '10px',
                  padding: '10px 12px',
                  display: 'flex', flexDirection: 'column', gap: '8px',
                }}>
                  <SearchableSelect
                    options={expenseAccountOpts}
                    value={line.expense_account_id}
                    onChange={(v) => setLine(line._key, { expense_account_id: v })}
                    disabled={!isDraft}
                    placeholder="Pick an expense category…"
                    panelWidth={380}
                    addNew={isDraft ? {
                      noun: 'expense account',
                      onClick: (q) => {
                        setCoaQcLineKey(line._key);
                        setCoaQcSeed(q);
                        setCoaQcOpen(true);
                      },
                    } : undefined}
                  />
                  <div className="grid grid-cols-2 items-center gap-1.5 md:grid-cols-[1.4fr_70px_110px_70px_90px_28px]">
                    <input
                      type="text" placeholder="Memo" value={line.description}
                      disabled={!isDraft}
                      onChange={e => setLine(line._key, { description: e.target.value })}
                      style={{ padding: '6px 10px', fontSize: '12px', border: `1px solid ${theme.border}`, borderRadius: '6px', outline: 'none', background: !isDraft ? theme.muted : '#fff' }}
                    />
                    <input
                      type="number" min="0" step="0.01" placeholder="Qty" value={line.quantity}
                      disabled={!isDraft}
                      onChange={e => setLine(line._key, { quantity: e.target.value })}
                      style={{ padding: '6px 10px', fontSize: '12px', border: `1px solid ${theme.border}`, borderRadius: '6px', outline: 'none', textAlign: 'end', background: !isDraft ? theme.muted : '#fff' }}
                    />
                    <input
                      type="number" min="0" step="0.01" placeholder="Unit" value={line.unit_amount}
                      disabled={!isDraft}
                      onChange={e => setLine(line._key, { unit_amount: e.target.value })}
                      style={{ padding: '6px 10px', fontSize: '12px', border: `1px solid ${theme.border}`, borderRadius: '6px', outline: 'none', textAlign: 'end', background: !isDraft ? theme.muted : '#fff' }}
                    />
                    <input
                      type="number" min="0" max="100" step="0.01" placeholder="Tax %" value={line.tax_rate}
                      disabled={!isDraft}
                      onChange={e => setLine(line._key, { tax_rate: e.target.value })}
                      style={{ padding: '6px 10px', fontSize: '12px', border: `1px solid ${theme.border}`, borderRadius: '6px', outline: 'none', textAlign: 'end', background: !isDraft ? theme.muted : '#fff' }}
                    />
                    <div className="font-mono" style={{ textAlign: 'end', fontSize: '13px', fontWeight: 600, color: theme.ink }}>
                      {fmt(c.line_total)}
                    </div>
                    {isDraft && lines.length > 1 ? (
                      <button
                        onClick={() => removeLine(line._key)}
                        style={{ background: 'transparent', border: 'none', color: theme.inkFaint, cursor: 'pointer', fontSize: '16px' }}
                        title="Remove split"
                      >×</button>
                    ) : <span />}
                  </div>
                  <label style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '11px', color: theme.inkMuted }}>
                    <input
                      type="checkbox" checked={line.is_billable} disabled={!isDraft}
                      onChange={e => setLine(line._key, { is_billable: e.target.checked, customer_id: e.target.checked ? line.customer_id : '' })}
                    />
                    <span>Bill back to customer</span>
                    {line.is_billable && (
                      <span style={{ marginInlineStart: '8px', minWidth: '200px' }}>
                        <SearchableSelect
                          options={customerOpts}
                          value={line.customer_id}
                          onChange={(v) => setLine(line._key, { customer_id: v })}
                          disabled={!isDraft}
                          placeholder="Customer…"
                          panelWidth={220}
                        />
                      </span>
                    )}
                  </label>
                </div>
              );
            })}
            {isDraft && (
              <button
                onClick={addLine}
                style={{ alignSelf: 'flex-start', background: 'transparent', border: 'none', cursor: 'pointer', fontSize: '12px', fontWeight: 600, color: theme.brand, padding: '4px 8px' }}
              >+ Add another split</button>
            )}
          </div>
        )}

        {/* Split toggle */}
        {isDraft && (
          <div style={{ marginTop: '12px' }}>
            <button
              onClick={() => setSplitOpen((o) => !o)}
              style={{
                background: 'transparent',
                border: `1px dashed ${theme.border}`,
                borderRadius: '8px',
                padding: '8px 14px',
                fontSize: '12px',
                color: theme.inkMuted,
                cursor: 'pointer',
                width: '100%',
                textAlign: 'center',
                fontWeight: 500,
              }}
            >
              {splitOpen ? '— Hide split (combine back into one line)' : '+ Split across multiple categories'}
            </button>
          </div>
        )}

        {/* ── Quick context ── */}
        <SectionLabel>Quick context</SectionLabel>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 200px), 1fr))', gap: '10px' }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
            <label style={{ fontSize: '10px', fontWeight: 600, color: theme.inkMuted, textTransform: 'uppercase', letterSpacing: '.05em' }}>Date</label>
            <input
              type="date" value={date} disabled={!isDraft}
              onChange={e => setDate(e.target.value)}
              style={{ padding: '7px 10px', fontSize: '13px', border: `1px solid ${theme.border}`, borderRadius: '7px', outline: 'none', background: !isDraft ? theme.muted : '#fff' }}
            />
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
            <label style={{ fontSize: '10px', fontWeight: 600, color: theme.inkMuted, textTransform: 'uppercase', letterSpacing: '.05em' }}>
              Paid from <span style={{ color: theme.danger }}>*</span>
            </label>
            <SearchableSelect
              options={bankOpts}
              value={paidFromId}
              onChange={setPaidFromId}
              disabled={!isDraft}
              placeholder="Bank / cash"
              panelWidth={240}
            />
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
            <label style={{ fontSize: '10px', fontWeight: 600, color: theme.inkMuted, textTransform: 'uppercase', letterSpacing: '.05em' }}>Vendor</label>
            <ContactPicker
              type="supplier"
              value={supplierId}
              onChange={(v) => setSupplierId(v ?? '')}
              disabled={!isDraft}
              placeholder="Optional"
            />
          </div>
        </div>

        <div className="mt-2.5 grid grid-cols-1 gap-2.5 md:grid-cols-[1fr_2fr]">
          <input
            type="text" value={reference} disabled={!isDraft}
            placeholder="Reference / invoice #"
            onChange={e => setReference(e.target.value)}
            style={{ padding: '8px 12px', fontSize: '13px', border: `1px solid ${theme.border}`, borderRadius: '7px', outline: 'none', background: !isDraft ? theme.muted : '#fff' }}
          />
          <input
            type="text" value={description} disabled={!isDraft}
            placeholder="Description (e.g. June office rent)"
            onChange={e => setDescription(e.target.value)}
            style={{ padding: '8px 12px', fontSize: '13px', border: `1px solid ${theme.border}`, borderRadius: '7px', outline: 'none', background: !isDraft ? theme.muted : '#fff' }}
          />
        </div>

        {/* Billable section — only shown in single-line mode. In split mode
            each line carries its own billable + customer picker inline. */}
        {!splitOpen && (
          <>
            <SectionLabel>Bill back to a customer?</SectionLabel>
            <label style={{ display: 'flex', alignItems: 'center', gap: '10px', cursor: isDraft ? 'pointer' : 'not-allowed', userSelect: 'none' }}>
              <input
                type="checkbox" checked={primary.is_billable} disabled={!isDraft}
                onChange={e => setLine(primary._key, { is_billable: e.target.checked, customer_id: e.target.checked ? primary.customer_id : '' })}
              />
              <span style={{ fontSize: '13px', color: theme.ink, fontWeight: 500 }}>
                This is reimbursable from a customer
              </span>
            </label>
            {primary.is_billable && (
              <div style={{ marginTop: '8px' }}>
                <SearchableSelect
                  options={customerOpts}
                  value={primary.customer_id}
                  onChange={(v) => setLine(primary._key, { customer_id: v })}
                  disabled={!isDraft}
                  placeholder="Pick the customer…"
                  panelWidth={420}
                />
              </div>
            )}
          </>
        )}

        {/* Final total ribbon */}
        <div style={{
          marginTop: '24px',
          padding: '16px 20px',
          background: theme.brandSoft,
          borderRadius: '12px',
          border: '1px solid #ddd6fe',
          display: 'flex', alignItems: 'center', gap: '12px',
        }}>
          <span style={{
            fontSize: '11px', fontWeight: 700,
            color: theme.brandSoftText,
            textTransform: 'uppercase', letterSpacing: '.08em',
          }}>Total to pay</span>
          <span style={{ marginInlineStart: 'auto', fontFamily: theme.fontMono, fontSize: '24px', fontWeight: 800, color: theme.brand, letterSpacing: '-.01em' }}>
            {companyCurrency} {fmt(totals.total)}
          </span>
        </div>
        </div>
      </div>

      {isVoid && expense?.void_reason && (
        <div style={{
          background: theme.dangerSoft, border: `1px solid ${theme.dangerBorder}`,
          borderRadius: '8px', padding: '10px 16px', fontSize: '13px', color: theme.danger,
        }}>
          <strong>Void reason:</strong> {expense.void_reason}
        </div>
      )}

      {/* Phase 13.02b — quick-create CoA modal */}
      <CoaQuickCreate
        open={coaQcOpen}
        defaultPreset="indirect_expense"
        initialName={coaQcSeed}
        onClose={() => setCoaQcOpen(false)}
        onCreated={(row) => {
          setCoaQcOpen(false);
          if (coaQcLineKey !== null) setLine(coaQcLineKey, { expense_account_id: row.id });
          setCoaQcLineKey(null);
        }}
      />
    </div>
  );
}
