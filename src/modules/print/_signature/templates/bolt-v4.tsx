/**
 * StockBolt "Bolt v4" print templates — June 2026.
 *
 * Implements Rashid's v4 PDF designs (files.zip):
 *   - StockBolt_Invoice_v4.pdf         → BoltDocTemplate      (gold)
 *   - StockBolt_Receipt_v4.pdf         → BoltReceiptTemplate  (green)
 *   - StockBolt_PaymentVoucher_v4.pdf  → BoltVoucherTemplate  (gold + authorisation)
 *
 * Shared anatomy (all three):
 *   ┌──────────────────────────────────────────────────────────────┐
 *   │ NAVY BAND: logo chip · company · "To:" party │ TITLE + meta  │
 *   ├──────────────────────────────────────────────────────────────┤
 *   │ ACCENT STRIP (gold/green): address · TRN                      │
 *   │ info rows           │ PAYMENT METHOD block                    │
 *   │ NAVY-HEADER items table with zebra rows                       │
 *   │ terms / words / confirmation │ totals + COLOURED TOTAL BAR    │
 *   │ icon footer · signatory │ navy baseline strip                 │
 *   └──────────────────────────────────────────────────────────────┘
 *
 * Self-contained page wrapper (zero padding — the navy band is
 * full-bleed) but reuses the `signature-page` class so print.css
 * isolation / A4 rules apply unchanged.
 */
import type { CSSProperties, ReactNode } from 'react';
import { Watermark } from '../components';
import type { DocumentData } from '../types';
import type { PrintConfig } from '@/data/adapter';

// ── Palette (sampled from the v4 PDFs) ─────────────────────────────────────
const C = {
  navy:      '#1F2A5E',
  navyDeep:  '#172048',
  gold:      '#F5C242',
  goldDeep:  '#E2AD22',
  green:     '#1E8E50',
  greenSoft: '#E8F5EE',
  ink:       '#1F2937',
  inkMuted:  '#6B7280',
  inkFaint:  '#9CA3AF',
  headLabel: '#9AA3CC',   // muted label on navy
  zebra:     '#F4F6FA',
  hairline:  '#E5E8F0',
  paper:     '#FFFFFF',
};

const FONT = `'Inter', system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif`;
const MONO = `'JetBrains Mono', 'SF Mono', ui-monospace, monospace`;

type Variant = 'doc' | 'receipt' | 'voucher';

/** The StockBolt Signature accent is the gold (#F5C242) on EVERY document
 *  type — invoices, receipts, vouchers, POs, notes. Locked by owner choice
 *  (2026-06-13): one consistent gold + navy look, no per-doc recolouring.
 *  `config` kept in the signature for footer/toggles, not colour. */
function resolveAccent(_variant: Variant, _config?: PrintConfig) {
  return C.gold;
}

/** Pick navy or white text for legibility on top of an arbitrary accent
 *  fill (relative luminance threshold). Gold → navy, violet → white. */
function textOn(hex: string): string {
  const h = hex.replace('#', '');
  const r = parseInt(h.slice(0, 2), 16), g = parseInt(h.slice(2, 4), 16), b = parseInt(h.slice(4, 6), 16);
  const lum = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return lum > 0.6 ? C.navy : '#FFFFFF';
}

function fmt(n: number) {
  return n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function fmtDate(iso?: string | null) {
  if (!iso) return '—';
  const d = new Date(iso + (iso.length === 10 ? 'T00:00:00' : ''));
  if (isNaN(d.getTime())) return iso;
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });
}

// ── Amount in words (voucher) ───────────────────────────────────────────────
const ONES = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten',
  'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen'];
const TENS = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];

function threeDigits(n: number): string {
  const h = Math.floor(n / 100), r = n % 100;
  const parts: string[] = [];
  if (h) parts.push(`${ONES[h]} Hundred`);
  if (r >= 20) parts.push(TENS[Math.floor(r / 10)] + (r % 10 ? `-${ONES[r % 10]}` : ''));
  else if (r) parts.push(ONES[r]);
  return parts.join(' ');
}

