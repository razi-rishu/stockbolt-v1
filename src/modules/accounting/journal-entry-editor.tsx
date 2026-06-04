import { useState, useCallback } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { getAdapter } from '@/data/index';
import { useAuthStore } from '@/store/auth';
import { useInvalidateBooks } from '@/hooks/use-invalidate-books';
import { postJournalEntry, reverseJournalEntry, JournalValidationError } from '@/core/gl/posting-engine';
import { Button } from '@/ui/button';
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

export default function JournalEntryEditorPage() {
  const { t } = useTranslation();
  const { id } = useParams<{ id: string }>();
  const isNew = !id || id === 'new';
  const navigate = useNavigate();
  const { company_id } = useAuthStore();
  const qc = useQueryClient();
  const invalidateBooks = useInvalidateBooks();   // Phase 14.14k

  const [description, setDescription] = useState('');
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [lines, setLines] = useState<LineRow[]>([newLine(), newLine()]);
  const [error, setError] = useState('');

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
  }

  function addLine() {
    setLines((prev) => [...prev, newLine()]);
  }

  function removeLine(key: number) {
    setLines((prev) => prev.filter((l) => l._key !== key));
  }

  const postMutation = useMutation({
    mutationFn: async () => {
      const payload = {
        source_type: 'manual',
        description: description || undefined,
        date,
        lines: lines.map(({ _key: _k, ...l }) => ({
          ...l,
          debit: Number(l.debit) || 0,
          credit: Number(l.credit) || 0,
        })),
      };
      return postJournalEntry(payload, getAdapter());
    },
    onSuccess: async (result) => {
      await invalidateBooks();
      qc.invalidateQueries({ queryKey: ['journal_entries', company_id] });
      navigate(`/accounting/journal-entries/${result.journal_entry_id}`);
    },
    onError: (err) => {
      setError(err instanceof JournalValidationError ? err.message : t('common.error'));
    },
  });

  const reverseMutation = useMutation({
    mutationFn: async () => reverseJournalEntry(id!, getAdapter()),
    onSuccess: async (result) => {
      await invalidateBooks();
      qc.invalidateQueries({ queryKey: ['journal_entries', company_id] });
      qc.invalidateQueries({ queryKey: ['je', id] });
      navigate(`/accounting/journal-entries/${result.journal_entry_id}`);
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
          <button onClick={() => navigate('/accounting/journal-entries')} className="text-sm text-brand-600 hover:underline">
            ← {t('accounting.je_title')}
          </button>
        </div>
        <div className="rounded-card border border-border-subtle bg-surface-card p-5 space-y-3">
          <div className="flex items-start justify-between">
            <div>
              <p className="font-mono text-lg font-semibold text-brand-600">{existingJE.entry_number}</p>
              <p className="text-sm text-ink-secondary">{existingJE.date} · {je.source_type}</p>
              {existingJE.description && <p className="mt-1 text-sm text-ink-primary">{existingJE.description}</p>}
            </div>
            <div className="flex gap-2">
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
        <button onClick={() => navigate('/accounting/journal-entries')} className="text-sm text-brand-600 hover:underline">
          ← {t('accounting.je_title')}
        </button>
      </div>
      <h1 className="text-xl font-semibold text-ink-primary">{t('accounting.new_je')}</h1>

      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="rounded-card border border-border-subtle bg-surface-card p-5 space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="mb-1 block text-xs font-medium text-ink-secondary">{t('accounting.date')}</label>
              <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-ink-secondary">{t('accounting.description')}</label>
              <Input value={description} onChange={(e) => setDescription(e.target.value)} placeholder={t('accounting.description')} />
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
          {error && <p className="text-xs text-red-500">{error}</p>}
        </div>

        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={() => navigate('/accounting/journal-entries')}>
            {t('common.cancel')}
          </Button>
          <Button type="submit" disabled={postMutation.isPending}>
            {t('accounting.post_je')}
          </Button>
        </div>
      </form>
    </div>
  );
}
