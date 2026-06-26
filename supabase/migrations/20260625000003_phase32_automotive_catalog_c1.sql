-- ════════════════════════════════════════════════════════════════════════════
-- Phase 32 — Integrated Automotive Catalog — C1 schema (see docs/Document_8)
-- ════════════════════════════════════════════════════════════════════════════
-- FULLY ADDITIVE. No existing column/table is dropped or renamed, so the current
-- 2-level vehicles, brands, categories, products and product_compatibility keep
-- working unchanged. Adds the deep vehicle hierarchy (generations/variants/
-- engines), enriches brands/categories/makes/models, evolves compatibility to
-- support precise fitment, backfills legacy models into the new hierarchy, and
-- seeds a shared GCC/India make catalog (company_id NULL).
--
-- Every catalog table gets external_source/external_ref so VIN/TecDoc/OEM/eBay
-- imports map in later with zero schema change.
--
-- RLS mirrors the existing vehicle pattern: a row is visible if its owning make's
-- company_id IS NULL (system-shared) OR = the caller's company; writable only by
-- the owning tenant. Run by hand in the SQL Editor, then NOTIFY pgrst.
-- ════════════════════════════════════════════════════════════════════════════

-- ── 1. Enrich brands (§5) ───────────────────────────────────────────────────
ALTER TABLE public.brands
  ADD COLUMN IF NOT EXISTS country         TEXT,
  ADD COLUMN IF NOT EXISTS manufacturer    TEXT,
  ADD COLUMN IF NOT EXISTS website         TEXT,
  ADD COLUMN IF NOT EXISTS description     TEXT,
  ADD COLUMN IF NOT EXISTS external_source TEXT,
  ADD COLUMN IF NOT EXISTS external_ref    TEXT;

-- ── 2. Enrich categories (§6 — already nested via parent_id) ────────────────
ALTER TABLE public.categories
  ADD COLUMN IF NOT EXISTS icon            TEXT,
  ADD COLUMN IF NOT EXISTS image_url       TEXT,
  ADD COLUMN IF NOT EXISTS description     TEXT,
  ADD COLUMN IF NOT EXISTS description_ar  TEXT,
  ADD COLUMN IF NOT EXISTS external_source TEXT,
  ADD COLUMN IF NOT EXISTS external_ref    TEXT;

-- ── 3. Enrich vehicle_makes / vehicle_models ────────────────────────────────
ALTER TABLE public.vehicle_makes
  ADD COLUMN IF NOT EXISTS country         TEXT,
  ADD COLUMN IF NOT EXISTS is_active       BOOLEAN NOT NULL DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS external_source TEXT,
  ADD COLUMN IF NOT EXISTS external_ref    TEXT,
  ADD COLUMN IF NOT EXISTS updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW();

ALTER TABLE public.vehicle_models
  ADD COLUMN IF NOT EXISTS body_type       TEXT,
  ADD COLUMN IF NOT EXISTS is_active       BOOLEAN NOT NULL DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS external_source TEXT,
  ADD COLUMN IF NOT EXISTS external_ref    TEXT,
  ADD COLUMN IF NOT EXISTS updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW();

