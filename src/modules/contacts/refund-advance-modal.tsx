import { useState } from 'react';
import { ccy as ccyLabel } from '@/lib/currency-display';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { getAdapter } from '@/data/index';
import { useAuthStore } from '@/store/auth';
import { Modal } from '@/ui/modal';
import { Button } from '@/ui/button';
import { Input } from '@/ui/input';
import { Select } from '@/ui/select';
import { ReportFigures, Num } from '@/components/ocean-report';
import type { BankAccountRow, RefundResult, RefundSourceDocType } from '@/data/adapter';
import { useApprovalGate } from '@/components/approvals/use-approval';

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
  sourceDoc,
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
  /** Z5 — the document this refund is being raised from, recorded on the
   *  payment so the document can later show it was refunded. Absent on a
   *  contact page, where no single document is the source. */
  sourceDoc?: { type: RefundSourceDocType; id: string };
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
  // phase145 — a supplier refund that needs approval is sent, not posted.
  const gate = useApprovalGate(source === 'credit' ? 'vendor_credit_refund' : 'vendor_refund');

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
        source_doc_type: sourceDoc?.type ?? null,
        source_doc_id:   sourceDoc?.id ?? null,
        draft_only:      side === 'vendor' && gate.needs(parsed),
      };
      const res = side === 'vendor'
        ? (source === 'credit' ? await api.refundVendorCredit(input)
                               : await api.refundVendorAdvance(input))
        : (source === 'credit' ? await api.refundCustomerCredit(input)
                               : await api.refundCustomerAdvance(input));
      if (input.draft_only) {
        // Nothing posted yet: choose the approver; closing without sending drops the draft.
        gate.open({
          docId: res.payment_id,
          onSent: () => { onClose(); setAmount(''); setRef(''); },
          onClosed: () => { void getAdapter().payments.discardRefundDraft(res.payment_id).catch((e: unknown) => setError(e instanceof Error ? e.message : String(e))); },
        });
        return;
      }
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
      {/* Ocean Teal (UI v1.1): look only — same refund engines and ceiling. */}
      <div className="sb-ocean sb-modal-form flex flex-col gap-4">
        <p className="sb-info-note" style={{ fontSize: 13, margin: 0 }}>
          {isVendorCredit   ? t('refund.intro_vendor_credit',   { name: contactName })
           : side === 'vendor' ? t('refund.intro_vendor',        { name: contactName })
           : isCustCredit    ? t('refund.intro_customer_credit', { name: contactName })
           :                   t('refund.intro_customer',        { name: contactName })}
        </p>

        <div className="sb-card sb-rpt-card sb-refund-avail" style={{ boxShadow: 'none' }}>
          <ReportFigures figures={[{
            label: isCredit ? t('refund.available_credit') : t('refund.available'),
            value: <Num>{ccyLabel(currency)} {fmt(available)}</Num>,
            tone: 'brand',
          }]} />
        </div>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Input
            label={t('refund.amount')} type="number" min="0" step="0.01" dir="ltr" autoFocus
            value={amount} onChange={e => setAmount(e.target.value)} placeholder="0.00"
            error={overAvailable
              ? (isCredit
                  ? t('refund.over_available_credit', { available: `${ccyLabel(currency)} ${fmt(available)}` })
                  : t('refund.over_available',        { available: `${ccyLabel(currency)} ${fmt(available)}` }))
              : undefined}
          />
          <Input label={t('refund.date')} type="date" value={date} onChange={e => setDate(e.target.value)} />
        </div>

        <Select
          label={side === 'customer' ? t('refund.paid_from') : t('refund.received_into')}
          value={bankId} onChange={e => setBankId(e.target.value)}
          options={[{ value: '', label: t('refund.choose_account') }, ...banks.map(b => ({ value: b.id, label: b.name }))]}
        />

        <Input
          label={t('refund.reference')} value={reference} onChange={e => setRef(e.target.value)}
          placeholder={t('refund.reference_ph')}
        />

        <p className="sb-form-hint" style={{ margin: 0 }}>
          {isVendorCredit   ? t('refund.gl_hint_vendor_credit')
           : side === 'vendor' ? t('refund.gl_hint_vendor')
           : isCustCredit    ? t('refund.gl_hint_customer_credit')
           :                   t('refund.gl_hint_customer')}
        </p>

        {error && <p className="sb-alert sb-alert-danger" role="alert">{error}</p>}

        <div className="flex justify-end gap-2 pt-1">
          <Button variant="secondary" onClick={onClose} disabled={busy}>
            {t('common.cancel')}
          </Button>
          <Button onClick={submit} disabled={!canSubmit} loading={busy}>
            {side === 'vendor' && gate.needs(parsed) ? t('apprOcean.submit') : t('refund.confirm')}
          </Button>
        </div>
      </div>
      {gate.modal}
    </Modal>
  );
}
