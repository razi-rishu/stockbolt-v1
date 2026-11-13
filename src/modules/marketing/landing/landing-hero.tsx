/**
 * Hero: the mission line, both calls to action, and real StockBolt screens
 * (captured from a demo company on local staging — labelled as such).
 */
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { ArrowRight, CheckCircle2, Sparkles, Info } from 'lucide-react';
import { Reveal } from './landing-parts';
import { SHOTS } from './landing-content';

export function LandingHero() {
  const { t } = useTranslation();
  return (
    <section className="lp-hero" aria-labelledby="lp-hero-title">
      <div className="lp-wrap lp-hero-grid">
        <Reveal>
          <span className="lp-pill"><Sparkles size={15} aria-hidden="true" />{t('landing.hero.kicker')}</span>
          <h1 className="lp-h1" id="lp-hero-title">
            {t('landing.hero.title_1')}
            <span className="lp-accent">{t('landing.hero.title_2')}</span>
          </h1>
          <p className="lp-hero-lead">{t('landing.hero.lead')}</p>
          <div className="lp-hero-ctas">
            <Link to="/register" className="lp-btn lp-btn-primary lp-btn-lg">
              {t('landing.hero.cta_primary')} <ArrowRight size={18} className="lp-flip" aria-hidden="true" />
            </Link>
            <a href="#features" className="lp-btn lp-btn-ghost lp-btn-lg">{t('landing.hero.cta_secondary')}</a>
          </div>
          <ul className="lp-points">
            {(['point_1', 'point_2', 'point_3'] as const).map((k) => (
              <li key={k}><CheckCircle2 size={17} aria-hidden="true" />{t(`landing.hero.${k}`)}</li>
            ))}
          </ul>
        </Reveal>

        <Reveal delay={0.12}>
          <figure className="lp-showcase">
            <div className="lp-stage">
            <div className="lp-browser" dir="ltr">
              <div className="lp-browser-bar" aria-hidden="true"><span /><span /><span /><em>stockbolt.online</em></div>
              <img
                src={SHOTS.dashboard.src} width={SHOTS.dashboard.w} height={SHOTS.dashboard.h}
                alt={t('landing.hero.shot_alt')} fetchPriority="high" decoding="async"
              />
            </div>
            <div className="lp-phone">
              <img
                src={SHOTS.phone.src} width={SHOTS.phone.w} height={SHOTS.phone.h}
                alt={t('landing.hero.phone_alt')} loading="lazy" decoding="async"
              />
            </div>
            </div>
            <figcaption className="lp-caption"><Info size={14} aria-hidden="true" />{t('landing.hero.caption')}</figcaption>
          </figure>
        </Reveal>
      </div>
    </section>
  );
}
