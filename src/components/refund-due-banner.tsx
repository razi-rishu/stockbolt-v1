import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { getAdapter } from '@/data/index';
import { useAuthStore } from '@/store/auth';
import { Button } from '@/ui/button';
import { RefundAdvanceModal } from '@/modules/contacts/refund-advance-modal';
import type { ContactRow, Company } from '@/data/adapter';

/**
 * "We owe this party money" — shown wherever that becomes true, with the way
 * to give it back attached.
 *
 * A confirmed sales return posts a credit note, which leaves a CREDIT balance
 * on 1200 AR. If the customer had already paid, that is their money sitting on
 * our books. The engine to refund it (R5a / P4) has existed since phase 78,
 * but the only route to it was the contact's detail page — so from the return
 * itself, the document that creates the debt and the screen you are on when
 * the customer asks for their money, there was no way to give it back. Same on
 * the purchase side, where a debit note leaves a DEBIT on 2100 AP.
 *
 * The balance is read from the LEDGER, never from the document in front of
 * you. A 131.25 return by a customer who still owes 500 is not a refund — it
 * is a credit to set against the open invoice, and the engine refuses it for
 * exactly that reason. So this renders nothing unless the party's NET position
 * is genuinely in their favour, and it takes itself away once the refund is
 * posted or the document is voided.
 *
 * REGIONS: no country branching. 1200 and 2100 are the control accounts in
 * every seeded chart, GCC and India alike.
 */

const fmt = (n: number) =>
  n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export function RefundDueBanner({
  side, contactId, contactName, currency,
}: {
  side: 'customer' | 'vendor';
  /** Null while the parent is still loading its document — renders nothing. */
  contactId: string | null | undefined;
  /** Both optional: a document page rarely holds the contact row, and every
   *  prop it has to thread through is a chance for the banner to disagree
   *  with the contact page. Looked up here when not given. */
  contactName?: string;
  currency?: string;
}) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const company_id = useAuthStore(s => s.company_id);
  const [open, setOpen] = useState(false);

  // 1200 AR for a customer, 2100 AP for a supplier — the CONTROL accounts, so
  // the figure already nets off anything still unpaid.
  const account = side === 'customer' ? '1200' as const : '2100' as const;

  const { data: balance = 0 } = useQuery<number>({
    queryKey: ['advance_balance', company_id, contactId, account],
    queryFn: () => getAdapter().contacts.getAdvanceBalance(company_id!, contactId!, account),
    enabled: !!company_id && !!contactId,
  });

  const needsContact = !contactName || !currency;
  const { data: contact } = useQuery<ContactRow | null>({
    queryKey: ['contact', contactId],
    queryFn: () => getAdapter().contacts.getById(contactId!),
    enabled: !!contactId && needsContact && balance > 0.005,
  });
  const { data: companyRow } = useQuery<Company | null>({
    queryKey: ['company', company_id],
    queryFn: () => getAdapter().companies.getById(company_id!),
    enabled: !!company_id && !currency && balance > 0.005,
  });

  if (balance <= 0.005) return null;

  const isCustomer  = side === 'customer';
  const resolvedCur = currency ?? contact?.currency ?? companyRow?.base_currency ?? '';
  const amount      = `${resolvedCur} ${fmt(balance)}`.trim();

  return (
    <div className="rounded-card border border-emerald-200 bg-emerald-50 px-5 py-3 flex flex-wrap items-center gap-4">
      <span className="rounded-pill bg-emerald-100 px-2 py-0.5 text-xs font-semibold text-emerald-800">
        {t(isCustomer ? 'refund.ar_credit_badge' : 'refund.ap_debit_badge')}
      </span>
      <p className="flex-1 min-w-[260px] text-sm text-emerald-900">
        {t(isCustomer ? 'refund.ar_credit_desc' : 'refund.ap_debit_desc', { amount })}{' '}
        <span className="text-emerald-700/80">
          {t(isCustomer ? 'refund.ar_credit_gl' : 'refund.ap_debit_gl')}
        </span>
      </p>
      <Button
        size="sm"
        variant="secondary"
        onClick={() => setOpen(true)}
        title={t(isCustomer ? 'refund.title_customer_credit' : 'refund.title_vendor_credit')}
      >
        {t('refund.refund_cta')}
      </Button>
      <RefundAdvanceModal
        open={open}
        onClose={() => setOpen(false)}
        onDone={() => {
          // The banner is driven by the ledger, so refetching the balance is
          // what recalculates it or takes it away.
          void qc.invalidateQueries({ queryKey: ['advance_balance'] });
          void qc.invalidateQueries({ queryKey: ['payments'] });
        }}
        side={side}
        source="credit"
        contactId={contactId!}
        contactName={contactName ?? contact?.name ?? ''}
        available={balance}
        currency={resolvedCur}
      />
    </div>
  );
}
