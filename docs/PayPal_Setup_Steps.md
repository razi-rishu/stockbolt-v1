# PayPal Setup — step-by-step (SaaS M3)

> Do everything in **SANDBOX first**, test end-to-end, then repeat the same steps in **LIVE**.
> You need: a PayPal **Business** account + the Vercel dashboard + the Supabase SQL Editor.

---

## Step 0 — Apply the migration

Supabase SQL Editor → run `supabase/migrations/20260705000001_phase35_saas_m3_paypal.sql`.
This sets the new pricing (21 / 105 / 200, 1-year free trial), gives every existing customer
their free year, and creates the `webhook_logs` + `subscription_payments` tables.

---

## Step 1 — PayPal developer app (get your keys)

1. Go to **https://developer.paypal.com** → log in with your PayPal Business account.
2. **Apps & Credentials** → make sure the **Sandbox** tab is selected → **Create App**.
   - Name: `StockBolt` → Create.
3. Copy the **Client ID** and **Secret** — you'll paste them into Vercel in Step 4.

## Step 2 — Create the product + 3 billing plans

Easiest way: PayPal dashboard → **Pay & Get Paid → Subscriptions → Subscription plans**
(or from developer.paypal.com the same section on the sandbox account).

1. **Create product**: Name `StockBolt Professional`, type *Software*, category *Software*.
2. Create **three plans** under that product (all USD, auto-billing on):

   | Plan name | Billing cycle | Price |
   |---|---|---|
   | StockBolt Monthly    | every 1 month  | **$21.00**  |
   | StockBolt 6 Months   | every 6 months | **$105.00** |
   | StockBolt Yearly     | every 12 months| **$200.00** |

   > Do **NOT** add a trial inside the PayPal plans — the free year is handled by StockBolt
   > itself (customers only reach PayPal when they choose to subscribe).

3. Each plan gets an ID that looks like `P-1AB23456CD789012EF`. Copy all three.

## Step 3 — Tell StockBolt the plan IDs

Supabase SQL Editor — paste your three IDs into this and run it:

```sql
UPDATE public.subscription_plans
SET provider_plan_ids = jsonb_build_object('paypal', jsonb_build_object(
      'monthly',     'P-XXXX-MONTHLY-ID',
      'half_yearly', 'P-XXXX-6MONTH-ID',
      'yearly',      'P-XXXX-YEARLY-ID')),
    updated_at = now()
WHERE code = 'professional';
```

## Step 4 — Vercel environment variables

Vercel dashboard → your project → **Settings → Environment Variables** → add
(for **Production** — and Preview if you want to test there):

| Name | Value |
|---|---|
| `PAYPAL_CLIENT_ID` | from Step 1 |
| `PAYPAL_CLIENT_SECRET` | from Step 1 |
| `PAYPAL_MODE` | `sandbox` (change to `live` at go-live) |
| `PAYPAL_WEBHOOK_ID` | from Step 5 below |
| `SUPABASE_URL` | your Supabase project URL (same as `VITE_SUPABASE_URL`) |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase → Settings → API → **service_role** key ⚠️ server-only secret |

Then **redeploy** (Deployments → ⋯ → Redeploy) so the functions pick them up.

## Step 5 — Register the webhook

1. developer.paypal.com → **Apps & Credentials** → open your `StockBolt` app → **Webhooks → Add webhook**.
2. Webhook URL: `https://stockbolt-v1.vercel.app/api/paypal/webhook`
3. Tick these events:
   - Billing subscription activated
   - Billing subscription cancelled
   - Billing subscription suspended
   - Billing subscription payment failed
   - Payment sale completed
   - Payment sale refunded
4. Save → copy the **Webhook ID** → put it in Vercel as `PAYPAL_WEBHOOK_ID` (Step 4) → redeploy again.

## Step 6 — Sandbox test (before any real money)

1. developer.paypal.com → **Sandbox → Accounts** → there's a ready-made **personal (buyer)**
   test account — note its email/password.
2. Open your app → **Settings → Billing & Subscription** → pick a plan → **Subscribe**.
3. Log in on the PayPal page with the **sandbox buyer** account → approve.
4. You're redirected back; within ~30 seconds the page flips to **Active**
   (that's the webhook arriving). The payment appears under **Payment history**.
5. Test **Cancel subscription** too.
6. If it doesn't activate: Supabase → Table Editor → `webhook_logs` — every event lands
   there with any error message.

## Step 7 — Go live

1. PayPal **Live** tab: create the app again → live Client ID/Secret.
2. Create the product + 3 plans again on the live account → update Step 3's SQL with the live IDs.
3. Vercel env: replace `PAYPAL_CLIENT_ID`/`SECRET`, set `PAYPAL_MODE=live`,
   register the live webhook (Step 5) → new live `PAYPAL_WEBHOOK_ID` → redeploy.
4. One real $21 monthly self-test, then refund it from PayPal if you like
   (the refund shows up in payment history automatically).

---

### How the free year works (no PayPal involved)
- Existing customers: the migration set them to **trialing until +365 days**, marked
  grandfathered. They see "🎁 Your first year is FREE".
- New signups automatically get a 365-day trial (plan `trial_days`).
- Nothing is blocked when a trial ends — enforcement (the billing wall) is milestone **M7**,
  ships flag-off. Customers subscribe voluntarily until then.
