/**
 * InvoiceThermalTemplate — 80mm thermal receipt layout
 * Uses .thermal-template CSS class from index.css
 */
import type { Company, ContactRow, InvoiceRow, InvoiceItemRow, PrintConfig } from '@/data/adapter';
import { fmt } from './_shared';

interface Props {
  company:     Company;
  printConfig: PrintConfig;
  invoice:     InvoiceRow;
  items:       InvoiceItemRow[];
  contact:     ContactRow | null;
}

const DIV = '--------------------------------';

export function InvoiceThermalTemplate({ company, invoice, items, contact }: Props) {
  const co = company as unknown as { tax_id?: string; address?: string; phone?: string };

  return (
    <div className="thermal-template mx-auto">
      {/* Company */}
      <div className="text-center font-bold">{company.name}</div>
      {co.tax_id  && <div className="text-center text-[8pt]">TRN: {co.tax_id}</div>}
      {co.address && <div className="text-center text-[8pt]">{co.address}</div>}
      {co.phone   && <div className="text-center text-[8pt]">Tel: {co.phone}</div>}

      <div className="my-1">{DIV}</div>

      {/* Doc info */}
      <div className="text-center font-bold">INVOICE / فاتورة</div>
      <div className="flex justify-between text-[8pt]">
        <span>No:</span><span>{invoice.invoice_number}</span>
      </div>
      <div className="flex justify-between text-[8pt]">
        <span>Date:</span><span>{invoice.date}</span>
      </div>
      {contact && (
        <div className="flex justify-between text-[8pt]">
          <span>Customer:</span><span>{contact.name}</span>
        </div>
      )}

      <div className="my-1">{DIV}</div>

      {/* Line items */}
      <div className="text-[8pt]">
        {items.map((item, i) => (
          <div key={i} className="mb-1">
            <div>{item.description ?? '—'}</div>
            <div className="flex justify-between">
              <span>{fmt(item.quantity ?? 0)} x {fmt(item.unit_price ?? 0)}</span>
              <span>{fmt(item.line_total ?? 0)}</span>
            </div>
            {(item.discount_percent ?? 0) > 0 && (
              <div className="text-[7pt] text-gray-600">Disc {fmt(item.discount_percent ?? 0)}%</div>
            )}
          </div>
        ))}
      </div>

      <div className="my-1">{DIV}</div>

      {/* Totals */}
      <div className="text-[9pt]">
        <div className="flex justify-between">
          <span>Subtotal</span><span>{fmt((invoice as unknown as { subtotal?: number }).subtotal ?? 0)}</span>
        </div>
        {(invoice.discount_amount ?? 0) > 0 && (
          <div className="flex justify-between">
            <span>Discount</span><span>({fmt(invoice.discount_amount ?? 0)})</span>
          </div>
        )}
        <div className="flex justify-between">
          <span>VAT</span><span>{fmt(invoice.tax_amount ?? 0)}</span>
        </div>
        <div className="my-1">{DIV}</div>
        <div className="flex justify-between font-bold text-[10pt]">
          <span>TOTAL {invoice.currency}</span>
          <span>{fmt(invoice.total_amount ?? 0)}</span>
        </div>
      </div>

      <div className="my-1">{DIV}</div>
      <div className="text-center text-[8pt]">Thank you / شكرًا لكم</div>
      <div className="my-2" />
    </div>
  );
}
