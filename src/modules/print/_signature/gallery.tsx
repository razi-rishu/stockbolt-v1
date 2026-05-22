/**
 * Signature template gallery — Phase 14.01.
 *
 * Single route /print-templates that lets the team preview the Signature
 * design system at A4 fidelity. Layout:
 *
 *   ┌───────────────────────────────────────────────────┐
 *   │  Signature Templates                       Print  │
 *   │  ──────────────────────────────────────────────── │
 *   │  ┌─────────────────────────┐  ┌────────────────┐  │
 *   │  │  Live A4 preview        │  │ Switcher       │  │
 *   │  │  (zoomable, scrolls)    │  │ ◆ Tax Invoice  │  │
 *   │  │                         │  │ ○ Standard Inv │  │
 *   │  │                         │  │ ○ Proforma     │  │
 *   │  │                         │  │ ○ Quotation    │  │
 *   │  │                         │  │ ○ Delivery     │  │
 *   │  │                         │  │ ○ Purchase Ord │  │
 *   │  │                         │  │ ○ Credit Note  │  │
 *   │  │                         │  │ ○ Payment Rec  │  │
 *   │  └─────────────────────────┘  │ Customisation  │  │
 *   │                                │ (coming v2)    │  │
 *   │                                └────────────────┘  │
 *   └───────────────────────────────────────────────────┘
 *
 * Templates other than Tax Invoice are stubbed for now with "coming
 * soon" placeholders; flipping each into the same SignaturePage with
 * a different title + column set is a 30-line change per template.
 */
import { useMemo, useState } from 'react';
import { PageHeader } from '@/ui/primitives';
import { theme } from '@/ui/theme';
import { TaxInvoiceTemplate } from './templates/tax-invoice';
import { SAMPLE_TAX_INVOICE, tokens } from './sample-data';
import './print.css';
import type { DocumentType } from './types';

interface TemplateMeta {
  id:       DocumentType;
  label:    string;
  caption:  string;
  ready:    boolean;
}

const TEMPLATES: TemplateMeta[] = [
  { id: 'tax_invoice',      label: 'Tax Invoice',      caption: 'UAE FTA-compliant',                ready: true  },
  { id: 'standard_invoice', label: 'Standard Invoice', caption: 'No VAT block',                     ready: false },
  { id: 'proforma_invoice', label: 'Proforma',         caption: 'Pre-sale · not a tax invoice',     ready: false },
  { id: 'quotation',        label: 'Quotation',        caption: 'Valid-until + signature',          ready: false },
  { id: 'delivery_note',    label: 'Delivery Note',    caption: 'Qty only · no prices',             ready: false },
  { id: 'purchase_order',   label: 'Purchase Order',   caption: 'Supplier-facing',                  ready: false },
  { id: 'credit_note',      label: 'Credit Note',      caption: 'References original invoice',      ready: false },
  { id: 'payment_receipt',  label: 'Payment Receipt',  caption: 'Single hero amount',               ready: false },
];

