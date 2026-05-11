import { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { useNavigate, useParams } from 'react-router-dom';
import { getAdapter } from '@/data/index';
import { useAuthStore } from '@/store/auth';
import { Button } from '@/ui/button';
import { Input } from '@/ui/input';
import { Select } from '@/ui/select';
import { SearchableSelect } from '@/ui/searchable-select';
import type { PaymentRow, ContactRow, BankAccountRow, VendorBillRow, PaymentAllocationInsert, PaymentMethodRow } from '@/data/adapter';

const todayIso = () => new Date().toISOString().slice(0, 10);
const fmt = (n: number) => n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export default function VendorPaymentEditorPage() {
  const { t } = useTranslation();
  const { company_id } = useAuthStore();
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const isNew = id === 'new';

  const { data: suppliers = [] } = useQuery<ContactRow[]>({
    queryKey: ['contacts', company_id, 'supplier'],
    queryFn: () => getAdapter().contacts.list(company_id!, 'supplier'),
    enabled: !!company_id,
  });
  const { data: bankAccounts = [] } = useQuery<BankAccountRow[]>({
    queryKey: ['bankAccounts', company_id],
    queryFn: () => getAdapter().bankAccounts.list(company_id!),
    enabled: !!company_id,
  });
  const { data: paymentMethods = [] } = useQuery<PaymentMethodRow[]>({
    queryKey: ['paymentMethods', company_id],
    queryFn: async () => {
      const { data, error } = await (await import('@/data/supabase-client')).getSupabaseClient()
        .from('payment_methods').select('*').eq('company_id', company_id!);
      if (error) throw error;
      return data ?? [];
    },
    enabled: !!company_id,
  });
  const { data: existing } = useQuery<PaymentRow | null>({
    queryKey: ['vendor_payment', id],
    queryFn: () => getAdapter().vendorPayments.getById(id!),
    enabled: !isNew && !!id,
  });
  const { data: allocations = [] } = useQuery({
    queryKey: ['vendor_payment_allocations', id],
    queryFn: () => getAdapter().vendorPayments.getAllocations(id!),
    enabled: !isNew && !!id,
  });

  const [header, setHeader] = useState({
    contact_id: '', bank_account_id: '', payment_method_id: '',
    date: todayIso(), amount: '', currency: 'AED',
    classification: 'against_invoice' as 'against_invoice' | 'advance' | 'on_account',
    reference: '', notes: '',
  });
  const [error, setError] = useState<string | null>(null);
  const [applyModal, setApplyModal] = useState(false);
  const [applyBillId, setApplyBillId] = useState('');
  const [applyAmount, setApplyAmount] = useState('');
  const [openBills, setOpenBills] = useState<VendorBillRow[]>([]);

  useEffect(() => {
    if (existing) {
      setHeader({
        contact_id: existing.contact_id, bank_account_id: existing.bank_account_id ?? '',
        payment_method_id: existing.payment_method_id ?? '',
        date: existing.date as string, amount: String(existing.amount),
        currency: existing.currency,
        classification: existing.classification as 'against_invoice' | 'advance' | 'on_account',
        reference: existing.reference ?? '', notes: existing.notes ?? '',
      });
    }
  }, [existing]);

  useEffect(() => {
    if (applyModal && existing) {
      getAdapter().vendorBills.list(company_id!, 'confirmed')
        .then(bills => setOpenBills(bills.filter(b => b.supplier_id === existing.contact_id)));
    }
  }, [applyModal, existing, company_id]);

  const saveMutation = useMutation({
    mutationFn: async () => {
      if (!header.contact_id) throw new Error(t('purchasing.error_supplier_required'));
      if (!header.amount || isNaN(Number(header.amount))) throw new Error(t('purchasing.error_amount_required'));
      const pmtNum = isNew ? await getAdapter().vendorPayments.getNextNumber(company_id!) : existing!.payment_number;
      const allocations: PaymentAllocationInsert[] = [];
      const row = {
        company_id: company_id!, payment_number: pmtNum,
        type: 'outbound' as const,
        contact_id: header.contact_id,
        date: header.date, amount: Number(header.amount),
        currency: header.currency, exchange_rate: 1,
        payment_method_id: header.payment_method_id || null,
        bank_account_id: header.bank_account_id || null,
        reference: header.reference || null,
        classification: header.classification,
        status: 'draft' as const,
        void_reason: null, voided_at: null, voided_by: null,
        notes: header.notes || null,
      };
      if (isNew) return getAdapter().vendorPayments.create(row, allocations);
      return null;
    },
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ['vendor_payments', company_id] });
      if (isNew && data) navigate(`/purchasing/payments/${data.id}`);
    },
    onError: (e: Error) => setError(e.message),
  });

  const confirmMutation = useMutation({
    mutationFn: () => getAdapter().vendorPayments.confirm(id!),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['vendor_payments', company_id] });
      qc.invalidateQueries({ queryKey: ['vendor_payment', id] });
    },
    onError: (e: Error) => setError(e.message),
  });

  const applyMutation = useMutation({
    mutationFn: () => getAdapter().vendorPayments.applyAdvance(id!, applyBillId, Number(applyAmount)),
    onSuccess: () => {
      setApplyModal(false); setApplyBillId(''); setApplyAmount('');
      qc.invalidateQueries({ queryKey: ['vendor_payment_allocations', id] });
    },
    onError: (e: Error) => setError(e.message),
  });

  const usedAmount = allocations.reduce((s, a) => s + Number(a.amount_applied), 0);
  const available = (existing ? Number(existing.amount) : 0) - usedAmount;

  const canEdit = isNew;
  const supplierOpts = suppliers.map(s => ({ value: s.id, label: s.name }));
  const bankOpts = [{ value: '', label: t('purchasing.select_bank') }, ...bankAccounts.map(b => ({ value: b.id, label: b.account_number ?? b.bank_name ?? b.id }))];
  const methodOpts = [{ value: '', label: '—' }, ...paymentMethods.map(m => ({ value: m.id, label: m.name }))];
  const classOpts = [
    { value: 'against_invoice', label: t('purchasing.against_invoice') },
    { value: 'advance', label: t('purchasing.advance') },
    { value: 'on_account', label: t('purchasing.on_account') },
  ];
  const billOpts = [{ value: '', label: t('purchasing.select_bill') }, ...openBills.map(b => ({ value: b.id, label: `${b.bill_number} — ${fmt(Number(b.total_amount))}` }))];

  return (
    <div className="space-y-6 pb-16">
      <div className="flex items-center gap-3">
        <button onClick={() => navigate('/purchasing/payments')} className="text-sm text-ink-secondary hover:text-ink-primary">← {t('purchasing.vp_title')}</button>
        <span className="text-ink-tertiary">/</span>
        <h1 className="text-xl font-semibold text-ink-primary">{isNew ? t('purchasing.new_vp') : existing?.payment_number ?? '…'}</h1>
        {!isNew && <span className="rounded-pill bg-gray-100 px-2.5 py-0.5 text-xs capitalize text-gray-600">{existing?.status}</span>}
        <div className="ms-auto flex gap-2">
          <Button variant="ghost" size="sm" onClick={() => navigate('/purchasing/payments')}>{t('common.cancel')}</Button>
          {canEdit && (
            <Button size="sm" onClick={() => { setError(null); saveMutation.mutate(); }} disabled={saveMutation.isPending}>
              {saveMutation.isPending ? t('common.saving') : t('common.save')}
            </Button>
          )}
          {!isNew && existing?.status === 'draft' && (
            <Button size="sm" onClick={() => confirmMutation.mutate()} disabled={confirmMutation.isPending}>
              {t('purchasing.confirm_payment')}
            </Button>
          )}
          {!isNew && existing?.status === 'confirmed' && available > 0 && (
            <Button size="sm" variant="ghost" onClick={() => setApplyModal(true)}>
              {t('purchasing.apply_advance')}
            </Button>
          )}
        </div>
      </div>

      {error && <div className="rounded-input bg-red-50 px-4 py-2 text-sm text-red-700">{error}</div>}

      {applyModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="w-96 rounded-card bg-surface-card p-6 shadow-xl space-y-4">
            <h3 className="text-base font-semibold text-ink-primary">{t('purchasing.apply_advance')}</h3>
            <p className="text-sm text-ink-secondary">{t('purchasing.available_balance')}: <strong>{fmt(available)}</strong></p>
            <Select label={t('purchasing.select_bill')} options={billOpts} value={applyBillId}
              onChange={e => setApplyBillId(e.target.value)} />
            <Input label={t('purchasing.amount')} type="number" min="0" step="0.01"
              value={applyAmount} onChange={e => setApplyAmount(e.target.value)} />
            <div className="flex gap-2 justify-end">
              <Button variant="ghost" size="sm" onClick={() => setApplyModal(false)}>{t('common.cancel')}</Button>
              <Button size="sm" onClick={() => applyMutation.mutate()} disabled={applyMutation.isPending || !applyBillId || !applyAmount}>
                {applyMutation.isPending ? t('common.saving') : t('common.apply')}
              </Button>
            </div>
          </div>
        </div>
      )}

      <div className="rounded-card border border-border-subtle bg-surface-card p-5">
        <h2 className="mb-4 text-sm font-semibold text-ink-primary">{t('purchasing.payment_details')}</h2>
        <div className="grid grid-cols-2 gap-4 md:grid-cols-3">
          <div className="col-span-2 md:col-span-1">
            <label className="mb-1 block text-sm font-medium text-ink-primary">
              {t('purchasing.supplier')} <span className="text-danger-500">*</span>
            </label>
            <SearchableSelect
              options={supplierOpts}
              value={header.contact_id}
              disabled={!canEdit}
              onChange={(v) => setHeader(h => ({ ...h, contact_id: v }))}
              placeholder={t('purchasing.select_supplier')}
              panelWidth={320}
            />
          </div>
          <Select label={t('purchasing.bank_account')} options={bankOpts} value={header.bank_account_id}
            disabled={!canEdit} onChange={e => setHeader(h => ({ ...h, bank_account_id: e.target.value }))} />
          <Select label={t('purchasing.payment_method')} options={methodOpts} value={header.payment_method_id}
            disabled={!canEdit} onChange={e => setHeader(h => ({ ...h, payment_method_id: e.target.value }))} />
          <Input label={t('purchasing.date')} type="date" required value={header.date}
            disabled={!canEdit} onChange={e => setHeader(h => ({ ...h, date: e.target.value }))} />
          <Input label={t('purchasing.amount')} type="number" required value={header.amount}
            disabled={!canEdit} onChange={e => setHeader(h => ({ ...h, amount: e.target.value }))} />
          <Select label={t('purchasing.classification')} options={classOpts} value={header.classification}
            disabled={!canEdit} onChange={e => setHeader(h => ({ ...h, classification: e.target.value as 'against_invoice' | 'advance' | 'on_account' }))} />
          <Input label={t('purchasing.reference')} value={header.reference}
            disabled={!canEdit} onChange={e => setHeader(h => ({ ...h, reference: e.target.value }))} />
        </div>
      </div>

      {!isNew && allocations.length > 0 && (
        <div className="rounded-card border border-border-subtle bg-surface-card">
          <div className="border-b border-border-subtle px-5 py-3">
            <h2 className="text-sm font-semibold text-ink-primary">{t('purchasing.allocations')}</h2>
          </div>
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border-subtle bg-surface-muted text-ink-tertiary text-xs">
                <th className="px-4 py-3 text-start font-medium">{t('purchasing.bill')}</th>
                <th className="px-4 py-3 text-end font-medium">{t('purchasing.amount_applied')}</th>
              </tr>
            </thead>
            <tbody>
              {allocations.map(a => (
                <tr key={a.id} className="border-b border-border-subtle last:border-0">
                  <td className="px-4 py-3 font-mono text-xs text-ink-secondary">{a.doc_id}</td>
                  <td className="px-4 py-3 text-end font-mono">{fmt(Number(a.amount_applied))}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="border-t border-border-subtle px-5 py-3 text-sm text-ink-secondary flex justify-between">
            <span>{t('purchasing.available_balance')}</span>
            <span className="font-mono font-semibold text-ink-primary">{fmt(available)}</span>
          </div>
        </div>
      )}
    </div>
  );
}
