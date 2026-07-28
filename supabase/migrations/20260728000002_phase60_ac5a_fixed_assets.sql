-- ============================================================================
-- Phase 60 — AC-5A: Fixed assets + depreciation engine
--   CoA seed/backfill · fixed_assets · depreciation_entries
--   + run_depreciation() / dispose_fixed_asset() / reverse_last_depreciation()
-- ============================================================================
-- Approved design (AC-5 spec, 2026-07-28):
--   • Asset register + monthly depreciation that POSTS real JEs through the
--     existing post_journal_entry() primitive (Dr Depreciation Expense /
--     Cr Accumulated Depreciation). Disposal posts cost-removal + gain/loss.
--   • Methods: straight_line + reducing_balance (WDV). Monthly, pro-rata by days
--     in the acquisition month. Never depreciates below salvage.
--   • Posting reuses post_journal_entry — which enforces balance, period lock,
--     JE numbering and audit — so NO new GL-writing path is introduced. The
--     depreciation math mirrors src/lib/depreciation.ts (kept in lock-step).
--   • depreciation_entries is the immutable audit/idempotency ledger (unique per
--     asset+period); Σ non-reversed charge == fixed_assets.accumulated_depreciation.
--
-- Relies on (VERIFIED live): current_user_company_id(); auth_require(text);
-- has_perm(text); post_journal_entry(jsonb) -> {journal_entry_id, entry_number};
-- companies.period_lock_date; chart_of_accounts(company_id, code, name, name_ar,
-- type, sub_type, is_active).
--
-- Additive + idempotent. Apply BY HAND in the Supabase SQL editor.
-- ROLLBACK:
--   DROP FUNCTION IF EXISTS public.reverse_last_depreciation(uuid);
--   DROP FUNCTION IF EXISTS public.dispose_fixed_asset(uuid,date,numeric,text);
--   DROP FUNCTION IF EXISTS public.run_depreciation(date);
--   DROP FUNCTION IF EXISTS public._fixed_asset_monthly_charge(numeric,numeric,int,text,numeric,date,numeric,date);
--   DROP TABLE    IF EXISTS public.depreciation_entries;
--   DROP TABLE    IF EXISTS public.fixed_assets;
--   -- (leave the seeded CoA accounts; harmless if unused)
-- ============================================================================

-- 1. CoA seed + backfill for every existing company -------------------------
--    Fixed-asset categories + accumulated depreciation (contra) = asset/fixed;
--    depreciation expense + loss = expense/indirect; gain = income/indirect.
INSERT INTO public.chart_of_accounts (company_id, code, name, name_ar, type, sub_type, is_active)
SELECT c.id, v.code, v.name, v.name_ar, v.type, v.sub_type, true
FROM public.companies c
CROSS JOIN (VALUES
  ('1710','Furniture & Fixtures',       'الأثاث والتجهيزات',        'asset',   'fixed'),
  ('1720','Office Equipment',           'معدات المكتب',             'asset',   'fixed'),
  ('1730','Motor Vehicles',             'المركبات',                 'asset',   'fixed'),
  ('1740','Computer Equipment',         'أجهزة الكمبيوتر',          'asset',   'fixed'),
  ('1750','Plant & Machinery',          'الآلات والمعدات',          'asset',   'fixed'),
  ('1790','Accumulated Depreciation',   'مجمع الإهلاك',             'asset',   'fixed'),
  ('4250','Gain on Asset Disposal',     'أرباح بيع الأصول',         'income',  'indirect'),
  ('6750','Depreciation Expense',       'مصروف الإهلاك',            'expense', 'indirect'),
  ('6910','Loss on Asset Disposal',     'خسائر بيع الأصول',         'expense', 'indirect')
) AS v(code, name, name_ar, type, sub_type)
WHERE NOT EXISTS (
  SELECT 1 FROM public.chart_of_accounts x WHERE x.company_id = c.id AND x.code = v.code
);

