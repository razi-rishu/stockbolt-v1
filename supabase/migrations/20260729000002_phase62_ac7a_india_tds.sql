-- ============================================================================
-- Phase 62 — AC-7A: India TDS (tax deducted at source)
--   CoA 2320 (india_only) · tds_sections · contacts TDS config · tds_deductions
--   + record_tds_deduction() / reverse_tds_deduction()
-- ============================================================================
-- Approved design (AC-7 spec, 2026-07-29) — STANDALONE DEDUCTION DOCUMENT.
-- TDS is posted as its OWN isolated entry. confirm_vendor_bill and
-- confirm_vendor_payment are NOT modified — those two are the most entangled
-- RPCs in the codebase (PDC, reopen and edit paths all reach into them), so the
-- deduction is layered on top instead:
--
--   Bill      Dr Expense 10,000 / Cr AP           10,000   (unchanged)
--   TDS doc   Dr AP         200 / Cr TDS Payable     200   (this migration)
--   Payment   Dr AP       9,800 / Cr Bank          9,800   (unchanged)
--
-- The AP balance therefore reflects what is actually owed to the vendor AFTER
-- withholding, and the payment naturally settles the reduced amount. Posting
-- reuses post_journal_entry() so no new GL-writing path is introduced.
--
-- RATES ARE DATA, NOT LAW. Indian withholding rates change with each Finance
-- Act. tds_sections is seeded per company with sensible defaults and is fully
-- editable, with effective_from so a rate change is representable. VERIFY THE
-- SEEDED DEFAULTS AGAINST THE CURRENT FINANCE ACT before relying on them.
--
-- INDIA ONLY: the 2320 account and the section seed are applied only to
-- companies with country_code = 'IN', matching the existing india_only pattern
-- in src/core/seeds/seedCOA.ts (1510/1520/1530, 2210/2220/2230).
--
-- Relies on (VERIFIED live): current_user_company_id(); auth_require(text);
-- has_perm(text); post_journal_entry(jsonb); public.vendor_bills(id, company_id,
-- supplier_id, bill_number, status, total_amount); public.contacts.
--
-- Additive + idempotent. Apply BY HAND in the Supabase SQL editor.
-- ROLLBACK:
--   DROP FUNCTION IF EXISTS public.reverse_tds_deduction(uuid);
--   DROP FUNCTION IF EXISTS public.record_tds_deduction(uuid,text,numeric,numeric,date,text);
--   DROP TABLE    IF EXISTS public.tds_deductions;
--   DROP TABLE    IF EXISTS public.tds_sections;
--   ALTER TABLE public.contacts DROP COLUMN IF EXISTS pan,
--     DROP COLUMN IF EXISTS tds_section_code, DROP COLUMN IF EXISTS tds_deductee_type,
--     DROP COLUMN IF EXISTS lower_deduction_rate;
--   -- (leave the 2320 account; harmless if unused)
-- ============================================================================

-- 1. CoA — TDS Payable, India tenants only --------------------------------
INSERT INTO public.chart_of_accounts (company_id, code, name, name_ar, type, sub_type, is_active)
SELECT c.id, '2320', 'TDS Payable', 'ضريبة مستقطعة من المنبع مستحقة', 'liability', 'current', true
FROM public.companies c
WHERE c.country_code = 'IN'
  AND NOT EXISTS (
    SELECT 1 FROM public.chart_of_accounts x WHERE x.company_id = c.id AND x.code = '2320'
  );

-- 2. Vendor TDS configuration on contacts ------------------------------------
ALTER TABLE public.contacts
  ADD COLUMN IF NOT EXISTS pan text;                       -- Permanent Account Number
ALTER TABLE public.contacts
  ADD COLUMN IF NOT EXISTS tds_section_code text;          -- default section for this vendor
ALTER TABLE public.contacts
  ADD COLUMN IF NOT EXISTS tds_deductee_type text NOT NULL DEFAULT 'other';
ALTER TABLE public.contacts
  ADD COLUMN IF NOT EXISTS lower_deduction_rate numeric(6,3);  -- §197 certificate, NULL = none
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'contacts_tds_deductee_type_check') THEN
    ALTER TABLE public.contacts ADD CONSTRAINT contacts_tds_deductee_type_check
      CHECK (tds_deductee_type IN ('individual_huf','other'));
  END IF;
END$$;

