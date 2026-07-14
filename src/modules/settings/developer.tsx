/**
 * Developer / API — Phase 49 (M-API 1).
 *
 * Where a company admin creates the API keys that let their own store / other
 * software connect to StockBolt. Keys are minted client-side (the raw secret is
 * shown once, then only its hash is stored), managed via the admin-gated RPCs.
 * Gated behind the plan feature `api_access` (Professional).
 */
import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { getAdapter } from '@/data/index';
import { Button } from '@/ui/button';
import { Modal } from '@/ui/modal';
import { Input } from '@/ui/input';
import { BackButton } from '@/ui/back-button';
import { theme } from '@/ui/theme';
import type { ApiScope, ApiKeyRow } from '@/data/adapter';

const SCOPES: { key: ApiScope; label: string; desc: string }[] = [
  { key: 'read',           label: 'Read',            desc: 'Pull products, contacts, invoices.' },
  { key: 'write:contacts', label: 'Write contacts',  desc: 'Create & update customers/suppliers.' },
  { key: 'write:orders',   label: 'Write orders',    desc: 'Create orders (post as draft invoices).' },
];

function fmtDate(s: string | null) {
  return s ? new Date(s).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' }) : '—';
}

export default function DeveloperSettingsPage() {
  const qc = useQueryClient();

  const { data: hasAccess, isLoading: accessLoading } = useQuery({
    queryKey: ['api_has_access'],
    queryFn: () => getAdapter().apiKeys.hasApiAccess(),
  });
  const { data: keys = [], isLoading: keysLoading } = useQuery({
    queryKey: ['api_keys'],
    queryFn: () => getAdapter().apiKeys.list(),
    enabled: hasAccess === true,
  });

  // Create-key modal state.
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [scopes, setScopes] = useState<ApiScope[]>(['read']);
  const [createdKey, setCreatedKey] = useState<string | null>(null); // shown once
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const createMutation = useMutation({
    mutationFn: () => getAdapter().apiKeys.create(name.trim(), scopes),
    onSuccess: (res) => {
      setCreatedKey(res.api_key);
      setName('');
      setScopes(['read']);
      qc.invalidateQueries({ queryKey: ['api_keys'] });
    },
    onError: (e: Error) => setError(e.message),
  });

  const revokeMutation = useMutation({
    mutationFn: (id: string) => getAdapter().apiKeys.revoke(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['api_keys'] }),
  });

  const toggleScope = (s: ApiScope) =>
    setScopes((prev) => (prev.includes(s) ? prev.filter((x) => x !== s) : [...prev, s]));

  const closeModal = () => {
    setOpen(false);
    setCreatedKey(null);
    setCopied(false);
    setError(null);
    setName('');
    setScopes(['read']);
  };

  const copyKey = async () => {
    if (!createdKey) return;
    try { await navigator.clipboard.writeText(createdKey); setCopied(true); } catch { /* clipboard blocked */ }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '16px', paddingBottom: '32px', maxWidth: '860px' }}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-col gap-2">
          <BackButton to="/settings" label="Settings" />
          <h1 className="text-xl font-semibold text-ink-primary">Developer &amp; API</h1>
          <p className="text-sm text-ink-secondary" style={{ maxWidth: '620px' }}>
            Create API keys so your online store or other software can connect to StockBolt and read your data or push orders.
            Treat keys like passwords — anyone with a key can act on your company's data within its scopes.
          </p>
        </div>
        {hasAccess && (
          <Button size="sm" onClick={() => { setError(null); setCreatedKey(null); setOpen(true); }}>
            + Create API key
          </Button>
        )}
      </div>

      {/* Plan gate */}
      {!accessLoading && hasAccess === false && (
        <div style={{
          background: theme.brandSoft, border: `1px solid ${theme.purpleBorder}`,
          borderRadius: '12px', padding: '20px',
        }}>
          <p style={{ margin: 0, fontSize: '14px', fontWeight: 700, color: theme.brandSoftText }}>
            🔒 API access is part of the Professional plan
          </p>
          <p style={{ margin: '6px 0 12px', fontSize: '13px', color: theme.brand }}>
            Upgrade your subscription to generate API keys and connect external apps.
          </p>
          <Link to="/settings/billing"><Button size="sm">View plans</Button></Link>
        </div>
      )}

      {/* Keys list */}
      {hasAccess && (
        <div className="overflow-x-auto bg-white" style={{ border: `1px solid ${theme.border}`, borderRadius: '12px', boxShadow: theme.shadowSm }}>
          {keysLoading ? (
            <p style={{ padding: '32px', textAlign: 'center', fontSize: '13px', color: theme.inkFaint }}>Loading…</p>
          ) : keys.length === 0 ? (
            <p style={{ padding: '40px 16px', textAlign: 'center', fontSize: '13px', color: theme.inkFaint }}>
              No API keys yet. Create one to start connecting.
            </p>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr style={{ background: theme.panelHead, borderBottom: `1px solid ${theme.border}` }}>
                  {['Name', 'Key', 'Scopes', 'Created', 'Last used', 'Status', ''].map((h, i) => (
                    <th key={h || i} className="px-4 py-3" style={{
                      fontSize: '11px', fontWeight: 600, color: theme.inkMuted,
                      textTransform: 'uppercase', letterSpacing: '.06em',
                      textAlign: i === 6 ? 'end' : 'start', whiteSpace: 'nowrap',
                    }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {(keys as ApiKeyRow[]).map((k, idx) => {
                  const revoked = !!k.revoked_at;
                  return (
                    <tr key={k.id} style={{ borderTop: idx === 0 ? 'none' : '1px solid #f1f5f9', opacity: revoked ? 0.55 : 1 }}>
                      <td className="px-4 py-3" style={{ color: theme.ink, fontWeight: 500 }}>{k.name}</td>
                      <td className="px-4 py-3 font-mono" style={{ fontSize: '12px', color: theme.inkMuted }}>{k.key_prefix}…</td>
                      <td className="px-4 py-3" style={{ fontSize: '11px', color: theme.inkMuted }}>{k.scopes.join(', ')}</td>
                      <td className="px-4 py-3" style={{ fontSize: '12px', color: theme.inkMuted }}>{fmtDate(k.created_at)}</td>
                      <td className="px-4 py-3" style={{ fontSize: '12px', color: theme.inkMuted }}>{fmtDate(k.last_used_at)}</td>
                      <td className="px-4 py-3">
                        <span style={{
                          fontSize: '11px', fontWeight: 600, padding: '2px 9px', borderRadius: '999px',
                          background: revoked ? theme.dangerSoft : theme.successSoft,
                          color: revoked ? theme.danger : theme.success,
                          border: `1px solid ${revoked ? theme.dangerBorder : theme.successBorder}`,
                        }}>{revoked ? 'Revoked' : 'Active'}</span>
                      </td>
                      <td className="px-4 py-3" style={{ textAlign: 'end' }}>
                        {!revoked && (
                          <button
                            type="button"
                            onClick={() => { if (window.confirm(`Revoke "${k.name}"? Apps using it will stop working immediately.`)) revokeMutation.mutate(k.id); }}
                            disabled={revokeMutation.isPending}
                            style={{ fontSize: '12px', fontWeight: 600, color: theme.danger, background: 'transparent', border: 'none', cursor: 'pointer' }}
                          >
                            Revoke
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      )}

      {/* Create-key modal */}
      <Modal open={open} onClose={closeModal} title={createdKey ? 'API key created' : 'Create API key'}>
        {createdKey ? (
          <div className="space-y-4">
            <div style={{ background: theme.warnSoft, border: `1px solid ${theme.warnBorder}`, borderRadius: '8px', padding: '12px' }}>
              <p style={{ margin: 0, fontSize: '13px', fontWeight: 600, color: theme.warn }}>
                Copy this key now — you won't be able to see it again.
              </p>
            </div>
            <div style={{
              display: 'flex', alignItems: 'center', gap: '8px',
              background: theme.muted, border: `1px solid ${theme.border}`,
              borderRadius: '8px', padding: '10px 12px',
            }}>
              <code style={{ flex: 1, fontSize: '12px', wordBreak: 'break-all', color: theme.ink }}>{createdKey}</code>
              <Button size="sm" variant="ghost" onClick={copyKey}>{copied ? '✓ Copied' : 'Copy'}</Button>
            </div>
            <div className="flex justify-end">
              <Button onClick={closeModal}>Done</Button>
            </div>
          </div>
        ) : (
          <div className="space-y-4">
            {error && <div className="rounded border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>}
            <Input label="Key name" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Shopify store" autoFocus />
            <div>
              <label className="mb-1 block text-xs font-medium text-ink-secondary">Scopes</label>
              <div className="flex flex-col gap-2">
                {SCOPES.map((s) => (
                  <label key={s.key} className="flex items-start gap-2 cursor-pointer">
                    <input type="checkbox" className="mt-0.5 h-4 w-4 accent-brand-600" checked={scopes.includes(s.key)} onChange={() => toggleScope(s.key)} />
                    <span>
                      <span className="text-sm font-medium text-ink-primary">{s.label}</span>
                      <span className="ms-2 text-xs text-ink-tertiary">{s.desc}</span>
                    </span>
                  </label>
                ))}
              </div>
            </div>
            <div className="flex justify-end gap-2 pt-1">
              <Button variant="ghost" onClick={closeModal} disabled={createMutation.isPending}>Cancel</Button>
              <Button
                onClick={() => { setError(null); createMutation.mutate(); }}
                disabled={createMutation.isPending || name.trim() === '' || scopes.length === 0}
              >
                {createMutation.isPending ? 'Creating…' : 'Create key'}
              </Button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}