-- 2. Asset register ----------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.fixed_assets (
  id                      uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id              uuid          NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  asset_tag               text,
  name                    text          NOT NULL,
  category                text,
  acquisition_date        date          NOT NULL,
  in_service_date         date          NOT NULL,
  cost                    numeric(15,2) NOT NULL CHECK (cost >= 0),
  salvage_value           numeric(15,2) NOT NULL DEFAULT 0 CHECK (salvage_value >= 0),
  useful_life_months      integer       NOT NULL DEFAULT 60 CHECK (useful_life_months > 0),
  method                  text          NOT NULL DEFAULT 'straight_line'
                            CHECK (method IN ('straight_line','reducing_balance')),
  wdv_rate                numeric(6,3)  NOT NULL DEFAULT 0 CHECK (wdv_rate >= 0 AND wdv_rate <= 100),
  asset_account_code      text          NOT NULL,
  accum_dep_account_code  text          NOT NULL DEFAULT '1790',
  expense_account_code    text          NOT NULL DEFAULT '6750',
  accumulated_depreciation numeric(15,2) NOT NULL DEFAULT 0,
  last_depreciated_period date,
  status                  text          NOT NULL DEFAULT 'active'
                            CHECK (status IN ('active','disposed','fully_depreciated')),
  disposal_date           date,
  disposal_proceeds       numeric(15,2),
  disposal_gain_loss      numeric(15,2),
  disposal_je_id          uuid,
  notes                   text,
  created_at              timestamptz   NOT NULL DEFAULT now(),  created_by uuid,
  updated_at              timestamptz   NOT NULL DEFAULT now(),
  CONSTRAINT fixed_assets_salvage_le_cost CHECK (salvage_value <= cost)
);
CREATE INDEX IF NOT EXISTS fixed_assets_company_status_idx ON public.fixed_assets (company_id, status);

-- 3. Depreciation ledger (audit + idempotency) -------------------------------
CREATE TABLE IF NOT EXISTS public.depreciation_entries (
  id                uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id        uuid          NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  asset_id          uuid          NOT NULL REFERENCES public.fixed_assets(id) ON DELETE CASCADE,
  period_end        date          NOT NULL,
  charge            numeric(15,2) NOT NULL,
  book_value_after  numeric(15,2) NOT NULL,
  journal_entry_id  uuid,
  reversed_at       timestamptz,   reversed_je_id uuid,
  created_at        timestamptz   NOT NULL DEFAULT now(),  created_by uuid
);
CREATE UNIQUE INDEX IF NOT EXISTS depreciation_entries_asset_period_key
  ON public.depreciation_entries (asset_id, period_end);

-- 4. RLS ---------------------------------------------------------------------
--    fixed_assets: register CRUD by accounting.write (master data).
--    depreciation_entries: read only; all writes via the SECURITY DEFINER RPCs.
ALTER TABLE public.fixed_assets ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS fixed_assets_read  ON public.fixed_assets;
DROP POLICY IF EXISTS fixed_assets_write ON public.fixed_assets;
CREATE POLICY fixed_assets_read ON public.fixed_assets
  FOR SELECT USING (company_id = public.current_user_company_id());
CREATE POLICY fixed_assets_write ON public.fixed_assets
  FOR ALL USING (company_id = public.current_user_company_id() AND public.has_perm('accounting.write'))
          WITH CHECK (company_id = public.current_user_company_id() AND public.has_perm('accounting.write'));
REVOKE ALL ON public.fixed_assets FROM anon;
GRANT  SELECT, INSERT, UPDATE, DELETE ON public.fixed_assets TO authenticated;

ALTER TABLE public.depreciation_entries ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS depreciation_entries_read ON public.depreciation_entries;
CREATE POLICY depreciation_entries_read ON public.depreciation_entries
  FOR SELECT USING (company_id = public.current_user_company_id());
REVOKE ALL ON public.depreciation_entries FROM anon, authenticated;
GRANT  SELECT ON public.depreciation_entries TO authenticated;

-- 5. Charge helper (mirrors src/lib/depreciation.ts) -------------------------
CREATE OR REPLACE FUNCTION public._fixed_asset_monthly_charge(
  p_cost numeric, p_salvage numeric, p_life_months int, p_method text,
  p_wdv_rate numeric, p_in_service date, p_accumulated numeric, p_period_end date
)
RETURNS numeric
LANGUAGE plpgsql IMMUTABLE
SET search_path = public
AS $$
DECLARE
  v_base      numeric := p_cost - p_salvage;
  v_remaining numeric := round(v_base - p_accumulated, 2);
  v_mstart    date    := date_trunc('month', p_period_end)::date;
  v_dim       int     := extract(day FROM (date_trunc('month', p_period_end) + interval '1 month - 1 day'))::int;
  v_eff_start date;
  v_prorata   numeric;
  v_charge    numeric;
