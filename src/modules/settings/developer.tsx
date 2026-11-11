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
import { useTranslation } from 'react-i18next';
import { Modal } from '@/ui/modal';
import { Input } from '@/ui/input';
import { BackButton } from '@/ui/back-button';
import type { Column } from '@/ui/table';
import { OceanPage, OceanTable } from '@/components/ocean-list';
import { KeyRound, Lock, Copy, Check, AlertTriangle, Loader2 } from 'lucide-react';
import { isAppShell } from '@/lib/platform';
import type { ApiScope, ApiKeyRow } from '@/data/adapter';

// English text stays as the fallback; `id` is the translation key.
const SCOPES: { key: ApiScope; id: string; label: string; desc: string }[] = [
  { key: 'read',           id: 'read',           label: 'Read',            desc: 'Pull products, contacts, invoices.' },
  { key: 'write:contacts', id: 'write_contacts', label: 'Write contacts',  desc: 'Create & update customers/suppliers.' },
  { key: 'write:orders',   id: 'write_orders',   label: 'Write orders',    desc: 'Create orders (post as draft invoices).' },
];

function fmtDate(s: string | null) {
  return s ? new Date(s).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' }) : '—';
}

export default function DeveloperSettingsPage() {
  const qc = useQueryClient();
  const { t } = useTranslation();

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

  const keyCols: Column<ApiKeyRow>[] = [
    { key: 'name', header: t('settingsPages.dev.name'), render: (k) => <span style={{ fontWeight: 700 }}>{k.name}</span> },
    { key: 'key', header: t('settingsPages.dev.key'), render: (k) => <bdi dir="ltr" className="sb-mono sb-fx-name">{k.key_prefix}…</bdi> },
    { key: 'scopes', header: t('settingsPages.dev.scopes'), render: (k) => <bdi dir="ltr" className="sb-fx-name">{k.scopes.join(', ')}</bdi> },
    { key: 'created', header: t('settingsPages.dev.created'), render: (k) => <bdi dir="ltr">{fmtDate(k.created_at)}</bdi> },
    { key: 'used', header: t('settingsPages.dev.last_used'), render: (k) => <bdi dir="ltr">{fmtDate(k.last_used_at)}</bdi> },
    {
      key: 'status', header: '',
      render: (k) => <span className={`sb-pill ${k.revoked_at ? 'sb-pill-bad' : 'sb-pill-good'}`}>{k.revoked_at ? t('settingsPages.dev.revoked') : t('common.active')}</span>,
    },
    {
      key: 'revoke', header: '', align: 'end',
      render: (k) => !k.revoked_at && (
        <button type="button" className="sb-row-link text-danger-500"
          onClick={() => { if (window.confirm(t('settingsPages.dev.confirm_revoke', { name: k.name }))) revokeMutation.mutate(k.id); }}
          disabled={revokeMutation.isPending}>
          {t('settingsPages.dev.revoke')}
        </button>
      ),
    },
  ];

  // Ocean Teal (UI v1.1): look only — same plan gate, keys list, create (secret
  // shown once), copy and revoke as before.
  return (
    <OceanPage
      narrow
      testid="developer-ocean"
      back={<BackButton to="/settings" label={t('settingsNav.title')} />}
      title={t('settingsNav.items.developer.title')}
      subtitle={t('settingsPages.dev.subtitle')}
      actions={hasAccess ? (
        <button type="button" className="sb-primary-btn sb-btn-inline" onClick={() => { setError(null); setCreatedKey(null); setOpen(true); }}>
          <KeyRound size={18} aria-hidden="true" />{t('settingsPages.dev.create')}
        </button>
      ) : undefined}
    >
      {/* Plan gate */}
      {!accessLoading && hasAccess === false && (
        <section className="sb-card sb-dev-gate">
          <span className="sb-form-icon" aria-hidden="true"><Lock size={20} /></span>
          <span style={{ minWidth: 0 }}>
            <h2 className="sb-form-title" style={{ lineHeight: 1.3 }}>{t('settingsPages.dev.gate_title')}</h2>
            <p className="sb-form-hint" style={{ margin: '4px 0 12px' }}>{t('settingsPages.dev.gate_body')}</p>
            {/* Android app: no link into billing — plans are bought on the website (Google Play payments policy). */}
            {!isAppShell() && <Link to="/settings/billing" className="sb-primary-btn sb-btn-inline" style={{ textDecoration: 'none' }}>{t('settingsPages.dev.view_plans')}</Link>}
          </span>
        </section>
      )}

      {/* Keys list */}
      {hasAccess && (keysLoading
        ? <div className="sb-card sb-empty">{t('common.loading')}</div>
        : <OceanTable columns={keyCols} rows={keys as ApiKeyRow[]} keyFn={(k) => k.id} rowMuted={(k) => !!k.revoked_at} emptyMessage={t('settingsPages.dev.empty')} />)}

      {/* Create-key modal */}
      <Modal open={open} onClose={closeModal} title={createdKey ? t('settingsPages.dev.created_title') : t('settingsPages.dev.create')}>
        {createdKey ? (
          <div className="sb-ocean sb-form sb-modal-form">
            <p className="sb-alert sb-alert-warn" style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
              <AlertTriangle size={18} aria-hidden="true" style={{ flex: 'none' }} />{t('settingsPages.dev.copy_now')}
            </p>
            <div className="sb-dev-secret">
              <code dir="ltr">{createdKey}</code>
              <button type="button" className="sb-secondary-btn sb-btn-inline" onClick={copyKey}>
                {copied ? <Check size={16} aria-hidden="true" /> : <Copy size={16} aria-hidden="true" />}
                {copied ? t('settingsPages.dev.copied') : t('settingsPages.dev.copy')}
              </button>
            </div>
            <div className="sb-form-actions">
              <button type="button" className="sb-primary-btn" onClick={closeModal}>{t('common.done')}</button>
            </div>
          </div>
        ) : (
          <div className="sb-ocean sb-form sb-modal-form">
            {error && <p className="sb-alert sb-alert-danger" role="alert">{error}</p>}
            <Input id="api-key-name" label={t('settingsPages.dev.key_name')} value={name} onChange={(e) => setName(e.target.value)} placeholder={t('settingsPages.dev.key_name_ph')} autoFocus />
            <fieldset className="sb-hw-fieldset">
              <legend className="sb-select-label">{t('settingsPages.dev.scopes')}</legend>
              <div className="sb-form-stack">
                {SCOPES.map((sc) => (
                  <label key={sc.key} className="sb-check-row">
                    <input type="checkbox" checked={scopes.includes(sc.key)} onChange={() => toggleScope(sc.key)} />
                    <span className="sb-check-text">
                      {t(`settingsPages.dev.scope_${sc.id}`, { defaultValue: sc.label })}
                      <span className="sb-form-hint">{t(`settingsPages.dev.scope_${sc.id}_desc`, { defaultValue: sc.desc })}</span>
                    </span>
                  </label>
                ))}
              </div>
            </fieldset>
            <div className="sb-form-actions">
              <button type="button" className="sb-secondary-btn" onClick={closeModal} disabled={createMutation.isPending}>{t('common.cancel')}</button>
              <button type="button" className="sb-primary-btn sb-btn-inline"
                onClick={() => { setError(null); createMutation.mutate(); }}
                disabled={createMutation.isPending || name.trim() === '' || scopes.length === 0}>
                {createMutation.isPending && <Loader2 size={18} className="sb-spin" aria-hidden="true" />}
                {createMutation.isPending ? t('settingsPages.dev.creating') : t('settingsPages.dev.create_key')}
              </button>
            </div>
          </div>
        )}
      </Modal>
    </OceanPage>
  );
}
