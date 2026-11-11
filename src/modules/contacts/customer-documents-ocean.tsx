/**
 * Customer Details → Documents, Ocean Teal design (UI Design System v1.1).
 *
 * Presentation only. The lists are the ones customer-detail.tsx already builds
 * (same queries, same "last 20" limits, same order); every row opens the same
 * document route as before. Header and tabs are shared with the Overview.
 */
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { FileText, FileSpreadsheet, Receipt, FileMinus, Undo2 } from 'lucide-react';
import { formatDate } from '@/lib/locale';
import { StatusBadge } from '@/ui/status-badge';
import { CustomerHeroOcean, CustomerTabsOcean, type Tab } from './customer-overview-ocean';
import type { ContactRow, InvoiceRow, PaymentRow, SalesQuoteRow, CreditNoteRow, SalesReturnRow } from '@/data/adapter';
import '@/styles/stockbolt-ocean-teal.css';

export interface CustomerDocumentsOceanProps {
  id: string;
  contact: ContactRow | null | undefined;
  openCount: number;
  invoices: InvoiceRow[];
  quotes: SalesQuoteRow[];
  receipts: PaymentRow[];
  creditNotes: CreditNoteRow[];
  salesReturns: SalesReturnRow[];
  invoiceById: Record<string, InvoiceRow>;
  onTab: (tab: Tab) => void;
  fmt: (n: number) => string;
}

export interface DocRow {
  key: string;
  to: string;
  number: string;
  date: string;
  status: string;
  /** Right-hand figure, already formatted with its currency; null = none. */
  amount: string | null;
  /** Extra line under the date (sales returns). */
  extra?: string | null;
}

export function DocSection({ icon, title, rows, empty }: { icon: React.ReactNode; title: string; rows: DocRow[]; empty: string }) {
  const navigate = useNavigate();
  return (
    <section className="sb-card sb-list" aria-label={title}>
      <div className="sb-list-head sb-section-head">
        <span className="sb-doc-title"><span className="sb-icon" aria-hidden="true">{icon}</span>{title}</span>
        <span className="sb-tab-count">{rows.length}</span>
      </div>
      {rows.length === 0 ? (
        <div className="sb-empty">{empty}</div>
      ) : rows.map(r => (
        <div key={r.key} className="sb-row" role="link" tabIndex={0}
          onClick={() => navigate(r.to)}
          onKeyDown={e => { if (e.key === 'Enter') navigate(r.to); }}>
          <div style={{ minWidth: 0 }}>
            <div className="sb-row-no"><bdi dir="ltr">{r.number}</bdi></div>
            <div className="sb-row-meta">{formatDate(r.date)}{r.extra ? ` · ${r.extra}` : ''}</div>
          </div>
          <div className="sb-row-side">
            {r.amount && <div className="sb-row-amt"><bdi dir="ltr">{r.amount}</bdi></div>}
            <StatusBadge status={r.status} />
          </div>
        </div>
      ))}
    </section>
  );
}

export function CustomerDocumentsOcean(p: CustomerDocumentsOceanProps) {
  const { t } = useTranslation();
  const money = (ccy: string | null | undefined, n: number) => `${ccy ?? ''} ${p.fmt(n)}`.trim();
  const d = (v: unknown) => v as unknown as string;

  const docsCount = p.invoices.length + p.quotes.length + p.receipts.length + p.creditNotes.length + p.salesReturns.length;

  const invoices: DocRow[] = p.invoices.map(inv => ({
    key: inv.id, to: `/sales/invoices/${inv.id}`, number: inv.invoice_number, date: d(inv.date),
    status: inv.status, amount: money(inv.currency, Number(inv.total_amount)),
  }));
  const quotes: DocRow[] = p.quotes.map(q => ({
    key: q.id, to: `/sales/quotes/${q.id}`, number: q.quote_number, date: d(q.date),
    status: q.status, amount: money(q.currency, Number(q.total_amount)),
  }));
  const receipts: DocRow[] = p.receipts.map(r => ({
    key: r.id, to: `/sales/payments/${r.id}`, number: r.payment_number, date: d(r.date),
    status: r.status, amount: money(r.currency, Number(r.amount)),
  }));
  // Same 20-row cap the old table applied to credit notes.
  const creditNotes: DocRow[] = p.creditNotes.slice(0, 20).map(cn => ({
    key: cn.id, to: `/sales/credit-notes/${cn.id}`, number: cn.credit_note_number, date: d(cn.date),
    status: cn.status, amount: money(cn.currency, Number(cn.total_amount)),
  }));
  // Returns are tracking documents (the money is on the linked credit note):
  // no amount, but the linked invoice and the reason, as before.
  const returns: DocRow[] = p.salesReturns.map(sr => {
    const inv = p.invoiceById[sr.invoice_id];
    const reason = (sr.reason ?? '').replace(/_/g, ' ');
    return {
      key: sr.id, to: `/sales/returns/${sr.id}`, number: sr.return_number, date: d(sr.date),
      status: sr.status, amount: null,
      extra: [inv?.invoice_number ? `${t('customer360.linked_invoice')} ${inv.invoice_number}` : null, reason || null].filter(Boolean).join(' · '),
    };
  });

  return (
    <div className="sb-ocean sb-page" data-testid="customer-documents-ocean">
      <CustomerHeroOcean id={p.id} contact={p.contact} />
      <div className="sb-body">
        <CustomerTabsOcean active="docs" openCount={p.openCount} docsCount={docsCount} onTab={p.onTab} />
        <DocSection icon={<FileText size={20} />} title={t('customer360.docs_invoices')} rows={invoices} empty={t('customer360.docs_none_invoices')} />
        <DocSection icon={<FileSpreadsheet size={20} />} title={t('customer360.docs_quotes')} rows={quotes} empty={t('customer360.docs_none_quotes')} />
        <DocSection icon={<Receipt size={20} />} title={t('customer360.docs_receipts')} rows={receipts} empty={t('customer360.docs_none_receipts')} />
        <DocSection icon={<FileMinus size={20} />} title={t('customer360.docs_credit_notes')} rows={creditNotes} empty={t('customer360.docs_none_credit_notes')} />
        <DocSection icon={<Undo2 size={20} />} title={t('customer360.docs_sales_returns')} rows={returns} empty={t('customer360.docs_none_sales_returns')} />
      </div>
    </div>
  );
}
