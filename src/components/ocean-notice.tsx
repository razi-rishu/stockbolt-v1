/**
 * Ocean Teal notice card: a centred card with an icon, a title, a sentence and
 * actions. Used where a page cannot be shown (module turned off, branch access,
 * page not found).
 */
import type { ReactNode } from 'react';
import '@/styles/stockbolt-ocean-teal.css';

export function OceanNotice({ icon, tone = 'brand', title, children, actions, testid, fullPage }: {
  icon: ReactNode;
  tone?: 'brand' | 'warn';
  title: string;
  children?: ReactNode;
  actions?: ReactNode;
  testid?: string;
  /** Outside the app frame (no sidebar): fill the window and centre. */
  fullPage?: boolean;
}) {
  return (
    <div className={`sb-ocean sb-notice-wrap ${fullPage ? 'is-full' : ''}`} data-testid={testid}>
      <div className="sb-card sb-notice">
        <span className={`sb-notice-ico is-${tone}`} aria-hidden="true">{icon}</span>
        <h1 className="sb-notice-title">{title}</h1>
        {children && <div className="sb-notice-body">{children}</div>}
        {actions && <div className="sb-notice-actions">{actions}</div>}
      </div>
    </div>
  );
}
