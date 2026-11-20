# StockBolt Control Center — metric definitions and data availability

`/admin` (platform owners only). Every figure comes from an owner-only, read-only
database function that refuses any caller not listed in `platform_admins`
(phase141 `_admin_gate()`). Nothing is estimated: a figure without a reliable
source is listed under **Unavailable** instead of being shown.
The in-app ⓘ next to each figure shows the same definition and source
(`src/modules/admin/admin-metrics.ts`).

## Metrics shown

| Metric | Definition | Source |
|---|---|---|
| Sign-ups | Accounts created in the selected range; deleted and anonymous accounts excluded. Arrow = change vs the previous range of equal length. | `auth.users.created_at` via `admin_overview_range` |
| Active people | Accounts that signed in during the last 7 days. | `greatest(auth.users.last_sign_in_at, profiles.last_login_at)` |
| Signed up, no company | Accounts that never created or joined a company. | `auth.users` without a `profiles.company_id` |
| New companies | Companies registered in the range (vs previous range). | `companies.created_at` |
| Active companies | Companies that posted ≥ 1 journal entry in the last 30 days. | `max(journal_entries.created_at)` |
| Paying companies | Active paid subscription via Razorpay/PayPal. **Shows "Not configured" while no payment provider is active.** | `subscriptions` + `payment_provider_configs.is_active` |
| Sign-up funnel | Signed up → verified email → in a company → business setup saved → active 30 days → paying. Each step ⊂ the previous one. | `auth.users`, `profiles`, `company_configurations`, `subscriptions` |
| Countries | Companies per country. | `companies.country_code` |
| Business types | Each company's main activity from its business setup ("Setup not saved" when none). | `company_configurations.primary_activity_key` |
| Plans | Free trial / paying / complimentary / payment problem / ended. | `subscriptions.status, provider, grandfathered` |
| Owner | The company's earliest admin user (there is no owner column). | `profiles` (role `admin`, earliest `created_at`) |
| Last activity | When the company last posted a journal entry. | `max(journal_entries.created_at)` |
| Usage counts | Users, invoices, quotes, bills, payments, products, contacts, journal entries per company. | row counts per `company_id` |
| 12-month activity | Journal entries and invoices created per month. | `journal_entries.created_at`, `invoices.created_at` |
| File storage | Size of files stored under the company's path. | `storage.objects` under `{bucket}/{company_id}/` — "Unavailable" where the storage schema is absent |
| System: database / storage size, totals | As measured by the database. | `get_admin_dashboard` (phase20) |

## Unavailable (not instrumented — shown as such, never estimated)

| Wanted | Why not available | What would make it available |
|---|---|---|
| Failed sign-in attempts | Supabase's auth log on this project records logins, logouts, sign-ups, deletions and recovery requests, but no failed attempts. | Auth hook or edge function that logs failures (privacy review needed: IP / email of failed attempts). |
| Application error logs | No error-reporting service connected. | Sentry or similar (privacy review: stack traces may carry user data). |
| Uptime / response times | No monitoring service connected. | External uptime monitor. |
| API usage per company | Public API calls aren't counted. | Per-key request counter in the API function. |
| Email delivery | StockBolt sends no email of its own yet (invites are shared links). | An email provider with delivery webhooks. |
| Revenue / MRR | No live payment provider (billing "Not configured"). | Razorpay switched on (phase139) and real payments recorded in `subscription_payments`. |

## Privacy

- No new tracking or data collection: every figure is derived from rows StockBolt already stores.
- Company view masks team emails (`ra•••@gmail.com`); only the owner's address is shown in full.
- The Users view shows full emails to platform owners (operator need); review before adding more operators.
- Read-only: no Control Center screen can change a company, user, document or subscription.

## Views

| View | Status | Data |
|---|---|---|
| Overview | **Built** (phase142) | `admin_overview_range` |
| Businesses + business detail | **Built** (phase142) | `admin_businesses`, `admin_business_detail` |
| Users | **Built** (phase141) | `admin_list_users` |
| System health | **Built** (phase142, measured + not-measured list) | `get_admin_dashboard` |
| Support | Next — data exists | `support_tickets`, `support_messages`, `support_operators` (phase133, operator RLS) |
| Subscriptions | Next — shows "Not configured" until billing is live | `subscriptions`, `subscription_payments`, `payment_provider_configs` |
| Security | Next — limited data | `auth.audit_log_entries` (logins, sign-ups, deletions, recovery), `audit_logs` |
| Settings | Next — needs decisions (who may be a platform owner / support operator) | `platform_admins`, `support_operators` |
