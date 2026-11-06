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
import { Badge } from '@/ui/badge';
import { getAdapter } from '@/data/index';
import type { BranchRow } from '@/data/adapter';

const input = 'w-full rounded-pill border border-border-subtle bg-surface-card px-3 py-1.5 text-sm';
const btn = 'rounded-pill bg-brand-500 px-3 py-1.5 text-xs text-white disabled:opacity-50';
const btnGhost = 'rounded-pill bg-surface-muted px-3 py-1.5 text-xs text-ink-secondary disabled:opacity-50';

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
    <div className="space-y-3 text-sm">
      <label className="block">
        <span className="text-ink-secondary">{t('global_config.branches.head_office_name')}</span>
        <input className={input} value={value.head_office} maxLength={120} data-testid="head-office"
          onChange={(e) => onChange({ ...value, head_office: e.target.value })} />
      </label>
      {showWarehouse && (
        <label className="block">
          <span className="text-ink-secondary">{t('global_config.branches.main_warehouse')}</span>
          <input className={input} value={value.main_warehouse} maxLength={120} data-testid="main-warehouse"
            onChange={(e) => onChange({ ...value, main_warehouse: e.target.value })} />
        </label>
      )}
      <div>
        <span className="text-ink-secondary">{t('global_config.branches.extra')}</span>
        <ul className="mt-1 space-y-1">
          {value.extra.map((b, i) => (
            <li key={`${b}-${i}`} className="flex items-center justify-between gap-2 rounded-card border border-border-subtle px-3 py-1.5">
              <span>{b}</span>
              <button type="button" className={btnGhost} onClick={() => onChange({ ...value, extra: value.extra.filter((_, j) => j !== i) })}>
                {t('global_config.branches.remove')}
              </button>
            </li>
          ))}
        </ul>
        <div className="mt-2 flex gap-2">
          <input className={input} value={next} maxLength={120} placeholder={t('global_config.branches.name')} data-testid="extra-branch"
            onChange={(e) => setNext(e.target.value)} />
          <button type="button" className={btn} disabled={!next.trim() || value.extra.length >= 20} data-testid="add-extra-branch"
            onClick={() => { onChange({ ...value, extra: [...value.extra, next.trim()] }); setNext(''); }}>
            {t('global_config.branches.add')}
          </button>
        </div>
      </div>
      <p className="text-xs text-ink-tertiary">{t('global_config.branches.not_restricted')}</p>
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
  const label = (b: BranchRow) => (ar && b.name_ar ? b.name_ar : b.name);
  const active = branches.filter((b) => b.is_active);

  return (
    <div className="space-y-5 text-sm" data-testid="branches-manager">
      <section>
        <h3 className="mb-2 font-semibold text-ink-primary">{t('global_config.branches.title')}</h3>
        <ul className="space-y-1">
          {branches.map((b) => (
            <li key={b.id} data-branch={b.code} className="flex flex-wrap items-center justify-between gap-2 rounded-card border border-border-subtle px-3 py-2">
              <span className="flex items-center gap-2">
                <span dir="ltr" className="font-mono text-xs text-ink-tertiary">{b.code}</span>
                <span>{label(b)}</span>
                {b.is_default && <Badge variant="brand">{t('global_config.branches.default')}</Badge>}
                {!b.is_active && <Badge variant="muted">{t('global_config.branches.inactive')}</Badge>}
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
          <div className="mt-2 flex gap-2">
            <input className={input} value={name} maxLength={120} placeholder={t('global_config.branches.name')} data-testid="new-branch"
              onChange={(e) => setName(e.target.value)} />
            <button type="button" className={btn} disabled={!name.trim() || create.isPending} onClick={() => create.mutate()} data-testid="add-branch">
              {t('global_config.branches.add')}
            </button>
          </div>
        ) : <p className="mt-2 text-xs text-ink-tertiary">{t('global_config.branches.need_settings')}</p>}
      </section>

      {showWarehouses && (
        <section>
          <h3 className="mb-2 font-semibold text-ink-primary">{t('global_config.branches.warehouses')}</h3>
          <ul className="space-y-1">
            {warehouses.map((w) => {
              const current = (w as { branch_id?: string | null }).branch_id ?? '';
              return (
                <li key={w.id} className="flex flex-wrap items-center justify-between gap-2 rounded-card border border-border-subtle px-3 py-2">
                  <span>{ar && w.name_ar ? w.name_ar : w.name}</span>
                  <select aria-label={t('global_config.branches.warehouse_branch')} value={current} disabled={!canSettings || move.isPending}
                    data-warehouse={w.code} className="rounded-pill border border-border-subtle bg-surface-card px-3 py-1 text-sm"
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

      <section>
        <h3 className="mb-2 font-semibold text-ink-primary">{t('global_config.branches.users')}</h3>
        <p className="mb-2 text-xs text-ink-tertiary" data-testid="not-restricted">{t('global_config.branches.not_restricted')}</p>
        <ul className="space-y-1">
          {users.map((u) => {
            const mine = assignments.filter((a) => a.profile_id === u.id).map((a) => a.branch_id);
            return (
              <li key={u.id} data-user={u.email ?? u.id} className="rounded-card border border-border-subtle px-3 py-2">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span>{u.full_name || u.email}</span>
                  <span className="text-xs text-ink-tertiary">{roleName(u.role)}</span>
                </div>
                <div className="mt-1 flex flex-wrap gap-3" aria-label={t('global_config.branches.user_branches')}>
                  {active.map((b) => (
                    <label key={b.id} className="flex items-center gap-1 text-xs">
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
        {!canUsers && <p className="mt-2 text-xs text-ink-tertiary">{t('global_config.branches.need_users')}</p>}
        <p className="mt-2 text-xs text-ink-tertiary">{t('global_config.branches.invite')}</p>
      </section>
      {error && <p className="text-xs text-danger-500">{error}</p>}
      {saved && !error && <p role="status" data-testid="branches-saved" className="text-xs text-success-500">{t('global_config.branches.saved')}</p>}
    </div>
  );
}
