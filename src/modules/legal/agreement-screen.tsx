/**
 * phase135 — "Updated Terms & Privacy Policy". Shown by LegalGate (and at
 * /legal/accept) when the signed-in user owes acceptance.
 *
 * Acceptance is recorded only by accept_legal() on the server, for this user,
 * for the versions and fingerprints this build displays. If the server has a
 * newer text than this build (an old Android app), the user is asked to
 * update instead — they cannot accept a document they were not shown.
 * Declining records a decline and nothing else: the account and records stay,
 * and logout, support, export and the deletion request remain available.
 */
import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { LogOut } from 'lucide-react';
import { getAdapter } from '@/data/index';
import { useAuthStore } from '@/store/auth';
import { isNative } from '@/lib/platform';
import { BrandLogo } from '@/components/brand-logo';
import { LegalLink } from '@/components/legal-link';
import { legalFingerprints } from '@/legal/texts';
import type { LegalDocumentStatus, LegalDocType } from '@/data/adapter';
import { useLegalStatus } from './legal-gate';
import '@/styles/stockbolt-ocean-teal.css';

async function appVersion(): Promise<string | null> {
  if (!isNative()) return null;
  try { const { App } = await import('@capacitor/app'); return (await App.getInfo()).version; } catch { return null; }
}

