-- ═══════════════════════════════════════════════════════════════════════════
-- phase153 — Inventory Settings: optional inventory features, per company
-- ═══════════════════════════════════════════════════════════════════════════
-- Part 1 of the inventory plan (2026-11-24). One row per company says which
-- optional inventory features its users SEE. It is presentation only: no
-- posting function, trigger on stock or report reads it, and switching a
-- feature off never deletes or blocks existing data.
--
-- EXISTING COMPANIES: no row is created for them. No row = every feature on,
-- exactly as before this migration. A row appears only when an administrator
-- saves the Inventory Settings page.
--
-- NEW COMPANIES: an AFTER INSERT trigger on companies adds a row with the
-- rarely needed features off (transfers, shelf locations). It swallows every
-- error — like the subscription trigger (phase31) — so it can never stop a
-- sign-up; if it failed the company simply starts with everything on.
--
-- SAFE TO APPLY: one new table + two trigger functions. No existing table,
-- row, function or policy changes. Re-runnable. Additive: nothing to undo;
-- the app falls back to "everything on" when the table is missing.
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

CREATE TABLE IF NOT EXISTS public.inventory_settings (
  company_id             uuid PRIMARY KEY REFERENCES public.companies(id) ON DELETE CASCADE,
  transfers_enabled      boolean NOT NULL DEFAULT true,
  reorder_enabled        boolean NOT NULL DEFAULT true,
  barcodes_enabled       boolean NOT NULL DEFAULT true,
  brands_enabled         boolean NOT NULL DEFAULT true,   -- brands and categories
  shelf_enabled          boolean NOT NULL DEFAULT true,   -- aisle / bin
  updated_by             uuid DEFAULT auth.uid(),
  created_at             timestamptz NOT NULL DEFAULT now(),
  updated_at             timestamptz NOT NULL DEFAULT now()
);

DROP TRIGGER IF EXISTS inventory_settings_set_updated_at ON public.inventory_settings;
CREATE TRIGGER inventory_settings_set_updated_at BEFORE UPDATE ON public.inventory_settings
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- Everyone in the company reads it (menus follow it); only users who may
-- change settings write it. No DELETE for clients.
ALTER TABLE public.inventory_settings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS inventory_settings_read ON public.inventory_settings;
CREATE POLICY inventory_settings_read ON public.inventory_settings
  FOR SELECT TO authenticated
  USING (company_id = public.current_user_company_id());

DROP POLICY IF EXISTS inventory_settings_insert ON public.inventory_settings;
CREATE POLICY inventory_settings_insert ON public.inventory_settings
  FOR INSERT TO authenticated
  WITH CHECK (company_id = public.current_user_company_id() AND public.has_perm('settings.write'));

DROP POLICY IF EXISTS inventory_settings_update ON public.inventory_settings;
CREATE POLICY inventory_settings_update ON public.inventory_settings
  FOR UPDATE TO authenticated
  USING (company_id = public.current_user_company_id() AND public.has_perm('settings.write'))
  WITH CHECK (company_id = public.current_user_company_id() AND public.has_perm('settings.write'));

REVOKE ALL ON public.inventory_settings FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON public.inventory_settings TO authenticated;
GRANT ALL ON public.inventory_settings TO service_role;

-- New companies start lean.
CREATE OR REPLACE FUNCTION public.tg_new_company_inventory_settings()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  BEGIN
    INSERT INTO public.inventory_settings (company_id, transfers_enabled, shelf_enabled)
    VALUES (NEW.id, false, false)
    ON CONFLICT (company_id) DO NOTHING;
  EXCEPTION WHEN OTHERS THEN
    NULL;  -- a display preference must never block company creation
  END;
  RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION public.tg_new_company_inventory_settings() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS companies_inventory_settings ON public.companies;
CREATE TRIGGER companies_inventory_settings
  AFTER INSERT ON public.companies
  FOR EACH ROW EXECUTE FUNCTION public.tg_new_company_inventory_settings();

COMMIT;

NOTIFY pgrst, 'reload schema';

-- ── VERIFY after applying (expect: 0 | true | 3 | 1) ──────────────────────
-- SELECT (SELECT count(*) FROM public.inventory_settings)                           AS rows_expect_0,
--        (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.inventory_settings'::regclass) AS rls_on,
--        (SELECT count(*) FROM pg_policy WHERE polrelid = 'public.inventory_settings'::regclass) AS policies_expect_3,
--        (SELECT count(*) FROM pg_trigger WHERE tgname = 'companies_inventory_settings')         AS trigger_expect_1;
--   (rows may be above 0 if a company signed up or saved the page since.)
