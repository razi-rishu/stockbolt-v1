/**
 * Print engine — style presets (Phase 15).
 *
 * The 6 built-in "styles" are NOT 6 separate template components — they are
 * preset bundles (layout flags + a default colour palette) that feed the ONE
 * configurable renderer (ConfigurableDocTemplate). This is how Zoho/Odoo work:
 * every colour / toggle / font option works on every style.
 *
 *   • `defaultColors` — applied to the colour fields when a user PICKS a style
 *     in the editor. The renderer itself always reads the template's own
 *     colours (which the DB always populates).
 *   • layout flags (`accentStrip`, `headerVariant`, `tableVariant`, …) — read
 *     by the renderer to vary the visual structure.
 *
 * `classic` is the backward-compatible default and reproduces the current
 * printed look (gold accent, left strip, lined table).
 */
import type { TemplateStyle } from './types';

export interface StylePalette {
  primary:   string;
  secondary: string;
  accent:    string;
  text:      string;
}

export interface StylePreset {
  key:           TemplateStyle;
  label:         string;
  description:   string;
  defaultColors: StylePalette;
  /** Left vertical accent strip down the page edge (the current "classic" look). */
  accentStrip:   boolean;
  /** Header treatment. */
  headerVariant: 'plain' | 'band' | 'split' | 'centered';
  /** Line-items table treatment. */
  tableVariant:  'lined' | 'striped' | 'bordered';
  /** Section labels (BILL TO, LINE ITEMS) rendered uppercase + tracked. */
  uppercaseLabels: boolean;
  /** Force GST / GSTIN tax terminology regardless of company country. */
  forceGstLabels?: boolean;
}

export const STYLE_PRESETS: Record<TemplateStyle, StylePreset> = {
  classic: {
    key: 'classic',
    label: 'Classic',
    description: 'The original StockBolt look — gold accent strip, lined table. Safe default.',
    defaultColors: { primary: '#0F172A', secondary: '#475569', accent: '#F5C242', text: '#0F172A' },
    accentStrip: true,
    headerVariant: 'plain',
    tableVariant: 'lined',
    uppercaseLabels: true,
  },
  modern: {
    key: 'modern',
    label: 'Modern',
    description: 'Bold coloured header band, zebra-striped table. Clean and contemporary.',
    defaultColors: { primary: '#1E3A8A', secondary: '#64748B', accent: '#3B82F6', text: '#111827' },
    accentStrip: false,
    headerVariant: 'band',
    tableVariant: 'striped',
    uppercaseLabels: true,
  },
  minimal: {
    key: 'minimal',
    label: 'Minimal',
    description: 'Monochrome, no strip, hairline table. Maximum white space.',
    defaultColors: { primary: '#111827', secondary: '#6B7280', accent: '#111827', text: '#111827' },
    accentStrip: false,
    headerVariant: 'plain',
    tableVariant: 'lined',
    uppercaseLabels: false,
  },
  corporate: {
    key: 'corporate',
    label: 'Corporate',
    description: 'Split header, bordered table, navy + gold. Formal and structured.',
    defaultColors: { primary: '#1E3A8A', secondary: '#475569', accent: '#B8860B', text: '#0F172A' },
    accentStrip: true,
    headerVariant: 'split',
    tableVariant: 'bordered',
    uppercaseLabels: true,
  },
  gcc: {
    key: 'gcc',
    label: 'GCC Style',
    description: 'Green + gold palette, centred header, VAT-summary forward. Tuned for the Gulf.',
    defaultColors: { primary: '#064E3B', secondary: '#475569', accent: '#C8A04B', text: '#0F172A' },
    accentStrip: true,
    headerVariant: 'centered',
    tableVariant: 'lined',
    uppercaseLabels: true,
  },
  india_gst: {
    key: 'india_gst',
    label: 'India GST Style',
    description: 'GST/GSTIN terminology + prominent tax summary, bordered table. Tuned for India.',
    defaultColors: { primary: '#1E3A8A', secondary: '#475569', accent: '#FB923C', text: '#0F172A' },
    accentStrip: false,
    headerVariant: 'band',
    tableVariant: 'bordered',
    uppercaseLabels: true,
    forceGstLabels: true,
  },
};

export const STYLE_ORDER: TemplateStyle[] =
  ['classic', 'modern', 'minimal', 'corporate', 'gcc', 'india_gst'];

/** Base font px for the 3 size options. */
export const FONT_SIZE_PX: Record<'small' | 'medium' | 'large', number> = {
  small: 11,
  medium: 12.5,
  large: 14,
};

/** Logo height in px for the 3 size options. */
export const LOGO_SIZE_PX: Record<'small' | 'medium' | 'large', number> = {
  small: 40,
  medium: 56,
  large: 76,
};

/** CSS font-family stack for each selectable font (with safe fallbacks). */
export const FONT_STACK: Record<string, string> = {
  Inter:       `'Inter', system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif`,
  Roboto:      `'Roboto', system-ui, -apple-system, 'Segoe UI', sans-serif`,
  Poppins:     `'Poppins', system-ui, -apple-system, 'Segoe UI', sans-serif`,
  'Open Sans': `'Open Sans', system-ui, -apple-system, 'Segoe UI', sans-serif`,
};
