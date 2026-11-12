import { useState } from 'react';
import { formatDate } from '@/lib/locale';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { getAdapter } from '@/data/index';
import { useAuthStore } from '@/store/auth';
import { VoidedToggle } from '@/ui/voided-toggle';
import { useHideVoided } from '@/hooks/use-hide-voided';
import { Pagination, paginate } from '@/ui/pagination';
import type { Column } from '@/ui/table';
import { OceanPage, OceanTable } from '@/components/ocean-list';
import { Plus } from 'lucide-react';
import { StatusBadge } from '@/ui/status-badge';
import { ListFilters } from '@/ui/list-filters';
import type { VendorBillRow, ContactRow } from '@/data/adapter';

const PAGE_SIZE = 50;

const fmt = (n: number) => n.toLocaleString('en-US', { minimumFractionDigits: 2 });

// ── Payment-status badge (same semantics as the Invoices list: "is it paid?") ──
function PayBadge({ status, total, applied, dueDate, today }: {
  // applied = payments + cash discount + posted TDS (phase114): all settle the bill.
  status: string; total: number; applied: number; dueDate: string | null; today: string;
}) {
  const { t } = useTranslation();
  if (status !== 'confirmed') return <StatusBadge status={status} />;
  const outstanding = total - applied;
  const cfg =
    outstanding <= 0.005
      ? { key: 'paid',    tone: 'sb-pill-good' }
      : dueDate && dueDate < today
      ? { key: 'overdue', tone: 'sb-pill-bad' }
      : applied > 0.005
      ? { key: 'partial', tone: 'sb-pill-warn' }
      : { key: 'unpaid',  tone: '' };
  return <span className={`sb-pill ${cfg.tone}`} style={{ marginTop: 0, fontSize: 12, padding: '2px 10px' }}>{t(`docStatus.${cfg.key}`)}</span>;
}

