-- ─────────────────────────────────────────────────────────────────────────
-- StockBolt — Supplier payable category (Lite) (2026-06-14)
-- ─────────────────────────────────────────────────────────────────────────
-- Goal: keep rent / utility suppliers' payables OUT of trade AP (2100) and
-- in their own current-liability lines, without JVs and without rewriting
-- the (large) vendor-bill / payment / advance RPCs.
--
-- How: a supplier gets a `payable_account_code` (default 2100 = trade).
-- A BEFORE-INSERT trigger on general_ledger redirects any AP line
-- (account_code = '2100' carrying a supplier contact_id) to that supplier's
-- chosen payable account. Bills, payments, advances, reversals and opening
-- balances all post '2100' as before — the trigger reclassifies in one
-- place. Reports were widened to read 2100 + 2110 + 2120 together.
--
-- New accounts:
--   2110  Rent & Lease Payable   (liability · current)
--   2120  Utilities Payable      (liability · current)
-- ─────────────────────────────────────────────────────────────────────────

-- 1. Seed the two new payable accounts for every existing company.
INSERT INTO public.chart_of_accounts (company_id, code, name, name_ar, type, sub_type, is_system, is_active)
SELECT c.id, v.code, v.name, v.name_ar, v.type, v.sub_type, true, true
FROM public.companies c
CROSS JOIN (VALUES
  ('2110', 'Rent & Lease Payable', 'إيجارات مستحقة الدفع', 'liability', 'current'),
  ('2120', 'Utilities Payable',    'مرافق مستحقة الدفع',   'liability', 'current')
) AS v(code, name, name_ar, type, sub_type)
WHERE NOT EXISTS (
  SELECT 1 FROM public.chart_of_accounts a WHERE a.company_id = c.id AND a.code = v.code
);

-- 2. Supplier → payable account mapping. NULL / '2100' = trade (default).
ALTER TABLE public.contacts ADD COLUMN IF NOT EXISTS payable_account_code TEXT;

-- 3. Redirect trigger: any 2100 AP line with a supplier whose
--    payable_account_code points elsewhere is reclassified to that account.
CREATE OR REPLACE FUNCTION public.remap_ap_account()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  v_code TEXT;
  v_acct UUID;
BEGIN
  IF NEW.account_code = '2100' AND NEW.contact_id IS NOT NULL THEN
    SELECT payable_account_code INTO v_code
    FROM public.contacts WHERE id = NEW.contact_id;

    IF v_code IS NOT NULL AND v_code <> '2100' THEN
      SELECT id INTO v_acct
      FROM public.chart_of_accounts
      WHERE company_id = NEW.company_id AND code = v_code AND is_active;

      IF v_acct IS NOT NULL THEN
        NEW.account_id   := v_acct;
        NEW.account_code := v_code;
      END IF;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_remap_ap_account ON public.general_ledger;
CREATE TRIGGER trg_remap_ap_account
  BEFORE INSERT ON public.general_ledger
  FOR EACH ROW EXECUTE FUNCTION public.remap_ap_account();
