# Deployment checklist — phase134 + phase135 (enforcement OFF)

Prepared 2026-11-16. Ships the write-permission fixes (phase134) and the legal
agreement system with **enforcement OFF and nothing published** (phase135).
phase136 (company deletion) and publishing the legal documents are separate
releases, listed at the end — do not do them now.

## State checked on production (read-only, 2026-11-16)

| Item | Production |
|---|---|
| phase133 Help & Support | applied, 1 support operator |
| phase134 / phase135 / phase136 | not applied |
| `update_payment_draft` md5 | `9ee18e22…` ✔ expected |
| `deposit_pdc` md5 | `1606d2dc…` ✔ expected |
| `save_bank_reconciliation` md5 | `14780ab2…` ✔ expected |
| `has_perm` md5 | `62fbb704…` ✔ expected |
| GitHub `main` | 3 commits behind local (`0619540`, `20df689`, `7215c27`) |

Re-run the pre-checks anyway: anything applied in between changes them.

## What was verified locally

- Local staging suites: legal enforcement 20/20, company deletion 8/8, static security 301/301.
- Browser (headless Chrome against local staging; desktop 1366 px and phone 412 px with `?app=1`; English and Arabic):
  - Public `/terms` (unpublished notice), `/privacy`, `/delete-account`, `/login` and `/register` links, landing footer link: no horizontal overflow, fonts self-hosted, no Google Fonts or production requests.
  - Enforcement OFF: banner → Review → both boxes required → company checkbox for an admin → Agree → banner gone; Terms recorded as accepted, Privacy as acknowledged, platform `web`.
  - Enforcement ON: dashboard and invoices show the agreement screen; Support and Import/Export stay open with the "required" banner; decline options; decline recorded; Log out works.
  - Arabic, phone, non-admin: right-to-left layout, Arabic text, no company checkbox, no export option.
  - A newer document than the build: "update the app" message, no Agree button.
  - Published rendering (switched on temporarily): section links all work, the fingerprint shown matches the file, no overflow.
- **Not verified:** a real Android device or emulator. The emulator's system image is missing on this machine, so steps B4–B5 must be done by hand on a phone.

---

## A. Database (Supabase SQL Editor, production)

Run each block on its own. If any check gives a different answer, **stop and send the result**.

> The SQL Editor connects as `postgres`. Because of the supautils crash (support report pending),
> do **not** test permissions there with `SET ROLE anon/authenticated`. One refused function call
> restarts the whole database. The migrations and the verify queries below do not switch roles.

**A0. Backup.** Dashboard → Database → Backups: confirm today's backup exists (or take one, depending on your plan).

**A1. phase134 pre-check** — expect `9ee18e229d9dbc4ca42bcbd89bb7d45d | 1606d2dc052f109f7a8508715361be57 | 14780ab2aab7a8c6887f2c34782a752f`
```sql
SELECT md5(replace(pg_get_functiondef('public.update_payment_draft(uuid,jsonb,jsonb)'::regprocedure), chr(13), '')),
       md5(replace(pg_get_functiondef('public.deposit_pdc(uuid)'::regprocedure), chr(13), '')),
       md5(replace(pg_get_functiondef('public.save_bank_reconciliation(uuid,uuid,date,numeric,uuid[],text,boolean)'::regprocedure), chr(13), ''));
```

**A2. Apply** `supabase/migrations/20261115000008_phase134_write_permission_gaps.sql` (whole file, one Run).

**A3. phase134 verify** — expect every column `true`
```sql
SELECT
  NOT has_table_privilege('authenticated', 'public.notifications', 'INSERT') AS notif_closed,
  NOT has_table_privilege('authenticated', 'public.attachments', 'UPDATE') AS attach_closed,
  (SELECT count(*) FROM pg_policies WHERE policyname LIKE 'p134_%') = 18 AS direct_write_rules,
  (SELECT bool_and(permissive = 'RESTRICTIVE') FROM pg_policies
    WHERE tablename IN ('purchase_returns','purchase_return_items') AND policyname LIKE 'rbac_w_%') AS returns_restrictive,
  EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'document_sequences_guard') AS numbering_guard,
  NOT has_function_privilege('anon', 'public.update_payment_draft(uuid,jsonb,jsonb)', 'EXECUTE') AS payment_fn_closed,
  NOT has_function_privilege('authenticated', 'public._recompute_payment_allocation_status(uuid)', 'EXECUTE') AS helper_closed;
```

