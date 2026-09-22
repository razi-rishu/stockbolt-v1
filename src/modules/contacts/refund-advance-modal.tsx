import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { getAdapter } from '@/data/index';
import { useAuthStore } from '@/store/auth';
import { Modal } from '@/ui/modal';
import { Button } from '@/ui/button';
import type { BankAccountRow, RefundResult } from '@/data/adapter';

/**
 * S4 — refund part or all of a contact's advance balance.
 *
 * Shared by the customer and supplier detail pages, because the two are exact
 * mirrors: one gives money back to a customer who prepaid us, the other takes
 * money back from a supplier we prepaid.
 *
 *   customer  Dr 2400 Customer Advances / Cr bank
 *   vendor    Dr bank / Cr 1400 Vendor Advances
 *
 * The amount shown here is a convenience. The real ceiling is enforced in the
 * database against the contact's ledger balance, so a stale figure on screen
 * cannot over-refund.
 */

function fmt(n: number) {
  return n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export function RefundAdvanceModal({
  open, onClose, onDone, side, source = 'advance', contactId, contactName, available, currency,
}: {
  open: boolean;
  onClose: () => void;
  /** Called after a successful refund so the page can refetch balances. */
  onDone: (result: RefundResult) => void;
  side: 'customer' | 'vendor';
  /** R5a — which pot the money comes out of. 'advance' is 2400 Customer
   *  Advances, money taken BEFORE a sale. 'credit' is a credit balance on
   *  1200 AR, money owed AFTER one — typically a return by a customer who
   *  had already paid. The vendor side is always 'advance'. */
  source?: 'advance' | 'credit';
  contactId: string;
  contactName: string;
  /** Advance balance as the page last read it — display + client-side sanity only. */
  available: number;
  currency: string;
}) {
  const { t } = useTranslation();
  const company_id = useAuthStore(s => s.company_id);

  const today = new Date().toISOString().slice(0, 10);
  const [date, setDate]       = useState(today);
  const [amount, setAmount]   = useState('');
  const [bankId, setBankId]   = useState('');
  const [reference, setRef]   = useState('');
  const [busy, setBusy]       = useState(false);
  const [error, setError]     = useState<string | null>(null);

  const { data: banks = [] } = useQuery<BankAccountRow[]>({
    queryKey: ['bank_accounts', company_id],
    queryFn: () => getAdapter().bankAccounts.list(company_id!),
    enabled: !!company_id && open,
  });

  const parsed = parseFloat(amount);
  const amountValid = Number.isFinite(parsed) && parsed > 0;
  const overAvailable = amountValid && parsed > available + 0.005;
  const canSubmit = amountValid && !overAvailable && !!bankId && !busy;

  const submit = async () => {
    if (!company_id || !canSubmit) return;
    setBusy(true); setError(null);
    try {
      const api = getAdapter().payments;
      const input = {
        company_id,
        contact_id:      contactId,
        date,
        amount:          parsed,
        currency,
        bank_account_id: bankId,
        reference:       reference || null,
        notes:           null,
      };
      const res = side === 'vendor'
        ? (source === 'credit' ? await api.refundVendorCredit(input)
                               : await api.refundVendorAdvance(input))
        : (source === 'credit' ? await api.refundCustomerCredit(input)
                               : await api.refundCustomerAdvance(input));
      onDone(res);
      onClose();
      setAmount(''); setRef('');
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const isCredit       = source === 'credit';
  const isVendorCredit = side === 'vendor'   && isCredit;
  const isCustCredit   = side === 'customer' && isCredit;
  const title = isVendorCredit ? t('refund.title_vendor_credit')
              : side === 'vendor' ? t('refund.title_vendor')
              : isCustCredit    ? t('refund.title_customer_credit')
              :                   t('refund.title_customer');

  return (
    <Modal open={open} onClose={onClose} title={title} width="md">
      <div className="flex flex-col gap-3 text-sm">
        <p className="text-ink-secondary">
          {isVendorCredit   ? t('refund.intro_vendor_credit',   { name: contactName })
           : side === 'vendor' ? t('refund.intro_vendor',        { name: contactName })
           : isCustCredit    ? t('refund.intro_customer_credit', { name: contactName })
           :                   t('refund.intro_customer',        { name: contactName })}
        </p>

        <div className="rounded-card bg-surface-subtle px-3 py-2">
          <span className="text-xs uppercase tracking-wide text-ink-tertiary">
            {isCredit ? t('refund.available_credit') : t('refund.available')}
          </span>
          <div className="font-mono text-base font-semibold text-ink-primary">
            {currency} {fmt(available)}
          </div>
        </div>

        <label className="flex flex-col gap-1">
          <span className="text-xs text-ink-secondary">{t('refund.amount')}</span>
          <input
            type="number" min="0" step="0.01" autoFocus
            value={amount} onChange={e => setAmount(e.target.value)}
            className="input-field h-9"
            placeholder="0.00"
          />
        </label>
        {overAvailable && (
          <p className="text-xs text-danger-600">
            {isCredit
              ? t('refund.over_available_credit', { available: `${currency} ${fmt(available)}` })
              : t('refund.over_available',        { available: `${currency} ${fmt(available)}` })}
          </p>
        )}

        <label className="flex flex-col gap-1">
          <span className="text-xs text-ink-secondary">{t('refund.date')}</span>
          <input type="date" value={date} onChange={e => setDate(e.target.value)} className="input-field h-9" />
        </label>

        <label className="flex flex-col gap-1">
          <span className="text-xs text-ink-secondary">
            {side === 'customer' ? t('refund.paid_from') : t('refund.received_into')}
          </span>
          <select value={bankId} onChange={e => setBankId(e.target.value)} className="input-field h-9">
            <option value="">{t('refund.choose_account')}</option>
            {banks.map(b => (
              <option key={b.id} value={b.id}>{b.name}</option>
            ))}
          </select>
        </label>

        <label className="flex flex-col gap-1">
          <span className="text-xs text-ink-secondary">{t('refund.reference')}</span>
          <input
            value={reference} onChange={e => setRef(e.target.value)}
            className="input-field h-9" placeholder={t('refund.reference_ph')}
          />
        </label>

        <p className="text-xs text-ink-tertiary">
          {isVendorCredit   ? t('refund.gl_hint_vendor_credit')
           : side === 'vendor' ? t('refund.gl_hint_vendor')
           : isCustCredit    ? t('refund.gl_hint_customer_credit')
           :                   t('refund.gl_hint_customer')}
        </p>

        {error && <p className="text-sm text-danger-600">{error}</p>}

        <div className="mt-1 flex justify-end gap-2">
          <Button variant="secondary" size="sm" onClick={onClose} disabled={busy}>
            {t('common.cancel')}
          </Button>
          <Button size="sm" onClick={submit} disabled={!canSubmit} loading={busy}>
            {t('refund.confirm')}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
