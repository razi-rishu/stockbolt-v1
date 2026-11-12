/**
 * Billing & Subscription — SaaS M2 portal, made LIVE in M3 (PayPal).
 *
 * Reads the tenant's subscription via get_my_subscription(). Subscribe buttons
 * call our Vercel function (/api/paypal/create-subscription) with the caller's
 * Supabase access token and redirect to PayPal approval; activation only
 * happens when PayPal's webhook confirms (server-controlled state). Cancel
 * goes through /api/paypal/cancel-subscription the same way.
 *
 * Safe before the M1/M3 migrations: subscription null → friendly empty state;
 * payment history empty; subscribing shows the server's "not configured" error.
 */
import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { getAdapter } from '@/data/index';
import { getSupabaseClient } from '@/data/supabase-client';
import { useAuthStore } from '@/store/auth';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { Input } from '@/ui/input';
import { OceanPage } from '@/components/ocean-list';
import { CreditCard, Receipt, MapPin, CheckCircle2, Gift, X, Loader2 } from 'lucide-react';
import type { BillingAddressRow } from '@/data/adapter';

// English labels stay as the fallback; translated in the page by key.
const STATUS_STYLE: Record<string, { label: string; tone: string }> = {
  trialing:        { label: 'Trial',          tone: '' },
  active:          { label: 'Active',         tone: 'sb-pill-good' },
  past_due:        { label: 'Past due',       tone: 'sb-pill-warn' },
  payment_failed:  { label: 'Payment failed', tone: 'sb-pill-warn' },
  pending_payment: { label: 'Pending',        tone: 'sb-pill-warn' },
  suspended:       { label: 'Suspended',      tone: 'sb-pill-bad' },
  cancelled:       { label: 'Cancelled',      tone: 'sb-pill-bad' },
  expired:         { label: 'Expired',        tone: 'sb-pill-bad' },
};

const CYCLE_LABEL: Record<string, string> = {
  monthly: 'Monthly', half_yearly: '6 months', yearly: 'Yearly',
};

function StatusBadge({ status, t }: { status: string; t: TFunction }) {
  const s = STATUS_STYLE[status] ?? { label: status, tone: 'sb-pill-muted' };
  return <span className={`sb-pill ${s.tone}`} style={{ marginTop: 0 }}>{t(`settingsPages.billing.status.${status}`, { defaultValue: s.label })}</span>;
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="sb-bill-row">
      <span className="sb-info-label">{label}</span>
      <span className="sb-bill-val">{value}</span>
    </div>
  );
}

const ADDR_FIELDS: { key: keyof BillingAddressRow; label: string }[] = [
  { key: 'company_name', label: 'Company name' },
  { key: 'tax_number',   label: 'Tax number (TRN / GSTIN)' },
  { key: 'address',      label: 'Address' },
  { key: 'city',         label: 'City' },
  { key: 'state',        label: 'State / Emirate' },
  { key: 'postal_code',  label: 'Postal code' },
  { key: 'country',      label: 'Country' },
  { key: 'phone',        label: 'Phone' },
  { key: 'email',        label: 'Email' },
];

/** Call a Vercel billing function with the caller's Supabase access token. */
async function callBillingApi(path: string, body: Record<string, unknown>): Promise<{ approvalUrl?: string; error?: string }> {
  const { data } = await getSupabaseClient().auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new Error('Not signed in');
  const res = await fetch(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json?.error ?? `Request failed (${res.status})`);
  return json;
}

