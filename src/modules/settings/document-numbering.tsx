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
import { getAdapter } from '@/data/index';
import { useAuthStore } from '@/store/auth';
import { useTranslation } from 'react-i18next';
import type { Column } from '@/ui/table';
import { OceanPage, OceanTable } from '@/components/ocean-list';
import { Check, Info, AlertTriangle } from 'lucide-react';
import { BackButton } from '@/ui/back-button';
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


export default function DocumentNumberingPage() {
  const { company_id } = useAuthStore();
  const qc = useQueryClient();
  const { t } = useTranslation();
  // English labels in KNOWN_DOCS stay as the fallback.
  const docLabel = (d: { prefix: string; label: string }) => t(`settingsPages.numbering.docs.${d.prefix}`, { defaultValue: d.label });
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
      if (!d.format.includes('{NUMBER}')) throw new Error(t('settingsPages.numbering.err_format', { prefix }));
      if (!next || next < 1) throw new Error(t('settingsPages.numbering.err_next', { prefix }));
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

  type Doc = (typeof KNOWN_DOCS)[number];
  const lastIssued = (doc: Doc) => { const db = dbByPrefix[doc.prefix]; return db ? Number(db.current_value) : null; };
  const columns: Column<Doc>[] = [
    {
      key: 'doc', header: t('settingsPages.numbering.document'),
      render: (doc) => (
        <span className="sb-num-doc">
          <span style={{ fontWeight: 700 }}>{docLabel(doc)}</span>
          <bdi dir="ltr" className="sb-wh-code">{doc.prefix}</bdi>
        </span>
      ),
    },
    {
      key: 'format', header: t('settingsPages.numbering.format'),
      render: (doc) => (
        <input className="sb-field sb-mono sb-num-input sb-num-format" dir="ltr" value={drafts[doc.prefix].format}
          aria-label={`${t('settingsPages.numbering.format')} — ${docLabel(doc)}`}
          onChange={e => set(doc.prefix, { format: e.target.value })} />
      ),
    },
    {
      key: 'pad', header: t('settingsPages.numbering.padding'),
      render: (doc) => (
        <input className="sb-field sb-num-input sb-num-small" dir="ltr" type="number" min="0" max="10" value={drafts[doc.prefix].pad_zeros}
          aria-label={`${t('settingsPages.numbering.padding')} — ${docLabel(doc)}`}
          onChange={e => set(doc.prefix, { pad_zeros: e.target.value })} />
      ),
    },
    {
      key: 'next', header: t('settingsPages.numbering.next'),
      render: (doc) => {
        const d = drafts[doc.prefix];
        const last = lastIssued(doc);
        const lowered = last !== null && (parseInt(d.next_number) || 0) <= last;
        return (
          <input className={`sb-field sb-mono sb-num-input sb-num-small ${lowered ? 'is-warn' : ''}`} dir="ltr"
            type="number" min="1" value={d.next_number}
            aria-label={`${t('settingsPages.numbering.next')} — ${docLabel(doc)}`}
            title={lowered ? t('settingsPages.numbering.lowered', { n: last }) : ''}
            onChange={e => set(doc.prefix, { next_number: e.target.value })} />
        );
      },
    },
    {
      key: 'reset', header: t('settingsPages.numbering.yearly'),
      render: (doc) => (
        <input type="checkbox" className="sb-num-check" checked={drafts[doc.prefix].reset_yearly}
          aria-label={`${t('settingsPages.numbering.yearly')} — ${docLabel(doc)}`}
          onChange={e => set(doc.prefix, { reset_yearly: e.target.checked })} />
      ),
    },
    {
      key: 'preview', header: t('settingsPages.numbering.preview'),
      render: (doc) => <bdi dir="ltr" className="sb-mono sb-num-preview">{preview(drafts[doc.prefix])}</bdi>,
    },
    {
      key: 'save', header: '', align: 'end',
      render: (doc) => savedPrefix === doc.prefix ? (
        <span className="sb-pill sb-pill-good" role="status"><Check size={14} aria-hidden="true" style={{ display: 'inline', verticalAlign: '-2px' }} /> {t('settingsPages.numbering.saved')}</span>
      ) : (
        <button type="button" className="sb-row-link text-brand-600"
          onClick={() => saveMutation.mutate(doc.prefix)}
          disabled={saveMutation.isPending}
          aria-label={`${t('common.save')} — ${docLabel(doc)}`}>
          {t('common.save')}
        </button>
      ),
    },
  ];
  const ready = KNOWN_DOCS.every(doc => !!drafts[doc.prefix]);

  // Ocean Teal (UI v1.1): look only — same sequences, drafts, per-row save,
  // validation and lowered-number warning as before.
  return (
    <OceanPage
      testid="numbering-ocean"
      back={<BackButton to="/settings" label={t('settingsNav.title')} />}
      title={t('settingsNav.items.numbering.title')}
      subtitle={t('settingsNav.items.numbering.desc')}
    >
      <div className="sb-info-note sb-num-help">
        <p style={{ margin: 0 }}>
          <Info size={16} aria-hidden="true" className="sb-num-ico" />
          {t('settingsPages.numbering.tokens_intro')}{' '}
          <code dir="ltr">{'{NUMBER}'}</code> {t('settingsPages.numbering.token_number')}
          {' · '}<code dir="ltr">{'{YYYY}'}</code> {t('settingsPages.numbering.token_year')}
          {' · '}<code dir="ltr">{'{YY}'}</code> {t('settingsPages.numbering.token_yy')}.{' '}
          {t('settingsPages.numbering.example')} <bdi dir="ltr" className="sb-mono">INV-{'{YYYY}'}-{'{NUMBER}'}</bdi> → <bdi dir="ltr" className="sb-mono">INV-2026-01001</bdi>
        </p>
        <p className="sb-num-warn">
          <AlertTriangle size={16} aria-hidden="true" className="sb-num-ico" />
          {t('settingsPages.numbering.warning')}
        </p>
      </div>

      {error && <p className="sb-alert sb-alert-danger" role="alert">{error}</p>}

      {isLoading || !ready
        ? <div className="sb-card sb-empty">{t('common.loading')}</div>
        : <OceanTable wide columns={columns} rows={KNOWN_DOCS} keyFn={(d) => d.prefix} />}

      <p className="sb-form-hint">{t('settingsPages.numbering.footer')}</p>
    </OceanPage>
  );
}