export default function SignatureTemplateGallery() {
  const [selected, setSelected] = useState<DocumentType>('tax_invoice');
  const [zoom, setZoom] = useState(0.85);

  const activeMeta = useMemo(() => TEMPLATES.find(t => t.id === selected)!, [selected]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
      <PageHeader
        title="Signature Templates"
        crumb="Internal · Print"
        subtitle="Ledger Edge — the visual identity used on every printed document."
        actions={
          <button
            onClick={() => window.print()}
            style={{
              padding: '8px 14px',
              background: tokens.brand,
              color: '#fff',
              border: `1px solid ${tokens.brand}`,
              borderRadius: '7px',
              fontSize: '13px', fontWeight: 600,
              cursor: 'pointer',
            }}
          >Print / PDF</button>
        }
      />

      <div style={{
        display: 'grid',
        gridTemplateColumns: 'minmax(0, 1fr) 260px',
        gap: '20px',
        alignItems: 'flex-start',
      }}>
        {/* ── Live preview ── */}
        <div
          className="signature-canvas"
          style={{
            background: tokens.paperCanvas,
            borderRadius: '12px',
            border: `1px solid ${tokens.hairline}`,
            padding: '24px',
            overflow: 'auto',
            maxHeight: 'calc(100vh - 200px)',
          }}
        >
          {/* Zoom wrapper */}
          <div style={{
            transform: `scale(${zoom})`,
            transformOrigin: 'top center',
            width: tokens.pageWidth,
            margin: '0 auto',
          }}>
            {activeMeta.ready ? (
              <ActivePreview type={selected} />
            ) : (
              <ComingSoonPage meta={activeMeta} />
            )}
          </div>
        </div>

        {/* ── Right-hand control rail ── */}
        <aside style={{
          display: 'flex', flexDirection: 'column', gap: '14px',
          position: 'sticky', top: '20px',
        }}>
          {/* Template switcher */}
          <div style={{
            background: '#fff', border: `1px solid ${theme.border}`,
            borderRadius: '12px', boxShadow: theme.shadowSm,
            padding: '12px',
            display: 'flex', flexDirection: 'column', gap: '4px',
          }}>
            <div style={{
              fontSize: '11px', fontWeight: 700, color: theme.inkMuted,
              textTransform: 'uppercase', letterSpacing: '.06em',
              padding: '4px 6px 8px',
            }}>Templates</div>
            {TEMPLATES.map((t) => {
              const isActive = t.id === selected;
              return (
                <button
                  key={t.id}
                  onClick={() => setSelected(t.id)}
                  style={{
                    display: 'flex', alignItems: 'flex-start', gap: '8px',
                    padding: '8px 10px',
                    background: isActive ? theme.brandSoft : 'transparent',
                    border: 'none',
                    borderRadius: '8px',
                    cursor: 'pointer',
                    textAlign: 'start',
                    transition: 'background-color .12s',
                  }}
                  onMouseEnter={(e) => { if (!isActive) (e.currentTarget as HTMLElement).style.background = theme.muted; }}
                  onMouseLeave={(e) => { if (!isActive) (e.currentTarget as HTMLElement).style.background = 'transparent'; }}
                >
                  <span style={{
                    marginTop: '4px',
                    width: '7px', height: '7px',
                    borderRadius: '999px',
                    background: isActive ? tokens.brand : theme.border,
                    flexShrink: 0,
                  }} />
                  <span style={{ flex: 1, minWidth: 0 }}>
                    <div style={{
                      fontSize: '13px', fontWeight: 600,
                      color: isActive ? theme.brandSoftText : theme.ink,
                      display: 'flex', alignItems: 'center', gap: '6px',
                    }}>
                      {t.label}
                      {!t.ready && (
                        <span style={{
                          fontSize: '9px', fontWeight: 600,
                          color: theme.warn,
                          background: theme.warnSoft,
                          border: `1px solid ${theme.warnBorder}`,
                          padding: '1px 6px',
                          borderRadius: '999px',
                          textTransform: 'uppercase', letterSpacing: '.05em',
                        }}>Soon</span>
                      )}
                    </div>
                    <div style={{ fontSize: '11px', color: theme.inkFaint, marginTop: '2px' }}>
                      {t.caption}
                    </div>
                  </span>
                </button>
              );
            })}
          </div>

          {/* Zoom */}
          <div style={{
            background: '#fff', border: `1px solid ${theme.border}`,
            borderRadius: '12px', boxShadow: theme.shadowSm,
            padding: '12px',
          }}>
            <div style={{
              fontSize: '11px', fontWeight: 700, color: theme.inkMuted,
              textTransform: 'uppercase', letterSpacing: '.06em',
              marginBottom: '8px',
            }}>Preview zoom</div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <input
                type="range" min="0.4" max="1.4" step="0.05"
                value={zoom}
                onChange={(e) => setZoom(parseFloat(e.target.value))}
                style={{ flex: 1, accentColor: tokens.brand }}
              />
              <span style={{
                fontFamily: theme.fontMono, fontSize: '12px', color: theme.ink,
                width: '42px', textAlign: 'end',
              }}>{Math.round(zoom * 100)}%</span>
            </div>
            <div style={{
              marginTop: '8px',
              fontSize: '11px', color: theme.inkFaint, lineHeight: 1.45,
            }}>
              The preview renders at A4. Use <kbd style={{ fontFamily: theme.fontMono, fontSize: '10px', padding: '0 4px', border: `1px solid ${theme.border}`, borderRadius: '4px' }}>Ctrl + P</kbd> in any document route to save as PDF.
            </div>
          </div>

          {/* Customisation panel — placeholder for v2 */}
          <div style={{
            background: '#fff', border: `1px solid ${theme.border}`,
            borderRadius: '12px', boxShadow: theme.shadowSm,
            padding: '14px',
            opacity: 0.85,
          }}>
            <div style={{
              fontSize: '11px', fontWeight: 700, color: theme.inkMuted,
              textTransform: 'uppercase', letterSpacing: '.06em',
              display: 'flex', alignItems: 'center', gap: '6px',
              marginBottom: '8px',
            }}>
              <span>Customisation</span>
              <span style={{
                fontSize: '9px', fontWeight: 600,
                color: theme.warn,
                background: theme.warnSoft,
                border: `1px solid ${theme.warnBorder}`,
                padding: '1px 6px',
                borderRadius: '999px',
              }}>Coming v2</span>
            </div>
            <ul style={{
              margin: 0, padding: 0, listStyle: 'none',
              display: 'flex', flexDirection: 'column', gap: '6px',
              fontSize: '11px', color: theme.inkMuted,
            }}>
              <li>· Accent colour picker</li>
              <li>· Logo upload + size</li>
              <li>· Hide/show banking + signature</li>
              <li>· Per-template footer text</li>
              <li>· Default columns on items table</li>
            </ul>
          </div>
        </aside>
      </div>
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────────────
// Active preview switcher
// ──────────────────────────────────────────────────────────────────────────

function ActivePreview({ type }: { type: DocumentType }) {
  if (type === 'tax_invoice') {
    return <TaxInvoiceTemplate data={SAMPLE_TAX_INVOICE} />;
  }
  return null;
}

function ComingSoonPage({ meta }: { meta: TemplateMeta }) {
  return (
    <div style={{
      width: tokens.pageWidth, minHeight: tokens.pageHeight,
      background: '#fff',
      boxShadow: tokens.pageElevation,
      margin: '0 auto',
      display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
      gap: '12px',
      position: 'relative',
    }}>
      <div style={{
        position: 'absolute', left: 0, top: 0, bottom: 0,
        width: tokens.accentStripWidth, background: tokens.brand,
      }} />
      <div style={{
        fontSize: '11px', fontWeight: 700, color: tokens.inkMuted,
        textTransform: 'uppercase', letterSpacing: '.12em',
      }}>Signature template</div>
      <div style={{ fontSize: '28px', fontWeight: 700, color: tokens.ink, letterSpacing: '-.02em' }}>
        {meta.label}
      </div>
      <div style={{ fontSize: '13px', color: tokens.inkMuted, maxWidth: '400px', textAlign: 'center' }}>
        {meta.caption}. This template uses the same Ledger Edge components as Tax Invoice — title, columns
        and footer slots are configured. Ships once the flagship is approved.
      </div>
    </div>
  );
}
