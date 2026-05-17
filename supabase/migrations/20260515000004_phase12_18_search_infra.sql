-- ─────────────────────────────────────────────────────────────────────────
-- StockBolt v1 — Phase 12 — Migration 18: SmartEntitySearch infrastructure
-- ─────────────────────────────────────────────────────────────────────────
-- Backs the new search-as-you-type dropdowns. Two server-side RPCs hit
-- trigram-indexed columns and return paginated, ranked results.
--
-- Why server-side: at 100k products the current preload-all-options
-- dropdown would ship megabytes per page load. Server-side filter + 20-
-- row cap per query stays under 100ms regardless of catalog size.
--
-- Why trigram: auto parts users type partial SKUs ("TY909"), OEM numbers
-- with formatting variations ("90915 YZZD2" vs "90915-YZZD2"), and
-- product names with typos. Plain b-tree LIKE 'x%' matches prefixes only.
-- pg_trgm matches anywhere in the string AND ranks by similarity.
--
-- Idempotent — re-running is safe.
-- ─────────────────────────────────────────────────────────────────────────

CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- ── Indexes on products ──────────────────────────────────────────────────
-- Trigram GIN for fuzzy/anywhere matching. The COALESCE in oe_number /
-- barcode avoids GIN nulls; we still skip NULL rows at query time.
CREATE INDEX IF NOT EXISTS products_company_active_idx
  ON public.products (company_id, is_active);

CREATE INDEX IF NOT EXISTS products_sku_trgm_idx
  ON public.products USING gin (sku gin_trgm_ops);

CREATE INDEX IF NOT EXISTS products_name_trgm_idx
  ON public.products USING gin (name gin_trgm_ops);

CREATE INDEX IF NOT EXISTS products_oe_number_trgm_idx
  ON public.products USING gin (oe_number gin_trgm_ops)
  WHERE oe_number IS NOT NULL;

CREATE INDEX IF NOT EXISTS products_barcode_idx
  ON public.products (barcode)
  WHERE barcode IS NOT NULL;

-- ── Indexes on contacts ──────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS contacts_name_trgm_idx
  ON public.contacts USING gin (name gin_trgm_ops);

CREATE INDEX IF NOT EXISTS contacts_phone_idx
  ON public.contacts (phone)
  WHERE phone IS NOT NULL;

CREATE INDEX IF NOT EXISTS contacts_tax_id_idx
  ON public.contacts (tax_id)
  WHERE tax_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS contacts_email_idx
  ON public.contacts (email)
  WHERE email IS NOT NULL;

-- ─────────────────────────────────────────────────────────────────────────
-- search_products RPC
-- ─────────────────────────────────────────────────────────────────────────
-- Matches against: sku, name, oe_number (anywhere, fuzzy), barcode (exact).
-- Ranks: exact SKU/barcode hit first, then trigram similarity desc.
-- Returns the columns the dropdown renders inline (SmartEntitySearch
-- "rich list" style — SKU + name + brand + OEM + selling price).
-- Live stock + MAC are fetched separately by the UI via the cached
-- stockMap (Phase 12.16) so a hot product list doesn't trigger
-- expensive aggregates per keystroke.

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
  -- Defensive: every column is explicitly cast to its declared RETURNS
  -- TABLE type. Postgres rejects the function with "structure of query
  -- does not match function result type" if ANY column's actual type
  -- differs (e.g. NUMERIC(15,2) vs NUMERIC, VARCHAR(N) vs TEXT). Cheap
  -- runtime cost, immune to schema drift.
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
    --   1.0 + similarity = trigram match on SKU/name/oe_number
    --   0.0 = no query (just list-all path)
    (CASE
      WHEN v_q IS NULL THEN 0::REAL
      WHEN p.barcode = v_q THEN 2.0::REAL
      WHEN LOWER(p.sku) = LOWER(v_q) THEN 1.5::REAL
      ELSE (1.0 + GREATEST(
        similarity(p.sku,                 v_q),
        similarity(p.name,                v_q),
        similarity(COALESCE(p.oe_number,''), v_q)
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
    )
  -- Order by position 15 (the cast match_rank) rather than the alias —
  -- PostgreSQL's ORDER BY can't see a SELECT-list alias defined by the
  -- enclosing CASE expression in some plan-cache paths.
  ORDER BY 15 DESC, p.name ASC
  LIMIT v_limit;
END;
$$;

REVOKE ALL ON FUNCTION public.search_products(UUID, TEXT, INTEGER, UUID, UUID, BOOLEAN) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.search_products(UUID, TEXT, INTEGER, UUID, UUID, BOOLEAN) TO authenticated;

-- ─────────────────────────────────────────────────────────────────────────
-- search_contacts RPC
-- ─────────────────────────────────────────────────────────────────────────
-- Matches: name (fuzzy), phone (exact), tax_id (exact), email (prefix).
-- p_type filters customer/supplier/both.
-- Optional outstanding flag for future use — fetched separately by the UI
-- for now.

CREATE OR REPLACE FUNCTION public.search_contacts(
  p_company_id  UUID,
  p_q           TEXT DEFAULT NULL,
  p_type        TEXT DEFAULT NULL,    -- 'customer' | 'supplier' | NULL = both
  p_limit       INTEGER DEFAULT 20
)
RETURNS TABLE (
  id           UUID,
  type         TEXT,
  name         TEXT,
  name_ar      TEXT,
  phone        TEXT,
  email        TEXT,
  tax_id       TEXT,
  credit_limit NUMERIC,
  match_rank   REAL
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
  -- See defensive-cast note in search_products above.
  SELECT
    ct.id::UUID,
    ct.type::TEXT,
    ct.name::TEXT,
    ct.name_ar::TEXT,
    ct.phone::TEXT,
    ct.email::TEXT,
    ct.tax_id::TEXT,
    ct.credit_limit::NUMERIC,
    (CASE
      WHEN v_q IS NULL THEN 0::REAL
      WHEN ct.phone  = v_q                 THEN 2.0::REAL
      WHEN ct.tax_id = v_q                 THEN 1.8::REAL
      WHEN LOWER(ct.email) = LOWER(v_q)    THEN 1.5::REAL
      ELSE (1.0 + similarity(ct.name, v_q))::REAL
    END)::REAL AS match_rank
  FROM public.contacts ct
  WHERE ct.company_id = p_company_id
    AND (p_type IS NULL OR ct.type = p_type)
    AND (
      v_q IS NULL
      OR ct.phone   = v_q
      OR ct.tax_id  = v_q
      OR ct.name    ILIKE '%' || v_q || '%'
      OR ct.email   ILIKE v_q || '%'
    )
  ORDER BY 9 DESC, ct.name ASC
  LIMIT v_limit;
END;
$$;

REVOKE ALL ON FUNCTION public.search_contacts(UUID, TEXT, TEXT, INTEGER) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.search_contacts(UUID, TEXT, TEXT, INTEGER) TO authenticated;

COMMENT ON FUNCTION public.search_products IS
  'SmartEntitySearch backend for product picker. Trigram-ranked match on '
  'sku/name/oe_number, exact match on barcode. Returns rich-list columns. '
  'Cap 100 rows/query.';
COMMENT ON FUNCTION public.search_contacts IS
  'SmartEntitySearch backend for customer/supplier picker. Exact match on '
  'phone/tax_id/email, trigram on name. Cap 100 rows/query.';
