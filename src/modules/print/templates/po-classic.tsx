/**
 * POClassicTemplate — A4 purchase order layout
 */
import type { Company, ContactRow, PurchaseOrderRow, PurchaseOrderItemRow, PrintConfig } from '@/data/adapter';
import { PrintHeader, PrintLineTable, PrintTotals, PrintFooter } from './_shared';
import { getTaxLabels } from '@/lib/locale';

interface Props {
  company:     Company;
  printConfig: PrintConfig;
  po:          PurchaseOrderRow;
  items:       PurchaseOrderItemRow[];
  contact:     ContactRow | null;
}

export function POClassicTemplate({ company, printConfig, po, items, contact }: Props) {
  const accentStyle = { color: printConfig.accent_color };

  return (
    <div className="mx-auto max-w-[210mm] bg-white p-[14mm] font-sans text-[11pt] text-gray-900 print:p-0">
      <PrintHeader company={company} accentColor={printConfig.accent_color} />

      <div className="mt-6 flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold" style={accentStyle}>PURCHASE ORDER</h1>
          <div className="mt-1 text-sm">
            <span className="font-medium text-gray-800">#{po.po_number}</span>
          </div>
        </div>
        <div className="text-right text-sm">
          <div><span className="text-gray-500">Date: </span><span className="font-medium">{po.date}</span></div>
          {po.expected_delivery_date && (
            <div><span className="text-gray-500">Expected Delivery: </span><span className="font-medium">{po.expected_delivery_date}</span></div>
          )}
          {po.reference && (
            <div><span className="text-gray-500">Reference: </span><span className="font-medium">{po.reference}</span></div>
          )}
          <div><span className="text-gray-500">Currency: </span><span className="font-medium">{po.currency}</span></div>
        </div>
      </div>

      {/* To (supplier) */}
      <div className="mt-5 grid grid-cols-2 gap-6">
        <div>
          <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-gray-500">To (Supplier)</div>
          <div className="rounded border border-gray-200 p-3 text-sm">
            <div className="font-semibold">{contact?.name ?? '—'}</div>
            {contact?.name_ar && <div className="text-gray-600">{contact.name_ar}</div>}
            {contact?.tax_id && <div className="text-gray-600 text-xs">TRN: {contact.tax_id}</div>}
            {contact?.phone && <div className="text-gray-600">{contact.phone}</div>}
            {contact?.email && <div className="text-gray-600">{contact.email}</div>}
          </div>
        </div>
        <div>
          <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-gray-500">Ship To</div>
          <div className="rounded border border-gray-200 p-3 text-sm">
            <div className="font-semibold">{company.name}</div>
            {(company as unknown as { address?: string }).address && (
              <div className="text-gray-600">{(company as unknown as { address?: string }).address}</div>
            )}
          </div>
        </div>
      </div>

      {/* Line Items */}
      <div className="mt-6">
        <PrintLineTable items={items} accentColor={printConfig.accent_color} type="po" />
      </div>

      {/* Totals */}
      <div className="mt-4 flex justify-end">
        <PrintTotals
          subtotal={(po as unknown as { subtotal?: number }).subtotal ?? 0}
          discount={po.discount_amount ?? 0}
          tax={po.tax_amount ?? 0}
          total={po.total_amount ?? 0}
          currency={po.currency}
          accentColor={printConfig.accent_color}
          taxLabel={getTaxLabels(company.country_code).taxName}
        />
      </div>

      {po.notes && (
        <div className="mt-5 rounded border border-gray-200 p-3 text-sm">
          <div className="mb-1 font-semibold text-gray-600">Notes / Terms</div>
          <div className="text-gray-700 whitespace-pre-wrap">{po.notes}</div>
        </div>
      )}

      {/* Signature area */}
      <div className="mt-8 grid grid-cols-2 gap-8 text-sm text-gray-500">
        <div className="border-t pt-2">Authorised By</div>
        <div className="border-t pt-2 text-right">Supplier Acknowledgement</div>
      </div>

      <PrintFooter
        footerText={printConfig.footer_en}
        accentColor={printConfig.accent_color}
        showBankDetails={false}
      />
    </div>
  );
}
