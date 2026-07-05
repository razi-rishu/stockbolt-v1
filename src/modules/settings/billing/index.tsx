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
import { Card } from '@/ui/card';
import { Button } from '@/ui/button';
import { Input } from '@/ui/input';
import { PageHeader } from '@/ui/primitives';
import { theme } from '@/ui/theme';
import type { BillingAddressRow } from '@/data/adapter';

const STATUS_STYLE: Record<string, { label: string; bg: string; fg: string }> = {
  trialing:        { label: 'Trial',          bg: '#eef2ff', fg: '#4338ca' },
  active:          { label: 'Active',         bg: '#ecfdf5', fg: '#047857' },
  past_due:        { label: 'Past due',       bg: '#fffbeb', fg: '#b45309' },
  payment_failed:  { label: 'Payment failed', bg: '#fffbeb', fg: '#b45309' },
  pending_payment: { label: 'Pending',        bg: '#fffbeb', fg: '#b45309' },
  suspended:       { label: 'Suspended',      bg: '#fef2f2', fg: '#b91c1c' },
  cancelled:       { label: 'Cancelled',      bg: '#fef2f2', fg: '#b91c1c' },
  expired:         { label: 'Expired',        bg: '#fef2f2', fg: '#b91c1c' },
};

const CYCLE_LABEL: Record<string, string> = {
  monthly: 'Monthly', half_yearly: '6 months', yearly: 'Yearly',
};