export default function BillingPage() {
  const { t } = useTranslation();
  const { company_id } = useAuthStore();
  const qc = useQueryClient();
  const [searchParams, setSearchParams] = useSearchParams();
  const [addr, setAddr] = useState<Partial<BillingAddressRow>>({});
  const [saved, setSaved] = useState(false);
  const [payError, setPayError] = useState<string | null>(null);

  const paypalReturn = searchParams.get('paypal');   // 'approved' | 'cancelled' | null

  const { data: sub, isLoading } = useQuery({
    queryKey: ['my_subscription', company_id],
    queryFn: () => getAdapter().billing.getSubscription(),
    enabled: !!company_id,
    // While waiting for the PayPal webhook to confirm, poll until active.
    refetchInterval: (q) => (paypalReturn === 'approved' && q.state.data?.status !== 'active' ? 4000 : false),
  });

  const { data: address } = useQuery({
    queryKey: ['billing_address', company_id],
    queryFn: () => getAdapter().billing.getAddress(company_id!),
    enabled: !!company_id,
  });

  const { data: payments = [] } = useQuery({
    queryKey: ['subscription_payments', company_id],
    queryFn: () => getAdapter().billing.listPayments(company_id!),
    enabled: !!company_id,
  });

  useEffect(() => { if (address) setAddr(address); }, [address]);

  const saveAddr = useMutation({
    mutationFn: () => getAdapter().billing.upsertAddress(company_id!, addr),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['billing_address', company_id] });
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
    },
  });

  const subscribe = useMutation({
    mutationFn: async (cycle: 'monthly' | 'half_yearly' | 'yearly') => {
      setPayError(null);
      const { approvalUrl } = await callBillingApi('/api/paypal/create-subscription', { cycle });
      if (!approvalUrl) throw new Error(t('settingsPages.billing.no_approval'));
      window.location.href = approvalUrl;   // → PayPal
    },
    onError: (e) => setPayError(e instanceof Error ? e.message : String(e)),
  });

  const cancelSub = useMutation({
    mutationFn: async () => {
      setPayError(null);
      await callBillingApi('/api/paypal/cancel-subscription', {});
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['my_subscription', company_id] }),
    onError: (e) => setPayError(e instanceof Error ? e.message : String(e)),
  });

  const fmtDate = (d?: string | null) => (d ? new Date(d).toLocaleDateString() : '—');
  const money = (n?: number | null, ccy?: string | null) =>
    n == null ? '—' : `${ccy ?? 'USD'} ${Number(n).toFixed(2)}`;

  const canSubscribe = !!sub && !['active'].includes(sub.status) ||
    (!!sub && sub.status === 'active' && sub.provider !== 'paypal' && !sub.grandfathered);
  const showTrialFreeYear = !!sub && sub.status === 'trialing' && (sub.trial_days_left ?? 0) > 90;

  const B = 'settingsPages.billing.';
  const cycleLabel = (c: string) => t(`${B}cycle.${c}`, { defaultValue: CYCLE_LABEL[c] ?? c });
  const providerLabel = (p: string) => (p === 'paypal' ? 'PayPal' : p === 'manual' ? t(`${B}manual`) : p);

  // Ocean Teal (UI v1.1): look only — same subscription, PayPal checkout and
  // cancel, return banners, billing address and payment history.
  return (
    <OceanPage narrow testid="billing-ocean" title={t('settingsNav.items.billing.title')} subtitle={t(`${B}subtitle`)}>
      {paypalReturn === 'approved' && sub?.status !== 'active' && (
        <p className="sb-info-note sb-btn-inline" role="status"><Loader2 size={18} className="sb-spin" aria-hidden="true" />{t(`${B}approved_wait`)}</p>
      )}
      {paypalReturn === 'approved' && sub?.status === 'active' && (
        <div className="sb-alert sb-alert-good sb-bill-banner" role="status">
          <span className="sb-btn-inline"><CheckCircle2 size={18} aria-hidden="true" />{t(`${B}active_thanks`)}</span>
          <button type="button" className="sb-icon-btn" onClick={() => setSearchParams({}, { replace: true })} aria-label={t('common.close')}><X size={16} aria-hidden="true" /></button>
        </div>
      )}
      {paypalReturn === 'cancelled' && (
        <div className="sb-alert sb-alert-warn sb-bill-banner" role="status">
          <span>{t(`${B}checkout_cancelled`)}</span>
          <button type="button" className="sb-icon-btn" onClick={() => setSearchParams({}, { replace: true })} aria-label={t('common.close')}><X size={16} aria-hidden="true" /></button>
        </div>
      )}
      {payError && <p className="sb-alert sb-alert-danger" role="alert">{payError}</p>}

      {isLoading && <div className="sb-card sb-empty">{t('common.loading')}</div>}

      {!isLoading && !sub && (
        <section className="sb-card">
          <p className="sb-form-title" style={{ lineHeight: 1.4, fontSize: 15 }}>{t(`${B}not_setup`)}</p>
          <p className="sb-form-hint" style={{ marginTop: 6 }}>{t(`${B}not_setup_hint`)}</p>
        </section>
      )}

      {sub && (
        <>
          {/* Current subscription */}
          <section className="sb-card">
            <div className="sb-users-head" style={{ marginBottom: 12 }}>
              <span className="sb-form-icon" aria-hidden="true"><CreditCard size={20} /></span>
              <h2 className="sb-form-title" style={{ flex: 1, lineHeight: 1.3 }}>{sub.plan?.name ?? t(`${B}subscription`)}</h2>
              <StatusBadge status={sub.status} t={t} />
            </div>
            {sub.grandfathered && sub.status === 'active' && (
              <p className="sb-alert sb-alert-good sb-btn-inline" style={{ fontWeight: 600 }}><CheckCircle2 size={18} aria-hidden="true" />{t(`${B}complimentary`)}</p>
            )}
            {showTrialFreeYear && (
              <p className="sb-alert sb-alert-good sb-btn-inline" style={{ fontWeight: 600 }}>
                <Gift size={18} aria-hidden="true" />{t(`${B}free_year`, { days: sub.trial_days_left, date: fmtDate(sub.trial_end) })}
              </p>
            )}
            {sub.status === 'trialing' && !showTrialFreeYear && (
              <p className="sb-info-note">{t(`${B}trial_left`, { days: sub.trial_days_left ?? 0, date: fmtDate(sub.trial_end) })}</p>
            )}
            <div className="sb-bill-rows">
              <Row label={t(`${B}cycle_label`)} value={sub.billing_cycle ? cycleLabel(sub.billing_cycle) : '—'} />
              <Row label={t(`${B}amount`)} value={<bdi dir="ltr">{money(sub.amount, sub.currency)}</bdi>} />
              <Row label={t(`${B}method`)} value={providerLabel(sub.provider)} />
              <Row label={t(`${B}next_billing`)} value={<bdi dir="ltr">{fmtDate(sub.next_billing_date)}</bdi>} />
              <Row label={t(`${B}period_end`)} value={<bdi dir="ltr">{fmtDate(sub.current_period_end)}</bdi>} />
            </div>
            {sub.provider === 'paypal' && (sub.status === 'active' || sub.status === 'past_due' || sub.status === 'payment_failed') && (
              <div className="sb-form-actions" style={{ justifyContent: 'flex-start', marginTop: 14 }}>
                <button
                  type="button"
                  className="sb-secondary-btn sb-btn-inline"
                  disabled={cancelSub.isPending}
                  onClick={() => { if (window.confirm(t(`${B}confirm_cancel`))) cancelSub.mutate(); }}
                >
                  {cancelSub.isPending && <Loader2 size={18} className="sb-spin" aria-hidden="true" />}
                  {t(`${B}cancel_sub`)}
                </button>
              </div>
            )}
          </section>

          {/* Plans — live PayPal checkout */}
          {sub.plan && (
            <section className="sb-card">
              <h2 className="sb-form-title" style={{ lineHeight: 1.3 }}>{t(`${B}choose_plan`)}</h2>
              <p className="sb-form-hint" style={{ margin: '4px 0 12px' }}>{t(`${B}choose_hint`)}</p>
              <div className="sb-bill-plans">
                {([
                  { cycle: 'monthly' as const,     price: sub.plan.monthly_price,            note: null },
                  { cycle: 'half_yearly' as const, price: sub.plan.half_yearly_price ?? 0,   note: t(`${B}save_17`) },
                  { cycle: 'yearly' as const,      price: sub.plan.yearly_price,             note: t(`${B}save_21`) },
                ]).filter(p => p.price > 0).map((p) => {
                  const current = sub.provider === 'paypal' && sub.status === 'active' && sub.billing_cycle === p.cycle;
                  const busy = subscribe.isPending && subscribe.variables === p.cycle;
                  return (
                    <div key={p.cycle} className={`sb-bill-plan ${p.cycle === 'yearly' ? 'is-on' : ''}`}>
                      <p className="sb-info-label" style={{ margin: 0 }}>
                        {cycleLabel(p.cycle)} {p.note && <span className="sb-pill sb-pill-good" style={{ marginInlineStart: 6 }}>{p.note}</span>}
                      </p>
                      <p className="sb-bill-price"><bdi dir="ltr">{money(p.price, sub.plan!.price_currency)}</bdi></p>
                      <button
                        type="button"
                        className={`${p.cycle === 'yearly' ? 'sb-primary-btn' : 'sb-secondary-btn'} sb-btn-inline`}
                        disabled={subscribe.isPending || current}
                        onClick={() => subscribe.mutate(p.cycle)}
                      >
                        {busy && <Loader2 size={18} className="sb-spin" aria-hidden="true" />}
                        {current ? t(`${B}current_plan`) : t(`${B}subscribe`)}
                      </button>
                    </div>
                  );
                })}
              </div>
              {canSubscribe === false && null}
            </section>
          )}

          {/* Billing address */}
          <section className="sb-card sb-form">
            <div className="sb-form-head">
              <span className="sb-form-icon" aria-hidden="true"><MapPin size={20} /></span>
              <h2 className="sb-form-title">{t(`${B}address`)}</h2>
            </div>
            <div className="sb-form-grid">
              {ADDR_FIELDS.map((f) => (
                <Input
                  key={f.key}
                  id={`billing-${f.key}`}
                  label={t(`${B}f_${f.key}`, { defaultValue: f.label })}
                  dir={f.key === 'phone' || f.key === 'email' || f.key === 'tax_number' || f.key === 'postal_code' ? 'ltr' : undefined}
                  value={(addr[f.key] as string) ?? ''}
                  onChange={(e) => setAddr((a) => ({ ...a, [f.key]: e.target.value }))}
                />
              ))}
            </div>
            <div className="sb-form-actions" style={{ justifyContent: 'flex-start', alignItems: 'center', marginTop: 14 }}>
              <button type="button" className="sb-primary-btn sb-btn-inline" onClick={() => saveAddr.mutate()} disabled={saveAddr.isPending}>
                {saveAddr.isPending && <Loader2 size={18} className="sb-spin" aria-hidden="true" />}
                {t(`${B}save_address`)}
              </button>
              {saved && <span className="sb-pill sb-pill-good" role="status">{t('common.saved')}</span>}
              {saveAddr.error && <span className="sb-alert sb-alert-danger" role="alert">{String(saveAddr.error)}</span>}
            </div>
          </section>

          {/* Payment history */}
          <section className="sb-section-card">
            <div className="sb-users-head">
              <span className="sb-form-icon" aria-hidden="true"><Receipt size={20} /></span>
              <h2 className="sb-form-title" style={{ lineHeight: 1.3 }}>{t(`${B}history`)}</h2>
            </div>
            {payments.length === 0 ? (
              <div className="sb-card sb-empty">{t(`${B}no_payments`)}</div>
            ) : (
              <div className="sb-card sb-dtable-wrap">
                <table className="sb-dtable">
                  <thead>
                    <tr>
                      <th>{t(`${B}c_date`)}</th>
                      <th>{t(`${B}c_ref`)}</th>
                      <th>{t(`${B}c_status`)}</th>
                      <th className="sb-num">{t(`${B}amount`)}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {payments.map((p) => (
                      <tr key={p.id}>
                        <td><bdi dir="ltr">{fmtDate(p.paid_at ?? p.created_at)}</bdi></td>
                        <td><bdi dir="ltr" className="sb-mono sb-fx-name">{p.provider_payment_id ?? '—'}</bdi></td>
                        <td>
                          <span className={`sb-pill ${p.status === 'succeeded' ? 'sb-pill-good' : p.status === 'refunded' ? 'sb-pill-warn' : 'sb-pill-bad'}`} style={{ marginTop: 0 }}>
                            {t(`${B}pay.${p.status}`, { defaultValue: p.status })}
                          </span>
                        </td>
                        <td className="sb-num"><bdi dir="ltr">{money(p.amount, p.currency)}</bdi></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </>
      )}
    </OceanPage>
  );
}
