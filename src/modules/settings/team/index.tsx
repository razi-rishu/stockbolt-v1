/**
 * Settings → Team (phase144) — the company's people as an org chart: employee
 * codes, who reports to whom, job titles, departments and which login each
 * person uses. Part 1 of Approvals: phase145 routes approval requests along
 * this tree.
 *
 * Everyone in the company can look (names, codes and titles only — never pay or
 * ID data, which stay on the admin-only Payroll pages). Only admins
 * (users.manage) change it; the code format needs settings.write.
 */
import { useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Crown, KeyRound, Network, Search } from 'lucide-react';
import { getAdapter } from '@/data/index';
import type { Company, Profile, TeamMember } from '@/data/adapter';
import { OceanPage } from '@/components/ocean-list';
import { useAuthStore } from '@/store/auth';
import { useHasPermission } from '@/hooks/use-permissions';
import { buildTree, chainOf, deptLabel, matchesPerson, personLabel, titleLabel } from './team-lists';
import { MemberPanel } from './member-panel';
import { CodeFormatCard, type CodeFormat } from './code-format-card';

export default function TeamPage() {
  const { t } = useTranslation();
  const company_id = useAuthStore((s) => s.company_id);
  const canManage = useHasPermission('users.manage');
  const canSettings = useHasPermission('settings.write');
  const [params, setParams] = useSearchParams();
  const selectedId = params.get('e');
  const [query, setQuery] = useState('');
  const [showInactive, setShowInactive] = useState(false);

  // Everyone, once: inactive people still count for the next code.
  const teamQ = useQuery<TeamMember[]>({
    queryKey: ['team', company_id],
    queryFn: () => getAdapter().team.list(true),
    enabled: !!company_id,
  });
  const usersQ = useQuery<Profile[]>({
    queryKey: ['users', company_id],
    queryFn: () => getAdapter().users.listUsers(company_id!),
    enabled: !!company_id && canManage,
  });
  const companyQ = useQuery<Company | null>({
    queryKey: ['company', company_id],
    queryFn: () => getAdapter().companies.getById(company_id!),
    enabled: !!company_id,
  });

  const everyone = useMemo(() => teamQ.data ?? [], [teamQ.data]);
  const team = useMemo(() => (showInactive ? everyone : everyone.filter((m) => m.is_active || m.reports_to_id === null)), [everyone, showInactive]);
  const tree = useMemo(() => buildTree(team), [team]);
  const matches = useMemo(() => (query.trim() ? team.filter((m) => matchesPerson(m, query)) : []), [team, query]);
  const selected = team.find((m) => m.employee_id === selectedId) ?? null;
  const top = team.find((m) => m.reports_to_id === null) ?? null;
  const users = usersQ.data ?? [];
  const c = companyQ.data;
  const format: CodeFormat | null = c ? {
    employee_code_prefix: c.employee_code_prefix ?? 'EMP-',
    employee_code_digits: c.employee_code_digits ?? 4,
    employee_code_start: c.employee_code_start ?? 1,
  } : null;
  const unlinked = canManage ? users.filter((u) => u.is_active && !team.some((m) => m.user_id === u.id)) : [];
  const select = (id: string | null) => {
    const next = new URLSearchParams(params);
    if (id) next.set('e', id); else next.delete('e');
    setParams(next, { replace: true });
  };

  const row = (m: TeamMember, depth: number, reports: number, showChain: boolean) => (
    <li key={m.employee_id}>
      <button type="button" className={`sb-team-row ${m.employee_id === selectedId ? 'is-on' : ''} ${m.is_active ? '' : 'is-off'}`}
        style={{ paddingInlineStart: 12 + depth * 22 }} onClick={() => select(m.employee_id)} data-testid={`team-row-${m.code}`}>
        {depth > 0 && <span className="sb-team-branch" aria-hidden="true" />}
        <bdi dir="ltr" className="sb-team-code">{m.code}</bdi>
        <span className="sb-team-row-main">
          <span className="sb-team-row-name">{m.name}</span>
          <span className="sb-team-muted">
            {showChain && m.reports_to_id
              ? t('teamOcean.reports_to_short', { who: chainOf(team, m.employee_id)[0] ? personLabel(chainOf(team, m.employee_id)[0]) : '—' })
              : [titleLabel(t, m.designation), deptLabel(t, m.department)].filter(Boolean).join(' · ')}
          </span>
        </span>
        <span className="sb-team-badges">
          {m.reports_to_id === null && <span className="sb-team-tag is-top"><Crown size={13} aria-hidden="true" />{t('teamOcean.top')}</span>}
          {canManage && m.user_id && <span className="sb-team-tag" title={m.user_email ?? ''}><KeyRound size={13} aria-hidden="true" />{t('teamOcean.has_login')}</span>}
          {!m.is_active && <span className="sb-team-tag">{t('teamOcean.inactive')}</span>}
          {reports > 0 && <span className="sb-team-count" dir="ltr">{reports}</span>}
        </span>
      </button>
    </li>
  );

  return (
    <OceanPage
      testid="team-ocean"
      title={t('settingsNav.items.team.title')}
      subtitle={top ? t('teamOcean.subtitle', { count: team.length, top: personLabel(top) }) : t('teamOcean.subtitle_empty')}
    >
      {canManage && unlinked.length > 0 && (
        <p className="sb-alert sb-alert-warn" role="status" data-testid="team-unlinked">
          {t('teamOcean.unlinked', { count: unlinked.length, names: unlinked.map((u) => u.full_name || u.email).join(', ') })}
        </p>
      )}

      <div className={`sb-team-layout ${selected ? 'has-panel' : ''}`}>
        <section className="sb-card sb-team-tree">
          <div className="sb-team-tools">
            <label className="sb-team-search">
              <Search size={16} aria-hidden="true" />
              <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder={t('teamOcean.search')}
                aria-label={t('teamOcean.search')} data-testid="team-search" />
            </label>
            <label className="sb-team-check">
              <input type="checkbox" checked={showInactive} onChange={(e) => setShowInactive(e.target.checked)} />
              {t('teamOcean.show_inactive')}
            </label>
          </div>
          {teamQ.isLoading ? <p className="sb-team-muted">{t('common.loading')}</p>
            : teamQ.isError ? <p className="sb-alert sb-alert-danger" role="alert">{(teamQ.error as Error).message}</p>
            : query.trim() ? (
              matches.length ? <ul className="sb-team-list">{matches.map((m) => row(m, 0, 0, true))}</ul>
                : <p className="sb-team-muted">{t('teamOcean.no_match', { q: query.trim() })}</p>
            ) : tree.length ? (
              <ul className="sb-team-list" aria-label={t('teamOcean.chart')}>{tree.map((n) => row(n.member, n.depth, n.reports, false))}</ul>
            ) : <p className="sb-team-muted">{t('teamOcean.empty')}</p>}
        </section>

        {selected ? (
          <MemberPanel key={selected.employee_id + (selected.reports_to_id ?? '')} member={selected} team={team}
            users={users} canManage={canManage} onClose={() => select(null)} />
        ) : (
          <section className="sb-card sb-team-hint">
            <Network size={22} aria-hidden="true" />
            <p>{canManage ? t('teamOcean.hint_admin') : t('teamOcean.hint')}</p>
          </section>
        )}
      </div>

      {format && companyQ.data && (
        <CodeFormatCard
          key={`${format.employee_code_prefix}|${format.employee_code_digits}|${format.employee_code_start}`}
          companyId={companyQ.data.id}
          format={format}
          codes={everyone.map((m) => m.code)}
          canWrite={canSettings}
        />
      )}
    </OceanPage>
  );
}
