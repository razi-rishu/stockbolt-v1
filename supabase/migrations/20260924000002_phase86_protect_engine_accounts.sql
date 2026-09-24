-- ============================================================================
-- Phase 86 — Protect the accounts the engines resolve by code
--
-- THE DEFECT
-- Phase 60 seeded 4250 Gain on Asset Disposal, 6750 Depreciation Expense and
-- 6910 Loss on Asset Disposal WITHOUT is_system, leaving all three freely
-- editable. Every other engine-resolved account (1200, 1300, 2100, 2200,
-- 2400, 4100, 5100, 5900, 6700, 1500, 1400) was seeded protected.
--
-- Two tenants have already repurposed 6910:
--
--     Pro_Parts   6910 = "IT EXPENSES"       (14 GL legs posted via Expenses)
--     IMBD123     6910 = "PETROL EXOENSES"
--
-- That is legitimate: the account was not marked system, and the Expense
-- module lets a user post to any account they like. But dispose_fixed_asset
-- resolves 6910 BY CODE, so a disposal loss at either company would land
-- inside an unrelated expense line — silently, and plausibly enough that
-- nobody would query it.
--
-- WHAT THIS DOES
--   1. Marks 4250 / 6750 / 6910 as is_system ONLY where the account still
--      carries its seeded name. A repurposed account is left alone — stamping
--      it would lock in the wrong mapping and make it harder to unpick.
--
--   2. Makes dispose_fixed_asset REFUSE to post when the disposal account for
--      that company is not a recognised system account, with a message saying
--      what to do about it.
--
-- WHY REFUSING IS RIGHT
-- The alternatives are worse. Posting anyway buries a disposal loss in IT
-- Expenses. Silently redirecting to some other account invents a mapping
-- nobody chose. Renaming the tenant's own account rewrites their chart of
-- accounts without asking. Refusing hands the decision back to the owner,
-- who is the only one who knows whether to move their account or restore the
-- standard one.
--
-- is_system does NOT lock the account NAME — the COA editor still allows
-- renaming a system account, and that is fine, because every engine resolves
-- by CODE. What it does lock is the code itself, the account type, and
-- deactivation (coa.deactivate refuses a system account outright). Those are
-- the three changes that would actually break posting.
--
-- LIVE EFFECT
-- No number moves. No company currently owns a fixed asset, so nothing can be
-- disposed of today; this closes the path before it is first used.
--
-- Reconstructed from the LIVE pg_get_functiondef. Additive and idempotent.
-- ============================================================================

-- 1. Protect the three, but only where they are still what phase 60 seeded.
UPDATE public.chart_of_accounts SET is_system = true
 WHERE NOT is_system
   AND (   (code = '4250' AND name = 'Gain on Asset Disposal')
        OR (code = '6750' AND name = 'Depreciation Expense')
        OR (code = '6910' AND name = 'Loss on Asset Disposal'));


