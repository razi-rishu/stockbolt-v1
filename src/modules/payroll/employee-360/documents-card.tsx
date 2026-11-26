/**
 * Employee 360 — documents: number + expiry date per document with a bar that
 * turns amber within 60 days and red once expired, plus scanned files in the
 * private 'employee-files' bucket (phase163). Visa and labour card are GCC
 * documents; India companies see ID and passport only.
 */
import { useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { CalendarClock, FileText, Paperclip, Trash2 } from 'lucide-react';
import { getAdapter } from '@/data/index';
import { Input } from '@/ui/input';
import { EMPLOYEE_FILE_MAX_BYTES, EMPLOYEE_FILE_TYPES, type EmployeeDocType, type EmployeeDocumentRow } from '@/data/adapter';
import { daysUntil, expiryState, type Draft } from './draft';

type DocKey = 'emirates_id' | 'passport' | 'visa' | 'labour_card';
const NO: Record<DocKey, keyof Draft> = { emirates_id: 'emirates_id', passport: 'passport_no', visa: 'visa_no', labour_card: 'labour_card_no' };
const EXP: Record<DocKey, keyof Draft> = { emirates_id: 'emirates_id_expiry', passport: 'passport_expiry', visa: 'visa_expiry', labour_card: 'labour_card_expiry' };

/** Bar fill: share of a two-year window still left (full beyond two years). */
const fill = (days: number | null) => (days === null || days <= 0 ? 0 : Math.min(100, Math.round((days / 730) * 100)));

export function DocumentsCard({ draft, set, idLabel, gcc, employeeId, companyId, canWrite, readOnly }: {
  draft: Draft;
  set: (key: keyof Draft, value: string) => void;
  idLabel: string; gcc: boolean;
  employeeId: string | null; companyId: string; canWrite: boolean; readOnly: boolean;
}) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const docs: DocKey[] = gcc ? ['emirates_id', 'passport', 'visa', 'labour_card'] : ['emirates_id', 'passport'];
  const label = (k: DocKey) => (k === 'emirates_id' ? idLabel : t(`emp360.doc_${k}`));

  const filesQ = useQuery<EmployeeDocumentRow[]>({
    queryKey: ['employee_documents', employeeId],
    queryFn: () => getAdapter().employees.listDocuments(employeeId!),
    enabled: !!employeeId,
  });
  const [docType, setDocType] = useState<EmployeeDocType>('emirates_id');
  const [err, setErr] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const refresh = () => qc.invalidateQueries({ queryKey: ['employee_documents', employeeId] });

  const upload = useMutation({
    mutationFn: (f: File) => getAdapter().employees.uploadDocument(companyId, employeeId!, docType, f),
    onSuccess: () => { setErr(null); void refresh(); },
    onError: (e: Error) => setErr(e.message === 'employee_file_type' ? t('emp360.file_type') : e.message === 'employee_file_size' ? t('emp360.file_size') : e.message),
  });
  const remove = useMutation({
    mutationFn: (d: EmployeeDocumentRow) => getAdapter().employees.removeDocument(d),
    onSuccess: () => void refresh(),
    onError: (e: Error) => setErr(e.message),
  });

  function pick(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    e.target.value = '';
    if (!f) return;
    if (!(EMPLOYEE_FILE_TYPES as readonly string[]).includes(f.type)) { setErr(t('emp360.file_type')); return; }
    if (f.size > EMPLOYEE_FILE_MAX_BYTES) { setErr(t('emp360.file_size')); return; }
    upload.mutate(f);
  }
  async function open(d: EmployeeDocumentRow) {
    try { window.open(await getAdapter().employees.fileUrl(d.storage_path), '_blank', 'noopener'); }
    catch (e) { setErr((e as Error).message); }
  }

  return (
    <section className="sb-card sb-e360-card" data-testid="e360-documents">
      <p className="sb-e360-sec"><CalendarClock size={16} aria-hidden="true" /> {t('emp360.sec_documents')}</p>
      <div className="sb-e360-docs">
        {docs.map((k) => {
          const exp = String(draft[EXP[k]]);
          const st = expiryState(exp);
          const days = daysUntil(exp);
          return (
            <div key={k} className="sb-e360-doc" data-testid={`e360-doc-${k}`} data-state={st}>
              <span className="sb-e360-doc-name">{label(k)}</span>
              <Input label={t('emp360.doc_number')} dir="ltr" value={String(draft[NO[k]])} disabled={readOnly}
                onChange={(e) => set(NO[k], e.target.value)} />
              <Input label={t('emp360.doc_expiry')} type="date" value={exp} disabled={readOnly}
                onChange={(e) => set(EXP[k], e.target.value)} />
              <div className="sb-e360-bar" aria-hidden="true"><span className={`is-${st}`} style={{ width: `${fill(days)}%` }} /></div>
              <span className={`sb-e360-doc-when is-${st}`}>
                {st === 'none' ? t('emp360.exp_none')
                  : st === 'expired' ? t('emp360.exp_expired', { count: -days! })
                  : st === 'soon' ? t('emp360.exp_soon', { count: days! })
                  : t('emp360.exp_ok')}
              </span>
            </div>
          );
        })}
      </div>

      <div className="sb-e360-files">
        <p className="sb-e360-subsec"><Paperclip size={14} aria-hidden="true" /> {t('emp360.files')}</p>
        {!employeeId && <p className="sb-e360-muted">{t('emp360.save_first')}</p>}
        {employeeId && (filesQ.data ?? []).length === 0 && <p className="sb-e360-muted">{t('emp360.files_empty')}</p>}
        <ul>
          {(filesQ.data ?? []).map((d) => (
            <li key={d.id}>
              <FileText size={14} aria-hidden="true" />
              <button type="button" className="sb-e360-link" onClick={() => void open(d)}>{d.file_name}</button>
              <span className="sb-e360-muted">{t(`emp360.ft_${d.doc_type}`)}</span>
              {canWrite && (
                <button type="button" className="sb-e360-icon" aria-label={t('emp360.file_remove')} disabled={remove.isPending}
                  onClick={() => { if (window.confirm(t('emp360.file_remove_confirm', { name: d.file_name }))) remove.mutate(d); }}>
                  <Trash2 size={14} aria-hidden="true" />
                </button>
              )}
            </li>
          ))}
        </ul>
        {employeeId && canWrite && (
          <div className="sb-e360-addfile">
            <select className="sb-team-select" value={docType} onChange={(e) => setDocType(e.target.value as EmployeeDocType)} aria-label={t('emp360.file_kind')}>
              {(['emirates_id', 'passport', 'visa', 'labour_card', 'contract', 'other'] as EmployeeDocType[])
                .filter((k) => gcc || (k !== 'visa' && k !== 'labour_card'))
                .map((k) => <option key={k} value={k}>{k === 'emirates_id' ? idLabel : t(`emp360.ft_${k}`)}</option>)}
            </select>
            <button type="button" className="sb-gc-btn" disabled={upload.isPending} onClick={() => input.current?.click()} data-testid="e360-add-file">
              <Paperclip size={14} aria-hidden="true" /> {upload.isPending ? t('emp360.uploading') : t('emp360.file_add')}
            </button>
            <input ref={input} type="file" hidden accept={EMPLOYEE_FILE_TYPES.join(',')} onChange={pick} />
          </div>
        )}
        {err && <p className="sb-e360-err" role="alert">{err}</p>}
      </div>
    </section>
  );
}
