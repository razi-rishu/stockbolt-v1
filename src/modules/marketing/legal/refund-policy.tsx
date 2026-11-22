import { Link } from 'react-router-dom';
import { OPERATOR_NAME, SUPPORT_EMAIL } from '@/lib/legal';
import { LegalLayout } from './legal-layout';

/**
 * Public Refund & Cancellation Policy (/refund-policy) — required by Razorpay
 * for payment activation and linked from the website footer. Rule chosen by
 * the founder 2026-11-22: cancel anytime, no refunds for unused time except
 * where the law requires one or a charge was made in error.
 *
 * Keep it true to what the code does (api/razorpay/*): cancelling a paid plan
 * stops renewal at the end of the paid period (cancel_at_cycle_end); cancelling
 * during the free year ends the subscription before any charge; a failed
 * renewal gets 7 days while Razorpay retries the card, then the subscription
 * is suspended. Prices come from subscription_plans.
 */
export default function RefundPolicyPage() {
  return (
    <LegalLayout title="Refund & Cancellation Policy">
      <p>
        This policy explains how StockBolt subscriptions are charged, how to cancel and when we give refunds.
        StockBolt is operated by {OPERATOR_NAME} (“we”, “us”).
      </p>

      <h2>Free first year</h2>
      <p>
        Every new company gets its first 12 months of StockBolt free, with every module included. You do not
        need a payment card to sign up, and nothing is charged during the free year.
      </p>

      <h2>Paid plans</h2>
      <p>After the free year, StockBolt Professional is available at:</p>
      <ul>
        <li><strong>US$21</strong> per month,</li>
        <li><strong>US$105</strong> every 6 months, or</li>
        <li><strong>US$200</strong> per year.</li>
      </ul>
      <p>
        Payments are processed by <strong>Razorpay</strong>. Your card details are entered with Razorpay; we never
        see or store them. If you subscribe while your free year is still running, your card is saved now and
        first charged on the day your free year ends. A subscription renews automatically at the end of each
        billing period until you cancel it. You will always see the price and billing period before you agree
        to pay.
      </p>

      <h2>Cancelling</h2>
      <ul>
        <li>You can cancel at any time in StockBolt, under <strong>Settings → Billing &amp; Subscription → Cancel</strong>, or by emailing us.</li>
        <li>If you cancel a paid plan, it is not renewed: your company keeps full access until the end of the period you have already paid for, and you are not charged again.</li>
        <li>If you cancel during your free year, your saved card is never charged.</li>
        <li>Your records stay yours. You can export them from StockBolt at any time while you have access.</li>
      </ul>

      <h2>Refunds</h2>
      <ul>
        <li>We do not give refunds for the unused part of a billing period after you cancel, or for a period in which you did not use StockBolt.</li>
        <li>We <strong>will</strong> refund a payment that was charged in error — for example a duplicate charge, or a charge after you had already cancelled.</li>
        <li>We will also give a refund wherever the law that applies to you requires one. Nothing in this policy limits the rights you have under that law.</li>
        <li>Approved refunds go back to the card or account you paid with, through Razorpay. Razorpay usually completes a refund within 5–7 working days; your bank may take longer to show it.</li>
      </ul>

      <h2>Failed payments</h2>
      <p>
        If a renewal payment fails, Razorpay tries your card again over the next few days and we tell you in
        StockBolt. If the payment still fails after 7 days, your subscription may be suspended until it is
        paid.
      </p>

      <h2>Contact us</h2>
      <p>
        For a refund request or any billing question, email{' '}
        <a href={`mailto:${SUPPORT_EMAIL}?subject=${encodeURIComponent('StockBolt billing')}`}>{SUPPORT_EMAIL}</a>{' '}
        with your company name and the payment date, or see our <Link to="/contact">Contact page</Link>.
      </p>
      <p>
        See also our <Link to="/terms">Terms of Service</Link> and <Link to="/privacy">Privacy Policy</Link>.
      </p>
    </LegalLayout>
  );
}