**A4. phase135 pre-check** — expect `62fbb70436c08fe1fc901bd653ae4fb8`
```sql
SELECT md5(replace(pg_get_functiondef('public.has_perm(text)'::regprocedure), chr(13), ''));
```

**A5. Apply** `supabase/migrations/20261116000001_phase135_legal_agreements.sql`.

**A6. phase135 verify** — expect `true | false | true | 0`
```sql
SELECT to_regclass('public.legal_events') IS NOT NULL AS tables,
       (SELECT enforcement FROM public.legal_settings WHERE id = 1) AS enforcement_on,
       pg_get_functiondef('public.has_perm(text)'::regprocedure) LIKE '%legal_write_allowed%' AS has_perm_hook,
       (SELECT count(*) FROM public.legal_documents) AS published_docs;
```

## B. Web and Android

**B1. Push** `main` (3 commits). Vercel deploys. Wait for "Ready".

**B2. Web smoke test** (stockbolt.online, a real account, desktop + phone):
- [ ] Sign in; dashboard loads; **no** Terms banner (nothing is published).
- [ ] Create and confirm an invoice, record a payment — posts as before.
- [ ] A non-admin user (e.g. Salesperson) can still create what their role allows. A Viewer is refused, as before.
- [ ] Help & Support: open a ticket.
- [ ] `/terms` shows "being finalised"; `/privacy` and `/delete-account` open; Terms/Privacy links on login and register work.
- [ ] Settings → Import / Export → Download my data still completes.

**B3. Android build** (only in `E:\stockbolt_clean\stockbolt-v1`):
- [ ] `npm run build` then `npx cap sync android` — always, so the app carries the **production** bundle. (Local testing synced a staging bundle on 2026-11-16; it has been replaced, but always rebuild.)
- [ ] versionCode / versionName: `build.gradle` currently says **19 / 1.0.18** (uncommitted). Use them only if 1.0.18 is not already on Play; otherwise go one higher.
- [ ] Build and sign the `.aab`; upload to internal testing first.

**B4. Android check on a real phone** (not covered by automated tests):
- [ ] Sign in, create an invoice, open Support — works as on the web.
- [ ] Menu → Terms, and the Terms/Privacy links on login/register, open the **website** page in the browser and return cleanly with Back.
- [ ] Layout at phone width: login, register, menu.

**B5. After internal testing passes**, promote to production on Play. Commit the `build.gradle` bump.

## C. If something goes wrong

- Emergency, any time (enforcement should already be off): `UPDATE public.legal_settings SET enforcement = false, updated_at = now() WHERE id = 1;`
- phase135 / phase134 undo: the ROLLBACK block at the end of each migration file. Keep `legal_events` (evidence).
- Web: redeploy the previous Vercel deployment from the dashboard.

---

## Later releases (each needs its own approval)

1. **Supabase support report** — send it. The answer decides whether `hint_roles` should change on production.
2. **phase136 company deletion** — before it is applied, needs:
   - your decision on pseudonymising team members whose names are on posted records;
   - your decision on keeping `legal_events` after a deletion;
   - one storage-script run on a test company (local staging has no storage).
   
   Then apply it and run the verify query in its footer.
3. **Publish the legal documents**:
   1. Every `[FOUNDER: …]` / `[LAWYER: …]` placeholder resolved (Terms 11, Privacy 22).
   2. Lawyer review.
   3. Replace "Linqora Technologies" in `src/lib/legal.ts`.
   4. Set `LEGAL_DOCS_PUBLISHED = true`, deploy web and Android.
   5. Insert the `legal_documents` rows with `node scripts/legal-fingerprint.mjs` hashes, with an effective date at least the notice period ahead.
   6. Users then see the "please review" banner.
4. **Turn enforcement on** — only after (3), the notice period, and a check that the Android app on Play shows the same fingerprints.
