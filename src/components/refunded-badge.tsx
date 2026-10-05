import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { getAdapter } from '@/data/index';
import type { DocumentRefund, RefundSourceDocType } from '@/data/adapter';

/**
 * Z5 — "where is the sign if users check later how they know is it refund or
 * not."
 *
 * There was no sign, because there was no data: a refund payment carried
 * contact_id and nothing else, so it knew WHO was paid and never WHAT it
 * settled. phase90 records the source document at the moment the refund is
 * raised, and this is what reads it back.
 *
 * Shows nothing at all when there is no refund — including for every refund
 * posted before phase90, which has no source document and never will. A blank
 * is the honest answer there; guessing from the contact and the date would
 * put a confident label on something we cannot actually prove.
 *
 * A VOIDED refund is shown struck through rather than hidden. "Refunded" and
 * "refunded, then the refund was cancelled" are different facts, and the
 * second one is exactly what someone checking later needs to see.
 */

const fmt = (n: number) =>
  n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export function RefundedBadge({
  docType, docId, currency,
}: {
  docType: RefundSourceDocType;
  docId: string | null | undefined;
  currency: string;
}) {
  const { t } = useTranslation();

  const { data: refunds = [] } = useQuery<DocumentRefund[]>({
    queryKey: ['document_refunds', docType, docId],
    queryFn: () => getAdapter().payments.listForDocument(docType, docId!),
    enabled: !!docId,
  });

  if (refunds.length === 0) return null;

  const live = refunds.filter(r => r.status !== 'void');
  const total = live.reduce((s, r) => s + Number(r.amount ?? 0), 0);

  return (
    <div
      data-print-hide
      className="rounded-card border border-emerald-200 bg-emerald-50 px-4 py-2.5 text-sm text-emerald-900"
    >
      {live.length > 0 ? (
        <span className="font-semibold">
          {t('refund.refunded_badge', { amount: `${currency} ${fmt(total)}` })}
        </span>
      ) : (
        // Every refund against this document was voided, so the money is back
        // where it started. Saying "refunded" here would be a lie.
        <span className="font-semibold">{t('refund.refund_voided_badge')}</span>
      )}
      <span className="ms-2 text-emerald-700/80">
        {refunds.map(r => (
          <span key={r.id} className="me-2 font-mono text-xs">
            <span className={r.status === 'void' ? 'line-through opacity-60' : ''}>
              {r.payment_number} · {r.currency} {fmt(Number(r.amount ?? 0))} · {r.date}
            </span>
          </span>
        ))}
      </span>
    </div>
  );
}

/**
 * Z5b — the same fact as a pill, for a document header or a list row.
 *
 * The green bar above carries the amount and the payment number, which is
 * what you want once you are reading the document. This is what you want
 * BEFORE that: a status you can see without reading anything, sitting next
 * to the Confirmed badge it qualifies. Confirmed and Refunded are two
 * different facts about a credit note and neither implies the other.
 *
 * A document whose only refund was VOIDED shows nothing: the money came
 * back out, so the note is not refunded any more.
 */
export function RefundedPill({
  docType, docId,
}: {
  docType: RefundSourceDocType;
  docId: string | null | undefined;
}) {
  const { t } = useTranslation();
  const { data: refunds = [] } = useQuery<DocumentRefund[]>({
    queryKey: ['document_refunds', docType, docId],
    queryFn: () => getAdapter().payments.listForDocument(docType, docId!),
    enabled: !!docId,
  });

  if (!refunds.some(r => r.status !== 'void')) return null;

  return (
    <span
      title={t('refund.refunded_pill_hint')}
      style={{
        display: 'inline-block', padding: '3px 9px', borderRadius: '999px',
        fontSize: '11px', fontWeight: 700, letterSpacing: '.02em',
        background: '#d1fae5', color: '#065f46', border: '1px solid #a7f3d0',
      }}
    >
      {t('refund.refunded_pill')}
    </span>
  );
}