-- 3. Section rate master -----------------------------------------------------
CREATE TABLE IF NOT EXISTS public.tds_sections (
  id                uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id        uuid          NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  code              text          NOT NULL,                    -- '194C', '194J', …
  description       text          NOT NULL,
  rate_individual   numeric(6,3)  NOT NULL CHECK (rate_individual >= 0 AND rate_individual <= 100),
  rate_other        numeric(6,3)  NOT NULL CHECK (rate_other >= 0 AND rate_other <= 100),
  single_threshold  numeric(15,2) NOT NULL DEFAULT 0 CHECK (single_threshold >= 0),
  annual_threshold  numeric(15,2) NOT NULL DEFAULT 0 CHECK (annual_threshold >= 0),
  effective_from    date          NOT NULL DEFAULT '2024-10-01',
  is_active         boolean       NOT NULL DEFAULT true,
  created_at        timestamptz   NOT NULL DEFAULT now(),
  updated_at        timestamptz   NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS tds_sections_company_code_key
  ON public.tds_sections (company_id, code, effective_from);

-- Seed the common sections for India tenants. EDITABLE — verify against the
-- current Finance Act. (Rates below reflect the post-Budget-2024 position,
-- effective 1 Oct 2024, to the best of our knowledge at authoring time.)
INSERT INTO public.tds_sections
  (company_id, code, description, rate_individual, rate_other, single_threshold, annual_threshold)
SELECT c.id, v.code, v.description, v.ri, v.ro, v.st, v.at
FROM public.companies c
CROSS JOIN (VALUES
  ('194C', 'Payment to contractors',                  1.0,  2.0,  30000, 100000),
  ('194J', 'Professional / technical services',      10.0, 10.0,      0,  30000),
  ('194H', 'Commission or brokerage',                 2.0,  2.0,      0,  20000),
  ('194I', 'Rent — plant, machinery or equipment',    2.0,  2.0,      0, 240000),
  ('194IB','Rent — land, building or furniture',     10.0, 10.0,      0, 240000),
  ('194Q', 'Purchase of goods',                       0.1,  0.1,      0,5000000)
) AS v(code, description, ri, ro, st, at)
WHERE c.country_code = 'IN'
  AND NOT EXISTS (
    SELECT 1 FROM public.tds_sections x WHERE x.company_id = c.id AND x.code = v.code
  );

-- 4. Deduction ledger --------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.tds_deductions (
  id                uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id        uuid          NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  vendor_bill_id    uuid          NOT NULL REFERENCES public.vendor_bills(id) ON DELETE CASCADE,
  contact_id        uuid          NOT NULL REFERENCES public.contacts(id),
  section_code      text          NOT NULL,
  base_amount       numeric(15,2) NOT NULL CHECK (base_amount > 0),
  rate              numeric(6,3)  NOT NULL CHECK (rate >= 0 AND rate <= 100),
  rate_reason       text          NOT NULL DEFAULT 'section'
                      CHECK (rate_reason IN ('section','no_pan_206aa','certificate')),
  amount            numeric(15,2) NOT NULL CHECK (amount >= 0),
  deduction_date    date          NOT NULL,
  ap_account_code   text          NOT NULL DEFAULT '2100',
  tds_account_code  text          NOT NULL DEFAULT '2320',
  journal_entry_id  uuid,
  status            text          NOT NULL DEFAULT 'posted'
                      CHECK (status IN ('posted','reversed')),
  reversed_at       timestamptz,  reversed_by uuid,  reversed_je_id uuid,
  notes             text,
  created_at        timestamptz   NOT NULL DEFAULT now(),  created_by uuid
);
CREATE INDEX IF NOT EXISTS tds_deductions_company_date_idx
  ON public.tds_deductions (company_id, deduction_date);
CREATE INDEX IF NOT EXISTS tds_deductions_bill_idx
  ON public.tds_deductions (vendor_bill_id);

-- 5. RLS ---------------------------------------------------------------------
--    Sections: master data, CRUD by accounting.write.
--    Deductions: read only; all writes via the SECURITY DEFINER RPCs.
ALTER TABLE public.tds_sections ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tds_sections_read  ON public.tds_sections;
DROP POLICY IF EXISTS tds_sections_write ON public.tds_sections;
CREATE POLICY tds_sections_read ON public.tds_sections
  FOR SELECT USING (company_id = public.current_user_company_id());
CREATE POLICY tds_sections_write ON public.tds_sections
  FOR ALL USING (company_id = public.current_user_company_id() AND public.has_perm('accounting.write'))
          WITH CHECK (company_id = public.current_user_company_id() AND public.has_perm('accounting.write'));
REVOKE ALL ON public.tds_sections FROM anon;
GRANT  SELECT, INSERT, UPDATE, DELETE ON public.tds_sections TO authenticated;

ALTER TABLE public.tds_deductions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tds_deductions_read ON public.tds_deductions;
CREATE POLICY tds_deductions_read ON public.tds_deductions
  FOR SELECT USING (company_id = public.current_user_company_id());
REVOKE ALL ON public.tds_deductions FROM anon, authenticated;
GRANT  SELECT ON public.tds_deductions TO authenticated;

-- 6. record_tds_deduction(...) ------------------------------------------------
--    Posts Dr AP / Cr TDS Payable against a CONFIRMED vendor bill. The amount
--    is passed in (previewed client-side by src/lib/tds.ts) but is re-guarded
--    here: it may not exceed the bill total less what has already been deducted.
CREATE OR REPLACE FUNCTION public.record_tds_deduction(
  p_vendor_bill_id uuid,
  p_section_code   text,
  p_base_amount    numeric,
  p_rate           numeric,
  p_deduction_date date,
  p_rate_reason    text DEFAULT 'section'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user      uuid := auth.uid();
  v_company   uuid := public.current_user_company_id();
  v_bill      public.vendor_bills%ROWTYPE;
  v_amount    numeric;
  v_already   numeric;
  v_ap_code   text := '2100';
  v_je        jsonb;
  v_id        uuid;
BEGIN
  IF v_user IS NULL OR v_company IS NULL THEN
    RAISE EXCEPTION 'Not signed in to a company.' USING ERRCODE = '42501';
  END IF;
  PERFORM public.auth_require('accounting.write');

  IF p_rate_reason NOT IN ('section','no_pan_206aa','certificate') THEN
    RAISE EXCEPTION 'Unknown TDS rate reason %.', p_rate_reason USING ERRCODE = 'P0001';
  END IF;
  IF p_base_amount IS NULL OR p_base_amount <= 0 THEN
    RAISE EXCEPTION 'TDS base amount must be positive.' USING ERRCODE = 'P0001';
  END IF;
  IF p_rate IS NULL OR p_rate < 0 OR p_rate > 100 THEN
    RAISE EXCEPTION 'TDS rate must be between 0 and 100.' USING ERRCODE = 'P0001';
  END IF;

  SELECT * INTO v_bill FROM public.vendor_bills
    WHERE id = p_vendor_bill_id AND company_id = v_company
    FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Vendor bill not found.' USING ERRCODE = 'P0001';
  END IF;
  IF v_bill.status <> 'confirmed' THEN
    RAISE EXCEPTION 'TDS can only be deducted against a confirmed bill (status is %).', v_bill.status
      USING ERRCODE = 'P0001';
  END IF;

  -- Mirrors src/lib/tds.ts tdsAmount().
  v_amount := round((round(p_base_amount, 2) * p_rate) / 100, 2);
  IF v_amount <= 0 THEN
    RAISE EXCEPTION 'TDS amount computes to zero — nothing to post.' USING ERRCODE = 'P0001';
  END IF;

  -- Never withhold more than the bill is worth.
  SELECT COALESCE(sum(amount), 0) INTO v_already
    FROM public.tds_deductions
   WHERE vendor_bill_id = p_vendor_bill_id AND status = 'posted';
  IF round(v_already + v_amount, 2) > round(v_bill.total_amount, 2) THEN
    RAISE EXCEPTION 'TDS of % would exceed the bill total % (already deducted %).',
      v_amount, v_bill.total_amount, v_already USING ERRCODE = 'P0001';
  END IF;

  -- Dr AP (reduce what is owed to the vendor) / Cr TDS Payable (owed to govt).
  v_je := public.post_journal_entry(jsonb_build_object(
    'date', p_deduction_date::text,
    'description', 'TDS ' || p_section_code || ' — ' || v_bill.bill_number,
    'source_type', 'tds_deduction',
    'source_id', p_vendor_bill_id::text,
    'lines', jsonb_build_array(
      jsonb_build_object('account_code', v_ap_code, 'debit', v_amount, 'credit', 0,
                         'contact_id', v_bill.supplier_id::text),
      jsonb_build_object('account_code', '2320',    'debit', 0,        'credit', v_amount)
    )
  ));

  INSERT INTO public.tds_deductions (
    company_id, vendor_bill_id, contact_id, section_code, base_amount, rate, rate_reason,
    amount, deduction_date, ap_account_code, tds_account_code, journal_entry_id, created_by
  ) VALUES (
    v_company, p_vendor_bill_id, v_bill.supplier_id, p_section_code,
    round(p_base_amount, 2), p_rate, p_rate_reason,
    v_amount, p_deduction_date, v_ap_code, '2320',
    (v_je->>'journal_entry_id')::uuid, v_user
  ) RETURNING id INTO v_id;

  BEGIN
    INSERT INTO public.audit_logs (company_id, user_id, action, entity_type, entity_id, new_data)
    VALUES (v_company, v_user, 'record_tds_deduction', 'tds_deduction', v_id,
      jsonb_build_object('vendor_bill_id', p_vendor_bill_id, 'section', p_section_code,
                         'rate', p_rate, 'amount', v_amount));
  EXCEPTION WHEN OTHERS THEN NULL;
  END;

  RETURN jsonb_build_object('deduction_id', v_id, 'amount', v_amount,
                            'journal_entry_id', v_je->>'journal_entry_id', 'status', 'posted');
END;
$$;

-- 7. reverse_tds_deduction(p_deduction_id) ------------------------------------
--    Posts the opposite legs at the original voucher date and marks it reversed.
CREATE OR REPLACE FUNCTION public.reverse_tds_deduction(p_deduction_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user    uuid := auth.uid();
  v_company uuid := public.current_user_company_id();
  v_d       public.tds_deductions%ROWTYPE;
  v_je      jsonb;
BEGIN
  IF v_user IS NULL OR v_company IS NULL THEN
    RAISE EXCEPTION 'Not signed in to a company.' USING ERRCODE = '42501';
  END IF;
  PERFORM public.auth_require('accounting.write');

  SELECT * INTO v_d FROM public.tds_deductions
    WHERE id = p_deduction_id AND company_id = v_company
    FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'TDS deduction not found.' USING ERRCODE = 'P0001'; END IF;
  IF v_d.status <> 'posted' THEN
    RAISE EXCEPTION 'This TDS deduction is already reversed.' USING ERRCODE = 'P0001';
  END IF;

  -- Flip the original legs: Dr TDS Payable / Cr AP.
  v_je := public.post_journal_entry(jsonb_build_object(
    'date', v_d.deduction_date::text,
    'description', 'TDS reversal ' || v_d.section_code,
    'source_type', 'tds_reversal',
    'source_id', v_d.vendor_bill_id::text,
    'lines', jsonb_build_array(
      jsonb_build_object('account_code', v_d.tds_account_code, 'debit', v_d.amount, 'credit', 0),
      jsonb_build_object('account_code', v_d.ap_account_code,  'debit', 0, 'credit', v_d.amount,
                         'contact_id', v_d.contact_id::text)
    )
  ));

  UPDATE public.tds_deductions
     SET status = 'reversed', reversed_at = now(), reversed_by = v_user,
         reversed_je_id = (v_je->>'journal_entry_id')::uuid
   WHERE id = v_d.id;

  BEGIN
    INSERT INTO public.audit_logs (company_id, user_id, action, entity_type, entity_id, new_data)
    VALUES (v_company, v_user, 'reverse_tds_deduction', 'tds_deduction', v_d.id,
      jsonb_build_object('vendor_bill_id', v_d.vendor_bill_id, 'amount', v_d.amount));
  EXCEPTION WHEN OTHERS THEN NULL;
  END;

  RETURN jsonb_build_object('deduction_id', v_d.id, 'status', 'reversed',
                            'journal_entry_id', v_je->>'journal_entry_id', 'amount', v_d.amount);
END;
$$;

-- 8. Grants ------------------------------------------------------------------
REVOKE ALL     ON FUNCTION public.record_tds_deduction(uuid,text,numeric,numeric,date,text) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.record_tds_deduction(uuid,text,numeric,numeric,date,text) TO authenticated;
REVOKE ALL     ON FUNCTION public.reverse_tds_deduction(uuid) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.reverse_tds_deduction(uuid) TO authenticated;
