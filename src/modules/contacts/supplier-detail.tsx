import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { useParams, Link } from 'react-router-dom';
import { getAdapter } from '@/data/index';
import { useAuthStore } from '@/store/auth';
import { Input } from '@/ui/input';
import { Button } from '@/ui/button';

const fmt = (n: number) => n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export default function SupplierDetailPage() {
  const { t } = useTranslation();
  const { id } = useParams<{ id: string }>();
  const { company_id } = useAuthStore();
  const today = new Date().toISOString().slice(0, 10);
  const monthStart = today.slice(0, 7) + '-01';

  const [from, setFrom] = useState(monthStart);
  const [to, setTo] = useState(today);
  const [stmtTriggered, setStmtTriggered] = useState(false);

  const { data: contact } = useQuery({
    queryKey: ['contact', id],
    queryFn: () => getAdapter().contacts.getById(id!),
    enabled: !!id,
  });

  const { data: openBills = [] } = useQuery({
    queryKey: ['vendor_bills_open', id],
    queryFn: () => getAdapter().vendorBills.list(company_id!, 'confirmed'),
    enabled: !!company_id,
    select: bills => bills.filter(b => b.supplier_id === id),
  });

  const { data: statement, isLoading: stmtLoading } = useQuery({
    queryKey: ['supplier_statement', id, from, to],
    queryFn: () => getAdapter().reports.getSupplierStatement(company_id!, id!, from, to),
    enabled: stmtTriggered && !!company_id,
  });

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <Link to="/contacts/suppliers" className="text-sm text-ink-secondary hover:text-ink-primary">
          ← {t('contacts.suppliers')}
        </Link>
        <span className="text-ink-tertiary">/</span>
        <h1 className="text-xl font-semibold text-ink-primary">{contact?.name ?? '…'}</h1>
      </div>

      {contact && (
        <div className="rounded-card border border-border-subtle bg-surface-card p-5 grid grid-cols-2 gap-3 text-sm md:grid-cols-3">
          <div><span className="text-ink-tertiary">{t('contacts.phone')}: </span>{contact.phone ?? '—'}</div>
          <div><span className="text-ink-tertiary">{t('contacts.email')}: </span>{contact.email ?? '—'}</div>
          <div><span className="text-ink-tertiary">{t('contacts.tax_id')}: </span>{contact.tax_id ?? '—'}</div>
          <div><span className="text-ink-tertiary">{t('contacts.currency')}: </span>{contact.currency ?? '—'}</div>
          <div><span className="text-ink-tertiary">{t('contacts.payment_terms')}: </span>{contact.payment_terms_days != null ? `${contact.payment_terms_days}d` : '—'}</div>
        </div>
      )}

      <div className="rounded-card border border-border-subtle bg-surface-card">
        <div className="border-b border-border-subtle px-5 py-3">
          <h2 className="text-sm font-semibold text-ink-primary">{t('purchasing.open_bills')}</h2>
        </div>
        {openBills.length === 0 ? (
          <div className="px-5 py-8 text-center text-sm text-ink-tertiary">{t('purchasing.no_open_bills')}</div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border-subtle bg-surface-muted text-ink-tertiary text-xs">
                <th className="px-4 py-3 text-start font-medium">{t('purchasing.bill_number')}</th>
                <th className="px-4 py-3 text-start font-medium">{t('purchasing.date')}</th>
                <th className="px-4 py-3 text-start font-medium">{t('purchasing.due_date')}</th>
                <th className="px-4 py-3 text-end font-medium">{t('purchasing.total_amount')}</th>
              </tr>
            </thead>
            <tbody>
              {openBills.map(bill => (
                <tr key={bill.id} className="border-b border-border-subtle last:border-0">
                  <td className="px-4 py-3 font-mono text-xs text-brand-700">{bill.bill_number}</td>
                  <td className="px-4 py-3 text-ink-secondary">{bill.date as string}</td>
                  <td className="px-4 py-3 text-ink-secondary">{(bill.due_date as string | null) ?? '—'}</td>
                  <td className="px-4 py-3 text-end font-mono">{fmt(Number(bill.total_amount))}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <div className="rounded-card border border-border-subtle bg-surface-card p-5">
        <h2 className="mb-4 text-sm font-semibold text-ink-primary">{t('purchasing.supplier_statement')}</h2>
        <div className="flex items-end gap-3">
          <Input label={t('reports.from_date')} type="date" value={from} onChange={e => setFrom(e.target.value)} />
          <Input label={t('reports.to_date')} type="date" value={to} onChange={e => setTo(e.target.value)} />
          <Button size="sm" onClick={() => setStmtTriggered(true)}>{t('reports.run')}</Button>
        </div>

        {stmtLoading && <div className="mt-4 text-sm text-ink-tertiary">{t('common.loading')}</div>}
        {statement && (
          <table className="mt-4 w-full text-sm">
            <thead>
              <tr className="border-b border-border-subtle text-ink-tertiary text-xs">
                <th className="py-2 text-start font-medium">{t('reports.date')}</th>
                <th className="py-2 text-start font-medium">{t('reports.document')}</th>
                <th className="py-2 text-end font-medium">{t('reports.debit')}</th>
                <th className="py-2 text-end font-medium">{t('reports.credit')}</th>
                <th className="py-2 text-end font-medium">{t('reports.balance')}</th>
              </tr>
            </thead>
            <tbody>
              {statement.lines.map((line, i) => (
                <tr key={i} className="border-b border-border-subtle last:border-0">
                  <td className="py-2 text-ink-secondary">{line.date}</td>
                  <td className="py-2 font-mono text-xs text-ink-secondary">{line.doc_number}</td>
                  <td className="py-2 text-end font-mono">{line.debit > 0 ? fmt(line.debit) : '—'}</td>
                  <td className="py-2 text-end font-mono">{line.credit > 0 ? fmt(line.credit) : '—'}</td>
                  <td className="py-2 text-end font-mono font-medium">{fmt(line.balance)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="border-t border-border-subtle font-semibold">
                <td colSpan={4} className="py-2 text-ink-primary">{t('reports.closing_balance')}</td>
                <td className="py-2 text-end font-mono">{fmt(statement.closing_balance)}</td>
              </tr>
            </tfoot>
          </table>
        )}
      </div>
    </div>
  );
}
