/**
 * Signature print template shared components — Phase 14.01.
 *
 * Reusable building blocks that compose into the 8 document types.
 * Each block is intentionally pure (props in → JSX out) so the same
 * component renders identically on screen, in print, and (later) inside
 * react-pdf if we go down that path.
 */
import { type ReactNode, type CSSProperties } from 'react';
import { tokens, hairlineStyle, numericStyle } from './tokens';
import type {
  CompanyInfo, PartyInfo, LineItem, DocumentStatus,
  BankingDetails,
} from './types';
import { getTaxLabels, formatDate } from '@/lib/locale';

// ──────────────────────────────────────────────────────────────────────────
// Page shell
// ──────────────────────────────────────────────────────────────────────────

/**
 * Outer page frame with the 4mm indigo accent strip running the full
 * left edge. Every Signature document renders inside one of these.
 *
 * In screen preview the page floats on a slate-50 canvas with a soft
 * elevation. In print the canvas is invisible and the page fills the
 * paper edge-to-edge with the strip extending into the margin.
 */
export function SignaturePage({ children }: { children: ReactNode }) {
  return (
    <div
      className="signature-page"
      style={{
        position: 'relative',
        width: tokens.pageWidth,
        minHeight: tokens.pageHeight,
        background: tokens.paper,
        fontFamily: tokens.fontStack,
        color: tokens.ink,
        fontSize: tokens.fsBody,
        lineHeight: tokens.lhSnug,
        boxShadow: tokens.pageElevation,
        margin: '0 auto',
        padding: `${tokens.pagePadTop} ${tokens.pagePadRight} ${tokens.pagePadBottom} ${tokens.pagePadLeft}`,
        overflow: 'hidden',
      }}
    >
      {/* The signature accent strip — runs floor to ceiling. */}
      <div
        aria-hidden
        style={{
          position: 'absolute',
          top: 0, bottom: 0, left: 0,
          width: tokens.accentStripWidth,
          background: tokens.brand,
        }}
      />
      {children}
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────────────
// Section primitive — a tiny labelled region
// ──────────────────────────────────────────────────────────────────────────

export function SectionLabel({ children, style }: { children: ReactNode; style?: CSSProperties }) {
  return (
    <div style={{
      fontSize: tokens.fsSectionLabel,
      fontWeight: tokens.wBold,
      color: tokens.inkMuted,
      textTransform: 'uppercase',
      letterSpacing: tokens.trkLabel,
      ...style,
    }}>{children}</div>
  );
}

// ──────────────────────────────────────────────────────────────────────────
// Company block (top-left of every document)
// ──────────────────────────────────────────────────────────────────────────

export function CompanyBlock({ company }: { company: CompanyInfo }) {
  const { registrationName } = getTaxLabels(company.country);
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: tokens.gap2 }}>
      {company.logo_url && (
        <img
          src={company.logo_url}
          alt=""
          style={{ height: '40px', width: 'auto', objectFit: 'contain', marginBottom: tokens.gap1 }}
        />
      )}
      <div style={{ fontSize: tokens.fsCompanyName, fontWeight: tokens.wBold, letterSpacing: tokens.trkTight, color: tokens.ink }}>
        {company.name}
      </div>
      {company.address && (
        <div style={{ fontSize: tokens.fsBodySmall, color: tokens.inkMuted, lineHeight: tokens.lhSnug, maxWidth: '70mm' }}>
          {[company.address, company.city, company.country].filter(Boolean).join(', ')}
        </div>
      )}
      <div style={{ fontSize: tokens.fsBodyMicro, color: tokens.inkFaint, display: 'flex', gap: tokens.gap2, flexWrap: 'wrap' }}>
        {company.phone   && <span>{company.phone}</span>}
        {company.email   && <span>·  {company.email}</span>}
        {company.website && <span>·  {company.website}</span>}
      </div>
      {company.trn && (
        <div style={{ fontSize: tokens.fsBodySmall, color: tokens.ink, marginTop: tokens.gap1 }}>
          <span style={{ fontWeight: tokens.wSemi, letterSpacing: tokens.trkLabel, fontSize: tokens.fsBodyMicro }}>{registrationName}&nbsp;</span>
          <span style={numericStyle}>{company.trn}</span>
        </div>
      )}
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────────────
// Stamp card (top-right) — the signature mark of every document
// ──────────────────────────────────────────────────────────────────────────

const STATUS_TONE: Record<DocumentStatus, { dot: string; soft: string; label: string }> = {
  draft:          { dot: tokens.statusDraft,     soft: tokens.statusDraftSoft,     label: 'Draft' },
  confirmed:      { dot: tokens.statusConfirmed, soft: tokens.statusConfirmedSoft, label: 'Confirmed' },
  sent:           { dot: tokens.brand,           soft: tokens.brandSoft,           label: 'Sent' },
  accepted:       { dot: tokens.statusConfirmed, soft: tokens.statusConfirmedSoft, label: 'Accepted' },
  paid:           { dot: tokens.statusPaid,      soft: tokens.statusPaidSoft,      label: 'Paid' },
  partially_paid: { dot: tokens.statusOverdue,   soft: tokens.statusOverdueSoft,   label: 'Partially paid' },
  overdue:        { dot: tokens.statusVoid,      soft: tokens.statusVoidSoft,      label: 'Overdue' },
  void:           { dot: tokens.statusVoid,      soft: tokens.statusVoidSoft,      label: 'Void' },
};

export function StampCard({
  title, number, status, date, dueDate,
}: {
  title: string;
  number: string;
  status: DocumentStatus;
  date: string;
  dueDate?: string | null;
}) {
  const tone = STATUS_TONE[status];
  return (
    <div style={{
      background: tokens.surfaceStamp,
      color: tokens.stampInk,
      padding: '14px 18px',
      borderRadius: tokens.radius,
      minWidth: '64mm',
      maxWidth: '76mm',
      display: 'flex', flexDirection: 'column', gap: tokens.gap2,
    }}>
      <div style={{
        fontSize: tokens.fsTitleStamp,
        fontWeight: tokens.wBold,
        letterSpacing: tokens.trkTitle,
        textTransform: 'uppercase',
        color: tokens.stampInk,
        opacity: 0.85,
      }}>{title}</div>
      <div style={{
        fontSize: tokens.fsNumberStamp,
        fontWeight: tokens.wBold,
        letterSpacing: tokens.trkTight,
        color: tokens.stampInk,
        ...numericStyle,
      }}>{number}</div>
      <div style={{
        display: 'flex', alignItems: 'center', gap: tokens.gap2,
        fontSize: tokens.fsMetaStamp,
        color: tokens.stampInk,
        opacity: 0.85,
      }}>
        <span style={{
          width: '7px', height: '7px', borderRadius: '999px',
          background: tone.dot,
          boxShadow: `0 0 0 3px ${tone.soft}33`,
          display: 'inline-block',
        }} />
        <span>{tone.label}</span>
        <span style={{ opacity: 0.5 }}>·</span>
        <span style={numericStyle}>{formatDate(date)}</span>
      </div>
      {dueDate && (
        <div style={{ fontSize: tokens.fsBodyMicro, color: tokens.stampInk, opacity: 0.6 }}>
          Due&nbsp;<span style={numericStyle}>{formatDate(dueDate)}</span>
        </div>
      )}
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────────────
// Party card (Bill To / Ship To)
// ──────────────────────────────────────────────────────────────────────────

export function PartyCard({ label, party }: { label: string; party: PartyInfo }) {
  const partyReg = getTaxLabels(party.country).registrationName;
  return (
    <div style={{
      flex: 1, minWidth: 0,
      padding: '12px 14px',
      background: tokens.surfaceCard,
      border: `1px solid ${tokens.hairline}`,
      borderRadius: tokens.radiusLg,
      display: 'flex', flexDirection: 'column', gap: tokens.gap2,
    }}>
      <SectionLabel>{label}</SectionLabel>
      <div style={{ fontSize: tokens.fsBody, fontWeight: tokens.wSemi, color: tokens.ink, letterSpacing: tokens.trkTight }}>
        {party.name}
      </div>
      {party.address && (
        <div style={{ fontSize: tokens.fsBodySmall, color: tokens.inkMuted, lineHeight: tokens.lhSnug }}>
          {[party.address, party.city, party.country].filter(Boolean).join(', ')}
        </div>
      )}
      {(party.phone || party.email) && (
        <div style={{ fontSize: tokens.fsBodyMicro, color: tokens.inkFaint, display: 'flex', gap: tokens.gap2, flexWrap: 'wrap' }}>
          {party.phone && <span>{party.phone}</span>}
          {party.email && <span>·  {party.email}</span>}
        </div>
      )}
      {party.trn && (
        <div style={{ fontSize: tokens.fsBodySmall, color: tokens.ink, marginTop: tokens.gap1 }}>
          <span style={{ fontWeight: tokens.wSemi, letterSpacing: tokens.trkLabel, fontSize: tokens.fsBodyMicro }}>{partyReg}&nbsp;</span>
          <span style={numericStyle}>{party.trn}</span>
        </div>
      )}
      {party.contact && (
        <div style={{ fontSize: tokens.fsBodyMicro, color: tokens.inkFaint }}>
          Attn:&nbsp;{party.contact}
        </div>
      )}
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────────────
// Items table — borderless, hairline rows, tabular numbers
// ──────────────────────────────────────────────────────────────────────────

function fmt(n: number) {
  return n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export type ItemColumn = 'index' | 'sku' | 'description' | 'qty' | 'unit_price' | 'tax' | 'amount';

export function ItemsTable({
  items, columns, taxName = 'VAT',
}: {
  items: LineItem[];
  columns?: ItemColumn[];
  taxName?: string;   // Issue 5 — 'VAT' (GCC) or 'GST' (India)
}) {
  // Default sales-document column set. Delivery notes pass a hide-prices
  // subset; payment receipts don't use this component at all.
  const cols: ItemColumn[] = columns ?? ['index', 'description', 'qty', 'unit_price', 'tax', 'amount'];
  const headerOf: Record<ItemColumn, string> = {
    index: '#',
    sku: 'SKU',
    description: 'Description',
    qty: 'Qty',
    unit_price: 'Unit price',
    tax: taxName,
    amount: 'Amount',
  };
  const alignOf: Record<ItemColumn, 'start' | 'end'> = {
    index: 'start', sku: 'start', description: 'start',
    qty: 'end', unit_price: 'end', tax: 'end', amount: 'end',
  };
  const widthOf: Record<ItemColumn, string | undefined> = {
    index: '24px', sku: '70px', description: undefined,
    qty: '60px', unit_price: '90px', tax: '60px', amount: '92px',
  };

  return (
    <table style={{
      width: '100%', borderCollapse: 'collapse',
      fontSize: tokens.fsBody, color: tokens.ink,
    }}>
      <thead>
        <tr>
          {cols.map((c) => (
            <th
              key={c}
              style={{
                padding: '6px 8px 8px',
                borderBottom: `1px solid ${tokens.ink}`,
                fontSize: tokens.fsSectionLabel,
                fontWeight: tokens.wBold,
                color: tokens.ink,
                textTransform: 'uppercase',
                letterSpacing: tokens.trkLabel,
                textAlign: alignOf[c],
                width: widthOf[c],
                whiteSpace: 'nowrap',
              }}
            >{headerOf[c]}</th>
          ))}
        </tr>
      </thead>
      <tbody>
        {items.map((it, i) => (
          <tr key={i} style={{ borderBottom: `1px solid ${tokens.hairline}` }}>
            {cols.map((c) => {
              const isNum = c !== 'description' && c !== 'sku';
              const cellStyle: CSSProperties = {
                padding: '10px 8px',
                color: c === 'description' ? tokens.ink : tokens.inkMuted,
                textAlign: alignOf[c],
                verticalAlign: 'top',
                ...(isNum ? numericStyle : {}),
              };
              switch (c) {
                case 'index':
                  return <td key={c} style={{ ...cellStyle, color: tokens.inkFaint, fontSize: tokens.fsBodySmall }}>{it.index ?? i + 1}</td>;
                case 'sku':
                  return <td key={c} style={{ ...cellStyle, fontSize: tokens.fsBodySmall, fontFamily: tokens.fontMono }}>{it.sku ?? '—'}</td>;
                case 'description':
                  return (
                    <td key={c} style={{ ...cellStyle, color: tokens.ink }}>
                      <div style={{ fontWeight: tokens.wMedium }}>{it.description}</div>
                      {it.description_ar && (
                        <div dir="rtl" style={{ fontSize: tokens.fsBodySmall, color: tokens.inkFaint, marginTop: '2px' }}>
                          {it.description_ar}
                        </div>
                      )}
                    </td>
                  );
                case 'qty':
                  return (
                    <td key={c} style={cellStyle}>
                      <span style={{ color: tokens.ink }}>{fmt(it.quantity)}</span>
                      {it.unit_code && <span style={{ color: tokens.inkFaint, marginInlineStart: '4px', fontSize: tokens.fsBodySmall }}>{it.unit_code}</span>}
                    </td>
                  );
                case 'unit_price':
                  return <td key={c} style={cellStyle}>{fmt(it.unit_price)}</td>;
                case 'tax':
                  return <td key={c} style={cellStyle}>{it.tax_rate ?? 0}%</td>;
                case 'amount':
                  return <td key={c} style={{ ...cellStyle, color: tokens.ink, fontWeight: tokens.wMedium }}>{fmt(it.line_total)}</td>;
              }
            })}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

// ──────────────────────────────────────────────────────────────────────────
// Totals ladder + anchor total
// ──────────────────────────────────────────────────────────────────────────

export function TotalLine({ label, amount, currency, muted = false }: {
  label: string; amount: number; currency?: string; muted?: boolean;
}) {
  return (
    <div style={{
      display: 'flex', justifyContent: 'space-between', alignItems: 'baseline',
      padding: '5px 0', gap: tokens.gap6,
      fontSize: tokens.fsBody,
      color: muted ? tokens.inkFaint : tokens.inkMuted,
    }}>
      <span>{label}</span>
      <span style={{ color: muted ? tokens.inkFaint : tokens.ink, fontWeight: tokens.wMedium, ...numericStyle }}>
        {currency ? `${currency} ` : ''}{fmt(amount)}
      </span>
    </div>
  );
}

export function AnchorTotal({ amount, currency, label = 'TOTAL' }: {
  amount: number; currency: string; label?: string;
}) {
  return (
    <div style={{
      marginTop: tokens.gap3,
      padding: '14px 16px',
      border: `2px solid ${tokens.brand}`,
      borderRadius: tokens.radiusLg,
      background: tokens.paper,
      display: 'flex', flexDirection: 'column', gap: tokens.gap1,
      minWidth: '70mm',
    }}>
      <div style={{
        fontSize: tokens.fsSectionLabel,
        fontWeight: tokens.wBold,
        color: tokens.brand,
        textTransform: 'uppercase',
        letterSpacing: tokens.trkLabel,
      }}>{label}</div>
      <div style={{
        display: 'flex', alignItems: 'baseline', gap: tokens.gap2,
      }}>
        <span style={{ fontSize: tokens.fsBodySmall, color: tokens.inkMuted, fontWeight: tokens.wSemi }}>
          {currency}
        </span>
        <span style={{
          fontSize: tokens.fsAnchorAmount,
          fontWeight: tokens.wBold,
          color: tokens.ink,
          letterSpacing: tokens.trkTight,
          ...numericStyle,
        }}>{fmt(amount)}</span>
      </div>
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────────────
// VAT breakdown table (UAE-compliant)
// ──────────────────────────────────────────────────────────────────────────

export function VATBreakdownTable({
  rows, currency, taxName = 'VAT',
}: {
  rows: Array<{ rate: number; taxable: number; tax: number }>;
  currency: string;
  taxName?: string;   // Issue 5 — 'VAT' (GCC) or 'GST' (India)
}) {
  if (rows.length === 0) return null;
  return (
    <div style={{ marginTop: tokens.gap4 }}>
      <SectionLabel>{taxName} Summary</SectionLabel>
      <table style={{ width: '100%', borderCollapse: 'collapse', marginTop: tokens.gap2, fontSize: tokens.fsBodySmall }}>
        <thead>
          <tr>
            {['Rate', 'Taxable', taxName, `Total (${currency})`].map((h, i) => (
              <th key={h} style={{
                padding: '4px 8px', borderBottom: `1px solid ${tokens.hairline}`,
                fontSize: tokens.fsBodyMicro, fontWeight: tokens.wSemi,
                color: tokens.inkMuted, textTransform: 'uppercase', letterSpacing: tokens.trkLabel,
                textAlign: i === 0 ? 'start' : 'end',
              }}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i}>
              <td style={{ padding: '6px 8px', color: tokens.ink }}>{r.rate}%</td>
              <td style={{ padding: '6px 8px', textAlign: 'end', color: tokens.ink, ...numericStyle }}>{fmt(r.taxable)}</td>
              <td style={{ padding: '6px 8px', textAlign: 'end', color: tokens.ink, ...numericStyle }}>{fmt(r.tax)}</td>
              <td style={{ padding: '6px 8px', textAlign: 'end', color: tokens.ink, fontWeight: tokens.wMedium, ...numericStyle }}>
                {fmt(r.taxable + r.tax)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────────────
// Compliance strip (QR + TRN + document-type badge)
// ──────────────────────────────────────────────────────────────────────────

/** Placeholder QR. Real QR codes will be rendered by the host page with a
 *  qrcode lib and passed in as a data URL via `qrSrc`. */
export function QRPanel({ qrSrc, payload }: { qrSrc?: string | null; payload?: string | null }) {
  return (
    <div style={{
      width: '24mm', height: '24mm',
      border: `1px solid ${tokens.hairline}`,
      borderRadius: tokens.radius,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      background: tokens.paper, flexShrink: 0,
    }}>
      {qrSrc
        ? <img src={qrSrc} alt="QR" style={{ width: '100%', height: '100%', objectFit: 'contain' }} />
        : (
          <div style={{
            width: '100%', height: '100%',
            background: `repeating-linear-gradient(45deg, ${tokens.hairline} 0 2px, transparent 2px 5px)`,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>
            <span style={{ fontSize: '8px', color: tokens.inkFaint, padding: '2px 4px', background: tokens.paper }}>
              {payload ? 'QR' : 'No QR'}
            </span>
          </div>
        )}
    </div>
  );
}

export function ComplianceStrip({
  qrSrc, payload, trn, documentTypeNote, registrationName = 'TRN',
}: {
  qrSrc?: string | null;
  payload?: string | null;
  trn?: string | null;
  documentTypeNote?: string;
  registrationName?: string;   // Issue 5 — 'TRN' (GCC) or 'GSTIN' (India)
}) {
  return (
    <div style={{
      marginTop: tokens.gap6,
      paddingTop: tokens.gap3,
      borderTop: `1px solid ${tokens.hairline}`,
      display: 'flex', alignItems: 'flex-start', gap: tokens.gap4,
    }}>
      <QRPanel qrSrc={qrSrc} payload={payload} />
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: tokens.gap2 }}>
        {trn && (
          <div>
            <SectionLabel>{registrationName}</SectionLabel>
            <div style={{ fontSize: tokens.fsBody, color: tokens.ink, marginTop: '2px', ...numericStyle }}>{trn}</div>
          </div>
        )}
        {documentTypeNote && (
          <div style={{ fontSize: tokens.fsBodyMicro, color: tokens.inkFaint, marginTop: 'auto', lineHeight: tokens.lhSnug }}>
            {documentTypeNote}
          </div>
        )}
      </div>
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────────────
// Banking / notes / signature cards (footer slots)
// ──────────────────────────────────────────────────────────────────────────

function FooterCard({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div style={{
      flex: 1, minWidth: 0,
      display: 'flex', flexDirection: 'column', gap: tokens.gap2,
      padding: '12px 14px',
      background: tokens.surfaceCard,
      border: `1px solid ${tokens.hairline}`,
      borderRadius: tokens.radius,
    }}>
      <SectionLabel>{label}</SectionLabel>
      <div style={{ fontSize: tokens.fsBodySmall, color: tokens.ink, lineHeight: tokens.lhSnug }}>{children}</div>
    </div>
  );
}

export function BankingCard({ banking }: { banking: BankingDetails }) {
  return (
    <FooterCard label="Banking Details">
      <div style={{ fontWeight: tokens.wSemi, color: tokens.ink }}>{banking.account_name}</div>
      {banking.bank_name && <div style={{ color: tokens.inkMuted }}>{banking.bank_name}{banking.branch ? `, ${banking.branch}` : ''}</div>}
      {banking.account_number && <div style={numericStyle}>A/C&nbsp;{banking.account_number}</div>}
      {banking.iban   && <div style={numericStyle}>IBAN&nbsp;{banking.iban}</div>}
      {banking.swift  && <div style={numericStyle}>SWIFT&nbsp;{banking.swift}</div>}
    </FooterCard>
  );
}

export function NotesCard({ notes, terms }: { notes?: string | null; terms?: string | null }) {
  if (!notes && !terms) return null;
  return (
    <FooterCard label={terms ? 'Terms · Notes' : 'Notes'}>
      {terms && <div style={{ marginBottom: tokens.gap2, color: tokens.inkMuted }}>{terms}</div>}
      {notes && <div style={{ color: tokens.ink, whiteSpace: 'pre-wrap' }}>{notes}</div>}
    </FooterCard>
  );
}

export function SignatureCard({
  label = 'Authorised Signature', signedBy, signatureDate,
}: {
  label?: string; signedBy?: string | null; signatureDate?: string | null;
}) {
  return (
    <FooterCard label={label}>
      <div style={{
        height: '18mm', borderBottom: `1px solid ${tokens.ink}`,
        display: 'flex', alignItems: 'flex-end',
      }}>
        {/* signature space — intentionally empty */}
      </div>
      <div style={{ fontSize: tokens.fsBodyMicro, color: tokens.inkFaint, marginTop: tokens.gap1 }}>
        {signedBy ?? 'Name'} {signatureDate ? `· ${signatureDate}` : ''}
      </div>
    </FooterCard>
  );
}

export function FooterRow({ children }: { children: ReactNode }) {
  return (
    <div style={{
      marginTop: tokens.gap4,
      display: 'grid',
      gridTemplateColumns: 'repeat(auto-fit, minmax(50mm, 1fr))',
      gap: tokens.gap3,
    }}>{children}</div>
  );
}

// ──────────────────────────────────────────────────────────────────────────
// Misc atoms used across templates
// ──────────────────────────────────────────────────────────────────────────

export const Hairline = () => <hr style={{ ...hairlineStyle, margin: `${tokens.gap5} 0` }} />;

export function Watermark({ text }: { text: string }) {
  // Diagonal watermark for DRAFT / VOID etc. Pure CSS, no extra files.
  return (
    <div
      aria-hidden
      style={{
        position: 'absolute',
        top: '50%', left: '50%',
        transform: 'translate(-50%, -50%) rotate(-22deg)',
        fontSize: '120px',
        fontWeight: 800,
        color: tokens.hairline,
        opacity: 0.5,
        letterSpacing: '0.18em',
        pointerEvents: 'none',
        userSelect: 'none',
      }}
    >{text}</div>
  );
}
