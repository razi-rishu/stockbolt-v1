import { Link } from 'react-router-dom';
import { CONTACT_CITY, CONTACT_PHONE, OPERATOR_NAME, SUPPORT_EMAIL } from '@/lib/legal';
import { LegalLayout } from './legal-layout';

/**
 * Public Contact page (/contact) — Razorpay checks for one before activating
 * payments; linked from the website footer. Details live in src/lib/legal.ts.
 */
export default function ContactPage() {
  return (
    <LegalLayout title="Contact us" updated={<>StockBolt is operated by {OPERATOR_NAME}.</>}>
      <p>We are happy to help with questions about StockBolt, your account, billing or a refund.</p>
      <ul>
        <li>
          <strong>Email:</strong>{' '}
          <a href={`mailto:${SUPPORT_EMAIL}?subject=${encodeURIComponent('StockBolt')}`}>{SUPPORT_EMAIL}</a>
        </li>
        {CONTACT_PHONE && (
          <li>
            <strong>Phone / WhatsApp:</strong>{' '}
            <a href={`tel:${CONTACT_PHONE.replace(/[^+\d]/g, '')}`} dir="ltr">{CONTACT_PHONE}</a>
          </li>
        )}
        {CONTACT_CITY && <li><strong>Location:</strong> {CONTACT_CITY}</li>}
      </ul>
      <p>
        If you already use StockBolt, you can also open a request in the app under <strong>Help &amp; Support</strong>,
        so we can see which company it is about.
      </p>
      <p>
        See also our <Link to="/refund-policy">Refund &amp; Cancellation Policy</Link>,{' '}
        <Link to="/terms">Terms of Service</Link> and <Link to="/privacy">Privacy Policy</Link>.
      </p>
    </LegalLayout>
  );
}