-- ── 4. vehicle_engines (NEW — reusable engine catalog) ──────────────────────
CREATE TABLE IF NOT EXISTS public.vehicle_engines (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id      UUID REFERENCES public.companies(id) ON DELETE CASCADE,   -- NULL = system-shared
  engine_code     TEXT NOT NULL,
  displacement_cc INTEGER,
  fuel_type       TEXT,
  power_hp        INTEGER,
  description     TEXT,
  is_active       BOOLEAN NOT NULL DEFAULT TRUE,
  external_source TEXT,
  external_ref    TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS vehicle_engines_company_idx ON public.vehicle_engines (company_id);
CREATE INDEX IF NOT EXISTS vehicle_engines_code_idx    ON public.vehicle_engines (engine_code);

-- ── 5. vehicle_generations (NEW — Make→Model→Generation) ────────────────────
CREATE TABLE IF NOT EXISTS public.vehicle_generations (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  model_id        UUID NOT NULL REFERENCES public.vehicle_models(id) ON DELETE CASCADE,
  name            TEXT NOT NULL,                 -- e.g. "E170"
  code            TEXT,
  year_from       INTEGER,
  year_to         INTEGER,
  is_active       BOOLEAN NOT NULL DEFAULT TRUE,
  external_source TEXT,
  external_ref    TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS vehicle_generations_model_idx ON public.vehicle_generations (model_id);
CREATE INDEX IF NOT EXISTS vehicle_generations_year_idx  ON public.vehicle_generations (year_from, year_to);

-- ── 6. vehicle_variants (NEW — the precise fitment leaf) ────────────────────
CREATE TABLE IF NOT EXISTS public.vehicle_variants (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  generation_id   UUID NOT NULL REFERENCES public.vehicle_generations(id) ON DELETE CASCADE,
  engine_id       UUID REFERENCES public.vehicle_engines(id) ON DELETE SET NULL,
  label           TEXT,                          -- e.g. "1.8L Petrol · Automatic · FWD"
  transmission    TEXT,
  drive_type      TEXT,
  fuel_type       TEXT,
  year_from       INTEGER,
  year_to         INTEGER,
  chassis_code    TEXT,
  is_active       BOOLEAN NOT NULL DEFAULT TRUE,
  external_source TEXT,
  external_ref    TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS vehicle_variants_generation_idx ON public.vehicle_variants (generation_id);
CREATE INDEX IF NOT EXISTS vehicle_variants_engine_idx     ON public.vehicle_variants (engine_id);

-- ── 7. Evolve product_compatibility (§4 — precise fitment, no duplicate table)
ALTER TABLE public.product_compatibility
  ADD COLUMN IF NOT EXISTS generation_id UUID REFERENCES public.vehicle_generations(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS variant_id    UUID REFERENCES public.vehicle_variants(id)    ON DELETE CASCADE;
CREATE INDEX IF NOT EXISTS product_compat_generation_idx ON public.product_compatibility (generation_id);
CREATE INDEX IF NOT EXISTS product_compat_variant_idx    ON public.product_compatibility (variant_id);

-- ════════════════════════════════════════════════════════════════════════════
-- RLS (mirrors the existing vehicle_makes / vehicle_models pattern)
-- ════════════════════════════════════════════════════════════════════════════
-- engines: own + system-shared visible; writable by owner.
ALTER TABLE public.vehicle_engines ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS vehicle_engines_read  ON public.vehicle_engines;
DROP POLICY IF EXISTS vehicle_engines_write ON public.vehicle_engines;
CREATE POLICY vehicle_engines_read ON public.vehicle_engines FOR SELECT
  USING (company_id IS NULL OR company_id = public.current_user_company_id());
CREATE POLICY vehicle_engines_write ON public.vehicle_engines FOR ALL
  USING (company_id = public.current_user_company_id())
  WITH CHECK (company_id = public.current_user_company_id());

-- generations: inherit the make's visibility (via model).
ALTER TABLE public.vehicle_generations ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS vehicle_generations_read  ON public.vehicle_generations;
DROP POLICY IF EXISTS vehicle_generations_write ON public.vehicle_generations;
CREATE POLICY vehicle_generations_read ON public.vehicle_generations FOR SELECT
  USING (EXISTS (
    SELECT 1 FROM public.vehicle_models md JOIN public.vehicle_makes mk ON mk.id = md.make_id
    WHERE md.id = vehicle_generations.model_id
      AND (mk.company_id IS NULL OR mk.company_id = public.current_user_company_id())));
CREATE POLICY vehicle_generations_write ON public.vehicle_generations FOR ALL
  USING (EXISTS (
    SELECT 1 FROM public.vehicle_models md JOIN public.vehicle_makes mk ON mk.id = md.make_id
    WHERE md.id = vehicle_generations.model_id AND mk.company_id = public.current_user_company_id()))
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.vehicle_models md JOIN public.vehicle_makes mk ON mk.id = md.make_id
    WHERE md.id = vehicle_generations.model_id AND mk.company_id = public.current_user_company_id()));

-- variants: inherit visibility (via generation → model → make).
ALTER TABLE public.vehicle_variants ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS vehicle_variants_read  ON public.vehicle_variants;
DROP POLICY IF EXISTS vehicle_variants_write ON public.vehicle_variants;
CREATE POLICY vehicle_variants_read ON public.vehicle_variants FOR SELECT
  USING (EXISTS (
    SELECT 1 FROM public.vehicle_generations g
      JOIN public.vehicle_models md ON md.id = g.model_id
      JOIN public.vehicle_makes  mk ON mk.id = md.make_id
    WHERE g.id = vehicle_variants.generation_id
      AND (mk.company_id IS NULL OR mk.company_id = public.current_user_company_id())));
CREATE POLICY vehicle_variants_write ON public.vehicle_variants FOR ALL
  USING (EXISTS (
    SELECT 1 FROM public.vehicle_generations g
      JOIN public.vehicle_models md ON md.id = g.model_id
      JOIN public.vehicle_makes  mk ON mk.id = md.make_id
    WHERE g.id = vehicle_variants.generation_id AND mk.company_id = public.current_user_company_id()))
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.vehicle_generations g
      JOIN public.vehicle_models md ON md.id = g.model_id
      JOIN public.vehicle_makes  mk ON mk.id = md.make_id
    WHERE g.id = vehicle_variants.generation_id AND mk.company_id = public.current_user_company_id()));

