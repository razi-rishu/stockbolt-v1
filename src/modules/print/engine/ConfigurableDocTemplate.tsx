/**
 * ConfigurableDocTemplate — the ONE data-driven print renderer (Phase 15).
 *
 * Renders any sales document from a `DocumentData` payload, with every colour,
 * font, logo placement and section visible/hidden driven by a `PrintTemplate`
 * record + its `template_style` preset. No hardcoded colours.
 *
 * Self-contained on purpose: it does NOT import the existing _signature
 * primitives, so refining it can never destabilise the Tax-Invoice / Bolt
 * templates that ship today. The `classic` preset reproduces the current look.
 */
import type { CSSProperties } from 'react';
import type { DocumentData, LineItem } from '../_signature/types';
import { getTaxLabels } from '@/lib/locale';
import type { PrintTemplate } from './types';
import { normalizeSettings } from './types';
import {
  STYLE_PRESETS, FONT_STACK, FONT_SIZE_PX, LOGO_SIZE_PX,
} from './presets';

interface Props {
  data:     DocumentData;
  template: PrintTemplate;
  /** Preview mode renders without the fixed A4 print geometry guards. */
  preview?: boolean;
}

const num = (n: number) =>
  (Number(n) || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export function ConfigurableDocTemplate({ data, template }: Props) {
  const preset   = STYLE_PRESETS[template.template_style] ?? STYLE_PRESETS.classic;
  const s        = normalizeSettings(template.settings);
  const fontStack = FONT_STACK[template.font_family] ?? FONT_STACK.Inter;
  const baseFont  = FONT_SIZE_PX[template.font_size] ?? FONT_SIZE_PX.medium;
  const logoPx    = LOGO_SIZE_PX[template.logo_size] ?? LOGO_SIZE_PX.medium;

  const C = {
    primary:   template.primary_color,
    secondary: template.secondary_color,
    accent:    template.accent_color,
    text:      template.text_color,
    hairline:  '#E2E8F0',
    paper:     '#FFFFFF',
  };

  // Tax terminology: India-GST preset forces GST/GSTIN; otherwise company country.
  const taxCountry = preset.forceGstLabels ? 'IN' : (data.company.country ?? undefined);
  const tax = getTaxLabels(taxCountry);
  const cur = data.currency;
  const money = (n: number) => `${cur} ${num(n)}`;

  const labelStyle: CSSProperties = {
    fontSize:       baseFont * 0.72,
    fontWeight:     600,
    color:          C.secondary,
    textTransform:  preset.uppercaseLabels ? 'uppercase' : 'none',
    letterSpacing:  preset.uppercaseLabels ? '0.1em' : 'normal',
  };

  // ── Logo + company identity block ─────────────────────────────────────────
  const logo = s.showLogo && data.company.logo_url
    ? <img src={data.company.logo_url} alt="logo" style={{ height: logoPx, width: 'auto', objectFit: 'contain' }} />
    : null;

  const companyIdentity = (onBand: boolean) => {
    const fg = onBand ? '#FFFFFF' : C.primary;
    const fgMuted = onBand ? 'rgba(255,255,255,.85)' : C.secondary;
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
        <div style={{ fontSize: baseFont * 1.25, fontWeight: 700, color: fg }}>{data.company.name}</div>
        {data.company.name_ar && <div style={{ fontSize: baseFont, color: fgMuted }} dir="rtl">{data.company.name_ar}</div>}
        {(data.company.address || data.company.city) && (
          <div style={{ fontSize: baseFont * 0.82, color: fgMuted, maxWidth: '72mm' }}>
            {[data.company.address, data.company.city, data.company.country].filter(Boolean).join(', ')}
          </div>
        )}
        <div style={{ fontSize: baseFont * 0.8, color: fgMuted, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {data.company.phone && <span>{data.company.phone}</span>}
          {data.company.email && <span>· {data.company.email}</span>}
        </div>
        {data.company.trn && (
          <div style={{ fontSize: baseFont * 0.8, color: fg, fontWeight: 600 }}>
            {tax.registrationName}: <span style={{ fontVariantNumeric: 'tabular-nums' }}>{data.company.trn}</span>
          </div>
        )}
      </div>
    );
  };

  // ── Document meta (title / number / dates) ────────────────────────────────
  const docMeta = (onBand: boolean) => {
    const fg = onBand ? '#FFFFFF' : C.primary;
    const fgMuted = onBand ? 'rgba(255,255,255,.85)' : C.secondary;
    return (
      <div style={{ textAlign: 'end', display: 'flex', flexDirection: 'column', gap: 3 }}>
        <div style={{ fontSize: baseFont * 1.5, fontWeight: 800, color: onBand ? '#FFFFFF' : C.accent, letterSpacing: '-.01em' }}>
          {data.title ?? 'Tax Invoice'}
        </div>
        <div style={{ fontSize: baseFont, fontWeight: 700, color: fg, fontVariantNumeric: 'tabular-nums' }}>#{data.number}</div>
        <div style={{ fontSize: baseFont * 0.82, color: fgMuted }}>Date: {data.date}</div>
        {s.showDueDate && data.due_date && (
          <div style={{ fontSize: baseFont * 0.82, color: fgMuted }}>Due: {data.due_date}</div>
        )}
        {s.showReferenceNumber && data.reference && (
          <div style={{ fontSize: baseFont * 0.82, color: fgMuted }}>Ref: {data.reference}</div>
        )}
      </div>
    );
  };

  // ── Header (varies by preset) ─────────────────────────────────────────────
  function Header() {
    if (preset.headerVariant === 'band') {
      return (
        <div style={{
          background: C.primary, color: '#fff', borderRadius: 8,
          padding: '16px 20px', display: 'flex', justifyContent: 'space-between',
          alignItems: 'flex-start', gap: 20,
        }}>
          <div style={{ display: 'flex', gap: 14, alignItems: 'center' }}>
            {logo}
            {companyIdentity(true)}
          </div>
          {docMeta(true)}
        </div>
      );
    }
    if (preset.headerVariant === 'centered') {
      return (
        <div style={{ textAlign: 'center', borderBottom: `2px solid ${C.accent}`, paddingBottom: 14 }}>
          {logo && <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 8 }}>{logo}</div>}
          <div style={{ display: 'inline-flex', flexDirection: 'column', alignItems: 'center' }}>{companyIdentity(false)}</div>
          <div style={{ marginTop: 10, fontSize: baseFont * 1.5, fontWeight: 800, color: C.accent }}>
            {data.title ?? 'Tax Invoice'} · #{data.number}
          </div>
          <div style={{ fontSize: baseFont * 0.82, color: C.secondary }}>
            Date: {data.date}{s.showDueDate && data.due_date ? `  ·  Due: ${data.due_date}` : ''}
          </div>
        </div>
      );
    }
    // 'split' (corporate) and 'plain' (classic/minimal) share a left-identity /
    // right-meta row; split adds a bordered box around the meta.
    const logoAlign =
      template.logo_position === 'center' ? 'center' :
      template.logo_position === 'right'  ? 'flex-end' : 'flex-start';
    return (
      <div style={{
        display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start',
        gap: 20, borderBottom: `2px solid ${C.accent}`, paddingBottom: 14,
      }}>
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: logoAlign, gap: 8 }}>
          {logo}
          {companyIdentity(false)}
        </div>
        <div style={preset.headerVariant === 'split'
          ? { border: `1px solid ${C.hairline}`, borderRadius: 8, padding: '10px 14px' }
          : undefined}>
          {docMeta(false)}
        </div>
      </div>
    );
  }

  // ── Party card ────────────────────────────────────────────────────────────
  function Party({ label, p }: { label: string; p: NonNullable<DocumentData['ship_to']> }) {
    return (
      <div style={{ flex: 1 }}>
        <div style={labelStyle}>{label}</div>
        <div style={{ fontSize: baseFont, fontWeight: 700, color: C.text, marginTop: 2 }}>{p.name}</div>
        {p.address && <div style={{ fontSize: baseFont * 0.85, color: C.secondary }}>
          {[p.address, p.city, p.country].filter(Boolean).join(', ')}
        </div>}
        {(p.phone || p.email) && <div style={{ fontSize: baseFont * 0.8, color: C.secondary }}>
          {[p.phone, p.email].filter(Boolean).join(' · ')}
        </div>}
        {s.showCustomerTaxNumber && p.trn && (
          <div style={{ fontSize: baseFont * 0.8, color: C.text }}>
            {getTaxLabels(preset.forceGstLabels ? 'IN' : (p.country ?? taxCountry)).registrationName}: {p.trn}
          </div>
        )}
      </div>
    );
  }

  // ── Items table ───────────────────────────────────────────────────────────
  type Col = { key: string; head: string; align: 'start' | 'end'; render: (it: LineItem, i: number) => React.ReactNode };
  const cols: Col[] = [];
  cols.push({ key: 'idx', head: '#', align: 'start', render: (_it, i) => i + 1 });
  if (s.showItemSku) cols.push({ key: 'sku', head: 'SKU', align: 'start', render: (it) => it.sku ?? '' });
  cols.push({
    key: 'desc', head: 'Description', align: 'start',
    render: (it) => (
      <div>
        <span>{it.description}</span>
        {s.showItemDescription && it.description_ar && (
          <div style={{ fontSize: baseFont * 0.78, color: C.secondary }} dir="rtl">{it.description_ar}</div>
        )}
      </div>
    ),
  });
  cols.push({ key: 'qty', head: 'Qty', align: 'end', render: (it) => `${num(it.quantity)}${it.unit_code ? ' ' + it.unit_code : ''}` });
  if (s.showUnitPrice) cols.push({ key: 'price', head: 'Unit price', align: 'end', render: (it) => num(it.unit_price) });
  if (s.showDiscount) cols.push({ key: 'disc', head: 'Disc', align: 'end', render: (it) => it.discount_amount ? num(it.discount_amount) : '—' });
  if (s.showTaxBreakdown) cols.push({ key: 'tax', head: tax.taxName, align: 'end', render: (it) => it.tax_amount != null ? num(it.tax_amount) : '—' });
  cols.push({ key: 'amt', head: 'Amount', align: 'end', render: (it) => num(it.line_total) });

  const thStyle: CSSProperties = {
    padding: '7px 8px', fontSize: baseFont * 0.78, fontWeight: 700, color: '#fff',
    background: C.primary, textTransform: preset.uppercaseLabels ? 'uppercase' : 'none',
    letterSpacing: preset.uppercaseLabels ? '0.06em' : 'normal',
  };
  const tdBase: CSSProperties = { padding: '7px 8px', fontSize: baseFont * 0.9, color: C.text, fontVariantNumeric: 'tabular-nums' };

  function ItemsTable() {
    return (
      <table style={{ width: '100%', borderCollapse: 'collapse', marginTop: 6 }}>
        <thead>
          <tr>{cols.map((c) => (
            <th key={c.key} style={{ ...thStyle, textAlign: c.align }}>{c.head}</th>
          ))}</tr>
        </thead>
        <tbody>
          {data.items.map((it, i) => {
            const striped = preset.tableVariant === 'striped' && i % 2 === 1;
            const bordered = preset.tableVariant === 'bordered';
            const lined = preset.tableVariant === 'lined';
            return (
              <tr key={i} style={{ background: striped ? '#F8FAFC' : 'transparent' }}>
                {cols.map((c) => (
                  <td key={c.key} style={{
                    ...tdBase, textAlign: c.align,
                    borderBottom: lined ? `1px solid ${C.hairline}` : undefined,
                    border: bordered ? `1px solid ${C.hairline}` : undefined,
                  }}>{c.render(it, i)}</td>
                ))}
              </tr>
            );
          })}
        </tbody>
      </table>
    );
  }

  // ── Totals ladder ───────────────────────────────────────────────────────
  function Totals() {
    const row = (l: string, v: string, bold = false) => (
      <div style={{ display: 'flex', justifyContent: 'space-between', padding: '4px 0', fontSize: baseFont * (bold ? 1 : 0.9), fontWeight: bold ? 700 : 500 }}>
        <span style={{ color: bold ? C.text : C.secondary }}>{l}</span>
        <span style={{ color: C.text, fontVariantNumeric: 'tabular-nums' }}>{v}</span>
      </div>
    );
    return (
      <div style={{ width: '64mm', marginInlineStart: 'auto', marginTop: 10 }}>
        {row('Subtotal', money(data.subtotal))}
        {!!data.discount_total && data.discount_total > 0 && row('Discount', `(${num(data.discount_total)})`)}
        {row(tax.taxName, money(data.tax_total))}
        {!!data.shipping_total && data.shipping_total > 0 && row('Shipping', money(data.shipping_total))}
        <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 6, padding: '8px 12px', borderRadius: 6, background: C.accent, color: '#fff', fontWeight: 800, fontSize: baseFont * 1.05 }}>
          <span>TOTAL {cur}</span>
          <span style={{ fontVariantNumeric: 'tabular-nums' }}>{num(data.balance_due ?? data.grand_total)}</span>
        </div>
      </div>
    );
  }

  // ── Page ──────────────────────────────────────────────────────────────────
  return (
    <div style={{
      position: 'relative', width: '210mm', minHeight: '297mm', background: C.paper,
      fontFamily: fontStack, fontSize: baseFont, color: C.text,
      padding: '16mm 16mm 16mm', boxSizing: 'border-box',
    }}>
      {preset.accentStrip && (
        <div style={{ position: 'absolute', insetBlock: 0, insetInlineStart: 0, width: '4mm', background: C.accent }} />
      )}

      <Header />

      <div style={{ display: 'flex', gap: 16, marginTop: 20 }}>
        <Party label="Bill To" p={data.bill_to} />
        {data.ship_to && data.ship_to.address !== data.bill_to.address && (
          <Party label="Ship To" p={data.ship_to} />
        )}
      </div>

      <div style={{ marginTop: 18 }}>
        <div style={labelStyle}>Line Items</div>
        <ItemsTable />
      </div>

      <Totals />

      {/* Per-rate tax breakdown */}
      {s.showTaxBreakdown && data.vat_breakdown && data.vat_breakdown.length > 0 && (
        <div style={{ marginTop: 18, maxWidth: '90mm' }}>
          <div style={labelStyle}>{tax.taxName} Summary</div>
          <table style={{ width: '100%', borderCollapse: 'collapse', marginTop: 6, fontSize: baseFont * 0.85 }}>
            <thead><tr>{['Rate', 'Taxable', tax.taxName].map((h, i) => (
              <th key={h} style={{ ...thStyle, fontSize: baseFont * 0.72, textAlign: i === 0 ? 'start' : 'end' }}>{h}</th>
            ))}</tr></thead>
            <tbody>{data.vat_breakdown.map((r, i) => (
              <tr key={i}>
                <td style={{ ...tdBase, borderBottom: `1px solid ${C.hairline}` }}>{r.rate}%</td>
                <td style={{ ...tdBase, textAlign: 'end', borderBottom: `1px solid ${C.hairline}` }}>{num(r.taxable)}</td>
                <td style={{ ...tdBase, textAlign: 'end', borderBottom: `1px solid ${C.hairline}` }}>{num(r.tax)}</td>
              </tr>
            ))}</tbody>
          </table>
        </div>
      )}

      {/* Bank details + signature row */}
      <div style={{ display: 'flex', gap: 24, marginTop: 22, flexWrap: 'wrap' }}>
        {s.showBankDetails && data.banking && (
          <div style={{ flex: 1, minWidth: '70mm' }}>
            <div style={labelStyle}>Payment Details</div>
            <div style={{ fontSize: baseFont * 0.85, color: C.text, lineHeight: 1.6, marginTop: 4 }}>
              {data.banking.account_name && <div>Account: {data.banking.account_name}</div>}
              {data.banking.bank_name && <div>Bank: {data.banking.bank_name}</div>}
              {data.banking.account_number && <div>A/C No: {data.banking.account_number}</div>}
              {data.banking.iban && <div>IBAN: {data.banking.iban}</div>}
            </div>
          </div>
        )}
        {s.showSignature && (
          <div style={{ width: '60mm', alignSelf: 'flex-end' }}>
            <div style={{ borderTop: `1px solid ${C.hairline}`, marginTop: 28, paddingTop: 6, fontSize: baseFont * 0.8, color: C.secondary, textAlign: 'center' }}>
              {data.signed_by || 'Authorised Signatory'}
            </div>
          </div>
        )}
        {s.showQR && data.qr_payload && (
          <div style={{ width: '24mm', height: '24mm', border: `1px solid ${C.hairline}`, borderRadius: 6, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 8, color: C.secondary }}>
            QR
          </div>
        )}
      </div>

      {/* Footer strip */}
      {s.showFooter && (s.footerEn || s.footerAr) && (
        <div style={{
          position: 'absolute', insetInline: 0, bottom: 0, background: C.primary, color: '#fff',
          padding: '8px 16mm', fontSize: baseFont * 0.78, display: 'flex', justifyContent: 'space-between', gap: 12,
        }}>
          <span>{s.footerEn}</span>
          {s.footerAr && <span dir="rtl">{s.footerAr}</span>}
        </div>
      )}
    </div>
  );
}
