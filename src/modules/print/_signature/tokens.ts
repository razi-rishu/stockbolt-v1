/**
 * Signature print template tokens — Phase 14.01.
 *
 * Standalone design tokens for the print-document system. Kept separate
 * from src/ui/theme.ts so the print templates can be rendered cleanly
 * even if the in-app theme changes — a document printed in 2026 should
 * still match its original look in 2030.
 *
 * Naming convention follows the design doc:
 *   - brand / ink / hairline are semantic, not literal colour names
 *   - tracking is in em not px so it scales with the font size
 *   - all spacing uses A4-friendly mm units where possible
 */

export const tokens = {
  // ── Colours ────────────────────────────────────────────────────────────
  brand:        '#7c3aed',  // accent strip · anchor border · link
  brandDeep:    '#5b21b6',  // hover · pressed
  brandSoft:    '#f5f3ff',  // subtle fills
  brandSoftText:'#5b21b6',

  ink:          '#0F172A',  // primary text · stamp card bg
  inkMuted:     '#475569',  // labels · captions
  inkFaint:     '#94A3B8',  // dividers in legend · disabled
  hairline:     '#E2E8F0',  // separators · table row dividers
  hairlineSoft: '#F1F5F9',  // alternate-row hint (rarely used)

  paper:        '#FFFFFF',  // document background
  paperCanvas:  '#F8FAFC',  // surround around the page in preview
  surfaceCard:  '#F8FAFC',  // very-subtle card fills (party cards, etc.)
  surfaceStamp: '#0F172A',  // stamp card body
  stampInk:     '#FFFFFF',  // stamp card text

  // Status tones — used by status dots / pills on stamp cards
  statusDraft:        '#B45309',
  statusDraftSoft:    '#FFFBEB',
  statusConfirmed:    '#15803D',
  statusConfirmedSoft:'#F0FDF4',
  statusVoid:         '#DC2626',
  statusVoidSoft:     '#FEF2F2',
  statusPaid:         '#0F766E',
  statusPaidSoft:     '#F0FDFA',
  statusOverdue:      '#C2410C',
  statusOverdueSoft:  '#FFF7ED',

  // ── Geometry ───────────────────────────────────────────────────────────
  pageWidth:    '210mm',  // A4
  pageHeight:   '297mm',
  pagePadTop:   '18mm',
  pagePadRight: '16mm',
  pagePadBottom:'16mm',
  pagePadLeft:  '20mm',   // extra space to clear the accent strip
  accentStripWidth: '4mm',

  // Radii — kept small for premium / restrained feel
  radius:       '6px',
  radiusLg:     '10px',
  radiusXl:     '14px',

  // ── Typography ─────────────────────────────────────────────────────────
  fontStack:    `'Inter', 'Geist', system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif`,
  fontMono:     `'JetBrains Mono', 'SF Mono', ui-monospace, monospace`,

  // Sizes (px)
  fsTitleStamp:     '13px', // document type label on stamp card
  fsNumberStamp:    '18px', // document number
  fsMetaStamp:      '11px', // status / date on stamp card
  fsSectionLabel:   '10px', // BILL TO · LINE ITEMS · etc.
  fsBody:           '13px', // normal text · numbers
  fsBodySmall:      '11px',
  fsBodyMicro:      '10px', // legalese / fine print
  fsAnchorAmount:   '28px', // grand total on anchor card
  fsCompanyName:    '15px',

  // Weights
  wRegular: 400,
  wMedium:  500,
  wSemi:    600,
  wBold:    700,

  // Letter spacing (em — scales with font-size)
  trkLabel:  '0.12em',   // section labels
  trkTitle:  '0.14em',   // stamp title
  trkTight: '-0.01em',   // headings

  // Line heights (unitless)
  lhTight:   1.15,
  lhSnug:    1.35,
  lhRelaxed: 1.5,

  // ── Spacing ──────────────────────────────────────────────────────────
  gap1: '4px',
  gap2: '8px',
  gap3: '12px',
  gap4: '16px',
  gap5: '20px',
  gap6: '24px',
  gap8: '32px',
  gap10:'40px',

  // ── Shadows ─────────────────────────────────────────────────────────
  // Print docs use NO shadows; screen preview uses a soft elevation so the
  // "page" floats on the canvas.
  pageElevation: '0 1px 0 rgba(15,23,42,.04), 0 12px 32px -8px rgba(15,23,42,.10)',
} as const;

// Helper: hairline divider style as a JSX prop
export const hairlineStyle: React.CSSProperties = {
  height: '1px',
  background: tokens.hairline,
  border: 'none',
  width: '100%',
};

// Helper: tabular-nums style for any numeric cell
export const numericStyle: React.CSSProperties = {
  fontVariantNumeric: 'tabular-nums',
};
