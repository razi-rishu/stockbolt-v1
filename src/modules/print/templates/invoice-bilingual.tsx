/**
 * InvoiceBilingualTemplate — A4 invoice with English + Arabic side by side
 */
import type { Company, ContactRow, InvoiceRow, InvoiceItemRow, PrintConfig } from '@/data/adapter';
import {
  PrintBilingualHeader, PrintLineTable, PrintBilingualTotals, PrintBilingualFooter,
} from './_shared';
import { getTaxLabels } from '@/lib/locale';

interface Props {
  company:     Company;
  printConfig: PrintConfig;
  invoice:     InvoiceRow;
  items:       InvoiceItemRow[];
  contact:     ContactRow | null;
}

export function InvoiceBilingualTemplate({ company, printConfig, invoice, items, contact }: Props) {
  return (
    <div className="mx-auto max-w-[210mm] bg-white p-[14mm] font-sans text-[11pt] text-gray-900 print:p-0">
      <PrintBilingualHeader
        company={company}
        accentColor={printConfig.accent_color}
        titleEn="INVOICE"
        titleAr="فاتورة ضريبية"
      />

      {/* Doc meta — bilingual */}
      <div className="mt-4 grid grid-cols-2 gap-4 text-sm">
        <div className="rounded border border-gray-200 p-3">
          <div className="flex justify-between">
            <span className="text-gray-500">Invoice # / رقم الفاتورة</span>
            <span className="font-medium">{invoice.invoice_number}</span>
          </div>
          <div className="flex justify-between mt-1">
            <span className="text-gray-500">Date / التاريخ</span>
            <span className="font-medium">{invoice.date}</span>
          </div>
          {printConfig.show_due_date && invoice.due_date && (
            <div className="flex justify-between mt-1">
              <span className="text-gray-500">Due Date / تاريخ الاستحقاق</span>
              <span className="font-medium">{invoice.due_date}</span>
            </div>
          )}
          {invoice.reference && (
            <div className="flex justify-between mt-1">
              <span className="text-gray-500">Reference / المرجع</span>
              <span className="font-medium">{invoice.reference}</span>
            </div>
          )}
        </div>

        {/* Bill To */}
        <div className="rounded border border-gray-200 p-3">
          <div className="text-xs font-semibold uppercase text-gray-500 mb-1">Bill To / فاتورة إلى</div>
          <div className="font-semibold">{contact?.name ?? '—'}</div>
          {contact?.name_ar && (
            <div className="text-gray-600" dir="rtl">{contact.name_ar}</div>
          )}
          {contact?.tax_id && <div className="text-gray-600 text-xs">TRN: {contact.tax_id}</div>}
        </div>
      </div>

      {/* Line Items */}
      <div className="mt-5">
        <PrintLineTable items={items} accentColor={printConfig.accent_color} type="invoice" />
      </div>

      {/* Totals */}
      <div className="mt-4 flex justify-end">
        <PrintBilingualTotals
          subtotal={(invoice as unknown as { subtotal?: number }).subtotal ?? 0}
          discount={invoice.discount_amount ?? 0}
          tax={invoice.tax_amount ?? 0}
          total={invoice.total_amount ?? 0}
          currency={invoice.currency}
          accentColor={printConfig.accent_color}
          taxLabel={getTaxLabels(company.country_code).taxName}
        />
      </div>

      {/* Notes bilingual */}
      {invoice.notes && (
        <div className="mt-5 rounded border border-gray-200 p-3 text-sm">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <div className="mb-1 font-semibold text-gray-600">Notes</div>
              <div className="text-gray-700">{invoice.notes}</div>
            </div>
            <div dir="rtl">
              <div className="mb-1 font-semibold text-gray-600">ملاحظات</div>
              <div className="text-gray-700">{invoice.notes}</div>
            </div>
          </div>
        </div>
      )}

      {/* Signature lines */}
      <div className="mt-8 grid grid-cols-2 gap-8 text-sm text-gray-500">
        <div className="border-t pt-2">
          <div>Authorised Signature / التوقيع المعتمد</div>
        </div>
        <div className="border-t pt-2 text-right" dir="rtl">
          <div>ختم وتوقيع العميل / Customer Stamp & Signature</div>
        </div>
      </div>

      <PrintBilingualFooter
        footerEn={printConfig.footer_en}
        footerAr={printConfig.footer_ar}
        accentColor={printConfig.accent_color}
        showBankDetails={printConfig.show_bank_details}
      />

      {invoice.status === 'voided' && (
        <div
          className="pointer-events-none fixed inset-0 flex items-center justify-center opacity-10"
          style={{ transform: 'rotate(-30deg)' }}
        >
          <span className="text-8xl font-black text-red-600">VOID / ملغي</span>
        </div>
      )}
    </div>
  );
}
