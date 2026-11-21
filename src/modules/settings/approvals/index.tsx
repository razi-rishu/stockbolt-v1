/**
 * Settings → Approvals (phase145, admin only) — which documents need approval
 * from what amount, and who may approve what (Approval authority). Every rule
 * starts off; turning the first one on gives the top person and every manager
 * with a login authority for everything, which the admin then adjusts here.
 */
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { ShieldCheck, Trash2, UserCheck } from 'lucide-react';
import { getAdapter } from '@/data/index';
import type { ApprovalDocType, ApprovalRule, TeamMember } from '@/data/adapter';
import { OceanPage } from '@/components/ocean-list';
import { SearchableSelect } from '@/ui/searchable-select';
import { useAuthStore } from '@/store/auth';
import { moneyLabel } from '@/lib/currency-display';
import { useCompanyCurrency } from '@/hooks/use-company-currency';
import { useApprovalConfig } from '@/components/approvals/use-approval';
import { APPROVAL_DOC_TYPES, approvalError, approvalKeys, docTypeLabel, problemLabel } from '@/components/approvals/approval-lists';
import { personLabel } from '@/modules/settings/team/team-lists';

function RuleRow({ type, rule }: { type: ApprovalDocType; rule: ApprovalRule | undefined }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const company_id = useAuthStore((s) => s.company_id);
  const [on, setOn] = useState(!!rule?.enabled);
  const [min, setMin] = useState(String(rule?.min_amount ?? 0));
  const n = Number(min);
  const valid = min.trim() !== '' && Number.isFinite(n) && n >= 0;
  const dirty = on !== !!rule?.enabled || n !== Number(rule?.min_amount ?? 0);
  const save = useMutation({
    mutationFn: () => getAdapter().approvals.saveRule(type, on, Math.round(n * 100) / 100),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: approvalKeys.config(company_id) }); },
  });
  return (
    <li className={`sb-appr-rule ${on ? 'is-on' : ''}`} data-testid={`rule-${type}`}>
      <label className="sb-team-check sb-appr-rule-name">
        <input type="checkbox" checked={on} onChange={(e) => { setOn(e.target.checked); save.reset(); }} data-testid={`rule-${type}-on`} />
        <strong>{docTypeLabel(t, type)}</strong>
      </label>
      <label className="sb-appr-rule-min">
        <span className="sb-team-muted">{t('apprOcean.from_amount')}</span>
        <input className="sb-team-input" dir="ltr" type="number" min={0} step="0.01" value={min} disabled={!on}
          onChange={(e) => { setMin(e.target.value); save.reset(); }} data-testid={`rule-${type}-min`} />
      </label>
      <span className="sb-appr-rule-act">
        <button type="button" className="sb-primary-btn sb-btn-inline" disabled={!dirty || !valid || save.isPending} onClick={() => save.mutate()} data-testid={`rule-${type}-save`}>
          {save.isPending ? t('apprOcean.saving') : t('apprOcean.save')}
        </button>
        {save.isSuccess && !dirty && <span role="status" className="sb-gc-ok">{t('apprOcean.saved')}</span>}
        {save.isError && <span role="alert" className="sb-gc-err">{approvalError(save.error)}</span>}
      </span>
    </li>
  );
}

