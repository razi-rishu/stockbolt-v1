/**
 * phase135 — a published legal document: section navigation, version,
 * effective date and the fingerprint of the exact text shown (the same
 * fingerprint accept_legal() checks), then the text itself.
 */
import { useEffect, useState } from 'react';
import type { LegalDocType } from '@/data/adapter';
import { LEGAL_TEXT, legalFingerprints } from '@/legal/texts';
import { LegalLayout } from './legal-layout';
import { LegalMarkdown, headingsOf } from './legal-markdown';

const field = (md: string, name: string) =>
  new RegExp(String.raw`\*\*` + name + String.raw`:\*\*\s*([^\n]+)`).exec(md)?.[1]?.replace(/\s+$/, '') ?? '—';

export function LegalDocument({ doc, title }: { doc: LegalDocType; title: string }) {
  const md = LEGAL_TEXT[doc];
  const [sha, setSha] = useState('');
  useEffect(() => { void legalFingerprints().then((f) => setSha(f[doc])); }, [doc]);
  const sections = headingsOf(md);
  return (
    <LegalLayout title={title} updated={<>Version {field(md, 'Version')} · Effective {field(md, 'Effective date')}</>}>
      <nav aria-label="Sections" className="rounded-xl border border-border-subtle bg-surface-card p-4 text-sm">
        <p className="mb-2 font-semibold text-ink-primary">Contents</p>
        <ol className="grid gap-1 sm:grid-cols-2">
          {sections.map((s) => <li key={s.id} className="!list-none !ms-0"><a href={`#${s.id}`}>{s.text}</a></li>)}
        </ol>
      </nav>
      <LegalMarkdown source={md} />
      <p className="mt-8 break-all text-xs text-ink-tertiary">
        Document fingerprint (SHA-256): <code>{sha || '…'}</code>
      </p>
    </LegalLayout>
  );
}
