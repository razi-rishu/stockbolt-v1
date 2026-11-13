import { useMemo, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { getAdapter } from '@/data/index';
import { useAuthStore } from '@/store/auth';
import { hasPerm } from '@/lib/permissions';
import { useCompanyCountry } from '@/hooks/use-company-currency';
import { Input } from '@/ui/input';
import { Button } from '@/ui/button';
import { Modal } from '@/ui/modal';
import { DocLink } from '@/ui/doc-link';
import { ReportActions } from '@/ui/report-actions';
import { OceanPage } from '@/components/ocean-list';
import { ChevronDown, FileSpreadsheet, Pencil, Percent, Plus, ReceiptText, Trash2 } from 'lucide-react';
import { indianFinancialYear, tdsQuarter } from '@/lib/tds';
import type { ContactRow, TdsDeductionRow, TdsSectionRow, TdsSectionInsert } from '@/data/adapter';

/**
 * AC-7B — TDS register + Form 26Q summary (India only).
 *
 * Read-only view over the deduction ledger. The quarterly summary grouped by
 * section is what actually gets filed, so it is exportable/printable via the
 * shared ReportActions. Deductions are created and reversed from the vendor
 * bill (see modules/purchasing/tds-panel.tsx) — this page never posts.
 * Ocean Teal layout (2026-11): look only, same data and actions.
 */

const MONEY = (n: number) => n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

const emptySection: TdsSectionInsert = {
  code: '', description: '',
  rate_individual: 0, rate_other: 0,
  single_threshold: 0, annual_threshold: 0,
  is_active: true,
};

export default function TdsPage() {
  const { t } = useTranslation();
  const { company_id, role, permissions } = useAuthStore();
  const qc = useQueryClient();
  const canWrite = hasPerm(role, permissions, 'accounting.write');
  const country = useCompanyCountry();

  const [showSections, setShowSections] = useState(false);
  const [sectionForm, setSectionForm] = useState<TdsSectionInsert>(emptySection);
  const [editingSection, setEditingSection] = useState<TdsSectionRow | null>(null);
  const [sectionModal, setSectionModal] = useState(false);

  // Default to the current Indian financial year.
  const today = new Date().toISOString().slice(0, 10);
  const [fy, setFy] = useState<number>(indianFinancialYear(today));
  const [quarter, setQuarter] = useState<'all' | 'Q1' | 'Q2' | 'Q3' | 'Q4'>('all');

  const from = `${fy}-04-01`;
  const to = `${fy + 1}-03-31`;

  const { data: deductions = [], isLoading } = useQuery<TdsDeductionRow[]>({
    queryKey: ['tds_deductions', company_id, from, to],
    queryFn: () => getAdapter().tds.listDeductions(company_id!, from, to),
    enabled: !!company_id,
  });

  const { data: contacts = [] } = useQuery<ContactRow[]>({
    queryKey: ['contacts', company_id, 'supplier'],
    queryFn: () => getAdapter().contacts.list(company_id!, 'supplier'),
    enabled: !!company_id,
  });
  const nameOf = (id: string) => contacts.find((c) => c.id === id)?.name ?? '—';
  const panOf  = (id: string) => contacts.find((c) => c.id === id)?.pan ?? '';

  // ── Section rate master ────────────────────────────────────────────────────
  // Rates change with each Finance Act, so they must be editable in-app rather
  // than requiring a SQL update. Editing a rate affects FUTURE deductions only:
  // posted rows store the rate they used.
  const { data: sections = [] } = useQuery<TdsSectionRow[]>({
    queryKey: ['tds_sections', company_id],
    queryFn: () => getAdapter().tds.listSections(company_id!),
    enabled: !!company_id,
  });

  const invalidateSections = () => qc.invalidateQueries({ queryKey: ['tds_sections', company_id] });

  const saveSection = useMutation({
    mutationFn: async () => {
      const payload: TdsSectionInsert = {
        ...sectionForm,
        rate_individual: Number(sectionForm.rate_individual),
        rate_other: Number(sectionForm.rate_other),
        single_threshold: Number(sectionForm.single_threshold),
        annual_threshold: Number(sectionForm.annual_threshold),
      };
      if (editingSection) await getAdapter().tds.updateSection(editingSection.id, payload);
      else await getAdapter().tds.createSection(company_id!, payload);
    },
    onSuccess: () => { setSectionModal(false); invalidateSections(); },
  });

  const removeSection = useMutation({
    mutationFn: (id: string) => getAdapter().tds.removeSection(id),
    onSuccess: invalidateSections,
  });

  function openSection(s: TdsSectionRow | null) {
    setEditingSection(s);
    setSectionForm(s ? {
      code: s.code, description: s.description,
      rate_individual: Number(s.rate_individual), rate_other: Number(s.rate_other),
      single_threshold: Number(s.single_threshold), annual_threshold: Number(s.annual_threshold),
      effective_from: s.effective_from, is_active: s.is_active,
    } : emptySection);
    setSectionModal(true);
  }

  const visible = useMemo(
    () => deductions.filter((d) => quarter === 'all' || tdsQuarter(d.deduction_date) === quarter),
    [deductions, quarter],
  );

  /** Form 26Q shape: quarter × section, counting only live (non-reversed) rows. */
  const summary = useMemo(() => {
    const map = new Map<string, { quarter: string; section: string; count: number; base: number; tds: number }>();
    for (const d of deductions) {
      if (d.status !== 'posted') continue;
      const q = tdsQuarter(d.deduction_date);
      const key = `${q}|${d.section_code}`;
      const row = map.get(key) ?? { quarter: q, section: d.section_code, count: 0, base: 0, tds: 0 };
      row.count += 1;
      row.base = round2(row.base + Number(d.base_amount));
      row.tds = round2(row.tds + Number(d.amount));
      map.set(key, row);
    }
    return [...map.values()].sort((a, b) => a.quarter.localeCompare(b.quarter) || a.section.localeCompare(b.section));
  }, [deductions]);

  const totals = useMemo(() => ({
    base: round2(summary.reduce((a, r) => a + r.base, 0)),
    tds: round2(summary.reduce((a, r) => a + r.tds, 0)),
  }), [summary]);

  const fyOptions = useMemo(() => {
    const cur = indianFinancialYear(today);
    return [cur + 1, cur, cur - 1, cur - 2].map((y) => ({ value: String(y), label: t('acctOcean.tds_fy', { range: `${y}-${String((y + 1) % 100).padStart(2, '0')}` }) }));
  }, [today, t]);

  // Export rows for the shared Print / Excel actions.
  const exportRows = summary.map((r) => ({
    Quarter: r.quarter, Section: r.section, Deductions: r.count,
    'Base amount': r.base.toFixed(2), 'TDS deducted': r.tds.toFixed(2),
  }));

  if (country !== 'IN') {
    return (
      <OceanPage testid="tds-ocean" title={t('tds.title')}>
        <p className="sb-card sb-doc-card sb-info-note" style={{ margin: 0 }}>{t('tds.india_only')}</p>
      </OceanPage>
    );
  }

  return (
    <OceanPage
      testid="tds-ocean"
      title={t('tds.title')}
      subtitle={t('tds.subtitle')}
      actions={
        <div data-print-hide>
          <ReportActions
            rows={exportRows}
            headers={['Quarter', 'Section', 'Deductions', 'Base amount', 'TDS deducted']}
            filename={`tds-26q-summary-fy${fy}`}
          />
        </div>
      }
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        {/* Filters */}
        <div className="sb-card sb-form sb-doc-card sb-tds-filters" data-print-hide>
          <div>
            <label className="sb-flabel">{t('tds.f_fy')}</label>
            <select className="sb-pc-select" value={String(fy)} onChange={(e) => setFy(Number(e.target.value))}>
              {fyOptions.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </div>
          <div>
            <label className="sb-flabel">{t('tds.f_quarter')}</label>
            <select className="sb-pc-select" value={quarter} onChange={(e) => setQuarter(e.target.value as typeof quarter)}>
              <option value="all">{t('tds.all_quarters')}</option>
              {(['Q1', 'Q2', 'Q3', 'Q4'] as const).map((q) => <option key={q} value={q}>{t(`acctOcean.tds_${q.toLowerCase()}`)}</option>)}
            </select>
          </div>
        </div>

        {/* Form 26Q summary — quarter × section, the filing shape */}
        <div className="sb-card sb-doc-card sb-doc-lines">
          <div className="sb-doc-lines-head">
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
              <span className="sb-side-ico" style={{ background: 'var(--sb-primary-light)', color: 'var(--sb-primary-dark)' }} aria-hidden="true"><FileSpreadsheet size={17} /></span>
              <div style={{ minWidth: 0 }}>
                <h2 className="sb-doc-card-title" style={{ margin: 0 }}>{t('tds.summary_title')}</h2>
                <p className="sb-fx-name" style={{ margin: 0, fontSize: 12 }}>{t('tds.summary_hint')}</p>
              </div>
            </div>
          </div>
          {summary.length > 0 && (
            <div className="sb-gl-summary sb-acct-sum sb-acct-sum-2">
              <div><span className="sb-info-label">{t('tds.col_base')}</span><bdi dir="ltr" className="sb-dash-num">{MONEY(totals.base)}</bdi></div>
              <div><span className="sb-info-label">{t('tds.total_payable')}</span><bdi dir="ltr" className="sb-dash-num" style={{ color: 'var(--sb-primary-dark)' }}>{MONEY(totals.tds)}</bdi></div>
            </div>
          )}
          <div className="overflow-x-auto">
            <table className="w-full text-sm" style={{ minWidth: 560 }}>
              <thead>
                <tr>
                  <th className="px-4 py-2 text-start font-medium">{t('tds.col_quarter')}</th>
                  <th className="px-4 py-2 text-start font-medium">{t('tds.col_section')}</th>
                  <th className="px-4 py-2 text-end font-medium">{t('tds.col_count')}</th>
                  <th className="px-4 py-2 text-end font-medium">{t('tds.col_base')}</th>
                  <th className="px-4 py-2 text-end font-medium">{t('tds.col_tds')}</th>
                </tr>
              </thead>
              <tbody>
                {summary.length === 0 && (
                  <tr><td colSpan={5} className="sb-empty text-center">{t('tds.no_deductions')}</td></tr>
                )}
                {summary.map((r) => (
                  <tr key={`${r.quarter}-${r.section}`}>
                    <td className="px-4 py-2 font-medium"><bdi dir="ltr">{r.quarter}</bdi></td>
                    <td className="px-4 py-2"><bdi dir="ltr" className="sb-acct-code">{r.section}</bdi></td>
                    <td className="px-4 py-2 text-end text-ink-secondary">{r.count}</td>
                    <td className="px-4 py-2 text-end"><bdi dir="ltr" className="sb-dash-num" style={{ fontWeight: 500 }}>{MONEY(r.base)}</bdi></td>
                    <td className="px-4 py-2 text-end"><bdi dir="ltr" className="sb-dash-num">{MONEY(r.tds)}</bdi></td>
                  </tr>
                ))}
              </tbody>
              {summary.length > 0 && (
                <tfoot>
                  <tr className="sb-acct-total-row">
                    <td className="px-4 py-2" colSpan={3}>{t('tds.total_payable')}</td>
                    <td className="px-4 py-2 text-end"><bdi dir="ltr" className="sb-dash-num">{MONEY(totals.base)}</bdi></td>
                    <td className="px-4 py-2 text-end"><bdi dir="ltr" className="sb-dash-num">{MONEY(totals.tds)}</bdi></td>
                  </tr>
                </tfoot>
              )}
            </table>
          </div>
        </div>

        {/* Deduction register */}
        <div className="sb-card sb-doc-card sb-doc-lines">
          <div className="sb-doc-lines-head">
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
              <span className="sb-side-ico" style={{ background: 'var(--sb-primary-light)', color: 'var(--sb-primary-dark)' }} aria-hidden="true"><ReceiptText size={17} /></span>
              <h2 className="sb-doc-card-title" style={{ margin: 0 }}>{t('tds.register_title')}</h2>
            </div>
            <span className="sb-chip-count">{t('acctOcean.tds_rows', { count: visible.length })}</span>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm" style={{ minWidth: 860 }}>
              <thead>
                <tr>
                  <th className="px-4 py-2 text-start font-medium">{t('tds.col_date')}</th>
                  <th className="px-4 py-2 text-start font-medium">{t('tds.col_vendor')}</th>
                  <th className="px-4 py-2 text-start font-medium">{t('tds.col_pan')}</th>
                  <th className="px-4 py-2 text-start font-medium">{t('tds.col_section')}</th>
                  <th className="px-4 py-2 text-end font-medium">{t('tds.col_base')}</th>
                  <th className="px-4 py-2 text-end font-medium">{t('tds.col_rate')}</th>
                  <th className="px-4 py-2 text-end font-medium">{t('tds.col_tds')}</th>
                  <th className="px-4 py-2 text-start font-medium">{t('tds.col_entry')}</th>
                </tr>
              </thead>
              <tbody>
                {isLoading && (
                  <tr><td colSpan={8} className="sb-empty text-center">{t('common.loading')}</td></tr>
                )}
                {!isLoading && visible.length === 0 && (
                  <tr><td colSpan={8} className="sb-empty text-center">{t('tds.no_deductions')}</td></tr>
                )}
                {visible.map((d) => (
                  <tr key={d.id} className={d.status === 'reversed' ? 'sb-acct-reversed' : undefined}>
                    <td className="px-4 py-2"><bdi dir="ltr">{d.deduction_date}</bdi></td>
                    <td className="px-4 py-2 font-medium">{nameOf(d.contact_id)}</td>
                    <td className="px-4 py-2">
                      {panOf(d.contact_id)
                        ? <bdi dir="ltr" className="sb-mono" style={{ fontSize: 12 }}>{panOf(d.contact_id)}</bdi>
                        : <span className="sb-pill sb-pill-warn">{t('tds.no_pan_short')}</span>}
                    </td>
                    <td className="px-4 py-2"><bdi dir="ltr" className="sb-acct-code">{d.section_code}</bdi></td>
                    <td className="px-4 py-2 text-end text-ink-secondary"><bdi dir="ltr">{MONEY(Number(d.base_amount))}</bdi></td>
                    <td className="px-4 py-2 text-end text-ink-secondary"><bdi dir="ltr">{Number(d.rate)}%</bdi></td>
                    <td className="px-4 py-2 text-end"><bdi dir="ltr" className="sb-dash-num">{MONEY(Number(d.amount))}</bdi></td>
                    <td className="px-4 py-2">
                      {d.journal_entry_id
                        ? <DocLink type="journal_entry" id={d.journal_entry_id} status={d.status === 'reversed' ? 'reversed' : 'active'} />
                        : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* Section rate master — collapsible, since it is configuration not daily work */}
        <div className="sb-card sb-doc-card sb-doc-lines" data-print-hide>
          <button
            type="button"
            className="sb-doc-lines-head sb-acct-toggle"
            aria-expanded={showSections}
            onClick={() => setShowSections((v) => !v)}
          >
            <span style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
              <span className="sb-side-ico" style={{ background: 'var(--sb-primary-light)', color: 'var(--sb-primary-dark)' }} aria-hidden="true"><Percent size={17} /></span>
              <span className="sb-doc-card-title">{t('tds.sections_title')}</span>
              <span className="sb-chip-count">{t('tds.sections_count', { count: sections.length })}</span>
            </span>
            <ChevronDown size={18} aria-hidden="true" style={{ transform: showSections ? 'rotate(180deg)' : 'none', transition: 'transform .15s', color: 'var(--sb-text-secondary)' }} />
          </button>

          {showSections && (
            <>
              <p className="sb-alert sb-alert-warn" style={{ margin: '12px 16px 0' }}>{t('tds.rates_disclaimer')}</p>
              <div className="overflow-x-auto">
                <table className="w-full text-sm" style={{ minWidth: 820 }}>
                  <thead>
                    <tr>
                      <th className="px-4 py-2 text-start font-medium">{t('tds.col_section')}</th>
                      <th className="px-4 py-2 text-start font-medium">{t('tds.col_description')}</th>
                      <th className="px-4 py-2 text-end font-medium">{t('tds.col_rate_individual')}</th>
                      <th className="px-4 py-2 text-end font-medium">{t('tds.col_rate_other')}</th>
                      <th className="px-4 py-2 text-end font-medium">{t('tds.col_single_threshold')}</th>
                      <th className="px-4 py-2 text-end font-medium">{t('tds.col_annual_threshold')}</th>
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {sections.length === 0 && (
                      <tr><td colSpan={7} className="sb-empty text-center">{t('tds.no_sections')}</td></tr>
                    )}
                    {sections.map((s) => (
                      <tr key={s.id} style={s.is_active ? undefined : { opacity: 0.55 }}>
                        <td className="px-4 py-2"><bdi dir="ltr" className="sb-acct-code">{s.code}</bdi></td>
                        <td className="px-4 py-2 text-ink-secondary">{s.description}</td>
                        <td className="px-4 py-2 text-end text-ink-secondary"><bdi dir="ltr">{Number(s.rate_individual)}%</bdi></td>
                        <td className="px-4 py-2 text-end text-ink-secondary"><bdi dir="ltr">{Number(s.rate_other)}%</bdi></td>
                        <td className="px-4 py-2 text-end text-ink-secondary"><bdi dir="ltr">{MONEY(Number(s.single_threshold))}</bdi></td>
                        <td className="px-4 py-2 text-end text-ink-secondary"><bdi dir="ltr">{MONEY(Number(s.annual_threshold))}</bdi></td>
                        <td className="px-4 py-2 text-end">
                          {canWrite && (
                            <div className="sb-row-actions" style={{ justifyContent: 'flex-end' }}>
                              <button type="button" className="sb-icon-btn" onClick={() => openSection(s)} title={t('common.edit')} aria-label={t('common.edit')}>
                                <Pencil size={15} aria-hidden="true" />
                              </button>
                              <button type="button" className="sb-icon-btn" style={{ color: 'var(--sb-danger)' }} onClick={() => removeSection.mutate(s.id)} title={t('common.delete')} aria-label={t('common.delete')}>
                                <Trash2 size={15} aria-hidden="true" />
                              </button>
                            </div>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {canWrite && (
                <div style={{ padding: '12px 16px' }}>
                  <Button size="sm" onClick={() => openSection(null)}><Plus size={15} aria-hidden="true" /> {t('tds.add_section')}</Button>
                </div>
              )}
              {removeSection.error && (
                <p className="sb-alert sb-alert-danger" style={{ margin: '0 16px 12px' }}>{(removeSection.error as Error).message}</p>
              )}
            </>
          )}
        </div>
      </div>

      {/* Section add / edit */}
      <Modal open={sectionModal} onClose={() => setSectionModal(false)}
        title={editingSection ? t('tds.edit_section') : t('tds.add_section')} width="lg">
        <div className="sb-ocean sb-modal-form" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Input label={t('tds.col_section')} required placeholder="194C"
              value={sectionForm.code} onChange={(e) => setSectionForm({ ...sectionForm, code: e.target.value })} />
            <Input label={t('tds.col_description')} required
              value={sectionForm.description} onChange={(e) => setSectionForm({ ...sectionForm, description: e.target.value })} />
            <Input label={t('tds.col_rate_individual')} type="number" step="0.001" min="0" max="100"
              value={String(sectionForm.rate_individual)}
              onChange={(e) => setSectionForm({ ...sectionForm, rate_individual: Number(e.target.value) })} />
            <Input label={t('tds.col_rate_other')} type="number" step="0.001" min="0" max="100"
              value={String(sectionForm.rate_other)}
              onChange={(e) => setSectionForm({ ...sectionForm, rate_other: Number(e.target.value) })} />
            <Input label={t('tds.col_single_threshold')} type="number" step="0.01" min="0"
              value={String(sectionForm.single_threshold)}
              onChange={(e) => setSectionForm({ ...sectionForm, single_threshold: Number(e.target.value) })} />
            <Input label={t('tds.col_annual_threshold')} type="number" step="0.01" min="0"
              value={String(sectionForm.annual_threshold)}
              onChange={(e) => setSectionForm({ ...sectionForm, annual_threshold: Number(e.target.value) })} />
          </div>
          <p className="sb-info-note">{t('tds.threshold_hint')}</p>
          <p className="sb-form-hint" style={{ margin: 0 }}>{t('tds.edit_rate_note')}</p>
          {saveSection.error && <p className="sb-alert sb-alert-danger">{(saveSection.error as Error).message}</p>}
        </div>
        <div className="sb-ocean sb-modal-foot mt-4 flex justify-end gap-2">
          <Button size="sm" variant="secondary" onClick={() => setSectionModal(false)}>{t('common.cancel')}</Button>
          <Button size="sm" onClick={() => saveSection.mutate()}
            disabled={saveSection.isPending || !sectionForm.code || !sectionForm.description}>
            {t('common.save')}
          </Button>
        </div>
      </Modal>
    </OceanPage>
  );
}
