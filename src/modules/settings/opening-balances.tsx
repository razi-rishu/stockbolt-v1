/**
 * Opening Balances wizard — Phase 14.09.
 *
 * Where the operator migrates pre-existing customer / supplier balances
 * from a prior system (Tally, QuickBooks, spreadsheet, etc.) into
 * StockBolt without faking them as real invoices.
 *
 * Each row in the grid represents ONE migrated document:
 *
 *   - ar_owed         Customer owes us X (unpaid invoice carried over)
 *   - ap_owed         We owe supplier X (unpaid bill carried over)
 *   - customer_credit Customer overpaid us in old system (credit on file)
 *   - vendor_credit   We overpaid supplier in old system (advance with them)
 *
 * Each row is its own posting (own JE, own date) so aging reports show
 * the REAL age of the debt — a 60-day-old invoice ages from 60 days
 * ago, not from today.
 *
 * Workflow:
 *   1. Add draft rows in the grid.
 *   2. Review the totals strip (per-type subtotals + 3010 net).
 *   3. Hit "Post all" — wizard loops one row at a time, calling
 *      post_opening_balance(). Each row posted is marked ✓ done.
 *   4. Posted rows move to the "Already posted" panel below; the draft
 *      grid clears for the next batch.
 *
 * No locks — additive throughout the company lifecycle.
 *
 * Contra account: every row offsets to 3010 Opening Balance Equity.
 * After all rows are entered, the bookkeeper journal-entries 3010 into
 * 3100 Retained Earnings to close out the migration.
 */
import { useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { getAdapter } from '@/data/index';
import { useAuthStore } from '@/store/auth';
import { Button } from '@/ui/button';
import type {
  ContactRow, OpeningBalanceType, OpeningBalanceInput,
  OpeningBalanceListed,
} from '@/data/adapter';

// ── Local types ─────────────────────────────────────────────────────────────
interface DraftRow {
  _key: string;
  type:        OpeningBalanceType;
  contact_id:  string;
  doc_number:  string;
  date:        string;            // YYYY-MM-DD
  due_date:    string;            // YYYY-MM-DD or ''
  amount:      string;            // raw input
  notes:       string;
  status:      'draft' | 'posting' | 'done' | 'error';
  error?:      string;
}

let _kSeq = 0;
const newKey = () => `k${++_kSeq}`;
const todayIso = () => new Date().toISOString().slice(0, 10);

const emptyDraft = (): DraftRow => ({
  _key: newKey(), type: 'ar_owed',
  contact_id: '', doc_number: '', date: todayIso(), due_date: '',
  amount: '', notes: '', status: 'draft',
});

function fmt(n: number) {
  return n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

// ── Type metadata — labels, colors, sign convention ─────────────────────────
const TYPE_META: Record<OpeningBalanceType, {
  label:      string;
  short:      string;
  description: string;
  contactType: 'customer' | 'supplier';
  /** Sign on the customer/supplier balance: +1 owes us, -1 we owe them. */
  signOnUs:   1 | -1;
  /** Color band on the row. */
  tint:       string;
  border:     string;
  text:       string;
}> = {
  ar_owed: {
    label: 'Customer owes us', short: 'AR',
    description: 'Unpaid invoice carried from the old system.',
    contactType: 'customer', signOnUs: 1,
    tint: '#FEF3C7', border: '#FCD34D', text: '#92400E',
  },
  ap_owed: {
    label: 'We owe supplier', short: 'AP',
    description: 'Unpaid vendor bill carried from the old system.',
    contactType: 'supplier', signOnUs: -1,
    tint: '#FEE2E2', border: '#FCA5A5', text: '#991B1B',
  },
  customer_credit: {
    label: 'Customer credit on file', short: 'CUST CR',
    description: 'Customer overpaid us in the old system; sits as advance.',
    contactType: 'customer', signOnUs: -1,
    tint: '#D1FAE5', border: '#6EE7B7', text: '#065F46',
  },
  vendor_credit: {
    label: 'Our credit with supplier', short: 'SUPP CR',
    description: 'We overpaid the supplier in the old system; we hold the credit.',
    contactType: 'supplier', signOnUs: 1,
    tint: '#DBEAFE', border: '#93C5FD', text: '#1E40AF',
  },
};

// ── Page ───────────────────────────────────────────────────────────────────
export default function OpeningBalancesPage() {
  const { company_id } = useAuthStore();
  const navigate = useNavigate();
  const qc = useQueryClient();

  const { data: customers = [] } = useQuery<ContactRow[]>({
    queryKey: ['contacts', company_id, 'customer'],
    queryFn:  () => getAdapter().contacts.list(company_id!, 'customer'),
    enabled:  !!company_id,
  });
  const { data: suppliers = [] } = useQuery<ContactRow[]>({
    queryKey: ['contacts', company_id, 'supplier'],
    queryFn:  () => getAdapter().contacts.list(company_id!, 'supplier'),
    enabled:  !!company_id,
  });
  const { data: posted = [], isLoading: postedLoading } = useQuery<OpeningBalanceListed[]>({
    queryKey: ['opening_balances_posted', company_id],
    queryFn:  () => getAdapter().openingBalances.listPosted(company_id!),
    enabled:  !!company_id,
  });

  // ── Drafts ────────────────────────────────────────────────────────────────
  const [rows, setRows] = useState<DraftRow[]>([emptyDraft()]);
  const [posting, setPosting] = useState(false);
  const [topError, setTopError] = useState<string | null>(null);

  const updateRow = (key: string, patch: Partial<DraftRow>) => {
    setRows(prev => prev.map(r => r._key === key ? { ...r, ...patch } : r));
  };
  const addRow    = () => setRows(prev => [...prev, emptyDraft()]);
  const removeRow = (key: string) => setRows(prev => prev.length === 1 ? prev : prev.filter(r => r._key !== key));
  const clearDone = () => setRows(prev => prev.filter(r => r.status !== 'done'));

  // Totals — group by type so the operator can see what they're about to post.
  const totals = useMemo(() => {
    const t = { ar_owed: 0, ap_owed: 0, customer_credit: 0, vendor_credit: 0 };
    for (const r of rows) {
      if (r.status === 'done') continue;
      const amt = parseFloat(r.amount) || 0;
      t[r.type] += amt;
    }
    // Net on us = AR + Vendor Credit (assets) − AP − Customer Credit (liabilities)
    const netOnUs = t.ar_owed + t.vendor_credit - t.ap_owed - t.customer_credit;
    return { ...t, netOnUs };
  }, [rows]);

  // Per-row validation. The Post button is only enabled when all draft rows
  // pass — partial posts get messy when one row fails halfway through.
  const validateRow = (r: DraftRow): string | null => {
    if (!r.contact_id) return 'Pick a contact';
    if (!r.doc_number.trim()) return 'Document number is required';
    if (!r.date) return 'Date is required';
    const amt = parseFloat(r.amount);
    if (!isFinite(amt) || amt <= 0) return 'Amount must be a positive number';
    if (r.date > todayIso()) return 'Date cannot be in the future';
    if (r.due_date && r.due_date < r.date) return 'Due date is before the document date';
    return null;
  };
  const draftRows = rows.filter(r => r.status !== 'done');
  const validations = draftRows.map(validateRow);
  const canPost = draftRows.length > 0 && validations.every(v => v === null) && !posting;

  // ── Post-all loop ────────────────────────────────────────────────────────
  // Posts each draft row one at a time so a mid-batch failure doesn't lose
  // earlier successes. Errors are captured per-row; the user can fix and retry.
  async function postAll() {
    setTopError(null);
    setPosting(true);
    const adapter = getAdapter();
    try {
      for (const r of [...rows]) {
        if (r.status === 'done') continue;
        setRows(prev => prev.map(x => x._key === r._key ? { ...x, status: 'posting', error: undefined } : x));
        try {
          const input: OpeningBalanceInput = {
            type:       r.type,
            contact_id: r.contact_id,
            doc_number: r.doc_number.trim(),
            date:       r.date,
            due_date:   r.due_date || null,
            amount:     parseFloat(r.amount),
            notes:      r.notes.trim() || null,
          };
          await adapter.openingBalances.post(input);
          setRows(prev => prev.map(x => x._key === r._key ? { ...x, status: 'done' } : x));
        } catch (e) {
          const msg = e instanceof Error ? e.message : 'Failed';
          setRows(prev => prev.map(x => x._key === r._key ? { ...x, status: 'error', error: msg } : x));
          setTopError(`Row "${r.doc_number || '(empty)'}" failed: ${msg}. Earlier rows are saved. Fix this row and re-Post.`);
          // Stop the loop so subsequent rows are obvious.
          setPosting(false);
          await qc.invalidateQueries({ queryKey: ['opening_balances_posted', company_id] });
          return;
        }
      }
      // Refresh "Already posted" panel and aging-related caches so the UI
      // immediately reflects the new opening balances everywhere.
      await Promise.all([
        qc.invalidateQueries({ queryKey: ['opening_balances_posted', company_id] }),
        qc.invalidateQueries({ queryKey: ['invoices', company_id] }),
        qc.invalidateQueries({ queryKey: ['vendor_bills', company_id] }),
        qc.invalidateQueries({ queryKey: ['payments', company_id] }),
        qc.invalidateQueries({ queryKey: ['open_invoices'] }),
        qc.invalidateQueries({ queryKey: ['open_bills'] }),
      ]);
    } finally {
      setPosting(false);
    }
  }

  // ── Render ───────────────────────────────────────────────────────────────
  return (
    <div className="space-y-6 pb-16">
      {/* Header */}
      <div className="flex flex-wrap items-center gap-3">
        <button
          onClick={() => navigate('/settings')}
          className="text-sm text-ink-secondary hover:text-ink-primary"
        >← Settings</button>
        <span className="text-ink-tertiary">/</span>
        <h1 className="text-xl font-semibold text-ink-primary">Opening Balances</h1>
        <span className="rounded-pill bg-brand-50 px-2 py-0.5 text-xs font-semibold text-brand-700">Migration</span>
      </div>

      {/* Explainer card */}
      <div className="rounded-card border border-border-subtle bg-surface-card p-5 text-sm text-ink-secondary">
        <p>
          Use this wizard to enter <strong className="text-ink-primary">unpaid invoices, unpaid bills, or
          credits on file</strong> that already existed before you started using StockBolt.
        </p>
        <p className="mt-2">
          Each row posts as its own journal entry keyed to the <strong className="text-ink-primary">original document
          date</strong>, so AR / AP aging reports show the real age of the debt. Every entry offsets
          to <strong className="text-ink-primary">3010 Opening Balance Equity</strong> — the standard
          equity-holding account for migrations.
        </p>
        <p className="mt-2 text-xs text-ink-tertiary">
          No Revenue, COGS, VAT, or stock movement is posted. Re-run this wizard anytime to add more rows.
        </p>
      </div>

      {/* Totals strip */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        {(['ar_owed','ap_owed','customer_credit','vendor_credit'] as OpeningBalanceType[]).map(t => {
          const meta = TYPE_META[t];
          const val  = totals[t];
          return (
            <div key={t} style={{
              border: `1px solid ${meta.border}`, background: meta.tint, color: meta.text,
              borderRadius: '12px', padding: '12px 14px',
            }}>
              <div style={{ fontSize: '10.5px', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                {meta.short}
              </div>
              <div style={{ marginTop: '4px', fontSize: '17px', fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>
                AED {fmt(val)}
              </div>
              <div style={{ marginTop: '2px', fontSize: '10.5px', opacity: 0.85 }}>
                {meta.label}
              </div>
            </div>
          );
        })}
        <div style={{
          border: '1px solid #6366F1', background: '#EEF2FF', color: '#3730A3',
          borderRadius: '12px', padding: '12px 14px',
        }}>
          <div style={{ fontSize: '10.5px', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
            Net to 3010 (this batch)
          </div>
          <div style={{ marginTop: '4px', fontSize: '17px', fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>
            {totals.netOnUs >= 0 ? '+' : '−'}AED {fmt(Math.abs(totals.netOnUs))}
          </div>
          <div style={{ marginTop: '2px', fontSize: '10.5px', opacity: 0.85 }}>
            {totals.netOnUs >= 0 ? 'net debit (we expect to receive more than we owe)'
                                 : 'net credit (we owe more than we expect to receive)'}
          </div>
        </div>
      </div>

      {topError && (
        <div className="rounded-card border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-800">
          {topError}
        </div>
      )}

      {/* Draft grid */}
      <div className="rounded-card border border-border-subtle bg-surface-card overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border-subtle px-5 py-3">
          <h2 className="text-sm font-semibold text-ink-primary">Draft entries</h2>
          <div className="flex gap-2">
            <Button size="sm" variant="ghost" onClick={addRow} disabled={posting}>+ Add row</Button>
            {rows.some(r => r.status === 'done') && (
              <Button size="sm" variant="ghost" onClick={clearDone} disabled={posting}>Clear completed</Button>
            )}
            <Button size="sm" onClick={postAll} disabled={!canPost}>
              {posting ? 'Posting…' : `Post ${draftRows.length} row${draftRows.length === 1 ? '' : 's'}`}
            </Button>
          </div>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border-subtle bg-surface-muted text-xs text-ink-tertiary">
                <th className="px-3 py-2 text-start font-medium w-[170px]">Type</th>
                <th className="px-3 py-2 text-start font-medium w-[220px]">Contact</th>
                <th className="px-3 py-2 text-start font-medium w-[140px]">Doc #</th>
                <th className="px-3 py-2 text-start font-medium w-[130px]">Original date</th>
                <th className="px-3 py-2 text-start font-medium w-[130px]">Due date</th>
                <th className="px-3 py-2 text-end   font-medium w-[120px]">Amount</th>
                <th className="px-3 py-2 text-start font-medium">Notes</th>
                <th className="px-3 py-2 text-end   font-medium w-[80px]"></th>
              </tr>
            </thead>
            <tbody>
              {rows.map(r => {
                const meta = TYPE_META[r.type];
                const contacts = meta.contactType === 'customer' ? customers : suppliers;
                const err = r.status === 'draft' ? validations[draftRows.indexOf(r)] : null;
                const isDone   = r.status === 'done';
                const isPosting = r.status === 'posting';
                const isError  = r.status === 'error';
                return (
                  <tr key={r._key} className="border-b border-border-subtle last:border-0"
                      style={{ opacity: isDone ? 0.55 : 1, background: isError ? '#FEF2F2' : undefined }}>
                    <td className="px-3 py-2">
                      <select
                        className="w-full border border-slate-300 rounded px-2 py-1 text-sm"
                        value={r.type}
                        disabled={isDone || isPosting}
                        onChange={e => updateRow(r._key, {
                          type: e.target.value as OpeningBalanceType,
                          contact_id: '',   // reset contact when type changes
                        })}
                      >
                        <option value="ar_owed">Customer owes us (AR)</option>
                        <option value="ap_owed">We owe supplier (AP)</option>
                        <option value="customer_credit">Customer credit on file</option>
                        <option value="vendor_credit">Our credit with supplier</option>
                      </select>
                    </td>
                    <td className="px-3 py-2">
                      <select
                        className="w-full border border-slate-300 rounded px-2 py-1 text-sm"
                        value={r.contact_id}
                        disabled={isDone || isPosting}
                        onChange={e => updateRow(r._key, { contact_id: e.target.value })}
                      >
                        <option value="">— select {meta.contactType} —</option>
                        {contacts.map(c => (
                          <option key={c.id} value={c.id}>{c.name}</option>
                        ))}
                      </select>
                    </td>
                    <td className="px-3 py-2">
                      <input
                        type="text"
                        placeholder="INV-OLD-441"
                        className="w-full border border-slate-300 rounded px-2 py-1 text-sm font-mono"
                        value={r.doc_number}
                        disabled={isDone || isPosting}
                        onChange={e => updateRow(r._key, { doc_number: e.target.value })}
                      />
                    </td>
                    <td className="px-3 py-2">
                      <input
                        type="date"
                        className="w-full border border-slate-300 rounded px-2 py-1 text-sm"
                        value={r.date}
                        disabled={isDone || isPosting}
                        onChange={e => updateRow(r._key, { date: e.target.value })}
                      />
                    </td>
                    <td className="px-3 py-2">
                      <input
                        type="date"
                        className="w-full border border-slate-300 rounded px-2 py-1 text-sm"
                        value={r.due_date}
                        disabled={isDone || isPosting || r.type === 'customer_credit' || r.type === 'vendor_credit'}
                        onChange={e => updateRow(r._key, { due_date: e.target.value })}
                      />
                    </td>
                    <td className="px-3 py-2">
                      <input
                        type="number" step="0.01" min="0"
                        className="w-full border border-slate-300 rounded px-2 py-1 text-sm text-end font-mono"
                        value={r.amount}
                        disabled={isDone || isPosting}
                        onChange={e => updateRow(r._key, { amount: e.target.value })}
                      />
                    </td>
                    <td className="px-3 py-2">
                      <input
                        type="text"
                        placeholder="Optional"
                        className="w-full border border-slate-300 rounded px-2 py-1 text-sm"
                        value={r.notes}
                        disabled={isDone || isPosting}
                        onChange={e => updateRow(r._key, { notes: e.target.value })}
                      />
                      {err && (
                        <div className="mt-1 text-xs text-red-600">{err}</div>
                      )}
                      {isError && r.error && (
                        <div className="mt-1 text-xs text-red-700 font-medium">{r.error}</div>
                      )}
                    </td>
                    <td className="px-3 py-2 text-end">
                      {isDone ? (
                        <span className="rounded-pill bg-emerald-100 px-2 py-0.5 text-xs font-semibold text-emerald-700">
                          ✓ Posted
                        </span>
                      ) : isPosting ? (
                        <span className="text-xs text-ink-tertiary">…</span>
                      ) : (
                        <button
                          type="button"
                          onClick={() => removeRow(r._key)}
                          disabled={rows.length === 1}
                          className="text-xs text-ink-tertiary hover:text-red-600 disabled:opacity-40"
                          title={rows.length === 1 ? 'Keep at least one row' : 'Remove row'}
                        >Remove</button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Already posted panel */}
      <div className="rounded-card border border-border-subtle bg-surface-card overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border-subtle px-5 py-3">
          <h2 className="text-sm font-semibold text-ink-primary">Already posted</h2>
          <span className="text-xs text-ink-tertiary">{posted.length} document{posted.length === 1 ? '' : 's'}</span>
        </div>
        {postedLoading ? (
          <p className="px-5 py-4 text-sm text-ink-secondary">Loading…</p>
        ) : posted.length === 0 ? (
          <p className="px-5 py-4 text-sm text-ink-tertiary">
            Nothing posted yet. Add rows above and click <strong>Post</strong> to migrate them.
          </p>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border-subtle bg-surface-muted text-xs text-ink-tertiary">
                <th className="px-3 py-2 text-start font-medium">Type</th>
                <th className="px-3 py-2 text-start font-medium">Contact</th>
                <th className="px-3 py-2 text-start font-medium">Doc #</th>
                <th className="px-3 py-2 text-start font-medium">Date</th>
                <th className="px-3 py-2 text-end   font-medium">Amount</th>
                <th className="px-3 py-2 text-start font-medium">Status</th>
              </tr>
            </thead>
            <tbody>
              {posted.map(p => {
                const meta = TYPE_META[p.type];
                return (
                  <tr key={p.doc_id} className="border-b border-border-subtle last:border-0">
                    <td className="px-3 py-2">
                      <span style={{
                        display: 'inline-block', padding: '2px 8px',
                        borderRadius: '999px', fontSize: '10.5px', fontWeight: 600,
                        background: meta.tint, color: meta.text, border: `1px solid ${meta.border}`,
                      }}>{meta.short}</span>
                    </td>
                    <td className="px-3 py-2 text-ink-secondary">{p.contact_name}</td>
                    <td className="px-3 py-2 font-mono text-xs text-brand-600">{p.doc_number}</td>
                    <td className="px-3 py-2 text-ink-secondary">{p.date}</td>
                    <td className="px-3 py-2 text-end font-mono text-ink-primary">
                      {p.currency} {fmt(p.amount)}
                    </td>
                    <td className="px-3 py-2 text-xs text-ink-tertiary capitalize">{p.status}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
