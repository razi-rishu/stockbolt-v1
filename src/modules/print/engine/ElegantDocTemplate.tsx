/**
 * ElegantDocTemplate — the "Elegant" print layout.
 *
 * A showcase design (first built for Orvella Events' quotation): a large serif
 * title beside a curved header photo, rounded detail panels, a numbered items
 * table, a dark grand-total pill and a contact footer bar. Every colour, the
 * photo and all wording come from the template, so any company can use it.
 *
 * Selected through `settings.layout === 'elegant'` (a JSONB key, so no schema
 * change). ConfigurableDocTemplate hands over to this component; the same
 * DocumentData payload drives every document type, payments included.
 */
import type { CSSProperties, ReactNode } from 'react';
import {
  User, Phone, MapPin, Mail, FileText, CalendarDays, Clock, Hash, Receipt,
  CreditCard, ClipboardList, Users, Globe, Building2,
} from 'lucide-react';
import type { DocumentData } from '../_signature/types';
import { getTaxLabels, formatDate } from '@/lib/locale';
import type { PrintTemplate, TemplateSettings } from './types';
import { STYLE_PRESETS, FONT_STACK, FONT_SIZE_PX } from './presets';
import { amountInWords } from './amount-in-words';
import { splitNoteDetails } from './note-details';
import { FitToWidth } from '@/ui/fit-to-width';

interface Props {
  data:     DocumentData;
  template: PrintTemplate;
  settings: TemplateSettings;
}

const SERIF = `Georgia, 'Times New Roman', Times, serif`;

/** Linear blend of two #RRGGBB colours; t = share of `b`. */
function mix(a: string, b: string, t: number): string {
  const p = (h: string) => {
    const m = /^#?([0-9a-f]{6})$/i.exec(h.trim());
    const v = m ? parseInt(m[1], 16) : 0;
    return [(v >> 16) & 255, (v >> 8) & 255, v & 255];
  };
  const [x, y] = [p(a), p(b)];
  return '#' + x.map((c, i) => Math.round(c * (1 - t) + y[i] * t).toString(16).padStart(2, '0')).join('');
}

const lines = (text: string) => text.split(/\r?\n/).map(l => l.replace(/^\s*(?:[-•*]|\d+[.)])\s*/, '').trim()).filter(Boolean);

const DETAIL_ICONS: Record<string, typeof User> = {
  guests: Users, venue: MapPin, location: MapPin, date: CalendarDays, time: Clock,
};

/**
 * Print rules for this layout only. The footer is fixed, so the browser
 * repeats it at the foot of every printed page (as Orvella's own PDF does);
 * the wrapper table's repeating thead / tfoot spacers keep page content clear
 * of it and give continuation pages a top margin. Colours print exactly: the
 * design is mostly coloured bands, and the /print route doesn't load the
 * editors' print.css that forces this.
 */
const PRINT_CSS = `@media print {
  @page { size: A4; margin: 0; }
  .elegant-doc, .elegant-doc * { -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; }
  .elegant-doc .elegant-footer { position: fixed !important; left: 0; right: 0; bottom: 0; width: 210mm; }
}`;
const TOP_GAP_MM = 10;

