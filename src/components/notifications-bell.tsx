/**
 * NotificationsBell — drop-in bell + popover for the top nav.
 *
 * Uses useNotifications() to derive notifications client-side (overdue
 * invoices, low stock, today's payments) and persists read-state in
 * localStorage per company.
 */
import { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useNotifications, type Notification, type NotificationSeverity } from '@/lib/notifications';

function BellIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-5 w-5">
      <path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9" />
      <path d="M10.3 21a1.94 1.94 0 0 0 3.4 0" />
    </svg>
  );
}

function SeverityDot({ severity }: { severity: NotificationSeverity }) {
  const cls = severity === 'danger'  ? 'bg-red-500'
            : severity === 'warning' ? 'bg-amber-500'
            : 'bg-blue-500';
  return <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${cls}`} />;
}

function NotificationRow({
  n,
  onClick,
}: {
  n: Notification & { isRead: boolean };
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex w-full items-start gap-3 border-b border-border-subtle px-4 py-3 text-start last:border-0 hover:bg-surface-muted ${
        n.isRead ? 'opacity-60' : ''
      }`}
    >
      <SeverityDot severity={n.severity} />
      <div className="min-w-0 flex-1">
        <p className={`truncate text-sm ${n.isRead ? 'font-normal text-ink-secondary' : 'font-medium text-ink-primary'}`}>
          {n.title}
        </p>
        <p className="mt-0.5 truncate text-xs text-ink-tertiary">{n.detail}</p>
      </div>
    </button>
  );
}

export function NotificationsBell() {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const navigate = useNavigate();
  const { notifications, unreadCount, markRead, markAllRead } = useNotifications();

  // Outside click + Escape to close
  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onClick);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onClick);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  function handleRowClick(n: Notification) {
    markRead(n.id);
    setOpen(false);
    navigate(n.href);
  }

  // Trim display to top 20 to keep the panel manageable
  const display = notifications.slice(0, 20);

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        title="Notifications"
        aria-label={`Notifications${unreadCount > 0 ? ` (${unreadCount} unread)` : ''}`}
        className="relative flex h-9 w-9 items-center justify-center rounded-full text-white/70 hover:bg-white/10 hover:text-white"
      >
        <BellIcon />
        {unreadCount > 0 && (
          <span className="absolute end-1 top-1 flex h-4 min-w-[16px] items-center justify-center rounded-full bg-red-500 px-1 text-[10px] font-semibold text-white">
            {unreadCount > 9 ? '9+' : unreadCount}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute end-0 z-50 mt-2 w-96 overflow-hidden rounded-card border border-border-subtle bg-surface-card shadow-xl">
          <div className="flex items-center justify-between border-b border-border-subtle bg-surface-muted px-4 py-2.5">
            <p className="text-sm font-semibold text-ink-primary">Notifications</p>
            {unreadCount > 0 && (
              <button
                type="button"
                onClick={markAllRead}
                className="text-xs font-medium text-brand-600 hover:text-brand-700"
              >
                Mark all read
              </button>
            )}
          </div>

          <div className="max-h-96 overflow-y-auto">
            {display.length === 0 ? (
              <div className="px-4 py-10 text-center text-sm text-ink-tertiary">
                You&apos;re all caught up.
              </div>
            ) : (
              display.map((n) => (
                <NotificationRow key={n.id} n={n} onClick={() => handleRowClick(n)} />
              ))
            )}
          </div>

          {notifications.length > display.length && (
            <p className="border-t border-border-subtle bg-surface-muted px-4 py-2 text-center text-[11px] text-ink-tertiary">
              Showing {display.length} of {notifications.length}. Open a list view for the full set.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
