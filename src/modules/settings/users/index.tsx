/**
 * Users & Roles (Phase 22 + 23) — admin-only team & role management.
 *
 *  • Members  — change role (system or custom), enable/disable, all via
 *    admin-gated RPCs with a last-admin guard.
 *  • Invites  — invite by email + role; the teammate self-signs-up to join.
 *  • Roles    — the 5 locked system roles + custom roles the admin builds with
 *    a module-permission checkbox matrix (users.manage is never grantable).
 *
 * Route is guarded by RequirePermission perm="users.manage".
 */
import { useEffect, useRef, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { getAdapter } from '@/data/index';
import { useAuthStore } from '@/store/auth';
import { formatDate } from '@/lib/locale';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { Modal } from '@/ui/modal';
import type { Column } from '@/ui/table';
import { OceanPage, OceanTable } from '@/components/ocean-list';
import { UserPlus, Users, MailOpen, ShieldCheck, Plus, Loader2 } from 'lucide-react';
import { type AppRole } from '@/lib/permissions';
import type { Profile, CompanyInviteRow, RoleRow } from '@/data/adapter';

// Permissions an admin may grant to a custom role (users.manage excluded).
const PERM_GROUPS: { module: string; read: string; write: string | null }[] = [
  { module: 'Sales',               read: 'sales.read',      write: 'sales.write' },
  { module: 'Purchasing',          read: 'purchasing.read', write: 'purchasing.write' },
  { module: 'Inventory',           read: 'inventory.read',  write: 'inventory.write' },
  { module: 'Accounting & Banking', read: 'accounting.read', write: 'accounting.write' },
  { module: 'Payroll',             read: 'payroll.read',    write: 'payroll.write' },
  { module: 'Reports',             read: 'reports.read',    write: null },
  { module: 'Settings',            read: 'settings.read',   write: 'settings.write' },
];

/** Module name for a permission group, translated (English module as fallback). */
const moduleLabel = (t: TFunction, g: { module: string; read: string }) =>
  t(`settingsPages.users.mod.${g.read.split('.')[0]}`, { defaultValue: g.module });

export default function UsersRolesPage() {
  const { company_id, user_id } = useAuthStore();
  const qc = useQueryClient();
  const { t } = useTranslation();

  const [email, setEmail] = useState('');
  const [inviteRole, setInviteRole] = useState<string>('sales');
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [roleModal, setRoleModal] = useState<
    | { open: false }
    | { open: true; mode: 'create' | 'edit' | 'view'; role: RoleRow | null; presetName?: string; presetPerms: string[] }
  >({ open: false });
  const [overrideUser, setOverrideUser] = useState<Profile | null>(null);

  const usersQ = useQuery<Profile[]>({ queryKey: ['users', company_id], queryFn: () => getAdapter().users.listUsers(company_id!), enabled: !!company_id });
  const invitesQ = useQuery<CompanyInviteRow[]>({ queryKey: ['user_invites', company_id], queryFn: () => getAdapter().users.listInvites(company_id!), enabled: !!company_id });
  const rolesQ = useQuery<RoleRow[]>({ queryKey: ['roles', company_id], queryFn: () => getAdapter().users.listRoles(), enabled: !!company_id });
  const rolePermsQ = useQuery({ queryKey: ['role_perms', company_id], queryFn: () => getAdapter().users.listRolePermissions(), enabled: !!company_id });

  const refresh = () => {
    ['users', 'user_invites', 'roles', 'role_perms'].forEach(k => qc.invalidateQueries({ queryKey: [k, company_id] }));
  };
  const fail = (e: unknown) => setError(e instanceof Error ? e.message : String(e));

  const invite = useMutation({
    mutationFn: () => getAdapter().users.inviteUser(email.trim(), inviteRole as AppRole),
    onSuccess: () => { setNotice(t('settingsPages.users.invited', { email: email.trim() })); setError(null); setEmail(''); refresh(); }, onError: fail,
  });
  const revoke = useMutation({ mutationFn: (id: string) => getAdapter().users.revokeInvite(id), onSuccess: () => { setError(null); refresh(); }, onError: fail });
  const setRole = useMutation({ mutationFn: (v: { id: string; role: string }) => getAdapter().users.setRole(v.id, v.role as AppRole), onSuccess: () => { setError(null); refresh(); }, onError: fail });
  const setActive = useMutation({ mutationFn: (v: { id: string; active: boolean }) => getAdapter().users.setActive(v.id, v.active), onSuccess: () => { setError(null); refresh(); }, onError: fail });
  const delRole = useMutation({ mutationFn: (key: string) => getAdapter().users.deleteRole(key), onSuccess: () => { setError(null); refresh(); }, onError: fail });

  const users = usersQ.data ?? [];
  const invites = invitesQ.data ?? [];
  const roles = rolesQ.data ?? [];
  const activeAdmins = users.filter(u => u.role === 'admin' && u.is_active).length;
  // System roles are shared rows with English names: show them translated by
  // key. Custom role names are the admin's own text and stay as typed.
  const displayName = (r: RoleRow) => (r.is_system ? t(`settingsPages.users.sys.${r.key}`, { defaultValue: r.name }) : r.name);
  const roleName = (key: string) => { const r = roles.find(x => x.key === key); return r ? displayName(r) : key; };
  const roleOptions = roles.map(r => ({ value: r.key, label: displayName(r) }));
  const permsByRole = (() => {
    const m = new Map<string, Set<string>>();
    for (const rp of (rolePermsQ.data ?? [])) {
      if (!m.has(rp.role)) m.set(rp.role, new Set());
      m.get(rp.role)!.add(rp.permission);
    }
    return m;
  })();

  const memberCols: Column<Profile>[] = [
    {
      key: 'name', header: t('settingsPages.users.name'),
      render: (u) => <span style={{ fontWeight: 700 }}>{u.full_name}{u.id === user_id && <span className="sb-fx-name"> ({t('settingsPages.users.you')})</span>}</span>,
    },
    { key: 'email', header: t('settingsPages.users.email'), render: (u) => <bdi dir="ltr" className="sb-fx-name">{u.email}</bdi> },
    {
      key: 'role', header: t('settingsPages.users.role'),
      render: (u) => {
        const isLastAdmin = u.role === 'admin' && u.is_active && activeAdmins <= 1;
        return (
          <select className="sb-field sb-users-select" value={u.role} disabled={isLastAdmin || setRole.isPending}
            aria-label={`${t('settingsPages.users.role')} — ${u.full_name}`}
            title={isLastAdmin ? t('settingsPages.users.last_admin_role') : undefined}
            onChange={(e) => setRole.mutate({ id: u.id, role: e.target.value })}>
            {/* ensure the member's current role is selectable even if it's an unknown key */}
            {!roleOptions.some(o => o.value === u.role) && <option value={u.role}>{roleName(u.role)}</option>}
            {roleOptions.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
        );
      },
    },
    { key: 'status', header: '', render: (u) => <span className={`sb-pill ${u.is_active ? 'sb-pill-good' : 'sb-pill-muted'}`}>{u.is_active ? t('common.active') : t('settingsPages.users.disabled')}</span> },
    {
      key: 'actions', header: '', align: 'end',
      render: (u) => {
        const isSelf = u.id === user_id;
        const isLastAdmin = u.role === 'admin' && u.is_active && activeAdmins <= 1;
        const blocked = isSelf || (isLastAdmin && u.is_active);
        return (
          <span className="sb-users-actions">
            {u.role !== 'admin' ? (
              <button type="button" className="sb-row-link text-brand-600" onClick={() => setOverrideUser(u)} title={t('settingsPages.users.customize_title')}>
                {t('settingsPages.users.customize')}
              </button>
            ) : (
              <span className="sb-fx-name" title={t('settingsPages.users.full_access_title')}>{t('settingsPages.users.full_access')}</span>
            )}
            <button type="button" className={`sb-row-link ${blocked ? '' : (u.is_active ? 'text-danger-500' : 'text-brand-600')}`}
              onClick={() => setActive.mutate({ id: u.id, active: !u.is_active })} disabled={(isLastAdmin && u.is_active) || isSelf || setActive.isPending}
              title={isSelf ? t('settingsPages.users.cannot_disable_self') : isLastAdmin ? t('settingsPages.users.cannot_disable_last') : undefined}>
              {u.is_active ? t('settingsPages.users.disable') : t('settingsPages.users.enable')}
            </button>
          </span>
        );
      },
    },
  ];

  const inviteCols: Column<CompanyInviteRow>[] = [
    { key: 'email', header: t('settingsPages.users.email'), render: (inv) => <bdi dir="ltr" style={{ fontWeight: 700 }}>{inv.email}</bdi> },
    { key: 'role', header: t('settingsPages.users.role'), render: (inv) => roleName(inv.role) },
    { key: 'date', header: t('settingsPages.users.invited_on'), render: (inv) => <bdi dir="ltr">{formatDate(inv.created_at)}</bdi> },
    {
      key: 'revoke', header: '', align: 'end',
      render: (inv) => <button type="button" className="sb-row-link text-danger-500" onClick={() => revoke.mutate(inv.id)} disabled={revoke.isPending}>{t('settingsPages.users.revoke')}</button>,
    },
  ];

  const roleCols: Column<RoleRow>[] = [
    {
      key: 'name', header: t('settingsPages.users.role'),
      render: (r) => (
        <button type="button" className="sb-row-link text-brand-600 is-strong" style={{ paddingInline: 0 }} onClick={() => openRole(r)}
          title={r.is_system ? t('settingsPages.users.view_role_title') : t('settingsPages.users.edit_role_title')}>
          {displayName(r)}
        </button>
      ),
    },
    { key: 'type', header: t('settingsPages.users.type'), render: (r) => <span className={`sb-pill ${r.is_system ? 'sb-pill-muted' : ''}`}>{r.is_system ? t('settingsPages.users.system') : t('settingsPages.users.custom')}</span> },
    { key: 'members', header: t('settingsPages.users.members_col'), render: (r) => <bdi dir="ltr">{users.filter(u => u.role === r.key).length}</bdi> },
    {
      key: 'perms', header: t('settingsPages.users.permissions'),
      render: (r) => {
        const n = r.key === 'admin' ? 1 : (permsByRole.get(r.key)?.size ?? 0);
        return n === 0 ? '—' : t('settingsPages.users.perm_count', { count: n });
      },
    },
    {
      key: 'actions', header: '', align: 'end',
      render: (r) => {
        const count = users.filter(u => u.role === r.key).length;
        const rolePerms = [...(permsByRole.get(r.key) ?? [])];
        return r.is_system ? (
          r.key !== 'admin' && (
            <button type="button" className="sb-row-link text-brand-600"
              onClick={() => setRoleModal({ open: true, mode: 'create', role: null, presetName: `${r.name} (${t('settingsPages.users.custom')})`, presetPerms: rolePerms })}
              title={t('settingsPages.users.duplicate_title')}>
              {t('settingsPages.users.duplicate')}
            </button>
          )
        ) : (
          <span className="sb-users-actions">
            <button type="button" className="sb-row-link text-brand-600" onClick={() => openRole(r)}>{t('common.edit')}</button>
            <button type="button" className="sb-row-link text-danger-500"
              onClick={() => { if (count > 0) { setError(t('settingsPages.users.role_in_use', { name: r.name, count })); return; } delRole.mutate(r.key); }}>
              {t('common.delete')}
            </button>
          </span>
        );
      },
    },
  ];

  function openRole(r: RoleRow) {
    const rolePerms = [...(permsByRole.get(r.key) ?? [])];
    setRoleModal(r.is_system
      ? { open: true, mode: 'view', role: r, presetPerms: rolePerms }
      : { open: true, mode: 'edit', role: r, presetPerms: rolePerms });
  }

  const sectionHead = (icon: React.ReactNode, title: string, count: number, action?: React.ReactNode) => (
    <div className="sb-users-head">
      <span className="sb-form-icon" aria-hidden="true">{icon}</span>
      <h2 className="sb-form-title" style={{ flex: 1 }}>{title} <span className="sb-tab-count">{count}</span></h2>
      {action}
    </div>
  );

  // Ocean Teal (UI v1.1): look only — same members, invites, roles, last-admin
  // and self guards, overrides and role editor as before.
  return (
    <OceanPage testid="users-ocean" title={t('settingsNav.items.users.title')} subtitle={t('settingsPages.users.subtitle')}>
      {error && <p className="sb-alert sb-alert-danger" role="alert">{error}</p>}
      {notice && <p className="sb-alert sb-alert-good" role="status">{notice}</p>}

      {/* Invite */}
      <section className="sb-card sb-form">
        <div className="sb-form-head">
          <span className="sb-form-icon" aria-hidden="true"><UserPlus size={20} /></span>
          <h2 className="sb-form-title">{t('settingsPages.users.invite_title')}</h2>
        </div>
        <form onSubmit={(e) => { e.preventDefault(); if (email.trim()) invite.mutate(); }} className="sb-users-invite">
          <input type="email" required dir="ltr" className="sb-field" placeholder="name@company.com" value={email}
            aria-label={t('settingsPages.users.email')} onChange={(e) => setEmail(e.target.value)} />
          <select className="sb-field" value={inviteRole} aria-label={t('settingsPages.users.role')} onChange={(e) => setInviteRole(e.target.value)}>
            {roleOptions.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
          <button type="submit" className="sb-primary-btn sb-btn-inline" disabled={invite.isPending || !email.trim()}>
            {invite.isPending ? <Loader2 size={18} className="sb-spin" aria-hidden="true" /> : <UserPlus size={18} aria-hidden="true" />}
            {invite.isPending ? t('settingsPages.users.inviting') : t('settingsPages.users.send_invite')}
          </button>
        </form>
      </section>

      {/* Members */}
      <section className="sb-section-card">
        {sectionHead(<Users size={20} />, t('settingsPages.users.members'), users.length)}
        <OceanTable wide columns={memberCols} rows={users} keyFn={(u) => u.id} rowMuted={(u) => !u.is_active} emptyMessage={t('common.loading')} />
      </section>

      {/* Pending invites */}
      {invites.length > 0 && (
        <section className="sb-section-card">
          {sectionHead(<MailOpen size={20} />, t('settingsPages.users.pending'), invites.length)}
          <OceanTable columns={inviteCols} rows={invites} keyFn={(inv) => inv.id} />
        </section>
      )}

      {/* Roles */}
      <section className="sb-section-card">
        {sectionHead(<ShieldCheck size={20} />, t('settingsPages.users.roles'), roles.length,
          <button type="button" className="sb-secondary-btn sb-btn-inline" onClick={() => setRoleModal({ open: true, mode: 'create', role: null, presetPerms: [] })}>
            <Plus size={18} aria-hidden="true" />{t('settingsPages.users.new_role')}
          </button>)}
        <OceanTable columns={roleCols} rows={roles} keyFn={(r) => r.id} />
      </section>

      <p className="sb-form-hint">{t('settingsPages.users.footer')}</p>

      {roleModal.open && (
        <RoleEditorModal
          mode={roleModal.mode}
          role={roleModal.role}
          presetName={roleModal.presetName}
          initialPerms={roleModal.presetPerms}
          onDuplicate={(name, permsList) => setRoleModal({ open: true, mode: 'create', role: null, presetName: name, presetPerms: permsList })}
          onClose={() => setRoleModal({ open: false })}
          onSaved={() => { setRoleModal({ open: false }); setError(null); refresh(); }}
          onError={fail}
        />
      )}

      {overrideUser && (
        <UserOverridesModal
          user={overrideUser}
          roleName={roleName(overrideUser.role)}
          baseline={permsByRole.get(overrideUser.role) ?? new Set()}
          onClose={() => setOverrideUser(null)}
          onSaved={() => { setOverrideUser(null); setError(null); refresh(); }}
          onError={fail}
        />
      )}
    </OceanPage>
  );
}

// ── Per-user permission overrides (allow/deny on top of the role) ────────────
function UserOverridesModal({ user, roleName, baseline, onClose, onSaved, onError }: {
  user: Profile;
  roleName: string;
  baseline: Set<string>;
  onClose: () => void;
  onSaved: () => void;
  onError: (e: unknown) => void;
}) {
  // Effective = (role baseline ∪ allow) − deny. Start from baseline, then apply
  // the user's existing overrides once they load.
  const { t } = useTranslation();
  const [effective, setEffective] = useState<Set<string>>(new Set(baseline));
  // gcTime 0: the overrides are applied once (below), so they must be the
  // fresh ones — a cached copy from an earlier open would hide a save made
  // since, and saving again would overwrite it with the stale set.
  const ovQ = useQuery({ queryKey: ['user_overrides', user.id], queryFn: () => getAdapter().users.getUserOverrides(user.id), gcTime: 0 });

  // Apply loaded overrides to the baseline exactly once.
  const applied = useRef(false);
  useEffect(() => {
    if (applied.current || !ovQ.data) return;
    applied.current = true;
    const next = new Set(baseline);
    for (const o of ovQ.data) { if (o.mode === 'allow') next.add(o.permission); else next.delete(o.permission); }
    setEffective(next);
  }, [ovQ.data, baseline]);

  const setPerm = (p: string, on: boolean) => setEffective(prev => { const n = new Set(prev); if (on) n.add(p); else n.delete(p); return n; });
  const setWrite = (read: string, write: string, on: boolean) => setEffective(prev => { const n = new Set(prev); if (on) { n.add(write); n.add(read); } else n.delete(write); return n; });

  const save = useMutation({
    mutationFn: () => {
      const allow: string[] = [];
      const deny: string[] = [];
      for (const g of PERM_GROUPS) {
        for (const p of [g.read, g.write].filter(Boolean) as string[]) {
          const want = effective.has(p);
          const base = baseline.has(p);
          if (want && !base) allow.push(p);
          else if (!want && base) deny.push(p);
        }
      }
      return getAdapter().users.setUserOverrides(user.id, allow, deny);
    },
    onSuccess: onSaved,
    onError,
  });

  const diffCount = (() => {
    let n = 0;
    for (const g of PERM_GROUPS) for (const p of [g.read, g.write].filter(Boolean) as string[]) if (effective.has(p) !== baseline.has(p)) n++;
    return n;
  })();

  return (
    <Modal open onClose={onClose} title={t('settingsPages.users.customize_modal', { name: user.full_name })}>
      <div className="sb-ocean sb-form sb-modal-form">
        <p className="sb-form-hint" style={{ margin: 0 }}>
          {t('settingsPages.users.base_role')} <strong style={{ color: 'var(--sb-text)' }}>{roleName}</strong>. {t('settingsPages.users.override_hint', { name: user.full_name.split(' ')[0] })}
        </p>
        <PermMatrix
          t={t}
          has={(p) => effective.has(p)}
          onRead={(g, on) => setPerm(g.read, on)}
          onWrite={(g, on) => setWrite(g.read, g.write!, on)}
          marker={(g) => (effective.has(g.read) !== baseline.has(g.read) || (g.write != null && effective.has(g.write) !== baseline.has(g.write)))}
        />
        <p className="sb-form-hint" style={{ margin: 0 }}>
          {diffCount === 0 ? t('settingsPages.users.no_overrides') : t('settingsPages.users.override_count', { count: diffCount })} {t('settingsPages.users.admin_only')}
        </p>
        <div className="sb-form-actions">
          <button type="button" className="sb-secondary-btn" onClick={onClose}>{t('common.cancel')}</button>
          <button type="button" className="sb-primary-btn" onClick={() => save.mutate()} disabled={save.isPending || ovQ.isLoading}>
            {save.isPending ? t('common.saving') : t('settingsPages.users.save_overrides')}
          </button>
        </div>
      </div>
    </Modal>
  );
}

/** View / Edit checkbox matrix shared by the role editor and member overrides. */
function PermMatrix({ t, has, onRead, onWrite, marker, readOnly }: {
  t: TFunction;
  has: (p: string) => boolean;
  onRead: (g: typeof PERM_GROUPS[number], on: boolean) => void;
  onWrite: (g: typeof PERM_GROUPS[number], on: boolean) => void;
  marker?: (g: typeof PERM_GROUPS[number]) => boolean;
  readOnly?: boolean;
}) {
  return (
    <div className="sb-perm">
      <div className="sb-perm-row sb-perm-head">
        <span>{t('settingsPages.users.module')}</span><span>{t('settingsPages.users.view')}</span><span>{t('settingsPages.users.edit')}</span>
      </div>
      {PERM_GROUPS.map((g) => (
        <div key={g.module} className="sb-perm-row">
          <span>
            {moduleLabel(t, g)}
            {marker?.(g) && <span className="sb-pill" style={{ marginInlineStart: 8, fontSize: 11 }}>{t('settingsPages.users.override')}</span>}
          </span>
          <span><input type="checkbox" checked={has(g.read)} disabled={readOnly} aria-label={`${moduleLabel(t, g)} — ${t('settingsPages.users.view')}`} onChange={(e) => onRead(g, e.target.checked)} /></span>
          <span>
            {g.write
              ? <input type="checkbox" checked={has(g.write)} disabled={readOnly} aria-label={`${moduleLabel(t, g)} — ${t('settingsPages.users.edit')}`} onChange={(e) => onWrite(g, e.target.checked)} />
              : <span className="sb-fx-name">—</span>}
          </span>
        </div>
      ))}
    </div>
  );
}

// ── Create / edit / view a role ──────────────────────────────────────────────
// mode 'view' shows a system role's matrix read-only with a
// "Duplicate & customize" action that reopens the modal in create mode.
function RoleEditorModal({ mode, role, presetName, initialPerms, onDuplicate, onClose, onSaved, onError }: {
  mode: 'create' | 'edit' | 'view';
  role: RoleRow | null;
  presetName?: string;
  initialPerms: string[];
  onDuplicate: (name: string, perms: string[]) => void;
  onClose: () => void;
  onSaved: () => void;
  onError: (e: unknown) => void;
}) {
  const { t } = useTranslation();
  const editing = mode === 'edit' ? role : null;
  const readOnly = mode === 'view';
  const [name, setName] = useState(editing?.name ?? presetName ?? (readOnly ? role?.name ?? '' : ''));
  const [perms, setPerms] = useState<Set<string>>(new Set(initialPerms));

  const toggle = (p: string, on: boolean) => {
    setPerms(prev => {
      const next = new Set(prev);
      if (on) next.add(p); else next.delete(p);
      return next;
    });
  };
  // Write implies read.
  const toggleWrite = (read: string, write: string, on: boolean) => {
    setPerms(prev => {
      const next = new Set(prev);
      if (on) { next.add(write); next.add(read); } else next.delete(write);
      return next;
    });
  };

  const save = useMutation({
    mutationFn: () => {
      const list = [...perms];
      return editing
        ? getAdapter().users.updateRole(editing.key, name.trim(), list)
        : getAdapter().users.createRole(name.trim(), list).then(() => undefined);
    },
    onSuccess: onSaved,
    onError,
  });

  return (
    <Modal open onClose={onClose} title={
      readOnly ? t('settingsPages.users.role_view_title', { name: role?.name ?? '' })
      : editing ? t('settingsPages.users.role_edit_title', { name: editing.name })
      : t('settingsPages.users.role_new_title')
    }>
      <div className="sb-ocean sb-form sb-modal-form">
        {readOnly && <p className="sb-info-note">{t('settingsPages.users.system_note')}</p>}
        <label className="sb-select-field" style={{ maxWidth: 'none' }}>
          <span className="sb-select-label">{t('settingsPages.users.role_name')}</span>
          <input className="sb-field" value={name} onChange={(e) => setName(e.target.value)} placeholder={t('settingsPages.users.role_name_ph')} disabled={readOnly} />
        </label>

        <div>
          <div className="sb-select-label" style={{ marginBottom: 6 }}>{t('settingsPages.users.permissions')}</div>
          <PermMatrix
            t={t}
            readOnly={readOnly}
            has={(p) => perms.has(p)}
            onRead={(g, on) => toggle(g.read, on)}
            onWrite={(g, on) => toggleWrite(g.read, g.write!, on)}
          />
          <p className="sb-form-hint" style={{ marginTop: 6 }}>{t('settingsPages.users.admin_only_role')}</p>
        </div>

        <div className="sb-form-actions">
          <button type="button" className="sb-secondary-btn" onClick={onClose}>{readOnly ? t('common.close') : t('common.cancel')}</button>
          {readOnly ? (
            role?.key !== 'admin' && (
              <button type="button" className="sb-primary-btn" onClick={() => onDuplicate(`${role?.name ?? 'Role'} (${t('settingsPages.users.custom')})`, [...perms])}>
                {t('settingsPages.users.duplicate')}
              </button>
            )
          ) : (
            <button type="button" className="sb-primary-btn" onClick={() => save.mutate()} disabled={save.isPending || !name.trim()}>
              {save.isPending ? t('common.saving') : (editing ? t('settingsPages.users.save_changes') : t('settingsPages.users.create_role'))}
            </button>
          )}
        </div>
      </div>
    </Modal>
  );
}
