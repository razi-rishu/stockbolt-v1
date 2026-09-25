import { describe, it, expect, vi } from 'vitest';
import { fetchAllPages, PAGE_SIZE, MAX_PAGES } from '@/lib/paging';

const rows = (n: number) => Array.from({ length: n }, (_, i) => ({ i }));
const noop = () => {};

describe('fetchAllPages', () => {
  it('returns a single short page without asking for another', async () => {
    const make = vi.fn(async () => ({ data: rows(42), error: null }));
    const out = await fetchAllPages('t', make, noop);
    expect(out).toHaveLength(42);
    expect(make).toHaveBeenCalledTimes(1);   // a short page IS the end
  });

  it('keeps paging while pages come back full', async () => {
    let call = 0;
    const make = vi.fn(async () => ({ data: rows(call++ < 2 ? PAGE_SIZE : 7), error: null }));
    const out = await fetchAllPages('t', make, noop);
    expect(out).toHaveLength(PAGE_SIZE * 2 + 7);
    expect(make).toHaveBeenCalledTimes(3);
  });

  it('asks for the right window each time', async () => {
    const seen: [number, number][] = [];
    let call = 0;
    await fetchAllPages('t', async (f, t) => {
      seen.push([f, t]);
      return { data: rows(call++ === 0 ? PAGE_SIZE : 1), error: null };
    }, noop);
    expect(seen).toEqual([[0, PAGE_SIZE - 1], [PAGE_SIZE, PAGE_SIZE * 2 - 1]]);
  });

  it('an exactly-full final page costs one extra empty request, not a lost row', async () => {
    // The boundary case: if the set is exactly PAGE_SIZE we cannot know it has
    // ended without asking again. Stopping early here would drop nothing today
    // but would drop everything past 1000 on a set of 1001.
    let call = 0;
    const out = await fetchAllPages('t', async () =>
      ({ data: rows(call++ === 0 ? PAGE_SIZE : 0), error: null }), noop);
    expect(out).toHaveLength(PAGE_SIZE);
  });

  it('warns rather than silently truncating at the cap', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const out = await fetchAllPages('trial balance', async () =>
      ({ data: rows(PAGE_SIZE), error: null }), noop);
    expect(out).toHaveLength(PAGE_SIZE * MAX_PAGES);
    expect(warn).toHaveBeenCalledOnce();
    expect(warn.mock.calls[0]![0]).toContain('trial balance');
    expect(warn.mock.calls[0]![0]).toContain('understated');
    warn.mockRestore();
  });

  it('surfaces an error through the caller-supplied handler', async () => {
    const onError = vi.fn();
    await fetchAllPages('t', async () => ({ data: null, error: { message: 'boom' } }), onError);
    expect(onError).toHaveBeenCalledWith({ message: 'boom' }, 't');
  });

  it('treats a null payload as an empty set, not a crash', async () => {
    const out = await fetchAllPages('t', async () => ({ data: null, error: null }), noop);
    expect(out).toEqual([]);
  });
});
