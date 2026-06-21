import { useState } from 'react';
import { formatDate } from '@/lib/locale';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { getAdapter } from '@/data/index';
import { useAuthStore } from '@/store/auth';
import { Button } from '@/ui/button';
import { Pagination, paginate } from '@/ui/pagination';
import { PageHeader } from '@/ui/primitives';
import { theme } from '@/ui/theme';
import { StatusBadge } from '@/ui/status-badge';
import type { PaymentRow, ContactRow } from '@/data/adapter';

const PAGE_SIZE = 50;

// Type extension until Supabase generated types pick up payments.allocation_status (Phase 12.11).
type AllocStatus = 'unallocated' | 'partial' | 'full' | null;
type PaymentWithAlloc = PaymentRow & { allocation_status?: AllocStatus };

function fmt(n: number) {
  return n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

// ── Shared status-pill primitive (matched to sample) ──────────────────────
type Tone = { bg: string; text: string; border: string };
function Pill({ label, tone }: { label: string; tone: Tone }) {
  return (
    <span style={{
      display: 'inline-block',
      padding: '3px 9px',
      borderRadius: '999px',
      fontSize: '11px', fontWeight: 600,
      textTransform: 'capitalize',
      background: tone.bg, color: tone.text,
      border: `1px solid ${tone.border}`,
    }}>{label}</span>
  );
}

function AllocationBadge({ status, alloc }: { status: string; alloc: AllocStatus }) {
  if (status !== 'confirmed' || !alloc) return null;
  const map: Record<string, { label: string; tone: Tone }> = {
    unallocated: { label: 'Advance',       tone: { bg: '#f5f3ff', text: '#6d28d9', border: '#ddd6fe' } },
    partial:     { label: 'Partial',       tone: { bg: '#fffbeb', text: '#b45309', border: '#fde68a' } },
    full:        { label: 'Fully applied', tone: { bg: '#eff6ff', text: '#1d4ed8', border: '#bfdbfe' } },
  };
  const cfg = map[alloc];
  if (!cfg) return null;
  return <span style={{ marginInlineStart: '6px' }}><Pill label={cfg.label} tone={cfg.tone} /></span>;
}

function ReconciledBadge({ reconciled, status }: { reconciled: boolean; status: string }) {
  if (!reconciled || status !== 'confirmed') return null;
  return (
    <span style={{ marginInlineStart: '6px' }}>
      <Pill label="Reconciled" tone={{ bg: '#ecfdf5', text: '#059669', border: '#a7f3d0' }} />
    </span>
  );
}

export default function PaymentsPage() {
  const { t } = useTranslation();
  const { company_id } = useAuthStore();
  const navigate = useNavigate();
  const [page, setPage] = useState(1);

  const { data: allPayments = [], isLoading } = useQuery({
    queryKey: ['payments', company_id],
    queryFn: () => getAdapter().payments.list(company_id!, 'inbound'),
    enabled: !!company_id,
  });

  const { data: reconciledIds = [] } = useQuery({
    queryKey: ['reconciled_payment_ids', company_id],
    queryFn: () => getAdapter().bankReconciliations.listReconciledPaymentIds(company_id!),
    enabled: !!company_id,
  });
  const reconciledSet = new Set(reconciledIds);

  const { data: customers = [] } = useQuery<ContactRow[]>({
    queryKey: ['contacts', company_id, 'customer'],
    queryFn: () => getAdapter().contacts.list(company_id!, 'customer'),
    enabled: !!company_id,
  });
  const customerMap = Object.fromEntries(customers.map(c => [c.id, c.name]));

  const paged = paginate(allPayments as PaymentWithAlloc[], page, PAGE_SIZE);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
      <PageHeader
        title={t('payments.title')}
        subtitle={`${allPayments.length} ${allPayments.length === 1 ? 'payment' : 'payments'}`}
        actions={
          <Button size="sm" onClick={() => navigate('/sales/payments/new')}>
            + {t('payments.new_payment')}
          </Button>
        }
      />

      {isLoading ? (
        <p style={{ fontSize: '13px', color: theme.inkFaint, padding: '48px 0', textAlign: 'center' }}>{t('common.loading')}</p>
      ) : allPayments.length === 0 ? (
        <p style={{ fontSize: '13px', color: theme.inkFaint, padding: '48px 0', textAlign: 'center' }}>{t('payments.empty')}</p>
      ) : (
        <div
          className="overflow-x-auto bg-white"
          style={{ border: `1px solid ${theme.border}`, borderRadius: '12px', boxShadow: theme.shadowSm }}
        >
          <table className="w-full text-sm">
            <thead>
              <tr style={{ background: theme.panelHead, borderBottom: `1px solid ${theme.border}` }}>
                {[
                  { l: t('payments.payment_number'), a: 'start' as const },
                  { l: t('sales.customer'),          a: 'start' as const },
                  { l: t('payments.date'),           a: 'start' as const },
                  { l: t('payments.classification'), a: 'start' as const },
                  { l: t('payments.amount'),         a: 'end'   as const },
                  { l: t('payments.status'),         a: 'start' as const },
                ].map(c => (
                  <th
                    key={c.l}
                    className="px-4 py-3"
                    style={{
                      fontSize: '11px', fontWeight: 600, color: theme.inkMuted,
                      textTransform: 'uppercase', letterSpacing: '.06em',
                      textAlign: c.a, whiteSpace: 'nowrap',
                    }}
                  >{c.l}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {paged.map((pmt, idx) => (
                <tr
                  key={pmt.id}
                  onClick={() => navigate(`/sales/payments/${pmt.id}`)}
                  className="cursor-pointer"
                  style={{
                    borderTop: idx === 0 ? 'none' : '1px solid #f1f5f9',
                    transition: 'background-color .12s',
                  }}
                  onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = theme.panelHead; }}
                  onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = ''; }}
                >
                  <td className="px-4 py-3 font-mono" style={{ fontSize: '12px', color: theme.brandSoftText, fontWeight: 600 }}>{pmt.payment_number}</td>
                  <td className="px-4 py-3" style={{ color: theme.ink, fontSize: '13px', fontWeight: 500 }}>{customerMap[pmt.contact_id] ?? '—'}</td>
                  <td className="px-4 py-3" style={{ color: theme.inkMuted, fontSize: '13px' }}>{formatDate(pmt.date)}</td>
                  <td className="px-4 py-3" style={{ color: theme.inkMuted, fontSize: '13px', textTransform: 'capitalize' }}>{pmt.classification.replace('_', ' ')}</td>
                  <td className="px-4 py-3 font-mono" style={{ textAlign: 'end', color: theme.ink, fontSize: '13px' }}>
                    {pmt.currency} {fmt(Number(pmt.amount))}
                  </td>
                  <td className="px-4 py-3">
                    <StatusBadge status={pmt.status} />
                    <AllocationBadge status={pmt.status} alloc={pmt.allocation_status ?? null} />
                    <ReconciledBadge status={pmt.status} reconciled={reconciledSet.has(pmt.id)} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <Pagination
            page={page}
            pageSize={PAGE_SIZE}
            total={allPayments.length}
            onChange={setPage}
            className="border-t"
          />
        </div>
      )}
    </div>
  );
}
