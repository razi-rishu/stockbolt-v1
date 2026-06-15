/**
 * Shared print template primitives
 * Used by all templates; not exported from index.
 */
import type { Company } from '@/data/adapter';
import { getTaxLabels } from '@/lib/locale';

// ── Number formatter ──────────────────────────────────────────────────────────
export function fmt(n: number, currency = '') {
  const s = n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return currency ? `${currency} ${s}` : s;
}

// ── Company header ────────────────────────────────────────────────────────────
interface HeaderProps {
  company:     Company;
  accentColor: string;
}

export function PrintHeader({ company, accentColor }: HeaderProps) {
  const co = company as unknown as {
    logo_url?:     string;
    name_ar?:      string;
    tax_id?:       string;
    address?:      string;
    phone?:        string;
    email?:        string;
    country_code?: string;
  };
  const { registrationName } = getTaxLabels(co.country_code);

  return (
    <div className="flex items-start justify-between border-b-2 pb-4" style={{ borderColor: accentColor }}>
      <div className="flex items-center gap-3">
        {co.logo_url && (
          <img src={co.logo_url} alt="logo" className="h-14 w-auto object-contain" />
        )}
        <div>
          <div className="text-xl font-bold text-gray-900">{company.name}</div>
          {co.name_ar && <div className="text-base text-gray-600" dir="rtl">{co.name_ar}</div>}
        </div>
      </div>
      <div className="text-right text-xs text-gray-500">
        {co.tax_id  && <div>{registrationName}: {co.tax_id}</div>}
        {co.address && <div>{co.address}</div>}
        {co.phone   && <div>{co.phone}</div>}
        {co.email   && <div>{co.email}</div>}
      </div>
    </div>
  );
}

// ── Bilingual header (EN + AR side by side) ───────────────────────────────────
interface BilingualHeaderProps {
  company:      Company;
  accentColor:  string;
  titleEn:      string;
  titleAr:      string;
}

export function PrintBilingualHeader({ company, accentColor, titleEn, titleAr }: BilingualHeaderProps) {
  const co = company as unknown as {
    logo_url?:     string;
    name_ar?:      string;
    tax_id?:       string;
    address?:      string;
    country_code?: string;
  };
  const { registrationName } = getTaxLabels(co.country_code);

  return (
    <div className="border-b-2 pb-4" style={{ borderColor: accentColor }}>
      <div className="flex items-start justify-between">
        {/* LTR side */}
        <div>
          {co.logo_url && <img src={co.logo_url} alt="logo" className="mb-1 h-12 w-auto object-contain" />}
          <div className="text-xl font-bold">{company.name}</div>
          {co.tax_id && <div className="text-xs text-gray-500">{registrationName}: {co.tax_id}</div>}
          {co.address && <div className="text-xs text-gray-500">{co.address}</div>}
        </div>
        {/* RTL side */}
        <div className="text-right" dir="rtl">
          <div className="text-xl font-bold">{co.name_ar ?? company.name}</div>
          {co.tax_id && <div className="text-xs text-gray-500">رقم الضريبة: {co.tax_id}</div>}
        </div>
      </div>
      <div className="mt-3 flex justify-between">
        <h1 className="text-2xl font-bold" style={{ color: accentColor }}>{titleEn}</h1>
        <h1 className="text-2xl font-bold" dir="rtl" style={{ color: accentColor }}>{titleAr}</h1>
      </div>
    </div>
  );
}

// ── Line items table ──────────────────────────────────────────────────────────
interface LineItem {
  description:      string | null;
  quantity:         number | null;
  unit_price?:      number | null;
  unit_cost?:       number | null;
  discount_percent?: number | null;
  tax_rate?:        number | null;
  line_total:       number | null;
}

interface LineTableProps {
  items:       LineItem[];
  accentColor: string;
  type:        'invoice' | 'quote' | 'credit-note' | 'debit-note' | 'po' | 'bill';
}

