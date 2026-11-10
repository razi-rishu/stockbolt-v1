/**
 * Payment details — the verified money movements behind a document, shared
 * by both print engines (Configurable and Elegant), so every screen, printout
 * and PDF (web and Android share this code) shows the same thing.
 *
 * Rows come from withPaymentDetails() (adapters.ts): receipts / payments
 * allocated to the document, refunds raised against it, or — for an expense —
 * the posted bank/cash ledger line. A field the document never recorded is
 * printed as "Not recorded", never guessed.
 */
import type { CSSProperties } from 'react';
import type { DocumentData } from '../_signature/types';
import { formatDate } from '@/lib/locale';

export interface PaymentDetailsColors {
  text: string;
  muted: string;
  hairline: string;
}

const NOT_RECORDED = 'Not recorded';

export function PaymentDetailsSection({ data, colors, baseFont, money, labelStyle }: {
  data: DocumentData;
  colors: PaymentDetailsColors;
  baseFont: number;
  money: (n: number) => string;
  labelStyle?: CSSProperties;
}) {
  const rows = data.payment_details;
  if (!rows || (rows.length === 0 && !data.payment_details_note)) return null;

  const th: CSSProperties = {
    padding: '5px 6px', fontSize: baseFont * 0.72, fontWeight: 700, letterSpacing: '.04em',
    textTransform: 'uppercase', color: colors.muted, borderBottom: `1px solid ${colors.hairline}`, textAlign: 'start',
  };
  const td: CSSProperties = {
    padding: '6px', fontSize: baseFont * 0.84, color: colors.text, borderBottom: `1px solid ${colors.hairline}`,
    verticalAlign: 'top', fontVariantNumeric: 'tabular-nums',
  };
  const faint: CSSProperties = { color: colors.muted, fontStyle: 'italic' };

  return (
    <div className="payment-details" data-testid="payment-details" style={{ marginTop: 16, breakInside: 'avoid' }}>
      <div style={labelStyle ?? { fontSize: baseFont * 0.75, fontWeight: 700, letterSpacing: '.06em', textTransform: 'uppercase', color: colors.muted }}>
        Payment Details
      </div>
      {rows.length === 0 ? (
        <div style={{ ...faint, fontSize: baseFont * 0.85, marginTop: 6 }}>{data.payment_details_note}</div>
      ) : (
        <table style={{ width: '100%', borderCollapse: 'collapse', marginTop: 6 }}>
          <thead><tr>
            {['Type', 'Date', 'No.', 'Account', 'Method', 'Reference', 'Amount'].map((h, i) => (
              <th key={h} style={{ ...th, textAlign: i === 6 ? 'end' : 'start' }}>{h}</th>
            ))}
          </tr></thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={i} style={r.status ? { opacity: 0.6 } : undefined}>
                <td style={td}>{r.kind}{r.status && <span style={{ marginInlineStart: 6, fontSize: baseFont * 0.7, fontWeight: 700, color: colors.muted }}>{r.status.toUpperCase()}</span>}</td>
                <td style={td}>{r.date ? formatDate(r.date) : '—'}</td>
                <td style={td}>{r.number ?? '—'}</td>
                <td style={td}>{r.account ?? <span style={faint}>{NOT_RECORDED}</span>}</td>
                <td style={td}>{r.method ?? <span style={faint}>{NOT_RECORDED}</span>}</td>
                <td style={td}>{r.reference ?? '—'}</td>
                <td style={{ ...td, textAlign: 'end', textDecoration: r.status === 'Void' || r.status === 'Reversed' ? 'line-through' : undefined }}>
                  <span dir="ltr">{money(r.amount)}</span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
