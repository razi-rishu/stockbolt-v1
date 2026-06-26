import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { getAdapter } from '@/data/index';
import { useAuthStore } from '@/store/auth';
import { Input } from '@/ui/input';
import { Select } from '@/ui/select';
import { Button } from '@/ui/button';
import { DocLink } from '@/ui/doc-link';
import type { ContactRow } from '@/data/adapter';

const fmt = (n: number) => n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export default function SupplierStatementPage() {
  const { t } = useTranslation();
  const { company_id } = useAuthStore();
  const today = new Date().toISOString().slice(0, 10);
  const [supplierId, setSupplierId] = useState('');
  const [from, setFrom] = useState(today.slice(0, 7) + '-01');
  const [to, setTo] = useState(today);
  const [triggered, setTriggered] = useState(false);

  const { data: suppliers = [] } = useQuery<ContactRow[]>({
    queryKey: ['contacts', company_id, 'supplier'],
    queryFn: () => getAdapter().contacts.list(company_id!, 'supplier'),
    enabled: !!company_id,
  });

  const { data, isLoading } = useQuery({
    queryKey: ['supplier_statement_report', company_id, supplierId, from, to],
    queryFn: () => getAdapter().reports.getSupplierStatement(company_id!, supplierId, from, to),
    enabled: triggered && !!supplierId && !!company_id,
  });

  const supplierOpts = [{ value: '', label: t('purchasing.select_supplier') }, ...suppliers.map(s => ({ value: s.id, label: s.name }))];

  return (
    <div className="space-y-5">
      <h1 className="text-xl font-semibold text-ink-primary">{t('reports.supplier_statement')}</h1>
      <div className="flex flex-wrap items-end gap-3">
        <div className="w-56">
          <Select label={t('purchasing.supplier')} options={supplierOpts} value={supplierId} onChange={e => setSupplierId(e.target.value)} />
        </div>
        <Input label={t('reports.from_date')} type="date" value={from} onChange={e => setFrom(e.target.value)} />
        <Input label={t('reports.to_date')} type="date" value={to} onChange={e => setTo(e.target.value)} />
        <Button size="sm" onClick={() => setTriggered(true)} disabled={!supplierId}>{t('reports.run')}</Button>
      </div>

      {isLoading && <div className="text-sm text-ink-tertiary">{t('common.loading')}</div>}
      {data && (
        <div className="rounded-card border border-border-subtle bg-surface-card overflow-x-auto">
          <div className="px-5 py-4 border-b border-border-subtle">
            <p className="font-semibold text-ink-primary">{data.contact_name}</p>
            <p className="text-xs text-ink-tertiary">{data.from_date} → {data.to_date}</p>
          </div>
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border-subtle bg-surface-muted text-ink-tertiary text-xs">
                <th className="px-4 py-3 text-start font-medium">{t('reports.date')}</th>
                <th className="px-4 py-3 text-start font-medium">{t('reports.document')}</th>
                <th className="px-4 py-3 text-end font-medium">{t('reports.debit')}</th>
                <th className="px-4 py-3 text-end font-medium">{t('reports.credit')}</th>
                <th className="px-4 py-3 text-end font-medium">{t('reports.balance')}</th>
              </tr>
            </thead>
            <tbody>
              {data.lines.map((line, i) => (
                <tr key={i} className="border-b border-border-subtle last:border-0">
                  <td className="px-4 py-3 text-ink-secondary">{line.date}</td>
                  <td className="px-4 py-3 font-mono text-xs"><DocLink type={line.doc_type} id={line.doc_id ?? null} label={line.doc_number} status={line.is_reversed ? 'reversed' : 'active'} className="font-mono text-xs text-brand-600 hover:underline" /></td>
                  <td className="px-4 py-3 text-end font-mono">{line.debit > 0 ? fmt(line.debit) : '—'}</td>
                  <td className="px-4 py-3 text-end font-mono">{line.credit > 0 ? fmt(line.credit) : '—'}</td>
                  <td className="px-4 py-3 text-end font-mono font-medium">{fmt(line.balance)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="border-t-2 border-border-subtle font-semibold">
                <td colSpan={4} className="px-4 py-3 text-ink-primary">{t('reports.closing_balance')}</td>
                <td className="px-4 py-3 text-end font-mono">{fmt(data.closing_balance)}</td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}
    </div>
  );
}
