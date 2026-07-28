/**
 * AC-4B — UAE PINT-AE (Peppol) UBL 2.1 Invoice XML formatter (pure, offline).
 *
 * Maps a CanonicalInvoice to a UBL 2.1 Invoice document in the shape PINT AE
 * (the UAE Peppol billing profile) expects. This builds the XML only; it does
 * NOT transmit via an access point, sign, or validate against the official XSD
 * (that conformance step is later and needs the schema files + a sandbox).
 *
 * Deterministic output (stable ordering + 2-space indent) so golden fixtures
 * lock the format. All amounts come from the canonical; no tax is recomputed.
 */
import type { CanonicalInvoice, CanonicalLine } from './canonical';

const NS_INVOICE = 'urn:oasis:names:specification:ubl:schema:xsd:Invoice-2';
const NS_CBC = 'urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2';
const NS_CAC = 'urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2';
// PINT AE customization / profile identifiers.
const CUSTOMIZATION_ID = 'urn:peppol:pint:billing-1@ae-1';
const PROFILE_ID = 'urn:peppol:bis:billing';
const VAT_SCHEME = 'VAT';
const INVOICE_TYPE_CODE = '380'; // commercial invoice

// ── Minimal deterministic XML builder ────────────────────────────────────────
interface XmlNode { tag: string; attrs?: Record<string, string>; text?: string; children?: XmlNode[] }

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
function escAttr(s: string): string {
  return esc(s).replace(/"/g, '&quot;');
}
function el(tag: string, children: XmlNode[], attrs?: Record<string, string>): XmlNode {
  return { tag, attrs, children };
}
function leaf(tag: string, text: string, attrs?: Record<string, string>): XmlNode {
  return { tag, attrs, text };
}
/** currencyID-tagged amount, always 2 decimals. */
function amount(tag: string, value: number, currency: string): XmlNode {
  return leaf(tag, value.toFixed(2), { currencyID: currency });
}
function renderNode(node: XmlNode, indent: number): string {
  const pad = '  '.repeat(indent);
  const attrs = node.attrs
    ? Object.entries(node.attrs).map(([k, v]) => ` ${k}="${escAttr(v)}"`).join('')
    : '';
  if (node.children && node.children.length) {
    const inner = node.children.map((c) => renderNode(c, indent + 1)).join('\n');
    return `${pad}<${node.tag}${attrs}>\n${inner}\n${pad}</${node.tag}>`;
  }
  if (node.text !== undefined) {
    return `${pad}<${node.tag}${attrs}>${esc(node.text)}</${node.tag}>`;
  }
  return `${pad}<${node.tag}${attrs}/>`;
}

// ── Party + tax helpers ──────────────────────────────────────────────────────
function partyNode(
  wrapperTag: string,
  p: { legal_name: string; tax_id: string | null; country_code: string | null; address_line: string | null; city: string | null },
): XmlNode {
  const address: XmlNode[] = [];
  if (p.address_line) address.push(leaf('cbc:StreetName', p.address_line));
  if (p.city) address.push(leaf('cbc:CityName', p.city));
  address.push(el('cac:Country', [leaf('cbc:IdentificationCode', p.country_code ?? '')]));

  const partyChildren: XmlNode[] = [el('cac:PostalAddress', address)];
  if (p.tax_id) {
    partyChildren.push(el('cac:PartyTaxScheme', [
      leaf('cbc:CompanyID', p.tax_id),
      el('cac:TaxScheme', [leaf('cbc:ID', VAT_SCHEME)]),
    ]));
  }
  partyChildren.push(el('cac:PartyLegalEntity', [leaf('cbc:RegistrationName', p.legal_name)]));
  return el(wrapperTag, [el('cac:Party', partyChildren)]);
}

function taxCategoryNode(tag: string, code: string, percent: number): XmlNode {
  return el(tag, [
    leaf('cbc:ID', code),
    leaf('cbc:Percent', percent.toFixed(2)),
    el('cac:TaxScheme', [leaf('cbc:ID', VAT_SCHEME)]),
  ]);
}

/** Group lines by (category code, rate) for the TaxTotal breakdown. */
function taxSubtotals(inv: CanonicalInvoice): XmlNode[] {
  const groups = new Map<string, { code: string; rate: number; taxable: number; tax: number }>();
  for (const l of inv.lines) {
    const key = `${l.tax_category_code}@${l.tax_rate}`;
    const g = groups.get(key) ?? { code: l.tax_category_code, rate: l.tax_rate, taxable: 0, tax: 0 };
    g.taxable += l.taxable_value;
    g.tax += l.total_tax;
    groups.set(key, g);
  }
  return [...groups.values()].map((g) =>
    el('cac:TaxSubtotal', [
      amount('cbc:TaxableAmount', g.taxable, inv.document.currency),
      amount('cbc:TaxAmount', g.tax, inv.document.currency),
      taxCategoryNode('cac:TaxCategory', g.code, g.rate),
    ]),
  );
}

function invoiceLineNode(l: CanonicalLine, currency: string): XmlNode {
  return el('cac:InvoiceLine', [
    leaf('cbc:ID', String(l.sl_no)),
    leaf('cbc:InvoicedQuantity', String(l.quantity), { unitCode: l.unit ?? 'EA' }),
    amount('cbc:LineExtensionAmount', l.taxable_value, currency),
    el('cac:Item', [
      leaf('cbc:Name', l.description),
      taxCategoryNode('cac:ClassifiedTaxCategory', l.tax_category_code, l.tax_rate),
    ]),
    el('cac:Price', [amount('cbc:PriceAmount', l.unit_price, currency)]),
  ]);
}

// ── Formatter ────────────────────────────────────────────────────────────────
export function toPintAeUbl(inv: CanonicalInvoice): string {
  const cur = inv.document.currency;
  const taxExclusive = inv.totals.assessable;
  const taxInclusive = inv.totals.grand_total;

  const root = el('Invoice', [
    leaf('cbc:CustomizationID', CUSTOMIZATION_ID),
    leaf('cbc:ProfileID', PROFILE_ID),
    leaf('cbc:ID', inv.document.number),
    leaf('cbc:IssueDate', inv.document.date),
    leaf('cbc:InvoiceTypeCode', INVOICE_TYPE_CODE),
    leaf('cbc:DocumentCurrencyCode', cur),
    partyNode('cac:AccountingSupplierParty', inv.supplier),
    partyNode('cac:AccountingCustomerParty', inv.buyer),
    el('cac:TaxTotal', [
      amount('cbc:TaxAmount', inv.totals.tax_total, cur),
      ...taxSubtotals(inv),
    ]),
    el('cac:LegalMonetaryTotal', [
      amount('cbc:LineExtensionAmount', taxExclusive, cur),
      amount('cbc:TaxExclusiveAmount', taxExclusive, cur),
      amount('cbc:TaxInclusiveAmount', taxInclusive, cur),
      amount('cbc:PayableAmount', taxInclusive, cur),
    ]),
    ...inv.lines.map((l) => invoiceLineNode(l, cur)),
  ], {
    xmlns: NS_INVOICE,
    'xmlns:cbc': NS_CBC,
    'xmlns:cac': NS_CAC,
  });

  return `<?xml version="1.0" encoding="UTF-8"?>\n${renderNode(root, 0)}\n`;
}
