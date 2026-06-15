/**
 * DebitNoteClassicTemplate — A4 debit note layout (supplier-side)
 */
import type { Company, ContactRow, DebitNoteRow, DebitNoteItemRow, PrintConfig } from '@/data/adapter';
import { PrintHeader, PrintLineTable, PrintTotals, PrintFooter } from './_shared';
import { getTaxLabels } from '@/lib/locale';

interface Props {
  company:     Company;
  printConfig: PrintConfig;
  debitNote:   DebitNoteRow;
  items:       DebitNoteItemRow[];
  contact:     ContactRow | null;
}

export function DebitNoteClassicTemplate({ company, printConfig, debitNote, items, contact }: Props) {
  const accentStyle = { color: printConfig.accent_color };

  return (
    <div className="mx-auto max-w-[210mm] bg-white p-[14mm] font-sans text-[11pt] text-gray-900 print:p-0">
      <PrintHeader company={company} accentColor={printConfig.accent_color} />

      <div className="mt-6 flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold" style={accentStyle}>DEBIT NOTE</h1>
          <div className="mt-1 text-sm">
            <span className="font-medium text-gray-800">#{debitNote.debit_note_number}</span>
          </div>
        </div>
        <div className="text-right text-sm">
          <div><span className="text-gray-500">Date: </span><span className="font-medium">{debitNote.date}</span></div>
          {debitNote.linked_bill_id && (
            <div><span className="text-gray-500">Against Bill: </span><span className="font-medium">{debitNote.linked_bill_id}</span></div>
          )}
          <div><span className="text-gray-500">Currency: </span><span className="font-medium">{debitNote.currency}</span></div>
        </div>
      </div>

      {/* Debit To (supplier) */}
      <div className="mt-5">
        <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-gray-500">Debit To (Supplier)</div>
        <div className="rounded border border-gray-200 p-3 text-sm inline-block min-w-48">
          <div className="font-semibold">{contact?.name ?? '—'}</div>
          {contact?.name_ar && <div className="text-gray-600">{contact.name_ar}</div>}
          {contact?.tax_id && <div className="text-gray-600 text-xs">TRN: {contact.tax_id}</div>}
        </div>
      </div>

      {/* Reason */}
      {(debitNote as unknown as { reason?: string }).reason && (
        <div className="mt-3 rounded bg-amber-50 px-3 py-2 text-sm">
          <span className="font-medium text-amber-800">Reason: </span>
          <span className="text-amber-700 capitalize">
            {((debitNote as unknown as { reason?: string }).reason ?? '').replace(/_/g, ' ')}
          </span>
        </div>
      )}

      {/* Line Items */}
      <div className="mt-5">
        <PrintLineTable items={items} accentColor={printConfig.accent_color} type="debit-note" />
      </div>

      {/* Totals */}
      <div className="mt-4 flex justify-end">
        <PrintTotals
          subtotal={debitNote.subtotal ?? 0}
          discount={debitNote.discount_amount ?? 0}
          tax={debitNote.tax_amount ?? 0}
          total={debitNote.total_amount ?? 0}
          currency={debitNote.currency}
          accentColor={printConfig.accent_color}
          taxLabel={getTaxLabels(company.country_code).taxName}
        />
      </div>

      {debitNote.notes && (
        <div className="mt-5 rounded border border-gray-200 p-3 text-sm">
          <div className="mb-1 font-semibold text-gray-600">Notes</div>
          <div className="text-gray-700 whitespace-pre-wrap">{debitNote.notes}</div>
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
