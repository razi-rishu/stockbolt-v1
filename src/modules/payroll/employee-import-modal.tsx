/**
 * Employee import (phase164, HRMS H1). CSV or Excel → checked by the database
 * (import_employees): if any row is wrong nothing is saved and every problem
 * is listed with its row and column.
 */
import { useRef, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Download, Upload } from 'lucide-react';
import { getAdapter } from '@/data/index';
import { Modal } from '@/ui/modal';
import { Button } from '@/ui/button';
import { downloadCSV, readPickedFile } from '@/lib/io-export';
import type { EmployeeImportResult } from '@/data/adapter';
import { IMPORT_COLUMNS, normaliseImportRows } from './employee-directory';

export function EmployeeImportModal({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const input = useRef<HTMLInputElement>(null);
  const [rows, setRows] = useState<Record<string, string>[] | null>(null);
  const [fileName, setFileName] = useState('');
  const [fileErr, setFileErr] = useState<string | null>(null);
  const [result, setResult] = useState<EmployeeImportResult | null>(null);

  async function pick(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    e.target.value = '';
    if (!f) return;
    setResult(null); setFileName(f.name);
    const { result: parsed } = await readPickedFile(f);
    if (parsed.errors.length) { setFileErr(parsed.errors.join(' ')); setRows(null); return; }
    const clean = normaliseImportRows(parsed.rows);
    if (clean.length === 0) { setFileErr(t('empDir.import_empty')); setRows(null); return; }
    setFileErr(null); setRows(clean);
  }

  const run = useMutation({
    mutationFn: () => getAdapter().employees.importRows(rows!),
    onSuccess: (r) => {
      setResult(r);
      if (r.ok) for (const k of ['employees', 'team', 'salespeople']) qc.invalidateQueries({ queryKey: [k] });
    },
    onError: (e: Error) => setFileErr(e.message),
  });

  const template = () => downloadCSV([{
    code: 'EMP-0101', name: 'Sara Ahmed', name_ar: '', phone: '+971500000000', email: 'sara@example.com', designation: 'Salesman',
    department: 'Sales', branch: '', warehouse: '', employment_type: 'permanent', joining_date: '2026-01-15', gender: 'female',
    nationality: '', basic_salary: '5000', housing_allowance: '1250', transport_allowance: '500', other_allowance: '0', manager_code: '',
  }], [...IMPORT_COLUMNS], 'employees-import-template.csv');

  return (
    <Modal open onClose={onClose} title={t('empDir.import_title')} width="lg">
      <div className="sb-ocean sb-modal-form flex flex-col gap-4" data-testid="emp-import">
        <p className="sb-info-note" style={{ fontSize: 13 }}>{t('empDir.import_intro')}</p>
        <div className="flex flex-wrap gap-2">
          <Button variant="ghost" size="sm" onClick={template}><Download size={15} aria-hidden="true" /> {t('empDir.template')}</Button>
          <Button variant="ghost" size="sm" onClick={() => input.current?.click()} data-testid="emp-import-pick">
            <Upload size={15} aria-hidden="true" /> {t('empDir.choose_file')}
          </Button>
          <input ref={input} type="file" hidden accept=".csv,.xlsx,.xls,.txt" onChange={pick} />
        </div>
        {fileName && rows && !result && <p style={{ margin: 0, fontSize: 14 }}>{t('empDir.ready', { count: rows.length, file: fileName })}</p>}
        {fileErr && <p className="sb-alert sb-alert-danger" role="alert">{fileErr}</p>}
        {result?.ok && <p className="sb-alert sb-alert-good" role="status">{t('empDir.imported', { count: result.imported })}</p>}
        {result && !result.ok && (
          <div role="alert">
            <p className="sb-alert sb-alert-danger" style={{ marginBottom: 8 }}>{t('empDir.import_failed', { count: result.errors.length })}</p>
            <div className="sb-e360-table-wrap" style={{ maxHeight: 260, overflowY: 'auto' }}>
              <table className="sb-e360-table">
                <thead><tr><th>{t('empDir.col_row')}</th><th>{t('empDir.col_field')}</th><th>{t('empDir.col_problem')}</th></tr></thead>
                <tbody>
                  {result.errors.map((e, i) => (
                    <tr key={i}><td><bdi dir="ltr">{e.row}</bdi></td><td><code>{e.field}</code></td><td>{t(`empDir.err_${e.message.replace(/[^a-z]+/gi, '_').toLowerCase()}`, { defaultValue: e.message })}</td></tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="sb-e360-muted">{t('empDir.row_note')}</p>
          </div>
        )}
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>{result?.ok ? t('common.close') : t('common.cancel')}</Button>
          {!result?.ok && (
            <Button variant="primary" disabled={!rows || run.isPending} onClick={() => run.mutate()} data-testid="emp-import-run">
              {run.isPending ? t('empDir.importing') : t('empDir.import_run', { count: rows?.length ?? 0 })}
            </Button>
          )}
        </div>
      </div>
    </Modal>
  );
}
