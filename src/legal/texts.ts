/**
 * phase135 — the exact legal texts this build shows, and their fingerprints.
 *
 * The published text lives in docs/legal/*.md and is bundled as-is. Its
 * SHA-256 (line endings normalised to \n, so Windows and Linux builds agree)
 * is what accept_legal() checks against the version published in
 * public.legal_documents: a user can only accept a text this build displays.
 * scripts/legal-fingerprint.mjs prints the same hashes for the publish SQL.
 */
import termsRaw from '../../docs/legal/terms-of-service.md?raw';
import privacyRaw from '../../docs/legal/privacy-policy.md?raw';
import type { LegalDocType } from '@/data/adapter';

export const normaliseLegalText = (s: string) => s.replace(/\r\n?/g, '\n');

export const LEGAL_TEXT: Record<LegalDocType, string> = {
  terms: normaliseLegalText(termsRaw),
  privacy: normaliseLegalText(privacyRaw),
};

export async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, '0')).join('');
}

let cache: Promise<Record<LegalDocType, string>> | null = null;
/** Fingerprints of the texts in this build (computed once). */
export function legalFingerprints(): Promise<Record<LegalDocType, string>> {
  cache ??= Promise.all([sha256Hex(LEGAL_TEXT.terms), sha256Hex(LEGAL_TEXT.privacy)])
    .then(([terms, privacy]) => ({ terms, privacy }));
  return cache;
}

/** "Version 1.0" etc., read from the document header. */
export function legalVersion(doc: LegalDocType): string | null {
  return /\*\*Version:\*\*\s*([^\s*]+)/.exec(LEGAL_TEXT[doc])?.[1] ?? null;
}
