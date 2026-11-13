import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { getAdapter } from '@/data/index';
import { useAuthStore } from '@/store/auth';
import { useTranslation } from 'react-i18next';
import { Input } from '@/ui/input';
import type { Column } from '@/ui/table';
import { OceanPage, OceanTable } from '@/components/ocean-list';
import { Plus, UserRound, Loader2 } from 'lucide-react';
import ImportExportButton from '@/modules/settings/import-export/ImportExportButton';
import type { SalespersonRow } from '@/data/adapter';
import { useArabicEnabled } from '@/hooks/use-arabic-enabled';

const fmt = (n: number) => n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

interface FormState {
  name:           string;
  name_ar:        string;
  email:          string;
  phone:          string;
  commission_pct: string;
  notes:          string;
}
const empty: FormState = { name: '', name_ar: '', email: '', phone: '', commission_pct: '0', notes: '' };

/**
 * Salespeople management — Phase 12.16.
 *
 * Master list of sales staff that get tagged on invoices and quotes
 * for performance and commission reporting. Independent of profiles
 * (auth users) — a salesperson doesn't need to log in.
 *
 * - Active rows appear in invoice/quote Salesperson dropdowns.
 * - Deactivating a salesperson hides them from new pickers but does
 *   NOT remove them from historical sales (FK is ON DELETE SET NULL,
 *   and we soft-delete via is_active flag).
 */
