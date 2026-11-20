# Razorpay setup — StockBolt subscriptions (phase139)

Razorpay replaces PayPal as the way customers pay for StockBolt. PayPal's code
stays in place, hidden, and can be switched back on with one SQL line (step 10).

Prices stay **$21 / month, $105 / 6 months, $200 / year (USD)**. A company still
in its free year that subscribes has its card **authorised now and first charged
on the day the free year ends**. Money reaches your bank in **INR**.

Do the steps in **Test mode** first (steps 1–9), then repeat 4–7 in **Live mode** (step 11).

---

## 1. Open the Razorpay account
1. Sign up at razorpay.com.
2. Business type: **Individual / Unregistered business** (you can change it when Linqora's registration completes).
3. KYC: your **personal PAN**, an **Indian bank account in your name**, and mobile number. Razorpay may ask for a short video call showing your original PAN card.
4. Website: `https://www.stockbolt.online`. Before you submit, make sure these pages are **public** on the site — Razorpay checks them:
   Terms of service, Privacy policy, **Refund & cancellation policy**, Contact us (with linqora@stockbolt.online).

## 2. Ask for International Payments (needed to charge in USD)
Dashboard → **Account & Settings → International payments** → request activation and answer the questions.
USD subscriptions are card-only (UPI works only in INR).

## 3. Create test API keys
Dashboard (Test mode) → **Account & Settings → API keys → Generate key**.
Copy the **Key ID** (`rzp_test_…`) and **Key Secret**. Keep the secret private.

## 4. Create the three plans
Dashboard → **Subscriptions → Plans → Create plan**, three times:

| Plan name | Billing frequency | Amount | Currency |
|---|---|---|---|
| StockBolt Professional — monthly | every **1 month** | 21 | USD |
| StockBolt Professional — 6 months | every **6 months** | 105 | USD |
| StockBolt Professional — yearly | every **1 year** | 200 | USD |

Copy each **Plan ID** (`plan_…`).

## 5. Put the plan IDs into StockBolt
Supabase SQL editor (replace the three IDs):
```sql
UPDATE public.subscription_plans
   SET provider_plan_ids = jsonb_set(provider_plan_ids, '{razorpay}',
         '{"monthly":"plan_XXXXXXXX","half_yearly":"plan_YYYYYYYY","yearly":"plan_ZZZZZZZZ"}'::jsonb)
 WHERE code = 'professional';
```

## 6. Add the webhook
Dashboard → **Account & Settings → Webhooks → Add new webhook**
- URL: `https://www.stockbolt.online/api/razorpay/webhook`
- Secret: make up a long random secret and copy it (step 7 needs it)
- Events: `subscription.authenticated`, `subscription.activated`, `subscription.charged`,
  `subscription.pending`, `subscription.halted`, `subscription.paused`, `subscription.resumed`,
  `subscription.cancelled`, `subscription.completed`, `refund.processed`

## 7. Vercel environment variables
Vercel → stockbolt project → **Settings → Environment Variables** (Production):
- `RAZORPAY_KEY_ID` = Key ID from step 3
- `RAZORPAY_KEY_SECRET` = Key Secret from step 3
- `RAZORPAY_WEBHOOK_SECRET` = the secret from step 6
- `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` — already there if PayPal was set up; add them if not.

Then **Redeploy** the latest deployment so the functions see them.

## 8. Apply phase139 on prod
Supabase SQL editor, file `supabase/migrations/20261119000001_phase139_razorpay_provider.sql`:
1. run the PRE-CHECK at the top (at most one active provider),
2. run the whole file,
3. run the "Verify after applying" queries at the bottom.

## 9. Switch customers to Razorpay and test
```sql
SELECT public.set_billing_provider('razorpay');
```
Settings → Billing & Subscription → **Subscribe** opens Razorpay Checkout. In Test mode pay with a
**test card from Razorpay's test-card list** (Razorpay docs → Test card details). Then check:
- the Billing page says the card is saved (free year) or the plan is active,
- Razorpay dashboard → Webhooks shows the events delivered with **200**.

## 10. Switching provider later
```sql
SELECT public.set_billing_provider('razorpay');  -- customers pay with Razorpay
SELECT public.set_billing_provider('paypal');    -- back to PayPal (see docs/PayPal_Setup_Steps.md)
SELECT public.set_billing_provider(NULL);        -- no Subscribe button at all
```
A company that already subscribed keeps its provider: its Cancel button always goes to the
provider it paid with.

Charge at checkout instead of after the free year:
```sql
UPDATE public.payment_provider_configs
   SET public_config = public_config || '{"charge_after_trial": false}'::jsonb
 WHERE provider = 'razorpay';
```

## 11. Go live
1. Finish KYC; switch the dashboard to **Live mode**.
2. Generate **live** API keys (`rzp_live_…`) → update `RAZORPAY_KEY_ID` / `RAZORPAY_KEY_SECRET` in Vercel.
3. Re-create the three plans in Live mode (plan IDs differ) → run step 5 again with the live IDs.
4. Add the webhook again in Live mode (step 6) → update `RAZORPAY_WEBHOOK_SECRET` in Vercel.
5. Redeploy. Mark the mode in StockBolt:
   ```sql
   UPDATE public.payment_provider_configs SET mode = 'live' WHERE provider = 'razorpay';
   ```
