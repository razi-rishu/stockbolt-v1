-- ═══════════════════════════════════════════════════════════════════════════
-- phase143 — company currency display preference (symbol or ISO code)
--
-- PRESENTATION ONLY. Adds companies.currency_display:
--   NULL or 'code' → amounts show the ISO code (AED 1,234.00) — the existing
--                    behaviour; every existing company keeps it (NULL).
--   'symbol'       → amounts show the currency symbol (د.إ 1,234.00).
-- Nothing reads it for money: amounts, exchange rates, tax, journal entries
-- and postings are untouched. The app derives every label from the amount's
-- own currency code (src/lib/currency-display.ts).
--
-- Security: no new policy. companies already allows UPDATE only to the
-- company's own users WITH settings.write (tenant_isolation + restrictive
-- rbac_w_upd_companies), so only Business Settings writers can change it and
-- every company user can read it. One company's choice never affects another.
--
-- SAFE TO APPLY: additive, nullable column with a CHECK; no existing row is
-- written. Re-running is safe.
--
-- ROLLBACK:
--   ALTER TABLE public.companies DROP COLUMN IF EXISTS currency_display;
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

ALTER TABLE public.companies ADD COLUMN IF NOT EXISTS currency_display text;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'companies_currency_display_check') THEN
    ALTER TABLE public.companies ADD CONSTRAINT companies_currency_display_check
      CHECK (currency_display IS NULL OR currency_display IN ('code', 'symbol'));
  END IF;
END $$;

COMMENT ON COLUMN public.companies.currency_display IS
  'phase143 — UI currency label: NULL/code = ISO code (default), symbol = currency symbol. Presentation only.';

COMMIT;

-- ── Verify after applying (read-only) ──────────────────────────────────────
-- SELECT count(*) FILTER (WHERE currency_display IS NULL) AS untouched, count(*) AS companies FROM public.companies;  -- equal
