import { describe, it, expect } from 'vitest';
import { convertToBase } from '../../src/lib/locale';

// Phase 17 — base-currency conversion convention used by the posting engine.
describe('convertToBase', () => {
  it('multiplies amount by rate, rounded to 2dp', () => {
    expect(convertToBase(1000, 3.67)).toBe(3670);
    expect(convertToBase(1000, 3.6725)).toBe(3672.5);
    expect(convertToBase(100, 0.045)).toBe(4.5);
  });
  it('treats rate 1 / same-currency as identity', () => {
    expect(convertToBase(1234.56, 1)).toBe(1234.56);
  });
  it('coerces null/undefined/strings safely', () => {
    expect(convertToBase(null, 3.67)).toBe(0);
    expect(convertToBase('1000', '3.67')).toBe(3670);
    expect(convertToBase(500, null)).toBe(500);   // missing rate → identity
  });
  it('rounds half-up to the cent', () => {
    expect(convertToBase(10, 1.005)).toBe(10.05);
  });
});
