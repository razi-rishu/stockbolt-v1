/**
 * PrintPage — universal print wrapper
 * Route: /print/:docType/:id   (bypasses AppLayout entirely)
 *
 * docType values: invoice | quote | credit-note | debit-note | po | bill | statement
 *
 * Fetches document data + company data, reads print_config to pick template,
 * renders the template, and shows floating Print / Close buttons
 * (hidden on actual print via [data-print-hide]).
 */
import { useEffect, useState } from 'react';
import { useParams, useNavigate, useSearchParams } from 'react-router-dom';
import { getAdapter } from '@/data/index';
import { useAuthStore } from '@/store/auth';
import type {
  Company, ContactRow,
  InvoiceRow, InvoiceItemRow,
  SalesQuoteRow, SalesQuoteItemRow,
  CreditNoteRow, CreditNoteItemRow,
  DebitNoteRow, DebitNoteItemRow,
  PurchaseOrderRow, PurchaseOrderItemRow,
  VendorBillRow, VendorBillItemRow,
  PrintConfig,
} from '@/data/adapter';

import { ConfigurableDocTemplate }    from './engine/ConfigurableDocTemplate';
import { DEFAULT_TEMPLATE_SETTINGS }  from './engine/types';
import type { PrintTemplate, PrintDocumentType } from './engine/types';
import {
  invoiceToDocumentData, quoteToDocumentData, creditNoteToDocumentData,
  debitNoteToDocumentData, purchaseOrderToDocumentData, vendorBillToDocumentData,
} from './_signature/adapters';
// Statements are a running-balance ledger, not a line-item document, so they
// keep their dedicated classic template. All other docs render via the engine.
import { StatementClassicTemplate }   from './templates/statement-classic';

// ── Shared props passed to every template ────────────────────────────────────
export interface PrintDocProps {
  company: Company;
  printConfig: PrintConfig;
}

// ── Helpers ──────────────────────────────────────────────────────────────────
// Map the URL docType to the print-template document_type key. Statements are
// a running-balance ledger (not a line-item doc) so they keep their classic
// template and are intentionally excluded from the configurable engine.
function docTypeToPrintType(docType: string | undefined): PrintDocumentType | null {
  switch (docType) {
    case 'invoice':     return 'sales_invoice';
    case 'quote':       return 'quotation';
    case 'credit-note': return 'credit_note';
    case 'debit-note':  return 'debit_note';
    case 'po':          return 'purchase_order';
    case 'bill':        return 'purchase_invoice';
    default:            return null;
  }
}

// Synthetic classic template used if no saved template resolves (e.g. the
// table is briefly unreachable). Keeps documents rendering through the engine.
function classicFallbackTemplate(company_id: string): PrintTemplate {
  return {
    id: '', company_id, name: 'Default Template', template_style: 'classic',
    primary_color: '#0F172A', secondary_color: '#475569', accent_color: '#F5C242', text_color: '#0F172A',
    font_family: 'Inter', font_size: 'medium', logo_position: 'left', logo_size: 'medium',
    is_default: true, settings: DEFAULT_TEMPLATE_SETTINGS,
  };
}

function defaultPrintConfig(): PrintConfig {
  return {
    invoice_template:     'classic',
    quote_template:       'classic',
    statement_template:   'classic',
    credit_note_template: 'classic',
    debit_note_template:  'classic',
    po_template:          'classic',
    bill_template:        'classic',
    footer_en: '',
    footer_ar: '',
    show_salesperson:   true,
    show_due_date:      true,
    show_bank_details:  true,
    accent_color:       '#6d28d9',
  };
}

