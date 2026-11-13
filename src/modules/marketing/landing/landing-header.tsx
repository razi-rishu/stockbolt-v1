/**
 * Sticky website header: brand, section links, Sign In and Get Started Free.
 * Below 1024px the links fold into a menu panel (Escape or a link closes it).
 */
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Menu, X } from 'lucide-react';
import { LanguageToggle } from '@/components/language-toggle';
import { BrandRow } from './landing-parts';

const LINKS = [
  { href: '#features', key: 'features' },
  { href: '#how-it-works', key: 'how' },
  { href: '#industries', key: 'industries' },
  { href: '#why', key: 'why' },
] as const;

export function LandingHeader() {
  const { t } = useTranslation();
  const [scrolled, setScrolled] = useState(false);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 8);
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open]);

  const links = LINKS.map((l) => (
    <a key={l.key} href={l.href} onClick={() => setOpen(false)}>{t(`landing.nav.${l.key}`)}</a>
  ));

  return (
    <header className={`lp-header${scrolled ? ' is-scrolled' : ''}`}>
      <div className="lp-wrap lp-header-row">
        <Link to="/" aria-label={t('landing.nav.home')} style={{ textDecoration: 'none' }}>
          <BrandRow />
        </Link>
        <nav className="lp-nav" aria-label={t('landing.nav.primary')}>{links}</nav>
        <div className="lp-header-actions">
          <LanguageToggle />
          <Link to="/login" className="lp-signin">{t('landing.nav.sign_in')}</Link>
          <Link to="/register" className="lp-btn lp-btn-primary">{t('landing.nav.get_started')}</Link>
        </div>
        <div className="lp-mobile-tools">
          <LanguageToggle />
          <button
            type="button"
            className="lp-menu-btn"
            aria-expanded={open}
            aria-controls="lp-mobile-menu"
            aria-label={t(open ? 'landing.nav.close_menu' : 'landing.nav.open_menu')}
            onClick={() => setOpen((o) => !o)}
          >
            {open ? <X size={20} /> : <Menu size={20} />}
          </button>
        </div>
      </div>
      {open && (
        <div id="lp-mobile-menu" className="lp-mobile-panel">
          <nav aria-label={t('landing.nav.primary')}>{links}</nav>
          <div className="lp-mobile-cta">
            <Link to="/login" className="lp-btn lp-btn-ghost">{t('landing.nav.sign_in')}</Link>
            <Link to="/register" className="lp-btn lp-btn-primary">{t('landing.nav.get_started')}</Link>
          </div>
        </div>
      )}
    </header>
  );
}
