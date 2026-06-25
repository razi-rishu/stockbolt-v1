/**
 * Billing & Subscription — SaaS Milestone M2 (read-only portal).
 *
 * Reads the tenant's own subscription via get_my_subscription() and shows plan,
 * status, trial, renewal and a billing-address form. Online payment actions
 * (Subscribe / Cancel) arrive with M3 (PayPal) — shown here as disabled CTAs.
 *
 * Safe before M1 is applied: get_my_subscription() simply returns null, in which
 * case we show a friendly "not set up yet" state.
 */
import { useEffect, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { getAdapter } from '@/data/index';
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

export default function BillingPage() {
  const { company_id } = useAuthStore();
  const qc = useQueryClient();
  const [addr, setAddr] = useState<Partial<BillingAddressRow>>({});
  const [saved, setSaved] = useState(false);

  const { data: sub, isLoading } = useQuery({
    queryKey: ['my_subscription', company_id],
    queryFn: () => getAdapter().billing.getSubscription(),
    enabled: !!company_id,
  });

  const { data: address } = useQuery({
    queryKey: ['billing_address', company_id],
    queryFn: () => getAdapter().billing.getAddress(company_id!),
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

  const fmtDate = (d?: string | null) => (d ? new Date(d).toLocaleDateString() : '—');
  const money = (n?: number | null, ccy?: string | null) =>
    n == null ? '—' : `${ccy ?? 'USD'} ${Number(n).toFixed(2)}`;

  return (
    <div style={{ maxWidth: 760, margin: '0 auto', padding: '8px 0' }}>
      <div style={{ marginBottom: 20 }}>
        <PageHeader title="Billing & Subscription" subtitle="Your plan, trial, payments and billing details." />
      </div>

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
            {sub.grandfathered && (
              <p style={{ fontSize: 12, color: '#047857', background: '#ecfdf5', padding: '8px 12px', borderRadius: 8, margin: '0 0 12px' }}>
                ✓ Complimentary plan — you're an existing customer and won't be charged.
              </p>
            )}
            {sub.status === 'trialing' && (
              <p style={{ fontSize: 13, color: '#4338ca', background: '#eef2ff', padding: '8px 12px', borderRadius: 8, margin: '0 0 12px' }}>
                Trial — {sub.trial_days_left ?? 0} day{(sub.trial_days_left ?? 0) === 1 ? '' : 's'} remaining (ends {fmtDate(sub.trial_end)}).
              </p>
            )}
            <Row label="Billing cycle" value={sub.billing_cycle ? (sub.billing_cycle === 'yearly' ? 'Yearly' : 'Monthly') : '—'} />
            <Row label="Amount" value={money(sub.amount, sub.currency)} />
            <Row label="Payment method" value={sub.provider === 'paypal' ? 'PayPal' : sub.provider === 'manual' ? 'Manual / none' : sub.provider} />
            <Row label="Next billing" value={fmtDate(sub.next_billing_date)} />
            <Row label="Renews / period end" value={fmtDate(sub.current_period_end)} />
            <div style={{ display: 'flex', gap: 10, marginTop: 14 }}>
              <Button disabled title="Online payments arrive in the next update">Subscribe / Upgrade</Button>
              {(sub.status === 'active' || sub.status === 'trialing') && !sub.grandfathered && (
                <Button variant="secondary" disabled title="Available with online billing">Cancel</Button>
              )}
            </div>
            <p style={{ fontSize: 11, color: theme.inkMuted, marginTop: 8 }}>Online payment (PayPal) arrives in the next update.</p>
          </Card>

          {/* Plan offer */}
          {sub.plan && (
            <Card className="mb-6">
              <h2 style={{ fontSize: 14, fontWeight: 600, color: theme.ink, margin: '0 0 10px' }}>Plan</h2>
              <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
                <div style={{ flex: '1 1 200px', border: `1px solid ${theme.border}`, borderRadius: 10, padding: '12px 14px' }}>
                  <p style={{ fontSize: 12, color: theme.inkMuted, margin: 0 }}>Monthly</p>
                  <p style={{ fontSize: 20, fontWeight: 700, color: theme.ink, margin: '2px 0 0' }}>{money(sub.plan.monthly_price, sub.plan.price_currency)}</p>
                </div>
                <div style={{ flex: '1 1 200px', border: `1px solid ${theme.border}`, borderRadius: 10, padding: '12px 14px' }}>
                  <p style={{ fontSize: 12, color: theme.inkMuted, margin: 0 }}>Yearly <span style={{ color: '#047857' }}>· 2 months free</span></p>
                  <p style={{ fontSize: 20, fontWeight: 700, color: theme.ink, margin: '2px 0 0' }}>{money(sub.plan.yearly_price, sub.plan.price_currency)}</p>
                </div>
              </div>
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

          {/* Payment history — populated from M3/M4 */}
          <Card>
            <h2 style={{ fontSize: 14, fontWeight: 600, color: theme.ink, margin: '0 0 8px' }}>Payment history</h2>
            <p style={{ fontSize: 13, color: theme.inkMuted, margin: 0 }}>No payments yet. Invoices appear here once online billing is active.</p>
          </Card>
        </>
      )}
    </div>
  );
}
