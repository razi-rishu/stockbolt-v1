/**
 * Approvals (phase145) — choose who approves ("Send to", "Forward", "Pass on").
 * Lists everyone with authority for the document type, the default (nearest
 * manager who can approve) first and pre-selected. People who can't approve
 * right now are shown greyed out with the reason, so the admin knows what to fix.
 */
import { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Search } from 'lucide-react';
import { Modal } from '@/ui/modal';
import { getAdapter } from '@/data/index';
import type { ApprovalDocType, ApproverRow } from '@/data/adapter';
import { moneyLabel } from '@/lib/currency-display';
import { useCompanyCurrency } from '@/hooks/use-company-currency';
import { problemLabel } from './approval-lists';

export function ApproverPickerModal({ open, docType, title, intro, confirmLabel, exclude = [], pending, error, onConfirm, onClose }: {
  open: boolean;
  docType: ApprovalDocType;
  title: string;
  intro?: string;
  confirmLabel: string;
  exclude?: (string | null | undefined)[];
  pending: boolean;
  error: string | null;
  onConfirm: (employee_id: string, note: string) => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const base = useCompanyCurrency();
  const q = useQuery<ApproverRow[]>({
    queryKey: ['approvers', docType],
    queryFn: () => getAdapter().approvals.listApprovers(docType),
    enabled: open,
  });
  const people = useMemo(() => (q.data ?? []).filter((p) => !exclude.includes(p.employee_id)), [q.data, exclude]);
  const [pick, setPick] = useState('');
  const [note, setNote] = useState('');
  const [search, setSearch] = useState('');

  useEffect(() => {
    if (!open) { setPick(''); setNote(''); setSearch(''); return; }
    const def = people.find((p) => p.is_default && !p.problem) ?? people.find((p) => !p.problem);
    if (def && !pick) setPick(def.employee_id);
  }, [open, people, pick]);

  const shown = people.filter((p) => {
    const s = search.trim().toLowerCase();
    return !s || (p.code ?? '').toLowerCase().includes(s) || p.name.toLowerCase().includes(s);
  });

  return (
    <Modal open={open} onClose={onClose} title={title} width="lg">
      <div className="sb-ocean sb-appr-pick" data-testid="approver-picker">
        {intro && <p className="sb-team-muted">{intro}</p>}
        <label className="sb-team-search">
          <Search size={16} aria-hidden="true" />
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder={t('apprOcean.search_people')} aria-label={t('apprOcean.search_people')} />
        </label>
        {q.isLoading ? <p className="sb-team-muted">{t('common.loading')}</p>
          : q.isError ? <p className="sb-alert sb-alert-danger" role="alert">{(q.error as Error).message}</p>
          : people.length === 0 ? <p className="sb-alert sb-alert-warn" role="status">{t('apprOcean.no_approvers')}</p>
          : (
            <ul className="sb-appr-people" role="radiogroup" aria-label={title}>
              {shown.map((p) => (
                <li key={p.employee_id}>
                  <label className={`sb-appr-person ${pick === p.employee_id ? 'is-on' : ''} ${p.problem ? 'is-off' : ''}`}>
                    <input type="radio" name="approver" value={p.employee_id} checked={pick === p.employee_id}
                      disabled={!!p.problem} onChange={() => setPick(p.employee_id)} data-testid={`approver-${p.code}`} />
                    <bdi dir="ltr" className="sb-team-code">{p.code}</bdi>
                    <span className="sb-team-row-main">
                      <span className="sb-team-row-name">{p.name}{p.is_default && !p.problem ? <span className="sb-team-tag is-top">{t('apprOcean.default')}</span> : null}</span>
                      <span className="sb-team-muted">
                        {p.problem ? problemLabel(t, p.problem)
                          : p.max_amount == null ? t('apprOcean.no_limit') : t('apprOcean.up_to', { amount: moneyLabel(p.max_amount, base) })}
                      </span>
                    </span>
                  </label>
                </li>
              ))}
            </ul>
          )}
        <label className="sb-gc-field">
          <span className="sb-gc-label">{t('apprOcean.note')}</span>
          <textarea className="sb-appr-note" rows={2} maxLength={500} value={note} onChange={(e) => setNote(e.target.value)}
            placeholder={t('apprOcean.note_hint')} />
        </label>
        {error && <p className="sb-alert sb-alert-danger" role="alert">{error}</p>}
        <div className="sb-gc-actions">
          <button type="button" className="sb-primary-btn" disabled={!pick || pending} onClick={() => onConfirm(pick, note)} data-testid="approver-confirm">
            {pending ? t('apprOcean.sending') : confirmLabel}
          </button>
          <button type="button" className="sb-secondary-btn" disabled={pending} onClick={onClose}>{t('apprOcean.cancel')}</button>
        </div>
      </div>
    </Modal>
  );
}