export default function VendorBillsPage() {
  const { t } = useTranslation();
  const { company_id } = useAuthStore();
  const navigate = useNavigate();
  const [page, setPage] = useState(1);
  const [statusFilter, setStatusFilter] = useState('');
  const { hideVoided, setHideVoided } = useHideVoided('stockbolt.list.vendor-bills.voided');
  const [search, setSearch] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');

  const { data: bills = [], isLoading } = useQuery<VendorBillRow[]>({
    queryKey: ['vendor_bills', company_id],
    queryFn: () => getAdapter().vendorBills.list(company_id!),
    enabled: !!company_id,
  });

  // Suppliers — for resolving supplier_id → name on the row. Same cache
  // key as other purchasing screens so this is usually a hit.
  const { data: suppliers = [] } = useQuery<ContactRow[]>({
    queryKey: ['contacts', company_id, 'supplier'],
    queryFn: () => getAdapter().contacts.list(company_id!, 'supplier'),
    enabled: !!company_id,
  });
  const supplierName = (id: string) => suppliers.find(s => s.id === id)?.name ?? `${id.slice(0, 8)}…`;

  // Vendor payments applied per bill — drives the Paid / Partial / Unpaid /
  // Overdue badge (mirrors the Invoices list).
  const { data: appliedMap = {} } = useQuery<Record<string, number>>({
    queryKey: ['bill_applied_map', company_id],
    queryFn: () => getAdapter().payments.getAppliedMap(company_id!, 'vendor_bill'),
    enabled: !!company_id,
  });
  // phase114 — posted TDS settles the bill like a payment.
  const { data: tdsMap = {} } = useQuery<Record<string, number>>({
    queryKey: ['bill_tds_map', company_id],
    queryFn: () => getAdapter().tds.getWithheldMap(company_id!),
    enabled: !!company_id,
  });
  const today = new Date().toISOString().slice(0, 10);

  const q = search.trim().toLowerCase();
  // Z4 — how many the default view is holding back right now.
  const voidedCount = bills.filter(r => r.status === 'void').length;
  const filtered = bills.filter(bill => {
    if (statusFilter && bill.status !== statusFilter) return false;
    // Z4 — hidden unless the user has explicitly asked for the void
    // status, in which case showing them is the whole point.
    if (!statusFilter && hideVoided && bill.status === 'void') return false;
    if (dateFrom && (bill.date as string) < dateFrom) return false;
    if (dateTo && (bill.date as string) > dateTo) return false;
    if (q) {
      const name = supplierName(bill.supplier_id).toLowerCase();
      if (!bill.bill_number.toLowerCase().includes(q) && !name.includes(q)) return false;
    }
    return true;
  });

  const paged = paginate(filtered, page, PAGE_SIZE);

  const columns: Column<VendorBillRow>[] = [
    { key: 'no', header: t('purchasing.bill_number'), render: (b) => <bdi dir="ltr" className="sb-inv-no">{b.bill_number}</bdi> },
    { key: 'sup', header: t('purchasing.supplier'), render: (b) => <span style={{ fontWeight: 600 }}>{supplierName(b.supplier_id)}</span> },
    { key: 'date', header: t('purchasing.date'), render: (b) => <bdi dir="ltr">{formatDate(b.date as string)}</bdi> },
    { key: 'due', header: t('purchasing.due_date'), render: (b) => b.due_date ? <bdi dir="ltr">{formatDate(b.due_date as string)}</bdi> : '—' },
    { key: 'amt', header: t('purchasing.total_amount'), align: 'end', render: (b) => <bdi dir="ltr" className="sb-dash-num">{fmt(Number(b.total_amount))}</bdi> },
    {
      key: 'status', header: '',
      render: (b) => (
        <PayBadge
          status={b.status}
          total={Number(b.total_amount ?? 0)}
          applied={(appliedMap[b.id] ?? 0) + (tdsMap[b.id] ?? 0)}
          dueDate={(b.due_date as string) ?? null}
          today={today}
        />
      ),
    },
  ];

  // Ocean Teal (UI v1.1): look only — same bills, search, period, status
  // chips, voided toggle, paid badges and pagination as before.
  return (
    <OceanPage
      testid="vendor-bills-ocean"
      title={t('purchasing.bills_title')}
      subtitle={t('purchOcean.bills_count', { count: filtered.length })}
      actions={<button type="button" className="sb-primary-btn sb-btn-inline" onClick={() => navigate('/purchasing/bills/new')}><Plus size={18} aria-hidden="true" />{t('purchasing.new_bill')}</button>}
      below={!isLoading && bills.length > 0 ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginTop: 14 }}>
          <div className="sb-inv-filters">
            <ListFilters
              search={search}
              onSearch={(v) => { setSearch(v); setPage(1); }}
              searchPlaceholder={t('purchasing.search_bills') || 'Search bill # or supplier…'}
              storageKey="stockbolt.list.vendor-bills.period"
              onDateFrom={(v) => { setDateFrom(v); setPage(1); }}
              onDateTo={(v) => { setDateTo(v); setPage(1); }}
            />
          </div>
          <div className="sb-chips" style={{ marginTop: 0 }} role="group" aria-label={t('purchasing.status')}>
            {['', 'draft', 'confirmed', 'void'].map(s => (
              <button key={s} type="button" aria-pressed={statusFilter === s} className={`sb-chip ${statusFilter === s ? 'active' : ''}`}
                onClick={() => { setStatusFilter(s); setPage(1); }}>
                {s === '' ? t('common.all') : t(`docStatus.${s}`)}
              </button>
            ))}
            {/* Z4 — only meaningful on the All view; picking the Void chip
                is already an explicit request to see them. */}
            {!statusFilter && (
              <VoidedToggle hideVoided={hideVoided} onChange={(v) => { setHideVoided(v); setPage(1); }} count={voidedCount} />
            )}
          </div>
        </div>
      ) : undefined}
    >
      {isLoading ? (
        <div className="sb-card sb-empty">{t('common.loading')}</div>
      ) : (
        <>
          <OceanTable columns={columns} rows={paged} keyFn={(b) => b.id} cardTitleKey="sup"
            onRowClick={(b) => navigate(`/purchasing/bills/${b.id}`)} rowMuted={(b) => b.status === 'void'} emptyMessage={t('purchasing.no_bills')} />
          {filtered.length > 0 && <Pagination page={page} pageSize={PAGE_SIZE} total={filtered.length} onChange={setPage} />}
        </>
      )}
    </OceanPage>
  );
}
