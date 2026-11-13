import { useState } from 'react';
import { formatDate } from '@/lib/locale';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { getAdapter } from '@/data/index';
import { useAuthStore } from '@/store/auth';
import { useInvalidateBooks } from '@/hooks/use-invalidate-books';
import { useCompanyCurrency } from '@/hooks/use-company-currency';
import { Button } from '@/ui/button';
import { Input } from '@/ui/input';
import { Modal } from '@/ui/modal';
import { SearchableSelect } from '@/ui/searchable-select';
import { StatusBadge } from '@/ui/status-badge';
import type { Column } from '@/ui/table';
import { OceanPage, OceanTable } from '@/components/ocean-list';
import { Ban, CalendarClock, CircleCheck, CircleX, Hourglass, Plus, Landmark } from 'lucide-react';
import type { BankAccountRow, ContactRow, PDCChequeRow } from '@/data/adapter';

// Ocean Teal layout (2026-11): look only — same create, deposit, clear,
// bounce and cancel actions.
const fmt = (n: number) => n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export default function PDCReceivedPage() {
  const { t } = useTranslation();
  const { company_id } = useAuthStore();
  const qc = useQueryClient();
  const invalidateBooks = useInvalidateBooks();   // Phase 14.14k
  const companyCurrency = useCompanyCurrency();    // Phase 14.14m

  // New PDC form state
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [contactId, setContactId]             = useState('');
  const [chequeNumber, setChequeNumber]       = useState('');
  const [bankName, setBankName]               = useState('');
  const [amount, setAmount]                   = useState('');
  const [currency, setCurrency]               = useState(companyCurrency);
  const [issueDate, setIssueDate]             = useState(new Date().toISOString().slice(0, 10));
  const [dueDate, setDueDate]                 = useState('');
  const [depositAccountId, setDepositAccountId] = useState('');
  const [isAdvance, setIsAdvance]             = useState(false);
  const [notes, setNotes]                     = useState('');
  const [createError, setCreateError]         = useState<string | null>(null);

  // Clear modal state
  const [clearPdcId, setClearPdcId]       = useState<string | null>(null);
  const [clearAccountId, setClearAccountId] = useState('');

  const [error, setError] = useState<string | null>(null);

  const { data: pdcs = [], isLoading } = useQuery<PDCChequeRow[]>({
    queryKey: ['pdc_cheques', 'received', company_id],
    queryFn:  () => getAdapter().pdcCheques.list(company_id!, { type: 'received' }),
    enabled:  !!company_id,
  });
  const { data: customers = [] } = useQuery<ContactRow[]>({
    queryKey: ['contacts', company_id, 'customer'],
    queryFn:  () => getAdapter().contacts.list(company_id!, 'customer'),
    enabled:  !!company_id,
  });
  const { data: bankAccounts = [] } = useQuery<BankAccountRow[]>({
    queryKey: ['bank_accounts', company_id],
    queryFn:  () => getAdapter().bankAccounts.list(company_id!),
    enabled:  !!company_id,
  });

  function invalidate() {
    // Phase 14.14k — clear / bank-deposit / bounce all touch GL.
    invalidateBooks();
    qc.invalidateQueries({ queryKey: ['pdc_cheques', 'received'] });
  }

  const createMutation = useMutation({
    mutationFn: () => getAdapter().pdcCheques.create({
      type: 'received', contact_id: contactId, cheque_number: chequeNumber,
      bank_name: bankName || undefined, amount: parseFloat(amount), currency,
      issue_date: issueDate, due_date: dueDate,
      deposit_account_id: depositAccountId || undefined,
      is_advance: isAdvance, notes: notes || undefined,
    }),
    onSuccess: () => { invalidate(); setShowCreateModal(false); resetForm(); },
    onError: (e: Error) => setCreateError(e.message),
  });

  const depositMutation = useMutation({
    mutationFn: (pdc_id: string) => getAdapter().pdcCheques.deposit(pdc_id),
    onSuccess: () => { invalidate(); setError(null); },
    onError: (e: Error) => setError(e.message),
  });

  const clearMutation = useMutation({
    mutationFn: () => getAdapter().pdcCheques.clear(clearPdcId!, clearAccountId || undefined),
    onSuccess: () => { invalidate(); setClearPdcId(null); setError(null); },
    onError: (e: Error) => { setError(e.message); setClearPdcId(null); },
  });

  const bounceMutation = useMutation({
    mutationFn: (pdc_id: string) => getAdapter().pdcCheques.bounce(pdc_id),
    onSuccess: () => { invalidate(); setError(null); },
    onError: (e: Error) => setError(e.message),
  });

  const cancelMutation = useMutation({
    mutationFn: (pdc_id: string) => getAdapter().pdcCheques.cancel(pdc_id),
    onSuccess: () => { invalidate(); setError(null); },
    onError: (e: Error) => setError(e.message),
  });

  function resetForm() {
    setContactId(''); setChequeNumber(''); setBankName(''); setAmount('');
    setCurrency(companyCurrency); setIssueDate(new Date().toISOString().slice(0, 10));
    setDueDate(''); setDepositAccountId(''); setIsAdvance(false); setNotes('');
    setCreateError(null);
  }

  const contactName = (id: string) => customers.find(c => c.id === id)?.name ?? id.slice(0, 8);

  // Summary chips — derived from the list on screen, nothing stored. Money is
  // summed only for cheques in the company's own currency so different
  // currencies are never added together.
  const todayIso = new Date().toISOString().slice(0, 10);
  const weekIso = new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10);
  const open = pdcs.filter(p => p.status === 'pending' || p.status === 'deposited');
  const k = {
    openCount: open.length,
    openAmount: open.filter(p => p.currency === companyCurrency).reduce((s, p) => s + Number(p.amount), 0),
    dueWeek: open.filter(p => p.due_date <= weekIso).length,
    overdue: open.filter(p => p.due_date < todayIso).length,
    cleared: pdcs.filter(p => p.status === 'cleared').length,
    bounced: pdcs.filter(p => p.status === 'bounced').length,
    cancelled: pdcs.filter(p => p.status === 'cancelled').length,
  };

  const columns: Column<PDCChequeRow>[] = [
    { key: 'number', header: t('banking.pdc_number'), render: (r) => <bdi dir="ltr" className="sb-inv-no">{r.pdc_number}</bdi> },
    { key: 'contact', header: t('banking.customer'), render: (r) => <span className="font-medium">{contactName(r.contact_id)}</span> },
    {
      key: 'cheque', header: t('banking.cheque_number'),
      render: (r) => (
        <div>
          <bdi dir="ltr" className="sb-mono" style={{ fontSize: 12.5 }}>{r.cheque_number}</bdi>
          {r.bank_name && <div className="sb-fx-name" style={{ fontSize: 12 }}>{r.bank_name}</div>}
        </div>
      ),
    },
    {
      key: 'due', header: t('banking.due_date'),
      render: (r) => {
        const late = (r.status === 'pending' || r.status === 'deposited') && r.due_date < todayIso;
        return <bdi dir="ltr" style={late ? { color: 'var(--sb-danger)', fontWeight: 700 } : undefined}>{formatDate(r.due_date)}</bdi>;
      },
    },
    {
      key: 'amount', header: t('banking.amount'), align: 'end',
      render: (r) => <bdi dir="ltr" className="sb-dash-num">{r.currency} {fmt(r.amount)}</bdi>,
    },
    { key: 'status', header: t('common.status'), render: (r) => <StatusBadge status={r.status} /> },
    {
      key: 'actions', header: '', align: 'end',
      render: (r) => (
        <div className="sb-pdc-acts" onClick={(e) => e.stopPropagation()}>
          {r.status === 'pending' && (
            <>
              <button type="button" className="sb-pdc-act" onClick={() => depositMutation.mutate(r.id)}>
                <Landmark size={14} aria-hidden="true" />{t('banking.deposit')}
              </button>
              <button type="button" className="sb-pdc-act is-good" onClick={() => { setClearPdcId(r.id); setClearAccountId(r.deposit_account_id ?? ''); }}>
                <CircleCheck size={14} aria-hidden="true" />{t('banking.clear')}
              </button>
              <button type="button" className="sb-pdc-act is-muted" onClick={() => { if (confirm(t('banking.cancel_confirm'))) cancelMutation.mutate(r.id); }}>
                <Ban size={14} aria-hidden="true" />{t('banking.cancel_pdc')}
              </button>
            </>
          )}
          {r.status === 'deposited' && (
            <>
              <button type="button" className="sb-pdc-act is-good" onClick={() => { setClearPdcId(r.id); setClearAccountId(r.deposit_account_id ?? ''); }}>
                <CircleCheck size={14} aria-hidden="true" />{t('banking.clear')}
              </button>
              <button type="button" className="sb-pdc-act is-bad" onClick={() => { if (confirm(t('banking.bounce_confirm'))) bounceMutation.mutate(r.id); }}>
                <CircleX size={14} aria-hidden="true" />{t('banking.bounce')}
              </button>
            </>
          )}
        </div>
      ),
    },
  ];

  return (
    <OceanPage
      testid="pdc-received-ocean"
      title={t('banking.pdc_received_title')}
      subtitle={t('banking.pdc_received_desc')}
      actions={
        <button type="button" className="sb-primary-btn sb-btn-inline" onClick={() => setShowCreateModal(true)}>
          <Plus size={18} aria-hidden="true" />{t('banking.new_pdc')}
        </button>
      }
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        {error && <p className="sb-alert sb-alert-danger" role="alert">{error}</p>}

        {!isLoading && pdcs.length > 0 && (
        <div className="sb-exp-kpis" data-testid="pdc-kpis">
          <div className="sb-exp-kpi is-hero">
            <span className="sb-exp-kpi-ico" aria-hidden="true"><Hourglass size={17} /></span>
            <div className="sb-exp-kpi-txt">
              <span className="sb-exp-kpi-label">{t('pdcOcean.awaiting')}</span>
              <bdi dir="ltr" className="sb-exp-kpi-val">{companyCurrency} {fmt(k.openAmount)}</bdi>
              <span className="sb-exp-kpi-sub" style={{ color: '#D7F4F1' }}>{t('pdcOcean.cheques', { count: k.openCount })}</span>
            </div>
          </div>
          <div className="sb-exp-kpi">
            <span className={`sb-exp-kpi-ico ${k.overdue > 0 ? 'is-warn' : ''}`} aria-hidden="true"><CalendarClock size={17} /></span>
            <div className="sb-exp-kpi-txt">
              <span className="sb-exp-kpi-label">{t('pdcOcean.due_week')}</span>
              <span className="sb-exp-kpi-val">{k.dueWeek}</span>
              <span className="sb-exp-kpi-sub">{t('pdcOcean.overdue', { count: k.overdue })}</span>
            </div>
          </div>
          <div className="sb-exp-kpi">
            <span className="sb-exp-kpi-ico" aria-hidden="true"><CircleCheck size={17} /></span>
            <div className="sb-exp-kpi-txt">
              <span className="sb-exp-kpi-label">{t('docStatus.cleared')}</span>
              <span className="sb-exp-kpi-val">{k.cleared}</span>
              <span className="sb-exp-kpi-sub">{t('pdcOcean.cheques', { count: k.cleared })}</span>
            </div>
          </div>
          <div className="sb-exp-kpi">
            <span className={`sb-exp-kpi-ico ${k.bounced > 0 ? 'is-warn' : ''}`} aria-hidden="true"><CircleX size={17} /></span>
            <div className="sb-exp-kpi-txt">
              <span className="sb-exp-kpi-label">{t('docStatus.bounced')}</span>
              <span className={`sb-exp-kpi-val ${k.bounced > 0 ? 'is-warn' : ''}`}>{k.bounced}</span>
              <span className="sb-exp-kpi-sub">{t('pdcOcean.cheques', { count: k.bounced })}</span>
            </div>
          </div>
        </div>
        )}

        {isLoading ? (
          <p className="sb-empty" style={{ margin: 0, textAlign: 'center' }}>{t('common.loading')}</p>
        ) : (
          <OceanTable
            columns={columns}
            rows={pdcs}
            keyFn={(r) => r.id}
            cardTitleKey="number"
            rowMuted={(r) => r.status === 'cancelled'}
            emptyMessage={t('banking.no_pdc')}
          />
        )}
      </div>

      {/* Create PDC Modal */}
      <Modal open={showCreateModal} onClose={() => { setShowCreateModal(false); resetForm(); }}
        title={t('banking.new_pdc')}>
        <div className="sb-ocean sb-modal-form space-y-3 mb-4">
          {createError && <p className="sb-alert sb-alert-danger">{createError}</p>}
          <div className="sb-ss-field">
            <label className="sb-flabel">{t('banking.customer')}</label>
            <SearchableSelect
              options={customers.map((c) => ({ value: c.id, label: c.name }))}
              value={contactId}
              onChange={(v) => setContactId(v)}
              placeholder={t('banking.select_customer')}
              panelWidth={320}
            />
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Input label={t('banking.cheque_number')} dir="ltr" value={chequeNumber} onChange={e => setChequeNumber(e.target.value)} />
            <Input label={t('banking.bank_name')} value={bankName} onChange={e => setBankName(e.target.value)} />
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Input label={t('banking.amount')} type="number" dir="ltr" value={amount} onChange={e => setAmount(e.target.value)} />
            <Input label={t('banking.currency')} dir="ltr" value={currency} onChange={e => setCurrency(e.target.value)} />
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Input label={t('banking.issue_date')} type="date" value={issueDate} onChange={e => setIssueDate(e.target.value)} />
            <Input label={t('banking.due_date')} type="date" value={dueDate} onChange={e => setDueDate(e.target.value)} />
          </div>
          <div>
            <label className="sb-flabel">{t('banking.deposit_account')}</label>
            <select value={depositAccountId} onChange={e => setDepositAccountId(e.target.value)} className="sb-pc-select">
              <option value="">— {t('banking.none')} —</option>
              {bankAccounts.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
            </select>
          </div>
          <label className="flex items-center gap-2 cursor-pointer" style={{ fontSize: 14 }}>
            <input type="checkbox" style={{ accentColor: 'var(--sb-primary)' }} checked={isAdvance} onChange={e => setIsAdvance(e.target.checked)} />
            {t('banking.is_advance')}
          </label>
          <Input label={t('banking.notes')} value={notes} onChange={e => setNotes(e.target.value)} />
        </div>
        <div className="sb-ocean sb-modal-foot flex justify-end gap-3">
          <Button variant="ghost" size="sm" onClick={() => { setShowCreateModal(false); resetForm(); }}>{t('common.cancel')}</Button>
          <Button size="sm" variant="primary" disabled={createMutation.isPending || !contactId || !chequeNumber || !amount || !dueDate}
            onClick={() => createMutation.mutate()}>
            {createMutation.isPending ? t('common.loading') : t('banking.record_pdc')}
          </Button>
        </div>
      </Modal>

      {/* Clear PDC Modal */}
      <Modal open={!!clearPdcId} onClose={() => setClearPdcId(null)} title={t('banking.clear_pdc')}>
        <div className="sb-ocean sb-modal-form space-y-3 mb-4">
          <p className="sb-info-note">{t('banking.clear_pdc_desc')}</p>
          <div>
            <label className="sb-flabel">{t('banking.deposit_account')}</label>
            <select value={clearAccountId} onChange={e => setClearAccountId(e.target.value)} className="sb-pc-select">
              <option value="">— {t('banking.select_account')} —</option>
              {bankAccounts.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
            </select>
          </div>
        </div>
        <div className="sb-ocean sb-modal-foot flex justify-end gap-3">
          <Button variant="ghost" size="sm" onClick={() => setClearPdcId(null)}>{t('common.cancel')}</Button>
          <Button size="sm" variant="primary" disabled={clearMutation.isPending}
            onClick={() => clearMutation.mutate()}>
            {clearMutation.isPending ? t('common.loading') : t('banking.mark_cleared')}
          </Button>
        </div>
      </Modal>
    </OceanPage>
  );
}
