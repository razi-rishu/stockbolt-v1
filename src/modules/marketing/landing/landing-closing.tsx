/**
 * Free access, FAQ, final call to action and footer.
 *
 * The free offer mirrors the live plan configuration (phase35): every new
 * company's subscription starts as a 365-day trial of the single
 * "StockBolt Professional" plan, then USD 21 / 105 / 200 per month / six
 * months / year. If those numbers change, change this copy with them.
 */
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { ArrowRight, CheckCircle2, Plus } from 'lucide-react';
import { OPERATOR_NAME, SUPPORT_EMAIL } from '@/lib/legal';
import { BrandRow, Reveal, SectionHead } from './landing-parts';

export function LandingFree() {
  const { t } = useTranslation();
  return (
    <section className="lp-section" aria-labelledby="lp-free-title" style={{ paddingTop: 0 }}>
      <div className="lp-wrap">
        <Reveal className="lp-free">
          <div>
            <p className="lp-kicker">{t('landing.free.kicker')}</p>
            <h2 id="lp-free-title">{t('landing.free.title')}</h2>
            <p>{t('landing.free.text')}</p>
            <ul>
              {(['b1', 'b2', 'b3'] as const).map((k) => (
                <li key={k}><CheckCircle2 size={18} aria-hidden="true" />{t(`landing.free.${k}`)}</li>
              ))}
            </ul>
          </div>
          <div className="lp-free-card">
            <h3>{t('landing.free.after_title')}</h3>
            <p>{t('landing.free.after_text')}</p>
            <Link to="/register" className="lp-btn lp-btn-white lp-btn-lg">
              {t('landing.free.cta')} <ArrowRight size={18} className="lp-flip" aria-hidden="true" />
            </Link>
          </div>
        </Reveal>
      </div>
    </section>
  );
}

export function LandingFaq() {
  const { t } = useTranslation();
  return (
    <section id="faq" className="lp-section lp-section-subtle" aria-labelledby="lp-faq-title">
      <div className="lp-wrap">
        <SectionHead center id="lp-faq-title" kicker={t('landing.faq.kicker')} title={t('landing.faq.title')} />
        <div className="lp-faq">
          {[1, 2, 3, 4, 5, 6, 7, 8].map((n) => (
            <details key={n}>
              <summary>{t(`landing.faq.q${n}`)}<Plus size={20} aria-hidden="true" /></summary>
              <p>{t(`landing.faq.a${n}`)}</p>
            </details>
          ))}
        </div>
      </div>
    </section>
  );
}

export function LandingFinalCta() {
  const { t } = useTranslation();
  return (
    <section className="lp-section" aria-labelledby="lp-final-title">
      <div className="lp-wrap">
        <Reveal className="lp-final">
          <BrandRow size={40} />
          <h2 className="lp-h2" id="lp-final-title">{t('landing.cta.title')}</h2>
          <p className="lp-lead">{t('landing.cta.text')}</p>
          <Link to="/register" className="lp-btn lp-btn-primary lp-btn-lg">
            {t('landing.cta.button')} <ArrowRight size={18} className="lp-flip" aria-hidden="true" />
          </Link>
        </Reveal>
      </div>
    </section>
  );
}

export function LandingFooter() {
  const { t } = useTranslation();
  const cols: { title: string; links: { label: string; to?: string; href?: string }[] }[] = [
    { title: t('landing.footer.product'), links: [
      { label: t('landing.nav.features'), href: '#features' },
      { label: t('landing.nav.how'), href: '#how-it-works' },
      { label: t('landing.nav.industries'), href: '#industries' },
      { label: t('landing.footer.faq'), href: '#faq' },
    ] },
    { title: t('landing.footer.account'), links: [
      { label: t('landing.footer.sign_in'), to: '/login' },
      { label: t('landing.footer.sign_up'), to: '/register' },
    ] },
    { title: t('landing.footer.legal'), links: [
      { label: t('landing.footer.privacy'), to: '/privacy' },
      { label: t('landing.footer.delete_account'), to: '/delete-account' },
    ] },
    { title: t('landing.footer.help'), links: [
      { label: t('landing.footer.support'), href: `mailto:${SUPPORT_EMAIL}?subject=${encodeURIComponent('StockBolt support')}` },
    ] },
  ];
  return (
    <footer className="lp-footer">
      <div className="lp-wrap lp-footer-grid">
        <div>
          <BrandRow />
          <p className="lp-footer-about">{t('landing.footer.about')}</p>
        </div>
        {cols.map((c) => (
          <nav key={c.title} aria-label={c.title}>
            <h2>{c.title}</h2>
            <ul>
              {c.links.map((l) => (
                <li key={l.label}>{l.to ? <Link to={l.to}>{l.label}</Link> : <a href={l.href}>{l.label}</a>}</li>
              ))}
            </ul>
          </nav>
        ))}
      </div>
      <div className="lp-wrap">
        <div className="lp-footer-bottom">
          <span>© {new Date().getFullYear()} StockBolt · {OPERATOR_NAME}. {t('landing.footer.rights')}</span>
        </div>
      </div>
    </footer>
  );
}
