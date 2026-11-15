/**
 * phase133 — checks on a support attachment BEFORE it is uploaded.
 *
 * The type is decided from the file's first bytes, not its name or the
 * browser's claim, so a renamed .exe or an HTML page called "shot.png" is
 * refused. The server then enforces the same list and the 5 MB limit
 * (bucket allowed_mime_types + file_size_limit, and support_register_attachment
 * re-checks size and type against what Storage recorded).
 * SVG is deliberately not allowed: it can carry script.
 */
export const SUPPORT_MAX_BYTES = 5 * 1024 * 1024;
export const SUPPORT_MAX_FILES = 5;
export type SupportMime = 'image/png' | 'image/jpeg' | 'image/webp' | 'application/pdf';
export type SupportFileError = 'too_large' | 'empty' | 'bad_type' | 'too_many';

/** Identify the format from the leading bytes. */
export function sniffSupportMime(head: Uint8Array): SupportMime | null {
  const b = head;
  const at = (i: number, ...v: number[]) => v.every((x, k) => b[i + k] === x);
  if (b.length >= 8 && at(0, 0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a)) return 'image/png';
  if (b.length >= 3 && at(0, 0xff, 0xd8, 0xff)) return 'image/jpeg';
  if (b.length >= 12 && at(0, 0x52, 0x49, 0x46, 0x46) && at(8, 0x57, 0x45, 0x42, 0x50)) return 'image/webp';
  if (b.length >= 5 && at(0, 0x25, 0x50, 0x44, 0x46, 0x2d)) return 'application/pdf';
  return null;
}

export interface CheckedFile { file: File; mime: SupportMime }

/** Check one file; returns its real type or the reason it is refused. */
export async function checkSupportFile(file: File): Promise<CheckedFile | SupportFileError> {
  if (file.size === 0) return 'empty';
  if (file.size > SUPPORT_MAX_BYTES) return 'too_large';
  const head = new Uint8Array(await file.slice(0, 16).arrayBuffer());
  const mime = sniffSupportMime(head);
  return mime ? { file, mime } : 'bad_type';
}