export function ElegantDocTemplate({ data, template, settings: s }: Props) {
  const preset   = STYLE_PRESETS[template.template_style] ?? STYLE_PRESETS.classic;
  const fontStack = FONT_STACK[template.font_family] ?? FONT_STACK.Inter;
  const base     = FONT_SIZE_PX[template.font_size] ?? FONT_SIZE_PX.medium;

  const C = {
    primary: template.primary_color,
    muted:   template.secondary_color,
    accent:  template.accent_color,
    text:    template.text_color,
  };
  const panel  = mix(mix('#FFFFFF', C.muted, 0.06), C.accent, 0.05);
  const stripe = mix('#FFFFFF', C.muted, 0.06);
  const halo   = mix('#FFFFFF', C.accent, 0.22);
  const chip   = mix(C.accent, '#FFFFFF', 0.25);

  const tax = getTaxLabels(preset.forceGstLabels ? 'IN' : (data.company.country ?? undefined));
  const cur = data.currency;
  // INR prints with Indian digit grouping (1,52,000.00) and the rupee sign.
  const locale = cur === 'INR' ? 'en-IN' : 'en-US';
  const num = (n: number) => (Number(n) || 0).toLocaleString(locale, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const symbol = cur === 'INR' ? '₹' : cur;
  const money = (n: number) => `${symbol} ${num(n)}`;
  const qty = (n: number) => Number.isInteger(n) ? String(n).padStart(2, '0') : String(+n.toFixed(3));

  const title = data.title ?? 'Tax Invoice';
  const isPayment = !!data.allocations;
  const isPurchase = data.type === 'purchase_order' || /bill|goods receipt|voucher|debit/i.test(title);
  const isQuote = data.type === 'quotation';
  const { details: noteDetails, rest: noteText } = splitNoteDetails(data.notes);
  const terms = lines(data.terms || s.termsEn);
  const payTerms = s.showPaymentTerms ? lines(s.paymentTermsEn) : [];
  const banking = data.banking ?? (
    (s.bankAccountName || s.bankName || s.bankAccountNumber || s.bankIban) ? {
      account_name: s.bankAccountName || data.company.name, bank_name: s.bankName || null,
      account_number: s.bankAccountNumber || null, iban: s.bankIban || null,
    } : null);

  // ── Small building blocks ────────────────────────────────────────────────
  const tracked = (size: number, color: string, spacing = '0.32em'): CSSProperties => ({
    fontSize: size, letterSpacing: spacing, textTransform: 'uppercase', color, fontWeight: 700,
  });
  const bar = <div style={{ width: '12mm', height: 2, background: C.accent, margin: '3mm 0' }} />;
  const iconCircle = (Icon: typeof User, size = '9mm') => (
    <div style={{ width: size, height: size, borderRadius: '50%', background: chip, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
      <Icon size={base * 1.15} color="#FFFFFF" strokeWidth={1.8} />
    </div>
  );
  const SectionHead = ({ children }: { children: ReactNode }) => (
    <div style={{ ...tracked(base * 0.95, C.primary), marginBottom: '2.2mm' }}>{children}</div>
  );
  const DetailRow = ({ icon: Icon, label, value }: { icon: typeof User; label: string; value: ReactNode }) => (
    <div style={{ display: 'grid', gridTemplateColumns: '6mm 30mm 3mm 1fr', alignItems: 'start', fontSize: base * 0.92, color: C.text, padding: '0.55mm 0' }}>
      <Icon size={base * 1.1} color={C.primary} strokeWidth={1.8} style={{ marginTop: 1 }} />
      <span>{label}</span><span>:</span>
      <span style={{ fontVariantNumeric: 'tabular-nums', overflowWrap: 'anywhere' }}>{value}</span>
    </div>
  );

  // ── Header: logo / title on the left, curved photo + words on the right ──
  const words = lines(s.heroWords);
  const titleSize = Math.min(48, 345 / (Math.max(title.length, 1) * 0.75));
  // Without a photo or words the header shrinks to its text instead of
  // holding the photo's 60mm.
  const hasArt = words.length > 0 || !!s.heroImageUrl;
  const Header = (
    <div style={{ position: 'relative', height: hasArt ? '60mm' : undefined }}>
      {hasArt && (
        <div style={{ position: 'absolute', top: 0, right: 0, width: '42mm', height: '69mm', background: C.primary, borderTopLeftRadius: '14mm 40mm', borderBottomLeftRadius: '30mm 26mm', zIndex: 2 }}>
          <div style={{ position: 'absolute', top: '9mm', left: '12mm' }}>
            {words.map((w, i) => <div key={i} style={{ ...tracked(base * 0.72, '#FFFFFF', '0.45em'), fontWeight: 500, lineHeight: 2.3 }}>{w}</div>)}
            {words.length > 0 && <div style={{ width: '10mm', height: 2, background: C.accent, marginTop: '4mm' }} />}
          </div>
        </div>
      )}
      {s.heroImageUrl && (
        <>
          <div style={{ position: 'absolute', top: 0, right: '24mm', width: '84mm', height: '60mm', background: halo, borderTopLeftRadius: '22mm 60mm', borderBottomLeftRadius: '10mm 20mm', zIndex: 1 }} />
          <img src={s.heroImageUrl} alt="" style={{ position: 'absolute', top: 0, right: '26mm', width: '77mm', height: '59mm', objectFit: 'cover', borderTopLeftRadius: '18mm 59mm', borderBottomLeftRadius: '8mm 18mm', zIndex: 1 }} />
        </>
      )}
      <div style={hasArt
        ? { position: 'absolute', top: '8mm', left: '14mm', width: s.heroImageUrl ? '92mm' : '140mm', zIndex: 3 }
        : { position: 'relative', padding: '10mm 14mm 2mm' }}>
        {s.showLogo && data.company.logo_url
          ? <img src={data.company.logo_url} alt="logo" style={{ maxHeight: '19mm', maxWidth: '70mm', objectFit: 'contain', display: 'block' }} />
          : <div style={{ fontFamily: SERIF, fontSize: base * 2, fontWeight: 700, color: C.primary }}>{data.company.name}</div>}
        {s.tagline && <div style={{ ...tracked(base * 0.62, C.muted), fontWeight: 400, marginTop: '3mm', whiteSpace: 'pre' }}>{s.tagline}</div>}
        <div style={{ fontFamily: SERIF, fontWeight: 700, fontSize: titleSize, color: C.primary, textTransform: 'uppercase', lineHeight: 1.05, marginTop: '6mm' }}>{title}</div>
        {s.subtitle && <div style={{ ...tracked(base * 0.72, C.text, '0.42em'), fontWeight: 400, marginTop: '3mm' }}>{s.subtitle}</div>}
        {data.company.trn && (
          <div style={{ fontSize: base * 0.8, color: C.text, marginTop: '2mm' }}>
            {tax.registrationName}: <span style={{ fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>{data.company.trn}</span>
          </div>
        )}
        {bar}
      </div>
    </div>
  );

  // ── Client + document details panel ──────────────────────────────────────
  const p = data.bill_to;
  const address = [p.address, p.city, p.country].filter(Boolean).join(', ');
  const dueLabel = isQuote ? 'Valid Until' : 'Due Date';
  const dueValue = isQuote ? (data.valid_until ?? data.due_date) : data.due_date;
  const DetailsPanel = (
    <div style={{ position: 'relative', zIndex: 3, margin: '0 12mm', background: panel, borderRadius: '4mm', padding: '4.5mm 7mm', display: 'flex', gap: '7mm', breakInside: 'avoid' }}>
      <div style={{ flex: 1.1, minWidth: 0 }}>
        <SectionHead>{isPurchase ? 'Supplier Details' : 'Client Details'}</SectionHead>
        <DetailRow icon={User} label={isPurchase ? 'Supplier' : 'Client Name'} value={p.name} />
        {p.phone && <DetailRow icon={Phone} label="Phone" value={p.phone} />}
        {p.email && <DetailRow icon={Mail} label="Email" value={p.email} />}
        {address && <DetailRow icon={Building2} label="Address" value={address} />}
        {s.showCustomerTaxNumber && p.trn && <DetailRow icon={Hash} label={tax.registrationName} value={p.trn} />}
        {noteDetails.map(([l, v], i) => (
          <DetailRow key={i} icon={DETAIL_ICONS[Object.keys(DETAIL_ICONS).find(k => l.toLowerCase().includes(k)) ?? ''] ?? FileText} label={l} value={v} />
        ))}
      </div>
      <div style={{ width: 1, background: mix(panel, C.muted, 0.25) }} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <SectionHead>{title} Details</SectionHead>
        <DetailRow icon={FileText} label={`${isQuote ? 'Quote' : 'Document'} No.`} value={data.number} />
        <DetailRow icon={CalendarDays} label="Issue Date" value={formatDate(data.date)} />
        {s.showDueDate && dueValue && <DetailRow icon={Clock} label={dueLabel} value={formatDate(dueValue)} />}
        {s.showReferenceNumber && data.reference && <DetailRow icon={Hash} label="Reference" value={data.reference} />}
        {s.showSalesperson && data.salesperson_name && <DetailRow icon={User} label="Salesperson" value={data.salesperson_name} />}
        {s.showWarehouse && data.warehouse_name && <DetailRow icon={Building2} label="Warehouse" value={data.warehouse_name} />}
        {isPayment && data.payment_method && <DetailRow icon={CreditCard} label="Method" value={data.payment_method} />}
        {s.introText && <>{bar}<div style={{ fontSize: base * 0.9, color: C.muted, lineHeight: 1.5 }}>{s.introText}</div></>}
      </div>
    </div>
  );

  // ── Items / allocations table ────────────────────────────────────────────
  type Col = { head: string; align: 'start' | 'center' | 'end'; width?: string; cell: (i: number) => ReactNode };
  const cols: Col[] = isPayment ? [
    { head: 'Document', align: 'start', cell: i => data.allocations![i].doc_number },
    { head: 'Date', align: 'center', cell: i => { const d = data.allocations![i].doc_date; return d ? formatDate(d) : '—'; } },
    { head: `Amount (${cur})`, align: 'end', cell: i => { const a = data.allocations![i].original_amount; return a != null ? num(a) : '—'; } },
    { head: `Paid (${cur})`, align: 'end', cell: i => num(data.allocations![i].applied_amount) },
  ] : [
    { head: 'Item Description', align: 'start', cell: i => {
      const it = data.items[i];
      return (
        <div>
          <div style={{ fontWeight: 700 }}>{it.description}</div>
          {s.showItemSku && it.sku && <div style={{ fontSize: base * 0.75, color: C.muted }}>{it.sku}</div>}
          {s.showItemDescription && it.description_ar && <div style={{ fontSize: base * 0.78, color: C.muted }} dir="rtl">{it.description_ar}</div>}
        </div>
      );
    } },
    { head: 'Qty', align: 'center', width: '17mm', cell: i => `${qty(data.items[i].quantity)}${data.items[i].unit_code ? ' ' + data.items[i].unit_code : ''}` },
    ...(s.showUnitPrice ? [{ head: `Unit Price (${cur})`, align: 'end' as const, width: '33mm', cell: (i: number) => num(data.items[i].unit_price) }] : []),
    ...(s.showDiscount && data.items.some(it => it.discount_amount) ? [{ head: 'Disc', align: 'end' as const, width: '18mm', cell: (i: number) => data.items[i].discount_amount ? num(data.items[i].discount_amount!) : '—' }] : []),
    ...(s.showTaxBreakdown && data.tax_total ? [{ head: tax.taxName, align: 'end' as const, width: '20mm', cell: (i: number) => num(data.items[i].tax_amount ?? 0) }] : []),
    { head: `Amount (${cur})`, align: 'end', width: '33mm', cell: i => num(data.items[i].line_total) },
  ];
  const rowCount = isPayment ? data.allocations!.length : data.items.length;
  const sep = `1px solid ${mix(stripe, C.muted, 0.18)}`;
  const Table = (
    <table style={{ width: 'calc(100% - 24mm)', margin: '4mm 12mm 0', borderCollapse: 'separate', borderSpacing: 0 }}>
      <thead>
        <tr>{cols.map((c, j) => (
          <th key={j} style={{
            background: C.primary, color: '#FFFFFF', fontWeight: 700, fontSize: base * 0.92, textAlign: c.align, width: c.width,
            padding: '2.6mm 4mm', borderInlineStart: j ? '1px solid rgba(255,255,255,.18)' : undefined,
            borderStartStartRadius: j === 0 ? '3mm' : undefined, borderStartEndRadius: j === cols.length - 1 ? '3mm' : undefined,
          }}>{c.head}</th>
        ))}</tr>
      </thead>
      <tbody>
        {Array.from({ length: rowCount }, (_, i) => (
          <tr key={i} style={{ background: i % 2 === 0 ? stripe : '#FFFFFF', breakInside: 'avoid' }}>
            {cols.map((c, j) => (
              <td key={j} style={{ padding: '1.8mm 4mm', fontSize: base * 0.88, color: C.text, textAlign: c.align, fontVariantNumeric: 'tabular-nums', borderInlineStart: j ? sep : undefined }}>
                {j === 0 && !isPayment
                  ? <div style={{ display: 'flex', alignItems: 'center', gap: '4mm', marginInlineStart: '-2.5mm' }}>
                      <span style={{ width: '6mm', height: '6mm', borderRadius: '50%', background: chip, color: '#FFFFFF', fontSize: base * 0.72, fontWeight: 700, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>{i + 1}</span>
                      {c.cell(i)}
                    </div>
                  : c.cell(i)}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );

  // ── Totals + grand total pill ────────────────────────────────────────────
  const tRow = (l: string, v: string) => (
    <div style={{ display: 'flex', justifyContent: 'space-between', padding: '1.6mm 4mm', fontSize: base * 0.95, color: C.text, borderBottom: '1px solid #FFFFFF' }}>
      <span>{l}</span><span style={{ fontVariantNumeric: 'tabular-nums' }}>{v}</span>
    </div>
  );
  const Pill = ({ label, value, outline = false }: { label: string; value: number; outline?: boolean }) => (
    <div style={{
      display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '2.5mm', padding: '3.6mm 6mm', borderRadius: '3mm',
      background: outline ? '#FFFFFF' : C.primary, color: outline ? C.primary : '#FFFFFF', border: outline ? `1.5px solid ${C.primary}` : undefined,
    }}>
      <span style={tracked(base * 0.95, outline ? C.primary : '#FFFFFF', '0.35em')}>{label}</span>
      <span style={{ fontWeight: 800, fontSize: base * 1.2, fontVariantNumeric: 'tabular-nums' }}>{money(value)}</span>
    </div>
  );
  const Totals = isPayment ? (
    <div style={{ width: '88mm' }}><Pill label="Total Paid" value={data.grand_total} /></div>
  ) : (
    <div style={{ width: '88mm' }}>
      <div style={{ background: stripe, borderRadius: '3mm', padding: '1mm 0' }}>
        {tRow('Subtotal', money(data.subtotal))}
        {!!data.discount_total && data.discount_total > 0 && tRow('Discount', `- ${money(data.discount_total)}`)}
        {!!data.tax_total && tRow(tax.taxName, money(data.tax_total))}
        {!!data.shipping_total && data.shipping_total > 0 && tRow('Shipping', money(data.shipping_total))}
        {!!data.round_off && tRow('Round Off', `${data.round_off > 0 ? '+' : '-'} ${money(Math.abs(data.round_off))}`)}
      </div>
      <Pill label="Grand Total" value={data.grand_total} />
      {Number(data.paid_amount ?? 0) > 0 && <>
        {tRow('Amount Paid', `- ${money(Number(data.paid_amount))}`)}
        <Pill label="Balance Due" value={Number(data.balance_due ?? 0)} outline />
      </>}
    </div>
  );

  // Payment terms + bank details share the soft panel beside the totals.
  const hasSide = payTerms.length > 0 || (s.showBankDetails && !!banking) || isPayment;
  const SidePanel = hasSide && (
    <div style={{ flex: 1, minWidth: 0, background: panel, borderRadius: '4mm', padding: '5mm 6mm 5mm 5mm', display: 'flex', gap: '4mm' }}>
      {iconCircle(isPayment ? Receipt : CreditCard, '11mm')}
      <div style={{ flex: 1, minWidth: 0 }}>
        {isPayment && <>
          <SectionHead>Amount in Words</SectionHead>
          <div style={{ fontSize: base * 0.9, color: C.text, lineHeight: 1.5 }}>{amountInWords(data.grand_total, cur)}</div>
        </>}
        {payTerms.length > 0 && <>
          {isPayment && <div style={{ height: '4mm' }} />}
          <SectionHead>Payment Terms</SectionHead>
          <ul style={{ margin: 0, paddingInlineStart: '4mm', fontSize: base * 0.86, color: C.text, lineHeight: 1.5 }}>
            {payTerms.map((t, i) => <li key={i}>{t}</li>)}
          </ul>
        </>}
        {s.showBankDetails && banking && (
          <div style={{ marginTop: payTerms.length || isPayment ? '4mm' : 0 }}>
            <SectionHead>Bank Details</SectionHead>
            <div style={{ fontSize: base * 0.86, color: C.text, lineHeight: 1.6 }}>
              {banking.account_name && <div>Account: {banking.account_name}</div>}
              {banking.bank_name && <div>Bank: {banking.bank_name}</div>}
              {banking.account_number && <div>A/C No: {banking.account_number}</div>}
              {banking.iban && <div>IBAN: {banking.iban}</div>}
            </div>
          </div>
        )}
      </div>
    </div>
  );

  // ── Terms, signatory, acceptance ─────────────────────────────────────────
  const hasTerms = terms.length > 0 || !!noteText;
  const Closing = (hasTerms || s.showSignature || s.showCustomerAcceptance) && (
    <div style={{ display: 'flex', gap: '6mm', margin: '5mm 12mm 0', breakInside: 'avoid', alignItems: 'stretch' }}>
      <div style={{ flex: 1, minWidth: 0, display: 'flex', gap: '4mm' }}>
        {hasTerms && iconCircle(ClipboardList, '11mm')}
        {hasTerms && (
          <div style={{ flex: 1, minWidth: 0, paddingTop: '2mm' }}>
            {terms.length > 0 && <>
              <SectionHead>Terms &amp; Conditions</SectionHead>
              <ol style={{ margin: 0, paddingInlineStart: '5mm', fontSize: base * 0.8, color: C.text, lineHeight: 1.45 }}>
                {terms.map((t, i) => <li key={i}>{t}</li>)}
              </ol>
            </>}
            {noteText && <div style={{ marginTop: terms.length ? '3mm' : 0 }}>
              <SectionHead>Notes</SectionHead>
              <div style={{ fontSize: base * 0.82, color: C.text, whiteSpace: 'pre-wrap' }}>{noteText}</div>
            </div>}
          </div>
        )}
      </div>
      {s.showSignature && (
        <div style={{ width: '44mm', borderInlineStart: `1px solid ${mix('#FFFFFF', C.accent, 0.4)}`, paddingInlineStart: '5mm', display: 'flex', flexDirection: 'column', justifyContent: 'flex-end' }}>
          <div style={{ borderTop: `1px solid ${C.text}`, paddingTop: '2.5mm', fontSize: base * 0.92, color: C.text }}>{data.signed_by || s.signatureLabel || 'Authorized Signatory'}</div>
          <div style={{ fontSize: base * 0.88, color: C.muted, marginTop: '1.5mm' }}>For {data.company.name}</div>
        </div>
      )}
      {s.showCustomerAcceptance && !isPayment && (
        <div style={{ width: '46mm', borderInlineStart: `1px solid ${mix('#FFFFFF', C.accent, 0.4)}`, paddingInlineStart: '5mm' }}>
          <div style={{ borderTop: `1px solid ${C.text}`, paddingTop: '2.5mm', fontSize: base * 0.9, color: C.text, marginBottom: '2mm' }}>{isPurchase ? 'Supplier' : 'Customer'} Acceptance</div>
          {['Name', 'Date', 'Signature'].map(l => (
            <div key={l} style={{ display: 'grid', gridTemplateColumns: '15mm 2mm 1fr', fontSize: base * 0.78, color: C.muted, marginTop: '2.4mm' }}>
              <span>{l}</span><span>:</span><span style={{ borderBottom: `1px solid ${C.text}` }} />
            </div>
          ))}
        </div>
      )}
    </div>
  );

  // ── Contact footer bar ───────────────────────────────────────────────────
  const c = data.company;
  const contacts: { icon: typeof User; text: ReactNode }[] = [];
  if (c.phone) contacts.push({ icon: Phone, text: c.phone.split(/\s*[,/]\s*/).map((ph, i) => <div key={i}>{ph}</div>) });
  if (c.email) contacts.push({ icon: Mail, text: c.email });
  if (c.address || c.city) contacts.push({ icon: MapPin, text: [c.address, c.city].filter(Boolean).join(', ') });
  if (c.website) contacts.push({ icon: Globe, text: c.website });
  const footerMm = contacts.length > 0 ? 25 : 8;
  const Footer = (
    <div className="elegant-footer" style={{ position: 'absolute', insetInline: 0, bottom: 0 }}>
      <div style={{ textAlign: 'end', padding: '0 12mm 2mm', fontSize: base * 0.7, color: C.muted }}>
        {data.number}{s.showFooter && s.footerEn ? `  ·  ${s.footerEn}` : ''}
      </div>
      {contacts.length > 0 && (
        <div style={{ background: C.primary, padding: '4mm 12mm', display: 'flex', alignItems: 'center' }}>
          {contacts.map((x, i) => (
            <div key={i} style={{ flex: 1, minWidth: 0, display: 'flex', alignItems: 'center', gap: '3mm', padding: '0 4mm', borderInlineStart: i ? '1px solid rgba(255,255,255,.25)' : undefined }}>
              {iconCircle(x.icon)}
              <div style={{ color: '#FFFFFF', fontSize: base * 0.74, lineHeight: 1.35, overflowWrap: 'anywhere' }}>{x.text}</div>
            </div>
          ))}
        </div>
      )}
    </div>
  );

  return (
    <FitToWidth>
      <div className="signature-page elegant-doc" style={{
        position: 'relative', width: '210mm', minHeight: '297mm', background: '#FFFFFF',
        fontFamily: fontStack, fontSize: base, color: C.text, boxSizing: 'border-box', overflow: 'hidden',
      }}>
        <style>{PRINT_CSS}</style>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead><tr><td style={{ padding: 0, height: `${TOP_GAP_MM}mm` }} /></tr></thead>
          <tfoot><tr><td style={{ padding: 0, height: `${footerMm + 4}mm` }} /></tr></tfoot>
          <tbody><tr style={{ breakInside: 'auto' }}><td style={{ padding: 0 }}>
            {/* Page 1 starts flush with the paper edge; the spacer above only matters on later pages. */}
            <div style={{ marginTop: `-${TOP_GAP_MM}mm` }}>{Header}</div>
            {DetailsPanel}
            {Table}
            <div style={{ display: 'flex', gap: '5mm', margin: '4mm 12mm 0', alignItems: 'flex-start', justifyContent: 'flex-end', breakInside: 'avoid' }}>
              {SidePanel}
              {Totals}
            </div>
            {Closing}
          </td></tr></tbody>
        </table>
        {Footer}
      </div>
    </FitToWidth>
  );
}
