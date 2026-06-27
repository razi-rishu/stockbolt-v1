-- ════════════════════════════════════════════════════════════════════════════
-- Phase 32 / Automotive Catalog C6 — merge_brands RPC
-- ────────────────────────────────────────────────────────────────────────────
-- Re-points every product on the duplicate brand onto the brand we keep, then
-- deletes the duplicate. SECURITY DEFINER (bypasses RLS) so it is gated by hand:
--   • both brands must belong to the caller's company,
--   • caller must hold inventory.write (the same perm that gates brand edits),
--   • cannot merge a brand into itself.
-- Additive + idempotent (CREATE OR REPLACE). No existing data touched until called.
-- Audited best-effort into audit_logs. Run by hand in the Supabase SQL Editor.
-- ════════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.merge_brands(p_keep_id uuid, p_dup_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_co    uuid := public.current_user_company_id();
  v_keep  public.brands;
  v_dup   public.brands;
  v_moved integer;
BEGIN
  IF v_co IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;
  IF p_keep_id = p_dup_id THEN
    RAISE EXCEPTION 'Cannot merge a brand into itself';
  END IF;
  IF NOT public.has_perm('inventory.write') THEN
    RAISE EXCEPTION 'Permission denied: inventory.write required';
  END IF;

  SELECT * INTO v_keep FROM public.brands WHERE id = p_keep_id;
  SELECT * INTO v_dup  FROM public.brands WHERE id = p_dup_id;
  IF v_keep.id IS NULL OR v_dup.id IS NULL THEN
    RAISE EXCEPTION 'Brand not found';
  END IF;
  IF v_keep.company_id <> v_co OR v_dup.company_id <> v_co THEN
    RAISE EXCEPTION 'Brand belongs to another company';
  END IF;

  UPDATE public.products
     SET brand_id = p_keep_id, updated_at = NOW()
   WHERE brand_id = p_dup_id AND company_id = v_co;
  GET DIAGNOSTICS v_moved = ROW_COUNT;

  DELETE FROM public.brands WHERE id = p_dup_id AND company_id = v_co;

  BEGIN
    INSERT INTO public.audit_logs (company_id, user_id, action, entity_type, entity_id, new_data)
    VALUES (v_co, auth.uid(), 'merge', 'brand', p_keep_id,
      jsonb_build_object('kept', v_keep.name, 'merged', v_dup.name,
                         'dup_id', p_dup_id, 'products_moved', v_moved));
  EXCEPTION WHEN OTHERS THEN NULL;
  END;

  RETURN jsonb_build_object('kept_id', p_keep_id, 'merged_id', p_dup_id, 'products_moved', v_moved);
END;
$$;

GRANT EXECUTE ON FUNCTION public.merge_brands(uuid, uuid) TO authenticated;

NOTIFY pgrst, 'reload schema';