-- updated_at triggers (set_updated_at exists from Phase 0).
DROP TRIGGER IF EXISTS vehicle_engines_set_updated_at     ON public.vehicle_engines;
DROP TRIGGER IF EXISTS vehicle_generations_set_updated_at ON public.vehicle_generations;
DROP TRIGGER IF EXISTS vehicle_variants_set_updated_at    ON public.vehicle_variants;
CREATE TRIGGER vehicle_engines_set_updated_at     BEFORE UPDATE ON public.vehicle_engines     FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER vehicle_generations_set_updated_at BEFORE UPDATE ON public.vehicle_generations FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER vehicle_variants_set_updated_at    BEFORE UPDATE ON public.vehicle_variants    FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ════════════════════════════════════════════════════════════════════════════
-- Backfill: keep legacy data in the new hierarchy (idempotent)
-- ════════════════════════════════════════════════════════════════════════════
-- One "Default" generation per model that has none, carrying the model's chassis_code.
INSERT INTO public.vehicle_generations (model_id, name, code)
SELECT m.id, 'Default', m.chassis_code
FROM public.vehicle_models m
WHERE NOT EXISTS (SELECT 1 FROM public.vehicle_generations g WHERE g.model_id = m.id);

-- One default variant per generation that has none (carries the model's chassis_code).
INSERT INTO public.vehicle_variants (generation_id, chassis_code, label)
SELECT g.id, m.chassis_code, 'Default'
FROM public.vehicle_generations g
JOIN public.vehicle_models m ON m.id = g.model_id
WHERE NOT EXISTS (SELECT 1 FROM public.vehicle_variants v WHERE v.generation_id = g.id);

-- ════════════════════════════════════════════════════════════════════════════
-- Seed shared GCC/India make catalog (company_id NULL — visible to all tenants)
-- ════════════════════════════════════════════════════════════════════════════
INSERT INTO public.vehicle_makes (company_id, name, country)
SELECT NULL, s.name, s.country
FROM (VALUES
  ('Toyota','Japan'), ('Honda','Japan'), ('Nissan','Japan'), ('Mitsubishi','Japan'),
  ('Mazda','Japan'), ('Suzuki','Japan'), ('Lexus','Japan'), ('Isuzu','Japan'), ('Subaru','Japan'),
  ('Hyundai','South Korea'), ('Kia','South Korea'), ('Genesis','South Korea'),
  ('Ford','USA'), ('Chevrolet','USA'), ('GMC','USA'), ('Jeep','USA'), ('Dodge','USA'),
  ('Mercedes-Benz','Germany'), ('BMW','Germany'), ('Volkswagen','Germany'), ('Audi','Germany'), ('Porsche','Germany'),
  ('Renault','France'), ('Peugeot','France'), ('Citroen','France'),
  ('Land Rover','UK'), ('Jaguar','UK'),
  ('Tata','India'), ('Mahindra','India'), ('Maruti Suzuki','India'),
  ('MG','China'), ('Chery','China'), ('Geely','China'), ('Changan','China')
) AS s(name, country)
WHERE NOT EXISTS (
  SELECT 1 FROM public.vehicle_makes vm
  WHERE vm.company_id IS NULL AND lower(vm.name) = lower(s.name)
);

NOTIFY pgrst, 'reload schema';