CREATE OR REPLACE FUNCTION public.dispose_fixed_asset(p_asset_id uuid, p_disposal_date date, p_proceeds numeric, p_proceeds_account_code text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_user    uuid := auth.uid();
  v_company uuid := public.current_user_company_id();
  v_asset   public.fixed_assets%ROWTYPE;
  v_proceeds numeric := COALESCE(p_proceeds, 0);
  v_book    numeric;
  v_gl      numeric;
  v_disp_code TEXT;      -- phase86
  v_disp_name TEXT;      -- phase86
  v_lines   jsonb := '[]'::jsonb;
  v_je      jsonb;
BEGIN
  IF v_user IS NULL OR v_company IS NULL THEN
    RAISE EXCEPTION 'Not signed in to a company.' USING ERRCODE = '42501';
  END IF;
  PERFORM public.auth_require('accounting.write');

  SELECT * INTO v_asset FROM public.fixed_assets WHERE id = p_asset_id AND company_id = v_company FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Asset not found.' USING ERRCODE = 'P0001'; END IF;
  IF v_asset.status = 'disposed' THEN RAISE EXCEPTION 'Asset is already disposed.' USING ERRCODE = 'P0001'; END IF;
  IF v_proceeds > 0 AND (p_proceeds_account_code IS NULL OR p_proceeds_account_code = '') THEN
    RAISE EXCEPTION 'A proceeds account is required when proceeds > 0.' USING ERRCODE = 'P0001';
  END IF;

  v_book := round(v_asset.cost - v_asset.accumulated_depreciation, 2);
  v_gl   := round(v_proceeds - v_book, 2);   -- >0 gain, <0 loss

  IF v_asset.accumulated_depreciation > 0 THEN
    v_lines := v_lines || jsonb_build_object('account_code', v_asset.accum_dep_account_code, 'debit', v_asset.accumulated_depreciation, 'credit', 0);
  END IF;
  IF v_proceeds > 0 THEN
    v_lines := v_lines || jsonb_build_object('account_code', p_proceeds_account_code, 'debit', v_proceeds, 'credit', 0);
  END IF;
  v_lines := v_lines || jsonb_build_object('account_code', v_asset.asset_account_code, 'debit', 0, 'credit', v_asset.cost);
  -- phase86: 4250 and 6910 are resolved BY CODE, and two tenants have already
  -- repurposed 6910 for their own expenses ("IT EXPENSES", "PETROL EXOENSES")
  -- because phase 60 seeded these three accounts without is_system, leaving
  -- them editable. Posting a disposal there would bury the loss inside an
  -- unrelated expense line, silently and plausibly.
  --
  -- Refusing is the right answer: the owner has to decide whether to move
  -- their account or restore the standard one. Guessing on their behalf would
  -- either post to the wrong account or rewrite their chart without asking.
  IF v_gl <> 0 THEN
    v_disp_code := CASE WHEN v_gl > 0 THEN '4250' ELSE '6910' END;
    SELECT name INTO v_disp_name FROM public.chart_of_accounts
     WHERE company_id = v_company AND code = v_disp_code AND is_system AND is_active;
    IF v_disp_name IS NULL THEN
      RAISE EXCEPTION 'dispose_fixed_asset: account % is not a recognised disposal account for this company. It has been renamed or replaced, so a disposal % would post into the wrong account. Restore % as a system account, or move your own account to a different code, then retry.',
        v_disp_code,
        CASE WHEN v_gl > 0 THEN 'gain' ELSE 'loss' END,
        v_disp_code
        USING ERRCODE = 'P0001';
    END IF;
  END IF;

  IF v_gl > 0 THEN
    v_lines := v_lines || jsonb_build_object('account_code', '4250', 'debit', 0, 'credit', v_gl);
  ELSIF v_gl < 0 THEN
    v_lines := v_lines || jsonb_build_object('account_code', '6910', 'debit', -v_gl, 'credit', 0);
  END IF;

  v_je := public.post_journal_entry(jsonb_build_object(
    'date', p_disposal_date::text,
    'description', 'Disposal — ' || v_asset.name,
    'source_type', 'asset_disposal',
    'source_id', v_asset.id::text,
    'lines', v_lines
  ));

  UPDATE public.fixed_assets
     SET status = 'disposed', disposal_date = p_disposal_date, disposal_proceeds = v_proceeds,
         disposal_gain_loss = v_gl, disposal_je_id = (v_je->>'journal_entry_id')::uuid, updated_at = now()
   WHERE id = v_asset.id;

  BEGIN
    INSERT INTO public.audit_logs (company_id, user_id, action, entity_type, entity_id, new_data)
    VALUES (v_company, v_user, 'dispose_fixed_asset', 'fixed_asset', v_asset.id,
      jsonb_build_object('disposal_date', p_disposal_date, 'proceeds', v_proceeds, 'gain_loss', v_gl));
  EXCEPTION WHEN OTHERS THEN NULL;
  END;

  RETURN jsonb_build_object('journal_entry_id', v_je->>'journal_entry_id', 'gain_loss', v_gl, 'status', 'disposed');
END;
$function$;


NOTIFY pgrst, 'reload schema';
