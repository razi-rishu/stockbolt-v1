/**
 * StockBolt public website (2026-11 redesign, Ocean Teal).
 *
 * Public page at `/` (anonymous visitors) and `/landing`. Positions StockBolt
 * as accounting and business management for startups and small businesses
 * across industries. Every claim is checked against the product:
 *  - free offer = the live plan configuration (see landing-closing.tsx);
 *  - features and industries come from the module registry and the industry
 *    taxonomy (see landing/landing-content.ts);
 *  - screenshots are real screens of a demo company, captioned as such.
 * All copy is translated (landing.* in en.json / ar.json).
 */
import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { LandingHeader } from './landing/landing-header';
import { LandingHero } from './landing/landing-hero';
import { LandingMission, LandingFeatures } from './landing/landing-story';
import { LandingIndustries, LandingHow, LandingWhy } from './landing/landing-industries';
import { LandingFree, LandingFaq, LandingFinalCta, LandingFooter } from './landing/landing-closing';
import './landing/landing.css';

/** Sets a <meta> tag's content and returns a function that puts it back. */
function setMeta(selector: string, attr: 'name' | 'property', key: string, content: string): () => void {
  let el = document.head.querySelector<HTMLMetaElement>(selector);
  const created = !el;
  if (!el) { el = document.createElement('meta'); el.setAttribute(attr, key); document.head.appendChild(el); }
  const prev = el.getAttribute('content');
  el.setAttribute('content', content);
  return () => { if (created) el?.remove(); else if (prev !== null) el?.setAttribute('content', prev); };
}

export default function LandingPage() {
  const { t, i18n } = useTranslation();

  useEffect(() => {
    const prevTitle = document.title;
    document.title = t('landing.meta_title');
    const undo = [
      setMeta('meta[name="description"]', 'name', 'description', t('landing.meta_description')),
      setMeta('meta[property="og:title"]', 'property', 'og:title', t('landing.meta_title')),
      setMeta('meta[property="og:description"]', 'property', 'og:description', t('landing.meta_description')),
    ];
    return () => { document.title = prevTitle; undo.forEach((u) => u()); };
  }, [t, i18n.language]);

  return (
    <div className="sb-landing">
      <a href="#main" className="lp-skip">{t('landing.skip')}</a>
      <LandingHeader />
      <main id="main">
        <LandingHero />
        <LandingMission />
        <LandingFeatures />
        <LandingIndustries />
        <LandingHow />
        <LandingWhy />
        <LandingFree />
        <LandingFaq />
        <LandingFinalCta />
      </main>
      <LandingFooter />
    </div>
  );
}
