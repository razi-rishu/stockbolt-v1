/**
 * InvoiceClassicTemplate — professional A4 invoice layout
 */
import type { Company, ContactRow, InvoiceRow, InvoiceItemRow, PrintConfig } from '@/data/adapter';
import { PrintHeader, PrintFooter, PrintLineTable, PrintTotals } from './_shared';
import { getTaxLabels } from '@/lib/locale';

interface Props {
  company:     Company;
  printConfig: PrintConfig;
  invoice:     InvoiceRow;
  items:       InvoiceItemRow[];
  contact:     ContactRow | null;
}

export function InvoiceClassicTemplate({ company, printConfig, invoice, items, contact }: Props) {
  const accentStyle = { color: printConfig.accent_color };

  return (
    <div className="mx-auto max-w-[210mm] bg-white p-[14mm] font-sans text-[11pt] text-gray-900 print:p-0">
      {/* Header */}
      <PrintHeader company={company} accentColor={printConfig.accent_color} />

      {/* Document title + meta */}
      <div className="mt-6 flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold" style={accentStyle}>INVOICE</h1>
          <div className="mt-1 text-sm text-gray-500">
            <span className="font-medium text-gray-800">#{invoice.invoice_number}</span>
          </div>
        </div>
        <div className="text-right text-sm">
          <div><span className="text-gray-500">Date: </span><span className="font-medium">{invoice.date}</span></div>
          {printConfig.show_due_date && invoice.due_date && (
            <div><span className="text-gray-500">Due Date: </span><span className="font-medium">{invoice.due_date}</span></div>
          )}
          {invoice.reference && (
            <div><span className="text-gray-500">Reference: </span><span className="font-medium">{invoice.reference}</span></div>
          )}
          <div><span className="text-gray-500">Currency: </span><span className="font-medium">{invoice.currency}</span></div>
        </div>
      </div>

      {/* Bill To */}
      <div className="mt-5 grid grid-cols-2 gap-6">
        <div>
          <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-gray-500">Bill To</div>
          <div className="rounded border border-gray-200 p-3 text-sm">
            <div className="font-semibold">{contact?.name ?? '—'}</div>
            {contact?.name_ar && <div className="text-gray-600">{contact.name_ar}</div>}
            {contact?.tax_id && <div className="text-gray-600">TRN: {contact.tax_id}</div>}
            {contact?.phone && <div className="text-gray-600">{contact.phone}</div>}
            {contact?.email && <div className="text-gray-600">{contact.email}</div>}
          </div>
        </div>
        <div>
          <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-gray-500">From</div>
          <div className="rounded border border-gray-200 p-3 text-sm">
            <div className="font-semibold">{company.name}</div>
            {(company as unknown as { name_ar?: string }).name_ar && (
              <div className="text-gray-600">{(company as unknown as { name_ar?: string }).name_ar}</div>
            )}
            {(company as unknown as { tax_id?: string }).tax_id && (
              <div className="text-gray-600">TRN: {(company as unknown as { tax_id?: string }).tax_id}</div>
            )}
            {(company as unknown as { address?: string }).address && (
              <div className="text-gray-600">{(company as unknown as { address?: string }).address}</div>
            )}
          </div>
        </div>
      </div>

      {/* Line Items */}
      <div className="mt-6">
        <PrintLineTable items={items} accentColor={printConfig.accent_color} type="invoice" />
      </div>

      {/* Totals */}
      <div className="mt-4 flex justify-end">
        <PrintTotals
          subtotal={(invoice as unknown as { subtotal?: number }).subtotal ?? 0}
          discount={invoice.discount_amount ?? 0}
          tax={invoice.tax_amount ?? 0}
          total={invoice.total_amount ?? 0}
          currency={invoice.currency}
          accentColor={printConfig.accent_color}
          taxLabel={getTaxLabels(company.country_code).taxName}
        />
      </div>

      {/* Notes */}
      {invoice.notes && (
        <div className="mt-5 rounded border border-gray-200 p-3 text-sm">
          <div className="mb-1 font-semibold text-gray-600">Notes</div>
          <div className="text-gray-700 whitespace-pre-wrap">{invoice.notes}</div>
        </div>
      )}

      {/* Footer */}
      <PrintFooter
        footerText={printConfig.footer_en}
        accentColor={printConfig.accent_color}
        showBankDetails={printConfig.show_bank_details}
      />

      {/* Status watermark for voided invoices */}
      {invoice.status === 'voided' && (
        <div
          className="pointer-events-none fixed inset-0 flex items-center justify-center opacity-10"
          style={{ transform: 'rotate(-30deg)' }}
        >
          <span className="text-8xl font-black text-red-600">VOID</span>
        </div>
      )}
    </div>
  );
}
