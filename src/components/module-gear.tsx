/**
 * The gear on a module's list and report pages: a short list of that module's
 * settings. It knows the module from the address, so a page needs nothing to
 * have one. Not shown on records and forms, nor to a user with nothing to open.
 */
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { Link, useLocation } from 'react-router-dom';
import { Landmark, Settings } from 'lucide-react';
import { useBackHandler } from '@/navigation/use-back-handler';
import { useHasPermission } from '@/hooks/use-permissions';
import { useSettingsSections } from '@/hooks/use-settings-sections';
import { gearItems, gearModule, type GearModule } from '@/lib/module-settings';
import { itemIcon, itemTitle } from '@/modules/settings/_nav-ocean';

const WIDTH = 270;
/** Set up per till, so a cashier without access to Settings still needs it. */
const OPEN_TO_ALL = '/settings/hardware';
/** The one gear entry that is not a Settings page. */
const BANK_ACCOUNTS = '/banking/bank-accounts';

export function ModuleGear() {
  const { pathname } = useLocation();
  const mod = gearModule(pathname);
  return mod ? <Gear key={pathname} mod={mod} pathname={pathname} /> : null;
}

function Gear({ mod, pathname }: { mod: GearModule; pathname: string }) {
  const { t } = useTranslation();
  const canSettings = useHasPermission('settings.read');
  const canBank = useHasPermission('accounting.read');
  const sections = useSettingsSections();
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const button = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const close = () => setOpen(false);
  useBackHandler(open, close);

  const all = new Map(sections.flatMap((s) => s.items).filter((i) => !i.comingSoon).map((i) => [i.to, i]));
  const items = gearItems(mod, pathname).flatMap((to): { to: string; icon: ReactNode; title: string }[] => {
    if (to === BANK_ACCOUNTS) return canBank ? [{ to, icon: <Landmark size={17} />, title: t('banking.accounts_title') }] : [];
    const item = all.get(to);
    return item && (canSettings || to === OPEN_TO_ALL) ? [{ to, icon: itemIcon(item, 17), title: itemTitle(t, item) }] : [];
  });

  // Under the button, kept on screen; the page end side in Arabic too.
  useLayoutEffect(() => {
    if (!open || !button.current) return;
    const r = button.current.getBoundingClientRect();
    const rtl = document.documentElement.dir === 'rtl';
    const left = rtl ? r.left : r.right - WIDTH;
    setPos({ top: r.bottom + 6, left: Math.max(8, Math.min(left, window.innerWidth - WIDTH - 8)) });
  }, [open]);
  useEffect(() => {
    if (!open) return;
    const outside = (e: MouseEvent) => {
      const n = e.target as Node;
      if (!panel.current?.contains(n) && !button.current?.contains(n)) setOpen(false);
    };
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') { setOpen(false); button.current?.focus(); } };
    const away = () => setOpen(false);
    document.addEventListener('mousedown', outside);
    document.addEventListener('keydown', esc);
    window.addEventListener('resize', away);
    window.addEventListener('scroll', away, true);
    return () => {
      document.removeEventListener('mousedown', outside);
      document.removeEventListener('keydown', esc);
      window.removeEventListener('resize', away);
      window.removeEventListener('scroll', away, true);
    };
  }, [open]);

  if (items.length === 0) return null;
  const title = t(`moduleGear.${mod}`);
  return (
    <span data-print-hide className="sb-gear-wrap">
      <button ref={button} type="button" className={`sb-gear-btn ${open ? 'is-open' : ''}`} aria-label={title} title={title}
        aria-expanded={open} data-testid="module-gear" onClick={() => setOpen((o) => !o)}>
        <Settings size={18} aria-hidden="true" />
      </button>
      {open && pos && createPortal(
        <div ref={panel} className="sb-ocean sb-gear-panel" style={{ top: pos.top, left: pos.left, width: WIDTH }} role="dialog" aria-label={title} data-testid="module-gear-panel">
          <p className="sb-gear-title">{title}</p>
          {items.map((i) => (
            <Link key={i.to} to={i.to} className="sb-gear-item" onClick={close}><span aria-hidden="true">{i.icon}</span>{i.title}</Link>
          ))}
          {canSettings && <Link to="/settings" className="sb-gear-item sb-gear-all" onClick={close}>{t('moduleGear.all')}</Link>}
        </div>,
        document.body,
      )}
    </span>
  );
}
