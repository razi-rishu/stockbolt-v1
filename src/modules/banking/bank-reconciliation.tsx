import { useState, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { getAdapter } from '@/data/index';
import { useAuthStore } from '@/store/auth';
import { Input } from '@/ui/input';
import { Button } from '@/ui/button';
import { SearchableSelect } from '@/ui/searchable-select';
import type { BankAccountRow, BankReconciliationRow, ReconGlLine } from '@/data/adapter';

const fmt = (n: number) => n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const today = () => new Date().toISOString().slice(0, 10);

/**
 * Bank Reconciliation screen.
 *
 * Flow:
 *   1. Pick a bank account
 *   2. (Optional) load an existing OPEN reconciliation for editing, or
 *      enter a new statement end date + closing balance
 *   3. UI lists every general_ledger line on that bank's COA, dated <=
 *      statement end, that is either unreconciled OR already part of
 *      THIS recon. Each row has a checkbox.
 *   4. Bookkeeper ticks the lines that appear on the bank statement.
 *      Live "Book balance of checked items" vs "Statement closing balance"
 *      tells them the outstanding diff.
 *   5. Save → atomic RPC writes the header and stamps reconciliation_id
 *      on the picked GL lines. Optional Lock flag freezes the recon
 *      (cannot be edited or deleted afterwards).
 *
 * Accounting integrity:
 *   - Reconciliation is metadata only — never modifies amounts or
 *     creates/reverses journal entries.
 *   - RPC server-side enforces: bank account match, GL line eligibility,
 *     locked-recon immutability.
 */
export default function BankReconciliationPage() {
  const { company_id } = useAuthStore();
  const qc = useQueryClient();

  const [bankAccountId,   setBankAccountId]     = useState('');
  const [statementDate,   setStatementDate]     = useState(today());
  const [statementBal,    setStatementBal]      = useState('');
  const [notes,           setNotes]             = useState('');
  const [checked,         setChecked]           = useState<Record<string, boolean>>({});
  const [editingReconId,  setEditingReconId]    = useState<string | null>(null);
  const [error,           setError]             = useState<string | null>(null);

  const { data: bankAccounts = [] } = useQuery<BankAccountRow[]>({
    queryKey: ['bank_accounts', company_id],
    queryFn:  () => getAdapter().bankAccounts.list(company_id!),
    enabled:  !!company_id,
  });

  // Past recons for this bank — lets the user resume an open one or
  // see history.
  const { data: pastRecons = [] } = useQuery<BankReconciliationRow[]>({
    queryKey: ['bank_recons', company_id, bankAccountId],
    queryFn:  () => getAdapter().bankReconciliations.list(company_id!, bankAccountId),
    enabled:  !!company_id && !!bankAccountId,
  });

  const { data: glLines = [], isFetching: linesLoading } = useQuery<ReconGlLine[]>({
    queryKey: ['bank_recon_gl_lines', company_id, bankAccountId, statementDate, editingReconId],
    queryFn:  () => getAdapter().bankReconciliations.listGlLines(
      company_id!, bankAccountId, statementDate,
      editingReconId ? { reconciliation_id: editingReconId } : undefined,
    ),
    enabled:  !!company_id && !!bankAccountId && !!statementDate,
  });

  // When loading an existing recon, pre-tick its lines.
  // Use a derived initialization keyed off (editingReconId, glLines).
  const initKey = `${editingReconId ?? ''}|${glLines.length}`;
  const [lastInitKey, setLastInitKey] = useState('');
  if (initKey !== lastInitKey && editingReconId && glLines.length > 0) {
    const seed: Record<string, boolean> = {};
    for (const l of glLines) if (l.reconciliation_id === editingReconId) seed[l.id] = true;
    setChecked(seed);
    setLastInitKey(initKey);
  }

  const stmtBalNum = parseFloat(statementBal) || 0;
  const checkedSummary = useMemo(() => {
    let debit = 0, credit = 0, count = 0;
    for (const l of glLines) {
      if (checked[l.id]) {
        debit  += Number(l.debit);
        credit += Number(l.credit);
        count  += 1;
      }
    }
    const bookBal = debit - credit;
    return { debit, credit, bookBal, diff: +(stmtBalNum - bookBal).toFixed(2), count };
  }, [glLines, checked, stmtBalNum]);

  const saveMutation = useMutation({
    mutationFn: async (lock: boolean) => {
      if (!bankAccountId) throw new Error('Pick a bank account');
      if (!statementDate) throw new Error('Statement end date required');
      if (!statementBal || isNaN(stmtBalNum)) throw new Error('Statement closing balance required');
      const gl_line_ids = Object.entries(checked).filter(([, v]) => v).map(([k]) => k);
      return getAdapter().bankReconciliations.save({
        company_id:                company_id!,
        bank_account_id:           bankAccountId,
        statement_end_date:        statementDate,
        statement_closing_balance: stmtBalNum,
        gl_line_ids,
        notes:                     notes || null,
        lock,
      });
    },
    onSuccess: (recon) => {
      setError(null);
      setEditingReconId(recon.id);
      qc.invalidateQueries({ queryKey: ['bank_recons', company_id, bankAccountId] });
      qc.invalidateQueries({ queryKey: ['bank_recon_gl_lines', company_id, bankAccountId, statementDate] });
    },
    onError: (e: Error) => setError(e.message),
  });

  const deleteMutation = useMutation({
    mutationFn: () => getAdapter().bankReconciliations.delete(editingReconId!),
    onSuccess: () => {
      setEditingReconId(null);
      setChecked({});
      setStatementBal('');
      setNotes('');
      qc.invalidateQueries({ queryKey: ['bank_recons', company_id, bankAccountId] });
      qc.invalidateQueries({ queryKey: ['bank_recon_gl_lines', company_id, bankAccountId, statementDate] });
    },
    onError: (e: Error) => setError(e.message),
  });

  function loadRecon(r: BankReconciliationRow) {
    setEditingReconId(r.id);
    setStatementDate(r.statement_end_date);
    setStatementBal(String(r.statement_closing_balance));
    setNotes(r.notes ?? '');
    setLastInitKey(''); // forces re-seed
  }

  function startNew() {
    setEditingReconId(null);
    setChecked({});
    setStatementDate(today());
    setStatementBal('');
    setNotes('');
    setLastInitKey('');
  }

  const accountOpts = bankAccounts.map(a => ({ value: a.id, label: a.name }));
  const isLocked = editingReconId
    ? pastRecons.find(r => r.id === editingReconId)?.status === 'locked'
    : false;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-800">Bank Reconciliation</h1>
        <p className="text-sm text-slate-500 mt-1">
          Match general ledger entries against your bank statement. Locked reconciliations cannot be edited.
        </p>
      </div>

      {error && <div className="rounded bg-red-50 px-4 py-2 text-sm text-red-700">{error}</div>}

      {/* Bank picker + header */}
      <div className="bg-white border border-slate-200 rounded-lg p-5 space-y-4">
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">Bank Account</label>
            <SearchableSelect
              options={accountOpts}
              value={bankAccountId}
              onChange={v => { setBankAccountId(v); startNew(); }}
              placeholder="Select account"
              panelWidth={280}
            />
          </div>
          <Input label="Statement End Date" type="date" value={statementDate}
            onChange={e => setStatementDate(e.target.value)} disabled={isLocked} />
          <Input label="Statement Closing Balance" type="number" step="0.01"
            value={statementBal} onChange={e => setStatementBal(e.target.value)} disabled={isLocked} />
          <Input label="Notes (optional)" value={notes}
            onChange={e => setNotes(e.target.value)} disabled={isLocked} />
        </div>
      </div>

      {/* Past reconciliations */}
      {bankAccountId && pastRecons.length > 0 && (
        <div className="bg-white border border-slate-200 rounded-lg overflow-hidden">
          <div className="border-b border-slate-200 px-4 py-3 flex items-center justify-between">
            <h2 className="text-sm font-semibold text-slate-700">Past reconciliations for this account</h2>
            <Button variant="ghost" size="sm" onClick={startNew}>+ New reconciliation</Button>
          </div>
          <table className="w-full text-sm">
            <thead className="bg-slate-50">
              <tr>
                <th className="px-4 py-2 text-left text-xs font-medium text-slate-600">Statement Date</th>
                <th className="px-4 py-2 text-right text-xs font-medium text-slate-600">Closing Balance</th>
                <th className="px-4 py-2 text-right text-xs font-medium text-slate-600">Book Balance</th>
                <th className="px-4 py-2 text-right text-xs font-medium text-slate-600">Outstanding</th>
                <th className="px-4 py-2 text-right text-xs font-medium text-slate-600">Lines</th>
                <th className="px-4 py-2 text-center text-xs font-medium text-slate-600">Status</th>
                <th className="px-4 py-2"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {pastRecons.map(r => (
                <tr key={r.id} className={editingReconId === r.id ? 'bg-amber-50' : ''}>
                  <td className="px-4 py-2 text-slate-700">{r.statement_end_date}</td>
                  <td className="px-4 py-2 text-right font-mono">{fmt(Number(r.statement_closing_balance))}</td>
                  <td className="px-4 py-2 text-right font-mono">{fmt(Number(r.reconciled_book_balance))}</td>
                  <td className={`px-4 py-2 text-right font-mono ${Math.abs(Number(r.outstanding_amount)) > 0.005 ? 'text-amber-700' : 'text-green-700'}`}>
                    {fmt(Number(r.outstanding_amount))}
                  </td>
                  <td className="px-4 py-2 text-right">{r.line_count}</td>
                  <td className="px-4 py-2 text-center">
                    <span className={`rounded-pill px-2 py-0.5 text-xs font-medium ${
                      r.status === 'locked' ? 'bg-slate-100 text-slate-700' : 'bg-amber-50 text-amber-700'
                    }`}>{r.status}</span>
                  </td>
                  <td className="px-4 py-2 text-right">
                    <Button variant="ghost" size="sm" onClick={() => loadRecon(r)}>
                      {r.status === 'locked' ? 'View' : 'Edit'}
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* GL lines table */}
      {bankAccountId && (
        <div className="bg-white border border-slate-200 rounded-lg overflow-hidden">
          <div className="border-b border-slate-200 px-4 py-3">
            <h2 className="text-sm font-semibold text-slate-700">
              Bank ledger lines through {statementDate}
            </h2>
            <p className="text-xs text-slate-500 mt-0.5">
              Tick each line that appears on the bank statement. Lines already reconciled in another
              period are not shown.
            </p>
          </div>
          {linesLoading ? (
            <p className="p-8 text-center text-sm text-slate-400">Loading…</p>
          ) : glLines.length === 0 ? (
            <p className="p-8 text-center text-sm text-slate-500">No unreconciled lines for this period.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-slate-50">
                  <tr>
                    <th className="px-4 py-2 w-10"></th>
                    <th className="px-4 py-2 text-left text-xs font-medium text-slate-600">Date</th>
                    <th className="px-4 py-2 text-left text-xs font-medium text-slate-600">JE #</th>
                    <th className="px-4 py-2 text-left text-xs font-medium text-slate-600">Source</th>
                    <th className="px-4 py-2 text-left text-xs font-medium text-slate-600">Description</th>
                    <th className="px-4 py-2 text-right text-xs font-medium text-slate-600">Debit</th>
                    <th className="px-4 py-2 text-right text-xs font-medium text-slate-600">Credit</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {glLines.map(line => (
                    <tr key={line.id} className={checked[line.id] ? 'bg-sky-50' : 'hover:bg-slate-50'}>
                      <td className="px-4 py-2">
                        <input type="checkbox" disabled={isLocked}
                          checked={!!checked[line.id]}
                          onChange={e => setChecked(prev => ({ ...prev, [line.id]: e.target.checked }))} />
                      </td>
                      <td className="px-4 py-2 text-slate-700">{line.date}</td>
                      <td className="px-4 py-2 font-mono text-blue-600">{line.je_number}</td>
                      <td className="px-4 py-2">
                        <span className="inline-flex items-center px-2 py-0.5 rounded text-xs bg-slate-100 text-slate-600">
                          {line.source_type.replace(/_/g, ' ')}
                        </span>
                      </td>
                      <td className="px-4 py-2 text-slate-700 max-w-xs truncate">{line.description}</td>
                      <td className="px-4 py-2 text-right text-green-700 font-mono">
                        {line.debit > 0 ? fmt(line.debit) : '—'}
                      </td>
                      <td className="px-4 py-2 text-right text-red-700 font-mono">
                        {line.credit > 0 ? fmt(line.credit) : '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* Footer summary + actions */}
      {bankAccountId && (
        <div className="bg-white border border-slate-200 rounded-lg p-5">
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4 text-sm">
            <div>
              <p className="text-xs text-slate-500">Checked lines</p>
              <p className="text-lg font-semibold">{checkedSummary.count}</p>
            </div>
            <div>
              <p className="text-xs text-slate-500">Book balance (checked)</p>
              <p className="text-lg font-mono font-semibold">{fmt(checkedSummary.bookBal)}</p>
            </div>
            <div>
              <p className="text-xs text-slate-500">Statement closing</p>
              <p className="text-lg font-mono font-semibold">{fmt(stmtBalNum)}</p>
            </div>
            <div>
              <p className="text-xs text-slate-500">Difference (outstanding)</p>
              <p className={`text-lg font-mono font-semibold ${
                Math.abs(checkedSummary.diff) < 0.005 ? 'text-green-700' : 'text-amber-700'
              }`}>{fmt(checkedSummary.diff)}</p>
            </div>
          </div>

          <div className="mt-5 flex gap-2">
            <Button disabled={isLocked || saveMutation.isPending}
              onClick={() => { setError(null); saveMutation.mutate(false); }}>
              {saveMutation.isPending ? 'Saving…' : (editingReconId ? 'Save changes' : 'Save (open)')}
            </Button>
            <Button variant="primary" disabled={isLocked || saveMutation.isPending}
              onClick={() => {
                if (Math.abs(checkedSummary.diff) > 0.005) {
                  if (!window.confirm(`Outstanding difference is ${fmt(checkedSummary.diff)}. Lock anyway?`)) return;
                }
                setError(null); saveMutation.mutate(true);
              }}>
              Save & lock
            </Button>
            {editingReconId && !isLocked && (
              <Button variant="ghost" className="text-red-600 border-red-300"
                disabled={deleteMutation.isPending}
                onClick={() => { if (window.confirm('Delete this reconciliation? GL lines will be un-reconciled.')) deleteMutation.mutate(); }}>
                Delete reconciliation
              </Button>
            )}
            {isLocked && (
              <span className="text-xs text-slate-500 self-center ms-2">
                Reconciliation is locked — read only.
              </span>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
