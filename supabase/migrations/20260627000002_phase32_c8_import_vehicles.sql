-- ════════════════════════════════════════════════════════════════════════════
-- Phase 32 / Automotive Catalog C8 — import_vehicles RPC (bulk hierarchical upsert)
-- ────────────────────────────────────────────────────────────────────────────
-- Takes an array of flat CSV rows and find-or-creates the whole hierarchy per row:
--   Make → Model → Generation → Variant (+ reusable Engine), matched by natural key
--   (case-insensitive name within parent) so re-importing never duplicates.
-- SECURITY DEFINER, company-scoped, inventory.write-gated. Only ever writes
-- TENANT-OWNED rows (company_id = caller's company) — never touches the
-- system-shared catalog (company_id IS NULL). Additive + idempotent.
-- Run by hand in the Supabase SQL Editor.
-- Row keys (all text): make, model, generation, year_from, year_to,
--   engine_code, fuel, transmission, drive, chassis.
-- ════════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.import_vehicles(p_rows jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_co uuid := public.current_user_company_id();
  r jsonb;
  v_make_name text; v_model_name text; v_gen_name text;
  v_make_id uuid; v_model_id uuid; v_gen_id uuid; v_engine_id uuid; v_variant_id uuid;
  v_engine_code text; v_fuel text; v_trans text; v_drive text; v_chassis text;
  v_yf int; v_yt int;
  c_makes int := 0; c_models int := 0; c_gens int := 0; c_variants int := 0; c_engines int := 0; c_rows int := 0;
BEGIN
  IF v_co IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;
  IF NOT public.has_perm('inventory.write') THEN
    RAISE EXCEPTION 'Permission denied: inventory.write required';
  END IF;

  FOR r IN SELECT * FROM jsonb_array_elements(COALESCE(p_rows, '[]'::jsonb))
  LOOP
    v_make_name  := NULLIF(btrim(COALESCE(r->>'make', '')), '');
    v_model_name := NULLIF(btrim(COALESCE(r->>'model', '')), '');
    IF v_make_name IS NULL OR v_model_name IS NULL THEN
      CONTINUE;  -- skip rows missing the minimum identity
    END IF;
    c_rows := c_rows + 1;

    v_gen_name    := COALESCE(NULLIF(btrim(COALESCE(r->>'generation', '')), ''), 'Standard');
    v_engine_code := NULLIF(btrim(COALESCE(r->>'engine_code', '')), '');
    v_fuel        := NULLIF(btrim(COALESCE(r->>'fuel', '')), '');
    v_trans       := NULLIF(btrim(COALESCE(r->>'transmission', '')), '');
    v_drive       := NULLIF(btrim(COALESCE(r->>'drive', '')), '');
    v_chassis     := NULLIF(btrim(COALESCE(r->>'chassis', '')), '');
    v_yf := CASE WHEN COALESCE(r->>'year_from', '') ~ '^\s*\d{4}\s*$' THEN btrim(r->>'year_from')::int ELSE NULL END;
    v_yt := CASE WHEN COALESCE(r->>'year_to',   '') ~ '^\s*\d{4}\s*$' THEN btrim(r->>'year_to')::int   ELSE NULL END;

    -- Make (tenant-owned only)
    SELECT id INTO v_make_id FROM public.vehicle_makes
      WHERE company_id = v_co AND lower(name) = lower(v_make_name) LIMIT 1;
    IF v_make_id IS NULL THEN
      INSERT INTO public.vehicle_makes (company_id, name) VALUES (v_co, v_make_name) RETURNING id INTO v_make_id;
      c_makes := c_makes + 1;
    END IF;

    -- Model
    SELECT id INTO v_model_id FROM public.vehicle_models
      WHERE make_id = v_make_id AND lower(name) = lower(v_model_name) LIMIT 1;
    IF v_model_id IS NULL THEN
      INSERT INTO public.vehicle_models (make_id, name, chassis_code) VALUES (v_make_id, v_model_name, v_chassis) RETURNING id INTO v_model_id;
      c_models := c_models + 1;
    END IF;

    -- Generation
    SELECT id INTO v_gen_id FROM public.vehicle_generations
      WHERE model_id = v_model_id AND lower(name) = lower(v_gen_name) LIMIT 1;
    IF v_gen_id IS NULL THEN
      INSERT INTO public.vehicle_generations (model_id, name, year_from, year_to)
        VALUES (v_model_id, v_gen_name, v_yf, v_yt) RETURNING id INTO v_gen_id;
      c_gens := c_gens + 1;
    END IF;

    -- Engine (optional, reusable; tenant-owned)
    v_engine_id := NULL;
    IF v_engine_code IS NOT NULL THEN
      SELECT id INTO v_engine_id FROM public.vehicle_engines
        WHERE company_id = v_co AND lower(engine_code) = lower(v_engine_code) LIMIT 1;
      IF v_engine_id IS NULL THEN
        INSERT INTO public.vehicle_engines (company_id, engine_code, fuel_type)
          VALUES (v_co, v_engine_code, v_fuel) RETURNING id INTO v_engine_id;
        c_engines := c_engines + 1;
      END IF;
    END IF;

    -- Variant (natural key = generation + engine + transmission + drive + years + chassis)
    SELECT id INTO v_variant_id FROM public.vehicle_variants
      WHERE generation_id = v_gen_id
        AND engine_id    IS NOT DISTINCT FROM v_engine_id
        AND transmission IS NOT DISTINCT FROM v_trans
        AND drive_type   IS NOT DISTINCT FROM v_drive
        AND year_from    IS NOT DISTINCT FROM v_yf
        AND year_to      IS NOT DISTINCT FROM v_yt
        AND chassis_code IS NOT DISTINCT FROM v_chassis
      LIMIT 1;
    IF v_variant_id IS NULL THEN
      INSERT INTO public.vehicle_variants (generation_id, engine_id, transmission, drive_type, fuel_type, year_from, year_to, chassis_code, label)
        VALUES (v_gen_id, v_engine_id, v_trans, v_drive, v_fuel, v_yf, v_yt, v_chassis,
                NULLIF(btrim(concat_ws(' · ', v_engine_code, v_fuel, v_trans)), ''))
        RETURNING id INTO v_variant_id;
      c_variants := c_variants + 1;
    END IF;
  END LOOP;

  RETURN jsonb_build_object(
    'rows', c_rows,
    'makes_created', c_makes,
    'models_created', c_models,
    'generations_created', c_gens,
    'variants_created', c_variants,
    'engines_created', c_engines);
END;
$$;

GRANT EXECUTE ON FUNCTION public.import_vehicles(jsonb) TO authenticated;

NOTIFY pgrst, 'reload schema';
