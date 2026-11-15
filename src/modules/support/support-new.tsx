/**
 * phase133 — raise a support request (assistance, bug, feature, feedback).
 *
 * The server takes the user and company from the session; nothing here can
 * name another user or company. A fixed request id per form means a double
 * click, or a retry after a lost response, returns the first ticket instead
 * of creating a second one.
 */
import { useRef, useState } from 'react';
import { useForm } from 'react-hook-form';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate, useParams, Navigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Paperclip, Send, ShieldAlert, X } from 'lucide-react';
import { getAdapter } from '@/data/index';
import { OceanPage } from '@/components/ocean-list';
import { BackButton } from '@/ui/back-button';
import { useUnsavedChangesGuard } from '@/hooks/use-unsaved-changes-guard';
import { checkSupportFile, SUPPORT_MAX_FILES, type CheckedFile } from '@/lib/support-files';
import type { SupportCategory } from '@/data/adapter';
import { CATEGORIES, MODULES, supportErrorText } from './labels';
import '@/styles/stockbolt-ocean-teal.css';

interface FormValues { subject: string; description: string; module: string; contact_preference: 'in_app' | 'email' }

export default function SupportNewPage() {
  const { category } = useParams<{ category: string }>();
  if (!CATEGORIES.some((c) => c.key === category)) return <Navigate to="/support" replace />;
  return <SupportForm category={category as SupportCategory} />;
}

function SupportForm({ category }: { category: SupportCategory }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const requestId = useRef(crypto.randomUUID());
  const [files, setFiles] = useState<CheckedFile[]>([]);
  const [fileError, setFileError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const { register, handleSubmit, formState: { errors, isDirty } } = useForm<FormValues>({
    defaultValues: { subject: '', description: '', module: '', contact_preference: 'in_app' },
  });
  const confirmLeave = useUnsavedChangesGuard(isDirty || files.length > 0);

  async function addFiles(list: FileList | null) {
    setFileError(null);
    if (!list) return;
    const next = [...files];
    for (const f of Array.from(list)) {
      if (next.length >= SUPPORT_MAX_FILES) { setFileError(t('support.err_too_many_files')); break; }
      const r = await checkSupportFile(f);
      if (typeof r === 'string') { setFileError(t(`support.file_${r}`, { name: f.name })); continue; }
      next.push(r);
    }
    setFiles(next);
  }

  const submit = useMutation({
    mutationFn: async (v: FormValues) => {
      const created = await getAdapter().support.createTicket({
        category, subject: v.subject.trim(), description: v.description.trim(),
        module: v.module || null, contact_preference: v.contact_preference, client_request_id: requestId.current,
      });
      // A repeated submit returns the same ticket: its files are already there.
      let uploadFailed = false;
      if (!created.duplicate) {
        for (const f of files) {
          try { await getAdapter().support.uploadAttachment(created.id, null, f.file, f.mime); }
          catch { uploadFailed = true; }
        }
      }
      return { ...created, uploadFailed };
    },
    onSuccess: (r) => {
      qc.invalidateQueries({ queryKey: ['support'] });
      navigate(`/support/tickets/${r.id}`, { replace: true, state: { created: r.ticket_number, uploadFailed: r.uploadFailed } });
    },
    onError: (e) => setError(supportErrorText(t, e)),
  });

  const req = (k: string) => ({ required: t(k) });
  return (
    <OceanPage
      testid="support-new"
      narrow
      title={t(`support.cat_${category}`)}
      subtitle={t(`support.cat_${category}_sub`)}
      back={<BackButton to="/support" label={t('support.title')} confirm={confirmLeave} />}
    >
      <form className="sb-card sb-form sb-doc-card space-y-4" noValidate
        onSubmit={handleSubmit((v) => { setError(null); submit.mutate(v); })}>
        <p className="sb-alert sb-alert-warn" style={{ fontWeight: 400, display: 'flex', gap: 8, margin: 0 }}>
          <ShieldAlert size={18} aria-hidden="true" style={{ flexShrink: 0 }} /> {t('support.privacy_warning')}
        </p>

        <label className="sb-flabel" htmlFor="sp-subject">{t('support.f_subject')} <span className="text-danger-500" aria-hidden="true">*</span></label>
        <input id="sp-subject" className="sb-pc-select" style={{ width: '100%' }} maxLength={200} aria-required="true"
          aria-invalid={!!errors.subject}
          {...register('subject', { ...req('support.err_subject'), validate: (v) => v.trim().length >= 3 || t('support.err_subject') })} />
        {errors.subject && <p className="sb-wiz-err" role="alert">{errors.subject.message}</p>}

        <label className="sb-flabel" htmlFor="sp-desc">{t('support.f_description')} <span className="text-danger-500" aria-hidden="true">*</span></label>
        <textarea id="sp-desc" rows={7} className="sb-pc-select" style={{ width: '100%', minHeight: 140 }} maxLength={10000}
          aria-required="true" aria-invalid={!!errors.description} placeholder={t(`support.desc_ph_${category}`)}
          {...register('description', { ...req('support.err_description'), validate: (v) => v.trim().length >= 10 || t('support.err_description') })} />
        {errors.description && <p className="sb-wiz-err" role="alert">{errors.description.message}</p>}

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div>
            <label className="sb-flabel" htmlFor="sp-module">{t('support.f_module')}</label>
            <select id="sp-module" className="sb-pc-select" style={{ width: '100%' }} {...register('module')}>
              <option value="">{t('support.module_none')}</option>
              {MODULES.map((m) => <option key={m} value={m}>{t(`support.mod_${m}`)}</option>)}
            </select>
          </div>
          <div>
            <label className="sb-flabel" htmlFor="sp-contact">{t('support.f_contact')}</label>
            <select id="sp-contact" className="sb-pc-select" style={{ width: '100%' }} {...register('contact_preference')}>
              <option value="in_app">{t('support.contact_in_app')}</option>
              <option value="email">{t('support.contact_email')}</option>
            </select>
          </div>
        </div>

        <div>
          <label className="sb-secondary-btn sb-btn-inline" style={{ cursor: 'pointer' }}>
            <Paperclip size={16} aria-hidden="true" /> {t('support.add_files')}
            <input type="file" multiple accept="image/png,image/jpeg,image/webp,application/pdf" className="sr-only"
              onChange={(e) => { void addFiles(e.target.files); e.target.value = ''; }} />
          </label>
          <p className="sb-form-hint" style={{ margin: '6px 0 0' }}>{t('support.files_hint')}</p>
          {fileError && <p className="sb-wiz-err" role="alert">{fileError}</p>}
          {files.length > 0 && (
            <ul className="sb-support-files">
              {files.map((f, i) => (
                <li key={i}>
                  <span>{f.file.name}</span>
                  <button type="button" aria-label={t('support.remove_file', { name: f.file.name })}
                    onClick={() => setFiles(files.filter((_, k) => k !== i))}><X size={14} aria-hidden="true" /></button>
                </li>
              ))}
            </ul>
          )}
        </div>

        {error && <p className="sb-alert sb-alert-danger" role="alert">{error}</p>}
        <div className="flex justify-end gap-2">
          <button type="button" className="sb-secondary-btn" onClick={() => { if (confirmLeave()) navigate('/support'); }}>{t('common.cancel')}</button>
          <button type="submit" className="sb-primary-btn sb-btn-inline" disabled={submit.isPending}>
            <Send size={16} aria-hidden="true" /> {submit.isPending ? t('support.sending') : t('support.submit')}
          </button>
        </div>
      </form>
    </OceanPage>
  );
}
