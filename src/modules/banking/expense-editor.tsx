import { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { getAdapter } from '@/data/index';
import { useAuthStore } from '@/store/auth';
import { Input } from '@/ui/input';
import { Button } from '@/ui/button';
import { SearchableSelect } from '@/ui/searchable-select';
import type { BankAccountRow, CoaRow, ContactRow, ExpenseRow } from '@/data/adapter';

const round2 = (n: number) => Math.round(n * 100) / 100;

export default function ExpenseEditorPage() {
  const { t } = useTranslation();
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { company_id } = useAuthStore();
  const isNew = !id || id === 'new';

  const today = new Date().toISOString().slice(0, 10);

  const [expenseAccountId, setExpenseAccountId] = useState('');
  const [paidFromId, setPaidFromId]             = useState('');
  const [amount, setAmount]                     = useState('');
  const [taxAmount, setTaxAmount]               = useState('0');
  const [date, setDate]                         = useState(today);
  const [description, setDescription]           = useState('');
  const [supplierId, setSupplierId]             = useState('');
  const [reference, setReference]               = useState('');
  const [voidReason, setVoidReason]             = useState('');
  const [error, setError]                       = useState<string | null>(null);

  const { data: bankAccounts = [] } = useQuery<BankAccountRow[]>({
    queryKey: ['bank_accounts', company_id],
    queryFn:  () => getAdapter().bankAccounts.list(company_id!),
    enabled: !!company_id,
  });
  const { data: coaAccounts = [] } = useQuery<CoaRow[]>({
    queryKey: ['coa', company_id],
    queryFn:  () => getAdapter().coa.list(company_id!),
    enabled: !!company_id,
  });
  const { data: suppliers = [] } = useQuery<ContactRow[]>({
    queryKey: ['contacts', company_id, 'supplier'],
    queryFn:  () => getAdapter().contacts.list(company_id!, 'supplier'),
    enabled: !!company_id,
  });
  const { data: expense } = useQuery<ExpenseRow>({
    queryKey: ['expense', id],
    queryFn:  () => getAdapter().expenses.getById(id!),
    enabled:  !!id && !isNew,
  });
  const { data: nextNumber } = useQuery<string>({
    queryKey: ['next_number', 'EXP', company_id],
    queryFn:  () => getAdapter().expenses.getNextNumber(company_id!),
    enabled:  !!company_id && isNew,
  });

  useEffect(() => {
    if (expense) {
      setExpenseAccountId(expense.expense_account_id);
      setPaidFromId(expense.paid_from_account_id);
      setAmount(String(expense.amount));
      setTaxAmount(String(expense.tax_amount));
      setDate(expense.date);
      setDescription(expense.description);
      setSupplierId(expense.supplier_id ?? '');
      setReference(expense.reference ?? '');
    }
  }, [expense]);

  const totalAmount = round2(parseFloat(amount || '0') + parseFloat(taxAmount || '0'));

  // Expense COA accounts = 5xxx, 6xxx
  const expenseAccounts = coaAccounts.filter(a => a.code.startsWith('5') || a.code.startsWith('6'));

  const saveMutation = useMutation({
    mutationFn: async () => {
      if (!expenseAccountId || !paidFromId || !amount || !description) {
        throw new Error(t('banking.error_expense_invalid'));
      }
      const payload = {
        company_id:           company_id!,
        expense_number:       nextNumber ?? 'EXP-DRAFT',
        date,
        expense_account_id:   expenseAccountId,
        paid_from_account_id: paidFromId,
        amount:               parseFloat(amount),
        tax_amount:           parseFloat(taxAmount || '0'),
        total_amount:         totalAmount,
        description,
        supplier_id:          supplierId || null,
        reference:            reference || null,
        status:               'draft' as const,
      };
      if (isNew) return getAdapter().expenses.create(payload);
      return getAdapter().expenses.update(id!, { expense_account_id: expenseAccountId, paid_from_account_id: paidFromId, amount: parseFloat(amount), tax_amount: parseFloat(taxAmount || '0'), total_amount: totalAmount, date, description, supplier_id: supplierId || null, reference: reference || null });
    },
    onSuccess: (row) => {
      qc.invalidateQueries({ queryKey: ['expenses'] });
      if (isNew) navigate(`/banking/expenses/${(row as ExpenseRow).id}`);
    },
    onError: (e: Error) => setError(e.message),
  });

  const confirmMutation = useMutation({
    mutationFn: () => getAdapter().expenses.confirm(id!),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['expense', id] }); qc.invalidateQueries({ queryKey: ['expenses'] }); },
    onError: (e: Error) => setError(e.message),
  });

  const voidMutation = useMutation({
    mutationFn: () => getAdapter().expenses.void(id!, voidReason),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['expense', id] }); qc.invalidateQueries({ queryKey: ['expenses'] }); },
    onError: (e: Error) => setError(e.message),
  });

  const isDraft     = !expense || expense.status === 'draft';
  const isConfirmed = expense?.status === 'confirmed';

  return (
    <div className="space-y-6 max-w-2xl">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-slate-800">
          {isNew ? t('banking.new_expense') : (expense?.expense_number ?? t('banking.new_expense'))}
        </h1>
        {expense && (
          <span className={`px-2.5 py-1 rounded text-xs font-semibold ${
            expense.status === 'confirmed' ? 'bg-green-100 text-green-700'
            : expense.status === 'void'    ? 'bg-red-100 text-red-600'
            : 'bg-yellow-100 text-yellow-700'
          }`}>{expense.status.toUpperCase()}</span>
        )}
      </div>

      {error && <p className="text-sm text-red-600 bg-red-50 rounded p-3">{error}</p>}

      <div className="bg-white border border-slate-200 rounded-lg p-6 space-y-4">
        <Input label={t('banking.description')} value={description}
          onChange={e => setDescription(e.target.value)} disabled={!isDraft} />

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">{t('banking.expense_account')}</label>
            <SearchableSelect
              options={expenseAccounts.map(a => ({ value: a.id, label: `${a.code} — ${a.name}` }))}
              value={expenseAccountId}
              disabled={!isDraft}
              onChange={(v) => setExpenseAccountId(v)}
              placeholder={t('banking.select_account')}
              panelWidth={320}
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">{t('banking.paid_from')}</label>
            <select disabled={!isDraft} value={paidFromId}
              onChange={e => setPaidFromId(e.target.value)}
              className="w-full h-9 rounded-md border border-slate-300 px-2 text-sm disabled:bg-slate-50">
              <option value="">{t('banking.select_account')}</option>
              {bankAccounts.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
            </select>
          </div>
        </div>

        <div className="grid grid-cols-3 gap-4">
          <Input label={t('banking.amount')} type="number" value={amount}
            onChange={e => setAmount(e.target.value)} disabled={!isDraft} />
          <Input label={t('banking.tax_amount')} type="number" value={taxAmount}
            onChange={e => setTaxAmount(e.target.value)} disabled={!isDraft} />
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">{t('banking.total_amount')}</label>
            <div className="h-9 rounded-md border border-slate-200 bg-slate-50 px-3 flex items-center text-sm font-semibold text-slate-800">
              {totalAmount.toLocaleString('en-US', { minimumFractionDigits: 2 })}
            </div>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <Input label={t('common.date')} type="date" value={date}
            onChange={e => setDate(e.target.value)} disabled={!isDraft} />
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">{t('banking.supplier_optional')}</label>
            <SearchableSelect
              options={[
                { value: '', label: `— ${t('banking.none')} —` },
                ...suppliers.map((s) => ({ value: s.id, label: s.name })),
              ]}
              value={supplierId}
              disabled={!isDraft}
              onChange={(v) => setSupplierId(v)}
              placeholder={`— ${t('banking.none')} —`}
              panelWidth={320}
            />
          </div>
        </div>
        <Input label={t('banking.reference')} value={reference}
          onChange={e => setReference(e.target.value)} disabled={!isDraft} />
      </div>

      {isConfirmed && (
        <div className="space-y-3 bg-white border border-slate-200 rounded-lg p-4">
          <p className="text-sm font-medium text-slate-700">{t('banking.void_expense')}</p>
          <Input label={t('banking.void_reason')} value={voidReason}
            onChange={e => setVoidReason(e.target.value)} />
          <Button variant="ghost" className="text-red-600 border-red-300"
            disabled={voidMutation.isPending}
            onClick={() => { if (confirm(t('banking.void_confirm_text'))) { setError(null); voidMutation.mutate(); } }}>
            {t('banking.void_expense')}
          </Button>
        </div>
      )}

      <div className="flex gap-3">
        <Button variant="ghost" onClick={() => navigate('/banking/expenses')}>{t('common.back')}</Button>
        {isDraft && (
          <>
            <Button disabled={saveMutation.isPending} onClick={() => { setError(null); saveMutation.mutate(); }}>
              {t('common.save')}
            </Button>
            {!isNew && (
              <Button variant="primary" disabled={confirmMutation.isPending}
                onClick={() => { setError(null); confirmMutation.mutate(); }}>
                {t('banking.confirm_expense')}
              </Button>
            )}
          </>
        )}
      </div>
    </div>
  );
}
