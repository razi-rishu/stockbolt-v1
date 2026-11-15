-- ═══════════════════════════════════════════════════════════════════════════
-- phase132 — VAT / GST registration number validated on the server
--
-- Before: nothing in the database checked companies.tax_id. The setup wizard
-- only refused an EMPTY number (any text passed), Company Settings refused
-- nothing, and a direct API / RPC call (complete_onboarding, or an UPDATE of
-- companies) could save "registered" with no number or a malformed one —
-- including a VAT registration in Kuwait or Qatar, where there is no VAT.
--
-- After: a BEFORE INSERT / UPDATE trigger on companies refuses, with
--   'tax_registration_invalid:<code>'   code = required | not_available | format
-- a company that is VAT/GST registered without a well-formed number for its
-- country. Same rules as src/core/global-config/tax-registration.ts:
--   AE  15 digits                                  FTA — TRN is 15 digits
--   SA  15 digits, first and last digit 3          ZATCA e-invoicing rule BR-KSA-40
--   BH  15 digits                                  NBR — VAT account number, 15 digits
--   OM  OM + 9 digits + a final digit or X         Oman Tax Authority VATIN (OM + 10;
--                                                  valid numbers can end in X)
--   IN  GSTIN: state 01–38 / 97 / 99, PAN, entity, check character (mod 36)
--   KW, QA  registration not available (no VAT law in force)
-- A well-formed number is not proof the authority issued it.
--
-- BACKWARD COMPATIBLE — existing companies are never blocked or changed:
--   • An UPDATE is checked only when is_tax_registered, tax_id or
--     country_code actually changes. A company whose old number is missing
--     or malformed can still save its name, address, logo and everything
--     else; it is asked for a valid number only when it edits the tax fields.
--   • No existing row is updated by this migration. The verify query below
--     LISTS companies whose stored registration would not pass, for review.
--   • A company that is not registered keeps whatever number it has.
-- The stored number is normalised (upper case; spaces, hyphens, dots removed)
-- only when it is being validated.
--
-- SAFE TO APPLY: one function, one trigger. No data change. Re-runnable.
-- ROLLBACK:
--   DROP TRIGGER IF EXISTS companies_tax_registration ON public.companies;
--   DROP FUNCTION IF EXISTS public.tg_companies_tax_registration();
--   DROP FUNCTION IF EXISTS public.tax_registration_error(text, boolean, text);
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

CREATE OR REPLACE FUNCTION public.tax_registration_error(p_country text, p_registered boolean, p_tax_id text)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
SET search_path TO 'public'
AS $function$
DECLARE
  c      text := upper(btrim(COALESCE(p_country, '')));
  n      text := upper(regexp_replace(COALESCE(p_tax_id, ''), '[\s.\-]', '', 'g'));
  alpha  text := '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  total  int  := 0;
  prod   int;
  state  int;
  i      int;
BEGIN
  IF NOT COALESCE(p_registered, false) THEN RETURN NULL; END IF;
  IF c IN ('KW', 'QA') THEN RETURN 'not_available'; END IF;
  IF n = '' THEN RETURN 'required'; END IF;

  IF c = 'AE' THEN RETURN CASE WHEN n ~ '^[0-9]{15}$' THEN NULL ELSE 'format' END; END IF;
  IF c = 'SA' THEN RETURN CASE WHEN n ~ '^3[0-9]{13}3$' THEN NULL ELSE 'format' END; END IF;
  IF c = 'BH' THEN RETURN CASE WHEN n ~ '^[0-9]{15}$' THEN NULL ELSE 'format' END; END IF;
  IF c = 'OM' THEN RETURN CASE WHEN n ~ '^OM[0-9]{9}[0-9X]$' THEN NULL ELSE 'format' END; END IF;
  IF c = 'IN' THEN
    IF n !~ '^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z][0-9A-Z][0-9A-Z]$' THEN RETURN 'format'; END IF;
    state := substr(n, 1, 2)::int;
    IF NOT ((state BETWEEN 1 AND 38) OR state IN (97, 99)) THEN RETURN 'format'; END IF;
    FOR i IN 1..14 LOOP
      prod  := (strpos(alpha, substr(n, i, 1)) - 1) * CASE WHEN i % 2 = 1 THEN 1 ELSE 2 END;
      total := total + (prod / 36) + (prod % 36);
    END LOOP;
    RETURN CASE WHEN substr(alpha, ((36 - total % 36) % 36) + 1, 1) = substr(n, 15, 1) THEN NULL ELSE 'format' END;
  END IF;
  -- Any other country: no statutory format claimed.
  RETURN CASE WHEN length(n) <= 50 THEN NULL ELSE 'format' END;
END;
$function$;

CREATE OR REPLACE FUNCTION public.tg_companies_tax_registration()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $function$
DECLARE v_err text;
BEGIN
  -- Existing companies are only checked when they touch the tax fields.
  IF TG_OP = 'UPDATE'
     AND NEW.is_tax_registered IS NOT DISTINCT FROM OLD.is_tax_registered
     AND NEW.tax_id            IS NOT DISTINCT FROM OLD.tax_id
     AND NEW.country_code      IS NOT DISTINCT FROM OLD.country_code THEN
    RETURN NEW;
  END IF;
  -- A country change on a company that is not registered needs no number.
  v_err := public.tax_registration_error(NEW.country_code, NEW.is_tax_registered, NEW.tax_id);
  IF v_err IS NOT NULL THEN
    RAISE EXCEPTION 'tax_registration_invalid:% (country %)', v_err, NEW.country_code USING ERRCODE = '22023';
  END IF;
  IF NEW.is_tax_registered THEN
    NEW.tax_id := upper(regexp_replace(NEW.tax_id, '[\s.\-]', '', 'g'));
  END IF;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS companies_tax_registration ON public.companies;
CREATE TRIGGER companies_tax_registration
  BEFORE INSERT OR UPDATE ON public.companies
  FOR EACH ROW EXECUTE FUNCTION public.tg_companies_tax_registration();

REVOKE ALL ON FUNCTION public.tg_companies_tax_registration() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.tax_registration_error(text, boolean, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.tax_registration_error(text, boolean, text) TO authenticated;

COMMIT;

-- ── Verify after applying (read-only) ─────────────────────────────────────
-- 1. Installed: expect true, true.
-- SELECT to_regprocedure('public.tax_registration_error(text,boolean,text)') IS NOT NULL AS fn,
--        EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'companies_tax_registration') AS trigger;
-- 2. Existing companies whose stored registration would not pass today (for
--    review only — they keep working; each is asked for a valid number the
--    next time it edits its tax details):
-- SELECT id, name, country_code, tax_id,
--        public.tax_registration_error(country_code, is_tax_registered, tax_id) AS problem
--   FROM public.companies
--  WHERE public.tax_registration_error(country_code, is_tax_registered, tax_id) IS NOT NULL
--  ORDER BY name;
