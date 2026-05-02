import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { useNavigate, useParams } from 'react-router-dom';
import { getAdapter } from '@/data/index';
import { useAuthStore } from '@/store/auth';
import { Input } from '@/ui/input';
import { Button } from '@/ui/button';
import type { ContactRow, InvoiceRow } from '@/data/adapter';

function fmt(n: number) {
  return n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function todayIso() { return new Date().toISOString().slice(0, 10); }
function monthAgoIso() {
  const d = new Date();
  d.setMonth(d.getMonth() - 3);
  return d.toISOString().slice(0, 10);
}

export default function CustomerDetailPage() {
  const { t } = useTranslation();
  const { company_id } = useAuthStore();
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();

  const [from, setFrom] = useState(monthAgoIso);
  const [to, setTo]     = useState(todayIso);

  const { data: contact } = useQuery<ContactRow | null>({
    queryKey: ['contact', id],
    queryFn: () => getAdapter().contacts.getById(id!),
    enabled: !!id,
  });

  const { data: invoices = [] } = useQuery<InvoiceRow[]>({
    queryKey: ['invoices', company_id],
    queryFn: () => getAdapter().invoices.list(company_id!),
    enabled: !!company_id,
  });

  const { data: statement, isLoading: stmtLoading } = useQuery({
    queryKey: ['customer_statement', company_id, id, from, to],
    queryFn: () => getAdapter().reports.getCustomerStatement(company_id!, id!, from, to),
    enabled: !!company_id && !!id,
  });

  const customerInvoices = invoices.filter(inv => inv.contact_id === id);
  const openInvoices = customerInvoices.filter(inv => inv.status === 'confirmed');

  return (
    <div className="space-y-6 pb-16">
      <div className="flex items-center gap-3">
        <button onClick={() => navigate('/contacts/customers')} className="text-sm text-ink-secondary hover:text-ink-primary">
          ← {t('nav.customers')}
        </button>
        <span className="text-ink-tertiary">/</span>
        <h1 className="text-xl font-semibold text-ink-primary">{contact?.name ?? '…'}</h1>
        <div className="ms-auto">
          <Button size="sm" onClick={() => navigate('/sales/invoices/new')}>
            {t('sales.new_invoice')}
          </Button>
        </div>
      </div>

      {/* Contact Info */}
      {contact && (
        <div className="rounded-card border border-border-subtle bg-surface-card p-5">
          <div className="grid grid-cols-2 gap-4 text-sm md:grid-cols-3">
            <div><p className="text-ink-tertiary">{t('contacts.name')}</p><p className="font-medium text-ink-primary">{contact.name}</p></div>
            <div><p className="text-ink-tertiary">{t('contacts.phone')}</p><p className="text-ink-primary">{contact.phone ?? '—'}</p></div>
            <div><p className="text-ink-tertiary">{t('contacts.email')}</p><p className="text-ink-primary">{contact.email ?? '—'}</p></div>
            {contact.tax_id && <div><p className="text-ink-tertiary">{t('contacts.tax_id')}</p><p className="text-ink-primary">{contact.tax_id}</p></div>}
          </div>
        </div>
      )}

      {/* Open invoices summary */}
      {openInvoices.length > 0 && (
        <div className="rounded-card border border-border-subtle bg-surface-card">
          <div className="border-b border-border-subtle px-5 py-3">
            <h2 className="text-sm font-semibold text-ink-primary">{t('sales.open_invoices')}</h2>
          </div>
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border-subtle bg-surface-muted text-xs text-ink-tertiary">
                <th className="px-4 py-2 text-start font-medium">{t('sales.invoice_number')}</th>
                <th className="px-4 py-2 text-start font-medium">{t('sales.date')}</th>
                <th className="px-4 py-2 text-start font-medium">{t('sales.due_date')}</th>
                <th className="px-4 py-2 text-end font-medium">{t('sales.total_amount')}</th>
              </tr>
            </thead>
            <tbody>
              {openInvoices.map(inv => (
                <tr
                  key={inv.id}
                  className="cursor-pointer border-b border-border-subtle last:border-0 hover:bg-surface-muted/50"
                  onClick={() => navigate(`/sales/invoices/${inv.id}`)}
                >
                  <td className="px-4 py-2 font-mono text-xs text-brand-600">{inv.invoice_number}</td>
                  <td className="px-4 py-2 text-ink-secondary">{inv.date}</td>
                  <td className="px-4 py-2 text-ink-secondary">{inv.due_date ?? '—'}</td>
                  <td className="px-4 py-2 text-end font-mono text-ink-primary">{inv.currency} {fmt(Number(inv.total_amount))}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Account Statement */}
      <div className="rounded-card border border-border-subtle bg-surface-card">
        <div className="flex items-center gap-4 border-b border-border-subtle px-5 py-3">
          <h2 className="text-sm font-semibold text-ink-primary">{t('reports.customer_statement')}</h2>
          <div className="ms-auto flex items-center gap-2">
            <Input type="date" value={from} onChange={e => setFrom(e.target.value)} className="h-8 text-xs" />
            <span className="text-ink-tertiary">–</span>
            <Input type="date" value={to} onChange={e => setTo(e.target.value)} className="h-8 text-xs" />
          </div>
        </div>
        {stmtLoading ? (
          <p className="px-5 py-4 text-sm text-ink-secondary">{t('common.loading')}</p>
        ) : !statement || statement.lines.length === 0 ? (
          <p className="px-5 py-4 text-sm text-ink-tertiary">{t('reports.no_transactions')}</p>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border-subtle bg-surface-muted text-xs text-ink-tertiary">
                <th className="px-4 py-2 text-start font-medium">{t('accounting.date')}</th>
                <th className="px-4 py-2 text-start font-medium">{t('reports.doc_type')}</th>
                <th className="px-4 py-2 text-start font-medium">{t('reports.doc_number')}</th>
                <th className="px-4 py-2 text-end font-medium">{t('accounting.debit')}</th>
                <th className="px-4 py-2 text-end font-medium">{t('accounting.credit')}</th>
                <th className="px-4 py-2 text-end font-medium">{t('accounting.balance')}</th>
              </tr>
            </thead>
            <tbody>
              {statement.lines.map((line, i) => (
                <tr key={i} className="border-b border-border-subtle last:border-0">
                  <td className="px-4 py-2 text-ink-secondary">{line.date}</td>
                  <td className="px-4 py-2 text-ink-secondary capitalize">{line.doc_type.replace('_', ' ')}</td>
                  <td className="px-4 py-2 font-mono text-xs text-brand-600">{line.doc_number}</td>
                  <td className="px-4 py-2 text-end font-mono text-ink-primary">{line.debit > 0 ? fmt(line.debit) : '—'}</td>
                  <td className="px-4 py-2 text-end font-mono text-ink-primary">{line.credit > 0 ? fmt(line.credit) : '—'}</td>
                  <td className={`px-4 py-2 text-end font-mono font-medium ${line.balance < 0 ? 'text-red-600' : 'text-ink-primary'}`}>
                    {fmt(Math.abs(line.balance))}{line.balance < 0 ? ' CR' : line.balance > 0 ? ' DR' : ''}
                  </td>
                </tr>
              ))}
              <tr className="border-t-2 border-border-subtle bg-surface-muted font-semibold">
                <td colSpan={5} className="px-4 py-2 text-sm text-ink-primary">{t('reports.closing_balance')}</td>
                <td className={`px-4 py-2 text-end font-mono ${statement.closing_balance < 0 ? 'text-red-600' : 'text-ink-primary'}`}>
                  {fmt(Math.abs(statement.closing_balance))}{statement.closing_balance < 0 ? ' CR' : statement.closing_balance > 0 ? ' DR' : ''}
                </td>
              </tr>
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
