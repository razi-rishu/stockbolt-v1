/**
 * QuoteClassicTemplate — A4 quotation / proforma layout
 */
import type { Company, ContactRow, SalesQuoteRow, SalesQuoteItemRow, PrintConfig } from '@/data/adapter';
import { PrintHeader, PrintLineTable, PrintTotals, PrintFooter } from './_shared';
import { getTaxLabels } from '@/lib/locale';

interface Props {
  company:     Company;
  printConfig: PrintConfig;
  quote:       SalesQuoteRow;
  items:       SalesQuoteItemRow[];
  contact:     ContactRow | null;
}

export function QuoteClassicTemplate({ company, printConfig, quote, items, contact }: Props) {
  const accentStyle = { color: printConfig.accent_color };

  return (
    <div className="mx-auto max-w-[210mm] bg-white p-[14mm] font-sans text-[11pt] text-gray-900 print:p-0">
      <PrintHeader company={company} accentColor={printConfig.accent_color} />

      <div className="mt-6 flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold" style={accentStyle}>QUOTATION</h1>
          <div className="mt-1 text-sm">
            <span className="font-medium text-gray-800">#{quote.quote_number}</span>
          </div>
        </div>
        <div className="text-right text-sm">
          <div><span className="text-gray-500">Date: </span><span className="font-medium">{quote.date}</span></div>
          {quote.expiry_date && (
            <div><span className="text-gray-500">Valid Until: </span><span className="font-medium">{quote.expiry_date}</span></div>
          )}
          {quote.reference && (
            <div><span className="text-gray-500">Reference: </span><span className="font-medium">{quote.reference}</span></div>
          )}
          <div><span className="text-gray-500">Currency: </span><span className="font-medium">{quote.currency}</span></div>
        </div>
      </div>

      {/* Quote To */}
      <div className="mt-5">
        <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-gray-500">Quote To</div>
        <div className="rounded border border-gray-200 p-3 text-sm inline-block min-w-48">
          <div className="font-semibold">{contact?.name ?? '—'}</div>
          {contact?.name_ar && <div className="text-gray-600">{contact.name_ar}</div>}
          {contact?.phone && <div className="text-gray-600">{contact.phone}</div>}
          {contact?.email && <div className="text-gray-600">{contact.email}</div>}
        </div>
      </div>

      {/* Line Items */}
      <div className="mt-6">
        <PrintLineTable items={items} accentColor={printConfig.accent_color} type="quote" />
      </div>

      {/* Totals */}
      <div className="mt-4 flex justify-end">
        <PrintTotals
          subtotal={(quote as unknown as { subtotal?: number }).subtotal ?? 0}
          discount={quote.discount_amount ?? 0}
          tax={quote.tax_amount ?? 0}
          total={quote.total_amount ?? 0}
          currency={quote.currency}
          accentColor={printConfig.accent_color}
          taxLabel={getTaxLabels(company.country_code).taxName}
        />
      </div>

      {/* Terms */}
      {quote.notes && (
        <div className="mt-5 rounded border border-gray-200 p-3 text-sm">
          <div className="mb-1 font-semibold text-gray-600">Terms & Notes</div>
          <div className="text-gray-700 whitespace-pre-wrap">{quote.notes}</div>
        </div>
      )}

      {/* Validity notice */}
      {quote.expiry_date && (
        <div className="mt-4 text-xs text-gray-500 italic">
          This quotation is valid until {quote.expiry_date}. Prices are subject to change after expiry.
        </div>
      )}

      {/* Signature area */}
      <div className="mt-8 grid grid-cols-2 gap-8 text-sm text-gray-500">
        <div className="border-t pt-2">Authorised Signature</div>
        <div className="border-t pt-2 text-right">Customer Acceptance</div>
      </div>

      <PrintFooter
        footerText={printConfig.footer_en}
        accentColor={printConfig.accent_color}
        showBankDetails={false}
      />
    </div>
  );
}
