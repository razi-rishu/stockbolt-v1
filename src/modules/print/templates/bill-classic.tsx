/**
 * BillClassicTemplate — A4 vendor bill / invoice received layout
 */
import type { Company, ContactRow, VendorBillRow, VendorBillItemRow, PrintConfig } from '@/data/adapter';
import { PrintHeader, PrintLineTable, PrintTotals, PrintFooter } from './_shared';

interface Props {
  company:     Company;
  printConfig: PrintConfig;
  bill:        VendorBillRow;
  items:       VendorBillItemRow[];
  contact:     ContactRow | null;
}

export function BillClassicTemplate({ company, printConfig, bill, items, contact }: Props) {
  const accentStyle = { color: printConfig.accent_color };

  return (
    <div className="mx-auto max-w-[210mm] bg-white p-[14mm] font-sans text-[11pt] text-gray-900 print:p-0">
      <PrintHeader company={company} accentColor={printConfig.accent_color} />

      <div className="mt-6 flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold" style={accentStyle}>VENDOR BILL</h1>
          <div className="mt-1 text-sm">
            <span className="font-medium text-gray-800">#{bill.bill_number}</span>
          </div>
        </div>
        <div className="text-right text-sm">
          <div><span className="text-gray-500">Date: </span><span className="font-medium">{bill.date}</span></div>
          {bill.due_date && (
            <div><span className="text-gray-500">Due Date: </span><span className="font-medium">{bill.due_date}</span></div>
          )}
          {bill.supplier_bill_number && (
            <div><span className="text-gray-500">Supplier Ref: </span><span className="font-medium">{bill.supplier_bill_number}</span></div>
          )}
          <div><span className="text-gray-500">Currency: </span><span className="font-medium">{bill.currency}</span></div>
        </div>
      </div>

      {/* From (supplier) / To (us) */}
      <div className="mt-5 grid grid-cols-2 gap-6">
        <div>
          <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-gray-500">From (Supplier)</div>
          <div className="rounded border border-gray-200 p-3 text-sm">
            <div className="font-semibold">{contact?.name ?? '—'}</div>
            {contact?.name_ar && <div className="text-gray-600">{contact.name_ar}</div>}
            {contact?.tax_id && <div className="text-gray-600 text-xs">TRN: {contact.tax_id}</div>}
          </div>
        </div>
        <div>
          <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-gray-500">Bill To (Us)</div>
          <div className="rounded border border-gray-200 p-3 text-sm">
            <div className="font-semibold">{company.name}</div>
            {(company as unknown as { tax_id?: string }).tax_id && (
              <div className="text-gray-600 text-xs">TRN: {(company as unknown as { tax_id?: string }).tax_id}</div>
            )}
          </div>
        </div>
      </div>

      {/* Line Items */}
      <div className="mt-6">
        <PrintLineTable items={items} accentColor={printConfig.accent_color} type="bill" />
      </div>

      {/* Totals */}
      <div className="mt-4 flex justify-end">
        <PrintTotals
          subtotal={(bill as unknown as { subtotal?: number }).subtotal ?? 0}
          discount={bill.discount_amount ?? 0}
          tax={bill.tax_amount ?? 0}
          total={bill.total_amount ?? 0}
          currency={bill.currency}
          accentColor={printConfig.accent_color}
        />
      </div>

      {bill.notes && (
        <div className="mt-5 rounded border border-gray-200 p-3 text-sm">
          <div className="mb-1 font-semibold text-gray-600">Notes</div>
          <div className="text-gray-700 whitespace-pre-wrap">{bill.notes}</div>
        </div>
      )}

      <PrintFooter
        footerText={printConfig.footer_en}
        accentColor={printConfig.accent_color}
        showBankDetails={false}
      />
    </div>
  );
}
