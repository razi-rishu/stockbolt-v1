/**
 * Global v1 Phase 6 — branches, warehouses and team (wizard step 6).
 *
 * BranchesOnboardingForm: a new company names its Head Office and main
 * warehouse and may list other branches; they're created at activation.
 *
 * BranchesManager: an existing company's branches (add, rename, deactivate),
 * which branch each warehouse belongs to, and each user's assigned branches.
 * Writes go through RLS (settings.write for branches and warehouses,
 * users.manage for assignments). Assignments are RECORDED ONLY: they don't
 * restrict access in v1, and the screen says so — it never presents them as
 * security.
 */
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { getAdapter } from '@/data/index';
import type { BranchRow } from '@/data/adapter';
import { BRANCH_RESTRICTION_UI } from '@/core/global-config/flag';
import { useAuthStore } from '@/store/auth';

// Ocean Teal (UI v1.1): look only. Same mutations, same RLS, same hooks.
const input = 'sb-gc-input';
const btn = 'sb-gc-btn';
const btnGhost = 'sb-gc-ghost is-sm';

/** A short branch code from a name: capitals and digits, up to 6. */
export function branchCodeFrom(name: string, taken: string[]): string {
  const base = name.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6) || 'BR';
  let code = base, n = 2;
  while (taken.includes(code)) code = `${base.slice(0, 4)}${n++}`;
  return code;
}

// ── New company ─────────────────────────────────────────────────────────────
export interface BranchesDraft { head_office: string; main_warehouse: string; extra: string[] }

export function BranchesOnboardingForm({ value, showWarehouse, onChange }: {
  value: BranchesDraft; showWarehouse: boolean; onChange: (v: BranchesDraft) => void;
}) {
  const { t } = useTranslation();
  const [next, setNext] = useState('');
  return (
    <div className="sb-gc">
      <div className={showWarehouse ? 'sb-gc-grid2' : 'sb-gc'}>
        <label className="sb-gc-field">
          <span className="sb-gc-label">{t('global_config.branches.head_office_name')}</span>
          <input className={input} value={value.head_office} maxLength={120} data-testid="head-office"
            onChange={(e) => onChange({ ...value, head_office: e.target.value })} />
        </label>
        {showWarehouse && (
          <label className="sb-gc-field">
            <span className="sb-gc-label">{t('global_config.branches.main_warehouse')}</span>
            <input className={input} value={value.main_warehouse} maxLength={120} data-testid="main-warehouse"
              onChange={(e) => onChange({ ...value, main_warehouse: e.target.value })} />
          </label>
        )}
      </div>
      <div className="sb-gc-field">
        <span className="sb-gc-label">{t('global_config.branches.extra')}</span>
        {value.extra.length > 0 && (
          <ul className="sb-gc-list">
            {value.extra.map((b, i) => (
              <li key={`${b}-${i}`} className="sb-gc-item">
                <span>{b}</span>
                <button type="button" className={btnGhost} onClick={() => onChange({ ...value, extra: value.extra.filter((_, j) => j !== i) })}>
                  {t('global_config.branches.remove')}
                </button>
              </li>
            ))}
          </ul>
        )}
        <div className="sb-gc-addrow">
          <input className={input} value={next} maxLength={120} placeholder={t('global_config.branches.name')} data-testid="extra-branch"
            onChange={(e) => setNext(e.target.value)} />
          <button type="button" className={btn} disabled={!next.trim() || value.extra.length >= 20} data-testid="add-extra-branch"
            onClick={() => { onChange({ ...value, extra: [...value.extra, next.trim()] }); setNext(''); }}>
            {t('global_config.branches.add')}
          </button>
        </div>
      </div>
      <p className="sb-gc-fine">{t('global_config.branches.not_restricted')}</p>
    </div>
  );
}

