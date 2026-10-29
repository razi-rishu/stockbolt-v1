import { describe, expect, it } from 'vitest';
import { EXIT_WINDOW_MS, parentPath, resolveBack, type BackContext } from '@/navigation/back';

const base: BackContext = {
  pathname: '/sales/invoices',
  editableFocused: false,
  overlayOpen: false,
  historyIndex: 0,
  exitArmedAt: null,
  now: 10_000,
};

describe('resolveBack', () => {
  it('blurs a focused field before anything else', () => {
    expect(resolveBack({ ...base, editableFocused: true, overlayOpen: true })).toEqual({ type: 'blur' });
  });

  it('closes an open modal or drawer before navigating', () => {
    expect(resolveBack({ ...base, overlayOpen: true, historyIndex: 3 })).toEqual({ type: 'close-overlay' });
  });

  it('arms exit on the dashboard, then exits on a second press inside the window', () => {
    expect(resolveBack({ ...base, pathname: '/dashboard' })).toEqual({ type: 'arm-exit' });
    expect(resolveBack({ ...base, pathname: '/dashboard', exitArmedAt: 10_000 - EXIT_WINDOW_MS })).toEqual({ type: 'exit' });
    expect(resolveBack({ ...base, pathname: '/dashboard', exitArmedAt: 10_000 - EXIT_WINDOW_MS - 1 })).toEqual({ type: 'arm-exit' });
  });

  it('goes back through history when there is some', () => {
    expect(resolveBack({ ...base, historyIndex: 2 })).toEqual({ type: 'history-back' });
  });

  it('falls back to the logical parent on a cold start', () => {
    expect(resolveBack({ ...base, pathname: '/sales/invoices/abc' })).toEqual({ type: 'navigate', to: '/sales/invoices' });
  });
});

describe('parentPath', () => {
  it('walks up to the dashboard', () => {
    expect(parentPath('/sales/invoices/abc/edit')).toBe('/sales/invoices/abc');
    expect(parentPath('/products')).toBe('/dashboard');
    expect(parentPath('/dashboard')).toBeNull();
  });

  it('sends auth screens back to login', () => {
    expect(parentPath('/forgot-password')).toBe('/login');
  });
});
