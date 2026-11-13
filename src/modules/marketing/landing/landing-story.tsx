/**
 * Mission ("Starting a business is hard…") and Features sections.
 */
import { useTranslation } from 'react-i18next';
import { ArrowRight } from 'lucide-react';
import { getModule } from '@/core/global-config/module-registry';
import { Reveal, SectionHead } from './landing-parts';
import { ALSO_MODULES, FEATURES, SHOTS } from './landing-content';

export function LandingMission() {
  const { t } = useTranslation();
  return (
    <section className="lp-section" aria-labelledby="lp-mission-title">
      <div className="lp-wrap lp-mission">
        <Reveal>
          <p className="lp-kicker">{t('landing.mission.kicker')}</p>
          <h2 className="lp-h2" id="lp-mission-title">{t('landing.mission.title')}</h2>
          <p className="lp-body">{t('landing.mission.p1')}</p>
          <p className="lp-body">{t('landing.mission.p2')}</p>
        </Reveal>
        <Reveal delay={0.1}>
          <ul className="lp-pairs">
            {[1, 2, 3].map((n) => (
              <li key={n} className="lp-pair">
                <span className="lp-pair-from"><small>{t('landing.mission.from')}</small>{t(`landing.mission.pair_${n}_from`)}</span>
                <span className="lp-pair-arrow" aria-hidden="true"><ArrowRight size={16} className="lp-flip" /></span>
                <span className="lp-pair-to"><small>{t('landing.mission.to')}</small>{t(`landing.mission.pair_${n}_to`)}</span>
              </li>
            ))}
          </ul>
        </Reveal>
      </div>
    </section>
  );
}

export function LandingFeatures() {
  const { t, i18n } = useTranslation();
  const ar = i18n.language?.startsWith('ar');
  return (
    <section id="features" className="lp-section lp-section-subtle" aria-labelledby="lp-features-title">
      <div className="lp-wrap">
        <SectionHead center id="lp-features-title" kicker={t('landing.features.kicker')} title={t('landing.features.title')} lead={t('landing.features.lead')} />
        <ul className="lp-grid lp-grid-features" style={{ listStyle: 'none', padding: 0 }}>
          {FEATURES.map((f, i) => (
            <li key={f.key}>
              <Reveal delay={(i % 5) * 0.04} style={{ height: '100%' }}>
                <div className="lp-card">
                  <span className="lp-icon" aria-hidden="true"><f.icon size={22} /></span>
                  <h3>{t(`landing.features.${f.key}_title`)}</h3>
                  <p>{t(`landing.features.${f.key}_text`)}</p>
                </div>
              </Reveal>
            </li>
          ))}
        </ul>
        <div className="lp-also">
          <span className="lp-also-label">{t('landing.features.also')}:</span>
          {ALSO_MODULES.map((k) => {
            const m = getModule(k);
            return <span key={k} className="lp-chip">{ar ? m.name_ar : m.name}</span>;
          })}
          <span className="lp-chip">{t('landing.features.also_users')}</span>
          <span className="lp-chip">{t('landing.features.also_print')}</span>
        </div>

        <Reveal className="lp-spot">
          <div>
            <h3>{t('landing.features.spot_title')}</h3>
            <p>{t('landing.features.spot_text')}</p>
          </div>
          <figure className="lp-shot" dir="ltr">
            <img src={SHOTS.invoices.src} width={SHOTS.invoices.w} height={SHOTS.invoices.h}
              alt={t('landing.features.spot_alt')} loading="lazy" decoding="async" />
          </figure>
        </Reveal>
      </div>
    </section>
  );
}
