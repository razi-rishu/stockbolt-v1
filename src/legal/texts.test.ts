import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { renderToStaticMarkup } from 'react-dom/server';
import { createElement } from 'react';
import { LEGAL_TEXT, sha256Hex, normaliseLegalText, legalVersion } from './texts';
import { LegalMarkdown } from '@/modules/marketing/legal/legal-markdown';

describe('legal texts (phase135)', () => {
  it('the app fingerprints exactly what scripts/legal-fingerprint.mjs prints', async () => {
    for (const [doc, file] of [['terms', 'docs/legal/terms-of-service.md'], ['privacy', 'docs/legal/privacy-policy.md']] as const) {
      const disk = readFileSync(resolve(__dirname, '../..', file), 'utf8').replace(/\r\n?/g, '\n');
      const script = createHash('sha256').update(disk, 'utf8').digest('hex');
      expect(await sha256Hex(LEGAL_TEXT[doc]), doc).toBe(script);
    }
  });

  it('line endings do not change the fingerprint', async () => {
    expect(await sha256Hex(normaliseLegalText('a\r\nb\r\n'))).toBe(await sha256Hex('a\nb\n'));
  });

  it('reads the version from the document header', () => {
    expect(legalVersion('terms')).toBe('1.0');
    expect(legalVersion('privacy')).toBe('1.0');
  });

  it('the renderer never produces script or unsafe links', () => {
    const html = renderToStaticMarkup(createElement(LegalMarkdown, {
      source: '## A\n<script>alert(1)</script>\n[x](javascript:alert(1)) [ok](https://www.stockbolt.online) [m](mailto:a@b.c)',
    }));
    expect(html).not.toMatch(/<script/i);
    expect(html).not.toMatch(/href="javascript:/i);
    expect(html).toContain('href="https://www.stockbolt.online"');
    expect(html).toContain('href="mailto:a@b.c"');
  });
});