// ── Existing company ────────────────────────────────────────────────────────
export function BranchesManager({ company_id, canSettings, canUsers, showWarehouses }: {
  company_id: string; canSettings: boolean; canUsers: boolean; showWarehouses: boolean;
}) {
  const { t, i18n } = useTranslation();
  const ar = i18n.language === 'ar';
  const qc = useQueryClient();
  const ad = getAdapter();
  const { data: branches = [] } = useQuery({ queryKey: ['branches', company_id], queryFn: () => ad.branches.list(company_id) });
  const { data: warehouses = [] } = useQuery({ queryKey: ['warehouses', company_id], queryFn: () => ad.warehouses.list(company_id), enabled: showWarehouses });
  const { data: users = [] } = useQuery({ queryKey: ['company_users', company_id], queryFn: () => ad.users.listUsers(company_id) });
  const { data: assignments = [] } = useQuery({ queryKey: ['branch_assignments', company_id], queryFn: () => ad.branches.listAssignments(company_id) });
  const [name, setName] = useState('');
  const [error, setError] = useState('');
  const refresh = () => {
    setError('');
    for (const k of ['branches', 'warehouses', 'branch_assignments']) qc.invalidateQueries({ queryKey: [k, company_id] });
  };
  const fail = (e: unknown) => setError(e instanceof Error ? e.message : String(e));
  // The warehouse and user-branch selects save the moment they change; say so,
  // briefly, or it looks as if nothing happened.
  const [saved, setSaved] = useState(false);
  const savedTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (savedTimer.current) clearTimeout(savedTimer.current); }, []);
  const refreshSaved = () => {
    refresh();
    setSaved(true);
    if (savedTimer.current) clearTimeout(savedTimer.current);
    savedTimer.current = setTimeout(() => setSaved(false), 2500);
  };
  const roleName = (role: string | null | undefined) => {
    switch (role) {
      case 'admin': return t('global_config.branches.role.admin');
      case 'accountant': return t('global_config.branches.role.accountant');
      case 'sales': return t('global_config.branches.role.sales');
      case 'counter': return t('global_config.branches.role.counter');
      case 'viewer': return t('global_config.branches.role.viewer');
      default: return role ?? '';
    }
  };

  const create = useMutation({
    mutationFn: () => ad.branches.create({ company_id, name: name.trim(), code: branchCodeFrom(name, branches.map((b) => b.code)) }),
    onSuccess: () => { setName(''); refresh(); }, onError: fail,
  });
  const toggle = useMutation({ mutationFn: (b: BranchRow) => ad.branches.update(b.id, { is_active: !b.is_active }), onSuccess: refresh, onError: fail });
  const move = useMutation({ mutationFn: (v: { w: string; b: string }) => ad.branches.assignWarehouse(v.w, v.b), onSuccess: refreshSaved, onError: fail });
  const assign = useMutation({ mutationFn: (v: { p: string; ids: string[] }) => ad.branches.setAssignments(company_id, v.p, v.ids), onSuccess: refreshSaved, onError: fail });

  // Phase 6 (global06): access states and the enforcement switch. Admin only -
  // the database refuses anyone else (trigger) whatever this screen shows.
  const isAdmin = useAuthStore((s) => s.role) === 'admin';
  const showAccess = BRANCH_RESTRICTION_UI;
  const { data: company } = useQuery({
    queryKey: ['company', company_id], queryFn: () => ad.companies.getById(company_id), enabled: showAccess,
  });
  const enforced = Boolean((company as { branch_restriction_enabled?: boolean } | null | undefined)?.branch_restriction_enabled);
  const refreshAccess = () => {
    qc.invalidateQueries({ queryKey: ['company_users', company_id] });
    qc.invalidateQueries({ queryKey: ['company', company_id] });
    qc.invalidateQueries({ queryKey: ['branch_restricted'] });
    refreshSaved();
  };
  const setAccess = useMutation({
    mutationFn: (v: { p: string; access: 'unrestricted' | 'restricted' }) => ad.branches.setAccess(v.p, v.access),
    onSuccess: refreshAccess, onError: fail,
  });
  const setEnforcement = useMutation({
    mutationFn: (on: boolean) => ad.branches.setEnforcement(company_id, on), onSuccess: refreshAccess, onError: fail,
  });
  const label = (b: BranchRow) => (ar && b.name_ar ? b.name_ar : b.name);
  const active = branches.filter((b) => b.is_active);

  return (
    <div className="sb-gc" data-testid="branches-manager">
      <section className="sb-gc-sec">
        <h3 className="sb-gc-h">{t('global_config.branches.title')}</h3>
        <ul className="sb-gc-list">
          {branches.map((b) => (
            <li key={b.id} data-branch={b.code} className={`sb-gc-item ${b.is_active ? '' : 'is-off'}`}>
              <span className="sb-gc-inline">
                <bdi dir="ltr" className="sb-gc-code">{b.code}</bdi>
                <span>{label(b)}</span>
                {b.is_default && <span className="sb-gc-tag is-brand">{t('global_config.branches.default')}</span>}
                {!b.is_active && <span className="sb-gc-tag">{t('global_config.branches.inactive')}</span>}
              </span>
              {canSettings && !b.is_default && (
                <button type="button" className={btnGhost} disabled={toggle.isPending} onClick={() => toggle.mutate(b)}>
                  {b.is_active ? t('global_config.branches.deactivate') : t('global_config.branches.activate')}
                </button>
              )}
            </li>
          ))}
        </ul>
        {canSettings ? (
          <div className="sb-gc-addrow">
            <input className={input} value={name} maxLength={120} placeholder={t('global_config.branches.name')} data-testid="new-branch"
              onChange={(e) => setName(e.target.value)} />
            <button type="button" className={btn} disabled={!name.trim() || create.isPending} onClick={() => create.mutate()} data-testid="add-branch">
              {t('global_config.branches.add')}
            </button>
          </div>
        ) : <p className="sb-gc-fine">{t('global_config.branches.need_settings')}</p>}
      </section>

      {showWarehouses && (
        <section className="sb-gc-sec">
          <h3 className="sb-gc-h">{t('global_config.branches.warehouses')}</h3>
          <ul className="sb-gc-list">
            {warehouses.map((w) => {
              const current = (w as { branch_id?: string | null }).branch_id ?? '';
              return (
                <li key={w.id} className="sb-gc-item">
                  <span>{ar && w.name_ar ? w.name_ar : w.name}</span>
                  <select aria-label={t('global_config.branches.warehouse_branch')} value={current} disabled={!canSettings || move.isPending}
                    data-warehouse={w.code} className="sb-gc-select is-sm"
                    onChange={(e) => move.mutate({ w: w.id, b: e.target.value })}>
                    {active.concat(branches.filter((b) => !b.is_active && b.id === current)).map((b) => (
                      <option key={b.id} value={b.id}>{label(b)}</option>
                    ))}
                  </select>
                </li>
              );
            })}
          </ul>
        </section>
      )}

      <section className="sb-gc-sec">
        <h3 className="sb-gc-h">{t('global_config.branches.users')}</h3>
        {showAccess ? (
          <div className="sb-gc-box" data-testid="branch-enforcement">
            <p className="sb-gc-fine">{t('global_config.branch_access.explain')}</p>
            <label className="sb-gc-check">
              <input type="checkbox" data-testid="enforce-switch" checked={enforced} disabled={!isAdmin || setEnforcement.isPending}
                onChange={(e) => {
                  if (e.target.checked && !window.confirm(t('global_config.branch_access.enforce_confirm'))) return;
                  setEnforcement.mutate(e.target.checked);
                }} />
              <strong>{t('global_config.branch_access.enforce')}</strong>
              <span className={`sb-gc-tag ${enforced ? 'is-warn' : ''}`}>
                {enforced ? t('global_config.branch_access.enforce_on') : t('global_config.branch_access.enforce_off')}
              </span>
            </label>
            {!isAdmin && <p className="sb-gc-fine">{t('global_config.branch_access.admin_only')}</p>}
          </div>
        ) : (
          <p className="sb-gc-fine" data-testid="not-restricted">{t('global_config.branches.not_restricted')}</p>
        )}
        <ul className="sb-gc-list">
          {users.map((u) => {
            const mine = assignments.filter((a) => a.profile_id === u.id).map((a) => a.branch_id);
            return (
              <li key={u.id} data-user={u.email ?? u.id} className="sb-gc-item is-stack">
                <div className="sb-gc-user">
                  <span className="sb-gc-user-name">{u.full_name || u.email}</span>
                  <span className="sb-gc-inline">
                    <span className="sb-gc-tag">{roleName(u.role)}</span>
                    {showAccess && (u.role === 'admin' ? (
                      <span className="sb-gc-tag">{t('global_config.branch_access.admin_always')}</span>
                    ) : (
                      <select aria-label={t('global_config.branch_access.access')} data-access={u.email ?? u.id}
                        className="sb-gc-select is-sm"
                        value={(u as { branch_access?: string }).branch_access === 'restricted' ? 'restricted' : 'unrestricted'}
                        disabled={!isAdmin || setAccess.isPending}
                        onChange={(e) => setAccess.mutate({ p: u.id, access: e.target.value as 'unrestricted' | 'restricted' })}>
                        <option value="unrestricted">{t('global_config.branch_access.unrestricted')}</option>
                        <option value="restricted">{t('global_config.branch_access.restricted')}</option>
                      </select>
                    ))}
                  </span>
                </div>
                {showAccess && u.role !== 'admin' && (u as { branch_access?: string }).branch_access === 'restricted' && mine.length === 0 && (
                  <p className="sb-gc-warn" data-testid="zero-branches">{t('global_config.branch_access.zero_branches')}</p>
                )}
                <div className="sb-gc-ubranches" aria-label={t('global_config.branches.user_branches')}>
                  {active.map((b) => (
                    <label key={b.id} className={`sb-gc-pick ${mine.includes(b.id) ? 'is-on' : ''}`}>
                      <input type="checkbox" checked={mine.includes(b.id)} disabled={!canUsers || assign.isPending}
                        onChange={(e) => assign.mutate({ p: u.id, ids: e.target.checked ? [...mine, b.id] : mine.filter((x) => x !== b.id) })} />
                      {label(b)}
                    </label>
                  ))}
                </div>
              </li>
            );
          })}
        </ul>
        {!canUsers && <p className="sb-gc-fine">{t('global_config.branches.need_users')}</p>}
        <p className="sb-gc-fine">{t('global_config.branches.invite')}</p>
      </section>
      {error && <p className="sb-gc-err">{error}</p>}
      {saved && !error && <p role="status" data-testid="branches-saved" className="sb-gc-ok">{t('global_config.branches.saved')}</p>}
    </div>
  );
}
