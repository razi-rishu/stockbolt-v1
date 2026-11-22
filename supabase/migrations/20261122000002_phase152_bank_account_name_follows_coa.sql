-- ═══════════════════════════════════════════════════════════════════════════
-- phase152 — a bank / cash account's name follows its chart-of-accounts rename
-- ═══════════════════════════════════════════════════════════════════════════
-- A bank account has its own display name (bank_accounts.name / name_ar) next
-- to the GL account it posts to (coa_account_id). Renaming the GL account in
-- Chart of Accounts left the bank card on the old name (reported 2026-11-22:
-- "Anas Cash Account" stayed after the GL became "Anas Petty Cash").
--
-- Rule: when a chart_of_accounts name (or Arabic name) changes, every bank
-- account of the same company that posts to it AND still carried the OLD name
-- (case and surrounding spaces ignored) takes the new name. A bank account
-- with a name of its own ("Emirates NBD – Current" on "1110 Bank") is never
-- touched. Display names only — no posting, balance or GL row changes.
--
-- SECURITY DEFINER so the follow-up update is not silently filtered by the
-- banking RLS rules for a user who may rename accounts but not edit banks;
-- it only ever touches rows of NEW.company_id linked to NEW.id. Not callable
-- by clients (trigger only).
--
-- SAFE TO APPLY: one new function + one trigger. No data changes on apply.
-- Re-runnable. Rollback at the end.
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

CREATE OR REPLACE FUNCTION public.tg_coa_rename_follow_bank_accounts()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  IF NEW.name IS DISTINCT FROM OLD.name AND OLD.name IS NOT NULL THEN
    UPDATE public.bank_accounts
       SET name = NEW.name
     WHERE company_id = NEW.company_id
       AND coa_account_id = NEW.id
       AND lower(btrim(name)) = lower(btrim(OLD.name));
  END IF;
  IF NEW.name_ar IS DISTINCT FROM OLD.name_ar AND OLD.name_ar IS NOT NULL AND btrim(OLD.name_ar) <> '' THEN
    UPDATE public.bank_accounts
       SET name_ar = NEW.name_ar
     WHERE company_id = NEW.company_id
       AND coa_account_id = NEW.id
       AND lower(btrim(name_ar)) = lower(btrim(OLD.name_ar));
  END IF;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS coa_rename_follow_bank_accounts ON public.chart_of_accounts;
CREATE TRIGGER coa_rename_follow_bank_accounts
  AFTER UPDATE OF name, name_ar ON public.chart_of_accounts
  FOR EACH ROW EXECUTE FUNCTION public.tg_coa_rename_follow_bank_accounts();

REVOKE ALL ON FUNCTION public.tg_coa_rename_follow_bank_accounts() FROM PUBLIC, anon, authenticated;

COMMIT;

-- ── VERIFY after applying ─────────────────────────────────────────────────
-- SELECT count(*) AS trigger_expect_1 FROM pg_trigger WHERE tgname = 'coa_rename_follow_bank_accounts';
--
-- ── Accounts renamed BEFORE this existed keep their old bank name. To see
--    them (read-only), then rename them on the Bank Accounts page:
-- SELECT b.name AS bank_name, c.code, c.name AS gl_name
--   FROM public.bank_accounts b JOIN public.chart_of_accounts c ON c.id = b.coa_account_id
--  WHERE lower(btrim(b.name)) <> lower(btrim(c.name));
--
-- ── ROLLBACK ──────────────────────────────────────────────────────────────
--   BEGIN;
--   DROP TRIGGER IF EXISTS coa_rename_follow_bank_accounts ON public.chart_of_accounts;
--   DROP FUNCTION IF EXISTS public.tg_coa_rename_follow_bank_accounts();
--   COMMIT;
