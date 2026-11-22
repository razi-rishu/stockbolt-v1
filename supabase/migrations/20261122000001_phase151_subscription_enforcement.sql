-- ═══════════════════════════════════════════════════════════════════════════
-- phase151 — subscription enforcement (billing milestone M7)
-- ═══════════════════════════════════════════════════════════════════════════
-- Until now nothing happened when a company's free year or paid plan ended:
-- every company kept full access. This adds the consequence the founder
-- approved on 2026-11-22: READ-ONLY after a grace period, never a lock-out.
--
-- ACCESS IS DERIVED, NOT STORED. company_access() works it out from the
-- subscriptions row and today's date every time — no scheduled job, no
-- cached "blocked" flag that can drift (AGENTS.md Rule 1). A missed Razorpay
-- webhook can therefore never lock anyone out early.
--
--   grandfathered (exempt)                       → full, always
--   active                                       → full
--   free year / paid period still running        → full (even when cancelled)
--   payment_failed / past_due, grace_until ahead → grace
--   period ended, within grace_days              → grace
--   otherwise (incl. suspended, expired)         → read_only
--   no subscription row, or no dates at all      → full (never block on doubt)
--
-- ENFORCEMENT POINTS (inert while billing_settings.enforcement is false):
--   has_perm()   every *.write permission → every RLS write rule,
--                auth_require() and has_any_write(). 'users.manage' and the new
--                'billing.manage' stay open: admins can still manage their team
--                and their billing details while read-only.
--   journal_entries / stock_ledger BEFORE INSERT → every posting path,
--                including functions that bypass RLS.
--   Still open while read-only: reading, reports, print/share, Download my
--   data, support tickets, legal acceptance, sign-out, Subscribe (server-side
--   Vercel functions use the service role), team management, billing address.
--   Background jobs (no auth.uid()) are never blocked.
--
-- PRE-CHECK on prod (CR-stripped md5 of the phase135 has_perm):
--   SELECT md5(replace(pg_get_functiondef('public.has_perm(text)'::regprocedure), chr(13), ''));
--   expected de9009a3e149119308b436f3f5d76a41 (the phase135 version, as on
--   local staging 2026-11-22). If it differs, STOP and send the result.
--
-- SAFE TO APPLY: one new settings table (enforcement OFF), new functions, two
-- new triggers, has_perm gains one inert check, billing_addresses write rule
-- also accepts 'billing.manage'. No existing data changes. Re-runnable.
-- Rollback at the end.
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

-- ── 1. Settings (one row; platform owner changes it in SQL) ───────────────
CREATE TABLE IF NOT EXISTS public.billing_settings (
  id           int PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  enforcement  boolean NOT NULL DEFAULT false,
  grace_days   int     NOT NULL DEFAULT 7  CHECK (grace_days BETWEEN 0 AND 60),
  warn_days    int     NOT NULL DEFAULT 30 CHECK (warn_days BETWEEN 0 AND 120),
  updated_at   timestamptz NOT NULL DEFAULT now()
);
INSERT INTO public.billing_settings (id) VALUES (1) ON CONFLICT (id) DO NOTHING;
ALTER TABLE public.billing_settings ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.billing_settings FROM PUBLIC, anon, authenticated;

