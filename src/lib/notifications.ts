/**
 * useNotifications — derives a unified Notification[] from existing app data
 * (overdue invoices, low-stock items, today's payments). No DB schema
 * needed; we just query the data the user already has and compose alerts.
 *
 * Read-state persists in localStorage per company (key includes company_id),
 * keyed by deterministic notification IDs so a re-fetch doesn't resurface
 * something the user already dismissed.
 *
 * Refetch cadence: 60s while the tab is focused. React Query handles the
 * timer and cache.
 */
import { useEffect, useState, useMemo, useCallback } from 'react';
import { useQuery } from '@tanstack/react-query';
import { getAdapter } from '@/data';
import { useAuthStore } from '@/store/auth';

export type NotificationSeverity = 'info' | 'warning' | 'danger';
export type NotificationKind = 'overdue_invoice' | 'low_stock' | 'payment_received';

export interface Notification {
  /** Stable per (kind + entity) — e.g. "overdue-invoice-<uuid>". Used for read-state. */
  id: string;
  kind: NotificationKind;
  severity: NotificationSeverity;
  title: string;
  detail: string;
  /** App route to navigate to when clicked */
  href: string;
  /** Timestamp for sort ordering — ISO date (epoch fallback for client-only events) */
  createdAt: string;
}

const REFETCH_MS = 60_000; // 1 minute

function readStorageKey(company_id: string) {
  return `stockbolt-read-notif-${company_id}`;
}

function loadReadIds(company_id: string): Set<string> {
  try {
    const raw = localStorage.getItem(readStorageKey(company_id));
    if (!raw) return new Set();
    const arr = JSON.parse(raw) as string[];
    return new Set(arr);
  } catch {
    return new Set();
  }
}

function saveReadIds(company_id: string, ids: Set<string>) {
  try {
    localStorage.setItem(readStorageKey(company_id), JSON.stringify(Array.from(ids)));
  } catch {
    // ignore quota / private-mode errors
  }
}

