/**
 * CreditNoteClassicTemplate — A4 credit note layout
 */
import type { Company, ContactRow, CreditNoteRow, CreditNoteItemRow, PrintConfig } from '@/data/adapter';
import { PrintHeader, PrintLineTable, PrintTotals, PrintFooter } from './_shared';

interface Props {
  company:     Company;
  printConfig: PrintConfig;
  creditNote:  CreditNoteRow;
  items:       CreditNoteItemRow[];
  contact:     ContactRow | null;
}

export function CreditNoteClassicTemplate({ company, printConfig, creditNote, items, contact }: Props) {
  const accentStyle  = { color: printConfig.accent_color };

  return (
    <div className="mx-auto max-w-[210mm] bg-white p-[14mm] font-sans text-[11pt] text-gray-900 print:p-0">
      <PrintHeader company={company} accentColor={printConfig.accent_color} />

      <div className="mt-6 flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold" style={accentStyle}>CREDIT NOTE</h1>
          <div className="mt-1 text-sm">
            <span className="font-medium text-gray-800">#{creditNote.credit_note_number}</span>
          </div>
        </div>
        <div className="text-right text-sm">
          <div><span className="text-gray-500">Date: </span><span className="font-medium">{creditNote.date}</span></div>
          {creditNote.linked_invoice_id && (
            <div><span className="text-gray-500">Linked Invoice: </span><span className="font-medium">{creditNote.linked_invoice_id}</span></div>
          )}
          <div><span className="text-gray-500">Currency: </span><span className="font-medium">{creditNote.currency}</span></div>
        </div>
      </div>

      {/* Credit To */}
      <div className="mt-5">
        <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-gray-500">Credit To</div>
        <div className="rounded border border-gray-200 p-3 text-sm inline-block min-w-48">
          <div className="font-semibold">{contact?.name ?? '—'}</div>
          {contact?.name_ar && <div className="text-gray-600">{contact.name_ar}</div>}
          {contact?.tax_id && <div className="text-gray-600 text-xs">TRN: {contact.tax_id}</div>}
        </div>
      </div>

      {/* Reason */}
      {(creditNote as unknown as { reason?: string }).reason && (
        <div className="mt-3 rounded bg-amber-50 px-3 py-2 text-sm">
          <span className="font-medium text-amber-800">Reason: </span>
          <span className="text-amber-700 capitalize">
            {((creditNote as unknown as { reason?: string }).reason ?? '').replace(/_/g, ' ')}
          </span>
        </div>
      )}

      {/* Line Items */}
      <div className="mt-5">
        <PrintLineTable items={items} accentColor={printConfig.accent_color} type="credit-note" />
      </div>

      {/* Totals */}
      <div className="mt-4 flex justify-end">
        <PrintTotals
          subtotal={creditNote.subtotal ?? 0}
          discount={creditNote.discount_amount ?? 0}
          tax={creditNote.tax_amount ?? 0}
          total={creditNote.total_amount ?? 0}
          currency={creditNote.currency}
          accentColor={printConfig.accent_color}
        />
      </div>

      {creditNote.notes && (
        <div className="mt-5 rounded border border-gray-200 p-3 text-sm">
          <div className="mb-1 font-semibold text-gray-600">Notes</div>
          <div className="text-gray-700 whitespace-pre-wrap">{creditNote.notes}</div>
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
