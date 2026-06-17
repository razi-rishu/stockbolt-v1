import { describe, it, expect } from 'vitest';
import {
  STYLE_PRESETS, STYLE_ORDER, FONT_SIZE_PX, LOGO_SIZE_PX, FONT_STACK,
} from '../../src/modules/print/engine/presets';
import {
  DEFAULT_TEMPLATE_SETTINGS, normalizeSettings,
} from '../../src/modules/print/engine/types';
import { getTaxLabels } from '../../src/lib/locale';

// Phase 15 — print template engine. Pure-function guards: every style resolves
// a full palette, settings default to all-visible, India GST forces GST/GSTIN.

const HEX = /^#[0-9a-fA-F]{6}$/;

describe('STYLE_PRESETS', () => {
  it('has exactly the 6 expected styles', () => {
    expect(STYLE_ORDER).toEqual(['classic', 'modern', 'minimal', 'corporate', 'gcc', 'india_gst']);
    expect(Object.keys(STYLE_PRESETS).sort()).toEqual([...STYLE_ORDER].sort());
  });

  it('every preset resolves a complete colour palette', () => {
    for (const key of STYLE_ORDER) {
      const p = STYLE_PRESETS[key];
      expect(p.defaultColors.primary).toMatch(HEX);
      expect(p.defaultColors.secondary).toMatch(HEX);
      expect(p.defaultColors.accent).toMatch(HEX);
      expect(p.defaultColors.text).toMatch(HEX);
      expect(p.label.length).toBeGreaterThan(0);
    }
  });

  it('india_gst forces GST terminology', () => {
    expect(STYLE_PRESETS.india_gst.forceGstLabels).toBe(true);
    // and the locale helper backs it: IN → GST / GSTIN
    expect(getTaxLabels('IN')).toEqual({ taxName: 'GST', registrationName: 'GSTIN' });
  });

  it('classic is the backward-compatible default style', () => {
    expect(STYLE_PRESETS.classic.accentStrip).toBe(true);
    expect(STYLE_PRESETS.classic.key).toBe('classic');
  });
});

describe('typography + logo scales', () => {
  it('have all three size keys', () => {
    expect(Object.keys(FONT_SIZE_PX).sort()).toEqual(['large', 'medium', 'small']);
    expect(Object.keys(LOGO_SIZE_PX).sort()).toEqual(['large', 'medium', 'small']);
    expect(FONT_SIZE_PX.small).toBeLessThan(FONT_SIZE_PX.large);
    expect(LOGO_SIZE_PX.small).toBeLessThan(LOGO_SIZE_PX.large);
  });

  it('font stacks exist for all 4 selectable fonts', () => {
    for (const f of ['Inter', 'Roboto', 'Poppins', 'Open Sans']) {
      expect(FONT_STACK[f]).toContain(f);
    }
  });
});

describe('TemplateSettings defaults', () => {
  it('default to all-visible except warehouse', () => {
    expect(DEFAULT_TEMPLATE_SETTINGS.showLogo).toBe(true);
    expect(DEFAULT_TEMPLATE_SETTINGS.showTaxBreakdown).toBe(true);
    expect(DEFAULT_TEMPLATE_SETTINGS.showFooter).toBe(true);
    expect(DEFAULT_TEMPLATE_SETTINGS.showWarehouse).toBe(false);
  });

  it('normalizeSettings fills missing keys from defaults (backward compatible)', () => {
    const partial = normalizeSettings({ showQR: false });
    expect(partial.showQR).toBe(false);            // honoured
    expect(partial.showLogo).toBe(true);           // filled from default
    expect(partial.showItemSku).toBe(true);        // filled from default
    expect(partial.footerEn).toBe('');             // filled from default
  });

  it('normalizeSettings tolerates null/undefined', () => {
    expect(normalizeSettings(null).showLogo).toBe(true);
    expect(normalizeSettings(undefined).showWarehouse).toBe(false);
  });
});
