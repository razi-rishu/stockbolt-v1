import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { getAdapter } from '@/data/index';
import { useAuthStore } from '@/store/auth';
import { Button } from '@/ui/button';
import { Badge } from '@/ui/badge';
import { Pagination, paginate } from '@/ui/pagination';
import { PageHeader } from '@/ui/primitives';
import { theme } from '@/ui/theme';
import type { VendorBillRow, ContactRow } from '@/data/adapter';

const PAGE_SIZE = 50;

const statusColor: Record<string, string> = {
  draft: 'muted', confirmed: 'success', void: 'danger',
};

export default function VendorBillsPage() {
  const { t } = useTranslation();
  const { company_id } = useAuthStore();
  const navigate = useNavigate();
  const [page, setPage] = useState(1);

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

  const paged = paginate(bills, page, PAGE_SIZE);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
      <PageHeader
        title={t('purchasing.bills_title')}
        subtitle={`${bills.length} ${bills.length === 1 ? 'bill' : 'bills'}`}
        actions={<Button size="sm" onClick={() => navigate('/purchasing/bills/new')}>+ {t('purchasing.new_bill')}</Button>}
      />
      {isLoading ? (
        <div style={{ padding: '48px 0', textAlign: 'center', fontSize: '13px', color: theme.inkFaint }}>{t('common.loading')}</div>
      ) : bills.length === 0 ? (
        <div style={{ padding: '48px 0', textAlign: 'center', fontSize: '13px', color: theme.inkFaint }}>{t('purchasing.no_bills')}</div>
      ) : (
        <div
          className="overflow-x-auto bg-white"
          style={{ border: `1px solid ${theme.border}`, borderRadius: '12px', boxShadow: theme.shadowSm }}
        >
          <table className="w-full text-sm">
            <thead>
              <tr style={{ background: theme.panelHead, borderBottom: `1px solid ${theme.border}` }}>
                {[
                  { l: t('purchasing.bill_number'),  a: 'start' as const },
                  { l: t('purchasing.supplier'),     a: 'start' as const },
                  { l: t('purchasing.date'),         a: 'start' as const },
                  { l: t('purchasing.due_date'),     a: 'start' as const },
                  { l: t('purchasing.total_amount'), a: 'end'   as const },
                  { l: t('purchasing.status'),       a: 'center'as const },
                ].map((c) => (
                  <th
                    key={c.l}
                    className="px-4 py-3 font-semibold"
                    style={{
                      fontSize: '11px', color: theme.inkMuted,
                      textTransform: 'uppercase', letterSpacing: '.06em',
                      textAlign: c.a,
                    }}
                  >{c.l}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {paged.map((bill, idx) => (
                <tr
                  key={bill.id}
                  onClick={() => navigate(`/purchasing/bills/${bill.id}`)}
                  className="cursor-pointer"
                  style={{
                    borderTop: idx === 0 ? 'none' : `1px solid #f1f5f9`,
                    transition: 'background-color .12s',
                  }}
                  onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = theme.panelHead; }}
                  onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = ''; }}
                >
                  <td className="px-4 py-3 font-mono" style={{ fontSize: '12px', color: theme.brandSoftText, fontWeight: 600 }}>{bill.bill_number}</td>
                  <td className="px-4 py-3" style={{ color: theme.ink, fontSize: '13px' }}>{supplierName(bill.supplier_id)}</td>
                  <td className="px-4 py-3" style={{ color: theme.inkMuted, fontSize: '13px' }}>{bill.date as string}</td>
                  <td className="px-4 py-3" style={{ color: theme.inkMuted, fontSize: '13px' }}>{(bill.due_date as string | null) ?? '—'}</td>
                  <td className="px-4 py-3 font-mono" style={{ textAlign: 'end', color: theme.ink, fontSize: '13px' }}>
                    {Number(bill.total_amount).toLocaleString('en-US', { minimumFractionDigits: 2 })}
                  </td>
                  <td className="px-4 py-3" style={{ textAlign: 'center' }}>
                    <Badge variant={statusColor[bill.status] as 'muted' | 'success' | 'danger'}>{bill.status}</Badge>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <Pagination
            page={page}
            pageSize={PAGE_SIZE}
            total={bills.length}
            onChange={setPage}
            className="border-t"
          />
        </div>
      )}
    </div>
  );
}
