import { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { getAdapter } from '@/data/index';
import { useAuthStore } from '@/store/auth';
import { Button } from '@/ui/button';
import { PageHeader } from '@/ui/primitives';
import { theme } from '@/ui/theme';
import type { JournalEntryRow } from '@/data/adapter';

function fmt(n: number) {
  return n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

// Phase 12.51 — friendly labels for the source_type column. Anything not
// listed here is treated as 'system' (auto-posted by an RPC).
const SOURCE_LABEL: Record<string, string> = {
  manual:               'Manual',
  sales_invoice:        'Invoice',
  sales_invoice_edit:   'Invoice edit',
  sales_invoice_void:   'Invoice void',
  sales_payment:        'Customer payment',
  customer_advance:     'Customer advance',
  pos_sale:             'POS sale',
  vendor_bill:          'Vendor bill',
  vendor_bill_edit:     'Bill edit',
  vendor_bill_void:     'Bill void',
  vendor_payment:       'Vendor payment',
  vendor_advance:       'Vendor advance',
  expense:              'Expense',
  bank_transfer:        'Bank transfer',
  credit_note:          'Credit note',
  debit_note:           'Debit note',
  inventory_adjustment: 'Inventory adjustment',
  stock_transfer:       'Stock transfer',
  opening_balance:      'Opening balance',
  reversal:             'Reversal',
};

// ── Pill helper (sample look) ────────────────────────────────────────────
function Pill({ label, tone }: { label: string; tone: 'brand' | 'success' | 'danger' | 'slate' }) {
  const t = {
    brand:   { bg: theme.brandSoft,   text: theme.brandSoftText, border: '#c7d2fe' },
    success: { bg: '#f0fdf4',         text: '#15803d',           border: '#bbf7d0' },
    danger:  { bg: '#fef2f2',         text: '#dc2626',           border: '#fecaca' },
    slate:   { bg: theme.muted,       text: theme.inkMuted,      border: theme.border },
  }[tone];
  return (
    <span style={{
      display: 'inline-block', padding: '3px 9px', borderRadius: '999px',
      fontSize: '11px', fontWeight: 600,
      background: t.bg, color: t.text, border: `1px solid ${t.border}`,
    }}>{label}</span>
  );
}

// ── Tab filter chip ──────────────────────────────────────────────────────
function FilterPill({ label, count, active, onClick }: { label: string; count: number; active: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        padding: '6px 14px',
        borderRadius: '999px',
        fontSize: '12px', fontWeight: 600,
        border: active ? `1px solid ${theme.brand}` : `1px solid ${theme.border}`,
        background: active ? theme.brand : '#fff',
        color: active ? '#fff' : theme.inkMuted,
        cursor: 'pointer',
        transition: 'background-color .12s, color .12s, border-color .12s',
        display: 'inline-flex', alignItems: 'center', gap: '8px',
      }}
    >
      <span>{label}</span>
      <span style={{
        background: active ? 'rgba(255,255,255,.25)' : theme.muted,
        color: active ? '#fff' : theme.inkMuted,
        borderRadius: '999px',
        padding: '1px 7px',
        fontSize: '10px',
        fontFamily: theme.fontMono,
      }}>{count}</span>
    </button>
  );
}

type Tab = 'manual' | 'system' | 'all';

