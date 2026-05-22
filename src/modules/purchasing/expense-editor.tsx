/**
 * Expense editor — Phase 13.02.
 *
 * Multi-line expense editor under /purchasing/expenses/[new|:id].
 *
 * Header:
 *   - Date  (defaults to today)
 *   - Paid From  (bank account dropdown)
 *   - Vendor / Supplier  (optional, ContactPicker)
 *   - Reference (free text — supplier's invoice number etc.)
 *   - Description (header-level note)
 *
 * Line items grid (one row per expense category):
 *   - Expense account (5xxx/6xxx CoA, searchable)
 *   - Description
 *   - Qty / Unit amount
 *   - Tax %
 *   - Billable + Customer picker (visible when billable)
 *   - Line total (computed)
 *
 * Footer:
 *   - Live subtotal / tax / total
 *
 * Status flow: draft → confirmed → void. Confirm calls the multi-line-
 * aware confirm_expense RPC shipped in Phase 13.01.
 *
 * The OLD single-line /banking/expense-editor stays usable for legacy
 * data; new expenses created here always write child expense_items.
 */
import { useEffect, useMemo, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { getAdapter } from '@/data/index';
import { useAuthStore } from '@/store/auth';
import { Button } from '@/ui/button';
import { Input } from '@/ui/input';
import { SearchableSelect } from '@/ui/searchable-select';
import { ContactPicker } from '@/components/contact-picker';
import { CoaQuickCreate } from '@/components/quick-create/coa-quick-create';
import { theme } from '@/ui/theme';
import type {
  BankAccountRow, CoaRow, ExpenseRow, ExpenseItemRow,
  ExpenseItemInsert, ContactRow,
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

// ── Page ───────────────────────────────────────────────────────────────────
export default function ExpenseEditorPage() {
  const { t } = useTranslation();
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const qc = useQueryClient();
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
  const [lines, setLines]         = useState<LineRow[]>([newLine()]);
  const [error, setError]         = useState<string | null>(null);

  // Phase 13.02b — quick-create CoA from the line picker. Mirrors the
  // product quick-create on invoice/PO/bill lines. The line that
  // triggered it gets the new account assigned automatically on close.
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
  // Customers list — for the billable-line customer picker. Suppliers are
  // resolved by the ContactPicker component on its own.
  const { data: customers = [] } = useQuery<ContactRow[]>({
    queryKey: ['contacts', company_id, 'customer'],
    queryFn:  () => getAdapter().contacts.list(company_id!, 'customer'),
    enabled:  !!company_id,
  });

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
    if (items.length === 0) return;
    setLines(items.map(it => ({
      _key: ++_keySeq,
      expense_account_id: it.expense_account_id,
      description: it.description ?? '',
      quantity: String(it.quantity),
      unit_amount: String(it.unit_amount),
      tax_rate: String(it.tax_rate),
      is_billable: it.is_billable,
      customer_id: it.customer_id ?? '',
    })));
  }, [items]);

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
  const isVoid  = expense?.status === 'void';
  const isConfirmed = expense?.status === 'confirmed';

  const bankOpts = bankAccounts.map(b => ({ value: b.id, label: b.name }));
  // Phase 13.02b — filter by type='expense', not by code prefix.
  // Phase 13.02c — group-sort direct (COGS) first, then indirect (operating),
  //   then by code. Append "· direct" / "· indirect" to the label so the eye
  //   can see the sub-type without leaving the dropdown. Side benefit: typing
  //   "indirect" filters down to operating accounts for free.
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
        if (!l.expense_account_id) throw new Error('Every line needs an expense account');
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

      // Header header header — denormalized totals stay in sync via the
      // computed sums; we'll read them back when the confirm RPC posts GL.
      const headerCommon = {
        company_id:           company_id!,
        date,
        paid_from_account_id: paidFromId,
        supplier_id:          supplierId || null,
        reference:            reference || null,
        description:          description || '(no description)',
        // expense_account_id is required NOT NULL on the legacy parent
        // table; populate it with the FIRST line's account so reports
        // that still read the parent-level field show something sane.
        expense_account_id:   itemInserts[0].expense_account_id,
        amount:               totals.subtotal,
        tax_amount:           totals.tax,
        total_amount:         totals.total,
      };

      let expenseId: string;
      if (isNew) {
        const created = await getAdapter().expenses.create({
          ...headerCommon,
          expense_number: nextNumber!,
        });
        expenseId = created.id;
      } else {
        const updated = await getAdapter().expenses.update(id!, headerCommon);
        expenseId = updated.id;
      }
      await getAdapter().expenses.replaceItems(expenseId, itemInserts);
      return expenseId;
    },
    onSuccess: (expenseId) => {
      qc.invalidateQueries({ queryKey: ['expenses', company_id] });
      qc.invalidateQueries({ queryKey: ['expense', expenseId] });
      qc.invalidateQueries({ queryKey: ['expense_items', expenseId] });
      if (isNew) navigate(`/purchasing/expenses/${expenseId}`);
    },
    onError: (e: Error) => setError(e.message),
  });

  const confirmMutation = useMutation({
    mutationFn: async () => {
      await getAdapter().expenses.confirm(id!);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['expenses', company_id] });
      qc.invalidateQueries({ queryKey: ['expense', id] });
    },
    onError: (e: Error) => setError(e.message),
  });

  const voidMutation = useMutation({
    mutationFn: async () => {
      await getAdapter().expenses.void(id!, voidReason || undefined);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['expenses', company_id] });
      qc.invalidateQueries({ queryKey: ['expense', id] });
    },
    onError: (e: Error) => setError(e.message),
  });

  // ── Line helpers ─────────────────────────────────────────────────────────
  const setLine = (k: number, patch: Partial<LineRow>) =>
    setLines(prev => prev.map(l => l._key === k ? { ...l, ...patch } : l));
  const removeLine = (k: number) =>
    setLines(prev => prev.length > 1 ? prev.filter(l => l._key !== k) : prev);
  const addLine = () => setLines(prev => [...prev, newLine()]);

  // ── Status pill ──────────────────────────────────────────────────────────
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

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '20px', paddingBottom: '64px' }}>
      {/* Header bar */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap' }}>
        <button
          onClick={() => navigate('/purchasing/expenses')}
          style={{ background: 'transparent', border: 'none', cursor: 'pointer', fontSize: '13px', color: theme.inkMuted }}
        >← Expenses</button>
        <span style={{ color: theme.inkFaint }}>/</span>
        <h1 style={{ margin: 0, fontSize: '20px', fontWeight: 700, color: theme.ink, letterSpacing: '-.01em' }}>
          {isNew ? 'New expense' : (expense?.expense_number ?? '…')}
        </h1>
        {!isNew && statusPill(expense?.status)}
        <div style={{ marginInlineStart: 'auto', display: 'flex', gap: '8px' }}>
          <Button variant="ghost" size="sm" onClick={() => navigate('/purchasing/expenses')}>
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

      {/* Header card */}
      <div style={{
        background: theme.card, border: `1px solid ${theme.border}`,
        borderRadius: '12px', boxShadow: theme.shadowSm, padding: '20px',
      }}>
        <h2 style={{
          margin: '0 0 14px', fontSize: '11px', fontWeight: 700, color: theme.inkMuted,
          textTransform: 'uppercase', letterSpacing: '.06em',
        }}>Expense details</h2>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '14px' }}>
          <Input label="Date" type="date" value={date} onChange={e => setDate(e.target.value)} disabled={!isDraft} required />
          <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
            <label style={{ fontSize: '11px', fontWeight: 600, color: theme.inkMuted, textTransform: 'uppercase', letterSpacing: '.05em' }}>
              Paid From <span style={{ color: theme.danger }}>*</span>
            </label>
            <SearchableSelect
              options={bankOpts}
              value={paidFromId}
              onChange={setPaidFromId}
              disabled={!isDraft}
              placeholder="Select bank / cash"
              panelWidth={280}
            />
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
            <label style={{ fontSize: '11px', fontWeight: 600, color: theme.inkMuted, textTransform: 'uppercase', letterSpacing: '.05em' }}>
              Vendor / Supplier
            </label>
            <ContactPicker
              type="supplier"
              value={supplierId}
              onChange={(v) => setSupplierId(v ?? '')}
              disabled={!isDraft}
              placeholder="Optional"
            />
          </div>
          <Input label="Reference" value={reference} onChange={e => setReference(e.target.value)} disabled={!isDraft} placeholder="Supplier invoice #" />
        </div>
        <div style={{ marginTop: '14px' }}>
          <Input label="Description" value={description} onChange={e => setDescription(e.target.value)} disabled={!isDraft} placeholder="What was this expense for?" />
        </div>
      </div>

      {/* Lines card */}
      <div style={{
        background: theme.card, border: `1px solid ${theme.border}`,
        borderRadius: '12px', boxShadow: theme.shadowSm, overflow: 'hidden',
      }}>
        <div style={{ padding: '14px 20px', borderBottom: `1px solid ${theme.border}`, background: theme.panelHead, display: 'flex', alignItems: 'center' }}>
          <span style={{ fontSize: '11px', fontWeight: 700, color: theme.inkMuted, textTransform: 'uppercase', letterSpacing: '.06em' }}>
            Line items
          </span>
          <span style={{ marginInlineStart: 'auto', fontSize: '11px', color: theme.inkFaint }}>
            {lines.length} line{lines.length === 1 ? '' : 's'}
          </span>
        </div>

        <table className="w-full text-sm">
          <thead>
            <tr style={{ background: theme.panelHead, borderBottom: `1px solid ${theme.border}` }}>
              {[
                { l: 'Expense account', w: '260px' },
                { l: 'Description',     w: undefined },
                { l: 'Qty',             w: '70px',  a: 'end' as const },
                { l: 'Unit amount',     w: '110px', a: 'end' as const },
                { l: 'Tax %',           w: '70px',  a: 'end' as const },
                { l: 'Total',           w: '110px', a: 'end' as const },
                { l: 'Billable',        w: '160px' },
                { l: '',                w: '40px' },
              ].map((c, i) => (
                <th key={i} className="px-3 py-2.5" style={{
                  fontSize: '11px', fontWeight: 600, color: theme.inkMuted,
                  textTransform: 'uppercase', letterSpacing: '.06em',
                  textAlign: c.a ?? 'start', width: c.w, whiteSpace: 'nowrap',
                }}>{c.l}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {lines.map((line, idx) => {
              const calc = calcLine(line);
              return (
                <tr key={line._key} style={{ borderTop: idx === 0 ? 'none' : '1px solid #f1f5f9' }}>
                  <td className="px-3 py-2">
                    <SearchableSelect
                      options={expenseAccountOpts}
                      value={line.expense_account_id}
                      onChange={(v) => setLine(line._key, { expense_account_id: v })}
                      disabled={!isDraft}
                      placeholder="Pick an account…"
                      panelWidth={340}
                      addNew={isDraft ? {
                        noun: 'expense account',
                        onClick: (q) => {
                          setCoaQcLineKey(line._key);
                          setCoaQcSeed(q);
                          setCoaQcOpen(true);
                        },
                      } : undefined}
                    />
                  </td>
                  <td className="px-3 py-2">
                    <input
                      type="text"
                      value={line.description}
                      disabled={!isDraft}
                      onChange={e => setLine(line._key, { description: e.target.value })}
                      style={{ width: '100%', padding: '6px 10px', fontSize: '13px', border: `1px solid ${theme.border}`, borderRadius: '6px', outline: 'none', background: !isDraft ? theme.muted : '#fff' }}
                    />
                  </td>
                  <td className="px-3 py-2">
                    <input
                      type="number" min="0" step="0.01"
                      value={line.quantity} disabled={!isDraft}
                      onChange={e => setLine(line._key, { quantity: e.target.value })}
                      style={{ width: '100%', padding: '6px 10px', fontSize: '13px', border: `1px solid ${theme.border}`, borderRadius: '6px', outline: 'none', textAlign: 'end', background: !isDraft ? theme.muted : '#fff' }}
                    />
                  </td>
                  <td className="px-3 py-2">
                    <input
                      type="number" min="0" step="0.01"
                      value={line.unit_amount} disabled={!isDraft}
                      onChange={e => setLine(line._key, { unit_amount: e.target.value })}
                      style={{ width: '100%', padding: '6px 10px', fontSize: '13px', border: `1px solid ${theme.border}`, borderRadius: '6px', outline: 'none', textAlign: 'end', background: !isDraft ? theme.muted : '#fff' }}
                    />
                  </td>
                  <td className="px-3 py-2">
                    <input
                      type="number" min="0" max="100" step="0.01"
                      value={line.tax_rate} disabled={!isDraft}
                      onChange={e => setLine(line._key, { tax_rate: e.target.value })}
                      style={{ width: '100%', padding: '6px 10px', fontSize: '13px', border: `1px solid ${theme.border}`, borderRadius: '6px', outline: 'none', textAlign: 'end', background: !isDraft ? theme.muted : '#fff' }}
                    />
                  </td>
                  <td className="px-3 py-2 font-mono" style={{ textAlign: 'end', fontSize: '13px', color: theme.ink, fontWeight: 500 }}>
                    {fmt(calc.line_total)}
                  </td>
                  <td className="px-3 py-2">
                    <label style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '12px', cursor: isDraft ? 'pointer' : 'not-allowed' }}>
                      <input
                        type="checkbox" checked={line.is_billable} disabled={!isDraft}
                        onChange={e => setLine(line._key, { is_billable: e.target.checked, customer_id: e.target.checked ? line.customer_id : '' })}
                      />
                      <span style={{ color: theme.inkMuted }}>Billable</span>
                    </label>
                    {line.is_billable && (
                      <div style={{ marginTop: '4px' }}>
                        <SearchableSelect
                          options={customerOpts}
                          value={line.customer_id}
                          onChange={(v) => setLine(line._key, { customer_id: v })}
                          disabled={!isDraft}
                          placeholder="Customer…"
                          panelWidth={220}
                        />
                      </div>
                    )}
                  </td>
                  <td className="px-3 py-2" style={{ textAlign: 'center' }}>
                    {isDraft && lines.length > 1 && (
                      <button
                        onClick={() => removeLine(line._key)}
                        style={{ background: 'transparent', border: 'none', color: theme.inkFaint, cursor: 'pointer', fontSize: '16px' }}
                        title="Remove line"
                      >×</button>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>

        {isDraft && (
          <div style={{ padding: '8px 20px', borderTop: `1px solid ${theme.border}` }}>
            <button
              onClick={addLine}
              style={{ background: 'transparent', border: 'none', cursor: 'pointer', fontSize: '12px', fontWeight: 600, color: theme.brand, padding: '4px 8px' }}
            >+ Add line</button>
          </div>
        )}

        {/* Footer totals */}
        <div style={{
          padding: '14px 20px', borderTop: `1px solid ${theme.border}`, background: theme.panelHead,
          display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: '24px',
        }}>
          <div style={{ display: 'flex', gap: '24px', fontSize: '12px', color: theme.inkMuted }}>
            <span>Subtotal: <span className="font-mono" style={{ color: theme.ink, fontWeight: 600 }}>{fmt(totals.subtotal)}</span></span>
            <span>Tax: <span className="font-mono" style={{ color: theme.ink, fontWeight: 600 }}>{fmt(totals.tax)}</span></span>
          </div>
          <div style={{
            paddingInlineStart: '24px', borderInlineStart: `1px solid ${theme.border}`,
            fontSize: '13px', fontWeight: 700, color: theme.ink,
          }}>
            Total: <span className="font-mono">{fmt(totals.total)}</span>
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

      {/* Phase 13.02b — quick-create CoA. Defaults to 'indirect_expense'
           (most common new account from inside the expense editor) but
           the user can switch to any preset before saving. After save
           the new account is auto-selected on the triggering line. */}
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