// ── Main component ────────────────────────────────────────────────────────────
export default function PrintPage() {
  const { docType, id } = useParams<{ docType: string; id: string }>();
  const [searchParams]  = useSearchParams();
  const navigate        = useNavigate();
  const company_id = useAuthStore(s => s.company_id);
  const adapter         = getAdapter();

  const [state, setState] = useState<{
    loading: boolean;
    error:   string | null;
    company:     Company | null;
    printConfig: PrintConfig;
    printTemplate?: PrintTemplate;   // Phase 15 — resolved customizable template
    contact:     ContactRow | null;
    // per-docType payloads
    invoice?:        InvoiceRow;
    invoiceItems?:   InvoiceItemRow[];
    quote?:          SalesQuoteRow;
    quoteItems?:     SalesQuoteItemRow[];
    creditNote?:     CreditNoteRow;
    creditNoteItems?: CreditNoteItemRow[];
    debitNote?:      DebitNoteRow;
    debitNoteItems?: DebitNoteItemRow[];
    po?:             PurchaseOrderRow;
    poItems?:        PurchaseOrderItemRow[];
    bill?:           VendorBillRow;
    billItems?:      VendorBillItemRow[];
    // Customer + Supplier statements share the same line/header shape, so a
    // CustomerStatement type works for both (see SupplierStatement in adapter.ts).
    statementLines?: import('@/data/adapter').CustomerStatementLine[];
    statementMeta?:  import('@/data/adapter').CustomerStatement;
  }>({
    loading: true,
    error:   null,
    company:     null,
    printConfig: defaultPrintConfig(),
    contact:     null,
  });

  useEffect(() => {
    if (!company_id || !docType || !id) return;

    async function load() {
      try {
        const company = await adapter.companies.getById(company_id!);
        if (!company) throw new Error('Company not found');

        // print_config lives in the JSONB column — cast it
        const printConfig: PrintConfig = (company as unknown as { print_config: PrintConfig }).print_config
          ?? defaultPrintConfig();

        let patch: Partial<typeof state> = { company, printConfig };

        // Phase 15 — resolve the customizable print template for the document
        // type. Failure (e.g. migration not yet applied) is swallowed so the
        // page safely falls back to the legacy classic template.
        const printType = docTypeToPrintType(docType);
        if (printType) {
          try {
            patch.printTemplate = await adapter.printTemplates.getResolved(company_id!, printType);
          } catch {
            patch.printTemplate = classicFallbackTemplate(company_id!);
          }
        }

        if (docType === 'invoice') {
          const [inv, items] = await Promise.all([
            adapter.invoices.getById(id!),
            adapter.invoices.getItems(id!),
          ]);
          if (!inv) throw new Error('Invoice not found');
          const contact = inv.contact_id ? await adapter.contacts.getById(inv.contact_id) : null;
          patch = { ...patch, invoice: inv, invoiceItems: items, contact };

        } else if (docType === 'quote') {
          const [quote, items] = await Promise.all([
            adapter.salesQuotes.getById(id!),
            adapter.salesQuotes.getItems(id!),
          ]);
          if (!quote) throw new Error('Quote not found');
          const contact = quote.contact_id ? await adapter.contacts.getById(quote.contact_id) : null;
          patch = { ...patch, quote, quoteItems: items, contact };

        } else if (docType === 'credit-note') {
          const [cn, items] = await Promise.all([
            adapter.creditNotes.getById(id!),
            adapter.creditNotes.getItems(id!),
          ]);
          if (!cn) throw new Error('Credit note not found');
          const contact = cn.contact_id ? await adapter.contacts.getById(cn.contact_id) : null;
          patch = { ...patch, creditNote: cn, creditNoteItems: items, contact };

        } else if (docType === 'debit-note') {
          const [dn, items] = await Promise.all([
            adapter.debitNotes.getById(id!),
            adapter.debitNotes.getItems(id!),
          ]);
          if (!dn) throw new Error('Debit note not found');
          const contact = dn.supplier_id ? await adapter.contacts.getById(dn.supplier_id) : null;
          patch = { ...patch, debitNote: dn, debitNoteItems: items, contact };

        } else if (docType === 'po') {
          const [po, items] = await Promise.all([
            adapter.purchaseOrders.getById(id!),
            adapter.purchaseOrders.getItems(id!),
          ]);
          if (!po) throw new Error('Purchase order not found');
          const contact = po.supplier_id ? await adapter.contacts.getById(po.supplier_id) : null;
          patch = { ...patch, po, poItems: items, contact };

        } else if (docType === 'bill') {
          const [bill, items] = await Promise.all([
            adapter.vendorBills.getById(id!),
            adapter.vendorBills.getItems(id!),
          ]);
          if (!bill) throw new Error('Bill not found');
          const contact = bill.supplier_id ? await adapter.contacts.getById(bill.supplier_id) : null;
          patch = { ...patch, bill, billItems: items, contact };

        } else if (docType === 'statement' || docType === 'supplier-statement') {
          // id = contact_id (customer or supplier). Date range overrideable via
          // ?from=YYYY-MM-DD&to=YYYY-MM-DD; defaults to current month.
          const today      = new Date().toISOString().slice(0, 10);
          const monthStart = today.slice(0, 7) + '-01';
          const from = searchParams.get('from') || monthStart;
          const to   = searchParams.get('to')   || today;

          const contact = await adapter.contacts.getById(id!);
          // Customer + supplier statements have the same shape; cast the
          // supplier flavour so the shared state type (CustomerStatement) holds.
          const stmt = docType === 'supplier-statement'
            ? (await adapter.reports.getSupplierStatement(company_id!, id!, from, to)) as unknown as import('@/data/adapter').CustomerStatement
            : await adapter.reports.getCustomerStatement(company_id!, id!, from, to);
          patch = { ...patch, contact, statementLines: stmt.lines, statementMeta: stmt };
        }

        setState(s => ({ ...s, ...patch, loading: false }));
      } catch (err) {
        setState(s => ({ ...s, loading: false, error: String(err) }));
      }
    }

    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [company_id, docType, id]);

  if (state.loading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div className="h-6 w-6 animate-spin rounded-full border-2 border-indigo-500 border-t-transparent" />
      </div>
    );
  }

  if (state.error || !state.company) {
    return (
      <div className="flex min-h-screen items-center justify-center text-red-600">
        {state.error ?? 'Failed to load document.'}
      </div>
    );
  }

  const { company, printConfig, contact } = state;

  // ── Floating action bar ────────────────────────────────────────────────────
  const ActionBar = (
    <div
      data-print-hide
      className="fixed bottom-6 right-6 z-50 flex gap-2"
    >
      <button
        onClick={() => navigate(-1)}
        className="rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 shadow hover:bg-gray-50"
      >
        ✕ Close
      </button>
      <button
        onClick={() => window.print()}
        className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white shadow hover:bg-indigo-700"
      >
        🖨 Print / Save PDF
      </button>
    </div>
  );

  // ── Render correct template ────────────────────────────────────────────────
  const baseProps = { company, printConfig };

  if (docType === 'invoice' && state.invoice && state.invoiceItems && state.printTemplate) {
    const docData = invoiceToDocumentData({ invoice: state.invoice, items: state.invoiceItems, contact, company });
    return <>{ActionBar}<ConfigurableDocTemplate data={docData} template={state.printTemplate} /></>;
  }

  if (docType === 'quote' && state.quote && state.quoteItems && state.printTemplate) {
    const docData = quoteToDocumentData({ quote: state.quote, items: state.quoteItems, contact, company });
    return <>{ActionBar}<ConfigurableDocTemplate data={docData} template={state.printTemplate} /></>;
  }

  if (docType === 'credit-note' && state.creditNote && state.creditNoteItems && state.printTemplate) {
    const docData = creditNoteToDocumentData({ creditNote: state.creditNote, items: state.creditNoteItems, contact, company });
    return <>{ActionBar}<ConfigurableDocTemplate data={docData} template={state.printTemplate} /></>;
  }

  if (docType === 'debit-note' && state.debitNote && state.debitNoteItems && state.printTemplate) {
    const docData = debitNoteToDocumentData({ debitNote: state.debitNote, items: state.debitNoteItems, supplier: contact, company });
    return <>{ActionBar}<ConfigurableDocTemplate data={docData} template={state.printTemplate} /></>;
  }

  if (docType === 'po' && state.po && state.poItems && state.printTemplate) {
    const docData = purchaseOrderToDocumentData({ po: state.po, items: state.poItems, supplier: contact, company });
    return <>{ActionBar}<ConfigurableDocTemplate data={docData} template={state.printTemplate} /></>;
  }

  if (docType === 'bill' && state.bill && state.billItems && state.printTemplate) {
    const docData = vendorBillToDocumentData({ bill: state.bill, items: state.billItems, supplier: contact, company });
    return <>{ActionBar}<ConfigurableDocTemplate data={docData} template={state.printTemplate} /></>;
  }

  if ((docType === 'statement' || docType === 'supplier-statement') && state.statementMeta) {
    return (
      <>
        {ActionBar}
        <StatementClassicTemplate {...baseProps} statement={state.statementMeta} contact={contact} />
      </>
    );
  }

  return (
    <div className="flex min-h-screen items-center justify-center text-gray-500">
      Unknown document type: {docType}
    </div>
  );
}
