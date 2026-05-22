/**
 * Tax Invoice template — Phase 14.01 flagship.
 *
 * UAE FTA compliant tax invoice in the Signature design language.
 * Composes the shared components in the canonical Ledger Edge order:
 *
 *   ┌─ accent strip
 *   │  Company  ……………  Stamp
 *   │  Bill to  │  Ship to
 *   │  Items
 *   │       Subtotal │  VAT │  Anchor TOTAL
 *   │  QR │ TRN │ "This is a Tax Invoice"
 *   │  Banking  │  Notes/Terms
 *
 * Other 7 document types reuse 90% of this file with title / column /
 * footer-slot variations. Once you approve this look they each become a
 * 30-line variant.
 */
import {
  SignaturePage, SectionLabel, CompanyBlock, StampCard, PartyCard,
  ItemsTable, TotalLine, AnchorTotal, VATBreakdownTable,
  ComplianceStrip, BankingCard, NotesCard, FooterRow, Hairline, Watermark,
} from '../components';
import { tokens } from '../tokens';
import type { DocumentData } from '../types';

export interface TaxInvoiceTemplateProps {
  data:    DocumentData;
  /** Optional QR data URL (data:image/png;base64,…). Built upstream from
   *  the UAE FTA TLV payload using a qrcode lib. */
  qrSrc?:  string | null;
}

export function TaxInvoiceTemplate({ data, qrSrc }: TaxInvoiceTemplateProps) {
  const showShipTo = !!data.ship_to && data.ship_to.address !== data.bill_to.address;
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
          title="Tax Invoice"
          number={data.number}
          status={data.status}
          date={data.date}
          dueDate={data.due_date}
        />
      </div>

      <Hairline />

      {/* ── Parties ────────────────────────────────────────────── */}
      <div style={{ display: 'flex', gap: tokens.gap3, alignItems: 'stretch' }}>
        <PartyCard label="Bill to" party={data.bill_to} />
        {showShipTo && <PartyCard label="Ship to" party={data.ship_to!} />}
      </div>

      {/* Reference line (PO #, supplier invoice #, etc.) */}
      {data.reference && (
        <div style={{
          marginTop: tokens.gap3,
          display: 'flex', alignItems: 'baseline', gap: tokens.gap3,
        }}>
          <SectionLabel>Reference</SectionLabel>
          <span style={{ fontSize: tokens.fsBody, color: tokens.ink }}>{data.reference}</span>
        </div>
      )}

      {/* ── Line items ──────────────────────────────────────────── */}
      <div style={{ marginTop: tokens.gap6 }}>
        <SectionLabel style={{ marginBottom: tokens.gap2 }}>Line items</SectionLabel>
        <ItemsTable items={data.items} />
      </div>

      {/* ── Totals — right-aligned ladder + anchor ──────────────── */}
      <div style={{
        marginTop: tokens.gap4,
        display: 'flex', justifyContent: 'flex-end',
      }}>
        <div style={{ minWidth: '76mm', display: 'flex', flexDirection: 'column' }}>
          <TotalLine label="Subtotal"             amount={data.subtotal} />
          {!!data.discount_total && data.discount_total > 0 && (
            <TotalLine label="Discount"           amount={-data.discount_total} />
          )}
          <TotalLine label={`VAT (${(data.tax_total / Math.max(data.subtotal, 1) * 100).toFixed(0)}%)`} amount={data.tax_total} />
          {!!data.shipping_total && data.shipping_total > 0 && (
            <TotalLine label="Shipping"           amount={data.shipping_total} />
          )}
          {!!data.paid_amount && data.paid_amount > 0 && (
            <TotalLine label="Amount paid"        amount={-data.paid_amount} muted />
          )}
          <AnchorTotal amount={data.balance_due ?? data.grand_total} currency={data.currency} label="Total due" />
        </div>
      </div>

      {/* ── VAT breakdown (UAE FTA requirement) ─────────────────── */}
      {data.vat_breakdown && data.vat_breakdown.length > 0 && (
        <VATBreakdownTable rows={data.vat_breakdown} currency={data.currency} />
      )}

      {/* ── Compliance strip ─────────────────────────────────────── */}
      <ComplianceStrip
        qrSrc={qrSrc}
        payload={data.qr_payload}
        trn={data.company.trn}
        documentTypeNote="This document is a Tax Invoice as defined under UAE Federal Decree-Law No. (8) of 2017 on Value Added Tax."
      />

      {/* ── Footer row: banking + notes ──────────────────────────── */}
      <FooterRow>
        {data.banking && <BankingCard banking={data.banking} />}
        <NotesCard notes={data.notes} terms={data.terms} />
      </FooterRow>
    </SignaturePage>
  );
}
