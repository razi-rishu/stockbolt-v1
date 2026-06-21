import { useState } from 'react';
import { formatDate } from '@/lib/locale';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { getAdapter } from '@/data/index';
import { useAuthStore } from '@/store/auth';
import { Button } from '@/ui/button';
import { Badge } from '@/ui/badge';
import { Pagination, paginate } from '@/ui/pagination';
import { PageHeader } from '@/ui/primitives';
import { theme } from '@/ui/theme';
import type { PurchaseOrderRow, ContactRow } from '@/data/adapter';

const PAGE_SIZE = 50;

const statusColor: Record<string, string> = {
  draft: 'muted', sent: 'brand', partially_received: 'warning',
  received: 'success', closed: 'muted', void: 'danger',
};

export default function PurchaseOrdersPage() {
  const { t } = useTranslation();
  const { company_id } = useAuthStore();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [page, setPage] = useState(1);
  const [converting, setConverting] = useState<string | null>(null);

  const { data: orders = [], isLoading } = useQuery<PurchaseOrderRow[]>({
    queryKey: ['purchase_orders', company_id],
    queryFn: () => getAdapter().purchaseOrders.list(company_id!),
    enabled: !!company_id,
  });
  const { data: suppliers = [] } = useQuery<ContactRow[]>({
    queryKey: ['contacts', company_id, 'supplier'],
    queryFn: () => getAdapter().contacts.list(company_id!, 'supplier'),
    enabled: !!company_id,
  });
  const supplierName = (id: string) => suppliers.find(s => s.id === id)?.name ?? `${id.slice(0, 8)}…`;

  // Phase 12.47 — quick convert from the row, no need to open the PO first.
  const convertMutation = useMutation({
    mutationFn: (po_id: string) => getAdapter().purchaseOrders.convertToBill(po_id),
    onSuccess: (bill) => {
      qc.invalidateQueries({ queryKey: ['vendor_bills',    company_id] });
      qc.invalidateQueries({ queryKey: ['purchase_orders', company_id] });
      navigate(`/purchasing/bills/${bill.id}`);
    },
    onSettled: () => setConverting(null),
  });

  const paged = paginate(orders, page, PAGE_SIZE);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
      <PageHeader
        title={t('purchasing.po_title')}
        subtitle={`${orders.length} ${orders.length === 1 ? 'order' : 'orders'}`}
        actions={<Button size="sm" onClick={() => navigate('/purchasing/orders/new')}>+ {t('purchasing.new_po')}</Button>}
      />
      {isLoading ? (
        <div style={{ padding: '48px 0', textAlign: 'center', fontSize: '13px', color: theme.inkFaint }}>{t('common.loading')}</div>
      ) : orders.length === 0 ? (
        <div style={{ padding: '48px 0', textAlign: 'center', fontSize: '13px', color: theme.inkFaint }}>{t('purchasing.no_pos')}</div>
      ) : (
        <div
          className="overflow-x-auto bg-white"
          style={{ border: `1px solid ${theme.border}`, borderRadius: '12px', boxShadow: theme.shadowSm }}
        >
          <table className="w-full text-sm">
            <thead>
              <tr style={{ background: theme.panelHead, borderBottom: `1px solid ${theme.border}` }}>
                {[
                  { l: t('purchasing.po_number'),    a: 'start'  as const },
                  { l: t('purchasing.supplier'),     a: 'start'  as const },
                  { l: t('purchasing.date'),         a: 'start'  as const },
                  { l: t('purchasing.total_amount'), a: 'end'    as const },
                  { l: t('purchasing.status'),       a: 'center' as const },
                  { l: '',                           a: 'end'    as const },
                ].map((c, i) => (
                  <th key={i} className="px-4 py-3"
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
              {paged.map((po, idx) => {
                // Phase 12.48 — POs stay in 'draft' for the whole flow
                // (no UI "Send" step) so converting from draft is fine.
                // Only block terminal states.
                const canConvert = !['closed', 'void'].includes(po.status);
                const isThisConverting = converting === po.id && convertMutation.isPending;
                return (
                  <tr
                    key={po.id}
                    onClick={() => navigate(`/purchasing/orders/${po.id}`)}
                    className="cursor-pointer"
                    style={{
                      borderTop: idx === 0 ? 'none' : '1px solid #f1f5f9',
                      transition: 'background-color .12s',
                    }}
                    onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = theme.panelHead; }}
                    onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = ''; }}
                  >
                    <td className="px-4 py-3 font-mono" style={{ fontSize: '12px', color: theme.brandSoftText, fontWeight: 600 }}>{po.po_number}</td>
                    <td className="px-4 py-3" style={{ color: theme.ink, fontSize: '13px' }}>{supplierName(po.supplier_id)}</td>
                    <td className="px-4 py-3" style={{ color: theme.inkMuted, fontSize: '13px' }}>{formatDate(po.date as string)}</td>
                    <td className="px-4 py-3 font-mono" style={{ textAlign: 'end', color: theme.ink, fontSize: '13px' }}>
                      {Number(po.total_amount).toLocaleString('en-US', { minimumFractionDigits: 2 })}
                    </td>
                    <td className="px-4 py-3" style={{ textAlign: 'center' }}>
                      <Badge variant={statusColor[po.status] as 'muted' | 'brand' | 'warning' | 'success' | 'danger'}>{po.status}</Badge>
                    </td>
                    <td className="px-4 py-3" style={{ textAlign: 'end' }}>
                      {canConvert && (
                        <button
                          type="button"
                          onClick={(e) => { e.stopPropagation(); setConverting(po.id); convertMutation.mutate(po.id); }}
                          disabled={isThisConverting}
                          style={{
                            fontSize: '11px', fontWeight: 600,
                            color: theme.brand, background: 'transparent',
                            border: 'none', cursor: isThisConverting ? 'wait' : 'pointer',
                            padding: '4px 8px', borderRadius: '6px',
                            opacity: isThisConverting ? 0.6 : 1,
                          }}
                          onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = theme.brandSoft; }}
                          onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = 'transparent'; }}
                        >
                          {isThisConverting ? 'Converting…' : 'Convert to Bill →'}
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <Pagination
            page={page}
            pageSize={PAGE_SIZE}
            total={orders.length}
            onChange={setPage}
            className="border-t"
          />
        </div>
      )}
    </div>
  );
}
