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
import { buildCoaTreeOptions, coaOptionLabel } from '@/core/seeds/coa-tree';
import type {
  ContactRow, OpeningBalanceType, OpeningBalanceInput,
  OpeningBalanceListed, CoaRow, GLOpeningBalanceInput,
  BankOpeningBalanceInput, BankAccountRow,
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

// Phase 14.09b — direct GL opening balance row (fixed assets, long-term,
// capital, retained earnings, cash, etc.).
// Phase 14.09c — when target='bank', `bank_account_id` carries the chosen
// bank and the RPC resolves the CoA + updates bank_accounts.opening_balance.
interface GlDraftRow {
  _key:       string;
  /** 'coa' = normal CoA pick (postGl). 'bank' = specific bank account (postBank). */
  target:     'coa' | 'bank';
  account_id: string;      // populated for target='coa'
  bank_account_id: string; // populated for target='bank'
  direction:  'debit' | 'credit';
  amount:     string;
  date:       string;
  notes:      string;
  status:     'draft' | 'posting' | 'done' | 'error';
  error?:     string;
}

let _kSeq = 0;
const newKey = () => `k${++_kSeq}`;
const todayIso = () => new Date().toISOString().slice(0, 10);

const emptyDraft = (): DraftRow => ({
  _key: newKey(), type: 'ar_owed',
  contact_id: '', doc_number: '', date: todayIso(), due_date: '',
  amount: '', notes: '', status: 'draft',
});

const emptyGlDraft = (): GlDraftRow => ({
  _key: newKey(),
  target: 'coa', account_id: '', bank_account_id: '',
  direction: 'debit',
  amount: '', date: todayIso(), notes: '', status: 'draft',
});

// Phase 14.09b — default direction based on account type. Normal balance:
// assets + expenses = debit; liabilities + equity + income = credit.
function defaultDirection(account: CoaRow | undefined): 'debit' | 'credit' {
  if (!account) return 'debit';
  return account.type === 'asset' || account.type === 'expense' ? 'debit' : 'credit';
}

// Control accounts the operator should NOT post GL openings to (they have
// dedicated wizards / mechanisms). Soft warning, doesn't block.
const CONTROL_ACCOUNT_CODES = new Set([
  '1200',   // AR — use subsidiary grid above for per-customer detail
  '2100',   // AP — use subsidiary grid above for per-supplier detail
  '2400',   // Customer Advances — use subsidiary grid
  '1400',   // Vendor Advances — use subsidiary grid
  '1300',   // Inventory — use the inventory wizard so MAC + stock_ledger stay consistent
  '3010',   // Opening Balance Equity — this IS the contra; can't open against itself
]);

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
  // Phase 14.09b — chart of accounts + 3010 zero-check.
  const { data: coa = [] } = useQuery<CoaRow[]>({
    queryKey: ['coa', company_id],
    queryFn:  () => getAdapter().coa.list(company_id!),
    enabled:  !!company_id,
  });
  const { data: live3010 = 0 } = useQuery<number>({
    queryKey: ['ob_3010_balance', company_id],
    queryFn:  () => getAdapter().openingBalances.get3010Balance(company_id!),
    enabled:  !!company_id,
  });
  // Phase 14.09c — bank accounts for the per-bank opening picker.
  const { data: banks = [] } = useQuery<BankAccountRow[]>({
    queryKey: ['bank_accounts', company_id],
    queryFn:  () => getAdapter().bankAccounts.list(company_id!),
    enabled:  !!company_id,
  });

  const coaById = useMemo(() => {
    const m: Record<string, CoaRow> = {};
    for (const a of coa) m[a.id] = a;
    return m;
  }, [coa]);

  // ── Drafts ────────────────────────────────────────────────────────────────
  const [rows, setRows] = useState<DraftRow[]>([emptyDraft()]);
  const [glRows, setGlRows] = useState<GlDraftRow[]>([emptyGlDraft()]);
  const [posting, setPosting] = useState(false);
  const [topError, setTopError] = useState<string | null>(null);

  const updateRow = (key: string, patch: Partial<DraftRow>) => {
    setRows(prev => prev.map(r => r._key === key ? { ...r, ...patch } : r));
  };
  const addRow    = () => setRows(prev => [...prev, emptyDraft()]);
  const removeRow = (key: string) => setRows(prev => prev.length === 1 ? prev : prev.filter(r => r._key !== key));
  const clearDone = () => setRows(prev => prev.filter(r => r.status !== 'done'));

  // Phase 14.09b — GL row mutators (mirror of the subsidiary helpers).
  const updateGlRow = (key: string, patch: Partial<GlDraftRow>) => {
    setGlRows(prev => prev.map(r => r._key === key ? { ...r, ...patch } : r));
  };
  const addGlRow    = () => setGlRows(prev => [...prev, emptyGlDraft()]);
  const removeGlRow = (key: string) => setGlRows(prev => prev.length === 1 ? prev : prev.filter(r => r._key !== key));
  const clearGlDone = () => setGlRows(prev => prev.filter(r => r.status !== 'done'));

  // Phase 14.09c — void a posted opening row.
  const [voidingId, setVoidingId] = useState<string | null>(null);
  async function voidRow(p: OpeningBalanceListed) {
    if (!p.void_doc_type) {
      setTopError('Cannot void this row (no doc-type tag). Reload and retry.');
      return;
    }
    const label = p.contact_name || p.account_name || p.doc_number;
    const reason = window.prompt(
      `Void opening row "${label}" (${p.doc_number})?\n\n` +
      'This reverses the underlying journal entry and marks the source ' +
      'document as void. The 3010 balance will return to where it was ' +
      'before this row was posted.\n\n' +
      'Optional reason for the audit log:',
    );
    if (reason === null) return;  // user cancelled
    setVoidingId(p.doc_id);
    setTopError(null);
    try {
      await getAdapter().openingBalances.void(p.doc_id, p.void_doc_type, reason || undefined);
      await Promise.all([
        qc.invalidateQueries({ queryKey: ['opening_balances_posted', company_id] }),
        qc.invalidateQueries({ queryKey: ['ob_3010_balance', company_id] }),
        qc.invalidateQueries({ queryKey: ['bank_accounts', company_id] }),
        qc.invalidateQueries({ queryKey: ['invoices', company_id] }),
        qc.invalidateQueries({ queryKey: ['vendor_bills', company_id] }),
        qc.invalidateQueries({ queryKey: ['payments', company_id] }),
        qc.invalidateQueries({ queryKey: ['open_invoices'] }),
        qc.invalidateQueries({ queryKey: ['open_bills'] }),
        qc.invalidateQueries({ queryKey: ['trial_balance'] }),
        qc.invalidateQueries({ queryKey: ['balance_sheet'] }),
      ]);
    } catch (e) {
      setTopError(`Void failed: ${e instanceof Error ? e.message : 'Unknown error'}`);
    } finally {
      setVoidingId(null);
    }
  }

  // Totals — group by type so the operator can see what they're about to post.
  const totals = useMemo(() => {
    const t = { ar_owed: 0, ap_owed: 0, customer_credit: 0, vendor_credit: 0 };
    for (const r of rows) {
      if (r.status === 'done') continue;
      const amt = parseFloat(r.amount) || 0;
      t[r.type] += amt;
    }
    // Subsidiary effect on 3010 (this batch only):
    //   ar_owed         Dr AR     Cr 3010   → -ar_owed         (Cr to 3010)
    //   ap_owed         Cr AP     Dr 3010   → +ap_owed         (Dr to 3010)
    //   customer_credit Cr 2400   Dr 3010   → +customer_credit (Dr to 3010)
    //   vendor_credit   Dr 1400   Cr 3010   → -vendor_credit   (Cr to 3010)
    const subsidiaryNet3010 = -t.ar_owed + t.ap_owed + t.customer_credit - t.vendor_credit;

    // Phase 14.09b — GL openings effect on 3010:
    //   debit  side → Dr account / Cr 3010  → -amount on 3010
    //   credit side → Cr account / Dr 3010  → +amount on 3010
    let glDebit = 0;
    let glCredit = 0;
    for (const r of glRows) {
      if (r.status === 'done') continue;
      const amt = parseFloat(r.amount) || 0;
      if (r.direction === 'debit') glDebit += amt;
      else glCredit += amt;
    }
    const glNet3010 = -glDebit + glCredit;
    const batchNet3010 = subsidiaryNet3010 + glNet3010;

    // After-post projection: where 3010 lands once this batch is posted.
    const projected3010 = (live3010 ?? 0) + batchNet3010;

    return { ...t, glDebit, glCredit, subsidiaryNet3010, glNet3010, batchNet3010, projected3010 };
  }, [rows, glRows, live3010]);

  // Phase 14.13c — "empty / untouched" detector. An empty row is one the
  // operator hasn't filled in yet (default first row, accidentally-added
  // extra row). We skip these during validation AND during postAll so a
  // half-filled wizard doesn't block the rest of the batch.
  //   Subsidiary: no contact picked AND no doc# AND no amount typed
  //   GL: no account/bank picked AND no amount typed
  const isSubsidiaryRowEmpty = (r: DraftRow): boolean =>
    !r.contact_id && !r.doc_number.trim() && !r.amount.trim();
  const isGlRowEmpty = (r: GlDraftRow): boolean =>
    !r.account_id && !r.bank_account_id && !r.amount.trim();

  // Per-row validation. The Post button is enabled when every NON-EMPTY
  // draft row passes — empty rows are skipped silently. Partial posts get
  // messy when one row fails halfway through, but skipping an obviously
  // untouched row is safe.
  const validateRow = (r: DraftRow): string | null => {
    if (isSubsidiaryRowEmpty(r)) return null;            // skipped, not invalid
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

  // Phase 14.09b — GL row validation. Stricter than subsidiary: amount
  // must be positive, an account must be picked. Date must not be in
  // the future. Control-account warning is non-blocking (returns null
  // here; UI surfaces a soft warning separately).
  // Phase 14.13c — same empty-row skip applies here too.
  const validateGlRow = (r: GlDraftRow): string | null => {
    if (isGlRowEmpty(r)) return null;
    if (r.target === 'bank') {
      if (!r.bank_account_id) return 'Pick a bank account';
    } else {
      if (!r.account_id) return 'Pick a GL account';
      const acct = coaById[r.account_id];
      if (acct?.code === '3010') return 'Cannot post against 3010 (it IS the contra account)';
    }
    if (!r.date) return 'Date is required';
    const amt = parseFloat(r.amount);
    if (!isFinite(amt) || amt <= 0) return 'Amount must be positive';
    if (r.date > todayIso()) return 'Date cannot be in the future';
    return null;
  };
  const glDraftRows = glRows.filter(r => r.status !== 'done');
  const glValidations = glDraftRows.map(validateGlRow);

  // Phase 14.13c — POSTABLE = draft & non-empty & validation OK. The
  // button label and count come from this number; empty rows stay in
  // the UI for the operator to fill in or remove, but don't block post.
  const postableSubsidiary = draftRows.filter(r => !isSubsidiaryRowEmpty(r));
  const postableGl         = glDraftRows.filter(r => !isGlRowEmpty(r));
  const totalDraft = postableSubsidiary.length + postableGl.length;
  const canPost = totalDraft > 0
    && validations.every(v => v === null)
    && glValidations.every(v => v === null)
    && !posting;

  // ── Post-all loop ────────────────────────────────────────────────────────
  // Posts each draft row one at a time so a mid-batch failure doesn't lose
  // earlier successes. Errors are captured per-row; the user can fix and retry.
  async function postAll() {
    setTopError(null);
    setPosting(true);
    const adapter = getAdapter();
    try {
      // ── 1. Subsidiary rows (AR / AP / advances) ──────────────────────────
      for (const r of [...rows]) {
        if (r.status === 'done') continue;
        // Phase 14.13c — skip untouched rows silently so a half-filled
        // wizard still posts the rows that ARE filled in.
        if (isSubsidiaryRowEmpty(r)) continue;
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
          setPosting(false);
          await qc.invalidateQueries({ queryKey: ['opening_balances_posted', company_id] });
          await qc.invalidateQueries({ queryKey: ['ob_3010_balance', company_id] });
          return;
        }
      }

      // ── 2. GL rows (Phase 14.09b + 14.09c bank variant) ──────────────────
      for (const r of [...glRows]) {
        if (r.status === 'done') continue;
        // Phase 14.13c — same empty-row skip on the GL side.
        if (isGlRowEmpty(r)) continue;
        setGlRows(prev => prev.map(x => x._key === r._key ? { ...x, status: 'posting', error: undefined } : x));
        try {
          if (r.target === 'bank') {
            const input: BankOpeningBalanceInput = {
              bank_account_id: r.bank_account_id,
              direction:       r.direction,
              amount:          parseFloat(r.amount),
              date:            r.date,
              notes:           r.notes.trim() || null,
            };
            await adapter.openingBalances.postBank(input);
          } else {
            const input: GLOpeningBalanceInput = {
              account_id: r.account_id,
              direction:  r.direction,
              amount:     parseFloat(r.amount),
              date:       r.date,
              notes:      r.notes.trim() || null,
            };
            await adapter.openingBalances.postGl(input);
          }
          setGlRows(prev => prev.map(x => x._key === r._key ? { ...x, status: 'done' } : x));
        } catch (e) {
          const msg = e instanceof Error ? e.message : 'Failed';
          setGlRows(prev => prev.map(x => x._key === r._key ? { ...x, status: 'error', error: msg } : x));
          const label = r.target === 'bank'
            ? (banks.find(b => b.id === r.bank_account_id)?.name ?? '?')
            : (() => { const a = coaById[r.account_id]; return `${a?.code ?? '?'} ${a?.name ?? ''}`; })();
          setTopError(`GL row "${label}" failed: ${msg}. Earlier rows are saved. Fix and re-Post.`);
          setPosting(false);
          await qc.invalidateQueries({ queryKey: ['opening_balances_posted', company_id] });
          await qc.invalidateQueries({ queryKey: ['ob_3010_balance', company_id] });
          return;
        }
      }

      // ── 3. Refresh caches so the UI reflects new balances everywhere. ─
      await Promise.all([
        qc.invalidateQueries({ queryKey: ['opening_balances_posted', company_id] }),
        qc.invalidateQueries({ queryKey: ['ob_3010_balance', company_id] }),
        qc.invalidateQueries({ queryKey: ['invoices', company_id] }),
        qc.invalidateQueries({ queryKey: ['vendor_bills', company_id] }),
        qc.invalidateQueries({ queryKey: ['payments', company_id] }),
        qc.invalidateQueries({ queryKey: ['open_invoices'] }),
        qc.invalidateQueries({ queryKey: ['open_bills'] }),
        qc.invalidateQueries({ queryKey: ['trial_balance'] }),
        qc.invalidateQueries({ queryKey: ['balance_sheet'] }),
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
        <div className="ms-auto">
          <Button
            size="sm"
            variant="ghost"
            onClick={() => navigate('/settings/import-export?module=openingBalances')}
            title="Migrating 50+ rows? Use the bulk CSV / Excel importer instead."
          >
            ⤓ Bulk import from CSV / Excel
          </Button>
        </div>
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
            Subsidiary net (this batch)
          </div>
          <div style={{ marginTop: '4px', fontSize: '17px', fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>
            {-totals.subsidiaryNet3010 >= 0 ? '+' : '−'}AED {fmt(Math.abs(totals.subsidiaryNet3010))}
          </div>
          <div style={{ marginTop: '2px', fontSize: '10.5px', opacity: 0.85 }}>
            {-totals.subsidiaryNet3010 >= 0
              ? 'net debit — customers / supplier-credits dominate'
              : 'net credit — supplier debts / customer-credits dominate'}
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
              {posting ? 'Posting…' : `Post ${totalDraft} row${totalDraft === 1 ? '' : 's'}`}
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
                // Phase 14.13c — show a faint "skip" hint on empty rows so the
                // operator understands they won't be posted.
                const isEmpty = r.status === 'draft' && isSubsidiaryRowEmpty(r);
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
                        <div className="flex flex-col items-end gap-0.5">
                          {isEmpty && (
                            <span
                              className="text-[10.5px] text-ink-tertiary italic"
                              title="No data entered — this row will be skipped on Post"
                            >Empty · will skip</span>
                          )}
                          <button
                            type="button"
                            onClick={() => removeRow(r._key)}
                            disabled={rows.length === 1}
                            className="text-xs text-ink-tertiary hover:text-red-600 disabled:opacity-40"
                            title={rows.length === 1 ? 'Keep at least one row' : 'Remove row'}
                          >Remove</button>
                        </div>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* ── Phase 14.09b: GL opening balances grid ────────────────────────── */}
      <div className="rounded-card border border-border-subtle bg-surface-card overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border-subtle px-5 py-3">
          <div className="flex items-center gap-2">
            <h2 className="text-sm font-semibold text-ink-primary">General ledger balances</h2>
            <span className="rounded-pill bg-slate-100 px-2 py-0.5 text-[10.5px] font-semibold text-slate-600 uppercase tracking-wider">
              Fixed · Long-term · Capital
            </span>
          </div>
          <div className="flex gap-2">
            <Button size="sm" variant="ghost" onClick={addGlRow} disabled={posting}>+ Add GL row</Button>
            {glRows.some(r => r.status === 'done') && (
              <Button size="sm" variant="ghost" onClick={clearGlDone} disabled={posting}>Clear completed</Button>
            )}
          </div>
        </div>

        <div className="px-5 py-3 text-xs text-ink-tertiary border-b border-border-subtle bg-surface-muted">
          Direct postings against any chart-of-accounts row — cash on hand, bank
          balances, fixed assets, accumulated depreciation, long-term loans,
          owner&apos;s capital, retained earnings. Each row posts Dr/Cr the
          account with the opposite leg landing on 3010 Opening Balance Equity.
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border-subtle bg-surface-muted text-xs text-ink-tertiary">
                <th className="px-3 py-2 text-start font-medium w-[320px]">Account / Bank</th>
                <th className="px-3 py-2 text-start font-medium w-[130px]">Date</th>
                <th className="px-3 py-2 text-start font-medium w-[160px]">Direction</th>
                <th className="px-3 py-2 text-end   font-medium w-[140px]">Amount</th>
                <th className="px-3 py-2 text-start font-medium">Notes</th>
                <th className="px-3 py-2 text-end   font-medium w-[80px]"></th>
              </tr>
            </thead>
            <tbody>
              {glRows.map(r => {
                const acct = coaById[r.account_id];
                const err = r.status === 'draft' ? glValidations[glDraftRows.indexOf(r)] : null;
                const isControlAccount = r.target === 'coa' && acct && CONTROL_ACCOUNT_CODES.has(acct.code);
                const isDone   = r.status === 'done';
                const isPosting = r.status === 'posting';
                const isError  = r.status === 'error';
                const isEmpty  = r.status === 'draft' && isGlRowEmpty(r);
                return (
                  <tr key={r._key} className="border-b border-border-subtle last:border-0"
                      style={{ opacity: isDone ? 0.55 : 1, background: isError ? '#FEF2F2' : undefined }}>
                    <td className="px-3 py-2">
                      {/* Phase 14.09c — segmented toggle: CoA vs Bank account */}
                      <div className="mb-1 inline-flex rounded border border-slate-300 overflow-hidden text-[11px] font-semibold">
                        <button
                          type="button"
                          disabled={isDone || isPosting}
                          onClick={() => updateGlRow(r._key, {
                            target: 'coa', bank_account_id: '',
                          })}
                          style={{
                            padding: '3px 8px',
                            background: r.target === 'coa' ? '#EEF2FF' : '#FFF',
                            color:      r.target === 'coa' ? '#3730A3' : '#64748B',
                            cursor: isDone || isPosting ? 'not-allowed' : 'pointer',
                          }}
                        >CoA account</button>
                        <button
                          type="button"
                          disabled={isDone || isPosting || banks.length === 0}
                          onClick={() => updateGlRow(r._key, {
                            target: 'bank', account_id: '',
                          })}
                          title={banks.length === 0 ? 'Add a bank account in Settings → Bank Accounts first' : 'Pick a specific bank account'}
                          style={{
                            padding: '3px 8px', borderLeft: '1px solid #CBD5E1',
                            background: r.target === 'bank' ? '#ECFDF5' : '#FFF',
                            color:      r.target === 'bank' ? '#065F46' : '#64748B',
                            cursor: isDone || isPosting || banks.length === 0 ? 'not-allowed' : 'pointer',
                            opacity: banks.length === 0 ? 0.5 : 1,
                          }}
                        >Bank account</button>
                      </div>
                      {r.target === 'bank' ? (
                        <select
                          className="w-full border border-slate-300 rounded px-2 py-1 text-sm"
                          value={r.bank_account_id}
                          disabled={isDone || isPosting}
                          onChange={e => updateGlRow(r._key, {
                            bank_account_id: e.target.value,
                            direction: 'debit',           // bank openings are nearly always Dr
                          })}
                        >
                          <option value="">— select bank account —</option>
                          {banks.map(b => (
                            <option key={b.id} value={b.id}>{b.name}</option>
                          ))}
                        </select>
                      ) : (
                        <select
                          className="w-full border border-slate-300 rounded px-2 py-1 text-sm"
                          value={r.account_id}
                          disabled={isDone || isPosting}
                          onChange={e => {
                            const id = e.target.value;
                            const a = coaById[id];
                            updateGlRow(r._key, {
                              account_id: id,
                              direction: defaultDirection(a),
                            });
                          }}
                        >
                          <option value="">— select GL account —</option>
                          {/* Phase 14.13b — tree-sort within each type group so
                                sub-accounts appear indented under their parent. */}
                          {(['asset','liability','equity','income','expense'] as const).map(group => {
                            const accountsInGroup = coa.filter(a => a.type === group && a.is_active);
                            if (accountsInGroup.length === 0) return null;
                            const tree = buildCoaTreeOptions(accountsInGroup);
                            return (
                              <optgroup key={group} label={group[0].toUpperCase() + group.slice(1) + 's'}>
                                {tree.map(({ row, depth }) => (
                                  <option key={row.id} value={row.id}>
                                    {coaOptionLabel(row, depth)}
                                  </option>
                                ))}
                              </optgroup>
                            );
                          })}
                        </select>
                      )}
                      {isControlAccount && acct && (
                        <div className="mt-1 text-[11px] text-amber-700">
                          ⚠ {acct.code} is a control account.{' '}
                          {acct.code === '1200' && 'Use the AR rows above for per-customer detail.'}
                          {acct.code === '2100' && 'Use the AP rows above for per-supplier detail.'}
                          {acct.code === '2400' && 'Use Customer-credit rows above.'}
                          {acct.code === '1400' && 'Use Vendor-credit rows above.'}
                          {acct.code === '1300' && 'Use the inventory wizard so MAC + stock_ledger stay consistent.'}
                          {acct.code === '1100' && 'Pick the specific bank via the Bank-account toggle so the recon report stays in sync.'}
                        </div>
                      )}
                    </td>
                    <td className="px-3 py-2">
                      <input
                        type="date"
                        className="w-full border border-slate-300 rounded px-2 py-1 text-sm"
                        value={r.date}
                        disabled={isDone || isPosting}
                        onChange={e => updateGlRow(r._key, { date: e.target.value })}
                      />
                    </td>
                    <td className="px-3 py-2">
                      <div className="flex gap-3 text-sm">
                        <label className="flex items-center gap-1 cursor-pointer">
                          <input
                            type="radio"
                            checked={r.direction === 'debit'}
                            disabled={isDone || isPosting}
                            onChange={() => updateGlRow(r._key, { direction: 'debit' })}
                          />
                          <span style={{ color: '#0F766E', fontWeight: r.direction === 'debit' ? 600 : 400 }}>Debit</span>
                        </label>
                        <label className="flex items-center gap-1 cursor-pointer">
                          <input
                            type="radio"
                            checked={r.direction === 'credit'}
                            disabled={isDone || isPosting}
                            onChange={() => updateGlRow(r._key, { direction: 'credit' })}
                          />
                          <span style={{ color: '#B45309', fontWeight: r.direction === 'credit' ? 600 : 400 }}>Credit</span>
                        </label>
                      </div>
                    </td>
                    <td className="px-3 py-2">
                      <input
                        type="number" step="0.01" min="0"
                        className="w-full border border-slate-300 rounded px-2 py-1 text-sm text-end font-mono"
                        value={r.amount}
                        disabled={isDone || isPosting}
                        onChange={e => updateGlRow(r._key, { amount: e.target.value })}
                      />
                    </td>
                    <td className="px-3 py-2">
                      <input
                        type="text"
                        placeholder="Optional (e.g. 'Toyota Hilux purchased 2024')"
                        className="w-full border border-slate-300 rounded px-2 py-1 text-sm"
                        value={r.notes}
                        disabled={isDone || isPosting}
                        onChange={e => updateGlRow(r._key, { notes: e.target.value })}
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
                        <div className="flex flex-col items-end gap-0.5">
                          {isEmpty && (
                            <span
                              className="text-[10.5px] text-ink-tertiary italic"
                              title="No data entered — this row will be skipped on Post"
                            >Empty · will skip</span>
                          )}
                          <button
                            type="button"
                            onClick={() => removeGlRow(r._key)}
                            disabled={glRows.length === 1}
                            className="text-xs text-ink-tertiary hover:text-red-600 disabled:opacity-40"
                            title={glRows.length === 1 ? 'Keep at least one row' : 'Remove row'}
                          >Remove</button>
                        </div>
                      )}
                    </td>
                  </tr>
                );
              })}
              {/* Sum row */}
              {glDraftRows.length > 0 && (
                <tr className="bg-slate-50">
                  <td className="px-3 py-2 text-xs uppercase tracking-wider text-ink-tertiary font-semibold" colSpan={2}>
                    GL openings — this batch
                  </td>
                  <td className="px-3 py-2 text-xs text-ink-secondary">
                    Dr <span className="font-mono">{fmt(totals.glDebit)}</span>
                    <span className="mx-2 text-ink-tertiary">·</span>
                    Cr <span className="font-mono">{fmt(totals.glCredit)}</span>
                  </td>
                  <td className="px-3 py-2 text-end text-xs text-ink-secondary">
                    Net <span className="font-mono font-semibold">{fmt(Math.abs(totals.glDebit - totals.glCredit))}</span>
                    {totals.glDebit !== totals.glCredit && (
                      <span className="ml-1 text-amber-700">
                        ({totals.glDebit > totals.glCredit ? 'Dr heavy' : 'Cr heavy'})
                      </span>
                    )}
                  </td>
                  <td />
                  <td />
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* ── Phase 14.09b: 3010 zero-check indicator ───────────────────────── */}
      <div className="rounded-card border border-border-subtle bg-surface-card p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="text-[10.5px] font-semibold text-ink-tertiary uppercase tracking-wider">
              3010 Opening Balance Equity — migration check
            </div>
            <div className="mt-1 flex items-baseline gap-3">
              <span className="text-xs text-ink-secondary">Now:</span>
              <span className="font-mono text-sm font-medium text-ink-primary">
                AED {fmt(live3010)}
              </span>
              {(totals.batchNet3010 !== 0) && (
                <>
                  <span className="text-xs text-ink-secondary">After post:</span>
                  <span
                    className="font-mono text-sm font-semibold"
                    style={{ color: Math.abs(totals.projected3010) < 0.005 ? '#047857' : '#B45309' }}
                  >
                    AED {fmt(totals.projected3010)}
                  </span>
                </>
              )}
            </div>
          </div>
          <div className="flex-1 max-w-md">
            {Math.abs(live3010) < 0.005 && totals.batchNet3010 === 0 ? (
              <div className="rounded-input bg-emerald-50 border border-emerald-200 px-3 py-2 text-xs text-emerald-800">
                ✓ 3010 is at zero — your migration is fully balanced. Bookkeeper can now clear 3010 → 3100 Retained Earnings.
              </div>
            ) : Math.abs(totals.projected3010) < 0.005 && totals.batchNet3010 !== 0 ? (
              <div className="rounded-input bg-emerald-50 border border-emerald-200 px-3 py-2 text-xs text-emerald-800">
                ✓ This batch will zero out 3010 — your trial balance migration becomes complete on post.
              </div>
            ) : (
              <div className="rounded-input bg-amber-50 border border-amber-200 px-3 py-2 text-xs text-amber-800">
                3010 is non-zero. After all opening balances are entered, this should sit at zero (the source TB was already balanced). Common things missing: cash on hand, bank openings, fixed assets, retained earnings.
              </div>
            )}
          </div>
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
                <th className="px-3 py-2 text-start font-medium">Contact / Account</th>
                <th className="px-3 py-2 text-start font-medium">Doc #</th>
                <th className="px-3 py-2 text-start font-medium">Date</th>
                <th className="px-3 py-2 text-end   font-medium">Amount</th>
                <th className="px-3 py-2 text-start font-medium">Status</th>
                <th className="px-3 py-2 text-end   font-medium w-[80px]"></th>
              </tr>
            </thead>
            <tbody>
              {posted.map(p => {
                // Pill style per type. GL + bank rows have no contact; show
                // the CoA account / bank name in the "Contact" column.
                const isGl   = p.type === 'gl_debit'   || p.type === 'gl_credit';
                const isBank = p.type === 'bank_debit' || p.type === 'bank_credit';
                const pill = isGl
                  ? {
                      short: p.type === 'gl_debit' ? 'GL Dr' : 'GL Cr',
                      tint:   p.type === 'gl_debit' ? '#CCFBF1' : '#FED7AA',
                      border: p.type === 'gl_debit' ? '#5EEAD4' : '#FDBA74',
                      text:   p.type === 'gl_debit' ? '#0F766E' : '#9A3412',
                    }
                  : isBank
                  ? {
                      short: p.type === 'bank_debit' ? 'BANK Dr' : 'BANK Cr',
                      tint:   p.type === 'bank_debit' ? '#D1FAE5' : '#FEE2E2',
                      border: p.type === 'bank_debit' ? '#6EE7B7' : '#FCA5A5',
                      text:   p.type === 'bank_debit' ? '#065F46' : '#991B1B',
                    }
                  : TYPE_META[p.type as OpeningBalanceType];
                const subjectLabel = isGl
                  ? `${p.account_code ?? ''} — ${p.account_name ?? ''}`.replace(/^—\s+/, '').trim()
                  : isBank
                  ? (p.account_name || p.account_code || '—')
                  : p.contact_name;
                const canVoid = !!p.void_doc_type;
                const isVoiding = voidingId === p.doc_id;
                return (
                  <tr key={p.doc_id} className="border-b border-border-subtle last:border-0"
                      style={{ opacity: isVoiding ? 0.5 : 1 }}>
                    <td className="px-3 py-2">
                      <span style={{
                        display: 'inline-block', padding: '2px 8px',
                        borderRadius: '999px', fontSize: '10.5px', fontWeight: 600,
                        background: pill.tint, color: pill.text, border: `1px solid ${pill.border}`,
                      }}>{pill.short}</span>
                    </td>
                    <td className="px-3 py-2 text-ink-secondary">{subjectLabel || '—'}</td>
                    <td className="px-3 py-2 font-mono text-xs text-brand-600">{p.doc_number}</td>
                    <td className="px-3 py-2 text-ink-secondary">{p.date}</td>
                    <td className="px-3 py-2 text-end font-mono text-ink-primary">
                      {p.currency} {fmt(p.amount)}
                    </td>
                    <td className="px-3 py-2 text-xs text-ink-tertiary capitalize">{p.status}</td>
                    <td className="px-3 py-2 text-end">
                      {canVoid && (
                        <button
                          type="button"
                          onClick={() => voidRow(p)}
                          disabled={isVoiding}
                          className="text-xs text-red-600 hover:text-red-800 font-medium disabled:opacity-40"
                          title="Reverse this opening row + mark the underlying doc void"
                        >{isVoiding ? '…' : 'Void'}</button>
                      )}
                    </td>
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
