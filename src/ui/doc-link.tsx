/**
 * <DocLink> — clickable reference to a source document (Document 7 — D1).
 *
 * Resolves the route via the doc-link registry. Renders plain text (no link)
 * when there's no id, the type is unknown, or the current role lacks the
 * read-permission for that document — so users never see a link they can't open
 * (req 13). `status` adds a small "reversed" / "deleted" badge while keeping the
 * link, preserving the audit trail (req 12).
 */
import { Link } from 'react-router-dom';
import { useAuthStore } from '@/store/auth';
import { hasPerm } from '@/lib/permissions';
import { normalizeDocType, DOC_REGISTRY } from '@/lib/doc-links';

export interface DocLinkProps {
  type: string | null | undefined;
  id: string | null | undefined;
  /** Visible text; falls back to the registry label (e.g. "Invoice"). */
  label?: string | null;
  status?: 'active' | 'reversed' | 'deleted';
  className?: string;
}

export function DocLink({ type, id, label, status = 'active', className }: DocLinkProps) {
  const role = useAuthStore((s) => s.role);
  const perms = useAuthStore((s) => s.permissions);

  const canon = normalizeDocType(type);
  const meta = canon ? DOC_REGISTRY[canon] : null;
  const text = label ?? meta?.label ?? '—';

  const badge = status !== 'active' ? (
    <span className="ms-1 rounded bg-surface-muted px-1 py-0.5 text-[10px] font-semibold text-ink-tertiary align-middle">
      {status}
    </span>
  ) : null;

  const allowed = meta ? hasPerm(role, perms, meta.perm) : false;

  // No id / unknown type / not permitted → plain text, never a dead link.
  if (!id || !meta || !allowed) {
    return <span className={className}>{text}{badge}</span>;
  }

  return (
    <Link to={meta.route(id)} className={className ?? 'font-medium text-brand-600 hover:text-brand-700 hover:underline'}>
      {text}{badge}
    </Link>
  );
}
