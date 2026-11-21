/**
 * Team (phase144) — one person's place in the company: manager, job title,
 * department and login. Admins (users.manage) edit; everyone else reads.
 * Explicit Save / Cancel (AGENTS §7.1). The server refuses loops, a second top
 * person, and logins from another company; this panel only offers valid
 * choices so those refusals are rare.
 */
import { useMemo, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Crown, X } from 'lucide-react';
import { getAdapter } from '@/data/index';
import type { Profile, TeamMember } from '@/data/adapter';
import { SearchableSelect } from '@/ui/searchable-select';
import {
  chainOf, deptLabel, deptOptions, descendantsOf, personLabel, titleLabel, titleOptions,
} from './team-lists';

const OTHER = '__other__';

/** A pick-list value or, when it isn't on the list, "Other" + the typed text. */
function useListField(stored: string | null, options: { value: string }[]) {
  const onList = !!stored && options.some((o) => o.value === stored);
  const [pick, setPick] = useState(stored ? (onList ? stored : OTHER) : '');
  const [text, setText] = useState(onList ? '' : stored ?? '');
  const value = pick === OTHER ? text.trim() : pick;
  return { pick, setPick, text, setText, value: value || null };
}

export function MemberPanel({ member, team, users, canManage, onClose }: {
  member: TeamMember;
  team: TeamMember[];
  users: Profile[];
  canManage: boolean;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const isTop = member.reports_to_id === null;
  const chain = useMemo(() => chainOf(team, member.employee_id), [team, member.employee_id]);
  const blocked = useMemo(() => descendantsOf(team, member.employee_id), [team, member.employee_id]);

  const [manager, setManager] = useState(member.reports_to_id ?? '');
  const title = useListField(member.designation, titleOptions(t));
  const dept = useListField(member.department, deptOptions(t));
  const [login, setLogin] = useState(member.user_id ?? '');
  const [done, setDone] = useState(false);

  const managerOptions = team
    .filter((m) => m.employee_id !== member.employee_id && !blocked.has(m.employee_id) && m.is_active)
    .map((m) => ({ value: m.employee_id, label: `${personLabel(m)}${m.designation ? ` — ${titleLabel(t, m.designation)}` : ''}` }));
  const linkedTo = new Map(team.filter((m) => m.user_id).map((m) => [m.user_id!, m]));

  const dirty = (!isTop && manager !== (member.reports_to_id ?? ''))
    || title.value !== (member.designation ?? null)
    || dept.value !== (member.department ?? null)
    || login !== (member.user_id ?? '');

  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ['team'] });
    void qc.invalidateQueries({ queryKey: ['users'] });
  };
  const save = useMutation({
    mutationFn: async () => {
      const api = getAdapter().team;
      if (!isTop && manager && manager !== member.reports_to_id) await api.setManager(member.employee_id, manager);
      if (title.value !== (member.designation ?? null) || dept.value !== (member.department ?? null)) {
        await api.updatePosition(member.employee_id, title.value, dept.value);
      }
      if (login !== (member.user_id ?? '')) await api.linkUser(member.employee_id, login || null);
    },
    onSuccess: () => { setDone(true); refresh(); },
  });
  const makeTop = useMutation({
    mutationFn: () => getAdapter().team.setTop(member.employee_id),
    onSuccess: () => { setDone(true); refresh(); },
  });

  const listField = (label: string, f: ReturnType<typeof useListField>, options: { value: string; label: string }[], testid: string) => (
    <label className="sb-gc-field">
      <span className="sb-gc-label">{label}</span>
      <select className="sb-team-select" value={f.pick} disabled={!canManage} data-testid={testid}
        onChange={(e) => { f.setPick(e.target.value); setDone(false); }}>
        <option value="">{t('teamOcean.not_set')}</option>
        {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        <option value={OTHER}>{t('teamOcean.other')}</option>
      </select>
      {f.pick === OTHER && (
        <input className="sb-team-input" value={f.text} maxLength={80} disabled={!canManage}
          placeholder={t('teamOcean.type_here')} onChange={(e) => { f.setText(e.target.value); setDone(false); }} />
      )}
    </label>
  );

  return (
    <section className="sb-card sb-team-panel" data-testid="team-panel" aria-label={personLabel(member)}>
      <header className="sb-team-panel-head">
        <div style={{ minWidth: 0 }}>
          <p className="sb-team-panel-name"><bdi dir="ltr" className="sb-team-code">{member.code}</bdi> {member.name}</p>
          <p className="sb-team-muted">
            {[titleLabel(t, member.designation), deptLabel(t, member.department)].filter(Boolean).join(' · ') || t('teamOcean.no_title')}
          </p>
        </div>
        <button type="button" className="sb-icon-btn" onClick={onClose} aria-label={t('teamOcean.close')}><X size={18} /></button>
      </header>

      <p className="sb-team-chain">
        {isTop ? <><Crown size={15} aria-hidden="true" /> {t('teamOcean.is_top')}</>
          : <>{t('teamOcean.reports_line')} {chain.map((m) => personLabel(m)).join(' → ')}</>}
      </p>

      <div className="sb-team-fields">
        <label className="sb-gc-field">
          <span className="sb-gc-label">{t('teamOcean.reports_to')}</span>
          {isTop ? <span className="sb-team-muted">{t('teamOcean.top_no_manager')}</span> : (
            <SearchableSelect value={manager} onChange={(v) => { setManager(v); setDone(false); }}
              options={managerOptions} placeholder={t('teamOcean.pick_manager')} disabled={!canManage} />
          )}
        </label>
        {listField(t('teamOcean.job_title'), title, titleOptions(t), 'team-title')}
        {listField(t('teamOcean.department'), dept, deptOptions(t), 'team-dept')}
        {canManage && (
          <label className="sb-gc-field">
            <span className="sb-gc-label">{t('teamOcean.login')}</span>
            <select className="sb-team-select" value={login} data-testid="team-login"
              onChange={(e) => { setLogin(e.target.value); setDone(false); }}>
              <option value="">{t('teamOcean.no_login')}</option>
              {users.map((u) => {
                const other = linkedTo.get(u.id);
                const note = other && other.employee_id !== member.employee_id ? ` (${t('teamOcean.now_linked_to', { who: personLabel(other) })})` : '';
                return <option key={u.id} value={u.id}>{`${u.full_name || u.email} · ${u.email}${note}`}</option>;
              })}
            </select>
            <span className="sb-team-muted">{t('teamOcean.login_hint')}</span>
          </label>
        )}
      </div>

      {canManage ? (
        <div className="sb-gc-actions">
          <button type="button" className="sb-primary-btn" disabled={!dirty || save.isPending} onClick={() => save.mutate()} data-testid="team-save">
            {save.isPending ? t('teamOcean.saving') : t('teamOcean.save')}
          </button>
          <button type="button" className="sb-secondary-btn" disabled={save.isPending} onClick={onClose}>{t('teamOcean.cancel')}</button>
          {!isTop && member.is_active && (
            <button type="button" className="sb-secondary-btn sb-team-top-btn" disabled={makeTop.isPending || dirty}
              onClick={() => { if (window.confirm(t('teamOcean.make_top_confirm', { who: personLabel(member) }))) makeTop.mutate(); }}>
              <Crown size={15} aria-hidden="true" /> {t('teamOcean.make_top')}
            </button>
          )}
          {done && !dirty && <span role="status" className="sb-gc-ok sb-gc-inline">{t('teamOcean.saved')}</span>}
          {(save.isError || makeTop.isError) && (
            <span role="alert" className="sb-gc-err">{((save.error ?? makeTop.error) as Error).message.replace(/^team\.\w+: /, '')}</span>
          )}
        </div>
      ) : <p className="sb-team-muted">{t('teamOcean.read_only')}</p>}
    </section>
  );
}
