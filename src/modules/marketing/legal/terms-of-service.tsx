/**
 * Public Terms of Service (/terms). Until LEGAL_DOCS_PUBLISHED is true the
 * Terms are drafts awaiting founder details and legal review, so this page
 * says so instead of presenting a draft as if it were in force.
 */
import { Link } from 'react-router-dom';
import { LEGAL_DOCS_PUBLISHED, SUPPORT_EMAIL } from '@/lib/legal';
import { LegalLayout } from './legal-layout';
import { LegalDocument } from './legal-document';

export default function TermsOfServicePage() {
  if (LEGAL_DOCS_PUBLISHED) return <LegalDocument doc="terms" title="Terms of Service" />;
  return (
    <LegalLayout title="Terms of Service" updated="Being finalised">
      <p>
        StockBolt&apos;s Terms of Service are being finalised. Before they take effect they will be published here,
        and existing users will be told in the app and asked to accept them.
      </p>
      <p>
        Until then, read the <Link to="/privacy">Privacy Policy</Link>, and contact us at{' '}
        <a href={`mailto:${SUPPORT_EMAIL}`}>{SUPPORT_EMAIL}</a> with any question.
      </p>
    </LegalLayout>
  );
}
