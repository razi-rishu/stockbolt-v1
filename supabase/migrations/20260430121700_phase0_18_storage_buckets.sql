-- ─────────────────────────────────────────────────────────────────────────
-- StockBolt v1 — Phase 0 — Migration 18: Storage buckets + storage RLS
-- ─────────────────────────────────────────────────────────────────────────
-- Per Doc 5 Phase 0 Task 2: "Storage buckets for logos, product images,
-- attachments."
-- Per AGENTS.md §7.8: path convention {bucket}/{company_id}/{entity_type}
-- /{entity_id}/{filename}.
-- Per AGENTS.md §12: storage RLS rejects access to other companies' paths.
--
-- The first folder segment in the object name is the company_id. We use
-- storage.foldername(name)[1] to extract it and gate access.
-- ─────────────────────────────────────────────────────────────────────────

-- ── Buckets ──────────────────────────────────────────────────────────────
INSERT INTO storage.buckets (id, name, public)
VALUES
  ('logos',       'logos',       TRUE),    -- Public read for company logos on invoices
  ('products',    'products',    TRUE),    -- Public read so product images render
  ('attachments', 'attachments', FALSE)    -- Private — receipts, scanned docs
ON CONFLICT (id) DO NOTHING;

-- ── Storage RLS policies ─────────────────────────────────────────────────
-- Drop any default Supabase policies that might conflict, then add ours.

-- LOGOS bucket
CREATE POLICY "logos_select_own_company"
  ON storage.objects FOR SELECT
  USING (
    bucket_id = 'logos'
    AND (storage.foldername(name))[1] = public.current_user_company_id()::text
  );

CREATE POLICY "logos_insert_own_company"
  ON storage.objects FOR INSERT
  WITH CHECK (
    bucket_id = 'logos'
    AND (storage.foldername(name))[1] = public.current_user_company_id()::text
  );

CREATE POLICY "logos_update_own_company"
  ON storage.objects FOR UPDATE
  USING (
    bucket_id = 'logos'
    AND (storage.foldername(name))[1] = public.current_user_company_id()::text
  );

CREATE POLICY "logos_delete_own_company"
  ON storage.objects FOR DELETE
  USING (
    bucket_id = 'logos'
    AND (storage.foldername(name))[1] = public.current_user_company_id()::text
  );

-- PRODUCTS bucket
CREATE POLICY "products_select_own_company"
  ON storage.objects FOR SELECT
  USING (
    bucket_id = 'products'
    AND (storage.foldername(name))[1] = public.current_user_company_id()::text
  );

CREATE POLICY "products_insert_own_company"
  ON storage.objects FOR INSERT
  WITH CHECK (
    bucket_id = 'products'
    AND (storage.foldername(name))[1] = public.current_user_company_id()::text
  );

CREATE POLICY "products_update_own_company"
  ON storage.objects FOR UPDATE
  USING (
    bucket_id = 'products'
    AND (storage.foldername(name))[1] = public.current_user_company_id()::text
  );

CREATE POLICY "products_delete_own_company"
  ON storage.objects FOR DELETE
  USING (
    bucket_id = 'products'
    AND (storage.foldername(name))[1] = public.current_user_company_id()::text
  );

-- ATTACHMENTS bucket (private)
CREATE POLICY "attachments_select_own_company"
  ON storage.objects FOR SELECT
  USING (
    bucket_id = 'attachments'
    AND (storage.foldername(name))[1] = public.current_user_company_id()::text
  );

CREATE POLICY "attachments_insert_own_company"
  ON storage.objects FOR INSERT
  WITH CHECK (
    bucket_id = 'attachments'
    AND (storage.foldername(name))[1] = public.current_user_company_id()::text
  );

CREATE POLICY "attachments_update_own_company"
  ON storage.objects FOR UPDATE
  USING (
    bucket_id = 'attachments'
    AND (storage.foldername(name))[1] = public.current_user_company_id()::text
  );

CREATE POLICY "attachments_delete_own_company"
  ON storage.objects FOR DELETE
  USING (
    bucket_id = 'attachments'
    AND (storage.foldername(name))[1] = public.current_user_company_id()::text
  );