export function amountInWords(n: number, currency: string): string {
  const whole = Math.floor(Math.abs(n));
  const cents = Math.round((Math.abs(n) - whole) * 100);
  if (whole === 0 && cents === 0) return 'Zero';
  const groups: Array<[number, string]> = [
    [1_000_000_000, 'Billion'], [1_000_000, 'Million'], [1_000, 'Thousand'], [1, ''],
  ];
  let rest = whole;
  const parts: string[] = [];
  for (const [div, label] of groups) {
    const q = Math.floor(rest / div);
    if (q) { parts.push(`${threeDigits(q)}${label ? ` ${label}` : ''}`); rest %= div; }
  }
  const unit = currency === 'AED' ? 'UAE Dirhams' : currency;
  const centUnit = currency === 'AED' ? 'Fils' : 'Cents';
  let out = `${parts.join(' ')} ${unit}`;
  if (cents) out += ` and ${threeDigits(cents)} ${centUnit}`;
  return `${out} Only`;
}

// ── Small shared pieces ─────────────────────────────────────────────────────
function HeadMetaRow({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'flex-end', alignItems: 'baseline', gap: '12px', padding: '4px 0' }}>
      <span style={{ fontSize: '10.5px', color: C.headLabel }}>{label}</span>
      <span style={{ fontSize: '11.5px', fontWeight: 700, color: '#fff', minWidth: '110px', textAlign: 'end' }}>{value}</span>
    </div>
  );
}

function InfoRow({ label, value }: { label: string; value?: string | null }) {
  return (
    <div style={{ display: 'flex', gap: '10px', padding: '5px 0', fontSize: '11.5px' }}>
      <span style={{ width: '78px', flexShrink: 0, color: C.inkFaint }}>{label}:</span>
      <span style={{ color: C.ink }}>{value || '—'}</span>
    </div>
  );
}

function PayRow({ label, value }: { label: string; value?: string | null }) {
  return (
    <div style={{ display: 'flex', gap: '10px', padding: '5px 0', fontSize: '11.5px' }}>
      <span style={{ width: '96px', flexShrink: 0, color: C.inkFaint }}>{label}:</span>
      <span style={{ color: C.ink, fontWeight: 700 }}>{value || '—'}</span>
    </div>
  );
}

function TotRow({ label, value, mono = true }: { label: string; value: string; mono?: boolean }) {
  return (
    <div style={{
      display: 'flex', justifyContent: 'space-between', alignItems: 'baseline',
      padding: '7px 14px', borderTop: `1px solid ${C.hairline}`, fontSize: '11.5px',
    }}>
      <span style={{ color: C.inkMuted }}>{label}</span>
      <span style={{ fontFamily: mono ? MONO : FONT, fontWeight: 700, color: C.ink }}>{value}</span>
    </div>
  );
}

function SectionHead({ children }: { children: ReactNode }) {
  return (
    <div style={{ fontSize: '11.5px', fontWeight: 700, color: C.navy, letterSpacing: '.02em', marginBottom: '8px' }}>
      {children}
    </div>
  );
}

const thStyle = (align: 'start' | 'end' | 'center'): CSSProperties => ({
  padding: '10px 12px', fontSize: '10.5px', fontWeight: 700, color: '#fff',
  textTransform: 'uppercase', letterSpacing: '.04em', textAlign: align, whiteSpace: 'nowrap',
});
const tdStyle = (align: 'start' | 'end' | 'center'): CSSProperties => ({
  padding: '10px 12px', fontSize: '11.5px', color: C.ink, textAlign: align,
});

