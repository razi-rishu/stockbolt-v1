-- ─────────────────────────────────────────────────────────────────────────
-- StockBolt v1 — Phase 18b: product search matches replacement_numbers
-- ─────────────────────────────────────────────────────────────────────────
-- Auto-parts items carry one OE/OEM number (products.oe_number) plus many
-- cross-reference / replacement numbers (products.replacement_numbers TEXT[]).
-- Search previously matched sku / name / oe_number only, so a part could not
-- be found by typing one of its cross-refs at POS / invoice / quote pickers.
--
-- This extends search_products to match + rank against the flattened
-- replacement_numbers array, and adds a trigram index on the flattened text
-- so the OR clause still uses an index at scale. array_to_string(...) is
-- IMMUTABLE, so a functional GIN trigram index is allowed.
--
-- Read-only / search only — no posting, GL, or inventory change. Idempotent.
-- ─────────────────────────────────────────────────────────────────────────

-- Trigram index on the flattened cross-reference numbers.
CREATE INDEX IF NOT EXISTS products_replacement_numbers_trgm_idx
  ON public.products USING gin (array_to_string(replacement_numbers, ' ') gin_trgm_ops)
  WHERE replacement_numbers IS NOT NULL;

CREATE OR REPLACE FUNCTION public.search_products(
  p_company_id        UUID,
  p_q                 TEXT DEFAULT NULL,
  p_limit             INTEGER DEFAULT 20,
  p_brand_id          UUID DEFAULT NULL,
  p_category_id       UUID DEFAULT NULL,
  p_include_inactive  BOOLEAN DEFAULT FALSE
)
RETURNS TABLE (
  id            UUID,
  sku           TEXT,
  name          TEXT,
  name_ar       TEXT,
  oe_number     TEXT,
  barcode       TEXT,
  brand_id      UUID,
  brand_name    TEXT,
  category_id   UUID,
  category_name TEXT,
  unit_id       UUID,
  unit_code     TEXT,
  selling_price NUMERIC,
  is_active     BOOLEAN,
  match_rank    REAL
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_q TEXT := NULLIF(TRIM(COALESCE(p_q, '')), '');
  v_limit INTEGER := LEAST(GREATEST(COALESCE(p_limit, 20), 1), 100);
BEGIN
  RETURN QUERY
  SELECT
    p.id::UUID,
    p.sku::TEXT,
    p.name::TEXT,
    p.name_ar::TEXT,
    p.oe_number::TEXT,
    p.barcode::TEXT,
    p.brand_id::UUID,
    b.name::TEXT,
    p.category_id::UUID,
    c.name::TEXT,
    p.unit_id::UUID,
    u.code::TEXT,
    p.selling_price::NUMERIC,
    p.is_active::BOOLEAN,
    -- Rank:
    --   2.0 = exact barcode hit
    --   1.5 = exact SKU hit
    --   1.0 + similarity = trigram match on SKU/name/oe_number/replacement_numbers
    --   0.0 = no query (just list-all path)
    (CASE
      WHEN v_q IS NULL THEN 0::REAL
      WHEN p.barcode = v_q THEN 2.0::REAL
      WHEN LOWER(p.sku) = LOWER(v_q) THEN 1.5::REAL
      ELSE (1.0 + GREATEST(
        similarity(p.sku,                 v_q),
        similarity(p.name,                v_q),
        similarity(COALESCE(p.oe_number,''), v_q),
        similarity(COALESCE(array_to_string(p.replacement_numbers, ' '), ''), v_q)
      ))::REAL
    END)::REAL AS match_rank
  FROM public.products p
  LEFT JOIN public.brands               b ON b.id = p.brand_id
  LEFT JOIN public.categories           c ON c.id = p.category_id
  LEFT JOIN public.units_of_measure     u ON u.id = p.unit_id
  WHERE p.company_id = p_company_id
    AND (p_include_inactive OR p.is_active = TRUE)
    AND (p_brand_id    IS NULL OR p.brand_id    = p_brand_id)
    AND (p_category_id IS NULL OR p.category_id = p_category_id)
    AND (
      v_q IS NULL
      OR p.barcode = v_q
      OR p.sku       ILIKE '%' || v_q || '%'
      OR p.name      ILIKE '%' || v_q || '%'
      OR p.oe_number ILIKE '%' || v_q || '%'
      OR array_to_string(p.replacement_numbers, ' ') ILIKE '%' || v_q || '%'
    )
  ORDER BY 15 DESC, p.name ASC
  LIMIT v_limit;
END;
$$;

REVOKE ALL ON FUNCTION public.search_products(UUID, TEXT, INTEGER, UUID, UUID, BOOLEAN) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.search_products(UUID, TEXT, INTEGER, UUID, UUID, BOOLEAN) TO authenticated;

COMMENT ON FUNCTION public.search_products IS
  'SmartEntitySearch backend for product picker. Trigram-ranked match on '
  'sku/name/oe_number/replacement_numbers, exact match on barcode. Cap 100 rows/query.';