export default function ApprovalsSettingsPage() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const company_id = useAuthStore((s) => s.company_id);
  const base = useCompanyCurrency();
  const cfg = useApprovalConfig();
  const team = useQuery<TeamMember[]>({ queryKey: ['team', company_id], queryFn: () => getAdapter().team.list(true), enabled: !!company_id });
  const [person, setPerson] = useState('');
  const [docType, setDocType] = useState<ApprovalDocType | '*'>('*');
  const [limit, setLimit] = useState('');
  const refresh = () => { void qc.invalidateQueries({ queryKey: approvalKeys.config(company_id) }); };
  const add = useMutation({
    mutationFn: () => getAdapter().approvals.setAuthority(person, docType, limit.trim() === '' ? null : Number(limit)),
    onSuccess: () => { setPerson(''); setLimit(''); refresh(); },
  });
  const remove = useMutation({ mutationFn: (id: string) => getAdapter().approvals.removeAuthority(id), onSuccess: refresh });
  const limitOk = limit.trim() === '' || (Number.isFinite(Number(limit)) && Number(limit) >= 0);
  const rules = cfg.data?.rules ?? [];
  const auth = cfg.data?.authorities ?? [];
  const people = (team.data ?? []).filter((m) => m.is_active).map((m) => ({ value: m.employee_id, label: personLabel(m) }));

  return (
    <OceanPage testid="approvals-settings" title={t('settingsNav.items.approvals.title')} subtitle={t('apprOcean.settings_sub')}>
      {cfg.isError && <p className="sb-alert sb-alert-danger" role="alert">{approvalError(cfg.error)}</p>}
      <section className="sb-card sb-team-format">
        <div className="sb-form-head">
          <span className="sb-form-icon" aria-hidden="true"><ShieldCheck size={20} /></span>
          <div>
            <h2 className="sb-form-title">{t('apprOcean.rules_title')}</h2>
            <p className="sb-team-muted">{t('apprOcean.rules_intro')}</p>
          </div>
        </div>
        {cfg.data && (
          <ul className="sb-appr-rules">
            {APPROVAL_DOC_TYPES.map((type) => {
              const r = rules.find((x) => x.doc_type === type);
              return <RuleRow key={type} type={type} rule={r} />;
            })}
          </ul>
        )}
        <p className="sb-team-muted">{t('apprOcean.rules_note')}</p>
      </section>

      <section className="sb-card sb-team-format" style={{ marginTop: 16 }}>
        <div className="sb-form-head">
          <span className="sb-form-icon" aria-hidden="true"><UserCheck size={20} /></span>
          <div>
            <h2 className="sb-form-title">{t('apprOcean.auth_title')}</h2>
            <p className="sb-team-muted">{t('apprOcean.auth_intro')}</p>
          </div>
        </div>
        {auth.length === 0 ? <p className="sb-team-muted">{t('apprOcean.auth_empty')}</p> : (
          <ul className="sb-team-list" data-testid="authority-list">
            {auth.map((a) => (
              <li key={a.id} className="sb-appr-auth">
                <bdi dir="ltr" className="sb-team-code">{a.code}</bdi>
                <span className="sb-team-row-main">
                  <span className="sb-team-row-name">{a.name}</span>
                  <span className="sb-team-muted">
                    {docTypeLabel(t, a.doc_type)} · {a.max_amount == null ? t('apprOcean.no_limit') : t('apprOcean.up_to', { amount: moneyLabel(a.max_amount, base) })}
                  </span>
                </span>
                {a.problem && <span className="sb-team-tag is-warn">{problemLabel(t, a.problem)}</span>}
                <button type="button" className="sb-icon-btn sb-danger" aria-label={t('apprOcean.remove')} title={t('apprOcean.remove')}
                  disabled={remove.isPending} onClick={() => remove.mutate(a.id)}><Trash2 size={16} /></button>
              </li>
            ))}
          </ul>
        )}
        <div className="sb-appr-add">
          <label className="sb-gc-field">
            <span className="sb-gc-label">{t('apprOcean.person')}</span>
            <SearchableSelect value={person} onChange={setPerson} options={people} placeholder={t('apprOcean.search_people')} />
          </label>
          <label className="sb-gc-field">
            <span className="sb-gc-label">{t('apprOcean.documents')}</span>
            <select className="sb-team-select" value={docType} onChange={(e) => setDocType(e.target.value as ApprovalDocType | '*')} data-testid="authority-doc">
              <option value="*">{docTypeLabel(t, '*')}</option>
              {APPROVAL_DOC_TYPES.map((d) => <option key={d} value={d}>{docTypeLabel(t, d)}</option>)}
            </select>
          </label>
          <label className="sb-gc-field">
            <span className="sb-gc-label">{t('apprOcean.limit')}</span>
            <input className="sb-team-input" dir="ltr" type="number" min={0} step="0.01" value={limit}
              placeholder={t('apprOcean.limit_blank')} onChange={(e) => setLimit(e.target.value)} data-testid="authority-limit" />
          </label>
          <button type="button" className="sb-primary-btn sb-btn-inline" disabled={!person || !limitOk || add.isPending}
            onClick={() => add.mutate()} data-testid="authority-add">{t('apprOcean.add')}</button>
        </div>
        {(add.isError || remove.isError) && <p className="sb-gc-err" role="alert">{approvalError(add.error ?? remove.error)}</p>}
        <p className="sb-team-muted">{t('apprOcean.auth_note')}</p>
      </section>
    </OceanPage>
  );
}
