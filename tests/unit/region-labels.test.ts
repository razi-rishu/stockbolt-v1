import { describe, it, expect } from 'vitest';
import { getRegionLabel } from '../../src/lib/locale';

// Phase 16 — dynamic region field label per country.
describe('getRegionLabel', () => {
  it('returns Emirate for UAE', () => {
    expect(getRegionLabel('AE')).toBe('Emirate');
    expect(getRegionLabel('ae')).toBe('Emirate');
  });
  it('returns State for India', () => {
    expect(getRegionLabel('IN')).toBe('State');
  });
  it('returns Region for other GCC and unknown/empty', () => {
    for (const c of ['SA', 'QA', 'OM', 'BH', 'KW']) expect(getRegionLabel(c)).toBe('Region');
    expect(getRegionLabel(undefined)).toBe('Region');
    expect(getRegionLabel(null)).toBe('Region');
    expect(getRegionLabel('')).toBe('Region');
  });
});
