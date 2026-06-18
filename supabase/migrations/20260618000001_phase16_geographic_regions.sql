-- ─────────────────────────────────────────────────────────────────────────
-- StockBolt v1 — Phase 16 — Geographic classification (regions)
-- ─────────────────────────────────────────────────────────────────────────
-- Structured region (emirate / state / province / governorate) on contacts so
-- the business can analyse sales geographically. Mirrors the vehicle_makes
-- system-data model: company_id IS NULL = seeded system row visible to every
-- tenant; tenant-created rows carry company_id + is_system=false.
--
-- Areas (localities within a region) are created as a table now for future use
-- but are NOT seeded and have no UI yet.
--
-- Backward compatible: new contact columns are nullable; existing rows keep
-- working with region NULL. No accounting/posting changes.
-- ─────────────────────────────────────────────────────────────────────────

-- ── Tables ────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.geographic_regions (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id   uuid REFERENCES public.companies(id) ON DELETE CASCADE,  -- NULL = system
  country_code text NOT NULL,
  region_name  text NOT NULL,
  region_type  text NOT NULL DEFAULT 'region',
  is_system    boolean NOT NULL DEFAULT false,
  is_active    boolean NOT NULL DEFAULT true,
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS geographic_regions_lookup_idx
  ON public.geographic_regions (country_code, company_id);

CREATE TABLE IF NOT EXISTS public.geographic_areas (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id  uuid REFERENCES public.companies(id) ON DELETE CASCADE,   -- NULL = system
  region_id   uuid NOT NULL REFERENCES public.geographic_regions(id) ON DELETE CASCADE,
  area_name   text NOT NULL,
  is_system   boolean NOT NULL DEFAULT false,
  is_active   boolean NOT NULL DEFAULT true,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS geographic_areas_region_idx
  ON public.geographic_areas (region_id, company_id);

-- ── RLS — system rows readable by all; writes scoped to the owning tenant ──
ALTER TABLE public.geographic_regions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS geographic_regions_read   ON public.geographic_regions;
DROP POLICY IF EXISTS geographic_regions_insert ON public.geographic_regions;
DROP POLICY IF EXISTS geographic_regions_update ON public.geographic_regions;
DROP POLICY IF EXISTS geographic_regions_delete ON public.geographic_regions;
CREATE POLICY geographic_regions_read   ON public.geographic_regions FOR SELECT
  USING (company_id IS NULL OR company_id = public.current_user_company_id());
CREATE POLICY geographic_regions_insert ON public.geographic_regions FOR INSERT
  WITH CHECK (company_id = public.current_user_company_id());
CREATE POLICY geographic_regions_update ON public.geographic_regions FOR UPDATE
  USING (company_id = public.current_user_company_id())
  WITH CHECK (company_id = public.current_user_company_id());
CREATE POLICY geographic_regions_delete ON public.geographic_regions FOR DELETE
  USING (company_id = public.current_user_company_id());

ALTER TABLE public.geographic_areas ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS geographic_areas_read   ON public.geographic_areas;
DROP POLICY IF EXISTS geographic_areas_insert ON public.geographic_areas;
DROP POLICY IF EXISTS geographic_areas_update ON public.geographic_areas;
DROP POLICY IF EXISTS geographic_areas_delete ON public.geographic_areas;
CREATE POLICY geographic_areas_read   ON public.geographic_areas FOR SELECT
  USING (company_id IS NULL OR company_id = public.current_user_company_id());
CREATE POLICY geographic_areas_insert ON public.geographic_areas FOR INSERT
  WITH CHECK (company_id = public.current_user_company_id());
CREATE POLICY geographic_areas_update ON public.geographic_areas FOR UPDATE
  USING (company_id = public.current_user_company_id())
  WITH CHECK (company_id = public.current_user_company_id());
CREATE POLICY geographic_areas_delete ON public.geographic_areas FOR DELETE
  USING (company_id = public.current_user_company_id());

-- ── Contact columns (nullable → existing rows unaffected) ─────────────────
ALTER TABLE public.contacts
  ADD COLUMN IF NOT EXISTS country_code text,
  ADD COLUMN IF NOT EXISTS region_id uuid REFERENCES public.geographic_regions(id),
  ADD COLUMN IF NOT EXISTS area_id   uuid REFERENCES public.geographic_areas(id);

-- Backfill country_code only where the existing free-text country already looks
-- like a 2-letter ISO code. Otherwise leave NULL (region stays NULL until set).
UPDATE public.contacts
   SET country_code = upper(address_country)
 WHERE country_code IS NULL
   AND address_country IS NOT NULL
   AND length(address_country) = 2;

-- ── Seed system regions for GCC + India ───────────────────────────────────
INSERT INTO public.geographic_regions (company_id, country_code, region_name, region_type, is_system)
SELECT NULL, v.cc, v.name, v.rtype, true
FROM (VALUES
  -- UAE — emirates
  ('AE','Abu Dhabi','emirate'),('AE','Dubai','emirate'),('AE','Sharjah','emirate'),
  ('AE','Ajman','emirate'),('AE','Umm Al Quwain','emirate'),('AE','Ras Al Khaimah','emirate'),
  ('AE','Fujairah','emirate'),
  -- India — states
  ('IN','Andhra Pradesh','state'),('IN','Arunachal Pradesh','state'),('IN','Assam','state'),
  ('IN','Bihar','state'),('IN','Chhattisgarh','state'),('IN','Goa','state'),('IN','Gujarat','state'),
  ('IN','Haryana','state'),('IN','Himachal Pradesh','state'),('IN','Jharkhand','state'),
  ('IN','Karnataka','state'),('IN','Kerala','state'),('IN','Madhya Pradesh','state'),
  ('IN','Maharashtra','state'),('IN','Manipur','state'),('IN','Meghalaya','state'),
  ('IN','Mizoram','state'),('IN','Nagaland','state'),('IN','Odisha','state'),('IN','Punjab','state'),
  ('IN','Rajasthan','state'),('IN','Sikkim','state'),('IN','Tamil Nadu','state'),
  ('IN','Telangana','state'),('IN','Tripura','state'),('IN','Uttar Pradesh','state'),
  ('IN','Uttarakhand','state'),('IN','West Bengal','state'),
  -- India — union territories
  ('IN','Andaman and Nicobar Islands','union_territory'),('IN','Chandigarh','union_territory'),
  ('IN','Dadra and Nagar Haveli and Daman and Diu','union_territory'),('IN','Delhi','union_territory'),
  ('IN','Jammu and Kashmir','union_territory'),('IN','Ladakh','union_territory'),
  ('IN','Lakshadweep','union_territory'),('IN','Puducherry','union_territory'),
  -- Saudi Arabia — provinces
  ('SA','Riyadh','province'),('SA','Makkah','province'),('SA','Madinah','province'),
  ('SA','Eastern Province','province'),('SA','Asir','province'),('SA','Tabuk','province'),
  ('SA','Hail','province'),('SA','Northern Borders','province'),('SA','Jazan','province'),
  ('SA','Najran','province'),('SA','Al Bahah','province'),('SA','Al Jawf','province'),
  ('SA','Qassim','province'),
  -- Qatar — municipalities
  ('QA','Doha','municipality'),('QA','Al Rayyan','municipality'),('QA','Al Wakrah','municipality'),
  ('QA','Al Khor','municipality'),('QA','Al Shamal','municipality'),('QA','Al Daayen','municipality'),
  ('QA','Umm Salal','municipality'),('QA','Al Sheehaniya','municipality'),
  -- Oman — governorates
  ('OM','Muscat','governorate'),('OM','Dhofar','governorate'),('OM','Musandam','governorate'),
  ('OM','Al Buraimi','governorate'),('OM','Ad Dakhiliyah','governorate'),
  ('OM','Al Batinah North','governorate'),('OM','Al Batinah South','governorate'),
  ('OM','Ash Sharqiyah North','governorate'),('OM','Ash Sharqiyah South','governorate'),
  ('OM','Ad Dhahirah','governorate'),('OM','Al Wusta','governorate'),
  -- Bahrain — governorates
  ('BH','Capital','governorate'),('BH','Muharraq','governorate'),('BH','Northern','governorate'),
  ('BH','Southern','governorate'),
  -- Kuwait — governorates
  ('KW','Al Asimah','governorate'),('KW','Hawalli','governorate'),('KW','Al Farwaniyah','governorate'),
  ('KW','Mubarak Al-Kabeer','governorate'),('KW','Ahmadi','governorate'),('KW','Al Jahra','governorate')
) AS v(cc, name, rtype)
WHERE NOT EXISTS (
  SELECT 1 FROM public.geographic_regions g
  WHERE g.company_id IS NULL AND g.country_code = v.cc AND g.region_name = v.name
);
