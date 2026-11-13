import { useState, useMemo } from 'react';
import { formatDate } from '@/lib/locale';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { getAdapter } from '@/data/index';
import { useAuthStore } from '@/store/auth';
import { useInvalidateBooks } from '@/hooks/use-invalidate-books';
import { Input } from '@/ui/input';
import { Button } from '@/ui/button';
import { SearchableSelect } from '@/ui/searchable-select';
import { StatusBadge } from '@/ui/status-badge';
import { useTranslation } from 'react-i18next';
import { OceanPage } from '@/components/ocean-list';
import { History, Lock, Plus, Scale, Trash2 } from 'lucide-react';
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
 *
 * Ocean Teal layout (2026-11): look only, fully translated (brOcean.*).
 */
export default function BankReconciliationPage() {
  const { t } = useTranslation();
  const { company_id } = useAuthStore();
  const qc = useQueryClient();
  const invalidateBooks = useInvalidateBooks();   // Phase 14.14k

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
      if (!bankAccountId) throw new Error(t('brOcean.err_pick'));
      if (!statementDate) throw new Error(t('brOcean.err_date'));
      if (!statementBal || isNaN(stmtBalNum)) throw new Error(t('brOcean.err_balance'));
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
    onSuccess: async (recon) => {
      setError(null);
      setEditingReconId(recon.id);
      await invalidateBooks();
      qc.invalidateQueries({ queryKey: ['bank_recons', company_id, bankAccountId] });
      qc.invalidateQueries({ queryKey: ['bank_recon_gl_lines', company_id, bankAccountId, statementDate] });
      // Invalidate the Reconciled-badge cache used by payment lists/editors
      qc.invalidateQueries({ queryKey: ['reconciled_payment_ids', company_id] });
    },
    onError: (e: Error) => setError(e.message),
  });

  const deleteMutation = useMutation({
    mutationFn: () => getAdapter().bankReconciliations.delete(editingReconId!),
    onSuccess: async () => {
      setEditingReconId(null);
      setChecked({});
      setStatementBal('');
      setNotes('');
      await invalidateBooks();
      qc.invalidateQueries({ queryKey: ['bank_recons', company_id, bankAccountId] });
      qc.invalidateQueries({ queryKey: ['bank_recon_gl_lines', company_id, bankAccountId, statementDate] });
      qc.invalidateQueries({ queryKey: ['reconciled_payment_ids', company_id] });
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
  const balanced = Math.abs(checkedSummary.diff) < 0.005;

  return (
    <OceanPage
      testid="bank-reconciliation-ocean"
      title={t('brOcean.title')}
      subtitle={t('brOcean.subtitle')}
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        {error && <p className="sb-alert sb-alert-danger" role="alert">{error}</p>}

        {/* Bank picker + statement header */}
        <div className="sb-card sb-form sb-doc-card">
          <div className="sb-recon-head">
            <div className="sb-ss-field">
              <label className="sb-flabel">{t('brOcean.bank_account')}</label>
              <SearchableSelect
                options={accountOpts}
                value={bankAccountId}
                onChange={v => { setBankAccountId(v); startNew(); }}
                placeholder={t('brOcean.select_account')}
                panelWidth={280}
              />
            </div>
            <Input label={t('brOcean.stmt_date')} type="date" value={statementDate}
              onChange={e => setStatementDate(e.target.value)} disabled={isLocked} />
            <Input label={t('brOcean.stmt_balance')} type="number" step="0.01" dir="ltr"
              value={statementBal} onChange={e => setStatementBal(e.target.value)} disabled={isLocked} />
            <Input label={t('brOcean.notes_opt')} value={notes}
              onChange={e => setNotes(e.target.value)} disabled={isLocked} />
          </div>
        </div>

        {!bankAccountId && (
          <div className="sb-card sb-doc-card sb-acct-empty">
            <span className="sb-side-ico" style={{ background: 'var(--sb-primary-light)', color: 'var(--sb-primary-dark)' }} aria-hidden="true"><Scale size={18} /></span>
            <p className="sb-fx-name" style={{ margin: 0 }}>{t('brOcean.pick_prompt')}</p>
          </div>
        )}

        {/* Live summary + actions */}
        {bankAccountId && (
          <div className="sb-card sb-doc-card sb-doc-lines">
            <div className="sb-recon-sum">
              <div><span className="sb-info-label">{t('brOcean.sum_checked')}</span><span className="sb-dash-num">{checkedSummary.count}</span></div>
              <div><span className="sb-info-label">{t('brOcean.sum_book')}</span><bdi dir="ltr" className="sb-dash-num">{fmt(checkedSummary.bookBal)}</bdi></div>
              <div><span className="sb-info-label">{t('brOcean.sum_stmt')}</span><bdi dir="ltr" className="sb-dash-num">{fmt(stmtBalNum)}</bdi></div>
              <div className={balanced ? 'is-good' : 'is-warn'}>
                <span className="sb-info-label">{t('brOcean.sum_diff')}</span>
                <bdi dir="ltr" className="sb-dash-num">{fmt(checkedSummary.diff)}</bdi>
                <span className={`sb-pill ${balanced ? 'sb-pill-good' : 'sb-pill-warn'}`} style={{ alignSelf: 'flex-start', fontSize: 11, padding: '1px 8px' }}>
                  {balanced ? t('brOcean.balanced') : t('brOcean.not_balanced')}
                </span>
              </div>
            </div>
            <div className="sb-recon-actions">
              {isLocked ? (
                <span className="sb-pill sb-pill-muted" style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                  <Lock size={13} aria-hidden="true" /> {t('brOcean.locked_note')}
                </span>
              ) : (
                <>
                  <Button size="sm" disabled={saveMutation.isPending}
                    onClick={() => { setError(null); saveMutation.mutate(false); }}>
                    {saveMutation.isPending ? t('brOcean.saving') : (editingReconId ? t('brOcean.save_changes') : t('brOcean.save_open'))}
                  </Button>
                  <Button size="sm" variant="primary" disabled={saveMutation.isPending}
                    onClick={() => {
                      if (Math.abs(checkedSummary.diff) > 0.005) {
                        if (!window.confirm(t('brOcean.confirm_lock', { amount: fmt(checkedSummary.diff) }))) return;
                      }
                      setError(null); saveMutation.mutate(true);
                    }}>
                    <Lock size={15} aria-hidden="true" /> {t('brOcean.save_lock')}
                  </Button>
                  {editingReconId && (
                    <Button size="sm" variant="ghost" style={{ color: 'var(--sb-danger)' }}
                      disabled={deleteMutation.isPending}
                      onClick={() => { if (window.confirm(t('brOcean.confirm_delete'))) deleteMutation.mutate(); }}>
                      <Trash2 size={15} aria-hidden="true" /> {t('brOcean.delete')}
                    </Button>
                  )}
                </>
              )}
            </div>
          </div>
        )}

        {/* GL lines table */}
        {bankAccountId && (
          <div className="sb-card sb-doc-card sb-doc-lines">
            <div className="sb-doc-lines-head">
              <div style={{ minWidth: 0 }}>
                <h2 className="sb-doc-card-title" style={{ margin: 0 }}>{t('brOcean.lines_title')} <bdi dir="ltr" style={{ whiteSpace: 'nowrap' }}>{statementDate}</bdi></h2>
                <p className="sb-fx-name" style={{ margin: 0, fontSize: 12 }}>{t('brOcean.lines_hint')}</p>
              </div>
            </div>
            {linesLoading ? (
              <p className="sb-empty" style={{ margin: 0, textAlign: 'center' }}>{t('common.loading')}</p>
            ) : glLines.length === 0 ? (
              <p className="sb-empty" style={{ margin: 0, textAlign: 'center' }}>{t('brOcean.no_lines')}</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm" style={{ minWidth: 760 }}>
                  <thead>
                    <tr>
                      <th className="px-4 py-2 w-10"><span className="sr-only">{t('brOcean.tick')}</span></th>
                      <th className="px-4 py-2 text-start font-medium">{t('brOcean.col_date')}</th>
                      <th className="px-4 py-2 text-start font-medium">{t('brOcean.col_je')}</th>
                      <th className="px-4 py-2 text-start font-medium">{t('brOcean.col_source')}</th>
                      <th className="px-4 py-2 text-start font-medium">{t('brOcean.col_desc')}</th>
                      <th className="px-4 py-2 text-end font-medium">{t('brOcean.col_debit')}</th>
                      <th className="px-4 py-2 text-end font-medium">{t('brOcean.col_credit')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {glLines.map(line => (
                      <tr key={line.id} className={`sb-recon-line ${checked[line.id] ? 'is-checked' : ''}`}>
                        <td className="px-4 py-2">
                          <input type="checkbox" disabled={isLocked} aria-label={t('brOcean.tick')}
                            style={{ accentColor: 'var(--sb-primary)', width: 16, height: 16 }}
                            checked={!!checked[line.id]}
                            onChange={e => setChecked(prev => ({ ...prev, [line.id]: e.target.checked }))} />
                        </td>
                        <td className="px-4 py-2 text-ink-secondary"><bdi dir="ltr">{formatDate(line.date)}</bdi></td>
                        <td className="px-4 py-2"><bdi dir="ltr" className="sb-acct-code">{line.je_number}</bdi></td>
                        <td className="px-4 py-2">
                          <span className="sb-pill sb-pill-muted" style={{ fontSize: 11.5, padding: '1px 9px', margin: 0 }}>
                            {t(`jeOcean.src_${line.source_type}`, { defaultValue: line.source_type.replace(/_/g, ' ') })}
                          </span>
                        </td>
                        <td className="px-4 py-2 text-ink-secondary max-w-xs truncate">{line.description}</td>
                        <td className="px-4 py-2 text-end">
                          <bdi dir="ltr" style={{ color: line.debit > 0 ? 'var(--sb-success)' : 'var(--sb-text-secondary)', fontWeight: 600 }}>{line.debit > 0 ? fmt(line.debit) : '—'}</bdi>
                        </td>
                        <td className="px-4 py-2 text-end">
                          <bdi dir="ltr" style={{ color: line.credit > 0 ? 'var(--sb-danger)' : 'var(--sb-text-secondary)', fontWeight: 600 }}>{line.credit > 0 ? fmt(line.credit) : '—'}</bdi>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}

        {/* Past reconciliations */}
        {bankAccountId && pastRecons.length > 0 && (
          <div className="sb-card sb-doc-card sb-doc-lines">
            <div className="sb-doc-lines-head">
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
                <span className="sb-side-ico" style={{ background: 'var(--sb-primary-light)', color: 'var(--sb-primary-dark)' }} aria-hidden="true"><History size={17} /></span>
                <h2 className="sb-doc-card-title" style={{ margin: 0 }}>{t('brOcean.past_title')}</h2>
              </div>
              <Button variant="ghost" size="sm" onClick={startNew}><Plus size={15} aria-hidden="true" /> {t('brOcean.new_recon')}</Button>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm" style={{ minWidth: 700 }}>
                <thead>
                  <tr>
                    <th className="px-4 py-2 text-start font-medium">{t('brOcean.col_stmt_date')}</th>
                    <th className="px-4 py-2 text-end font-medium">{t('brOcean.col_closing')}</th>
                    <th className="px-4 py-2 text-end font-medium">{t('brOcean.col_book')}</th>
                    <th className="px-4 py-2 text-end font-medium">{t('brOcean.col_outstanding')}</th>
                    <th className="px-4 py-2 text-end font-medium">{t('brOcean.col_lines')}</th>
                    <th className="px-4 py-2 text-start font-medium">{t('common.status')}</th>
                    <th className="px-4 py-2"></th>
                  </tr>
                </thead>
                <tbody>
                  {pastRecons.map(r => (
                    <tr key={r.id} className={`sb-acct-row ${editingReconId === r.id ? 'is-selected' : ''}`} onClick={() => loadRecon(r)}>
                      <td className="px-4 py-2"><bdi dir="ltr">{r.statement_end_date}</bdi></td>
                      <td className="px-4 py-2 text-end"><bdi dir="ltr">{fmt(Number(r.statement_closing_balance))}</bdi></td>
                      <td className="px-4 py-2 text-end"><bdi dir="ltr">{fmt(Number(r.reconciled_book_balance))}</bdi></td>
                      <td className="px-4 py-2 text-end">
                        <bdi dir="ltr" style={{ fontWeight: 700, color: Math.abs(Number(r.outstanding_amount)) > 0.005 ? 'var(--sb-warning)' : 'var(--sb-success)' }}>
                          {fmt(Number(r.outstanding_amount))}
                        </bdi>
                      </td>
                      <td className="px-4 py-2 text-end">{r.line_count}</td>
                      <td className="px-4 py-2"><StatusBadge status={r.status} /></td>
                      <td className="px-4 py-2 text-end">
                        <Button variant="ghost" size="sm" onClick={(e) => { e.stopPropagation(); loadRecon(r); }}>
                          {r.status === 'locked' ? t('common.view') : t('common.edit')}
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    </OceanPage>
  );
}
