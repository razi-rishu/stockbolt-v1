/**
 * AC-4B — India GST e-invoice JSON formatter (pure, offline).
 *
 * Maps a CanonicalInvoice to the NIC/IRP e-invoice schema (v1.1) — the JSON the
 * government IRP consumes to mint an IRN. This builds the payload only; it does
 * NOT call the IRP, sign, or generate an IRN/QR (deferred GSP/ASP work).
 *
 * All monetary figures come straight from the canonical (which took them from
 * the posting engine). Nothing here re-computes tax.
 */
import type { CanonicalInvoice, CanonicalLine } from './canonical';

export interface IndiaEInvoiceItem {
  SlNo: string;
  PrdDesc: string;
  IsServc: 'Y' | 'N';
  HsnCd: string;
  Qty: number;
  Unit: string;
  UnitPrice: number;
  TotAmt: number;
  Discount: number;
  AssAmt: number;
  GstRt: number;
  IgstAmt: number;
  CgstAmt: number;
  SgstAmt: number;
  TotItemVal: number;
}

export interface IndiaEInvoiceJson {
  Version: '1.1';
  TranDtls: { TaxSch: 'GST'; SupTyp: string; RegRev: 'Y' | 'N'; IgstOnIntra: 'Y' | 'N' };
  DocDtls: { Typ: 'INV'; No: string; Dt: string };
  SellerDtls: { Gstin: string; LglNm: string; Addr1: string; Loc: string; Pin: number | null; Stcd: string };
  BuyerDtls: { Gstin: string; LglNm: string; Pos: string; Addr1: string; Loc: string; Pin: number | null; Stcd: string };
  ItemList: IndiaEInvoiceItem[];
  ValDtls: {
    AssVal: number; CgstVal: number; SgstVal: number; IgstVal: number;
    Discount: number; RndOffAmt: number; TotInvVal: number;
  };
}

/** ISO yyyy-mm-dd → NIC dd/mm/yyyy. */
function nicDate(iso: string): string {
  const [y, m, d] = iso.split('-');
  return `${d}/${m}/${y}`;
}

function pin(v: string | null): number | null {
  if (!v) return null;
  const n = Number(v.replace(/\s+/g, ''));
  return Number.isFinite(n) ? n : null;
}

function item(l: CanonicalLine): IndiaEInvoiceItem {
  return {
    SlNo: String(l.sl_no),
    PrdDesc: l.description,
    IsServc: l.is_service ? 'Y' : 'N',
    HsnCd: l.hsn_code ?? '',
    Qty: l.quantity,
    Unit: l.unit ?? '',
    UnitPrice: l.unit_price,
    TotAmt: l.taxable_value + l.discount_amount, // gross before discount
    Discount: l.discount_amount,
    AssAmt: l.taxable_value,
    GstRt: l.tax_rate,
    IgstAmt: l.igst_amount,
    CgstAmt: l.cgst_amount,
    SgstAmt: l.sgst_amount,
    TotItemVal: l.line_total,
  };
}

export function toIndiaGstJson(inv: CanonicalInvoice): IndiaEInvoiceJson {
  return {
    Version: '1.1',
    TranDtls: {
      TaxSch: 'GST',
      SupTyp: inv.supply_type,
      RegRev: 'N',
      // IgstOnIntra: 'Y' only for the rare intra-state IGST case; the canonical
      // never produces that, so it is always 'N' here.
      IgstOnIntra: 'N',
    },
    DocDtls: { Typ: 'INV', No: inv.document.number, Dt: nicDate(inv.document.date) },
    SellerDtls: {
      Gstin: inv.supplier.tax_id ?? '',
      LglNm: inv.supplier.legal_name,
      Addr1: inv.supplier.address_line ?? '',
      Loc: inv.supplier.city ?? '',
      Pin: pin(inv.supplier.pincode),
      Stcd: inv.supplier.state_code ?? '',
    },
    BuyerDtls: {
      Gstin: inv.buyer.tax_id ?? '',
      LglNm: inv.buyer.legal_name,
      Pos: inv.place_of_supply_code ?? '',
      Addr1: inv.buyer.address_line ?? '',
      Loc: inv.buyer.city ?? '',
      Pin: pin(inv.buyer.pincode),
      Stcd: inv.buyer.state_code ?? '',
    },
    ItemList: inv.lines.map(item),
    ValDtls: {
      AssVal: inv.totals.assessable,
      CgstVal: inv.totals.cgst,
      SgstVal: inv.totals.sgst,
      IgstVal: inv.totals.igst,
      Discount: inv.totals.discount,
      RndOffAmt: inv.totals.round_off,
      TotInvVal: inv.totals.grand_total,
    },
  };
}
