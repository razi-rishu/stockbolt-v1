import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { BrandLogo } from '@/components/brand-logo';
import { LEGAL_UPDATED } from '@/lib/legal';

/**
 * Shared frame for the public legal pages (/privacy, /delete-account).
 * Public on purpose: Google Play links to them, and people read them
 * without an account. English only, like the marketing landing page.
 */
export function LegalLayout({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="min-h-screen bg-surface-page">
      <header className="border-b border-border-subtle bg-surface-card">
        <div className="mx-auto flex max-w-3xl items-center justify-between px-5 py-4">
          <Link to="/" aria-label="StockBolt home"><BrandLogo mark={30} text={15} /></Link>
          <nav className="flex gap-4 text-sm">
            <Link to="/privacy" className="text-ink-secondary hover:text-ink-primary">Privacy</Link>
            <Link to="/delete-account" className="text-ink-secondary hover:text-ink-primary">Delete account</Link>
          </nav>
        </div>
      </header>
      <main className="mx-auto max-w-3xl px-5 py-8 sm:py-12">
        <h1 className="text-2xl font-bold text-ink-primary sm:text-3xl">{title}</h1>
        <p className="mt-1 text-sm text-ink-tertiary">Last updated: {LEGAL_UPDATED}</p>
        <div className="legal-body mt-6 space-y-4 text-[15px] leading-relaxed text-ink-primary/90 [&_h2]:mt-8 [&_h2]:text-lg [&_h2]:font-semibold [&_h2]:text-ink-primary [&_li]:ms-5 [&_li]:list-disc [&_a]:text-brand-600 [&_a]:underline">
          {children}
        </div>
      </main>
    </div>
  );
}
