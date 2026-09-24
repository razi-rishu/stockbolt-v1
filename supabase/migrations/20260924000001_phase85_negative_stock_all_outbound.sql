-- ============================================================================
-- Phase 85 — The negative-stock guard only ever looked at sales
--
-- THE DEFECT
-- tg_block_negative_stock opened with:
--
--     IF NEW.type <> 'sale' OR NEW.reversal_of_id IS NOT NULL
--        OR NEW.running_qty >= 0 THEN RETURN NEW;
--
-- so every outbound movement that is not literally typed 'sale' walked past
-- it. confirm_debit_note writes type='purchase_return' with direction -1 and
-- NO reversal_of_id, which means a purchase return could take stock negative
-- at a company that has backorders switched OFF. Any future transfer-out or
-- outbound adjustment would do the same.
--
-- direction = -1 is the property that actually means "stock is leaving". The
-- type name was a proxy that happened to cover the only case anyone had built
-- at the time.
--
-- WHAT DOES **NOT** CHANGE
-- The reversal exemption stays, and it is load-bearing. Voiding or editing a
-- document whose goods have since been sold must always be possible, or the
-- document becomes uncorrectable and the operator is trapped. All 31
-- edit_reversal rows on this database carry reversal_of_id and are exempt for
-- that reason — not because of their type. An earlier reading of this
-- function blamed the type clause for the Al Noor negatives; the data says
-- otherwise, and the exemption is correct.
--
-- The company setting still wins: allow_negative_stock = true continues to
-- permit backorders on every movement type, as before.
--
-- LIVE EFFECT
-- Zero confirmed debit notes exist, so nothing is blocked retroactively and no
-- number moves. Going forward, a purchase return that would take stock below
-- zero is refused at a company with backorders off — which is the behaviour
-- the setting has always promised.
--
-- Al Noor currently holds -180 SHOCK and -100 CONTROL ARM from historical
-- sales, with backorders OFF. Those rows are untouched. A NEW outbound
-- movement on those products will now be refused there, which is correct and
-- may be the first time anyone notices the existing shortfall.
--
-- The error message now names the movement type, so "purchase_return" reads
-- differently from "sale" when it fires.
--
-- Reconstructed from the LIVE pg_get_functiondef. Additive and idempotent.
-- ============================================================================


CREATE OR REPLACE FUNCTION public.tg_block_negative_stock()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_allow BOOLEAN;
  v_sku   TEXT;
  v_avail NUMERIC(15,3);
BEGIN
  -- phase85: guard EVERY outbound movement, not only type='sale'.
  -- confirm_debit_note writes type='purchase_return' with direction -1 and no
  -- reversal_of_id, so a purchase return could drive stock negative at a
  -- company with backorders switched off. Same for any future transfer-out or
  -- adjustment. direction = -1 is the property that actually means "stock is
  -- leaving"; the type name was a proxy that only happened to cover sales.
  --
  -- The reversal exemption STAYS, and is load-bearing: voiding or editing a
  -- document whose goods have since been sold must always be possible, or the
  -- document becomes uncorrectable. All 31 edit_reversal rows on this database
  -- carry reversal_of_id and are exempt for that reason, not by type.
  IF NEW.direction <> -1
     OR NEW.reversal_of_id IS NOT NULL
     OR NEW.running_qty >= 0 THEN
    RETURN NEW;
  END IF;

  SELECT allow_negative_stock INTO v_allow
  FROM public.companies WHERE id = NEW.company_id;

  IF COALESCE(v_allow, false) THEN
    RETURN NEW;   -- backorders permitted for this company
  END IF;

  SELECT sku INTO v_sku FROM public.products WHERE id = NEW.product_id;
  v_avail := NEW.running_qty + NEW.quantity;   -- on-hand BEFORE this sale

  RAISE EXCEPTION
    'Not enough stock for % (%): % available, % requested. Enable "Allow backorders" in Settings to override.',
    COALESCE(v_sku, NEW.product_id::TEXT), NEW.type, v_avail, NEW.quantity
    USING ERRCODE = 'P0001';
END;
$function$;


NOTIFY pgrst, 'reload schema';
