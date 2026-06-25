# Document 6 — SaaS Subscription & Billing Platform — Architecture Plan

> Status: **DESIGN — not yet built.** This is the end-to-end architecture for all 10 phases,
> to be built in approved milestones (M1–M7). No code ships from this doc alone.
> Last updated: 2026-06-25.

---

## 0. Guiding principles (non-negotiable)

1. **Existing tenants are never disrupted.** Every existing company is back-filled as a
   **grandfathered `active`** subscription. The ERP is **never gated** until the owner
   explicitly turns enforcement on, behind a feature flag. No existing data is modified or deleted.
2. **Multi-tenant isolation + RLS preserved.** Billing tables follow the same
   `current_user_company_id()` + `AS RESTRICTIVE` patterns as the rest of the app. A tenant can
   only ever see its own subscription/invoices.
3. **Billing state is server-controlled.** Clients **cannot** write subscription status, money
   amounts, or invoice rows directly. All mutations go through `SECURITY DEFINER` RPCs or the
   webhook handler (service role). RLS gives tenants **read-only** on their own billing rows.
4. **No card data, ever.** We store only PayPal IDs, transaction IDs, status, amount, currency,
   dates. No PAN/CVV/bank details. PayPal hosts the payment sheet.
5. **Provider-agnostic.** A `PaymentProvider` abstraction (Phase 10) means PayPal is just the
   first driver; Stripe/Razorpay/etc. plug in without touching subscription logic.
6. **Reuse what exists.** Super-admin (`platform_admins`, `is_platform_admin()`,
   `get_admin_dashboard()` — Phase 20), `audit_logs`, the Signature PDF engine (Phase 14),
   country tax (`defaultTaxRate`/locale — Phase 21), the adapter pattern, and the
   migrations-run-by-hand + `_regression_test_query` test convention.

---

## 1. Architecture at a glance

```
            ┌──────────────────────────────┐
  Browser → │  StockBolt SPA (Vite/React)  │  Billing portal · Admin dashboard · Legal pages
            └─────────────┬────────────────┘
                          │ supabase-js (RLS)        ┌───────────────┐
                          ▼                          │    PayPal     │
            ┌──────────────────────────────┐  create │  Subscriptions│
            │   Supabase Postgres + RLS    │◀────────▶│      API      │
            │  subscriptions, invoices,    │         └───────┬───────┘
            │  payments, plans, RPCs       │                 │ webhooks
            └─────────────┬────────────────┘                 ▼
                          │ service role          ┌──────────────────────┐
                          ▼                        │ Serverless functions │
            ┌──────────────────────────────┐      │ /api/paypal-webhook  │◀── PayPal events
            │  pg_cron lifecycle job        │      │ /api/billing-cron    │── trial/retry/email
            │  (trial→grace→suspend)        │      │ /api/send-email      │
            └──────────────────────────────┘      └──────────┬───────────┘
                                                              ▼
                                                       ┌────────────┐
                                                       │  Resend    │ (email)
                                                       └────────────┘
```

### 1.1 The one new infra decision — where webhooks/cron run
The app today is a **Vite SPA on Vercel + Supabase**, with **zero backend functions**. PayPal
webhooks and outbound email need a server endpoint. Two options:

