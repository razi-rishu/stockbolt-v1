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
import { PageHeader } from '@/ui/primitives';
import { Button } from '@/ui/button';
import { Modal } from '@/ui/modal';
import { theme } from '@/ui/theme';
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

const card: React.CSSProperties = {
  background: '#fff', border: `1px solid ${theme.border}`, borderRadius: theme.radiusLg,
  boxShadow: theme.shadowSm, overflow: 'hidden',
};
const th: React.CSSProperties = {
  fontSize: '11px', fontWeight: 600, color: theme.inkMuted, textTransform: 'uppercase',
  letterSpacing: '.06em', textAlign: 'start', padding: '10px 16px', whiteSpace: 'nowrap',
};
const td: React.CSSProperties = { padding: '10px 16px', fontSize: '13px', color: theme.ink };
const roleSelect: React.CSSProperties = {
  fontSize: '12px', padding: '5px 8px', borderRadius: theme.radius,
  border: `1px solid ${theme.border}`, background: '#fff', color: theme.ink, cursor: 'pointer',
};

export default function UsersRolesPage() {
  const { company_id, user_id } = useAuthStore();
  const qc = useQueryClient();

  const [email, setEmail] = useState('');
  const [inviteRole, setInviteRole] = useState<string>('sales');
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [roleModal, setRoleModal] = useState<{ open: boolean; editing: RoleRow | null }>({ open: false, editing: null });
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
    onSuccess: () => { setNotice(`Invitation created for ${email.trim()}. Ask them to sign up with this email.`); setError(null); setEmail(''); refresh(); }, onError: fail,
  });
  const revoke = useMutation({ mutationFn: (id: string) => getAdapter().users.revokeInvite(id), onSuccess: () => { setError(null); refresh(); }, onError: fail });
  const setRole = useMutation({ mutationFn: (v: { id: string; role: string }) => getAdapter().users.setRole(v.id, v.role as AppRole), onSuccess: () => { setError(null); refresh(); }, onError: fail });
  const setActive = useMutation({ mutationFn: (v: { id: string; active: boolean }) => getAdapter().users.setActive(v.id, v.active), onSuccess: () => { setError(null); refresh(); }, onError: fail });
  const delRole = useMutation({ mutationFn: (key: string) => getAdapter().users.deleteRole(key), onSuccess: () => { setError(null); refresh(); }, onError: fail });

  const users = usersQ.data ?? [];
  const invites = invitesQ.data ?? [];
  const roles = rolesQ.data ?? [];
  const activeAdmins = users.filter(u => u.role === 'admin' && u.is_active).length;
  const roleName = (key: string) => roles.find(r => r.key === key)?.name ?? key;
  const roleOptions = roles.map(r => ({ value: r.key, label: r.name }));
  const permsByRole = (() => {
    const m = new Map<string, Set<string>>();
    for (const rp of (rolePermsQ.data ?? [])) {
      if (!m.has(rp.role)) m.set(rp.role, new Set());
      m.get(rp.role)!.add(rp.permission);
    }
    return m;
  })();

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
      <PageHeader title="Users & Roles" subtitle="Invite teammates, assign roles, and define what each role can access." />

      {error && <div style={{ background: theme.dangerSoft, border: `1px solid ${theme.dangerBorder}`, color: theme.danger, borderRadius: theme.radiusLg, padding: '10px 14px', fontSize: '13px' }}>{error}</div>}
      {notice && <div style={{ background: theme.successSoft, border: `1px solid ${theme.successBorder}`, color: theme.success, borderRadius: theme.radiusLg, padding: '10px 14px', fontSize: '13px' }}>{notice}</div>}

      {/* Invite */}
      <div style={{ ...card, padding: '16px' }}>
        <div style={{ fontSize: '13px', fontWeight: 700, color: theme.ink, marginBottom: '10px' }}>Invite a teammate</div>
        <form onSubmit={(e) => { e.preventDefault(); if (email.trim()) invite.mutate(); }} style={{ display: 'flex', gap: '10px', flexWrap: 'wrap', alignItems: 'center' }}>
          <input type="email" required placeholder="name@company.com" value={email} onChange={(e) => setEmail(e.target.value)}
            style={{ flex: '1 1 240px', minWidth: '200px', padding: '8px 10px', fontSize: '13px', border: `1px solid ${theme.border}`, borderRadius: theme.radius, color: theme.ink }} />
          <select value={inviteRole} onChange={(e) => setInviteRole(e.target.value)} style={{ ...roleSelect, padding: '8px 10px', fontSize: '13px' }}>
            {roleOptions.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
          <Button type="submit" disabled={invite.isPending || !email.trim()}>{invite.isPending ? 'Inviting…' : 'Send invite'}</Button>
        </form>
      </div>

      {/* Members */}
      <div style={card}>
        <div style={{ padding: '12px 16px', borderBottom: `1px solid ${theme.border}`, fontSize: '12px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.06em', color: theme.inkMuted }}>Members ({users.length})</div>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead><tr style={{ background: theme.panelHead }}><th style={th}>Name</th><th style={th}>Email</th><th style={th}>Role</th><th style={th}>Status</th><th style={th}></th></tr></thead>
          <tbody>
            {users.map((u, i) => {
              const isSelf = u.id === user_id;
              const isLastAdmin = u.role === 'admin' && u.is_active && activeAdmins <= 1;
              return (
                <tr key={u.id} style={{ borderTop: i === 0 ? 'none' : `1px solid ${theme.muted}` }}>
                  <td style={{ ...td, fontWeight: 600 }}>{u.full_name}{isSelf && <span style={{ color: theme.inkFaint, fontWeight: 400 }}> (you)</span>}</td>
                  <td style={{ ...td, color: theme.inkMuted }}>{u.email}</td>
                  <td style={td}>
                    <select value={u.role} disabled={isLastAdmin || setRole.isPending} title={isLastAdmin ? 'Cannot change the last admin' : undefined}
                      onChange={(e) => setRole.mutate({ id: u.id, role: e.target.value })} style={roleSelect}>
                      {/* ensure the member's current role is selectable even if it's an unknown key */}
                      {!roleOptions.some(o => o.value === u.role) && <option value={u.role}>{roleName(u.role)}</option>}
                      {roleOptions.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                    </select>
                  </td>
                  <td style={td}><span style={{ fontSize: '11px', fontWeight: 600, padding: '2px 8px', borderRadius: '999px', background: u.is_active ? theme.successSoft : theme.muted, color: u.is_active ? theme.success : theme.inkMuted, border: `1px solid ${u.is_active ? theme.successBorder : theme.border}` }}>{u.is_active ? 'Active' : 'Disabled'}</span></td>
                  <td style={{ ...td, textAlign: 'end', whiteSpace: 'nowrap' }}>
                    {u.role !== 'admin' && (
                      <button onClick={() => setOverrideUser(u)}
                        title="Allow or deny specific options for this person on top of their role"
                        style={{ fontSize: '12px', fontWeight: 600, background: 'none', border: 'none', color: theme.brand, cursor: 'pointer', marginInlineEnd: '10px' }}>
                        Customize
                      </button>
                    )}
                    <button onClick={() => setActive.mutate({ id: u.id, active: !u.is_active })} disabled={(isLastAdmin && u.is_active) || isSelf || setActive.isPending}
                      title={isSelf ? 'You cannot disable yourself' : isLastAdmin ? 'Cannot disable the last admin' : undefined}
                      style={{ fontSize: '12px', fontWeight: 600, background: 'none', border: 'none', color: (isSelf || (isLastAdmin && u.is_active)) ? theme.inkFaint : (u.is_active ? theme.danger : theme.success), cursor: (isSelf || (isLastAdmin && u.is_active)) ? 'not-allowed' : 'pointer' }}>
                      {u.is_active ? 'Disable' : 'Enable'}</button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Pending invites */}
      {invites.length > 0 && (
        <div style={card}>
          <div style={{ padding: '12px 16px', borderBottom: `1px solid ${theme.border}`, fontSize: '12px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.06em', color: theme.inkMuted }}>Pending invites ({invites.length})</div>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead><tr style={{ background: theme.panelHead }}><th style={th}>Email</th><th style={th}>Role</th><th style={th}>Invited</th><th style={th}></th></tr></thead>
            <tbody>
              {invites.map((inv, i) => (
                <tr key={inv.id} style={{ borderTop: i === 0 ? 'none' : `1px solid ${theme.muted}` }}>
                  <td style={td}>{inv.email}</td><td style={td}>{roleName(inv.role)}</td>
                  <td style={{ ...td, color: theme.inkMuted }}>{formatDate(inv.created_at)}</td>
                  <td style={{ ...td, textAlign: 'end' }}><button onClick={() => revoke.mutate(inv.id)} disabled={revoke.isPending} style={{ fontSize: '12px', fontWeight: 600, background: 'none', border: 'none', color: theme.danger, cursor: 'pointer' }}>Revoke</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Roles */}
      <div style={card}>
        <div style={{ padding: '12px 16px', borderBottom: `1px solid ${theme.border}`, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <span style={{ fontSize: '12px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.06em', color: theme.inkMuted }}>Roles ({roles.length})</span>
          <button onClick={() => setRoleModal({ open: true, editing: null })} style={{ fontSize: '12px', fontWeight: 700, color: theme.brand, background: 'none', border: 'none', cursor: 'pointer' }}>+ New role</button>
        </div>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead><tr style={{ background: theme.panelHead }}><th style={th}>Role</th><th style={th}>Type</th><th style={th}>Members</th><th style={th}>Permissions</th><th style={th}></th></tr></thead>
          <tbody>
            {roles.map((r, i) => {
              const count = users.filter(u => u.role === r.key).length;
              const perms = r.key === 'admin' ? ['everything'] : [...(permsByRole.get(r.key) ?? [])];
              return (
                <tr key={r.id} style={{ borderTop: i === 0 ? 'none' : `1px solid ${theme.muted}` }}>
                  <td style={{ ...td, fontWeight: 600 }}>{r.name}</td>
                  <td style={td}><span style={{ fontSize: '11px', fontWeight: 600, padding: '2px 8px', borderRadius: '999px', background: r.is_system ? theme.muted : theme.brandSoft, color: r.is_system ? theme.inkMuted : theme.brandSoftText, border: `1px solid ${r.is_system ? theme.border : theme.purpleBorder}` }}>{r.is_system ? 'System' : 'Custom'}</span></td>
                  <td style={{ ...td, color: theme.inkMuted }}>{count}</td>
                  <td style={{ ...td, color: theme.inkMuted, fontSize: '12px' }}>{perms.length === 0 ? '—' : `${perms.length} permission${perms.length === 1 ? '' : 's'}`}</td>
                  <td style={{ ...td, textAlign: 'end' }}>
                    {!r.is_system && (
                      <>
                        <button onClick={() => setRoleModal({ open: true, editing: r })} style={{ fontSize: '12px', fontWeight: 600, color: theme.brand, background: 'none', border: 'none', cursor: 'pointer', marginInlineEnd: '10px' }}>Edit</button>
                        <button onClick={() => { if (count > 0) { setError(`"${r.name}" is assigned to ${count} member(s) — reassign them first.`); return; } delRole.mutate(r.key); }} style={{ fontSize: '12px', fontWeight: 600, color: theme.danger, background: 'none', border: 'none', cursor: 'pointer' }}>Delete</button>
                      </>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <p style={{ fontSize: '12px', color: theme.inkFaint }}>Invited teammates sign up with the same email and are auto-added to your company with the role you chose. System roles can't be edited; build a custom role to fine-tune access.</p>

      {roleModal.open && (
        <RoleEditorModal
          editing={roleModal.editing}
          initialPerms={roleModal.editing ? [...(permsByRole.get(roleModal.editing.key) ?? [])] : []}
          onClose={() => setRoleModal({ open: false, editing: null })}
          onSaved={() => { setRoleModal({ open: false, editing: null }); setError(null); refresh(); }}
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
    </div>
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
  const [effective, setEffective] = useState<Set<string>>(new Set(baseline));
  const ovQ = useQuery({ queryKey: ['user_overrides', user.id], queryFn: () => getAdapter().users.getUserOverrides(user.id) });

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
    <Modal open onClose={onClose} title={`Customize access — ${user.full_name}`}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
        <p style={{ fontSize: '12.5px', color: theme.inkMuted, margin: 0 }}>
          Base role: <strong style={{ color: theme.ink }}>{roleName}</strong>. Tick to grant, untick to remove —
          anything different from the role becomes a personal override for {user.full_name.split(' ')[0]}.
        </p>
        <div style={{ border: `1px solid ${theme.border}`, borderRadius: theme.radiusLg, overflow: 'hidden' }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 70px 70px', background: theme.panelHead, padding: '8px 12px', fontSize: '11px', fontWeight: 700, color: theme.inkMuted, textTransform: 'uppercase', letterSpacing: '.05em' }}>
            <span>Module</span><span style={{ textAlign: 'center' }}>View</span><span style={{ textAlign: 'center' }}>Edit</span>
          </div>
          {PERM_GROUPS.map((g, i) => (
            <div key={g.module} style={{ display: 'grid', gridTemplateColumns: '1fr 70px 70px', alignItems: 'center', padding: '8px 12px', borderTop: i === 0 ? 'none' : `1px solid ${theme.muted}`, fontSize: '13px' }}>
              <span style={{ color: theme.ink }}>
                {g.module}
                {(effective.has(g.read) !== baseline.has(g.read) || (g.write != null && effective.has(g.write) !== baseline.has(g.write))) &&
                  <span style={{ marginInlineStart: '6px', fontSize: '10px', fontWeight: 700, color: theme.brandSoftText }}>● override</span>}
              </span>
              <span style={{ textAlign: 'center' }}><input type="checkbox" checked={effective.has(g.read)} onChange={(e) => setPerm(g.read, e.target.checked)} /></span>
              <span style={{ textAlign: 'center' }}>
                {g.write ? <input type="checkbox" checked={effective.has(g.write)} onChange={(e) => setWrite(g.read, g.write!, e.target.checked)} /> : <span style={{ color: theme.inkFaint }}>—</span>}
              </span>
            </div>
          ))}
        </div>
        <p style={{ fontSize: '11.5px', color: theme.inkFaint, margin: 0 }}>{diffCount === 0 ? 'No overrides — matches the role exactly.' : `${diffCount} override${diffCount === 1 ? '' : 's'} vs the role.`} User management stays Admin-only.</p>
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px' }}>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button onClick={() => save.mutate()} disabled={save.isPending || ovQ.isLoading}>{save.isPending ? 'Saving…' : 'Save overrides'}</Button>
        </div>
      </div>
    </Modal>
  );
}

// ── Create / edit a custom role ──────────────────────────────────────────────
function RoleEditorModal({ editing, initialPerms, onClose, onSaved, onError }: {
  editing: RoleRow | null;
  initialPerms: string[];
  onClose: () => void;
  onSaved: () => void;
  onError: (e: unknown) => void;
}) {
  const [name, setName] = useState(editing?.name ?? '');
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
    <Modal open onClose={onClose} title={editing ? `Edit role — ${editing.name}` : 'New custom role'}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
        <div>
          <label style={{ fontSize: '11px', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '.05em', color: theme.inkMuted }}>Role name</label>
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Warehouse Manager"
            style={{ width: '100%', marginTop: '4px', padding: '8px 10px', fontSize: '13px', border: `1px solid ${theme.border}`, borderRadius: theme.radius, color: theme.ink }} />
        </div>

        <div>
          <div style={{ fontSize: '11px', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '.05em', color: theme.inkMuted, marginBottom: '6px' }}>Permissions</div>
          <div style={{ border: `1px solid ${theme.border}`, borderRadius: theme.radiusLg, overflow: 'hidden' }}>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 70px 70px', background: theme.panelHead, padding: '8px 12px', fontSize: '11px', fontWeight: 700, color: theme.inkMuted, textTransform: 'uppercase', letterSpacing: '.05em' }}>
              <span>Module</span><span style={{ textAlign: 'center' }}>View</span><span style={{ textAlign: 'center' }}>Edit</span>
            </div>
            {PERM_GROUPS.map((g, i) => (
              <div key={g.module} style={{ display: 'grid', gridTemplateColumns: '1fr 70px 70px', alignItems: 'center', padding: '8px 12px', borderTop: i === 0 ? 'none' : `1px solid ${theme.muted}`, fontSize: '13px' }}>
                <span style={{ color: theme.ink }}>{g.module}</span>
                <span style={{ textAlign: 'center' }}>
                  <input type="checkbox" checked={perms.has(g.read)} onChange={(e) => toggle(g.read, e.target.checked)} />
                </span>
                <span style={{ textAlign: 'center' }}>
                  {g.write
                    ? <input type="checkbox" checked={perms.has(g.write)} onChange={(e) => toggleWrite(g.read, g.write!, e.target.checked)} />
                    : <span style={{ color: theme.inkFaint }}>—</span>}
                </span>
              </div>
            ))}
          </div>
          <p style={{ fontSize: '11.5px', color: theme.inkFaint, marginTop: '6px' }}>User management stays Admin-only and can't be granted to a custom role.</p>
        </div>

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px' }}>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button onClick={() => save.mutate()} disabled={save.isPending || !name.trim()}>{save.isPending ? 'Saving…' : (editing ? 'Save changes' : 'Create role')}</Button>
        </div>
      </div>
    </Modal>
  );
}
