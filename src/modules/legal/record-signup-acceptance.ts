/**
 * phase135 — after sign-up, record the Terms acceptance the user just ticked,
 * if a session already exists (no email confirmation pending) and the
 * published documents are exactly the texts this build shows. Otherwise do
 * nothing: the agreement screen asks on first sign-in. Never throws.
 */
import { getAdapter } from '@/data/index';
import { isNative } from '@/lib/platform';
import { legalFingerprints } from '@/legal/texts';

export async function recordSignupAcceptance(): Promise<boolean> {
  try {
    const adapter = getAdapter();
    const status = await adapter.legal.status();
    const owed = status.documents.filter((d) => d.requires_acceptance && !d.accepted);
    if (owed.length === 0) return false;
    const local = await legalFingerprints();
    if (owed.some((d) => local[d.doc_type] !== d.sha256)) return false;
    await adapter.legal.accept(owed.map((d) => ({ doc_type: d.doc_type, version: d.version, sha256: d.sha256 })),
      { onBehalfOfCompany: false, platform: isNative() ? 'android' : 'web', appVersion: null });
    return true;
  } catch {
    return false;
  }
}
