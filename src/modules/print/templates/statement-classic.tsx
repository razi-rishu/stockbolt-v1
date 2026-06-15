/**
 * StatementClassicTemplate — customer account statement
 */
import type { Company, ContactRow, CustomerStatement, PrintConfig } from '@/data/adapter';
import { PrintHeader, PrintFooter, fmt } from './_shared';
import { getTaxLabels } from '@/lib/locale';

interface Props {
  company:     Company;
  printConfig: PrintConfig;
  statement:   CustomerStatement;
  contact:     ContactRow | null;
}

export function StatementClassicTemplate({ company, printConfig, statement, contact }: Props) {
  const accentStyle = { color: printConfig.accent_color };
  const { registrationName } = getTaxLabels(company.country_code);

  return (
    <div className="mx-auto max-w-[210mm] bg-white p-[14mm] font-sans text-[11pt] text-gray-900 print:p-0">
      <PrintHeader company={company} accentColor={printConfig.accent_color} />

      <div className="mt-6 flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold" style={accentStyle}>ACCOUNT STATEMENT</h1>
          <div className="mt-1 text-sm text-gray-500">
            Period: <span className="font-medium text-gray-800">{statement.from_date}</span>
            {' to '}
            <span className="font-medium text-gray-800">{statement.to_date}</span>
          </div>
        </div>
        <div className="text-right text-sm">
          <div className="text-xs font-semibold uppercase text-gray-500">Account</div>
          <div className="font-semibold">{contact?.name ?? statement.contact_name}</div>
          {contact?.name_ar && <div className="text-gray-600 text-xs">{contact.name_ar}</div>}
          {contact?.tax_id && <div className="text-gray-600 text-xs">{registrationName}: {contact.tax_id}</div>}
        </div>
      </div>

      {/* Opening balance */}
      <div className="mt-5 flex justify-between rounded bg-gray-50 px-3 py-2 text-sm">
        <span className="text-gray-600">Opening Balance</span>
        <span className="font-medium">{fmt(statement.opening_balance)}</span>
      </div>

      {/* Transactions */}
      <table className="mt-3 w-full border-collapse text-sm">
        <thead>
          <tr className="text-left text-xs font-semibold uppercase text-white" style={{ backgroundColor: printConfig.accent_color }}>
            <th className="px-3 py-2">Date</th>
            <th className="px-3 py-2">Type</th>
            <th className="px-3 py-2">Reference</th>
            <th className="px-3 py-2 text-right">Debit</th>
            <th className="px-3 py-2 text-right">Credit</th>
            <th className="px-3 py-2 text-right">Balance</th>
          </tr>
        </thead>
        <tbody>
          {statement.lines.map((line, i) => (
            <tr key={i} className={i % 2 === 0 ? 'bg-white' : 'bg-gray-50'}>
              <td className="px-3 py-1.5">{line.date}</td>
              <td className="px-3 py-1.5 capitalize">{line.doc_type.replace(/_/g, ' ')}</td>
              <td className="px-3 py-1.5">{line.doc_number}</td>
              <td className="px-3 py-1.5 text-right">{line.debit > 0 ? fmt(line.debit) : '—'}</td>
              <td className="px-3 py-1.5 text-right">{line.credit > 0 ? fmt(line.credit) : '—'}</td>
              <td className="px-3 py-1.5 text-right font-medium">{fmt(line.balance)}</td>
            </tr>
          ))}
        </tbody>
      </table>

      {statement.lines.length === 0 && (
        <div className="py-6 text-center text-sm text-gray-400">No transactions in this period.</div>
      )}

      {/* Closing balance */}
      <div className="mt-3 flex justify-between rounded px-3 py-2 text-sm font-bold text-white" style={{ backgroundColor: printConfig.accent_color }}>
        <span>Closing Balance</span>
        <span>{fmt(statement.closing_balance)}</span>
      </div>

      <PrintFooter
        footerText={printConfig.footer_en}
        accentColor={printConfig.accent_color}
        showBankDetails={printConfig.show_bank_details}
      />
    </div>
  );
}
