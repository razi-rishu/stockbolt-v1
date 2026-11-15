import { describe, it, expect } from 'vitest';
import { sniffSupportMime, checkSupportFile, SUPPORT_MAX_BYTES } from './support-files';

const bytes = (...b: number[]) => new Uint8Array([...b, ...new Array(16).fill(0)]);
const file = (data: Uint8Array | string, name: string, type = 'image/png') =>
  new File([data as BlobPart], name, { type });

describe('support attachments (phase133)', () => {
  it('identifies formats by content', () => {
    expect(sniffSupportMime(bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a))).toBe('image/png');
    expect(sniffSupportMime(bytes(0xff, 0xd8, 0xff, 0xe0))).toBe('image/jpeg');
    expect(sniffSupportMime(bytes(0x52, 0x49, 0x46, 0x46, 1, 2, 3, 4, 0x57, 0x45, 0x42, 0x50))).toBe('image/webp');
    expect(sniffSupportMime(bytes(0x25, 0x50, 0x44, 0x46, 0x2d, 0x31))).toBe('application/pdf');
  });

  it('refuses HTML, SVG, executables and RIFF that is not WebP', () => {
    expect(sniffSupportMime(new TextEncoder().encode('<html><script>alert(1)</script>'))).toBeNull();
    expect(sniffSupportMime(new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg">'))).toBeNull();
    expect(sniffSupportMime(bytes(0x4d, 0x5a, 0x90, 0x00))).toBeNull();                 // MZ — Windows .exe
    expect(sniffSupportMime(bytes(0x52, 0x49, 0x46, 0x46, 1, 2, 3, 4, 0x57, 0x41, 0x56, 0x45))).toBeNull(); // WAV
  });

  it('a renamed file is judged by its content, not its name or claimed type', async () => {
    const html = file('<html><body>not an image</body></html>', 'screenshot.png', 'image/png');
    expect(await checkSupportFile(html)).toBe('bad_type');
    const png = file(bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a), 'whatever.txt', 'text/plain');
    const r = await checkSupportFile(png);
    expect(typeof r === 'string' ? r : r.mime).toBe('image/png');
  });

  it('empty and oversized files are refused', async () => {
    expect(await checkSupportFile(file(new Uint8Array(0), 'e.png'))).toBe('empty');
    const big = new Uint8Array(SUPPORT_MAX_BYTES + 1);
    big.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    expect(await checkSupportFile(file(big, 'big.png'))).toBe('too_large');
  });
});
