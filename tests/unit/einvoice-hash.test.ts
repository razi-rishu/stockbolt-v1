/**
 * AC-4C — unit test for the e-invoice content hash (sha-256).
 * Run: npx vitest run tests/unit/einvoice-hash.test.ts
 */
import { describe, it, expect } from 'vitest';
import { sha256Hex } from '../../src/lib/einvoice/hash';

describe('sha256Hex', () => {
  it('matches known SHA-256 test vectors', async () => {
    expect(await sha256Hex('')).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
    expect(await sha256Hex('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  });

  it('is stable and case/whitespace sensitive', async () => {
    const a = await sha256Hex('<Invoice>x</Invoice>');
    const b = await sha256Hex('<Invoice>x</Invoice>');
    const c = await sha256Hex('<Invoice>x</Invoice> ');
    expect(a).toBe(b);
    expect(a).not.toBe(c);
    expect(a).toMatch(/^[0-9a-f]{64}$/);
  });
});
