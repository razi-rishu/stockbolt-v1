/**
 * Final settlement (gratuity payout) — moved unchanged from the employee list
 * (Payroll P3a). Posts Dr 2360 / Cr bank through payroll.settleGratuity and
 * makes the employee inactive.
 */
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { getAdapter } from '@/data/index';
import { useAuthStore } from '@/store/auth';
import { Button } from '@/ui/button';
import { Modal } from '@/ui/modal';
import { Input } from '@/ui/input';
import { Select } from '@/ui/select';
import type { BankAccountRow, EmployeeRow } from '@/data/adapter';
import { computeGratuity } from '../gratuity';

export function FinalSettlementModal({ employee, onClose, onDone }: {
  employee: EmployeeRow; onClose: () => void; onDone: () => void;
}) {
  const { t } = useTranslation();
  const { company_id } = useAuthStore();
  const qc = useQueryClient();
  const { data: banks = [] } = useQuery<BankAccountRow[]>({
    queryKey: ['bank_accounts', company_id],
    queryFn: () => getAdapter().bankAccounts.list(company_id!),
    enabled: !!company_id,
  });
  const [amount, setAmount] = useState(String(computeGratuity(employee.joining_date, Number(employee.basic_salary))));
  const [bankId, setBankId] = useState('');
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [error, setError] = useState<string | null>(null);
  const bank = bankId || banks[0]?.id || '';

  const settle = useMutation({
    mutationFn: () => getAdapter().payroll.settleGratuity(employee.id, parseFloat(amount) || 0, bank, { date, deactivate: true }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['employees'] });
      qc.invalidateQueries({ queryKey: ['employee'] });
      onDone();
    },
    onError: (e: Error) => setError(e.message),
  });

  return (
    <Modal open onClose={onClose} title={t('payOcean.settle_title_for', { name: employee.name })}>
      <div className="sb-ocean sb-modal-form flex flex-col gap-4">
        {error && <p className="sb-alert sb-alert-danger" role="alert">{error}</p>}
        <p className="sb-info-note" style={{ fontSize: 13 }}>
          {t('payOcean.settle_body')} <strong><bdi dir="ltr">Dr 2360 / Cr {t('payOcean.bank')}</bdi></strong>. {t('payOcean.settle_adjust')}
        </p>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Input label={t('payOcean.f_gratuity_amount')} dir="ltr" type="number" min="0" step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} />
          <Input label={t('payOcean.f_settle_date')} type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          <div className="sm:col-span-2">
            <Select label={t('payOcean.f_pay_from')} value={bank} onChange={(e) => setBankId(e.target.value)}
              options={[{ value: '', label: t('payOcean.select_bank') }, ...banks.map((b) => ({ value: b.id, label: b.name }))]} />
          </div>
        </div>
        <div className="flex justify-end gap-2 pt-1">
          <Button variant="ghost" onClick={onClose} disabled={settle.isPending}>{t('common.cancel')}</Button>
          <Button onClick={() => settle.mutate()} disabled={settle.isPending || !bank || !(parseFloat(amount) > 0)}>
            {settle.isPending ? t('payOcean.posting') : t('payOcean.pay_and_leave')}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