export function PrintLineTable({ items, accentColor, type }: LineTableProps) {
  const isPurchase = type === 'po' || type === 'bill';
  const priceLabel = isPurchase ? 'Unit Cost' : 'Unit Price';

  return (
    <table className="w-full border-collapse text-sm">
      <thead>
        <tr className="text-left text-xs font-semibold uppercase text-white" style={{ backgroundColor: accentColor }}>
          <th className="px-3 py-2 w-8">#</th>
          <th className="px-3 py-2">Description</th>
          <th className="px-3 py-2 text-right w-16">Qty</th>
          <th className="px-3 py-2 text-right w-24">{priceLabel}</th>
          <th className="px-3 py-2 text-right w-16">Disc%</th>
          <th className="px-3 py-2 text-right w-16">Tax%</th>
          <th className="px-3 py-2 text-right w-24">Total</th>
        </tr>
      </thead>
      <tbody>
        {items.map((item, i) => {
          const price = item.unit_price ?? item.unit_cost ?? 0;
          return (
            <tr key={i} className={i % 2 === 0 ? 'bg-white' : 'bg-gray-50'}>
              <td className="px-3 py-2 text-gray-500">{i + 1}</td>
              <td className="px-3 py-2">{item.description ?? '—'}</td>
              <td className="px-3 py-2 text-right">{fmt(item.quantity ?? 0)}</td>
              <td className="px-3 py-2 text-right">{fmt(price)}</td>
              <td className="px-3 py-2 text-right">{fmt(item.discount_percent ?? 0)}%</td>
              <td className="px-3 py-2 text-right">{fmt(item.tax_rate ?? 0)}%</td>
              <td className="px-3 py-2 text-right font-medium">{fmt(item.line_total ?? 0)}</td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

// ── Totals block ──────────────────────────────────────────────────────────────
interface TotalsProps {
  subtotal:    number;
  discount:    number;
  tax:         number;
  total:       number;
  currency:    string;
  accentColor: string;
  taxLabel?:   string;   // Issue 5 — 'VAT' (GCC) or 'GST' (India); defaults to VAT
}

export function PrintTotals({ subtotal, discount, tax, total, currency, accentColor, taxLabel = 'VAT' }: TotalsProps) {
  return (
    <div className="w-56 text-sm">
      <div className="flex justify-between py-1">
        <span className="text-gray-500">Subtotal</span>
        <span>{fmt(subtotal)}</span>
      </div>
      {discount > 0 && (
        <div className="flex justify-between py-1">
          <span className="text-gray-500">Discount</span>
          <span>({fmt(discount)})</span>
        </div>
      )}
      <div className="flex justify-between py-1">
        <span className="text-gray-500">{taxLabel}</span>
        <span>{fmt(tax)}</span>
      </div>
      <div
        className="mt-1 flex justify-between rounded px-2 py-2 text-base font-bold text-white"
        style={{ backgroundColor: accentColor }}
      >
        <span>TOTAL {currency}</span>
        <span>{fmt(total)}</span>
      </div>
    </div>
  );
}

// ── Bilingual totals ──────────────────────────────────────────────────────────
export function PrintBilingualTotals({ subtotal, discount, tax, total, currency, accentColor, taxLabel = 'VAT' }: TotalsProps) {
  return (
    <div className="w-80 text-sm">
      <div className="flex justify-between py-1">
        <span className="text-gray-500">Subtotal / الإجمالي قبل الخصم</span>
        <span>{fmt(subtotal)}</span>
      </div>
      {discount > 0 && (
        <div className="flex justify-between py-1">
          <span className="text-gray-500">Discount / خصم</span>
          <span>({fmt(discount)})</span>
        </div>
      )}
      <div className="flex justify-between py-1">
        <span className="text-gray-500">{taxLabel} / ضريبة القيمة المضافة</span>
        <span>{fmt(tax)}</span>
      </div>
      <div
        className="mt-1 flex justify-between rounded px-2 py-2 text-base font-bold text-white"
        style={{ backgroundColor: accentColor }}
      >
        <span>TOTAL / الإجمالي {currency}</span>
        <span>{fmt(total)}</span>
      </div>
    </div>
  );
}

// ── Footer ────────────────────────────────────────────────────────────────────
interface FooterProps {
  footerText:      string;
  accentColor:     string;
  showBankDetails: boolean;
}

export function PrintFooter({ footerText, accentColor, showBankDetails }: FooterProps) {
  if (!footerText && !showBankDetails) return null;

  return (
    <div className="mt-8 border-t pt-4 text-xs text-gray-500" style={{ borderColor: accentColor }}>
      {showBankDetails && (
        <div className="mb-2 font-semibold text-gray-700">Bank Details / تفاصيل البنك</div>
      )}
      {footerText && <div className="whitespace-pre-wrap">{footerText}</div>}
    </div>
  );
}

// ── Bilingual Footer ──────────────────────────────────────────────────────────
interface BilingualFooterProps {
  footerEn:        string;
  footerAr:        string;
  accentColor:     string;
  showBankDetails: boolean;
}

export function PrintBilingualFooter({ footerEn, footerAr, accentColor, showBankDetails }: BilingualFooterProps) {
  if (!footerEn && !footerAr && !showBankDetails) return null;

  return (
    <div className="mt-8 border-t pt-4 text-xs" style={{ borderColor: accentColor }}>
      <div className="grid grid-cols-2 gap-4">
        <div className="text-gray-500">
          {showBankDetails && <div className="mb-1 font-semibold text-gray-700">Bank Details</div>}
          {footerEn && <div className="whitespace-pre-wrap">{footerEn}</div>}
        </div>
        <div className="text-right text-gray-500" dir="rtl">
          {showBankDetails && <div className="mb-1 font-semibold text-gray-700">تفاصيل البنك</div>}
          {footerAr && <div className="whitespace-pre-wrap">{footerAr}</div>}
        </div>
      </div>
    </div>
  );
}