BEGIN
  IF p_in_service > p_period_end THEN RETURN 0; END IF;
  IF v_remaining <= 0 THEN RETURN 0; END IF;
  v_eff_start := GREATEST(p_in_service, v_mstart);
  v_prorata   := ((p_period_end - v_eff_start) + 1)::numeric / v_dim;
  IF p_method = 'straight_line' THEN
    v_charge := (v_base / NULLIF(p_life_months, 0)) * v_prorata;
  ELSE
    v_charge := (p_cost - p_accumulated) * (p_wdv_rate / 100 / 12) * v_prorata;
  END IF;
  RETURN round(LEAST(v_charge, v_remaining), 2);
END;
$$;

-- 6. run_depreciation(p_period_end) ------------------------------------------
--    Catches every active asset up to p_period_end, one JE per (asset, month)
--    via post_journal_entry. Idempotent per (asset, period). Period lock is
--    enforced inside post_journal_entry. Posts NO JE directly.
CREATE OR REPLACE FUNCTION public.run_depreciation(p_period_end date)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user    uuid := auth.uid();
  v_company uuid := public.current_user_company_id();
  v_asset   public.fixed_assets%ROWTYPE;
  v_month   date;
  v_period  date;
  v_charge  numeric;
  v_je      jsonb;
  v_count   int := 0;
  v_total   numeric := 0;
BEGIN
  IF v_user IS NULL OR v_company IS NULL THEN
    RAISE EXCEPTION 'Not signed in to a company.' USING ERRCODE = '42501';
  END IF;
  PERFORM public.auth_require('accounting.write');

  FOR v_asset IN
    SELECT * FROM public.fixed_assets
     WHERE company_id = v_company AND status = 'active' AND in_service_date <= p_period_end
     ORDER BY acquisition_date
     FOR UPDATE
  LOOP
    v_month := CASE
      WHEN v_asset.last_depreciated_period IS NULL THEN date_trunc('month', v_asset.in_service_date)::date
      ELSE (date_trunc('month', v_asset.last_depreciated_period) + interval '1 month')::date
    END;

    WHILE (v_month + interval '1 month - 1 day')::date <= p_period_end LOOP
      v_period := (v_month + interval '1 month - 1 day')::date;

      IF NOT EXISTS (SELECT 1 FROM public.depreciation_entries WHERE asset_id = v_asset.id AND period_end = v_period) THEN
        v_charge := public._fixed_asset_monthly_charge(
          v_asset.cost, v_asset.salvage_value, v_asset.useful_life_months, v_asset.method,
          v_asset.wdv_rate, v_asset.in_service_date, v_asset.accumulated_depreciation, v_period);

        IF v_charge > 0 THEN
          v_je := public.post_journal_entry(jsonb_build_object(
            'date', v_period::text,
            'description', 'Depreciation — ' || v_asset.name || ' (' || to_char(v_period, 'Mon YYYY') || ')',
            'source_type', 'depreciation',
            'source_id', v_asset.id::text,
            'lines', jsonb_build_array(
              jsonb_build_object('account_code', v_asset.expense_account_code,   'debit', v_charge, 'credit', 0),
              jsonb_build_object('account_code', v_asset.accum_dep_account_code, 'debit', 0,        'credit', v_charge)
            )
          ));

          INSERT INTO public.depreciation_entries (company_id, asset_id, period_end, charge, book_value_after, journal_entry_id, created_by)
          VALUES (v_company, v_asset.id, v_period, v_charge,
                  round(v_asset.cost - (v_asset.accumulated_depreciation + v_charge), 2),
                  (v_je->>'journal_entry_id')::uuid, v_user);

          v_asset.accumulated_depreciation := v_asset.accumulated_depreciation + v_charge;
          UPDATE public.fixed_assets
             SET accumulated_depreciation = v_asset.accumulated_depreciation,
                 last_depreciated_period = v_period, updated_at = now()
           WHERE id = v_asset.id;

          v_count := v_count + 1;
          v_total := v_total + v_charge;
        ELSE
          -- fully depreciated to salvage: stop this asset
          UPDATE public.fixed_assets SET status = 'fully_depreciated', updated_at = now() WHERE id = v_asset.id;
          EXIT;
        END IF;
      END IF;

      v_month := (v_month + interval '1 month')::date;
    END LOOP;
  END LOOP;

  BEGIN
    INSERT INTO public.audit_logs (company_id, user_id, action, entity_type, entity_id, new_data)
    VALUES (v_company, v_user, 'run_depreciation', 'depreciation', NULL,
      jsonb_build_object('period_end', p_period_end, 'entries_posted', v_count, 'total_charge', v_total));
  EXCEPTION WHEN OTHERS THEN NULL;
  END;

  RETURN jsonb_build_object('entries_posted', v_count, 'total_charge', v_total, 'period_end', p_period_end);