export default function JournalEntriesPage() {
  const { t } = useTranslation();
  const { company_id } = useAuthStore();
  const navigate = useNavigate();
  // Phase 12.51 — default tab is "Manual" so the audit view is clean.
  // System-generated entries (invoice confirms, payments, etc.) live on
  // their own tab so the operator can sanity-check them without scrolling
  // past their own manual posts.
  const [tab, setTab] = useState<Tab>('manual');

  const { data: entries = [], isLoading } = useQuery({
    queryKey: ['journal_entries', company_id],
    queryFn: () => getAdapter().accounting.listJEs(company_id!, 200),
    enabled: !!company_id,
  });

  const all = entries as JournalEntryRow[];
  const manualCount = useMemo(() => all.filter(je => (je as any).source_type === 'manual').length, [all]);
  const systemCount = all.length - manualCount;

  const filtered = useMemo(() => {
    if (tab === 'manual') return all.filter(je => (je as any).source_type === 'manual');
    if (tab === 'system') return all.filter(je => (je as any).source_type !== 'manual');
    return all;
  }, [all, tab]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
      <PageHeader
        title={t('accounting.je_title')}
        subtitle={`${all.length} total · ${manualCount} manual · ${systemCount} system`}
        actions={
          <Button size="sm" onClick={() => navigate('/accounting/journal-entries/new')}>
            + {t('accounting.new_je')}
          </Button>
        }
      />

      {/* Manual / System / All tabs */}
      <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
        <FilterPill label="Manual"            count={manualCount} active={tab === 'manual'} onClick={() => setTab('manual')} />
        <FilterPill label="System auto-posted" count={systemCount} active={tab === 'system'} onClick={() => setTab('system')} />
        <FilterPill label="All"               count={all.length}  active={tab === 'all'}    onClick={() => setTab('all')} />
      </div>

      {isLoading ? (
        <p style={{ fontSize: '13px', color: theme.inkFaint, padding: '48px 0', textAlign: 'center' }}>{t('common.loading')}</p>
      ) : filtered.length === 0 ? (
        <p style={{ fontSize: '13px', color: theme.inkFaint, padding: '48px 0', textAlign: 'center' }}>
          {tab === 'manual'
            ? 'No manual journals yet. Click + New to post one.'
            : tab === 'system'
              ? 'No system-generated journals in the period.'
              : t('accounting.je_empty')}
        </p>
      ) : (
        <div
          className="overflow-x-auto bg-white"
          style={{ border: `1px solid ${theme.border}`, borderRadius: '12px', boxShadow: theme.shadowSm }}
        >
          <table className="w-full text-sm">
            <thead>
              <tr style={{ background: theme.panelHead, borderBottom: `1px solid ${theme.border}` }}>
                {[
                  { l: t('accounting.entry_number'), a: 'start' as const },
                  { l: t('accounting.date'),         a: 'start' as const },
                  { l: t('accounting.description'),  a: 'start' as const },
                  { l: t('accounting.source_type'),  a: 'start' as const },
                  { l: t('accounting.debit'),        a: 'end'   as const },
                  { l: t('accounting.status'),       a: 'end'   as const },
                ].map((c, i) => (
                  <th key={i} className="px-4 py-3" style={{
                    fontSize: '11px', fontWeight: 600, color: theme.inkMuted,
                    textTransform: 'uppercase', letterSpacing: '.06em',
                    textAlign: c.a, whiteSpace: 'nowrap',
                  }}>{c.l}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtered.map((je, idx) => {
                const src = (je as any).source_type as string | undefined;
                const isManual = src === 'manual';
                return (
                  <tr
                    key={je.id}
                    onClick={() => navigate(`/accounting/journal-entries/${je.id}`)}
                    className="cursor-pointer"
                    style={{
                      borderTop: idx === 0 ? 'none' : '1px solid #f1f5f9',
                      transition: 'background-color .12s',
                    }}
                    onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = theme.panelHead; }}
                    onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = ''; }}
                  >
                    <td className="px-4 py-3 font-mono" style={{ fontSize: '12px', color: theme.brandSoftText, fontWeight: 600 }}>{je.entry_number}</td>
                    <td className="px-4 py-3" style={{ color: theme.inkMuted, fontSize: '13px' }}>{je.date}</td>
                    <td className="px-4 py-3" style={{ color: theme.ink, fontSize: '13px' }}>{je.description ?? '—'}</td>
                    <td className="px-4 py-3">
                      {src
                        ? <Pill label={SOURCE_LABEL[src] ?? src} tone={isManual ? 'brand' : 'slate'} />
                        : <span style={{ color: theme.inkFaint }}>—</span>}
                    </td>
                    <td className="px-4 py-3 font-mono" style={{ textAlign: 'end', color: theme.ink, fontSize: '13px' }}>{fmt(Number(je.total_debit))}</td>
                    <td className="px-4 py-3" style={{ textAlign: 'end' }}>
                      {(je as any).reversed_by_id
                        ? <Pill label={t('accounting.reversed')} tone="danger" />
                        : <Pill label={t('accounting.posted')}  tone="success" />}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