export function AgreementScreen() {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { company_id, role, email, clear } = useAuthStore();
  const { data: status, refetch } = useLegalStatus();
  const [local, setLocal] = useState<Record<LegalDocType, string> | null>(null);
  useEffect(() => { void legalFingerprints().then(setLocal); }, []);
  const { data: company } = useQuery({
    queryKey: ['company', company_id],
    queryFn: () => getAdapter().companies.getById(company_id!),
    enabled: !!company_id && role === 'admin',
  });

  const [agreeTerms, setAgreeTerms] = useState(false);
  const [ackPrivacy, setAckPrivacy] = useState(false);
  const [forCompany, setForCompany] = useState(false);
  const [showOptions, setShowOptions] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Terms first, then Privacy — the order the checkboxes below follow.
  const owed: LegalDocumentStatus[] = (status?.documents ?? []).filter((d) => d.requires_acceptance && !d.accepted)
    .sort((a, b) => (a.doc_type === 'terms' ? -1 : b.doc_type === 'terms' ? 1 : 0));
  const needs = (d: LegalDocType) => owed.some((o) => o.doc_type === d);
  // This build must display exactly the text the server has published.
  const outdated = !!local && owed.some((o) => local[o.doc_type] !== o.sha256);
  const platform = isNative() ? 'android' as const : 'web' as const;

  const accept = useMutation({
    mutationFn: async () => getAdapter().legal.accept(
      owed.map((o) => ({ doc_type: o.doc_type, version: o.version, sha256: o.sha256 })),
      { onBehalfOfCompany: forCompany, platform, appVersion: await appVersion() },
    ),
    onSuccess: async () => {
      setError(null);
      await qc.invalidateQueries({ queryKey: ['legal'] });
      navigate(window.location.pathname === '/legal/accept' ? '/dashboard' : window.location.pathname, { replace: true });
    },
    onError: (e: Error) => {
      setError(/stale_document/.test(e.message) ? t('legal.err_stale') : t('legal.err_save'));
      void refetch();
    },
  });
  const decline = useMutation({
    mutationFn: async () => getAdapter().legal.decline({ platform, appVersion: await appVersion() }),
    onSuccess: () => { setError(null); void qc.invalidateQueries({ queryKey: ['legal'] }); },
    onError: () => setError(t('legal.err_save')),
  });

  async function logout() {
    await getAdapter().auth.signOut();
    clear();
    navigate('/login', { replace: true });
  }

  const summary = (d: LegalDocumentStatus) => (i18n.language === 'ar' ? d.change_summary_ar || d.change_summary_en : d.change_summary_en);
  const date = (iso: string) => new Date(iso).toLocaleDateString(i18n.language === 'ar' ? 'ar' : undefined, { dateStyle: 'long' });
  const declined = owed.some((d) => d.declined);
  const canAgree = owed.length > 0 && (!needs('terms') || agreeTerms) && (!needs('privacy') || ackPrivacy)
    && !outdated && !accept.isPending;

  return (
    <div className="sb-ocean sb-page" style={{ minHeight: '100vh', display: 'flex', justifyContent: 'center', padding: '24px 16px' }}>
      <main className="sb-card" style={{ width: '100%', maxWidth: 640, padding: 24, alignSelf: 'flex-start' }} aria-labelledby="legal-heading">
        <BrandLogo mark={30} text={15} />
        <h1 id="legal-heading" className="sb-title" style={{ margin: '18px 0 6px' }}>{t('legal.heading')}</h1>
        <p className="sb-form-hint" style={{ marginTop: 0 }}>{owed.length ? t('legal.intro') : t('legal.nothing_owed')}</p>
        {status && owed.length === 0 && <Link to="/dashboard" className="sb-primary-btn sb-btn-inline">{t('legal.continue')}</Link>}

        <ul style={{ listStyle: 'none', padding: 0, display: 'flex', flexDirection: 'column', gap: 10 }}>
          {owed.map((d) => (
            <li key={d.doc_type} className="sb-info-note" style={{ margin: 0 }}>
              <strong>{t(`legal.${d.doc_type}`)}</strong>{' · '}
              {t('legal.version_effective', { version: d.version, date: date(d.effective_at) })}
              {summary(d) && <p style={{ margin: '6px 0 0' }}>{summary(d)}</p>}
              <p style={{ margin: '6px 0 0' }}>
                <LegalLink to={d.doc_type === 'terms' ? '/terms' : '/privacy'} className="underline">{t('legal.read_full', { doc: t(`legal.${d.doc_type}`) })}</LegalLink>
              </p>
            </li>
          ))}
        </ul>

        {outdated && <p className="sb-alert sb-alert-warn" role="alert">{t('legal.outdated_app')}</p>}

        {!outdated && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginTop: 16 }}>
            {needs('terms') && (
              <label className="sb-check-row">
                <input type="checkbox" checked={agreeTerms} onChange={(e) => setAgreeTerms(e.target.checked)} />
                <span className="sb-check-text">{t('legal.agree_terms')}</span>
              </label>
            )}
            {needs('privacy') && (
              <label className="sb-check-row">
                <input type="checkbox" checked={ackPrivacy} onChange={(e) => setAckPrivacy(e.target.checked)} />
                <span className="sb-check-text">{t('legal.ack_privacy')}</span>
              </label>
            )}
            {needs('terms') && role === 'admin' && company && (
              <label className="sb-check-row">
                <input type="checkbox" checked={forCompany} onChange={(e) => setForCompany(e.target.checked)} />
                <span className="sb-check-text">{t('legal.for_company', { company: company.name })}</span>
              </label>
            )}
          </div>
        )}

        {declined && <p className="sb-alert sb-alert-warn" role="status">{t('legal.declined_note')}</p>}
        {error && <p className="sb-alert sb-alert-danger" role="alert">{error}</p>}

        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 18 }}>
          {outdated
            ? <button type="button" className="sb-primary-btn" onClick={() => window.location.reload()}>{t('legal.reload')}</button>
            : (
              <button type="button" className="sb-primary-btn" disabled={!canAgree}
                onClick={() => accept.mutate()}>
                {accept.isPending ? t('legal.saving') : t('legal.agree_continue')}
              </button>
            )}
          <button type="button" className="sb-secondary-btn" aria-expanded={showOptions} onClick={() => setShowOptions((v) => !v)}>
            {t('legal.other_options')}
          </button>
          <button type="button" className="sb-secondary-btn sb-btn-inline" onClick={() => void logout()}>
            <LogOut size={16} aria-hidden="true" /> {t('legal.logout')}
          </button>
        </div>

        {showOptions && (
          <section aria-label={t('legal.other_options')} className="sb-info-note" style={{ marginTop: 16 }}>
            <p style={{ marginTop: 0 }}>{t('legal.options_intro')}</p>
            <ul style={{ margin: 0, paddingInlineStart: 18 }}>
              {role === 'admin' && <li><Link to="/settings/import-export">{t('legal.opt_export')}</Link></li>}
              <li><Link to="/support">{t('legal.opt_support')}</Link></li>
              <li><LegalLink to="/delete-account">{t('legal.opt_delete')}</LegalLink></li>
              <li><LegalLink to="/privacy">{t('legal.opt_privacy')}</LegalLink></li>
            </ul>
            {needs('terms') && !declined && (
              <button type="button" className="sb-secondary-btn" style={{ marginTop: 12 }} disabled={decline.isPending}
                onClick={() => { if (window.confirm(t('legal.confirm_decline'))) decline.mutate(); }}>
                {t('legal.decline')}
              </button>
            )}
          </section>
        )}

        <p className="sb-form-hint" style={{ marginTop: 16 }}>{t('legal.signed_in_as', { email: email ?? '' })}</p>
      </main>
    </div>
  );
}

export default function AgreementPage() {
  return <AgreementScreen />;
}
