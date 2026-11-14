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
import { useEffect, useMemo, useRef, useState } from 'react';
import { useDocumentPayments } from '@/hooks/use-document-payments';
import { useParams, useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { getAdapter } from '@/data/index';
import { useAuthStore } from '@/store/auth';
import { useProjectsEnabled } from '@/hooks/use-company-currency';
import { useCompanyCurrency, useCompanyCountry } from '@/hooks/use-company-currency';
import { defaultTaxRate } from '@/lib/locale';
import { useInvalidateBooks } from '@/hooks/use-invalidate-books';
import { useHasPermission } from '@/hooks/use-permissions';
import { useUnsavedChangesGuard } from '@/hooks/use-unsaved-changes-guard';
import { Button } from '@/ui/button';
import { BackButton } from '@/ui/back-button';
import { StatusBadge } from '@/ui/status-badge';
import { Pencil, Printer, Eye, Plus, Minus, X, Tag, ReceiptText, UserRoundCheck, Ban } from 'lucide-react';
import '@/styles/stockbolt-ocean-teal.css';
import { SearchableSelect } from '@/ui/searchable-select';
import { ContactPicker } from '@/components/contact-picker';
import { ProjectPicker } from '@/components/project-picker';
import { CoaQuickCreate } from '@/components/quick-create/coa-quick-create';
// Phase 14.06 — Signature template view mode for saved expenses.
import { ConfigurableDocTemplate } from '@/modules/print/engine/ConfigurableDocTemplate';
import { useResolvedPrintTemplate } from '@/hooks/use-resolved-print-template';
import { expenseToDocumentData, withPaymentDetails } from '@/modules/print/_signature/adapters';
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

function calcLine(l: LineRow, inclusive = false) {
  const qty = parseFloat(l.quantity) || 0;
  const unit = parseFloat(l.unit_amount) || 0;
  const rate = parseFloat(l.tax_rate) || 0;
  const amount = round2(qty * unit);
  if (inclusive) {
    // The entered amount already INCLUDES tax — back out the net + tax.
    const sub = round2(amount / (1 + rate / 100));
    return { line_subtotal: sub, tax_amount: round2(amount - sub), line_total: amount };
  }
  // Tax-exclusive: the entered amount is the net; tax is added on top.
  const tax = round2(amount * (rate / 100));
  return { line_subtotal: amount, tax_amount: tax, line_total: round2(amount + tax) };
}

// ── Uniform field styling (Phase 28b — tidy the "messy containers") ──────────
// One height, one border, one radius for every control in the form.
function fld(editable: boolean): React.CSSProperties {
  return {
    // ~30px tall to line up with the SearchableSelect / ContactPicker triggers
    // (which render compact at py-1 text-xs) so each Details row aligns.
    width: '100%', height: '38px', padding: '0 12px', fontSize: '14px',
    border: '1px solid var(--sb-border)', borderRadius: '10px', outline: 'none',
    background: editable ? '#fff' : 'var(--sb-background)', color: 'var(--sb-text)',
  };
}
// Labelled field cell for the details grid.
function Field({ label, children }: { label: React.ReactNode; children: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '5px', minWidth: 0 }}>
      <label style={{ fontSize: '13px', fontWeight: 600, color: 'var(--sb-text-secondary)' }}>{label}</label>
      {children}
    </div>
  );
}

