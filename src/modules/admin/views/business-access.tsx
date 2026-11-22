/**
 * phase151 — Control Center: one business's access (full / grace / read-only)
 * and the platform owner's two billing actions. Both actions are server-side
 * owner-only and logged in subscription_history. Hidden until phase151 exists.
 */
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { getAdapter } from '@/data/index';
import type { CompanyAccess } from '@/data/adapter';
import { accessLabel } from '@/modules/settings/billing/access-banner';
import { Input } from '@/ui/input';
import { useAdminFormat } from '../admin-explorers';

export function BusinessAccessPanel({ companyId }: { companyId: string }) {
  const { t } = useTranslation();
  const f = useAdminFormat();
  const qc = useQueryClient();
  const [until, setUntil] = useState('');
  const [reason, setReason] = useState('');
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const { data: access } = useQuery<CompanyAccess | null>({
    queryKey: ['admin_company_access', companyId],
    queryFn: () => getAdapter().admin.companyAccess(companyId),
    enabled: !!companyId,
  });

  const done = (a: CompanyAccess) => {
    qc.setQueryData(['admin_company_access', companyId], a);
    qc.invalidateQueries({ queryKey: ['admin_business', companyId] });
    setMsg({ ok: true, text: t('billingAccess.admin_saved') });
    setReason('');
  };
  const fail = (e: unknown) => setMsg({ ok: false, text: e instanceof Error ? e.message : String(e) });

  const extend = useMutation({
    mutationFn: () => getAdapter().admin.extendFreePeriod(companyId, until, reason.trim() || undefined),
    onSuccess: (a) => { done(a); setUntil(''); },
    onError: fail,
  });
  const exempt = useMutation({
    mutationFn: (value: boolean) => getAdapter().admin.setBillingExempt(companyId, value, reason.trim() || undefined),
    onSuccess: done,
    onError: fail,
  });

  if (!access) return null;
  const busy = extend.isPending || exempt.isPending;
  const today = new Date().toISOString().slice(0, 10);

  return (
    <section className="sb-card sb-adm-panel" data-testid="admin-access-panel">
      <h2 className="sb-adm-h">{t('billingAccess.admin_title')}</h2>
      <dl className="sb-gc-rows">
        <div className="sb-gc-row"><dt>{t('billingAccess.state_label')}</dt><dd>{accessLabel(access, t, f.date)}</dd></div>
        {access.ends_on && !access.exempt && (
          <div className="sb-gc-row"><dt>{t('billingAccess.covered_until')}</dt><dd><bdi dir="ltr">{f.date(access.ends_on)}</bdi></dd></div>
        )}
      </dl>
      {!access.enforcement && <p className="sb-adm-note">{t('billingAccess.enforcement_off')}</p>}

      <div className="sb-form-grid" style={{ marginTop: 12 }}>
        <Input label={t('billingAccess.admin_extend_to')} type="date" min={today} value={until} onChange={(e) => setUntil(e.target.value)} />
        <Input label={t('billingAccess.admin_reason')} maxLength={200} value={reason} onChange={(e) => setReason(e.target.value)} />
      </div>
      <div className="sb-form-actions" style={{ justifyContent: 'flex-start', gap: 8, flexWrap: 'wrap', marginTop: 10 }}>
        <button type="button" className="sb-primary-btn sb-btn-inline" disabled={busy || !until || until < today}
          onClick={() => { setMsg(null); extend.mutate(); }}>
          {t('billingAccess.admin_extend')}
        </button>
        <button type="button" className="sb-secondary-btn sb-btn-inline" disabled={busy}
          onClick={() => { setMsg(null); exempt.mutate(!access.exempt); }}>
          {access.exempt ? t('billingAccess.admin_unmark_exempt') : t('billingAccess.admin_mark_exempt')}
        </button>
      </div>
      {msg && <p className={`sb-alert ${msg.ok ? 'sb-alert-good' : 'sb-alert-danger'}`} role="status" style={{ marginTop: 10 }}>{msg.text}</p>}
    </section>
  );
}
