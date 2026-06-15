/**
 * Document Numbering — Settings (2026-06-13).
 *
 * Edits document_sequences per prefix: format, zero-padding, yearly
 * reset, and the next number to issue. The upgraded
 * get_next_document_number RPC honors all of these.
 *
 * Format tokens: {NUMBER} sequence · {YYYY} year · {YY} 2-digit year.
 * "Next number" edits current_value (= last issued); lowering it risks
 * duplicate document numbers, so the row warns when you do.
 */
import { useEffect, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { getAdapter } from '@/data/index';
import { useAuthStore } from '@/store/auth';
import { Button } from '@/ui/button';
import { theme } from '@/ui/theme';
import type { DocumentSequenceRow } from '@/data/adapter';

// Every prefix the app issues, with a human label. Sequences are
// lazy-created on first use, so unused ones may not exist in the DB yet —
// the page shows them all with defaults and creates the row on save.
const KNOWN_DOCS: Array<{ prefix: string; label: string }> = [
  { prefix: 'INV',  label: 'Sales Invoices' },
  { prefix: 'QT',   label: 'Quotes' },
  { prefix: 'REC',  label: 'Customer Payments' },
  { prefix: 'SR',   label: 'Sales Returns' },
  { prefix: 'CN',   label: 'Credit Notes' },
  { prefix: 'PO',   label: 'Purchase Orders' },
  { prefix: 'GRN',  label: 'Goods Receipts' },
  { prefix: 'BILL', label: 'Vendor Bills' },
  { prefix: 'VP',   label: 'Vendor Payments' },
  { prefix: 'DN',   label: 'Debit Notes' },
  { prefix: 'EXP',  label: 'Expenses' },
  { prefix: 'TRF',  label: 'Transfers' },
  { prefix: 'ADJ',  label: 'Inventory Adjustments' },
  { prefix: 'PAY',  label: 'Payroll Runs' },
  { prefix: 'JE',   label: 'Journal Entries' },
];

interface RowDraft {
  format: string;
  pad_zeros: string;
  reset_yearly: boolean;
  next_number: string;     // current_value + 1
}

function defaults(prefix: string): RowDraft {
  return { format: `${prefix}-{NUMBER}`, pad_zeros: '0', reset_yearly: false, next_number: '1001' };
}

function fromRow(r: DocumentSequenceRow): RowDraft {
  return {
    format: r.format || `${r.prefix}-{NUMBER}`,
    pad_zeros: String(r.pad_zeros ?? 0),
    reset_yearly: r.reset_yearly,
    next_number: String(Number(r.current_value) + 1),
  };
}

function preview(d: RowDraft): string {
  const n = parseInt(d.next_number) || 1;
  const pad = parseInt(d.pad_zeros) || 0;
  const num = pad > 0 ? String(n).padStart(pad, '0') : String(n);
  const year = new Date().getFullYear();
  return d.format
    .replace('{YYYY}', String(year))
    .replace('{YY}', String(year).slice(-2))
    .replace('{NUMBER}', num);
}

const inputCls = 'h-8 rounded-card border border-border-subtle bg-surface-card px-2.5 text-sm text-ink-primary focus:outline-none focus:ring-2 focus:ring-brand-500';

export default function DocumentNumberingPage() {
  const { company_id } = useAuthStore();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [drafts, setDrafts] = useState<Record<string, RowDraft>>({});
  const [savedPrefix, setSavedPrefix] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const { data: rows = [], isLoading } = useQuery<DocumentSequenceRow[]>({
    queryKey: ['document_sequences', company_id],
    queryFn: () => getAdapter().documentSequences.list(company_id!),
    enabled: !!company_id,
  });

  const dbByPrefix = Object.fromEntries(rows.map(r => [r.prefix, r]));

  // (Re)build drafts whenever DB rows load.
  useEffect(() => {
    const next: Record<string, RowDraft> = {};
    for (const doc of KNOWN_DOCS) {
      const db = dbByPrefix[doc.prefix];
      next[doc.prefix] = db ? fromRow(db) : defaults(doc.prefix);
    }
    setDrafts(next);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows]);

  const saveMutation = useMutation({
    mutationFn: async (prefix: string) => {
      const d = drafts[prefix];
      const next = parseInt(d.next_number);
      if (!d.format.includes('{NUMBER}')) throw new Error(`${prefix}: format must contain {NUMBER}`);
      if (!next || next < 1) throw new Error(`${prefix}: next number must be at least 1`);
      await getAdapter().documentSequences.save(company_id!, prefix, {
        format: d.format.trim(),
        pad_zeros: Math.max(0, parseInt(d.pad_zeros) || 0),
        reset_yearly: d.reset_yearly,
        current_value: next - 1,
      });
      return prefix;
    },
    onSuccess: (prefix) => {
      qc.invalidateQueries({ queryKey: ['document_sequences', company_id] });
      setError(null);
      setSavedPrefix(prefix);
      setTimeout(() => setSavedPrefix(null), 2500);
    },
    onError: (e: Error) => setError(e.message),
  });

  const set = (prefix: string, patch: Partial<RowDraft>) =>
    setDrafts(ds => ({ ...ds, [prefix]: { ...ds[prefix], ...patch } }));

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '20px', maxWidth: '980px' }}>
      <div className="flex flex-wrap items-center gap-3">
        <button onClick={() => navigate('/settings')} className="text-sm text-ink-secondary hover:text-ink-primary">← Settings</button>
        <span className="text-ink-tertiary">/</span>
        <h1 className="text-xl font-semibold text-ink-primary">Document Numbering</h1>
      </div>

      <div className="rounded-card border border-border-subtle bg-surface-card p-4 text-xs text-ink-secondary">
        <p>
          Format tokens: <code className="rounded bg-surface-muted px-1 font-mono">{'{NUMBER}'}</code> sequence
          {' · '}<code className="rounded bg-surface-muted px-1 font-mono">{'{YYYY}'}</code> year
          {' · '}<code className="rounded bg-surface-muted px-1 font-mono">{'{YY}'}</code> 2-digit year.
          {' '}Example: <span className="font-mono">INV-{'{YYYY}'}-{'{NUMBER}'}</span> with padding 5 → <span className="font-mono">INV-2026-01001</span>.
        </p>
        <p className="mt-1 text-amber-700">
          Lowering "Next number" below numbers already issued will cause duplicate-number errors on save — only do it after a data reset.
        </p>
      </div>

      {error && <div className="rounded border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>}

      {isLoading ? (
        <p style={{ fontSize: '13px', color: theme.inkFaint, padding: '32px 0', textAlign: 'center' }}>Loading…</p>
      ) : (
        <div className="overflow-x-auto bg-white" style={{ border: `1px solid ${theme.border}`, borderRadius: '12px', boxShadow: theme.shadowSm }}>
          <table className="w-full text-sm" style={{ minWidth: '860px' }}>
            <thead>
              <tr style={{ background: theme.panelHead, borderBottom: `1px solid ${theme.border}` }}>
                {['Document', 'Format', 'Padding', 'Next Number', 'Yearly Reset', 'Preview', ''].map((l, i) => (
                  <th key={i} className="px-4 py-3" style={{
                    fontSize: '11px', fontWeight: 600, color: theme.inkMuted,
                    textTransform: 'uppercase', letterSpacing: '.06em',
                    textAlign: 'start', whiteSpace: 'nowrap',
                  }}>{l}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {KNOWN_DOCS.map((doc, idx) => {
                const d = drafts[doc.prefix];
                if (!d) return null;
                const db = dbByPrefix[doc.prefix];
                const lastIssued = db ? Number(db.current_value) : null;
                const lowered = lastIssued !== null && (parseInt(d.next_number) || 0) <= lastIssued;
                return (
                  <tr key={doc.prefix} style={{ borderTop: idx === 0 ? 'none' : '1px solid #f1f5f9' }}>
                    <td className="px-4 py-2.5" style={{ whiteSpace: 'nowrap' }}>
                      <span style={{ fontWeight: 500, color: theme.ink }}>{doc.label}</span>
                      <span className="font-mono" style={{ marginInlineStart: '8px', fontSize: '10px', color: theme.inkFaint }}>{doc.prefix}</span>
                    </td>
                    <td className="px-4 py-2.5">
                      <input className={`${inputCls} w-44 font-mono`} value={d.format}
                        onChange={e => set(doc.prefix, { format: e.target.value })} />
                    </td>
                    <td className="px-4 py-2.5">
                      <input className={`${inputCls} w-16 text-end`} type="number" min="0" max="10" value={d.pad_zeros}
                        onChange={e => set(doc.prefix, { pad_zeros: e.target.value })} />
                    </td>
                    <td className="px-4 py-2.5">
                      <input className={`${inputCls} w-24 text-end font-mono ${lowered ? 'border-amber-400 bg-amber-50' : ''}`}
                        type="number" min="1" value={d.next_number}
                        title={lowered ? `Already issued up to ${lastIssued} — duplicates likely` : ''}
                        onChange={e => set(doc.prefix, { next_number: e.target.value })} />
                    </td>
                    <td className="px-4 py-2.5">
                      <input type="checkbox" className="h-4 w-4 rounded accent-brand-600"
                        checked={d.reset_yearly}
                        onChange={e => set(doc.prefix, { reset_yearly: e.target.checked })} />
                    </td>
                    <td className="px-4 py-2.5 font-mono" style={{ fontSize: '12px', color: theme.brandSoftText, whiteSpace: 'nowrap' }}>
                      {preview(d)}
                    </td>
                    <td className="px-4 py-2.5" style={{ textAlign: 'end' }}>
                      {savedPrefix === doc.prefix ? (
                        <span style={{ fontSize: '11px', fontWeight: 600, color: '#047857' }}>✓ Saved</span>
                      ) : (
                        <Button variant="ghost" size="sm"
                          onClick={() => saveMutation.mutate(doc.prefix)}
                          disabled={saveMutation.isPending}>
                          Save
                        </Button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <p className="text-xs text-ink-tertiary">
        Sequences are created automatically the first time a document type is used, so rows here may
        show defaults until then. Yearly reset restarts at 1 each January — pair it with {'{YYYY}'} in
        the format so numbers stay unique across years.
      </p>
    </div>
  );
}
