import { Link } from 'react-router-dom';
import { OPERATOR_NAME, SUPPORT_EMAIL } from '@/lib/legal';
import { LegalLayout } from './legal-layout';

/**
 * Public Privacy Policy (/privacy) — required by Google Play and linked from
 * the website footer. Keep it true to what the code does: when a new data
 * flow or processor is added (analytics, error tracking, a new payment
 * provider), update this page and LEGAL_UPDATED in the same change.
 */
export default function PrivacyPolicyPage() {
  return (
    <LegalLayout title="Privacy Policy">
      <p>
        StockBolt is an accounting and inventory system for auto-parts businesses, available at{' '}
        <a href="https://www.stockbolt.online">stockbolt.online</a> and as the StockBolt Android app. It is
        operated by {OPERATOR_NAME} (“we”, “us”). This policy explains what information StockBolt handles, why,
        and the choices you have. The website and the Android app use the same account and the same data.
      </p>

      <h2>Information we collect</h2>
      <ul>
        <li><strong>Account information</strong> — your name, email address and password (stored only as a secure hash by our authentication provider). If you sign in with Google, we receive your name and email address from Google.</li>
        <li><strong>Business records you enter</strong> — your company profile, customers and suppliers (names, contact details, tax numbers), products and stock, quotes, invoices, bills, payments, bank accounts, accounting entries and, if you use payroll, employee details. You decide what you enter; we process it only to provide StockBolt to you.</li>
        <li><strong>Files you upload</strong> — company logos, product images and import files.</li>
        <li><strong>Technical information</strong> — the sign-in session kept on your device so you stay logged in, and standard server logs (such as IP address and request time) kept by our hosting providers for security and reliability.</li>
      </ul>
      <p>We do not use advertising, we do not use third-party analytics or tracking, and we do not sell your information.</p>

      <h2>How we use it</h2>
      <ul>
        <li>To provide StockBolt: sign you in, store and show your company’s records, and produce documents and reports.</li>
        <li>To keep accounts secure and each company’s data separate from every other company’s.</li>
        <li>To provide support and to process subscription payments.</li>
        <li>To meet legal obligations.</li>
      </ul>

      <h2>Who processes it</h2>
      <p>We use these service providers, only to run StockBolt:</p>
      <ul>
        <li><strong>Supabase</strong> — database, sign-in and file storage.</li>
        <li><strong>Vercel</strong> — website hosting.</li>
        <li><strong>Google</strong> — “Sign in with Google”, if you choose it.</li>
        <li><strong>PayPal</strong> — subscription payments made on the website. Card and bank details are entered with PayPal; we never see or store them.</li>
      </ul>
      <p>Documents you choose to share (for example an invoice PDF sent through WhatsApp or email) go to the app and the people you pick.</p>

      <h2>Security</h2>
      <p>
        All data travels over encrypted connections (HTTPS). Each company’s records are isolated at the database
        level, so users only see the company they belong to, with access limited by the roles set up by that company.
      </p>

      <h2>Android app permissions</h2>
      <p>
        The app uses internet access to reach your account. When you print, share a PDF or export a file, Android’s
        own print and share screens are used; the app does not read your contacts, photos, location, camera or
        microphone.
      </p>

      <h2>How long we keep it</h2>
      <p>
        We keep your information while your account is active. When an account is deleted we remove its information
        within 30 days, except where the law requires us to keep something for longer (for example records needed to
        resolve a dispute or for tax purposes), and except copies in encrypted backups, which expire on their normal
        schedule.
      </p>

      <h2>Your choices and rights</h2>
      <ul>
        <li>You can view, correct and export your company’s records at any time (Settings → Import / Export → Download my data).</li>
        <li>You can ask us to delete your account — see <Link to="/delete-account">Delete your account</Link>.</li>
        <li>You can ask us what information we hold about you, or for it to be corrected, by emailing us.</li>
      </ul>

      <h2>Children</h2>
      <p>StockBolt is a business tool for adults. It is not directed at children under 18, and we do not knowingly collect their information.</p>

      <h2>Changes to this policy</h2>
      <p>If we change this policy we will update the date above, and for significant changes we will tell account owners by email or in the app.</p>

      <h2>Contact</h2>
      <p>
        {OPERATOR_NAME} — <a href={`mailto:${SUPPORT_EMAIL}`}>{SUPPORT_EMAIL}</a>
      </p>
    </LegalLayout>
  );
}
