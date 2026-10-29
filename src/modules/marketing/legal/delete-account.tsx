import { Link } from 'react-router-dom';
import { useAuthStore } from '@/store/auth';
import { OPERATOR_NAME, SUPPORT_EMAIL, deletionRequestMailto } from '@/lib/legal';
import { LegalLayout } from './legal-layout';

/**
 * Public "Delete your account" page (/delete-account) — Google Play requires
 * a web link where users can request deletion, and the app's menu opens the
 * same page. Deletion is a request we process by hand: removing a company
 * ends its books for good, so it is never a one-tap action inside the app.
 */
export default function DeleteAccountPage() {
  const email = useAuthStore((s) => s.email);

  return (
    <LegalLayout title="Delete your StockBolt account">
      <p>
        You can ask {OPERATOR_NAME} to delete your StockBolt account at any time. This works the same whether you use
        the website or the Android app.
      </p>

      <h2>How to request deletion</h2>
      <ul>
        <li>Send an email from the address you sign in with to <a href={`mailto:${SUPPORT_EMAIL}`}>{SUPPORT_EMAIL}</a> with the subject “StockBolt account deletion request”, and include your company name.</li>
        <li>We may reply to confirm the request really comes from you before deleting anything.</li>
        <li>We complete the deletion within 30 days and email you when it is done.</li>
      </ul>
      <p>
        <a
          href={deletionRequestMailto(email)}
          className="!no-underline inline-flex items-center rounded-xl bg-danger-600 px-5 py-3 text-sm font-semibold !text-white"
        >
          Request account deletion
        </a>
      </p>

      <h2>What is deleted</h2>
      <ul>
        <li>Your login: name, email address and password, and the link to Google sign-in if you used it.</li>
        <li>If you are the company owner: the company and all its records — customers, suppliers, products, stock, invoices, bills, payments, accounting entries, payroll data — and uploaded files such as logos and product images.</li>
        <li>If you are a team member of someone else’s company: only your own login. The company’s records belong to its owner and stay with them.</li>
      </ul>

      <h2>What may be kept</h2>
      <p>
        Information the law requires us to keep (for example payment records needed for tax) may be kept for the period
        the law requires. Copies in encrypted backups expire on their normal schedule. Nothing is kept for any other
        purpose.
      </p>

      <h2>Before you delete</h2>
      <p>
        Deletion cannot be undone. Accounting records are often needed for tax filings, so download a copy first:
        sign in, then Settings → Import / Export → Download my data.
      </p>

      <p className="text-sm text-ink-secondary">
        See also our <Link to="/privacy">Privacy Policy</Link>.
      </p>
    </LegalLayout>
  );
}