END;
$$;

-- 7. dispose_fixed_asset(...) ------------------------------------------------
--    Removes cost + accumulated depreciation, books proceeds, recognises gain
--    (4250) or loss (6910). Run depreciation up to the disposal month first.
CREATE OR REPLACE FUNCTION public.dispose_fixed_asset(
  p_asset_id uuid, p_disposal_date date, p_proceeds numeric, p_proceeds_account_code text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user    uuid := auth.uid();
  v_company uuid := public.current_user_company_id();
  v_asset   public.fixed_assets%ROWTYPE;
  v_proceeds numeric := COALESCE(p_proceeds, 0);
  v_book    numeric;
  v_gl      numeric;
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
$$;

-- 8. reverse_last_depreciation(p_asset_id) -----------------------------------
--    LIFO reversal of the latest depreciation entry (correction path). Posts a
--    reversing JE at the entry's voucher date; marks the entry reversed.
CREATE OR REPLACE FUNCTION public.reverse_last_depreciation(p_asset_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user    uuid := auth.uid();
  v_company uuid := public.current_user_company_id();
  v_asset   public.fixed_assets%ROWTYPE;
  v_entry   public.depreciation_entries%ROWTYPE;
  v_je      jsonb;
BEGIN
  IF v_user IS NULL OR v_company IS NULL THEN
    RAISE EXCEPTION 'Not signed in to a company.' USING ERRCODE = '42501';
  END IF;
  PERFORM public.auth_require('accounting.write');

  SELECT * INTO v_asset FROM public.fixed_assets WHERE id = p_asset_id AND company_id = v_company FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Asset not found.' USING ERRCODE = 'P0001'; END IF;

  SELECT * INTO v_entry FROM public.depreciation_entries
    WHERE asset_id = p_asset_id AND company_id = v_company AND reversed_at IS NULL
    ORDER BY period_end DESC LIMIT 1 FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'No depreciation to reverse.' USING ERRCODE = 'P0001'; END IF;

  v_je := public.post_journal_entry(jsonb_build_object(
    'date', v_entry.period_end::text,
    'description', 'Depreciation reversal — ' || v_asset.name || ' (' || to_char(v_entry.period_end, 'Mon YYYY') || ')',
    'source_type', 'depreciation_reversal',
    'source_id', v_asset.id::text,
    'lines', jsonb_build_array(
      jsonb_build_object('account_code', v_asset.accum_dep_account_code, 'debit', v_entry.charge, 'credit', 0),
      jsonb_build_object('account_code', v_asset.expense_account_code,   'debit', 0, 'credit', v_entry.charge)
    )
  ));

  UPDATE public.depreciation_entries
     SET reversed_at = now(), reversed_je_id = (v_je->>'journal_entry_id')::uuid
   WHERE id = v_entry.id;

  UPDATE public.fixed_assets
     SET accumulated_depreciation = accumulated_depreciation - v_entry.charge,
         last_depreciated_period = (SELECT MAX(period_end) FROM public.depreciation_entries
                                     WHERE asset_id = p_asset_id AND reversed_at IS NULL),
         status = CASE WHEN status = 'fully_depreciated' THEN 'active' ELSE status END,
         updated_at = now()
   WHERE id = p_asset_id;

  RETURN jsonb_build_object('reversed_entry_id', v_entry.id, 'journal_entry_id', v_je->>'journal_entry_id', 'charge', v_entry.charge);
END;
$$;

-- 9. Grants ------------------------------------------------------------------
REVOKE ALL     ON FUNCTION public._fixed_asset_monthly_charge(numeric,numeric,int,text,numeric,date,numeric,date) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public._fixed_asset_monthly_charge(numeric,numeric,int,text,numeric,date,numeric,date) TO authenticated;
REVOKE ALL     ON FUNCTION public.run_depreciation(date) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.run_depreciation(date) TO authenticated;
REVOKE ALL     ON FUNCTION public.dispose_fixed_asset(uuid,date,numeric,text) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.dispose_fixed_asset(uuid,date,numeric,text) TO authenticated;
REVOKE ALL     ON FUNCTION public.reverse_last_depreciation(uuid) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.reverse_last_depreciation(uuid) TO authenticated;
