/**
 * Print engine — shared types (Phase 15).
 *
 * The single source of truth for the customizable print template record and
 * its section-toggle settings. The data adapter imports these (type-only) for
 * its `printTemplates` API; the renderer + editor import them at runtime.
 */

export type TemplateStyle =
  | 'classic'    // current look — backward-compatible default
  | 'modern'
  | 'minimal'
  | 'corporate'
  | 'gcc'
  | 'india_gst';

export type FontFamily = 'Inter' | 'Roboto' | 'Poppins' | 'Open Sans';
export type FontSize   = 'small' | 'medium' | 'large';
export type LogoPosition = 'left' | 'center' | 'right';
export type LogoSize     = 'small' | 'medium' | 'large';

/** Document types that can have a default template assigned. */
export type PrintDocumentType =
  | 'sales_invoice'
  | 'quotation'
  | 'credit_note'
  | 'debit_note'
  | 'delivery_note'
  | 'purchase_order'
  | 'purchase_invoice'
  | 'statement';

/**
 * Section-visibility toggles + footer text, persisted in the JSONB `settings`
 * column. Every flag defaults to TRUE (except warehouse) so older templates
 * that predate a new key keep showing everything — backward compatible.
 */
export interface TemplateSettings {
  showLogo:              boolean;
  showDueDate:           boolean;
  showBankDetails:       boolean;
  showSalesperson:       boolean;
  showPaymentTerms:      boolean;
  showCustomerTaxNumber: boolean;
  showQR:                boolean;
  showSignature:         boolean;
  showFooter:            boolean;
  showItemSku:           boolean;
  showItemDescription:   boolean;
  showUnitPrice:         boolean;
  showDiscount:          boolean;
  showTaxBreakdown:      boolean;
  showWarehouse:         boolean;
  showReferenceNumber:   boolean;
  /** Footer strip text — carried per template so it travels with the design. */
  footerEn:              string;
  footerAr:              string;
}

/** A saved print template row (mirrors the print_templates table). */
export interface PrintTemplate {
  id:              string;
  company_id:      string;
  name:            string;
  template_style:  TemplateStyle;
  primary_color:   string;
  secondary_color: string;
  accent_color:    string;
  text_color:      string;
  font_family:     FontFamily;
  font_size:       FontSize;
  logo_position:   LogoPosition;
  logo_size:       LogoSize;
  is_default:      boolean;
  settings:        TemplateSettings;
  created_at?:     string;
  updated_at?:     string;
}

/** Default-toggle set: everything visible except warehouse. */
export const DEFAULT_TEMPLATE_SETTINGS: TemplateSettings = {
  showLogo:              true,
  showDueDate:           true,
  showBankDetails:       true,
  showSalesperson:       true,
  showPaymentTerms:      true,
  showCustomerTaxNumber: true,
  showQR:                true,
  showSignature:         true,
  showFooter:            true,
  showItemSku:           true,
  showItemDescription:   true,
  showUnitPrice:         true,
  showDiscount:          true,
  showTaxBreakdown:      true,
  showWarehouse:         false,
  showReferenceNumber:   true,
  footerEn:              '',
  footerAr:              '',
};

/**
 * Normalise a possibly-partial settings blob (from the DB JSONB, which may
 * predate newer keys) into a fully-populated TemplateSettings. Missing keys
 * fall back to the all-visible defaults — backward compatible.
 */
export function normalizeSettings(raw: unknown): TemplateSettings {
  const r = (raw ?? {}) as Partial<TemplateSettings>;
  return { ...DEFAULT_TEMPLATE_SETTINGS, ...r };
}