function fmtAmount(n: number): string {
  return n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/**
 * Pulls all the underlying data once per refetch interval and composes a
 * sorted Notification[]. The hook also exposes read/unread bookkeeping that
 * mutates localStorage and the in-memory Set.
 */
export function useNotifications() {
  const company_id = useAuthStore((s) => s.company_id);

  // In-memory mirror of the localStorage read-set. Tracked in state so the
  // dropdown re-renders when a notification is marked read.
  const [readIds, setReadIds] = useState<Set<string>>(new Set());
  useEffect(() => {
    if (company_id) setReadIds(loadReadIds(company_id));
  }, [company_id]);

  const { data: raw = [], isLoading } = useQuery({
    queryKey: ['notifications', company_id],
    enabled: !!company_id,
    refetchInterval: REFETCH_MS,
    refetchOnWindowFocus: true,
    staleTime: 30_000,
    queryFn: async (): Promise<Notification[]> => {
      const out: Notification[] = [];
      const today = new Date().toISOString().slice(0, 10);
      const adapter = getAdapter();

      // ── 1. Overdue invoices (past due_date, outstanding > 0) ────────────
      try {
        const confirmedInvoices = await adapter.invoices.list(company_id!, 'confirmed');
        const overdue = confirmedInvoices.filter(
          (inv) => inv.due_date && (inv.due_date as unknown as string) < today,
        );
        if (overdue.length > 0) {
          // Determine outstanding for each by querying allocations in one shot
          const ids = overdue.map((inv) => inv.id);
          // Use the existing "open invoices" helper concept: fetch allocations
          // for these invoices. We don't have a direct method, so we go through
          // the contacts (one per customer) — but that's N queries. Simpler:
          // accept the listOpenForContact approach is per-contact. For the
          // bell we'll just trust total_amount as an upper bound and surface
          // every overdue invoice; this may overcount fully-paid-but-overdue
          // invoices slightly. For accuracy, we use the same listOpenForContact
          // per unique contact_id and intersect.
          const byContact: Record<string, typeof overdue> = {};
          for (const inv of overdue) {
            if (!byContact[inv.contact_id]) byContact[inv.contact_id] = [];
            byContact[inv.contact_id].push(inv);
          }
          const truly: typeof overdue = [];
          await Promise.all(
            Object.keys(byContact).map(async (contactId) => {
              const open = await adapter.invoices.listOpenForContact(company_id!, contactId);
              const openIdSet = new Set(open.filter((o) => o.outstanding > 0.01).map((o) => o.id));
              for (const inv of byContact[contactId]) {
                if (openIdSet.has(inv.id)) truly.push(inv);
              }
            }),
          );
          for (const inv of truly) {
            const dueStr = (inv.due_date as unknown as string) ?? '';
            out.push({
              id: `overdue-invoice-${inv.id}`,
              kind: 'overdue_invoice',
              severity: 'danger',
              title: `Invoice ${inv.invoice_number} is overdue`,
              detail: `${inv.currency} ${fmtAmount(Number(inv.total_amount))} · due ${dueStr}`,
              href: `/sales/invoices/${inv.id}`,
              createdAt: dueStr || today,
            });
          }
          // Keep the array bounded so a noisy AR doesn't blow up the dropdown
          if (out.length > 50) out.length = 50;
          // Note: ids variable retained for future per-id allocation queries
          void ids;
        }
      } catch {
        // ignore — surface no overdue notifications if the underlying query fails
      }

      // ── 2. Low stock items (running_qty <= min_stock_level, min > 0) ───
      try {
        const reorder = await adapter.reports.getReorderReport(company_id!);
        for (const r of reorder.slice(0, 20)) {
          out.push({
            id: `low-stock-${r.product_id}-${r.warehouse_id}`,
            kind: 'low_stock',
            severity: 'warning',
            title: `${r.product_name} is low on stock`,
            detail: `${r.qty_on_hand} on hand · min ${r.min_stock_level} (${r.warehouse_name})`,
            href: `/products/${r.product_id}`,
            createdAt: today,
          });
        }
      } catch {
        // ignore
      }

      // ── 3. Payments received today (inbound, confirmed, dated today) ───
      try {
        const payments = await adapter.payments.list(company_id!, 'inbound');
        const todaysConfirmed = payments.filter(
          (p) => p.status === 'confirmed' && (p.date as unknown as string) === today,
        );
        for (const p of todaysConfirmed.slice(0, 20)) {
          out.push({
            id: `payment-received-${p.id}`,
            kind: 'payment_received',
            severity: 'info',
            title: `Payment ${p.payment_number} received`,
            detail: `${p.currency} ${fmtAmount(Number(p.amount))}`,
            href: `/sales/payments/${p.id}`,
            createdAt: p.created_at ?? today,
          });
        }
      } catch {
        // ignore
      }

      // Sort by createdAt descending (newest first), with danger > warning > info
      // as a stable secondary tie-break.
      const severityRank: Record<NotificationSeverity, number> = { danger: 0, warning: 1, info: 2 };
      out.sort((a, b) => {
        if (a.createdAt !== b.createdAt) return a.createdAt < b.createdAt ? 1 : -1;
        return severityRank[a.severity] - severityRank[b.severity];
      });
      return out;
    },
  });

  // Mark a single id as read
  const markRead = useCallback((id: string) => {
    if (!company_id) return;
    setReadIds((prev) => {
      if (prev.has(id)) return prev;
      const next = new Set(prev);
      next.add(id);
      saveReadIds(company_id, next);
      return next;
    });
  }, [company_id]);

  // Mark all currently-displayed as read
  const markAllRead = useCallback(() => {
    if (!company_id) return;
    setReadIds((prev) => {
      const next = new Set(prev);
      for (const n of raw) next.add(n.id);
      saveReadIds(company_id, next);
      return next;
    });
  }, [company_id, raw]);

  // Clear the read-set entirely (useful for testing)
  const clearRead = useCallback(() => {
    if (!company_id) return;
    setReadIds(new Set());
    saveReadIds(company_id, new Set());
  }, [company_id]);

  // Augment notifications with isRead, then expose unread count
  const notifications = useMemo(() =>
    raw.map((n) => ({ ...n, isRead: readIds.has(n.id) })),
  [raw, readIds]);

  const unreadCount = useMemo(() =>
    notifications.reduce((s, n) => s + (n.isRead ? 0 : 1), 0),
  [notifications]);

  return {
    notifications,
    unreadCount,
    isLoading,
    markRead,
    markAllRead,
    clearRead,
  };
}
