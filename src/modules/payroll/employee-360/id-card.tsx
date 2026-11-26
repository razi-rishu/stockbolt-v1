/**
 * Employee 360 — the live ID card (left column) and "Connected to" list.
 * Reads the draft, so it changes as the form is typed. Each connection shows
 * whether the person is linked to that part of StockBolt: green linked,
 * grey off, amber missing but useful.
 */
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Camera, MapPin, Trash2 } from 'lucide-react';
import { getAdapter } from '@/data/index';
import { EMPLOYEE_FILE_MAX_BYTES } from '@/data/adapter';
import { initials, packageOf, type Draft } from './draft';

export type ConnState = 'on' | 'off' | 'warn';
export interface Connection { key: string; label: string; value: string; state: ConnState }

const fmt = (n: number) => n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

function usePhotoUrl(path: string | null) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    setUrl(null);
    if (path) getAdapter().employees.fileUrl(path).then((u) => { if (live) setUrl(u); }).catch(() => { /* initials stay */ });
    return () => { live = false; };
  }, [path]);
  return url;
}

export function IdCard({ draft, place, service, photoPath, canEditPhoto, savedYet, busy, onPhoto, onRemovePhoto }: {
  draft: Draft; place: string; service: string; photoPath: string | null;
  canEditPhoto: boolean; savedYet: boolean; busy: boolean;
  onPhoto: (file: File) => void; onRemovePhoto: () => void;
}) {
  const { t } = useTranslation();
  const url = usePhotoUrl(photoPath);
  const input = useRef<HTMLInputElement>(null);
  const [err, setErr] = useState<string | null>(null);

  function pick(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    e.target.value = '';
    if (!f) return;
    if (!['image/png', 'image/jpeg', 'image/webp'].includes(f.type)) { setErr(t('emp360.photo_type')); return; }
    if (f.size > EMPLOYEE_FILE_MAX_BYTES) { setErr(t('emp360.file_size')); return; }
    setErr(null);
    onPhoto(f);
  }

  return (
    <div className="sb-card sb-e360-id" data-testid="e360-id-card">
      <div className="sb-e360-avatar">
        {url ? <img src={url} alt="" /> : <span aria-hidden="true">{initials(draft.name)}</span>}
        {canEditPhoto && (
          <button type="button" className="sb-e360-cam" disabled={!savedYet || busy}
            title={savedYet ? t('emp360.photo_change') : t('emp360.save_first')}
            aria-label={t('emp360.photo_change')} onClick={() => input.current?.click()}>
            <Camera size={14} aria-hidden="true" />
          </button>
        )}
        <input ref={input} type="file" accept="image/png,image/jpeg,image/webp" hidden onChange={pick} data-testid="e360-photo-input" />
      </div>
      {canEditPhoto && photoPath && (
        <button type="button" className="sb-e360-link" disabled={busy} onClick={onRemovePhoto}>
          <Trash2 size={12} aria-hidden="true" /> {t('emp360.photo_remove')}
        </button>
      )}
      {err && <p className="sb-e360-err" role="alert">{err}</p>}
      <p className="sb-e360-name">{draft.name.trim() || t('emp360.new_person')}</p>
      {draft.name_ar.trim() && <p className="sb-e360-sub" dir="rtl">{draft.name_ar}</p>}
      <p className="sb-e360-sub">
        {[draft.designation.trim(), draft.code.trim()].filter(Boolean).join(' · ') || '—'}
      </p>
      {place && <p className="sb-e360-place"><MapPin size={12} aria-hidden="true" /> {place}</p>}
      <span className={`sb-pill ${draft.is_active ? 'sb-pill-good' : 'sb-pill-muted'}`}>
        {draft.is_active ? t('common.active') : t('payOcean.inactive')}
      </span>
      <dl className="sb-e360-facts">
        <div><dt>{t('payOcean.col_service')}</dt><dd>{service || '—'}</dd></div>
        <div><dt>{t('payOcean.package_month')}</dt><dd><bdi dir="ltr">{fmt(packageOf(draft))}</bdi></dd></div>
      </dl>
    </div>
  );
}

export function Connections({ items }: { items: Connection[] }) {
  const { t } = useTranslation();
  return (
    <div className="sb-card sb-e360-conn" data-testid="e360-connections">
      <p className="sb-e360-sec">{t('emp360.connected_to')}</p>
      <ul>
        {items.map((c) => (
          <li key={c.key} data-state={c.state} data-testid={`e360-conn-${c.key}`}>
            <span className={`sb-e360-dot is-${c.state}`} aria-hidden="true" />
            <span className="sb-e360-conn-label">{c.label}</span>
            <span className="sb-e360-conn-value">{c.value}</span>
          </li>
        ))}
      </ul>
      <p className="sb-e360-legend">
        <span><span className="sb-e360-dot is-on" aria-hidden="true" /> {t('emp360.legend_on')}</span>
        <span><span className="sb-e360-dot is-off" aria-hidden="true" /> {t('emp360.legend_off')}</span>
        <span><span className="sb-e360-dot is-warn" aria-hidden="true" /> {t('emp360.legend_warn')}</span>
      </p>
    </div>
  );
}