function StatusBadge({ status }: { status: string }) {
  const s = STATUS_STYLE[status] ?? { label: status, bg: theme.muted, fg: theme.inkMuted };
  return (
    <span style={{ background: s.bg, color: s.fg, fontSize: 12, fontWeight: 700, padding: '3px 10px', borderRadius: 999 }}>
      {s.label}
    </span>
  );
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, padding: '7px 0', borderBottom: `1px solid ${theme.border}` }}>
      <span style={{ fontSize: 13, color: theme.inkMuted }}>{label}</span>
      <span style={{ fontSize: 13, color: theme.ink, fontWeight: 500, textAlign: 'right' }}>{value}</span>
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
      if (!approvalUrl) throw new Error('No approval link returned');
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

  return (
    <div style={{ maxWidth: 760, margin: '0 auto', padding: '8px 0' }}>
      <div style={{ marginBottom: 20 }}>
        <PageHeader title="Billing & Subscription" subtitle="Your plan, trial, payments and billing details." />
      </div>

      {paypalReturn === 'approved' && sub?.status !== 'active' && (
        <div style={{ background: '#eef2ff', border: '1px solid #c7d2fe', color: '#4338ca', borderRadius: 10, padding: '10px 14px', fontSize: 13, marginBottom: 14 }}>
          ✓ Payment approved on PayPal — activating your subscription… this page updates automatically.
        </div>
      )}
      {paypalReturn === 'approved' && sub?.status === 'active' && (
        <div style={{ background: '#ecfdf5', border: '1px solid #a7f3d0', color: '#047857', borderRadius: 10, padding: '10px 14px', fontSize: 13, marginBottom: 14, display: 'flex', justifyContent: 'space-between', gap: 8 }}>
          <span>✓ Subscription active — thank you!</span>
          <button onClick={() => setSearchParams({}, { replace: true })} style={{ background: 'none', border: 'none', color: '#047857', cursor: 'pointer', fontSize: 13 }}>✕</button>
        </div>
      )}
      {paypalReturn === 'cancelled' && (
        <div style={{ background: '#fffbeb', border: '1px solid #fde68a', color: '#b45309', borderRadius: 10, padding: '10px 14px', fontSize: 13, marginBottom: 14, display: 'flex', justifyContent: 'space-between', gap: 8 }}>
          <span>Checkout was cancelled — no payment was made.</span>
          <button onClick={() => setSearchParams({}, { replace: true })} style={{ background: 'none', border: 'none', color: '#b45309', cursor: 'pointer', fontSize: 13 }}>✕</button>
        </div>
      )}
      {payError && (
        <div style={{ background: '#fef2f2', border: '1px solid #fecaca', color: '#b91c1c', borderRadius: 10, padding: '10px 14px', fontSize: 13, marginBottom: 14 }}>
          {payError}
        </div>
      )}

      {isLoading && <p style={{ fontSize: 13, color: theme.inkMuted }}>Loading…</p>}

      {!isLoading && !sub && (
        <Card>
          <p style={{ fontSize: 14, color: theme.ink, margin: 0 }}>Billing is not set up for this company yet.</p>
          <p style={{ fontSize: 12, color: theme.inkMuted, marginTop: 6 }}>
            Once the subscription module is enabled, your plan and payment history appear here.
          </p>
        </Card>
      )}

      {sub && (
        <>
          {/* Current subscription */}
          <Card className="mb-6">
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
              <h2 style={{ fontSize: 16, fontWeight: 600, color: theme.ink, margin: 0 }}>
                {sub.plan?.name ?? 'Subscription'}
              </h2>
              <StatusBadge status={sub.status} />
            </div>
            {sub.grandfathered && sub.status === 'active' && (
              <p style={{ fontSize: 12, color: '#047857', background: '#ecfdf5', padding: '8px 12px', borderRadius: 8, margin: '0 0 12px' }}>
                ✓ Complimentary plan — you're an existing customer and won't be charged.
              </p>
            )}
            {showTrialFreeYear && (
              <p style={{ fontSize: 13, color: '#047857', background: '#ecfdf5', padding: '8px 12px', borderRadius: 8, margin: '0 0 12px' }}>
                🎁 Your first year is FREE — {sub.trial_days_left} days remaining (until {fmtDate(sub.trial_end)}). Subscribe any time; billing starts when your free year ends.
              </p>
            )}
            {sub.status === 'trialing' && !showTrialFreeYear && (
              <p style={{ fontSize: 13, color: '#4338ca', background: '#eef2ff', padding: '8px 12px', borderRadius: 8, margin: '0 0 12px' }}>
                Trial — {sub.trial_days_left ?? 0} day{(sub.trial_days_left ?? 0) === 1 ? '' : 's'} remaining (ends {fmtDate(sub.trial_end)}).
              </p>
            )}
            <Row label="Billing cycle" value={sub.billing_cycle ? (CYCLE_LABEL[sub.billing_cycle] ?? sub.billing_cycle) : '—'} />
            <Row label="Amount" value={money(sub.amount, sub.currency)} />
            <Row label="Payment method" value={sub.provider === 'paypal' ? 'PayPal' : sub.provider === 'manual' ? 'Manual / none' : sub.provider} />
            <Row label="Next billing" value={fmtDate(sub.next_billing_date)} />
            <Row label="Renews / period end" value={fmtDate(sub.current_period_end)} />
            {sub.provider === 'paypal' && (sub.status === 'active' || sub.status === 'past_due' || sub.status === 'payment_failed') && (
              <div style={{ display: 'flex', gap: 10, marginTop: 14 }}>
                <Button
                  variant="secondary"
                  loading={cancelSub.isPending}
                  onClick={() => { if (window.confirm('Cancel your subscription? You keep access until the end of the paid period.')) cancelSub.mutate(); }}
                >
                  Cancel subscription
                </Button>
              </div>
            )}
          </Card>

          {/* Plans — live PayPal checkout */}
          {sub.plan && (
            <Card className="mb-6">
              <h2 style={{ fontSize: 14, fontWeight: 600, color: theme.ink, margin: '0 0 4px' }}>Choose a plan</h2>
              <p style={{ fontSize: 12, color: theme.inkMuted, margin: '0 0 12px' }}>
                Pay securely with PayPal. You can cancel any time.
              </p>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 12 }}>
                {([
                  { cycle: 'monthly' as const,     label: 'Monthly',  price: sub.plan.monthly_price,            note: null },
                  { cycle: 'half_yearly' as const, label: '6 months', price: sub.plan.half_yearly_price ?? 0,   note: 'Save 17%' },
                  { cycle: 'yearly' as const,      label: 'Yearly',   price: sub.plan.yearly_price,             note: 'Save 21%' },
                ]).filter(p => p.price > 0).map((p) => (
                  <div key={p.cycle} style={{ border: `1px solid ${p.cycle === 'yearly' ? theme.brand : theme.border}`, borderRadius: 10, padding: '14px' }}>
                    <p style={{ fontSize: 12, color: theme.inkMuted, margin: 0 }}>
                      {p.label} {p.note && <span style={{ color: '#047857' }}>· {p.note}</span>}
                    </p>
                    <p style={{ fontSize: 22, fontWeight: 700, color: theme.ink, margin: '2px 0 10px' }}>
                      {money(p.price, sub.plan!.price_currency)}
                    </p>
                    <Button
                      size="sm"
                      variant={p.cycle === 'yearly' ? 'primary' : 'secondary'}
                      loading={subscribe.isPending && subscribe.variables === p.cycle}
                      disabled={subscribe.isPending || (sub.provider === 'paypal' && sub.status === 'active' && sub.billing_cycle === p.cycle)}
                      onClick={() => subscribe.mutate(p.cycle)}
                    >
                      {sub.provider === 'paypal' && sub.status === 'active' && sub.billing_cycle === p.cycle ? 'Current plan' : 'Subscribe'}
                    </Button>
                  </div>
                ))}
              </div>
              {canSubscribe === false && null}
            </Card>
          )}

          {/* Billing address */}
          <Card className="mb-6">
            <h2 style={{ fontSize: 14, fontWeight: 600, color: theme.ink, margin: '0 0 12px' }}>Billing address</h2>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0,1fr))', gap: 12 }}>
              {ADDR_FIELDS.map((f) => (
                <Input
                  key={f.key}
                  label={f.label}
                  value={(addr[f.key] as string) ?? ''}
                  onChange={(e) => setAddr((a) => ({ ...a, [f.key]: e.target.value }))}
                />
              ))}
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 14 }}>
              <Button onClick={() => saveAddr.mutate()} loading={saveAddr.isPending}>Save address</Button>
              {saved && <span style={{ fontSize: 13, color: '#047857' }}>Saved ✓</span>}
              {saveAddr.error && <span style={{ fontSize: 13, color: '#b91c1c' }}>{String(saveAddr.error)}</span>}
            </div>
          </Card>

          {/* Payment history */}
          <Card>
            <h2 style={{ fontSize: 14, fontWeight: 600, color: theme.ink, margin: '0 0 8px' }}>Payment history</h2>
            {payments.length === 0 ? (
              <p style={{ fontSize: 13, color: theme.inkMuted, margin: 0 }}>No payments yet.</p>
            ) : (
              <table style={{ width: '100%', fontSize: 13 }}>
                <thead>
                  <tr style={{ borderBottom: `1px solid ${theme.border}`, textAlign: 'left' }}>
                    <th style={{ padding: '6px 0', fontSize: 11, color: theme.inkMuted, textTransform: 'uppercase' }}>Date</th>
                    <th style={{ padding: '6px 0', fontSize: 11, color: theme.inkMuted, textTransform: 'uppercase' }}>Reference</th>
                    <th style={{ padding: '6px 0', fontSize: 11, color: theme.inkMuted, textTransform: 'uppercase' }}>Status</th>
                    <th style={{ padding: '6px 0', fontSize: 11, color: theme.inkMuted, textTransform: 'uppercase', textAlign: 'right' }}>Amount</th>
                  </tr>
                </thead>
                <tbody>
                  {payments.map((p) => (
                    <tr key={p.id} style={{ borderBottom: `1px solid #f1f5f9` }}>
                      <td style={{ padding: '7px 0', color: theme.ink }}>{fmtDate(p.paid_at ?? p.created_at)}</td>
                      <td style={{ padding: '7px 0', color: theme.inkMuted, fontFamily: 'monospace', fontSize: 12 }}>{p.provider_payment_id ?? '—'}</td>
                      <td style={{ padding: '7px 0', color: p.status === 'succeeded' ? '#047857' : p.status === 'refunded' ? '#b45309' : '#b91c1c', textTransform: 'capitalize' }}>{p.status}</td>
                      <td style={{ padding: '7px 0', color: theme.ink, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{money(p.amount, p.currency)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </Card>
        </>
      )}
    </div>
  );
}
