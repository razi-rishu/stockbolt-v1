/**
 * Payment Receipt template — Phase 14.05.
 *
 * Used for BOTH customer payments (sales-side) and vendor payments
 * (purchase-side). The shape is identical; only the title and party
 * label flip ("Received from" vs. "Paid to").
 *
 * Layout:
 *
 *   ┌─ accent strip
 *   │  Company …………………………… Stamp ("Payment Receipt" / #PR-1042)
 *   │  Received-from / Paid-to card
 *   │
 *   │       AMOUNT-RECEIVED hero (AnchorTotal)
 *   │
 *   │  Payment method  │  Bank account  │  Reference
 *   │
 *   │  Allocations table
 *   │     Doc #  │  Doc date  │  Outstanding  │  Applied
 *   │     ─────  │  ────────  │  ──────────   │  ───────
 *   │
 *   │  Notes / Terms
 *
 * No VAT compliance strip — payments don't generate VAT.
 */
import {
  SignaturePage, SectionLabel, CompanyBlock, StampCard, PartyCard,
  AnchorTotal, NotesCard, FooterRow, Hairline, Watermark,
} from '../components';
import { tokens } from '../tokens';
import type { DocumentData } from '../types';

export interface PaymentReceiptTemplateProps {
  data: DocumentData;
  /** When true the party label reads "Paid to" (vendor payment).
   *  Default is "Received from" (customer payment). */
  paidTo?: boolean;
}

function fmt(n: number) {
  return n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export function PaymentReceiptTemplate({ data, paidTo = false }: PaymentReceiptTemplateProps) {
  const showWatermark = data.status === 'draft' || data.status === 'void';

  return (
    <SignaturePage>
      {showWatermark && <Watermark text={data.status === 'void' ? 'VOID' : 'DRAFT'} />}

      {/* ── Header ─────────────────────────────────────────────── */}
      <div style={{
        display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start',
        gap: tokens.gap6,
      }}>
        <CompanyBlock company={data.company} />
        <StampCard
          title={data.title ?? (paidTo ? 'Vendor Payment' : 'Payment Receipt')}
          number={data.number}
          status={data.status}
          date={data.date}
        />
      </div>

      <Hairline />

      {/* ── Party ─────────────────────────────────────────────── */}
      <PartyCard label={paidTo ? 'Paid to' : 'Received from'} party={data.bill_to} />

      {/* ── Hero amount ─────────────────────────────────────────── */}
      <div style={{
        marginTop: tokens.gap6,
        display: 'flex', justifyContent: 'center',
      }}>
        <AnchorTotal
          amount={data.grand_total}
          currency={data.currency}
          label={paidTo ? 'Amount paid' : 'Amount received'}
        />
      </div>

      {/* ── Payment meta ─────────────────────────────────────────── */}
      <div style={{
        marginTop: tokens.gap6,
        display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: tokens.gap4,
      }}>
        <div>
          <SectionLabel>Payment method</SectionLabel>
          <div style={{ marginTop: tokens.gap1, fontSize: tokens.fsBody, color: tokens.ink }}>
            {data.payment_method ?? '—'}
          </div>
        </div>
        <div>
          <SectionLabel>Bank account</SectionLabel>
          <div style={{ marginTop: tokens.gap1, fontSize: tokens.fsBody, color: tokens.ink }}>
            {data.bank_account ?? '—'}
          </div>
        </div>
        <div>
          <SectionLabel>Reference</SectionLabel>
          <div style={{ marginTop: tokens.gap1, fontSize: tokens.fsBody, color: tokens.ink }}>
            {data.reference ?? '—'}
          </div>
        </div>
      </div>

      {/* ── Allocations table ─────────────────────────────────────── */}
      {data.allocations && data.allocations.length > 0 && (
        <div style={{ marginTop: tokens.gap6 }}>
          <SectionLabel style={{ marginBottom: tokens.gap2 }}>
            {paidTo ? 'Applied to bills' : 'Applied to invoices'}
          </SectionLabel>
          <table style={{
            width: '100%',
            borderCollapse: 'collapse',
            fontSize: tokens.fsBody,
            fontVariantNumeric: 'tabular-nums',
          }}>
            <thead>
              <tr style={{ borderBottom: `1px solid ${tokens.hairline}` }}>
                <th style={{ padding: '8px 6px', textAlign: 'left',  color: tokens.inkMuted, fontWeight: tokens.wSemi, textTransform: 'uppercase', fontSize: tokens.fsSectionLabel, letterSpacing: tokens.trkLabel }}>
                  {paidTo ? 'Bill #' : 'Invoice #'}
                </th>
                <th style={{ padding: '8px 6px', textAlign: 'left',  color: tokens.inkMuted, fontWeight: tokens.wSemi, textTransform: 'uppercase', fontSize: tokens.fsSectionLabel, letterSpacing: tokens.trkLabel }}>Date</th>
                <th style={{ padding: '8px 6px', textAlign: 'right', color: tokens.inkMuted, fontWeight: tokens.wSemi, textTransform: 'uppercase', fontSize: tokens.fsSectionLabel, letterSpacing: tokens.trkLabel }}>Outstanding</th>
                <th style={{ padding: '8px 6px', textAlign: 'right', color: tokens.inkMuted, fontWeight: tokens.wSemi, textTransform: 'uppercase', fontSize: tokens.fsSectionLabel, letterSpacing: tokens.trkLabel }}>Applied</th>
              </tr>
            </thead>
            <tbody>
              {data.allocations.map((a, i) => (
                <tr key={i} style={{ borderBottom: `1px solid ${tokens.hairline}` }}>
                  <td style={{ padding: '8px 6px', color: tokens.ink, fontWeight: tokens.wMedium }}>{a.doc_number}</td>
                  <td style={{ padding: '8px 6px', color: tokens.inkMuted }}>{a.doc_date ?? '—'}</td>
                  <td style={{ padding: '8px 6px', textAlign: 'right', color: tokens.inkMuted }}>
                    {a.original_amount != null ? fmt(a.original_amount) : '—'}
                  </td>
                  <td style={{ padding: '8px 6px', textAlign: 'right', color: tokens.ink, fontWeight: tokens.wSemi }}>
                    {fmt(a.applied_amount)}
                  </td>
                </tr>
              ))}
              <tr>
                <td colSpan={3} style={{ padding: '10px 6px', textAlign: 'right', color: tokens.inkMuted, fontSize: tokens.fsBodySmall, textTransform: 'uppercase', letterSpacing: tokens.trkLabel, fontWeight: tokens.wSemi }}>
                  Total applied
                </td>
                <td style={{ padding: '10px 6px', textAlign: 'right', color: tokens.brand, fontWeight: tokens.wBold }}>
                  {fmt(data.allocations.reduce((s, a) => s + a.applied_amount, 0))}
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      )}

      {/* ── Footer: notes / terms ─────────────────────────────────── */}
      {(data.notes || data.terms) && (
        <FooterRow>
          <NotesCard notes={data.notes} terms={data.terms} />
        </FooterRow>
      )}
    </SignaturePage>
  );
}
