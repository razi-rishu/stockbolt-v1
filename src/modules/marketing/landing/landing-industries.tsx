/**
 * Industries, How it works and Why StockBolt. Industry names and activity
 * counts are read from the app's own taxonomy (industry-taxonomy.ts).
 */
import { useTranslation } from 'react-i18next';
import { Gift, Layers, LayoutGrid, Smartphone, Sparkles, TrendingUp, UserPlus, Settings2, Rocket } from 'lucide-react';
import { INDUSTRY_FAMILIES, activitiesOf } from '@/core/global-config/industry-taxonomy';
import { Reveal, SectionHead } from './landing-parts';
import { FEATURED_FAMILIES, SHOTS } from './landing-content';

export function LandingIndustries() {
  const { t, i18n } = useTranslation();
  const ar = i18n.language?.startsWith('ar');
  const featuredKeys = new Set(FEATURED_FAMILIES.map((f) => f.key));
  const others = INDUSTRY_FAMILIES.filter((f) => !featuredKeys.has(f.key));
  const name = (key: string) => {
    const fam = INDUSTRY_FAMILIES.find((f) => f.key === key);
    return fam ? (ar ? fam.name_ar : fam.name) : key;
  };

  return (
    <section id="industries" className="lp-section" aria-labelledby="lp-industries-title">
      <div className="lp-wrap">
        <div className="lp-ind">
          <div>
            <SectionHead id="lp-industries-title" kicker={t('landing.industries.kicker')} title={t('landing.industries.title')} lead={t('landing.industries.lead')} />
            <Reveal className="lp-ind-shot">
              <figure className="lp-shot" dir="ltr">
                <img src={SHOTS.activities.src} width={SHOTS.activities.w} height={SHOTS.activities.h}
                  alt={t('landing.industries.shot_alt')} loading="lazy" decoding="async" />
              </figure>
              <p className="lp-caption">{t('landing.industries.caption')}</p>
            </Reveal>
          </div>
          <Reveal delay={0.08}>
            <ul className="lp-ind-grid" style={{ listStyle: 'none', margin: 0, padding: 0 }}>
              {FEATURED_FAMILIES.map((f) => (
                <li key={f.key} className="lp-ind-tile">
                  <span className="lp-icon" aria-hidden="true"><f.icon size={20} /></span>
                  <strong>{name(f.key)}</strong>
                  <span className="lp-ind-count">{t('landing.industries.activities', { count: activitiesOf(f.key).length })}</span>
                </li>
              ))}
            </ul>
            <div className="lp-ind-more">
              <p>{t('landing.industries.more', { count: others.length })}</p>
              <div>{others.map((f) => <span key={f.key} className="lp-chip">{ar ? f.name_ar : f.name}</span>)}</div>
            </div>
          </Reveal>
        </div>
      </div>
    </section>
  );
}

export function LandingHow() {
  const { t } = useTranslation();
  const steps = [
    { n: 1, icon: UserPlus }, { n: 2, icon: Settings2 }, { n: 3, icon: Rocket },
  ];
  return (
    <section id="how-it-works" className="lp-section lp-section-subtle" aria-labelledby="lp-how-title">
      <div className="lp-wrap">
        <SectionHead center id="lp-how-title" kicker={t('landing.how.kicker')} title={t('landing.how.title')} />
        <ol className="lp-grid lp-grid-3 lp-steps" style={{ listStyle: 'none', padding: 0 }}>
          {steps.map((s, i) => (
            <li key={s.n}>
              <Reveal delay={i * 0.08} style={{ height: '100%' }}>
                <div className="lp-card lp-step">
                  <span className="lp-step-num" aria-hidden="true"><s.icon size={20} /></span>
                  <span className="lp-step-label">{t('landing.how.step', { n: s.n })}</span>
                  <h3>{t(`landing.how.s${s.n}_title`)}</h3>
                  <p>{t(`landing.how.s${s.n}_text`)}</p>
                </div>
              </Reveal>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}

export function LandingWhy() {
  const { t } = useTranslation();
  const items = [Gift, Layers, LayoutGrid, Sparkles, Smartphone, TrendingUp];
  return (
    <section id="why" className="lp-section" aria-labelledby="lp-why-title">
      <div className="lp-wrap">
        <SectionHead center id="lp-why-title" kicker={t('landing.why.kicker')} title={t('landing.why.title')} />
        <ul className="lp-grid lp-grid-3" style={{ listStyle: 'none', padding: 0 }}>
          {items.map((Icon, i) => (
            <li key={i}>
              <Reveal delay={(i % 3) * 0.06} style={{ height: '100%' }}>
                <div className="lp-card">
                  <span className="lp-icon" aria-hidden="true"><Icon size={22} /></span>
                  <h3>{t(`landing.why.w${i + 1}_title`)}</h3>
                  <p>{t(`landing.why.w${i + 1}_text`)}</p>
                </div>
              </Reveal>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