| Option | Pros | Cons | Fit |
|---|---|---|---|
| **Vercel Serverless Functions** (`/api/*.ts`) **(recommended)** | Deploys with the app (no new CLI), Node ecosystem, Vercel Cron built-in | Calls Supabase over the network via service-role key | ✅ Best for you — you already deploy on Vercel; no Supabase CLI needed |
| Supabase Edge Functions (Deno) | Co-located with DB | Needs the Supabase CLI + Deno (the toolchain you've found hardest) | Alternative |

**Recommendation:** **Vercel Functions** for webhook receipt + email; **pg_cron** (pure SQL, in-DB)
for the daily lifecycle transitions (trial expiry, grace→suspend). This keeps the moving parts you
must operate to a minimum.

---

## 2. Data model (Phase 1 — DATABASE)

All tables are `public.*`, tenant-scoped by `company_id` (except global config), RLS-enabled,
idempotent migrations. Money columns `NUMERIC(12,2)`; one subscription per company (1:1).

### 2.1 `subscription_plans` — the catalog (nothing hardcoded)
| column | type | notes |
|---|---|---|
| id | uuid pk | |
| code | text unique | e.g. `professional` |
| name, description | text | |
| monthly_price, yearly_price | numeric | |
| price_currency | text | base list currency, e.g. `USD` |
| trial_days | int | default 30 |
| features | jsonb | e.g. `{"modules":"unlimited"}` |
| provider_plan_ids | jsonb | `{"paypal":{"monthly":"P-..","yearly":"P-.."}}` |
| is_active, sort_order | bool/int | |
**RLS:** SELECT → `authenticated` (public catalog). Writes → platform admin only.
**Seed:** `StockBolt Professional` — $10/mo, $100/yr, 30-day trial, unlimited modules.

### 2.2 `subscriptions` — one per company
| column | type | notes |
|---|---|---|
| id | uuid pk | |
| company_id | uuid unique → companies | 1:1 |
| plan_id | uuid → subscription_plans | |
| status | text | state machine §3 |
| billing_cycle | text | `monthly`\|`yearly` |
| provider | text | `paypal`\|`manual`\|… |
| provider_subscription_id | text | PayPal subscription id |
| trial_start, trial_end | date | |
| current_period_start, current_period_end | date | |
| next_billing_date | date | |
| grace_until | date | past-due grace window |
| cancel_at_period_end | bool | |
| amount, currency | numeric/text | snapshot of charged price |
| activated_at, cancelled_at | timestamptz | |
| created_at, updated_at | timestamptz | |
**RLS:** tenant SELECT own (`company_id = current_user_company_id()`); **no client writes** (DEFINER
RPC / webhook only). Platform admin reads all via DEFINER.

### 2.3 `subscription_history` — status-change audit
`id, company_id, subscription_id, from_status, to_status, reason, actor (system|user|webhook|admin), metadata jsonb, created_at`.

### 2.4 `subscription_invoices` — one per charge (tax invoice)
| column | type | notes |
|---|---|---|
| id | uuid pk | |
| company_id, subscription_id | uuid | |
| invoice_number | text unique | from `document_sequences` (`SINV`) |
| billing_period_start/end | date | |
| issue_date, due_date, paid_date | date | |
| status | text | `issued`\|`paid`\|`void` |
| subtotal, tax_amount, total | numeric | |
| currency | text | AED/INR/USD per §6 |
| tax_country | text | `AE`\|`IN` |
| tax_breakdown | jsonb | VAT, or CGST/SGST/IGST |
| seller_snapshot, buyer_snapshot | jsonb | TRN/GSTIN + addresses at issue time |
| pdf_url | text | Supabase storage |
| provider_payment_id | text | |
**RLS:** tenant reads own; writes server-only.

### 2.5 `subscription_payments` — payment results (no card data)
`id, company_id, subscription_id, invoice_id, provider, provider_payment_id (txn id), provider_subscription_id, amount, currency, status (succeeded|failed|refunded|chargeback|pending), paid_at, raw jsonb (provider response — IDs only), created_at`.

### 2.6 `payment_attempts` — retry tracking
`id, subscription_id, invoice_id, attempt_no, status, error_code, error_message, next_retry_at, created_at`.

### 2.7 `webhook_logs` — idempotency + verification audit
`id, provider, event_type, provider_event_id (unique — dedupe), payload jsonb, signature_verified bool, processed bool, processed_at, error, received_at`. **Idempotency key = provider_event_id** (skip if already processed).

### 2.8 `billing_addresses` — buyer billing identity (per company)
`id, company_id unique, company_name, address, country, state, city, postal_code, tax_number, phone, email, created_at, updated_at`. RLS tenant own + `settings.write`.

### 2.9 `tax_profiles` — SELLER tax config (configurable, not hardcoded)
`id, country (AE|IN), tax_label (VAT|GST), seller_tax_number, default_rate, place_of_supply_state, split_rules jsonb (CGST/SGST vs IGST), is_active`. Platform-admin editable. Drives §6.

### 2.10 `discount_coupons` — future
`id, code unique, kind (percent|fixed), value, currency, max_redemptions, redeemed_count, valid_from, valid_until, applies_to_plan_id, is_active`.

### 2.11 `payment_provider_configs` — provider registry (Phase 10)
`id, provider (paypal|stripe|…), is_active, mode (sandbox|live), public_config jsonb (non-secret), created_at`. **Secrets live in env vars, never here.**

---

## 3. Subscription status state machine (Phase 1)

```
                 signup
                   │
                   ▼
   ┌──────────  trialing ──────── trial ends, no pay ──► past_due ──grace 7d──► suspended
   │  (30 days)    │                                        │  pay              │  pay
   │  pay          ▼                                        ▼                   ▼
   └────────►   active ◄──────── renew OK ───────────────  active ◄──────────  active
                   │ cancel                pay fails          ▲
                   ▼                          │               │ reactivate
            cancel_at_period_end ──period end─┴► payment_failed
                   │
                   ▼
               cancelled ──(period fully lapses)──► expired
```
- **grandfathered existing tenants → `active`** with `provider='manual'`, no `next_billing_date`.
- Transitions happen **only** via DEFINER RPCs (user actions), the webhook handler (provider
  events), or the pg_cron job (time-based: trial→past_due→suspended). Every transition writes
  `subscription_history` + `audit_logs`.

---

## 4. Payment Provider abstraction (Phase 10)

**App side** — `src/modules/billing/providers/`:
```ts
interface PaymentProvider {
  id: 'paypal' | 'stripe' | 'razorpay';
  createSubscription(plan, cycle, returnUrls): Promise<{ approvalUrl, providerSubscriptionId }>;
  cancelSubscription(providerSubscriptionId, reason): Promise<void>;
  reactivateSubscription(providerSubscriptionId): Promise<void>;
  verifyWebhook(headers, rawBody): Promise<boolean>;
  parseEvent(payload): NormalizedEvent;     // → {type, providerSubscriptionId, amount, txnId,…}
}
```
`PayPalProvider` is the first impl. Subscription logic (status machine, invoices, RLS) only ever
sees **NormalizedEvent**, so adding Stripe later = one new driver, zero changes elsewhere.

---

## 5. PayPal integration (Phase 2) + lifecycle (Phase 5)

### 5.1 Setup (you do once, in PayPal)
PayPal **Business** account → REST app (Client ID + Secret, **sandbox first**) → create a
**Product** + two **Billing Plans** ($10/mo, $100/yr) → store their IDs in
`subscription_plans.provider_plan_ids` → register the webhook URL.

### 5.2 Subscribe flow
1. Tenant clicks **Subscribe** (monthly/yearly) in the billing portal.
2. `start_subscription_checkout(plan, cycle)` DEFINER RPC → Vercel fn calls PayPal **create
   subscription** → returns `approvalUrl` → redirect tenant to PayPal.
3. Tenant approves → PayPal redirects back → status set `pending_payment` until the webhook
   confirms.
4. **Webhook `BILLING.SUBSCRIPTION.ACTIVATED`** → status `active`, set period dates +
   `next_billing_date`.

### 5.3 Webhook events handled (`/api/paypal-webhook`)
| PayPal event | Action |
|---|---|
| `BILLING.SUBSCRIPTION.ACTIVATED` | → `active`, set periods |
| `PAYMENT.SALE.COMPLETED` | record payment, **generate paid invoice** (§6), email |
| `PAYMENT.SALE.DENIED` / payment failed | → `payment_failed`, start retry/grace, email |
| `BILLING.SUBSCRIPTION.CANCELLED` | → `cancelled` (or at period end) |
| `BILLING.SUBSCRIPTION.SUSPENDED` | → `suspended` |
| `PAYMENT.SALE.REFUNDED` | record refund, void/credit invoice |
| chargeback | flag, → `suspended`, alert admin |
Every webhook: **verify signature**, **dedupe by `provider_event_id`**, log to `webhook_logs`,
then process in a transaction.

### 5.4 Time-based lifecycle (pg_cron, daily)
`run_billing_lifecycle()` DEFINER:
- `trialing` past `trial_end` & no active sub → `past_due`, set `grace_until = today+7`, email "trial ended".
- `past_due`/`payment_failed` past `grace_until` → `suspended`, email.
- Renewal reminders (T-3 days) email.
- (PayPal auto-charges recurring; cron is the safety net + the gate for non-paying trials.)

### 5.5 ERP access gating (ships LAST, flag-gated, default OFF)
On app bootstrap, read the tenant's subscription. If `suspended`/`expired` **and**
`BILLING_ENFORCED=true`: show a **billing wall** — read-only ERP + access to the billing portal to
pay. `trialing`/`active`/`past_due`/grandfathered → full access. **Until you flip the flag, nothing
changes for anyone.**

---

## 6. Subscription invoices + tax compliance (Phase 3 + tax + Phase 8 email)

On each successful payment, generate a numbered **tax invoice**:
- **Number:** unique via `document_sequences` (`SINV-####`), forever-retained.
- **Tax engine:** `compute_subscription_tax(buyer_country, buyer_state, amount)` reads
  `tax_profiles`:
  - **UAE (AE):** show **TRN**, **VAT %**, **VAT amount**, label "Tax Invoice", currency context AED.
  - **India (IN):** show **GSTIN**, **GST %**; **intra-state → CGST + SGST**, **inter-state → IGST**
    (by place of supply); currency INR. Tax % is configurable in `tax_profiles`.
- **PDF:** reuse the **Signature template engine** (Phase 14) — a new `subscription_invoice`
  document type rendered to PDF, stored in Supabase storage, `pdf_url` saved. Download + **Email
  invoice** (Resend).

---

## 7. Customer billing portal (Phase 3 + 9)

New **Settings → Billing & Subscription** (`/settings/billing`), gated by `settings.read`:
- **Dashboard:** current plan, status badge, trial remaining, start/renewal dates, billing cycle,
  payment method (PayPal), amount.
- **Actions:** Subscribe / Upgrade / Cancel / Reactivate (DEFINER RPCs → provider).
- **Payment history** + **invoice history** (download PDF, email).
- **Billing address** editor (`billing_addresses`).
- **Billing settings (Phase 9):** currency, tax display, invoice prefix/footer, PayPal + webhook
  status indicators.

---

## 8. Platform admin dashboard (Phase 6) — extends Phase 20

Extend `get_admin_dashboard()` (already stubs `subscription_status`) + new
`get_admin_subscriptions()` / `admin_manage_subscription()` (all `is_platform_admin()`-gated):
- **Widgets:** total/active/trial/suspended/cancelled companies, MRR, ARR, monthly/annual/today
  revenue, active vs expired subs, upcoming renewals, total/failed/pending payments, storage/DB,
  users, companies-by-country, recent signups/payments, latest errors (`webhook_logs` failures).
- **Manage a company:** view/change plan, extend trial, suspend, activate, cancel, reset
  subscription, view payments, download invoice, view PayPal subscription id. Every action →
  `audit_logs` + `subscription_history`.
- **Super-admin separation (Phase 7):** platform admins are **not** tenant admins — keep the
  existing `platform_admins` allow-list + DEFINER-only access. Add MFA for platform admin login.

---

## 9. Legal pages (Phase 4)

Static pages under `src/modules/marketing/legal/`: Terms, Privacy, Refund, Cookie, Acceptable Use,
DPA. Linked from footer, signup, billing. **Accept-before-pay:** a required "I agree to Terms &
Privacy" checkbox (stored as `subscriptions.terms_accepted_at` + ip/version) before checkout.

---

## 10. Security (Phase 7) & Email (Phase 8)

- **Never stored:** cards, CVV, bank details, passwords. PayPal only. HTTPS only.
- **Secrets in env vars** (Vercel + Supabase), never in DB or client: PayPal secret, webhook id,
  Resend key. Webhook **signature verification** mandatory.
- **Audit log** every subscription action (created, payment, plan change, refund, cancel, admin
  override, webhook failure, platform-admin login) via existing `audit_logs`.
- **MFA** for platform admin.
- **Emails (Resend):** trial started, trial ending, payment ok, payment failed, invoice generated,
  renewed, cancelled, plan changed — HTML templates in `src/modules/billing/emails/`.

---

## 11. Backward-compatibility & grandfathering

The **first migration** of M1 back-fills a row in `subscriptions` for **every existing company**:
`status='active'`, `provider='manual'`, `plan=Professional`, no `next_billing_date`,
`grandfathered=true`. New signups get `status='trialing'`, `trial_end = today+30`. The ERP reads
status only for the (flag-gated, default-off) billing wall. **Net effect today: zero change for any
existing tenant.**

---

## 12. Milestone plan (build order)

| M | Scope | External account? | Risk |
|---|---|---|---|
| **M1** | Schema (§2) + status machine (§3) + RLS + grandfather back-fill + seed plan + audit hooks | none | low (additive) |
| **M2** | Billing portal read-only (§7) + billing address + settings | none | low |
| **M3** | Provider abstraction (§4) + PayPal subscribe/cancel/reactivate + `/api/paypal-webhook` + `webhook_logs` dedupe | **PayPal** + webhook host | med |
| **M4** | Tax invoices + PDF (Signature engine) + `tax_profiles` (UAE/India) + Resend emails (§6, §10) | **Resend** | med |
| **M5** | Platform admin dashboard + subscription management (§8) | none | low |
| **M6** | Legal pages + accept-before-pay (§9) | none | low |
| **M7** | pg_cron lifecycle + retry/grace/suspend + ERP billing wall (flag) + MFA + security hardening (§5.4, §5.5, §10) | none | med (gating — ship last, flag-off) |

Each milestone: migration(s) you run by hand + app code + `_regression_test_query` tests +
`tsc`/regression green, committed, then pushed.

---

## 13. Testing checklist
New subscription · trial expiry → past_due → suspended · renewal success · payment failure + retry
· cancellation + reactivate · invoice generation + uniqueness · UAE VAT invoice · India CGST/SGST
vs IGST invoice · PDF download · email send · webhook signature-verify + **idempotency (duplicate
event ignored)** · admin dashboard metrics · admin manage actions audited · **RLS: tenant can't read
another tenant's subscription/invoice** · grandfathered tenant unaffected · platform admin ≠ tenant
admin.

## 14. Security checklist
No card/CVV/bank stored · secrets only in env · webhook signature verified · service-role key only
server-side · DEFINER RPCs gate every billing mutation · platform-admin RPCs `is_platform_admin()`-
gated · MFA on platform admin · HTTPS · audit log complete · RLS restrictive on all billing tables.

## 15. Deployment guide (per milestone)
1. Apply migration(s) in Supabase SQL Editor (in order) + `NOTIFY pgrst, 'reload schema';`
2. Set env vars (Vercel + Supabase): `PAYPAL_CLIENT_ID/SECRET`, `PAYPAL_WEBHOOK_ID`,
   `RESEND_API_KEY`, `SUPABASE_SERVICE_ROLE_KEY` (server only). Sandbox first.
3. Deploy app + `/api` functions via Vercel. Register PayPal webhook URL.
4. Smoke test in **sandbox** end-to-end before switching PayPal to **live**.
5. Run regression suite green; commit; push.

## 16. Rollback strategy
- **Schema is additive** — no existing table altered destructively; a milestone rolls back by
  dropping its new tables/RPCs (data in them is billing-only, not ERP).
- **Enforcement is flag-gated** (`BILLING_ENFORCED=false`) — instant disable returns every tenant
  to full access without a deploy.
- **Provider isolation** — disabling `payment_provider_configs.is_active` halts new charges; PayPal
  subscriptions can be cancelled from PayPal independently.
- Each milestone is its own commit(s) → revert is surgical.

---

## 17. Open decisions / what you must provide
1. **Webhook/cron host:** Vercel Functions (recommended) vs Supabase Edge Functions.
2. **PayPal:** Business account + REST app (sandbox creds first) — and confirm PayPal Subscriptions
   is available for your country.
3. **Email provider:** Resend (recommended) vs other — need an API key + a verified sender domain.
4. **Invoice currency:** charge in **USD** (simplest with PayPal) while showing local tax (AED/INR),
   or charge in local currency? (Affects PayPal plan setup.)
5. **Trial for existing tenants:** confirm grandfather-as-active-forever (recommended) vs put them
   on a trial too.