// ── Page ───────────────────────────────────────────────────────────────────
export default function ExpenseEditorPage() {
  const { t } = useTranslation();
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const printTemplate = useResolvedPrintTemplate('purchase_invoice');
  const companyCurrency = useCompanyCurrency();   // Issue 1 — localize money to tenant currency
  const companyCountry = useCompanyCountry();     // Phase 21 — default tax to the country's standard rate
  // Country's standard tax rate (5% GCC / 18% India). '0' until the company loads.
  const stdTaxRate = companyCountry ? String(defaultTaxRate(companyCountry)) : '0';
  const qc = useQueryClient();
  const invalidateBooks = useInvalidateBooks();   // Phase 14.14k
  const canEditExpenses = useHasPermission('purchasing.write');   // Phase 25 — gate Edit
  const { company_id } = useAuthStore();
  const projectsEnabled = useProjectsEnabled();
  const isNew = !id || id === 'new';
  const today = new Date().toISOString().slice(0, 10);

  // Header state
  const [date, setDate]           = useState(today);
  const [paidFromId, setPaidFromId] = useState('');
  const [supplierId, setSupplierId] = useState('');
  const [projectId, setProjectId]   = useState('');
  const [reference, setReference] = useState('');
  const [description, setDescription] = useState('');
  const [voidReason, setVoidReason] = useState('');

  // Lines (always at least 1 — the "primary" expense category)
  const [lines, setLines]   = useState<LineRow[]>([newLine()]);
  const [splitOpen, setSplitOpen] = useState(false);
  // Whether the entered amount already includes tax (vs tax added on top).
  const [taxInclusive, setTaxInclusive] = useState(false);

  // Phase 21 — on a NEW expense, default the tax pill to the country's standard
  // rate (5% GCC / 18% India) once the company loads. Touches only the pristine
  // primary line (no account picked, still 0%), runs once, never on an existing
  // expense or a rate the user already changed.
  const seededDefaultRate = useRef(false);
  useEffect(() => {
    if (!isNew || seededDefaultRate.current || stdTaxRate === '0') return;
    seededDefaultRate.current = true;
    setLines(prev => prev.map((l, i) =>
      (i === 0 && l.expense_account_id === '' && l.tax_rate === '0')
        ? { ...l, tax_rate: stdTaxRate }
        : l));
  }, [isNew, stdTaxRate]);

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
    setProjectId((expense as { project_id?: string | null }).project_id ?? '');
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
      const c = calcLine(l, taxInclusive);
      sub += c.line_subtotal;
      tax += c.tax_amount;
    }
    return { subtotal: round2(sub), tax: round2(tax), total: round2(sub + tax) };
  }, [lines, taxInclusive]);

  // Reference options
  const isDraft = isNew || expense?.status === 'draft';
  const isConfirmed = expense?.status === 'confirmed';
  const isVoid  = expense?.status === 'void';

  const bankOpts = bankAccounts.map(b => ({ value: b.id, label: `${b.name} · ${b.account_type === 'cash' ? t('rcptOcean.cash') : t('rcptOcean.bank')}` }));
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
      if (!paidFromId) throw new Error(t('expOcean.err_paid_from'));
      if (lines.length === 0) throw new Error(t('expOcean.err_line'));
      for (const l of lines) {
        if (!l.expense_account_id) throw new Error(t('expOcean.err_category'));
        if (l.is_billable && !l.customer_id) throw new Error(t('expOcean.err_customer'));
      }

      const itemInserts: ExpenseItemInsert[] = lines.map((l, idx) => {
        const c = calcLine(l, taxInclusive);
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
        project_id:           projectId || null,
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
      // Save = persist then immediately post (single-step). Failed post leaves
      // a saved draft; a new doc routes to its record so retry won't duplicate.
      try {
        await getAdapter().expenses.confirm(expenseId);
      } catch (e) {
        if (isNew) navigate(`/purchasing/expenses/${expenseId}`);
        throw e;
      }
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

  const voidMutation = useMutation({
    mutationFn: async () => { await getAdapter().expenses.void(id!, voidReason || undefined); },
    onSuccess: async () => {
      await invalidateBooks();
      qc.invalidateQueries({ queryKey: ['expenses', company_id] });
      qc.invalidateQueries({ queryKey: ['expense', id] });
    },
    onError: (e: Error) => setError(e.message),
  });

  // Phase 25 — reverse a confirmed expense's posting and reopen it as a draft.
  const reopenMutation = useMutation({
    mutationFn: async () => { await getAdapter().expenses.reopen(id!); },
    onSuccess: async () => {
      await invalidateBooks();
      await qc.invalidateQueries({ queryKey: ['expense', id] });
      qc.invalidateQueries({ queryKey: ['expenses', company_id] });
      qc.invalidateQueries({ queryKey: ['expense_items', id] });
      setViewMode(false);   // drop into the editable draft
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
  const addLine = () => { setLines(prev => [...prev, { ...newLine(), tax_rate: stdTaxRate }]); setDirty(true); };

  // Primary line = first line. When split is closed, lines[0] is the only
  // line; when split is open the user can add more.
  const primary = lines[0];
  const primaryCalc = calcLine(primary, taxInclusive);

  // Ocean Teal — status uses the shared translated badge.
  const statusPill = (st?: string) => st ? <StatusBadge status={st} /> : null;

  // Phase 14.06 — view-mode renderer (Signature template).
  // Drafts open in the editable form (single Save posts them); only posted
  // expenses show the read-only template view.
  // Verified payments / refunds / bank-cash lines for the Payment details section.
  const docPayments = useDocumentPayments('expense', expense?.id, !!expense && expense.status !== 'draft');
  // phase126 — an expense that carries a fixed-asset purchase is reopened from
  // that purchase (which also removes the register rows), never from here.
  const { data: assetPurchases = [] } = useQuery({
    queryKey: ['fixed_asset_purchases', company_id],
    queryFn: () => getAdapter().fixedAssets.listPurchases(company_id!),
    enabled: !!company_id && !!expense && expense.status === 'confirmed',
  });
  const assetPurchase = expense ? assetPurchases.find(p => p.doc_type === 'expense' && p.doc_id === expense.id) : undefined;
  if (viewMode && !isNew && expense && expense.status !== 'draft') {
    const docBase = expenseToDocumentData({
      expense,
      items,
      supplier: expense.supplier_id ? suppliers.find(s => s.id === expense.supplier_id) ?? null : null,
      company:  companyRow ?? null,
      coa,
      bankAccounts,
    });
    const doc = withPaymentDetails(docBase, 'expense', docPayments);
    return (
      // Ocean Teal (UI v1.1): look only — same actions and printed expense.
      <div className="signature-print-scope sb-ocean sb-docx" data-testid="expense-view-ocean">
        <div data-print-hide className="sb-card sb-doc-bar">
          <div className="sb-doc-bar-id">
            <BackButton to="/purchasing/expenses" label={t('banking.expenses_title')} confirm={confirmLeave} />
            <bdi dir="ltr" className="sb-doc-bar-no">{expense.expense_number}</bdi>
            {statusPill(expense.status)}
          </div>
          <div className="sb-doc-bar-actions">
            {isDraft && (
              <Button size="sm" onClick={() => setViewMode(false)}>
                <Pencil size={15} aria-hidden="true" /> {t('common.edit') || 'Edit'}
              </Button>
            )}
            {isConfirmed && assetPurchase && (
              <Button size="sm" onClick={() => navigate(`/accounting/fixed-assets/purchase/${assetPurchase.id}`)}>
                {t('expOcean.open_asset_purchase')}
              </Button>
            )}
            {isConfirmed && !assetPurchase && canEditExpenses && (
              <Button size="sm" disabled={reopenMutation.isPending} onClick={() => {
                if (window.confirm(t('expOcean.reopen_confirm'))) reopenMutation.mutate();
              }}>
                <Pencil size={15} aria-hidden="true" /> {reopenMutation.isPending ? t('billOcean.reopening') : (t('common.edit') || 'Edit')}
              </Button>
            )}
            {/* Void lives here: a confirmed expense always opens in this view, and
                Edit reopens it as a draft, so the editor's own Void was never reached. */}
            {isConfirmed && !assetPurchase && canEditExpenses && (
              <Button variant="danger" size="sm" disabled={voidMutation.isPending} data-testid="expense-void" onClick={() => {
                const r = prompt(t('expOcean.void_prompt'));
                setVoidReason(r ?? '');
                if (r !== null) voidMutation.mutate();
              }}>
                <Ban size={15} aria-hidden="true" /> {t('common.void')}
              </Button>
            )}
            {expense?.id && (
              <Button variant="ghost" size="sm" onClick={() => window.print()}>
                <Printer size={15} aria-hidden="true" /> {t('print.print') || 'Print'}
              </Button>
            )}
          </div>
        </div>
        {error && <p data-print-hide className="sb-alert sb-alert-danger" role="alert">{error}</p>}
        {isConfirmed && assetPurchase && (
          <p data-print-hide className="sb-info-note">{t('expOcean.asset_purchase_note')}</p>
        )}
        {isVoid && expense.void_reason && (
          <p data-print-hide className="sb-alert sb-alert-warn"><strong>{t('expOcean.void_reason')}</strong> {expense.void_reason}</p>
        )}
        <div className="signature-canvas sb-doc-canvas">
          <ConfigurableDocTemplate data={doc} template={printTemplate} />
        </div>
      </div>
    );
  }

  return (
    // Ocean Teal (UI v1.1), layout E: form cards + a live summary panel.
    // Same amount, tax, split lines, details, billable customer, totals and
    // save / void / reopen as before — only the arrangement changed.
    <div className="sb-ocean sb-docx sb-docx-edit sb-exp-editor" data-testid="expense-edit-ocean">
      <div className="sb-card sb-doc-bar">
        <div className="sb-doc-bar-id">
          <BackButton to="/purchasing/expenses" label={t('banking.expenses_title')} confirm={confirmLeave} />
          {isNew
            ? <h1 className="sb-doc-bar-no">{t('purchOcean.new_expense')}</h1>
            : <bdi dir="ltr" className="sb-doc-bar-no">{expense?.expense_number ?? '…'}</bdi>}
          {!isNew && statusPill(expense?.status)}
        </div>
        <div className="sb-doc-bar-actions">
          {!isNew && expense && expense.status !== 'draft' && (
            <Button variant="ghost" size="sm" onClick={() => setViewMode(true)}>
              <Eye size={15} aria-hidden="true" /> {t('common.view') || 'View'}
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
          {isConfirmed && (
            <Button variant="danger" size="sm" onClick={() => {
              const r = prompt(t('expOcean.void_prompt'));
              setVoidReason(r ?? '');
              if (r !== null) voidMutation.mutate();
            }}>{t('common.void')}</Button>
          )}
        </div>
      </div>

      {error && <p className="sb-alert sb-alert-danger" role="alert">{error}</p>}

      {/* ── Option E: form cards on the start side, live summary on the end side ── */}
      <div className="sb-exp-layout">
        <div className="sb-exp-main">
          <div className="sb-card sb-form sb-doc-card">
        {/* ── What was it for ── */}
        <h2 className="sb-doc-card-title sb-exp-card-title"><Tag size={17} aria-hidden="true" /> {t('expOcean.what_for')}</h2>

        {!splitOpen && (
          <>
            <SearchableSelect
              options={expenseAccountOpts}
              value={primary.expense_account_id}
              onChange={(v) => setLine(primary._key, { expense_account_id: v })}
              disabled={!isDraft}
              placeholder={t('expOcean.pick_category')}
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
                placeholder={t('expOcean.memo_optional')}
                value={primary.description}
                disabled={!isDraft}
                onChange={e => setLine(primary._key, { description: e.target.value })}
                style={fld(isDraft)}
              />
            </div>
          </>
        )}

        {splitOpen && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            {lines.map((line) => {
              const c = calcLine(line, taxInclusive);
              return (
                <div key={line._key} style={{
                  background: 'var(--sb-background)',
                  border: '1px solid var(--sb-border)',
                  borderRadius: '12px',
                  padding: '10px 12px',
                  display: 'flex', flexDirection: 'column', gap: '8px',
                }}>
                  <SearchableSelect
                    options={expenseAccountOpts}
                    value={line.expense_account_id}
                    onChange={(v) => setLine(line._key, { expense_account_id: v })}
                    disabled={!isDraft}
                    placeholder={t('expOcean.pick_category')}
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
                      type="text" placeholder={t('expOcean.memo')} value={line.description}
                      disabled={!isDraft}
                      onChange={e => setLine(line._key, { description: e.target.value })}
                      style={{ height: '34px', padding: '0 10px', fontSize: '12px', border: '1px solid var(--sb-border)', borderRadius: '8px', outline: 'none', background: !isDraft ? 'var(--sb-background)' : '#fff' }}
                    />
                    <input
                      type="number" min="0" step="0.01" placeholder={t('expOcean.qty')} value={line.quantity}
                      disabled={!isDraft}
                      onChange={e => setLine(line._key, { quantity: e.target.value })}
                      style={{ height: '34px', padding: '0 10px', fontSize: '12px', border: '1px solid var(--sb-border)', borderRadius: '8px', outline: 'none', textAlign: 'end', background: !isDraft ? 'var(--sb-background)' : '#fff' }} dir="ltr"
                    />
                    <input
                      type="number" min="0" step="0.01" placeholder={t('expOcean.unit')} value={line.unit_amount}
                      disabled={!isDraft}
                      onChange={e => setLine(line._key, { unit_amount: e.target.value })}
                      style={{ height: '34px', padding: '0 10px', fontSize: '12px', border: '1px solid var(--sb-border)', borderRadius: '8px', outline: 'none', textAlign: 'end', background: !isDraft ? 'var(--sb-background)' : '#fff' }} dir="ltr"
                    />
                    <input
                      type="number" min="0" max="100" step="0.01" placeholder={t('expOcean.tax_pct')} value={line.tax_rate}
                      disabled={!isDraft}
                      onChange={e => setLine(line._key, { tax_rate: e.target.value })}
                      style={{ height: '34px', padding: '0 10px', fontSize: '12px', border: '1px solid var(--sb-border)', borderRadius: '8px', outline: 'none', textAlign: 'end', background: !isDraft ? 'var(--sb-background)' : '#fff' }} dir="ltr"
                    />
                    <div className="font-mono" dir="ltr" style={{ textAlign: 'end', fontSize: '13px', fontWeight: 700, color: 'var(--sb-text)' }}>
                      {fmt(c.line_total)}
                    </div>
                    {isDraft && lines.length > 1 ? (
                      <button
                        type="button"
                        onClick={() => removeLine(line._key)}
                        className="sb-doc-line-del"
                        title={t('expOcean.remove_split')} aria-label={t('expOcean.remove_split')}
                      ><X size={15} aria-hidden="true" /></button>
                    ) : <span />}
                  </div>
                  <label style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '6px', fontSize: '12px', color: 'var(--sb-text-secondary)' }}>
                    <input
                      type="checkbox" checked={line.is_billable} disabled={!isDraft}
                      onChange={e => setLine(line._key, { is_billable: e.target.checked, customer_id: e.target.checked ? line.customer_id : '' })}
                    />
                    <span>{t('expOcean.bill_back')}</span>
                    {line.is_billable && (
                      <span style={{ marginInlineStart: '8px', minWidth: 'min(200px, 100%)' }}>
                        <SearchableSelect
                          options={customerOpts}
                          value={line.customer_id}
                          onChange={(v) => setLine(line._key, { customer_id: v })}
                          disabled={!isDraft}
                          placeholder={t('expOcean.customer')}
                          panelWidth={220}
                        />
                      </span>
                    )}
                  </label>
                </div>
              );
            })}
            {isDraft && (
              <button type="button" onClick={addLine} className="sb-row-link text-brand-600" style={{ alignSelf: 'flex-start' }}>
                <Plus size={15} aria-hidden="true" /> {t('expOcean.add_split')}
              </button>
            )}
          </div>
        )}

        {/* Split toggle */}
        {isDraft && (
          <div style={{ marginTop: '12px' }}>
            <button type="button" onClick={() => setSplitOpen((o) => !o)} className="sb-exp-split-btn">
              {splitOpen ? <Minus size={15} aria-hidden="true" /> : <Plus size={15} aria-hidden="true" />}
              {splitOpen ? t('expOcean.hide_split') : t('expOcean.show_split')}
            </button>
          </div>
        )}

          </div>
          <div className="sb-card sb-form sb-doc-card">
        {/* ── Payment details (uniform 2-column field grid) ── */}
        <h2 className="sb-doc-card-title sb-exp-card-title"><ReceiptText size={17} aria-hidden="true" /> {t('expOcean.payment_details')}</h2>

        <div className="sb-exp-grid">
          <Field label={t('common.date')}>
            <input
              type="date" value={date} disabled={!isDraft}
              onChange={e => setDate(e.target.value)}
              style={fld(isDraft)}
            />
          </Field>
          <Field label={<>{t('expOcean.paid_from')} <span style={{ color: 'var(--sb-danger)' }}>*</span></>}>
            <SearchableSelect
              options={bankOpts}
              value={paidFromId}
              onChange={setPaidFromId}
              disabled={!isDraft}
              placeholder={t('expOcean.bank_cash')}
              panelWidth={240}
            />
          </Field>
          <Field label={t('expOcean.vendor')}>
            <ContactPicker
              type="supplier"
              value={supplierId}
              onChange={(v) => setSupplierId(v ?? '')}
              disabled={!isDraft}
              placeholder={t('expOcean.optional')}
            />
          </Field>
          {/* ProjectPicker renders nothing when the module is off, which would
              leave this <Field> as a label with no control — so the flag is
              read here too, purely for the wrapper. */}
          {projectsEnabled && (
            <Field label={t('projects.singular')}>
              <ProjectPicker
                noLabel
                value={projectId}
                disabled={!isDraft}
                onChange={setProjectId}
              />
            </Field>
          )}
          <Field label={t('expOcean.reference')}>
            <input
              type="text" value={reference} disabled={!isDraft}
              placeholder={t('expOcean.reference_ph')}
              onChange={e => setReference(e.target.value)}
              style={fld(isDraft)}
            />
          </Field>
          <div style={{ gridColumn: '1 / -1' }}>
            <Field label={t('common.description')}>
              <input
                type="text" value={description} disabled={!isDraft}
                placeholder={t('expOcean.description_ph')}
                onChange={e => setDescription(e.target.value)}
                style={fld(isDraft)}
              />
            </Field>
          </div>
        </div>

          </div>
        {/* Billable section — only shown in single-line mode. In split mode
            each line carries its own billable + customer picker inline. */}
        {!splitOpen && (
          <div className="sb-card sb-doc-card">
            <label className="sb-exp-switch-row" style={{ cursor: isDraft ? 'pointer' : 'not-allowed' }}>
              <span className="sb-exp-switch-txt">
                <span className="sb-exp-card-title" style={{ margin: 0 }}><UserRoundCheck size={17} aria-hidden="true" /> {t('expOcean.bill_back_q')}</span>
                <span className="sb-form-hint" style={{ margin: 0 }}>{t('expOcean.reimbursable')}</span>
              </span>
              <input
                type="checkbox" role="switch" className="sb-exp-switch"
                checked={primary.is_billable} disabled={!isDraft}
                onChange={e => setLine(primary._key, { is_billable: e.target.checked, customer_id: e.target.checked ? primary.customer_id : '' })}
              />
            </label>
            {primary.is_billable && (
              <div style={{ marginTop: '8px' }}>
                <SearchableSelect
                  options={customerOpts}
                  value={primary.customer_id}
                  onChange={(v) => setLine(primary._key, { customer_id: v })}
                  disabled={!isDraft}
                  placeholder={t('expOcean.pick_customer')}
                  panelWidth={420}
                />
              </div>
            )}
          </div>
        )}

        </div>
        {/* ── Live summary (sticky on desktop, first on phones) ── */}
        <aside className="sb-exp-aside">
          <div className="sb-card sb-doc-card sb-exp-summary" data-testid="expense-summary">
            <span className="sb-info-label">{t('expOcean.amount')}</span>
            {splitOpen ? (
              <bdi dir="ltr" className="sb-exp-amount-static">{companyCurrency} {fmt(totals.total)}</bdi>
            ) : (
              <div dir="ltr" className="sb-exp-amount">
                <span className="sb-exp-amount-cur">{companyCurrency}</span>
                <input
                  type="number" min="0" step="0.01"
                  value={primary.unit_amount}
                  disabled={!isDraft}
                  onChange={e => setLine(primary._key, { unit_amount: e.target.value })}
                  aria-label={t('expOcean.amount')}
                  placeholder="0.00"
                />
              </div>
            )}
            {splitOpen && <span className="sb-form-hint" style={{ margin: 0 }}>{t('expOcean.split_total_hint', { count: lines.length })}</span>}

            {/* Tax inclusive / exclusive — a segmented switch */}
            <div className="sb-exp-seg" role="group" aria-label={t('common.tax')}>
              {([
                { v: false, label: t('expOcean.excl_tax_short') },
                { v: true,  label: t('expOcean.incl_tax_short') },
              ] as const).map(opt => (
                <button
                  key={String(opt.v)}
                  type="button"
                  disabled={!isDraft}
                  aria-pressed={taxInclusive === opt.v}
                  title={opt.v ? t('expOcean.incl_tax') : t('expOcean.excl_tax')}
                  className={taxInclusive === opt.v ? 'active' : ''}
                  onClick={() => { setTaxInclusive(opt.v); setDirty(true); }}
                >{opt.label}</button>
              ))}
            </div>

            <div className="sb-doc-summary-rows">
              {!splitOpen && (
                <div className="flex items-center justify-between text-ink-secondary">
                  <span>{t('expOcean.tax_rate')}</span>
                  <span dir="ltr" className="sb-exp-rate">
                    <input
                      type="number" min="0" max="100" step="0.01"
                      value={primary.tax_rate}
                      disabled={!isDraft}
                      onChange={e => setLine(primary._key, { tax_rate: e.target.value })}
                      aria-label={t('expOcean.tax_rate')}
                      placeholder="0"
                    />
                    <span>%</span>
                  </span>
                </div>
              )}
              <div className="flex justify-between text-ink-secondary">
                <span>{t('purchasing.subtotal')}</span>
                <span className="font-mono" dir="ltr">{fmt(splitOpen ? totals.subtotal : primaryCalc.line_subtotal)}</span>
              </div>
              <div className="flex justify-between text-ink-secondary">
                <span>{t('common.tax')}</span>
                <span className="font-mono" dir="ltr">{fmt(splitOpen ? totals.tax : primaryCalc.tax_amount)}</span>
              </div>
              <div className="sb-doc-grand">
                <span>{t('expOcean.total_to_pay')}</span>
                <bdi dir="ltr">{companyCurrency} {fmt(totals.total)}</bdi>
              </div>
            </div>
            {isDraft && (
              <button type="button" className="sb-primary-btn" style={{ width: '100%', marginTop: 4 }}
                onClick={() => { setError(null); saveMutation.mutate(); }} disabled={saveMutation.isPending}>
                {saveMutation.isPending ? t('common.saving') : t('expOcean.save_expense')}
              </button>
            )}
          </div>
        </aside>
      </div>

      {isVoid && expense?.void_reason && (
        <p className="sb-alert sb-alert-danger" style={{ fontWeight: 400 }}>
          <strong>{t('expOcean.void_reason')}</strong> {expense.void_reason}
        </p>
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
