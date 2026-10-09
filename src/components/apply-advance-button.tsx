import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { getAdapter } from '@/data/index';
import { useAuthStore } from '@/store/auth';
import { Button } from '@/ui/button';
import type { PaymentRow } from '@/data/adapter';

/**
 * "This customer has money on account, use it against this invoice."
 *
 * Applying an advance already worked — but only from the CONTACT page, which
 * is not where you are when you are looking at an unpaid invoice wondering
 * why you cannot settle it. An invoice for 462.00 and a 462.00 advance sat in
 * the same company with no route between them.
 *
 * This finds the advance the way the contact page does (confirmed, and not
 * yet fully allocated) and opens it with the apply modal, which is the
 * existing mechanism — no second way to allocate, just a second door to the
 * same one.
 *
 * Renders nothing when there is no advance to apply, so the action bar only
 * grows a button when the button can actually do something.
 */

type AllocStatus = 'unallocated' | 'partial' | 'full' | null | undefined;

export function ApplyAdvanceButton({
  side, contactId, outstanding,
}: {
  side: 'customer' | 'vendor';
  contactId: string | null | undefined;
  /** What is still owed on THIS document. No point offering to apply an
   *  advance to something already settled. */
  outstanding: number;
}) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const company_id = useAuthStore(s => s.company_id);

  const { data: payments = [] } = useQuery<PaymentRow[]>({
    queryKey: ['payments', company_id, side],
    queryFn: () => side === 'customer'
      ? getAdapter().payments.list(company_id!)
      : getAdapter().vendorPayments.list(company_id!),
    enabled: !!company_id && !!contactId && outstanding > 0.005,
  });

  if (!contactId || outstanding <= 0.005) return null;

  // Same rule the contact page uses: a confirmed payment that has not been
  // fully spent yet. Newest first, because the most recent advance is the
  // one an operator is usually thinking of.
  const target = payments
    .filter(p => p.contact_id === contactId && p.status === 'confirmed')
    .filter(p => {
      const alloc = (p as PaymentRow & { allocation_status?: AllocStatus }).allocation_status;
      return alloc === 'unallocated' || alloc === 'partial';
    })
    .sort((a, b) => String(b.date).localeCompare(String(a.date)))[0];

  if (!target) return null;

  const base = side === 'customer' ? '/sales/payments' : '/purchasing/payments';

  return (
    <Button
      size="sm"
      variant="secondary"
      onClick={() => navigate(`${base}/${target.id}?apply=1`)}
      title={t('payments.apply_advance_hint', { number: target.payment_number })}
    >
      {t('payments.apply_advance')}
    </Button>
  );
}