// ── Frame: everything except the items table + bottom-left block ───────────
function Frame({
  data, variant, bigTitle, toLabel, metaRows, stripNote, leftRows, payRows,
  table, bottomLeft, totals, config,
}: {
  data: DocumentData;
  variant: Variant;
  bigTitle: string;
  toLabel: string;
  metaRows: Array<[string, string]>;
  stripNote: string;
  leftRows: Array<[string, string | null | undefined]>;
  payRows: Array<[string, string | null | undefined]>;
  table: ReactNode;
  bottomLeft: ReactNode;
  totals: ReactNode;
  config?: PrintConfig;
}) {
  const acc = resolveAccent(variant, config);
  const onAcc = textOn(acc);
  const showWatermark = data.status === 'draft' || data.status === 'void';
  const co = data.company;
  const party = data.bill_to;
  const addressLine = [co.address, co.city, co.country].filter(Boolean).join(', ');
  // Footer line: user's Print Settings footer wins; else the default credit.
  const footerLine = config?.footer_en?.trim()
    || `${co.website ? `${co.website}  ·  ` : ''}Generated by StockBolt ERP  ·  Computer-generated document`;

  return (
    <div
      className="signature-page"
      style={{
        position: 'relative', width: '210mm', minHeight: '297mm',
        margin: '0 auto', background: C.paper, fontFamily: FONT, color: C.ink,
        boxShadow: '0 1px 0 rgba(15,23,42,.04), 0 12px 32px -8px rgba(15,23,42,.10)',
        overflow: 'hidden', display: 'flex', flexDirection: 'column',
      }}
    >
      {showWatermark && <Watermark text={data.status === 'void' ? 'VOID' : 'DRAFT'} />}

      {/* ── Navy header band ─────────────────────────────────────────── */}
      <div style={{ background: C.navy, color: '#fff', padding: '20px 26px 18px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: '24px' }}>
          {/* Left: logo + company, then party */}
          <div style={{ minWidth: 0 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
              <div style={{
                width: '46px', height: '46px', background: acc, borderRadius: '4px',
                display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden', flexShrink: 0,
              }}>
                {co.logo_url
                  ? <img src={co.logo_url} alt="" style={{ width: '100%', height: '100%', objectFit: 'contain' }} />
                  : <span style={{ fontSize: '24px', fontWeight: 800, color: C.navy }}>{(co.name || 'S').charAt(0)}</span>}
              </div>
              <div>
                <div style={{ fontSize: '16px', fontWeight: 700, letterSpacing: '-.01em' }}>{co.name}</div>
                <div style={{ fontSize: '10px', color: C.headLabel, marginTop: '1px' }}>Auto Parts ERP</div>
              </div>
            </div>
            <div style={{ marginTop: '16px' }}>
              <div style={{ fontSize: '10px', color: C.headLabel, marginBottom: '5px' }}>{toLabel}</div>
              <div style={{ fontSize: '14px', fontWeight: 700 }}>{party.name}</div>
              {party.contact && <div style={{ fontSize: '11px', color: C.headLabel, marginTop: '4px' }}>{party.contact}</div>}
              {(party.address || party.city) && (
                <div style={{ fontSize: '11px', color: C.headLabel, marginTop: '3px' }}>
                  {[party.address, party.city].filter(Boolean).join(', ')}
                </div>
              )}
            </div>
          </div>

          {/* Right: big title + diagonal motif + meta */}
          <div style={{ flexShrink: 0, textAlign: 'end' }}>
            <div style={{ position: 'relative', display: 'inline-block' }}>
              {/* Diagonal stripe motif behind the title */}
              <div aria-hidden style={{
                position: 'absolute', insetInlineEnd: '-6px', top: '-8px',
                width: '52px', height: '52px', background: acc,
                transform: 'skewX(-18deg)', opacity: 0.9,
              }} />
              <div aria-hidden style={{
                position: 'absolute', insetInlineEnd: '-26px', top: '-8px',
                width: '14px', height: '52px', background: 'rgba(255,255,255,.22)',
                transform: 'skewX(-18deg)',
              }} />
              <div style={{
                position: 'relative', fontSize: bigTitle.length > 12 ? '26px' : '34px',
                fontWeight: 800, letterSpacing: '.02em',
                color: acc,
                textTransform: 'uppercase', whiteSpace: 'nowrap',
              }}>{bigTitle}</div>
            </div>
            <div style={{ marginTop: '14px' }}>
              {metaRows.map(([l, v]) => <HeadMetaRow key={l} label={l} value={v} />)}
            </div>
          </div>
        </div>
      </div>

      {/* ── Accent strip ─────────────────────────────────────────────── */}
      <div style={{
        background: acc, color: onAcc, padding: '9px 26px',
        display: 'flex', alignItems: 'center', gap: '10px',
      }}>
        <span style={{
          width: '18px', height: '18px', borderRadius: '50%', background: C.navy, color: '#fff',
          display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
          fontSize: '10px', fontWeight: 700, fontStyle: 'italic', flexShrink: 0,
        }}>i</span>
        <span style={{ fontSize: '11px', fontWeight: 700 }}>
          {addressLine}{stripNote ? `  ·  ${stripNote}` : ''}
        </span>
      </div>

      {/* ── Body ─────────────────────────────────────────────────────── */}
      <div style={{ padding: '18px 26px 0', flex: 1 }}>
        {/* info row + payment method */}
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: '32px' }}>
          <div style={{ flex: 1 }}>
            {leftRows.map(([l, v]) => <InfoRow key={l} label={l} value={v} />)}
          </div>
          {payRows.length > 0 && (
            <div style={{ width: '46%' }}>
              <div style={{
                fontSize: '12px', fontWeight: 700, color: C.navy,
                borderBottom: `1.5px solid ${C.navy}`, paddingBottom: '6px', marginBottom: '6px',
              }}>PAYMENT METHOD</div>
              {payRows.map(([l, v]) => <PayRow key={l} label={l} value={v} />)}
            </div>
          )}
        </div>

        {/* items / allocations table */}
        <div style={{ marginTop: '18px' }}>{table}</div>

        {/* bottom: left block + totals */}
        <div style={{ marginTop: '18px', display: 'flex', justifyContent: 'space-between', gap: '32px' }}>
          <div style={{ flex: 1, minWidth: 0 }}>{bottomLeft}</div>
          <div style={{ width: '46%', flexShrink: 0 }}>{totals}</div>
        </div>
      </div>

      {/* ── Footer ───────────────────────────────────────────────────── */}
      <div style={{ padding: '14px 26px 0', marginTop: '18px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', gap: '24px' }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '6px 28px' }}>
            {[
              ['☎', co.phone], ['✉', co.email],
              ['🌐', co.website], ['📍', [co.city, co.country].filter(Boolean).join(', ') || co.address],
            ].filter(([, v]) => v).map(([icon, v]) => (
              <div key={String(icon) + String(v)} style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '10.5px', color: C.ink }}>
                <span style={{
                  width: '18px', height: '18px', borderRadius: '50%', background: acc, color: onAcc,
                  display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: '9px', flexShrink: 0,
                }}>{icon}</span>
                {v}
              </div>
            ))}
          </div>
          <div style={{ textAlign: 'end', minWidth: '180px' }}>
            <div style={{ borderTop: `1.5px solid ${C.navy}`, paddingTop: '6px', fontSize: '12px', fontWeight: 700, color: C.navy }}>
              {data.signed_by || 'Authorised Signatory'}
            </div>
            <div style={{ fontSize: '9.5px', color: C.inkFaint, marginTop: '2px' }}>{co.name}</div>
          </div>
        </div>
      </div>
      <div style={{
        marginTop: '12px', background: C.navy, color: 'rgba(255,255,255,.75)',
        textAlign: 'center', fontSize: '9px', padding: '7px 0', letterSpacing: '.03em',
      }}>
        {footerLine}
      </div>
      <div aria-hidden style={{ height: '4px', background: acc }} />
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════════════
// 1. BoltDocTemplate — invoice / quote / PO / CN / DN / GRN / expense
// ════════════════════════════════════════════════════════════════════════════
const TYPE_TITLES: Record<string, string> = {
  tax_invoice: 'Invoice', standard_invoice: 'Invoice', proforma_invoice: 'Proforma',
  quotation: 'Quotation', delivery_note: 'Delivery Note', purchase_order: 'Purchase Order',
  credit_note: 'Credit Note', payment_receipt: 'Receipt',
};

export function BoltDocTemplate({ data, config }: { data: DocumentData; config?: PrintConfig }) {
  const title = data.title ?? TYPE_TITLES[data.type] ?? 'Invoice';
  const cur = data.currency;
  const hasDiscount = (data.discount_total ?? 0) > 0.005;
  const taxRate = data.vat_breakdown?.[0]?.rate;
  const acc = resolveAccent('doc', config);
  const onAcc = textOn(acc);
  const showBank = config?.show_bank_details !== false;
  const showDue = config?.show_due_date !== false;

  const table = (
    <table style={{ width: '100%', borderCollapse: 'collapse' }}>
      <thead>
        <tr style={{ background: C.navy }}>
          <th style={thStyle('start')}>Description</th>
          <th style={{ ...thStyle('end'), width: '90px' }}>Unit Price</th>
          <th style={{ ...thStyle('center'), width: '54px' }}>Qty</th>
          <th style={{ ...thStyle('end'), width: '110px' }}>Subtotal</th>
        </tr>
      </thead>
      <tbody>
        {data.items.map((it, i) => (
          <tr key={i} style={{ background: i % 2 === 0 ? C.zebra : C.paper }}>
            <td style={tdStyle('start')}>
              {it.sku && <span style={{ color: C.inkMuted, fontFamily: MONO, fontSize: '10px', marginInlineEnd: '8px' }}>{it.sku}</span>}
              {it.description}
            </td>
            <td style={{ ...tdStyle('end'), fontFamily: MONO }}>{fmt(it.unit_price)}</td>
            <td style={{ ...tdStyle('center'), fontWeight: 700 }}>{it.quantity}</td>
            <td style={{ ...tdStyle('end'), fontFamily: MONO, fontWeight: 700 }}>{fmt(it.line_total)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );

  const bottomLeft = (
    <>
      {data.terms && (
        <>
          <SectionHead>TERMS AND CONDITIONS</SectionHead>
          <p style={{ margin: 0, fontSize: '10.5px', color: C.inkFaint, lineHeight: 1.7, whiteSpace: 'pre-line' }}>{data.terms}</p>
        </>
      )}
      {data.notes && (
        <p style={{ margin: '10px 0 0', fontSize: '10.5px', color: C.inkFaint, lineHeight: 1.7, whiteSpace: 'pre-line' }}>{data.notes}</p>
      )}
      <div style={{ marginTop: '16px', fontSize: '12px', fontWeight: 700, color: C.navy }}>
        THANK YOU FOR YOUR BUSINESS
      </div>
    </>
  );

  const totals = (
    <div>
      <TotRow label="Sub-total:" value={`${cur} ${fmt(data.subtotal)}`} />
      {hasDiscount && <TotRow label="Discount:" value={`${cur} ${fmt(data.discount_total!)}`} />}
      <TotRow label={taxRate != null ? `Tax (${taxRate}%):` : 'Tax:'} value={`${cur} ${fmt(data.tax_total)}`} />
      <div style={{
        marginTop: '10px', background: acc, color: onAcc,
        display: 'flex', justifyContent: 'space-between', alignItems: 'center',
        padding: '11px 14px',
      }}>
        <span style={{ fontSize: '13px', fontWeight: 800 }}>Total:</span>
        <span style={{ fontSize: '15px', fontWeight: 800, fontFamily: MONO }}>{cur} {fmt(data.grand_total)}</span>
      </div>
      {(data.paid_amount ?? 0) > 0.005 && (
        <>
          <TotRow label="Paid:" value={`${cur} ${fmt(data.paid_amount!)}`} />
          <TotRow label="Balance Due:" value={`${cur} ${fmt(data.balance_due ?? (data.grand_total - data.paid_amount!))}`} />
        </>
      )}
    </div>
  );

  return (
    <Frame
      data={data}
      variant="doc"
      bigTitle={title}
      toLabel={data.type === 'purchase_order' ? 'Supplier:' : 'Invoice To:'}
      metaRows={[
        [`${title} No:`, `#${data.number}`],
        ...(showDue && data.due_date ? [['Due Date:', fmtDate(data.due_date)] as [string, string]] : []),
        [`${title} Date:`, fmtDate(data.date)],
        ...(data.reference ? [['Reference:', data.reference] as [string, string]] : []),
      ]}
      stripNote={data.company.trn ? `TRN: ${data.company.trn}` : ''}
      leftRows={[
        ['Phone',   data.bill_to.phone],
        ['Email',   data.bill_to.email],
        ['Address', [data.bill_to.address, data.bill_to.city].filter(Boolean).join(', ')],
        ...(data.bill_to.trn ? [['TRN', data.bill_to.trn] as [string, string]] : []),
      ]}
      payRows={showBank && data.banking ? [
        ['Account No',   data.banking.account_number ?? data.banking.iban],
        ['Account Name', data.banking.account_name],
        ['Bank Name',    data.banking.bank_name],
      ] : []}
      config={config}
      table={table}
      bottomLeft={bottomLeft}
      totals={totals}
    />
  );
}

// ════════════════════════════════════════════════════════════════════════════
// 2. BoltReceiptTemplate — customer payment (green)
// ════════════════════════════════════════════════════════════════════════════
export function BoltReceiptTemplate({ data, config }: { data: DocumentData; config?: PrintConfig }) {
  const cur = data.currency;
  const acc = resolveAccent('receipt', config);
  const onAcc = textOn(acc);
  const allocs = data.allocations ?? [];
  const allocated = allocs.reduce((s, a) => s + a.applied_amount + (a.discount_amount ?? 0), 0);
  const unallocated = Math.max(0, data.grand_total - allocated);
  const hasOriginals = allocs.some(a => (a.original_amount ?? 0) > 0);
  const balanceOut = hasOriginals
    ? allocs.reduce((s, a) => s + Math.max(0, (a.original_amount ?? 0) - a.applied_amount - (a.discount_amount ?? 0)), 0)
    : null;

  const table = (
    <table style={{ width: '100%', borderCollapse: 'collapse' }}>
      <thead>
        <tr style={{ background: C.navy }}>
          <th style={thStyle('start')}>Applied To</th>
          <th style={{ ...thStyle('end'), width: '100px' }}>Doc Date</th>
          <th style={{ ...thStyle('end'), width: '100px' }}>Discount</th>
          <th style={{ ...thStyle('end'), width: '120px' }}>Amount</th>
        </tr>
      </thead>
      <tbody>
        {allocs.length === 0 ? (
          <tr style={{ background: C.zebra }}>
            <td style={tdStyle('start')}>Advance payment on account</td>
            <td style={{ ...tdStyle('end'), fontFamily: MONO }}>—</td>
            <td style={{ ...tdStyle('end'), fontFamily: MONO }}>—</td>
            <td style={{ ...tdStyle('end'), fontFamily: MONO, fontWeight: 700, color: acc }}>{fmt(data.grand_total)}</td>
          </tr>
        ) : allocs.map((a, i) => (
          <tr key={i} style={{ background: i % 2 === 0 ? C.zebra : C.paper }}>
            <td style={tdStyle('start')}>Invoice {a.doc_number}</td>
            <td style={{ ...tdStyle('end'), fontFamily: MONO }}>{a.doc_date ?? '—'}</td>
            <td style={{ ...tdStyle('end'), fontFamily: MONO }}>{(a.discount_amount ?? 0) > 0 ? fmt(a.discount_amount!) : '—'}</td>
            <td style={{ ...tdStyle('end'), fontFamily: MONO, fontWeight: 700, color: acc }}>{fmt(a.applied_amount)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );

  const bottomLeft = (
    <>
      <SectionHead>PAYMENT CONFIRMATION</SectionHead>
      <p style={{ margin: 0, fontSize: '10.5px', color: C.inkFaint, lineHeight: 1.7 }}>
        Payment received{data.payment_method ? ` via ${data.payment_method.toLowerCase()}` : ''}.
        {data.reference ? `\nTransaction Ref: ${data.reference}` : ''}
      </p>
      {data.notes && (
        <p style={{ margin: '8px 0 0', fontSize: '10.5px', color: C.inkFaint, lineHeight: 1.7, whiteSpace: 'pre-line' }}>{data.notes}</p>
      )}
      <div style={{ marginTop: '16px', fontSize: '12px', fontWeight: 700, color: C.navy }}>
        THANK YOU FOR YOUR BUSINESS
      </div>
    </>
  );

  const totals = (
    <div>
      {allocs.length > 0 && <TotRow label="Allocated to invoices:" value={`${cur} ${fmt(allocated)}`} />}
      {unallocated > 0.005 && <TotRow label="Unallocated (advance):" value={`${cur} ${fmt(unallocated)}`} />}
      <div style={{
        marginTop: '10px', background: acc, color: onAcc,
        display: 'flex', justifyContent: 'space-between', alignItems: 'center',
        padding: '11px 14px',
      }}>
        <span style={{ fontSize: '13px', fontWeight: 800 }}>Total Paid:</span>
        <span style={{ fontSize: '15px', fontWeight: 800, fontFamily: MONO }}>{cur} {fmt(data.grand_total)}</span>
      </div>
      {balanceOut !== null && (
        <div style={{
          marginTop: '8px', background: C.greenSoft, color: C.green,
          display: 'flex', justifyContent: 'space-between', alignItems: 'center',
          padding: '8px 14px', fontSize: '11.5px', fontWeight: 700,
        }}>
          <span>Balance Outstanding:</span>
          <span style={{ fontFamily: MONO }}>{cur} {fmt(balanceOut)}</span>
        </div>
      )}
    </div>
  );

  return (
    <Frame
      data={data}
      variant="receipt"
      bigTitle="Receipt"
      toLabel="Received From:"
      metaRows={[
        ['Receipt No:', `#${data.number}`],
        ['Date Paid:', fmtDate(data.date)],
        ...(allocs[0]?.doc_number ? [['Ref Invoice:', allocs[0].doc_number] as [string, string]] : []),
      ]}
      stripNote={data.status === 'confirmed' ? 'Payment Confirmed ✓' : ''}
      leftRows={[
        ['Phone',   data.bill_to.phone],
        ['Email',   data.bill_to.email],
        ['Address', [data.bill_to.address, data.bill_to.city].filter(Boolean).join(', ')],
      ]}
      payRows={[
        ['Txn Ref',      data.reference],
        ['Bank Account', data.bank_account],
        ['Mode',         data.payment_method],
      ]}
      config={config}
      table={table}
      bottomLeft={bottomLeft}
      totals={totals}
    />
  );
}

// ════════════════════════════════════════════════════════════════════════════
// 3. BoltVoucherTemplate — vendor payment (gold + authorisation)
// ════════════════════════════════════════════════════════════════════════════
export function BoltVoucherTemplate({ data, config }: { data: DocumentData; config?: PrintConfig }) {
  const cur = data.currency;
  const acc = resolveAccent('voucher', config);
  const onAcc = textOn(acc);
  const allocs = data.allocations ?? [];
  const totalInvoiced = allocs.reduce((s, a) => s + (a.original_amount ?? a.applied_amount), 0);
  const totalDiscount = allocs.reduce((s, a) => s + (a.discount_amount ?? 0), 0);

  const table = (
    <table style={{ width: '100%', borderCollapse: 'collapse' }}>
      <thead>
        <tr style={{ background: C.navy }}>
          <th style={thStyle('start')}>Description / Ref</th>
          <th style={{ ...thStyle('end'), width: '110px' }}>Inv Amount</th>
          <th style={{ ...thStyle('end'), width: '100px' }}>Discount</th>
          <th style={{ ...thStyle('end'), width: '120px' }}>Net Paying</th>
        </tr>
      </thead>
      <tbody>
        {allocs.length === 0 ? (
          <tr style={{ background: C.zebra }}>
            <td style={tdStyle('start')}>Advance payment to supplier</td>
            <td style={{ ...tdStyle('end'), fontFamily: MONO }}>—</td>
            <td style={{ ...tdStyle('end'), fontFamily: MONO }}>—</td>
            <td style={{ ...tdStyle('end'), fontFamily: MONO, fontWeight: 700 }}>{fmt(data.grand_total)}</td>
          </tr>
        ) : allocs.map((a, i) => (
          <tr key={i} style={{ background: i % 2 === 0 ? C.zebra : C.paper }}>
            <td style={tdStyle('start')}>Bill {a.doc_number}{a.doc_date ? ` — ${a.doc_date}` : ''}</td>
            <td style={{ ...tdStyle('end'), fontFamily: MONO }}>{fmt(a.original_amount ?? a.applied_amount)}</td>
            <td style={{ ...tdStyle('end'), fontFamily: MONO, color: (a.discount_amount ?? 0) > 0 ? '#C2410C' : C.ink }}>
              {fmt(a.discount_amount ?? 0)}
            </td>
            <td style={{ ...tdStyle('end'), fontFamily: MONO, fontWeight: 700 }}>{fmt(a.applied_amount)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );

  const bottomLeft = (
    <>
      <SectionHead>AMOUNT IN WORDS</SectionHead>
      <p style={{ margin: 0, fontSize: '10.5px', color: C.inkFaint, lineHeight: 1.7 }}>
        {amountInWords(data.grand_total, cur)} ({cur} {fmt(data.grand_total)})
      </p>
      <div style={{ marginTop: '20px' }}>
        <SectionHead>AUTHORISATION</SectionHead>
        <div style={{ display: 'flex', gap: '24px', marginTop: '26px' }}>
          {['Prepared By', 'Approved By', 'Received By'].map(role => (
            <div key={role} style={{ flex: 1 }}>
              <div style={{ borderTop: `1px solid ${C.ink}` }} />
              <div style={{ fontSize: '9.5px', color: C.inkFaint, marginTop: '5px' }}>{role}</div>
            </div>
          ))}
        </div>
      </div>
    </>
  );

  const totals = (
    <div>
      {allocs.length > 0 && (
        <>
          <TotRow label="Total Invoiced:" value={`${cur} ${fmt(totalInvoiced)}`} />
          <TotRow label="Total Discount:" value={`${cur} ${fmt(totalDiscount)}`} />
        </>
      )}
      <div style={{
        marginTop: '10px', background: acc, color: onAcc,
        display: 'flex', justifyContent: 'space-between', alignItems: 'center',
        padding: '11px 14px',
      }}>
        <span style={{ fontSize: '13px', fontWeight: 800 }}>Total Payment:</span>
        <span style={{ fontSize: '15px', fontWeight: 800, fontFamily: MONO }}>{cur} {fmt(data.grand_total)}</span>
      </div>
    </div>
  );

  return (
    <Frame
      data={data}
      variant="voucher"
      bigTitle="Payment Voucher"
      toLabel="Paid To:"
      metaRows={[
        ['Voucher No:', `#${data.number}`],
        ['Payment Date:', fmtDate(data.date)],
        ...(allocs[0]?.doc_number ? [['Ref Bill:', allocs[0].doc_number] as [string, string]] : []),
      ]}
      stripNote={data.company.trn ? `TRN: ${data.company.trn}` : ''}
      leftRows={[
        ['Mode',      data.payment_method],
        ['Reference', data.reference],
        ['Address',   [data.bill_to.address, data.bill_to.city].filter(Boolean).join(', ')],
      ]}
      payRows={[
        ['Account No',   data.banking?.account_number ?? data.banking?.iban ?? data.bank_account],
        ['Account Name', data.banking?.account_name],
        ['Bank Name',    data.banking?.bank_name],
      ]}
      config={config}
      table={table}
      bottomLeft={bottomLeft}
      totals={totals}
    />
  );
}
