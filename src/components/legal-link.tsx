/**
 * phase135 — a link to /terms, /privacy or /delete-account that opens beside
 * the current screen (a half-filled sign-up form is not lost). In the Android
 * app a full https address opens the system browser; on the web it is a new tab.
 */
import type { ReactNode } from 'react';
import { isNative } from '@/lib/platform';

const SITE = 'https://www.stockbolt.online';

export function LegalLink({ to, children, className }: { to: '/terms' | '/privacy' | '/delete-account'; children: ReactNode; className?: string }) {
  const href = isNative() ? `${SITE}${to}` : to;
  return (
    <a href={href} target="_blank" rel="noopener noreferrer" className={className}
      onClick={(e) => { if (isNative()) { e.preventDefault(); window.open(href, '_blank'); } }}>
      {children}
    </a>
  );
}
