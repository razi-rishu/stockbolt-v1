import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { getAdapter } from '@/data/index';
import { useAuthStore } from '@/store/auth';
import { Button } from '@/ui/button';
import type { ExpenseRow } from '@/data/adapter';

const fmt = (n: number) => n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

function StatusBadge({ status }: { status: string }) {
  const base = 'inline-flex items-center px-2 py-0.5 rounded text-xs font-semibold';
  if (status === 'confirmed') return <span className={`${base} bg-green-100 text-green-700`}>Confirmed</span>;
  if (status === 'void')      return <span className={`${base} bg-red-100 text-red-600`}>Void</span>;
  return <span className={`${base} bg-yellow-100 text-yellow-700`}>Draft</span>;
}

export default function ExpensesPage() {
  const { t } = useTranslation();
  const { company_id } = useAuthStore();

  const { data: expenses = [], isLoading } = useQuery<ExpenseRow[]>({
    queryKey: ['expenses', company_id],
    queryFn:  () => getAdapter().expenses.list(company_id!),
    enabled:  !!company_id,
  });

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-800">{t('banking.expenses_title')}</h1>
          <p className="text-sm text-slate-500 mt-1">{t('banking.expenses_desc')}</p>
        </div>
        <Link to="/banking/expenses/new">
          <Button variant="primary">{t('banking.new_expense')}</Button>
        </Link>
      </div>

      <div className="bg-white border border-slate-200 rounded-lg overflow-hidden">
        {isLoading ? (
          <p className="p-8 text-center text-sm text-slate-400">{t('common.loading')}</p>
        ) : expenses.length === 0 ? (
          <p className="p-8 text-center text-slate-500">{t('banking.no_expenses')}</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 border-b border-slate-200">
                <tr>
                  <th className="px-4 py-3 text-left font-medium text-slate-600">{t('banking.expense_number')}</th>
                  <th className="px-4 py-3 text-left font-medium text-slate-600">{t('common.date')}</th>
                  <th className="px-4 py-3 text-left font-medium text-slate-600">{t('banking.description')}</th>
                  <th className="px-4 py-3 text-right font-medium text-slate-600">{t('banking.amount')}</th>
                  <th className="px-4 py-3 text-right font-medium text-slate-600">{t('banking.tax_amount')}</th>
                  <th className="px-4 py-3 text-right font-medium text-slate-600">{t('banking.total_amount')}</th>
                  <th className="px-4 py-3 text-left font-medium text-slate-600">{t('common.status')}</th>
                  <th className="px-4 py-3" />
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {expenses.map(exp => (
                  <tr key={exp.id} className="hover:bg-slate-50 transition-colors">
                    <td className="px-4 py-3 font-mono text-blue-600">{exp.expense_number}</td>
                    <td className="px-4 py-3 text-slate-600">{exp.date}</td>
                    <td className="px-4 py-3 text-slate-700 max-w-xs truncate">{exp.description}</td>
                    <td className="px-4 py-3 text-right text-slate-700">{fmt(exp.amount)}</td>
                    <td className="px-4 py-3 text-right text-slate-500">{fmt(exp.tax_amount)}</td>
                    <td className="px-4 py-3 text-right font-semibold text-slate-800">{fmt(exp.total_amount)}</td>
                    <td className="px-4 py-3"><StatusBadge status={exp.status} /></td>
                    <td className="px-4 py-3 text-right">
                      <Link to={`/banking/expenses/${exp.id}`} className="text-xs text-blue-600 hover:underline">
                        {t('common.view')}
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
