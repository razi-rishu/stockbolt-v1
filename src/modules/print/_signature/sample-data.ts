/**
 * Sample document data — Phase 14.01.
 *
 * Used by the /print-templates gallery so the Signature templates can
 * be previewed without needing a real invoice from the DB. Reflects a
 * plausible UAE auto-parts trading scenario.
 */
import type { DocumentData } from './types';
import { tokens } from './tokens';

const company = {
  name: 'StockBolt Auto Parts Trading LLC',
  trn:  '100123456700003',
  address: 'Warehouse 12, Al Quoz Industrial Area 4',
  city: 'Dubai',
  country: 'United Arab Emirates',
  phone: '+971 4 555 0100',
  email: 'invoices@stockbolt.ae',
  website: 'stockbolt.ae',
  logo_url: null,
};

const billTo = {
  name: 'Al Madina Garage & Workshop LLC',
  trn: '100987654300003',
  address: 'Shop 4, Industrial Area 7',
  city: 'Sharjah',
  country: 'United Arab Emirates',
  phone: '+971 6 555 0188',
  email: 'accounts@almadinagarage.ae',
  contact: 'Mr Abdul Rahman',
};

const shipTo = {
  name: 'Al Madina Garage & Workshop LLC',
  address: 'Warehouse 9, Industrial Area 17',
  city: 'Sharjah',
  country: 'United Arab Emirates',
  contact: 'Receiving — Imran',
};

const items: DocumentData['items'] = [
  {
    sku: 'BP-BRK-D1184', description: 'Brake Pad Set — Front (Toyota Hilux 2016+)',
    description_ar: 'طقم تيل فرامل أمامي', quantity: 4, unit_code: 'set',
    unit_price: 78.50, tax_rate: 5, tax_amount: 15.70, line_total: 329.70,
  },
  {
    sku: 'EO-MOB-5W30', description: 'Mobil Super 3000 5W-30 Synthetic Engine Oil',
    description_ar: 'زيت محرك موبيل', quantity: 6, unit_code: 'L',
    unit_price: 65.00, tax_rate: 5, tax_amount: 19.50, line_total: 409.50,
  },
  {
    sku: 'AF-DEN-271', description: 'Denso Premium Air Filter — Universal',
    quantity: 8, unit_code: 'pc',
    unit_price: 32.00, tax_rate: 5, tax_amount: 12.80, line_total: 268.80,
  },
  {
    sku: 'WP-BSC-9710', description: 'Bosch Wiper Blade — 22"',
    quantity: 2, unit_code: 'pc',
    unit_price: 45.00, tax_rate: 5, tax_amount: 4.50, line_total: 94.50,
  },
];

const subtotal = 1050.00;
const tax_total = 52.50;
const grand_total = 1102.50;

export const SAMPLE_TAX_INVOICE: DocumentData = {
  type: 'tax_invoice',
  number: 'INV-1042',
  status: 'confirmed',
  date: '2026-05-22',
  due_date: '2026-06-21',
  reference: 'PO-9921',
  currency: 'AED',

  company, bill_to: billTo, ship_to: shipTo, items,

  subtotal,
  discount_total: 0,
  tax_total,
  shipping_total: 0,
  grand_total,
  paid_amount: 0,
  balance_due: grand_total,

  vat_breakdown: [
    { rate: 5, taxable: subtotal, tax: tax_total },
  ],

  qr_payload: 'sample',  // real TLV payload built upstream
  banking: {
    account_name: 'StockBolt Auto Parts Trading LLC',
    bank_name: 'Emirates NBD',
    account_number: '012-345-6789-001',
    iban: 'AE07 0331 2345 6789 0010 02',
    swift: 'EBILAEAD',
    branch: 'Al Quoz',
  },
  notes: 'Thank you for your business. Goods once sold are not returnable.',
  terms: 'Payment due within 30 days. Late payment 1.5%/mo.',
  // So the Print Settings live preview demonstrates the Warehouse/Salesperson toggles.
  warehouse_name: 'Main Warehouse',
  salesperson_name: 'Ahmed Hassan',
};

/** Just exporting the tokens too in case the gallery wants to colour-match. */
export { tokens };