-- ── 2. The access calculation ─────────────────────────────────────────────
-- Returns {state, reason, ends_on, read_only_from, days_left, auto_renews,
-- warn, exempt, enforcement}. state is what WOULD apply; enforcement says
-- whether it is applied. Never call this with a company the caller may not
-- see from client code — use my_company_access().
CREATE OR REPLACE FUNCTION public.company_access(p_company uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  s        public.subscriptions%ROWTYPE;
  cfg      public.billing_settings%ROWTYPE;
  v_today  date := CURRENT_DATE;
  v_cover  date;
  v_state  text;
  v_reason text;
  v_ends   date;
  v_ro     date;
  v_auto   boolean := false;
BEGIN
  SELECT * INTO cfg FROM public.billing_settings WHERE id = 1;
  SELECT * INTO s FROM public.subscriptions WHERE company_id = p_company;

  IF NOT FOUND THEN
    v_state := 'full'; v_reason := 'no_subscription';
  ELSIF s.grandfathered THEN
    v_state := 'full'; v_reason := 'exempt';
  ELSIF s.status = 'active' THEN
    v_state := 'full'; v_reason := 'active';
    v_ends := s.current_period_end;
    v_auto := NOT s.cancel_at_period_end;
  ELSIF s.status IN ('payment_failed', 'past_due') THEN
    IF s.grace_until IS NULL OR s.grace_until >= v_today THEN
      v_state := 'grace'; v_reason := 'payment_failed';
      v_ro := s.grace_until + 1;
    ELSE
      v_state := 'read_only'; v_reason := 'payment_failed';
      v_ro := s.grace_until + 1;
    END IF;
  ELSE
    -- trialing / cancelled / expired / suspended / pending_payment: covered
    -- until the later of the free period and any paid period.
    v_cover := GREATEST(s.trial_end, s.current_period_end);
    v_ends  := v_cover;
    -- A card saved during the free year is charged automatically when it ends.
    v_auto  := s.status = 'trialing' AND s.provider = 'razorpay'
               AND s.provider_subscription_id IS NOT NULL AND s.next_billing_date IS NOT NULL
               AND NOT s.cancel_at_period_end;
    IF v_cover IS NULL OR v_cover >= v_today THEN
      v_state := 'full';
      v_reason := CASE WHEN s.status = 'trialing' THEN 'free_period' ELSE 'paid_period' END;
    ELSIF v_cover + COALESCE(cfg.grace_days, 7) >= v_today THEN
      v_state := 'grace'; v_reason := 'ended';
      v_ro := v_cover + COALESCE(cfg.grace_days, 7) + 1;
    ELSE
      v_state := 'read_only'; v_reason := 'ended';
      v_ro := v_cover + COALESCE(cfg.grace_days, 7) + 1;
    END IF;
  END IF;

  RETURN jsonb_build_object(
    'state', v_state,
    'reason', v_reason,
    'status', s.status,
    'ends_on', v_ends,
    'read_only_from', v_ro,
    'days_left', CASE WHEN v_state = 'grace' THEN v_ro - v_today
                      WHEN v_ends IS NOT NULL THEN v_ends - v_today END,
    'auto_renews', v_auto,
    'warn', v_state = 'grace'
            OR (v_state = 'full' AND NOT v_auto AND v_reason NOT IN ('exempt', 'no_subscription')
                AND v_ends IS NOT NULL AND v_ends - v_today <= COALESCE(cfg.warn_days, 30)),
    'exempt', COALESCE(s.grandfathered, false),
    'enforcement', COALESCE(cfg.enforcement, false)
  );
END;
$function$;

-- True only when enforcement is ON and the company is read-only. The hot
-- path (has_perm runs inside RLS): one settings row, one unique-key lookup.
CREATE OR REPLACE FUNCTION public._company_read_only(p_company uuid)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  IF p_company IS NULL
     OR NOT COALESCE((SELECT enforcement FROM public.billing_settings WHERE id = 1), false) THEN
    RETURN false;
  END IF;
  RETURN public.company_access(p_company)->>'state' = 'read_only';
END;
$function$;

-- Client: the signed-in user's own company (Finding E guard shape).
CREATE OR REPLACE FUNCTION public.my_company_access()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE v_co uuid := public.current_user_company_id();
BEGIN
  IF auth.uid() IS NULL OR v_co IS NULL THEN RETURN NULL; END IF;
  RETURN public.company_access(v_co);
END;
$function$;

-- ── 3. Enforcement points ─────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.has_perm(p_permission text)
 RETURNS boolean
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_role TEXT; v_active BOOLEAN; v_company UUID; v_ovr TEXT;
BEGIN
  SELECT role, is_active, company_id INTO v_role, v_active, v_company
    FROM public.profiles WHERE id = auth.uid();
  IF v_role IS NULL OR v_active IS NOT TRUE THEN RETURN FALSE; END IF;
  -- phase135: while Terms enforcement is ON, write permissions wait until the
  -- user has accepted the current required documents (reading never does).
  IF (p_permission LIKE '%.write' OR p_permission = 'users.manage')
     AND NOT public.legal_write_allowed() THEN
    RETURN FALSE;
  END IF;
  -- phase151: while billing enforcement is ON, a company whose subscription
  -- ended (after grace) is read-only. Team management and billing stay open.
  IF p_permission LIKE '%.write' AND public._company_read_only(v_company) THEN
    RETURN FALSE;
  END IF;
  IF v_role = 'admin' THEN RETURN TRUE; END IF;
  -- phase131: payroll is confidential (salaries, bank details) — admin only.
  -- Neither a role grant nor a per-user override can open it.
  IF p_permission LIKE 'payroll.%' THEN RETURN FALSE; END IF;

  SELECT mode INTO v_ovr FROM public.user_permission_overrides
   WHERE user_id = auth.uid() AND permission = p_permission;
  IF v_ovr = 'deny'  THEN RETURN FALSE; END IF;
  IF v_ovr = 'allow' THEN RETURN TRUE;  END IF;

  RETURN EXISTS (
    SELECT 1 FROM public.role_permissions
     WHERE role = v_role AND permission = p_permission
       AND (company_id IS NULL OR company_id = v_company)
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.tg_subscription_posting_guard()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $function$
BEGIN
  -- Postings made for a signed-in user stop when the company is read-only.
  -- Background jobs (no user) are never blocked.
  IF auth.uid() IS NOT NULL AND public._company_read_only(NEW.company_id) THEN
    RAISE EXCEPTION 'subscription_read_only: this company is read-only because its StockBolt subscription has ended'
      USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$function$;
DROP TRIGGER IF EXISTS subscription_posting_guard ON public.journal_entries;
CREATE TRIGGER subscription_posting_guard BEFORE INSERT ON public.journal_entries
  FOR EACH ROW EXECUTE FUNCTION public.tg_subscription_posting_guard();
DROP TRIGGER IF EXISTS subscription_posting_guard ON public.stock_ledger;
CREATE TRIGGER subscription_posting_guard BEFORE INSERT ON public.stock_ledger
  FOR EACH ROW EXECUTE FUNCTION public.tg_subscription_posting_guard();

-- Billing details stay editable for admins while read-only ('billing.manage'
-- is never gated; only admins hold it — no role grant is added).
DROP POLICY IF EXISTS billing_addr_write ON public.billing_addresses;
CREATE POLICY billing_addr_write ON public.billing_addresses
  FOR ALL TO authenticated
  USING (company_id = public.current_user_company_id()
         AND (public.has_perm('settings.write') OR public.has_perm('billing.manage')))
  WITH CHECK (company_id = public.current_user_company_id()
         AND (public.has_perm('settings.write') OR public.has_perm('billing.manage')));

-- ── 4. Platform-owner actions ─────────────────────────────────────────────
-- Exempt a company (your own companies, special deals) or lift it again.
CREATE OR REPLACE FUNCTION public.platform_set_billing_exempt(p_company uuid, p_exempt boolean, p_reason text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE v_sub public.subscriptions%ROWTYPE;
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_platform_admin() THEN
    RAISE EXCEPTION 'not allowed' USING ERRCODE = '42501';
  END IF;
  UPDATE public.subscriptions SET grandfathered = p_exempt, updated_at = now()
   WHERE company_id = p_company RETURNING * INTO v_sub;
  IF NOT FOUND THEN RAISE EXCEPTION 'no subscription for this company' USING ERRCODE = 'P0002'; END IF;
  INSERT INTO public.subscription_history (company_id, subscription_id, from_status, to_status, reason, actor)
  VALUES (p_company, v_sub.id, v_sub.status, v_sub.status,
          CASE WHEN p_exempt THEN 'Marked exempt from billing' ELSE 'Billing exemption removed' END
            || COALESCE(': ' || left(p_reason, 200), ''), 'admin');
  RETURN public.company_access(p_company);
END;
$function$;

-- Move the end of the free period (never earlier than today).
CREATE OR REPLACE FUNCTION public.platform_extend_free_period(p_company uuid, p_until date, p_reason text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE v_sub public.subscriptions%ROWTYPE; v_old date;
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_platform_admin() THEN
    RAISE EXCEPTION 'not allowed' USING ERRCODE = '42501';
  END IF;
  IF p_until IS NULL OR p_until < CURRENT_DATE THEN
    RAISE EXCEPTION 'the new end date must be today or later' USING ERRCODE = '22023';
  END IF;
  SELECT trial_end INTO v_old FROM public.subscriptions WHERE company_id = p_company;
  UPDATE public.subscriptions SET trial_end = p_until, updated_at = now()
   WHERE company_id = p_company RETURNING * INTO v_sub;
  IF NOT FOUND THEN RAISE EXCEPTION 'no subscription for this company' USING ERRCODE = 'P0002'; END IF;
  INSERT INTO public.subscription_history (company_id, subscription_id, from_status, to_status, reason, actor)
  VALUES (p_company, v_sub.id, v_sub.status, v_sub.status,
          format('Free period end moved from %s to %s', COALESCE(v_old::text, 'none'), p_until)
            || COALESCE(': ' || left(p_reason, 200), ''), 'admin');
  RETURN public.company_access(p_company);
END;
$function$;

-- Read any company's access state (for /admin).
CREATE OR REPLACE FUNCTION public.platform_company_access(p_company uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_platform_admin() THEN
    RAISE EXCEPTION 'not allowed' USING ERRCODE = '42501';
  END IF;
  RETURN public.company_access(p_company);
END;
$function$;

-- ── 5. Grants ─────────────────────────────────────────────────────────────
REVOKE ALL ON FUNCTION public.company_access(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._company_read_only(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.tg_subscription_posting_guard() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.my_company_access() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.platform_set_billing_exempt(uuid, boolean, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.platform_extend_free_period(uuid, date, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.platform_company_access(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.my_company_access() TO authenticated;
GRANT EXECUTE ON FUNCTION public.platform_set_billing_exempt(uuid, boolean, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.platform_extend_free_period(uuid, date, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.platform_company_access(uuid) TO authenticated;
-- The posting guard runs as the invoker (ledger_writer inside posting RPCs).
GRANT EXECUTE ON FUNCTION public._company_read_only(uuid) TO ledger_writer, authenticated;

COMMIT;

NOTIFY pgrst, 'reload schema';

-- ── VERIFY after applying ─────────────────────────────────────────────────
-- SELECT (SELECT enforcement FROM public.billing_settings) AS enforcement_off_expect_false,
--        pg_get_functiondef('public.has_perm(text)'::regprocedure) LIKE '%_company_read_only%' AS has_perm_hook,
--        (SELECT count(*) FROM pg_trigger WHERE tgname = 'subscription_posting_guard') AS guards_expect_2,
--        (SELECT count(*) FROM public.subscriptions s
--          WHERE public.company_access(s.company_id)->>'state' = 'read_only') AS would_be_read_only_now;
--
-- ── TURN ENFORCEMENT ON / OFF (separate approval) ─────────────────────────
--   UPDATE public.billing_settings SET enforcement = true,  updated_at = now() WHERE id = 1;
--   UPDATE public.billing_settings SET enforcement = false, updated_at = now() WHERE id = 1;  -- emergency off
--
-- ── ROLLBACK ──────────────────────────────────────────────────────────────
--   BEGIN;
--   re-create has_perm from the phase135 definition (without the phase151 lines);
--   DROP TRIGGER IF EXISTS subscription_posting_guard ON public.journal_entries;
--   DROP TRIGGER IF EXISTS subscription_posting_guard ON public.stock_ledger;
--   re-create billing_addr_write from phase31 (settings.write only);
--   DROP FUNCTION public.platform_company_access(uuid), public.platform_extend_free_period(uuid, date, text),
--     public.platform_set_billing_exempt(uuid, boolean, text), public.my_company_access(),
--     public.tg_subscription_posting_guard(), public._company_read_only(uuid), public.company_access(uuid);
--   DROP TABLE public.billing_settings;
--   COMMIT;
