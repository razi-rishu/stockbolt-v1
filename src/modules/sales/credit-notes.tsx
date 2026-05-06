import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { getAdapter } from '@/data/index';
import { useAuthStore } from '@/store/auth';
import { Button } from '@/ui/button';
import type { CreditNoteRow } from '@/data/adapter';

const fmt = (n: number) => n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

function StatusBadge({ status }: { status: string }) {
  const base = 'inline-flex items-center px-2 py-0.5 rounded text-xs font-semibold';
  if (status === 'confirmed') return <span className={`${base} bg-green-100 text-green-700`}>Confirmed</span>;
  if (status === 'void')      return <span className={`${base} bg-red-100 text-red-600`}>Void</span>;
  return <span className={`${base} bg-yellow-100 text-yellow-700`}>Draft</span>;
}

export default function CreditNotesPage() {
  const { t } = useTranslation();
  const { company_id } = useAuthStore();

  const { data: notes = [], isLoading } = useQuery<CreditNoteRow[]>({
    queryKey: ['credit_notes', company_id],
    queryFn:  () => getAdapter().creditNotes.list(company_id!),
    enabled:  !!company_id,
  });

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-800">{t('returns.credit_notes_title')}</h1>
          <p className="text-sm text-slate-500 mt-1">{t('returns.credit_notes_desc')}</p>
        </div>
        <Link to="/sales/credit-notes/new">
          <Button variant="primary">{t('returns.new_credit_note')}</Button>
        </Link>
      </div>

      <div className="bg-white border border-slate-200 rounded-lg overflow-hidden">
        {isLoading ? (
          <p className="p-8 text-center text-sm text-slate-400">{t('common.loading')}</p>
        ) : notes.length === 0 ? (
          <p className="p-8 text-center text-slate-500">{t('returns.no_credit_notes')}</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 border-b border-slate-200">
                <tr>
                  <th className="px-4 py-3 text-left font-medium text-slate-600">{t('returns.cn_number')}</th>
                  <th className="px-4 py-3 text-left font-medium text-slate-600">{t('common.date')}</th>
                  <th className="px-4 py-3 text-left font-medium text-slate-600">{t('returns.reason')}</th>
                  <th className="px-4 py-3 text-left font-medium text-slate-600">{t('returns.restock')}</th>
                  <th className="px-4 py-3 text-right font-medium text-slate-600">{t('returns.total_amount')}</th>
                  <th className="px-4 py-3 text-left font-medium text-slate-600">{t('common.status')}</th>
                  <th className="px-4 py-3" />
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {notes.map(cn => (
                  <tr key={cn.id} className="hover:bg-slate-50 transition-colors">
                    <td className="px-4 py-3 font-mono text-blue-600">{cn.credit_note_number}</td>
                    <td className="px-4 py-3 text-slate-600">{cn.date}</td>
                    <td className="px-4 py-3 text-slate-600 capitalize">{cn.reason ?? '—'}</td>
                    <td className="px-4 py-3">
                      {cn.restock
                        ? <span className="text-green-600 text-xs font-semibold">{t('returns.yes')}</span>
                        : <span className="text-slate-400 text-xs">{t('returns.no')}</span>}
                    </td>
                    <td className="px-4 py-3 text-right font-semibold text-slate-800">{fmt(cn.total_amount)}</td>
                    <td className="px-4 py-3"><StatusBadge status={cn.status} /></td>
                    <td className="px-4 py-3 text-right">
                      <Link to={`/sales/credit-notes/${cn.id}`} className="text-xs text-blue-600 hover:underline">
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