export default function SalespeoplePage() {
  const qc = useQueryClient();
  const { company_id } = useAuthStore();
  const { t } = useTranslation();
  const arabicOn = useArabicEnabled();   // India companies: English only

  const [showInactive, setShowInactive] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<FormState>(empty);
  const [showForm, setShowForm] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const { data: rows = [], isLoading } = useQuery<SalespersonRow[]>({
    queryKey: ['salespeople', company_id, showInactive],
    queryFn:  () => getAdapter().salespeople.list(company_id!, { include_inactive: showInactive }),
    enabled:  !!company_id,
  });

  function startNew() {
    setEditingId(null);
    setForm(empty);
    setError(null);
    setShowForm(true);
  }
  function startEdit(r: SalespersonRow) {
    setEditingId(r.id);
    setForm({
      name:            r.name,
      name_ar:         r.name_ar ?? '',
      email:           r.email ?? '',
      phone:           r.phone ?? '',
      commission_pct:  String(r.commission_pct ?? 0),
      notes:           r.notes ?? '',
    });
    setError(null);
    setShowForm(true);
  }
  function cancel() {
    setShowForm(false);
    setEditingId(null);
    setForm(empty);
    setError(null);
  }

  const saveMutation = useMutation({
    mutationFn: async () => {
      if (!form.name.trim()) throw new Error(t('settingsPages.sales.err_name'));
      const pct = parseFloat(form.commission_pct) || 0;
      if (pct < 0 || pct > 100) throw new Error(t('settingsPages.sales.err_pct'));

      const payload = {
        name:           form.name.trim(),
        name_ar:        form.name_ar.trim() || null,
        email:          form.email.trim() || null,
        phone:          form.phone.trim() || null,
        commission_pct: pct,
        notes:          form.notes.trim() || null,
      };

      if (editingId) {
        await getAdapter().salespeople.update(editingId, payload);
      } else {
        await getAdapter().salespeople.create({
          company_id: company_id!,
          is_active:  true,
          ...payload,
        });
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['salespeople'] });
      cancel();
    },
    onError: (e: Error) => setError(e.message),
  });

  const deactivateMutation = useMutation({
    mutationFn: (id: string) => getAdapter().salespeople.deactivate(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['salespeople'] }),
    onError: (e: Error) => setError(e.message),
  });
  const activateMutation = useMutation({
    mutationFn: (id: string) => getAdapter().salespeople.activate(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['salespeople'] }),
    onError: (e: Error) => setError(e.message),
  });

  const columns: Column<SalespersonRow>[] = [
    {
      key: 'name', header: t('settingsPages.sales.name'),
      render: (r) => (
        <span>
          <span style={{ fontWeight: 700 }}>{r.name}</span>
          {r.name_ar && <span className="sb-fx-name" style={{ display: 'block' }}><bdi>{r.name_ar}</bdi></span>}
        </span>
      ),
    },
    { key: 'email', header: t('settingsPages.sales.email'), render: (r) => r.email ?? '—' },
    { key: 'phone', header: t('settingsPages.sales.phone'), render: (r) => r.phone ? <bdi dir="ltr">{r.phone}</bdi> : '—' },
    { key: 'pct', header: t('settingsPages.sales.commission'), align: 'end', render: (r) => <bdi dir="ltr" className="sb-mono">{fmt(Number(r.commission_pct))}</bdi> },
    { key: 'status', header: '', render: (r) => <span className={`sb-pill ${r.is_active ? 'sb-pill-good' : 'sb-pill-muted'}`}>{r.is_active ? t('common.active') : t('common.inactive')}</span> },
    {
      key: 'actions', header: '', align: 'end',
      render: (r) => (
        <span style={{ display: 'inline-flex', gap: 2, whiteSpace: 'nowrap' }}>
          <button type="button" className="sb-row-link text-brand-600" onClick={() => startEdit(r)}>{t('common.edit')}</button>
          {r.is_active ? (
            <button type="button" className="sb-row-link text-danger-500"
              onClick={() => { if (window.confirm(t('settingsPages.sales.confirm_deactivate', { name: r.name }))) deactivateMutation.mutate(r.id); }}>
              {t('settingsPages.sales.deactivate')}
            </button>
          ) : (
            <button type="button" className="sb-row-link text-brand-600" onClick={() => activateMutation.mutate(r.id)}>
              {t('settingsPages.sales.reactivate')}
            </button>
          )}
        </span>
      ),
    },
  ];

  // Ocean Teal (UI v1.1): look only — same list, inline add / edit form,
  // show-inactive filter and activate / deactivate as before.
  return (
    <OceanPage
      testid="salespeople-ocean"
      title={t('settingsNav.items.salespeople.title')}
      subtitle={t('settingsPages.sales.subtitle')}
      actions={!showForm ? <>
        <span className="sb-clist-io"><ImportExportButton moduleKey="salespeople" /></span>
        <button type="button" className="sb-primary-btn sb-btn-inline" onClick={startNew}><Plus size={18} aria-hidden="true" />{t('settingsPages.sales.add')}</button>
      </> : undefined}
    >
      {error && <p className="sb-alert sb-alert-danger" role="alert">{error}</p>}

      {/* Form (add / edit) */}
      {showForm && (
        <section className="sb-card sb-form">
          <div className="sb-form-head">
            <span className="sb-form-icon" aria-hidden="true"><UserRound size={20} /></span>
            <h2 className="sb-form-title">{editingId ? t('settingsPages.sales.edit_title') : t('settingsPages.sales.new_title')}</h2>
          </div>
          <div className="sb-form-grid">
            <Input id="sp-name" label={t('settingsPages.sales.name')} required value={form.name}
              onChange={e => setForm(f => ({ ...f, name: e.target.value }))} />
            {arabicOn && (
            <Input id="sp-name-ar" label={t('settingsPages.sales.name_ar')} dir="rtl" value={form.name_ar}
              onChange={e => setForm(f => ({ ...f, name_ar: e.target.value }))} />
            )}
            <Input id="sp-email" label={t('settingsPages.sales.email')} type="email" dir="ltr" value={form.email}
              onChange={e => setForm(f => ({ ...f, email: e.target.value }))} />
            <Input id="sp-phone" label={t('settingsPages.sales.phone')} type="tel" dir="ltr" value={form.phone}
              onChange={e => setForm(f => ({ ...f, phone: e.target.value }))} />
            <Input id="sp-pct" label={t('settingsPages.sales.commission')} type="number" min="0" max="100" step="0.01" dir="ltr"
              value={form.commission_pct}
              onChange={e => setForm(f => ({ ...f, commission_pct: e.target.value }))} />
            <Input id="sp-notes" label={t('settingsPages.sales.notes')} value={form.notes}
              onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} />
          </div>
          <div className="sb-form-actions" style={{ marginTop: 16 }}>
            <button type="button" className="sb-secondary-btn" onClick={cancel}>{t('common.cancel')}</button>
            <button type="button" className="sb-primary-btn sb-btn-inline" onClick={() => { setError(null); saveMutation.mutate(); }} disabled={saveMutation.isPending}>
              {saveMutation.isPending && <Loader2 size={18} className="sb-spin" aria-hidden="true" />}
              {saveMutation.isPending ? t('common.saving') : t('common.save')}
            </button>
          </div>
        </section>
      )}

      {/* Show-inactive toggle */}
      <label className="sb-check-row" style={{ alignSelf: 'flex-start' }}>
        <input type="checkbox" checked={showInactive} onChange={e => setShowInactive(e.target.checked)} />
        <span className="sb-check-text">{t('settingsPages.sales.show_inactive')}</span>
      </label>

      {/* List */}
      {isLoading
        ? <div className="sb-card sb-empty">{t('common.loading')}</div>
        : <OceanTable columns={columns} rows={rows} keyFn={(r) => r.id} rowMuted={(r) => !r.is_active} emptyMessage={t('settingsPages.sales.empty')} />}
    </OceanPage>
  );
}
