import { useState, useCallback, useEffect, useRef } from 'react';
import { formatDate } from '@/lib/locale';
import { useNavigate, useParams, useLocation } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { getAdapter } from '@/data/index';
import { useAuthStore } from '@/store/auth';
import { useInvalidateBooks } from '@/hooks/use-invalidate-books';
import { postJournalEntry, reverseJournalEntry, JournalValidationError } from '@/core/gl/posting-engine';
import { useUnsavedChangesGuard } from '@/hooks/use-unsaved-changes-guard';
import { Button } from '@/ui/button';
import { BackButton } from '@/ui/back-button';
import { Input } from '@/ui/input';
import { SearchableSelect } from '@/ui/searchable-select';
import { buildCoaTreeOptions, coaOptionLabel } from '@/core/seeds/coa-tree';
import type { JELine, JournalEntryRow, GeneralLedgerRow, CoaRow } from '@/data/adapter';

interface LineRow extends JELine {
  _key: number;
}

let _keySeq = 0;
function newLine(): LineRow {
  return { _key: ++_keySeq, account_code: '', debit: 0, credit: 0, description: '' };
}

function fmt(n: number) {
  return n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

type RepeatFreq = 'days' | 'weekly' | 'monthly' | 'yearly';

/**
 * Step a base date forward by `i` intervals. Used to generate the schedule
 * of dates for a recurring journal entry. Monthly keeps the same day-of-month
 * (clamped to the last day for short months, so Jan-31 → Feb-28).
 */
function addInterval(baseISO: string, freq: RepeatFreq, everyN: number, i: number): string {
  const d = new Date(baseISO + 'T00:00:00');
  if (freq === 'days')        d.setDate(d.getDate() + everyN * i);
  else if (freq === 'weekly') d.setDate(d.getDate() + 7 * i);
  else if (freq === 'yearly') d.setFullYear(d.getFullYear() + i);
  else { // monthly
    const targetDay = d.getDate();
    d.setDate(1);
    d.setMonth(d.getMonth() + i);
    const lastDay = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
    d.setDate(Math.min(targetDay, lastDay));
  }
  return d.toISOString().slice(0, 10);
}

export default function JournalEntryEditorPage() {
  const { t } = useTranslation();
  const { id } = useParams<{ id: string }>();
  const isNew = !id || id === 'new';
  const navigate = useNavigate();
  const location = useLocation();
  const { company_id } = useAuthStore();
  const qc = useQueryClient();
  const invalidateBooks = useInvalidateBooks();   // Phase 14.14k

  const [description, setDescription] = useState('');
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [lines, setLines] = useState<LineRow[]>([newLine(), newLine()]);
  const [error, setError] = useState('');
  const [dirty, setDirty] = useState(false);
  const confirmLeave = useUnsavedChangesGuard(dirty);

  // Recurring controls — when `repeat` is on, a single Post creates `count`
  // journal entries, one per stepped date starting from the date above.
  const [repeat, setRepeat] = useState(false);
  const [freq, setFreq] = useState<RepeatFreq>('monthly');
  const [everyN, setEveryN] = useState(1);   // only used for the "days" frequency
  const [count, setCount] = useState(12);

  // Clone seed — a Duplicate action navigates here with the source entry's
  // lines in router state. Seed the form once per navigation (date resets to
  // today). Works whether we arrive fresh at /new or duplicate in-place from
  // a view page (same component instance, so we key off location.key).
  const seededKey = useRef<string | null>(null);
  useEffect(() => {
    const seed = (location.state as { cloneFrom?: { description?: string; lines: { account_code: string; debit: number; credit: number; description?: string }[] } } | null)?.cloneFrom;
    if (!seed || seededKey.current === location.key) return;
    seededKey.current = location.key;
    setDescription(seed.description ?? '');
    setLines(
      seed.lines.length
        ? seed.lines.map((l) => ({ _key: ++_keySeq, account_code: l.account_code, debit: Number(l.debit) || 0, credit: Number(l.credit) || 0, description: l.description ?? '' }))
        : [newLine(), newLine()],
    );
    setDate(new Date().toISOString().slice(0, 10));
    setDirty(true);   // a clone is unsaved data — warn if the user backs out
  }, [location.key, location.state]);

  // View mode: load existing JE
  const { data: existingJE } = useQuery<JournalEntryRow | null>({
    queryKey: ['je', id],
    queryFn: () => getAdapter().accounting.getJEById(id!),
    enabled: !isNew && !!id,
  });
  const { data: glLines = [] } = useQuery<GeneralLedgerRow[]>({
    queryKey: ['je_lines', id],
    queryFn: () => getAdapter().accounting.getGLLines(id!),
    enabled: !isNew && !!id,
  });

  // Phase 12.51 — full chart of accounts for the account picker. Cached
  // app-wide so the same query is shared with the JE list, CoA page and
  // Settings hub. Only ACTIVE accounts are pickable on a new manual JE.
  const { data: coa = [] } = useQuery<CoaRow[]>({
    queryKey: ['coa', company_id],
    queryFn: () => getAdapter().coa.list(company_id!),
    enabled: !!company_id,
  });
  // Phase 14.13b — build dropdown options in TREE order so sub-accounts
  // appear indented under their parent (e.g. "1110 Bank Account (Main)"
  // followed by "↳ 1111 Bank — Emirates NBD" etc.). Type either the code
  // or any part of the name to find them.
  const accountOpts = buildCoaTreeOptions(coa.filter((a) => a.is_active))
    .map(({ row, depth }) => ({ value: row.code, label: coaOptionLabel(row, depth) }));

  const totalDebit  = lines.reduce((s, l) => s + (Number(l.debit)  || 0), 0);
  const totalCredit = lines.reduce((s, l) => s + (Number(l.credit) || 0), 0);
  const isBalanced  = Math.abs(totalDebit - totalCredit) <= 0.01 && totalDebit > 0;

  function updateLine(key: number, field: keyof LineRow, value: string | number) {
    setLines((prev) => prev.map((l) => l._key === key ? { ...l, [field]: value } : l));
    setDirty(true);
  }

  function addLine() {
    setLines((prev) => [...prev, newLine()]);
    setDirty(true);
  }

  function removeLine(key: number) {
    setLines((prev) => prev.filter((l) => l._key !== key));
    setDirty(true);
  }

  // Date schedule for a recurring entry (just the start date when off).
  const scheduleDates = repeat
    ? Array.from({ length: Math.max(1, count) }, (_, i) => addInterval(date, freq, Math.max(1, everyN), i))
    : [date];

  const postMutation = useMutation({
    mutationFn: async () => {
      const cleanLines = lines.map(({ _key: _k, ...l }) => ({
        ...l,
        debit: Number(l.debit) || 0,
        credit: Number(l.credit) || 0,
      }));
      const adapter = getAdapter();
      // Post one journal entry per scheduled date. Sequential so each gets
      // its own entry number and a mid-run failure stops cleanly.
      let posted = 0;
      try {
        for (const d of scheduleDates) {
          await postJournalEntry({ source_type: 'manual', description: description || undefined, date: d, lines: cleanLines }, adapter);
          posted++;
        }
      } catch (err) {
        if (posted > 0) {
          throw new Error(`Posted ${posted} of ${scheduleDates.length} entries, then failed: ${err instanceof Error ? err.message : String(err)}`);
        }
        throw err;
      }
      return posted;
    },
    onSuccess: async () => {
      setDirty(false);   // saved — drop the guard before navigating
      await invalidateBooks();
      qc.invalidateQueries({ queryKey: ['journal_entries', company_id] });
      navigate('/accounting/journal-entries');
    },
    onError: (err) => {
      setError(err instanceof JournalValidationError || err instanceof Error ? err.message : t('common.error'));
    },
  });

  const reverseMutation = useMutation({
    mutationFn: async () => reverseJournalEntry(id!, getAdapter()),
    onSuccess: async () => {
      await invalidateBooks();
      qc.invalidateQueries({ queryKey: ['journal_entries', company_id] });
      qc.invalidateQueries({ queryKey: ['je', id] });
      navigate('/accounting/journal-entries');
    },
    onError: () => setError(t('common.error')),
  });

  // Edit a manual JE the audit-safe way: reverse the original, then drop into
  // a pre-filled new entry so the user posts the corrected version. Leaves a
  // clean trail (original + reversal + correction) — posted GL is never mutated.
  const editMutation = useMutation({
    mutationFn: async () => reverseJournalEntry(id!, getAdapter(), 'Reversed to edit'),
    onSuccess: async () => {
      await invalidateBooks();
      qc.invalidateQueries({ queryKey: ['journal_entries', company_id] });
      qc.invalidateQueries({ queryKey: ['je', id] });
      const cloneLines = (glLines as GeneralLedgerRow[]).map((gl) => ({
        account_code: (gl as any).account_code as string,
        debit: Number(gl.debit) || 0,
        credit: Number(gl.credit) || 0,
        description: gl.description ?? undefined,
      }));
      navigate('/accounting/journal-entries/new', {
        state: { cloneFrom: { description: existingJE?.description ?? undefined, lines: cloneLines } },
      });
    },
    onError: () => setError(t('common.error')),
  });

  const handleSubmit = useCallback((e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    postMutation.mutate();
  }, [postMutation]);

  // View mode
  if (!isNew && existingJE) {
    const je = existingJE as any;
    return (
      <div className="space-y-4">
        <div className="flex items-center gap-3">
          <BackButton to="/accounting/journal-entries" label={t('accounting.je_title')} confirm={confirmLeave} />
        </div>
        <div className="rounded-card border border-border-subtle bg-surface-card p-5 space-y-3">
          <div className="flex items-start justify-between">
            <div>
              <p className="font-mono text-lg font-semibold text-brand-600">{existingJE.entry_number}</p>
              <p className="text-sm text-ink-secondary">{formatDate(existingJE.date)} · {je.source_type}</p>
              {existingJE.description && <p className="mt-1 text-sm text-ink-primary">{existingJE.description}</p>}
            </div>
            <div className="flex gap-2">
              {je.source_type === 'manual' && !je.reversed_by_id && (
                <Button
                  size="sm"
                  onClick={() => { setError(''); editMutation.mutate(); }}
                  disabled={editMutation.isPending}
                  title="Reverses this entry and opens a copy so you can post the corrected version"
                >
                  {editMutation.isPending ? '…' : (t('common.edit') || 'Edit')}
                </Button>
              )}
              <Button
                size="sm"
                variant="ghost"
                onClick={() => {
                  const cloneLines = (glLines as GeneralLedgerRow[]).map((gl) => ({
                    account_code: (gl as any).account_code as string,
                    debit: Number(gl.debit) || 0,
                    credit: Number(gl.credit) || 0,
                    description: gl.description ?? undefined,
                  }));
                  navigate('/accounting/journal-entries/new', {
                    state: { cloneFrom: { description: existingJE.description ?? undefined, lines: cloneLines } },
                  });
                }}
              >
                {t('common.duplicate')}
              </Button>
              {!je.reversed_by_id && (
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => { setError(''); reverseMutation.mutate(); }}
                  disabled={reverseMutation.isPending}
                >
                  {t('accounting.reverse')}
                </Button>
              )}
              {je.reversed_by_id && (
                <span className="rounded-pill bg-red-50 px-2 py-0.5 text-xs text-red-600">{t('accounting.reversed')}</span>
              )}
            </div>
          </div>
          {error && <p className="text-xs text-red-500">{error}</p>}
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border-subtle text-xs text-ink-tertiary">
                <th className="py-2 text-start font-medium">{t('accounting.code')}</th>
                <th className="py-2 text-start font-medium">{t('accounting.description')}</th>
                <th className="py-2 text-end font-medium">{t('accounting.debit')}</th>
                <th className="py-2 text-end font-medium">{t('accounting.credit')}</th>
              </tr>
            </thead>
            <tbody>
              {(glLines as GeneralLedgerRow[]).map((gl) => (
                <tr key={gl.id} className="border-b border-border-subtle last:border-0">
                  <td className="py-2 font-mono text-xs">{(gl as any).account_code}</td>
                  <td className="py-2 text-ink-secondary">{gl.description ?? '—'}</td>
                  <td className="py-2 text-end font-mono">{gl.debit > 0 ? fmt(gl.debit) : ''}</td>
                  <td className="py-2 text-end font-mono">{gl.credit > 0 ? fmt(gl.credit) : ''}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="border-t border-border-subtle font-semibold">
                <td colSpan={2} className="py-2 text-xs text-ink-secondary">{t('accounting.total')}</td>
                <td className="py-2 text-end font-mono">{fmt(Number(existingJE.total_debit))}</td>
                <td className="py-2 text-end font-mono">{fmt(Number(existingJE.total_credit))}</td>
              </tr>
            </tfoot>
          </table>
        </div>
      </div>
    );
  }

  // Create mode
  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <BackButton to="/accounting/journal-entries" label={t('accounting.je_title')} confirm={confirmLeave} />
      </div>
      <h1 className="text-xl font-semibold text-ink-primary">{t('accounting.new_je')}</h1>

      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="rounded-card border border-border-subtle bg-surface-card p-5 space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="mb-1 block text-xs font-medium text-ink-secondary">{repeat ? t('accounting.start_date') : t('accounting.date')}</label>
              <Input type="date" value={date} onChange={(e) => { setDate(e.target.value); setDirty(true); }} />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-ink-secondary">{t('accounting.description')}</label>
              <Input value={description} onChange={(e) => { setDescription(e.target.value); setDirty(true); }} placeholder={t('accounting.description')} />
            </div>
          </div>

          {/* Lines */}
          <div>
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border-subtle text-xs text-ink-tertiary">
                  <th className="pb-2 text-start font-medium">{t('accounting.code')}</th>
                  <th className="pb-2 text-start font-medium">{t('accounting.line_desc')}</th>
                  <th className="pb-2 text-end font-medium">{t('accounting.debit')}</th>
                  <th className="pb-2 text-end font-medium">{t('accounting.credit')}</th>
                  <th className="pb-2" />
                </tr>
              </thead>
              <tbody>
                {lines.map((line) => (
                  <tr key={line._key} className="border-b border-border-subtle last:border-0">
                    <td className="py-1.5 pr-2 w-64">
                      {/* Phase 12.51 — pick the account by typing either
                           the code (e.g. "1100") or any part of the name
                           (e.g. "cash"). Sends the account_code to the
                           posting RPC unchanged. */}
                      <SearchableSelect
                        options={accountOpts}
                        value={line.account_code}
                        onChange={(v) => updateLine(line._key, 'account_code', v)}
                        placeholder={t('accounting.search_account') || 'Search account…'}
                        panelWidth={340}
                      />
                    </td>
                    <td className="py-1.5 pr-2">
                      <Input
                        value={line.description ?? ''}
                        onChange={(e) => updateLine(line._key, 'description', e.target.value)}
                        placeholder={t('accounting.optional')}
                      />
                    </td>
                    <td className="py-1.5 pr-2 w-28">
                      <Input
                        type="number"
                        min="0"
                        step="0.01"
                        value={line.debit || ''}
                        onChange={(e) => updateLine(line._key, 'debit', e.target.value)}
                        className="text-end"
                      />
                    </td>
                    <td className="py-1.5 pr-2 w-28">
                      <Input
                        type="number"
                        min="0"
                        step="0.01"
                        value={line.credit || ''}
                        onChange={(e) => updateLine(line._key, 'credit', e.target.value)}
                        className="text-end"
                      />
                    </td>
                    <td className="py-1.5 w-8">
                      {lines.length > 2 && (
                        <button
                          type="button"
                          onClick={() => removeLine(line._key)}
                          className="text-ink-tertiary hover:text-red-500"
                        >
                          ×
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="border-t border-border-subtle">
                  <td colSpan={2} className="pt-2 text-xs text-ink-secondary">{t('accounting.total')}</td>
                  <td className={`pt-2 text-end font-mono text-sm font-semibold ${isBalanced ? 'text-green-600' : 'text-red-500'}`}>
                    {fmt(totalDebit)}
                  </td>
                  <td className={`pt-2 text-end font-mono text-sm font-semibold ${isBalanced ? 'text-green-600' : 'text-red-500'}`}>
                    {fmt(totalCredit)}
                  </td>
                  <td />
                </tr>
              </tfoot>
            </table>

            <button
              type="button"
              onClick={addLine}
              className="mt-2 text-xs text-brand-600 hover:underline"
            >
              + {t('accounting.add_line')}
            </button>
          </div>

          {!isBalanced && totalDebit > 0 && (
            <p className="text-xs text-red-500">{t('accounting.unbalanced_hint')}</p>
          )}

          {/* Recurring — one Post creates the whole schedule of entries. */}
          <div className="rounded-card border border-border-subtle bg-surface-muted/40 p-3">
            <label className="flex cursor-pointer select-none items-center gap-2">
              <input
                type="checkbox"
                checked={repeat}
                onChange={(e) => setRepeat(e.target.checked)}
                className="h-4 w-4 accent-brand-600"
              />
              <span className="text-sm font-medium text-ink-primary">{t('accounting.repeat_entry')}</span>
            </label>

            {repeat && (
              <div className="mt-3 flex flex-wrap items-end gap-3">
                <div>
                  <label className="mb-1 block text-xs font-medium text-ink-secondary">{t('accounting.repeat_every')}</label>
                  <div className="flex items-center gap-2">
                    {freq === 'days' && (
                      <Input
                        type="number" min="1" step="1"
                        value={everyN || ''}
                        onChange={(e) => setEveryN(Math.max(1, parseInt(e.target.value) || 1))}
                        className="w-20 text-end"
                      />
                    )}
                    <select
                      value={freq}
                      onChange={(e) => setFreq(e.target.value as RepeatFreq)}
                      className="rounded-input border border-border-strong bg-surface-subtle px-2 py-2 text-sm"
                    >
                      <option value="days">{t('accounting.freq_days')}</option>
                      <option value="weekly">{t('accounting.freq_weekly')}</option>
                      <option value="monthly">{t('accounting.freq_monthly')}</option>
                      <option value="yearly">{t('accounting.freq_yearly')}</option>
                    </select>
                  </div>
                </div>
                <div>
                  <label className="mb-1 block text-xs font-medium text-ink-secondary">{t('accounting.repeat_count')}</label>
                  <Input
                    type="number" min="1" max="120" step="1"
                    value={count || ''}
                    onChange={(e) => setCount(Math.max(1, Math.min(120, parseInt(e.target.value) || 1)))}
                    className="w-24 text-end"
                  />
                </div>
                <p className="pb-2 text-xs text-ink-tertiary">
                  {t('accounting.repeat_preview', { count: scheduleDates.length, first: scheduleDates[0], last: scheduleDates[scheduleDates.length - 1] })}
                </p>
              </div>
            )}
          </div>

          {error && <p className="text-xs text-red-500">{error}</p>}
        </div>

        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={() => { if (confirmLeave()) navigate('/accounting/journal-entries'); }}>
            {t('common.cancel')}
          </Button>
          <Button type="submit" disabled={postMutation.isPending}>
            {repeat ? t('accounting.post_n_entries', { count: scheduleDates.length }) : t('accounting.post_je')}
          </Button>
        </div>
      </form>
    </div>
  );
}
