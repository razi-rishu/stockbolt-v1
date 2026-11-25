-- ═══════════════════════════════════════════════════════════════════════════
-- phase155 — packs: buy and sell in other units (inventory plan, Part 3)
-- ═══════════════════════════════════════════════════════════════════════════
-- A product keeps ONE base unit (PCS, KG…). A pack is a named value of it for
-- that product: BOX = 12, "200 g" = 0.2, "500 g" = 0.5. A document line keeps
-- the quantity and price as sold ("2 BOX × 100.00"); stock and cost move the
-- base quantity (24 PCS).
--
-- OPTIONAL: inventory_settings.packs_enabled, default FALSE for every company,
-- new and existing. While off no pack line can be written, and a line without
-- a pack behaves exactly as before: its base_quantity stays NULL and every
-- function reads COALESCE(base_quantity, quantity).
--
-- RULES, all in the database:
--   * a pack has a value (factor > 0) or does not exist: no unit silently
--     counts as 1;
--   * the server fills unit_factor, base_quantity and unit_label on the line;
--     what a client sends for them is ignored;
--   * a pack's value cannot change once a document used it (make a new pack);
--   * the base unit cannot change once stock moved and the product has packs;
--   * an amount that is not a whole number of thousandths of the base unit is
--     refused, never rounded; units like PCS take whole numbers only
--     (checked only while packs are on);
--   * packs are for stocked goods without serial numbers;
--   * packs cannot be switched off while open documents use them;
--   * an app too old to know packs is stopped BEFORE it deletes or rewrites a
--     pack line (it would turn 1 BOX into 1 PCS), and, while packs are on,
--     before it rewrites any document (its lines could be lost half way). New apps send the header
--     x-stockbolt-units; only direct table writes by users are checked.
--
-- FUNCTIONS: confirm_invoice, edit_invoice, confirm_pos_sale, confirm_grn,
--   confirm_vendor_bill, confirm_credit_note, confirm_debit_note,
--   _credit_note_line_cost — the stock quantity only; repair_vendor_bill_je
--   refuses a bill with packs. Returnable quantities (the two views) are in
--   base units, so a customer can buy a box and return 3 pieces.
--   Old sales/purchase return documents refuse a pack line.
--   No new accounts, no new posting pattern.
--
-- SAFE TO APPLY: new table, new nullable columns, no data changes. Needs
-- phase153 and phase154. The file compares the nine live functions with the
-- versions it was built from and STOPS, changing nothing, if one differs.
-- Re-runnable.
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

DO $guard$
DECLARE r record; v_def text;
BEGIN
  IF to_regclass('public.inventory_settings') IS NULL THEN
    RAISE EXCEPTION 'phase155 stopped: run phase153 first. Nothing was changed.';
  END IF;
  FOR r IN SELECT * FROM (VALUES
    ('confirm_invoice', 'c582fc9a397ffff3a29536288e489e19'),
    ('edit_invoice', '999abe14e708a957e86bb3a20ba12d4e'),
    ('confirm_pos_sale', 'ff8a6379a0de264c28375ae29758324c'),
    ('confirm_grn', '1bee334ca0cfe7889f061f75a355a239'),
    ('confirm_vendor_bill', '9c7561957b223760070a5e906aedc3c0'),
    ('confirm_credit_note', '8156fd96ad4f4243181c4ffde9f79567'),
    ('confirm_debit_note', '65f73652bb8818072d3369a7ba65939c'),
    ('_credit_note_line_cost', '85eb70b05341886f2d3f8b79fc55e2c6'),
    ('repair_vendor_bill_je', '3191e5cd1c87b8a771161911556fd8c2')
  ) AS v(fn, md5_expected)
  LOOP
    SELECT replace(pg_get_functiondef(p.oid), chr(13), '') INTO v_def
      FROM pg_proc p WHERE p.proname = r.fn AND p.pronamespace = 'public'::regnamespace;
    IF v_def IS NULL THEN
      RAISE EXCEPTION 'phase155 stopped: function % not found (run phase154 first). Nothing was changed.', r.fn;
    END IF;
    IF v_def !~ 'phase155' AND md5(v_def) <> r.md5_expected THEN
      RAISE EXCEPTION 'phase155 stopped: % differs from the expected version (md5 %). Nothing was changed. Send this message back.', r.fn, md5(v_def);
    END IF;
  END LOOP;
END
$guard$;

-- ── 1. Switch and units ───────────────────────────────────────────────────
ALTER TABLE public.inventory_settings ADD COLUMN IF NOT EXISTS packs_enabled boolean NOT NULL DEFAULT false;
-- NULL = decided by the code (PCS, SET, BOX… whole numbers; KG, LITRE… decimals)
ALTER TABLE public.units_of_measure ADD COLUMN IF NOT EXISTS allows_decimals boolean;

CREATE TABLE IF NOT EXISTS public.product_units (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id     uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  product_id     uuid NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
  name           text NOT NULL CHECK (btrim(name) <> '' AND length(name) <= 40),
  name_ar        text CHECK (length(name_ar) <= 40),
  unit_id        uuid REFERENCES public.units_of_measure(id) ON DELETE SET NULL,
  factor         numeric(18,6) NOT NULL CHECK (factor > 0 AND factor <= 1000000),
  selling_price  numeric(15,2) CHECK (selling_price >= 0),
  purchase_price numeric(15,2) CHECK (purchase_price >= 0),
  barcode        text CHECK (btrim(barcode) <> ''),
  for_sales      boolean NOT NULL DEFAULT true,
  for_purchases  boolean NOT NULL DEFAULT true,
  is_active      boolean NOT NULL DEFAULT true,
  sort_order     integer NOT NULL DEFAULT 0,
  created_by     uuid DEFAULT auth.uid(),
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS product_units_name_key    ON public.product_units (product_id, lower(btrim(name))) WHERE is_active;
CREATE UNIQUE INDEX IF NOT EXISTS product_units_barcode_key ON public.product_units (company_id, barcode) WHERE barcode IS NOT NULL AND is_active;
CREATE INDEX IF NOT EXISTS product_units_company_idx ON public.product_units (company_id);
CREATE INDEX IF NOT EXISTS product_units_product_idx ON public.product_units (product_id);
CREATE INDEX IF NOT EXISTS product_units_unit_idx    ON public.product_units (unit_id);

DROP TRIGGER IF EXISTS product_units_set_updated_at ON public.product_units;
CREATE TRIGGER product_units_set_updated_at BEFORE UPDATE ON public.product_units
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.product_units ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS product_units_read ON public.product_units;
CREATE POLICY product_units_read ON public.product_units FOR SELECT TO authenticated
  USING (company_id = public.current_user_company_id());
DROP POLICY IF EXISTS product_units_insert ON public.product_units;
CREATE POLICY product_units_insert ON public.product_units FOR INSERT TO authenticated
  WITH CHECK (company_id = public.current_user_company_id() AND public.has_perm('inventory.write'));
DROP POLICY IF EXISTS product_units_update ON public.product_units;
CREATE POLICY product_units_update ON public.product_units FOR UPDATE TO authenticated
  USING (company_id = public.current_user_company_id() AND public.has_perm('inventory.write'))
  WITH CHECK (company_id = public.current_user_company_id() AND public.has_perm('inventory.write'));
DROP POLICY IF EXISTS product_units_delete ON public.product_units;
CREATE POLICY product_units_delete ON public.product_units FOR DELETE TO authenticated
  USING (company_id = public.current_user_company_id() AND public.has_perm('inventory.write'));
REVOKE ALL ON public.product_units FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.product_units TO authenticated;
GRANT ALL ON public.product_units TO service_role;

-- ── 2. Document lines ─────────────────────────────────────────────────────
DO $cols$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['sales_quote_items', 'invoice_items', 'credit_note_items', 'purchase_order_items',
                           'goods_receipt_items', 'vendor_bill_items', 'debit_note_items'] LOOP
    EXECUTE format('ALTER TABLE public.%I
      ADD COLUMN IF NOT EXISTS product_unit_id uuid REFERENCES public.product_units(id) ON DELETE RESTRICT,
      ADD COLUMN IF NOT EXISTS unit_factor   numeric(18,6),
      ADD COLUMN IF NOT EXISTS base_quantity numeric(15,3),
      ADD COLUMN IF NOT EXISTS unit_label    text', t);
    EXECUTE format('CREATE INDEX IF NOT EXISTS %I ON public.%I (product_unit_id) WHERE product_unit_id IS NOT NULL', t || '_product_unit_idx', t);
  END LOOP;
END
$cols$;

-- ── 3. Helpers ────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public._packs_on(p_company uuid)
RETURNS boolean LANGUAGE sql STABLE SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT COALESCE((SELECT s.packs_enabled FROM public.inventory_settings s WHERE s.company_id = p_company), false);
$function$;

CREATE OR REPLACE FUNCTION public._unit_allows_decimals(p_unit uuid)
RETURNS boolean LANGUAGE sql STABLE SET search_path TO 'public', 'pg_temp'
AS $function$
  -- No unit counts as PCS.
  SELECT COALESCE((SELECT COALESCE(u.allows_decimals,
           upper(btrim(u.code)) NOT IN ('PCS','PC','PCE','PIECE','PIECES','NOS','NO','EA','EACH','UNIT','UNITS','SET','SETS','PAIR','PR',
                                        'BOX','BOXES','BX','PKT','PACK','PK','CTN','CARTON','DOZ','DZN','DOZEN','BAG','BTL','DRUM','ROLL'))
         FROM public.units_of_measure u WHERE u.id = p_unit), false);
$function$;

-- Does this request come from an app that knows packs? No request headers =
-- not an API call (SQL editor, server code).
CREATE OR REPLACE FUNCTION public._units_aware()
RETURNS boolean LANGUAGE sql STABLE SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT CASE WHEN COALESCE(current_setting('request.headers', true), '') = '' THEN true
              ELSE COALESCE((current_setting('request.headers', true)::json ->> 'x-stockbolt-units'), '') <> '' END;
$function$;

-- ── 4. Line trigger ───────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.tg_pack_line()
RETURNS trigger LANGUAGE plpgsql SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_qty     numeric;
  v_old_qty numeric;
  v_base    numeric;
  v_prod    record;
  v_pack    record;
  v_on      boolean;
  -- Only a user's own direct write; posting functions run as ledger_writer.
  v_direct  boolean := current_user = 'authenticated';
BEGIN
  IF TG_OP <> 'INSERT' AND OLD.product_unit_id IS NOT NULL AND v_direct THEN
    IF NOT public._units_aware() THEN
      RAISE EXCEPTION 'app_update_required: this document uses packs. Update the app, or refresh the page, to change it.' USING ERRCODE = 'P0001';
    END IF;
    IF TG_OP = 'DELETE' AND NOT public._packs_on((SELECT p.company_id FROM public.products p WHERE p.id = OLD.product_id)) THEN
      RAISE EXCEPTION 'packs_off: this document uses packs. Turn packs on in Inventory settings to change it.' USING ERRCODE = 'P0001';
    END IF;
  END IF;
  -- Saving a draft deletes its lines and inserts them again. An old app must
  -- be stopped here, not at the insert: by then the old lines are gone.
  IF TG_OP = 'DELETE' AND v_direct AND NOT public._units_aware()
     AND public._packs_on(public.current_user_company_id()) THEN
    RAISE EXCEPTION 'app_update_required: your company uses packs. Update the app, or refresh the page, to change this document.' USING ERRCODE = 'P0001';
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;

  IF TG_TABLE_NAME = 'goods_receipt_items' THEN
    v_qty := NEW.qty_received;
    IF TG_OP = 'UPDATE' THEN v_old_qty := OLD.qty_received; END IF;
  ELSE
    v_qty := NEW.quantity;
    IF TG_OP = 'UPDATE' THEN v_old_qty := OLD.quantity; END IF;
  END IF;

  -- Nothing that matters changed: the value on the line stays frozen.
  IF TG_OP = 'UPDATE' AND v_qty IS NOT DISTINCT FROM v_old_qty
     AND NEW.product_id IS NOT DISTINCT FROM OLD.product_id
     AND NEW.product_unit_id IS NOT DISTINCT FROM OLD.product_unit_id THEN
    NEW.unit_factor := OLD.unit_factor; NEW.base_quantity := OLD.base_quantity; NEW.unit_label := OLD.unit_label;
    RETURN NEW;
  END IF;

  NEW.unit_factor := NULL; NEW.base_quantity := NULL; NEW.unit_label := NULL;
  IF NEW.product_id IS NULL THEN
    IF NEW.product_unit_id IS NOT NULL THEN
      RAISE EXCEPTION 'pack_invalid: a pack needs a product.' USING ERRCODE = 'P0001';
    END IF;
    RETURN NEW;
  END IF;

  SELECT p.company_id, p.type, p.unit_id, p.sku INTO v_prod FROM public.products p WHERE p.id = NEW.product_id;
  IF NOT FOUND THEN
    IF NEW.product_unit_id IS NOT NULL THEN
      RAISE EXCEPTION 'pack_invalid: product not found.' USING ERRCODE = 'P0001';
    END IF;
    RETURN NEW;
  END IF;
  v_on := public._packs_on(v_prod.company_id);

  IF NEW.product_unit_id IS NULL THEN
    IF v_on AND v_prod.type IS DISTINCT FROM 'service' THEN
      -- An old app on a product sold in packs: it cannot show or ask for the unit.
      IF TG_OP = 'INSERT' AND v_direct AND NOT public._units_aware()
         AND EXISTS (SELECT 1 FROM public.product_units u WHERE u.product_id = NEW.product_id AND u.is_active) THEN
        RAISE EXCEPTION 'app_update_required: % is sold in packs. Update the app, or refresh the page, to use it.', v_prod.sku USING ERRCODE = 'P0001';
      END IF;
      IF v_qty <> trunc(v_qty) AND NOT public._unit_allows_decimals(v_prod.unit_id) THEN
        RAISE EXCEPTION 'whole_units_only: % is counted in whole units (%).', v_prod.sku, v_qty USING ERRCODE = 'P0001';
      END IF;
    END IF;
    RETURN NEW;
  END IF;

  IF NOT v_on THEN
    RAISE EXCEPTION 'packs_off: packs are not turned on in Inventory settings.' USING ERRCODE = 'P0001';
  END IF;
  SELECT u.product_id, u.factor, u.name INTO v_pack FROM public.product_units u
   WHERE u.id = NEW.product_unit_id AND u.company_id = v_prod.company_id;
  IF NOT FOUND OR v_pack.product_id <> NEW.product_id THEN
    RAISE EXCEPTION 'pack_invalid: this pack does not belong to %.', v_prod.sku USING ERRCODE = 'P0001';
  END IF;

  v_base := v_qty * v_pack.factor;
  IF v_base <> round(v_base, 3) THEN
    RAISE EXCEPTION 'pack_too_small: % × % is smaller than StockBolt can count for %.', v_qty, v_pack.name, v_prod.sku USING ERRCODE = 'P0001';
  END IF;
  IF v_base <> trunc(v_base) AND NOT public._unit_allows_decimals(v_prod.unit_id) THEN
    RAISE EXCEPTION 'whole_units_only: % × % is % of %, which is counted in whole units.', v_qty, v_pack.name, v_base, v_prod.sku USING ERRCODE = 'P0001';
  END IF;

  NEW.unit_factor := v_pack.factor; NEW.base_quantity := v_base; NEW.unit_label := v_pack.name;
  RETURN NEW;
END;
$function$;

DO $trg$
DECLARE t text; q text;
BEGIN
  FOREACH t IN ARRAY ARRAY['sales_quote_items', 'invoice_items', 'credit_note_items', 'purchase_order_items',
                           'goods_receipt_items', 'vendor_bill_items', 'debit_note_items'] LOOP
    q := CASE t WHEN 'goods_receipt_items' THEN 'qty_received' ELSE 'quantity' END;
    EXECUTE format('DROP TRIGGER IF EXISTS a_pack_line ON public.%I', t);
    EXECUTE format('CREATE TRIGGER a_pack_line BEFORE INSERT OR DELETE OR UPDATE OF product_id, product_unit_id, %I, unit_factor, base_quantity, unit_label
                    ON public.%I FOR EACH ROW EXECUTE FUNCTION public.tg_pack_line()', q, t);
  END LOOP;
END
$trg$;

-- ── 5. Guards on packs, products and the switch ───────────────────────────
CREATE OR REPLACE FUNCTION public._product_unit_used(p_unit uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT EXISTS (SELECT 1 FROM public.sales_quote_items    WHERE product_unit_id = p_unit)
      OR EXISTS (SELECT 1 FROM public.invoice_items        WHERE product_unit_id = p_unit)
      OR EXISTS (SELECT 1 FROM public.credit_note_items    WHERE product_unit_id = p_unit)
      OR EXISTS (SELECT 1 FROM public.purchase_order_items WHERE product_unit_id = p_unit)
      OR EXISTS (SELECT 1 FROM public.goods_receipt_items  WHERE product_unit_id = p_unit)
      OR EXISTS (SELECT 1 FROM public.vendor_bill_items    WHERE product_unit_id = p_unit)
      OR EXISTS (SELECT 1 FROM public.debit_note_items     WHERE product_unit_id = p_unit);
$function$;

CREATE OR REPLACE FUNCTION public.tg_product_units_guard()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE v_prod record;
BEGIN
  SELECT p.company_id, p.type, p.requires_serial INTO v_prod FROM public.products p WHERE p.id = NEW.product_id;
  IF NOT FOUND OR v_prod.company_id <> NEW.company_id THEN
    RAISE EXCEPTION 'pack_invalid: product not found in this company.' USING ERRCODE = 'P0001';
  END IF;
  IF v_prod.type = 'service' OR COALESCE(v_prod.requires_serial, false) THEN
    RAISE EXCEPTION 'pack_not_allowed: packs are for stocked goods without serial numbers.' USING ERRCODE = 'P0001';
  END IF;
  IF NEW.unit_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.units_of_measure u WHERE u.id = NEW.unit_id AND u.company_id = NEW.company_id) THEN
    RAISE EXCEPTION 'pack_invalid: unit not found in this company.' USING ERRCODE = 'P0001';
  END IF;
  IF NEW.barcode IS NOT NULL AND NEW.is_active
     AND EXISTS (SELECT 1 FROM public.products p WHERE p.company_id = NEW.company_id AND p.barcode = NEW.barcode) THEN
    RAISE EXCEPTION 'pack_barcode_used: barcode % already belongs to a product.', NEW.barcode USING ERRCODE = 'P0001';
  END IF;
  IF TG_OP = 'UPDATE' THEN
    IF NEW.product_id <> OLD.product_id OR NEW.company_id <> OLD.company_id THEN
      RAISE EXCEPTION 'pack_locked: a pack cannot move to another product.' USING ERRCODE = 'P0001';
    END IF;
    IF NEW.factor <> OLD.factor AND public._product_unit_used(OLD.id) THEN
      RAISE EXCEPTION 'pack_locked: % is already used on documents, so its value cannot change. Deactivate it and add a new one.', OLD.name USING ERRCODE = 'P0001';
    END IF;
  END IF;
  RETURN NEW;
END;
$function$;
DROP TRIGGER IF EXISTS product_units_guard ON public.product_units;
CREATE TRIGGER product_units_guard BEFORE INSERT OR UPDATE ON public.product_units
  FOR EACH ROW EXECUTE FUNCTION public.tg_product_units_guard();

CREATE OR REPLACE FUNCTION public.tg_products_pack_guard()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  IF NEW.unit_id IS NOT DISTINCT FROM OLD.unit_id AND NEW.type IS NOT DISTINCT FROM OLD.type
     AND NEW.requires_serial IS NOT DISTINCT FROM OLD.requires_serial THEN
    RETURN NEW;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.product_units u WHERE u.product_id = NEW.id) THEN RETURN NEW; END IF;
  IF NEW.type = 'service' OR COALESCE(NEW.requires_serial, false) THEN
    RAISE EXCEPTION 'pack_not_allowed: % has packs, which are for stocked goods without serial numbers.', OLD.sku USING ERRCODE = 'P0001';
  END IF;
  IF NEW.unit_id IS DISTINCT FROM OLD.unit_id AND EXISTS (SELECT 1 FROM public.stock_ledger s WHERE s.product_id = NEW.id) THEN
    RAISE EXCEPTION 'base_unit_locked: % has packs and stock movements, so its base unit cannot change.', OLD.sku USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END;
$function$;
DROP TRIGGER IF EXISTS products_pack_guard ON public.products;
CREATE TRIGGER products_pack_guard BEFORE UPDATE OF unit_id, type, requires_serial ON public.products
  FOR EACH ROW EXECUTE FUNCTION public.tg_products_pack_guard();

CREATE OR REPLACE FUNCTION public.tg_packs_switch_guard()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE v_n integer;
BEGIN
  IF NOT (OLD.packs_enabled AND NOT NEW.packs_enabled) THEN RETURN NEW; END IF;
  SELECT (SELECT count(DISTINCT d.id) FROM public.invoices d        JOIN public.invoice_items i        ON i.invoice_id = d.id     WHERE d.company_id = NEW.company_id AND d.status = 'draft' AND i.product_unit_id IS NOT NULL)
       + (SELECT count(DISTINCT d.id) FROM public.sales_quotes d    JOIN public.sales_quote_items i    ON i.quote_id = d.id       WHERE d.company_id = NEW.company_id AND d.status IN ('draft','sent','accepted','partially_invoiced') AND i.product_unit_id IS NOT NULL)
       + (SELECT count(DISTINCT d.id) FROM public.credit_notes d    JOIN public.credit_note_items i    ON i.credit_note_id = d.id WHERE d.company_id = NEW.company_id AND d.status = 'draft' AND i.product_unit_id IS NOT NULL)
       + (SELECT count(DISTINCT d.id) FROM public.purchase_orders d JOIN public.purchase_order_items i ON i.po_id = d.id          WHERE d.company_id = NEW.company_id AND d.status IN ('draft','sent','partially_received') AND i.product_unit_id IS NOT NULL)
       + (SELECT count(DISTINCT d.id) FROM public.goods_receipts d  JOIN public.goods_receipt_items i  ON i.grn_id = d.id         WHERE d.company_id = NEW.company_id AND d.status = 'draft' AND i.product_unit_id IS NOT NULL)
       + (SELECT count(DISTINCT d.id) FROM public.vendor_bills d    JOIN public.vendor_bill_items i    ON i.bill_id = d.id        WHERE d.company_id = NEW.company_id AND d.status = 'draft' AND i.product_unit_id IS NOT NULL)
       + (SELECT count(DISTINCT d.id) FROM public.debit_notes d     JOIN public.debit_note_items i     ON i.debit_note_id = d.id  WHERE d.company_id = NEW.company_id AND d.status = 'draft' AND i.product_unit_id IS NOT NULL)
    INTO v_n;
  IF v_n > 0 THEN
    RAISE EXCEPTION 'packs_in_use: % open documents use packs. Finish or delete them before turning packs off.', v_n USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END;
$function$;
DROP TRIGGER IF EXISTS packs_switch_guard ON public.inventory_settings;
CREATE TRIGGER packs_switch_guard BEFORE UPDATE OF packs_enabled ON public.inventory_settings
  FOR EACH ROW EXECUTE FUNCTION public.tg_packs_switch_guard();

-- The old return documents (retired from the menu; credit and debit notes
-- replaced them) price a line per pack but count it in base units now. They
-- are refused for a pack line: use a credit note or a debit note.
CREATE OR REPLACE FUNCTION public.tg_return_no_packs()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE v_pack boolean;
BEGIN
  IF TG_TABLE_NAME = 'sales_return_items' THEN
    SELECT true INTO v_pack FROM public.invoice_items i WHERE i.id = NEW.invoice_item_id AND i.product_unit_id IS NOT NULL;
  ELSE
    SELECT true INTO v_pack FROM public.vendor_bill_items i WHERE i.id = NEW.vendor_bill_item_id AND i.product_unit_id IS NOT NULL;
  END IF;
  IF v_pack THEN
    RAISE EXCEPTION 'pack_return_not_supported: this line was made in packs. Use a credit note or a debit note.' USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END;
$function$;
DROP TRIGGER IF EXISTS pack_return_guard ON public.sales_return_items;
CREATE TRIGGER pack_return_guard BEFORE INSERT OR UPDATE ON public.sales_return_items
  FOR EACH ROW EXECUTE FUNCTION public.tg_return_no_packs();
DROP TRIGGER IF EXISTS pack_return_guard ON public.purchase_return_items;
CREATE TRIGGER pack_return_guard BEFORE INSERT OR UPDATE ON public.purchase_return_items
  FOR EACH ROW EXECUTE FUNCTION public.tg_return_no_packs();

REVOKE ALL ON FUNCTION public.tg_pack_line(), public.tg_return_no_packs(), public.tg_product_units_guard(), public.tg_products_pack_guard(),
                       public.tg_packs_switch_guard(), public._product_unit_used(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._packs_on(uuid), public._unit_allows_decimals(uuid), public._units_aware() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public._packs_on(uuid), public._unit_allows_decimals(uuid), public._units_aware() TO authenticated, ledger_writer, service_role;

-- ── 6. Returnable quantities, in base units ───────────────────────────────
CREATE OR REPLACE VIEW public.v_invoice_line_returnable WITH (security_invoker = true) AS
 SELECT ii.id AS invoice_item_id,
    ii.invoice_id,
    ii.product_id,
    COALESCE(ii.base_quantity, ii.quantity)::numeric(15,3) AS qty_sold,
    COALESCE(r.qty_returned, 0::numeric) AS qty_returned,
    GREATEST(COALESCE(ii.base_quantity, ii.quantity) - COALESCE(r.qty_returned, 0::numeric), 0::numeric) AS qty_returnable
   FROM public.invoice_items ii
     LEFT JOIN LATERAL ( SELECT sum(COALESCE(cni.base_quantity, cni.quantity)) AS qty_returned
           FROM public.credit_note_items cni
             JOIN public.credit_notes cn ON cn.id = cni.credit_note_id
          WHERE cni.invoice_item_id = ii.id AND cn.status = 'confirmed'::text) r ON true;

CREATE OR REPLACE VIEW public.v_bill_line_returnable WITH (security_invoker = true) AS
 SELECT vbi.id AS vendor_bill_item_id,
    vbi.bill_id,
    vbi.product_id,
    COALESCE(vbi.base_quantity, vbi.quantity)::numeric(15,3) AS qty_billed,
    COALESCE(r.qty_returned, 0::numeric) AS qty_returned,
    GREATEST(COALESCE(vbi.base_quantity, vbi.quantity) - COALESCE(r.qty_returned, 0::numeric), 0::numeric) AS qty_returnable
   FROM public.vendor_bill_items vbi
     LEFT JOIN LATERAL ( SELECT sum(COALESCE(dni.base_quantity, dni.quantity)) AS qty_returned
           FROM public.debit_note_items dni
             JOIN public.debit_notes dn ON dn.id = dni.debit_note_id
          WHERE dni.vendor_bill_item_id = vbi.id AND dn.status = 'confirmed'::text) r ON true;

-- ── 7. Posting functions: the stock quantity is the base quantity ─────────
-- ── confirm_invoice
CREATE OR REPLACE FUNCTION public.confirm_invoice(p_invoice_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
-- Cumulative phase tags (preserved so the regression suite's per-phase
-- markers still resolve): Phase 12.20, Phase 12.22, Phase 12.27, Phase 12.28
DECLARE
  v_user_id     UUID := auth.uid();
  v_company_id  UUID;
  v_inv         public.invoices%ROWTYPE;
  v_item        public.invoice_items%ROWTYPE;
  v_product_type TEXT;
  v_lock_date   DATE;
  v_inv_je_id   UUID;
  v_cogs_je_id  UUID;
  v_inv_entry   TEXT;
  v_cogs_entry  TEXT;
  v_seq         BIGINT;
  v_ar_id       UUID;
  v_sales_id    UUID;
  v_sales_disc_id UUID;
  v_vat_id      UUID;
  v_cogs_id     UUID;
  v_inv_acc_id  UUID;
  v_current_mac   NUMERIC(15,2);
  v_total_cogs    NUMERIC(15,2) := 0;
  v_issue         RECORD;   -- phase154
  v_wh_id         UUID;
  v_prev_running  NUMERIC(15,3);
  v_je_total      NUMERIC(15,2);
  v_round_off_acc UUID;
BEGIN
  SELECT company_id INTO v_company_id FROM public.profiles WHERE id = v_user_id;
  IF v_company_id IS NULL THEN
    RAISE EXCEPTION 'confirm_invoice: no company for user %', v_user_id;
  END IF;

  SELECT * INTO v_inv FROM public.invoices WHERE id = p_invoice_id AND company_id = v_company_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'confirm_invoice: invoice % not found', p_invoice_id; END IF;
  IF v_inv.status <> 'draft' THEN
    RAISE EXCEPTION 'confirm_invoice: invoice % not in draft (status=%)', p_invoice_id, v_inv.status;
  END IF;

  SELECT period_lock_date INTO v_lock_date FROM public.companies WHERE id = v_company_id;
  IF v_lock_date IS NOT NULL AND v_inv.date <= v_lock_date THEN
    RAISE EXCEPTION 'confirm_invoice: date % on or before period lock %', v_inv.date, v_lock_date;
  END IF;

  v_wh_id := v_inv.warehouse_id;
  IF v_wh_id IS NULL THEN
    SELECT id INTO v_wh_id FROM public.warehouses WHERE company_id = v_company_id AND is_default = TRUE LIMIT 1;
  END IF;

  SELECT id INTO v_ar_id          FROM public.chart_of_accounts WHERE company_id = v_company_id AND code = '1200' AND is_active;
  SELECT id INTO v_sales_id       FROM public.chart_of_accounts WHERE company_id = v_company_id AND code = '4100' AND is_active;
  SELECT id INTO v_sales_disc_id  FROM public.chart_of_accounts WHERE company_id = v_company_id AND code = '4150' AND is_active;
  SELECT id INTO v_cogs_id        FROM public.chart_of_accounts WHERE company_id = v_company_id AND code = '5100' AND is_active;
  SELECT id INTO v_inv_acc_id     FROM public.chart_of_accounts WHERE company_id = v_company_id AND code = '1300' AND is_active;

  IF v_inv.tax_amount > 0 THEN
    SELECT id INTO v_vat_id FROM public.chart_of_accounts
    WHERE company_id = v_company_id AND code LIKE '22%' AND is_active ORDER BY code LIMIT 1;
  END IF;

  IF v_sales_disc_id IS NOT NULL AND v_inv.discount_amount > 0 THEN
    v_je_total := v_inv.total_amount + v_inv.discount_amount + GREATEST(-COALESCE(v_inv.round_off_amount, 0), 0);
  ELSE
    v_je_total := v_inv.total_amount + GREATEST(-COALESCE(v_inv.round_off_amount, 0), 0);
  END IF;

  INSERT INTO public.document_sequences (company_id, prefix, current_value, format, pad_zeros, reset_yearly)
  VALUES (v_company_id, 'JE', 1001, 'JE-{NUMBER}', 0, false)
  ON CONFLICT (company_id, prefix) DO UPDATE
    SET current_value = public.document_sequences.current_value + 1, updated_at = NOW()
  RETURNING current_value INTO v_seq;
  v_inv_entry := 'JE-' || v_seq::TEXT;

  INSERT INTO public.journal_entries (
    company_id, entry_number, date, description,
    source_type, source_id, currency, exchange_rate,
    total_debit, total_credit, created_by
  ) VALUES (
    v_company_id, v_inv_entry, v_inv.date,
    'Sales Invoice ' || v_inv.invoice_number,
    'sales_invoice', p_invoice_id, v_inv.currency, v_inv.exchange_rate,
    v_je_total, v_je_total, v_user_id
  ) RETURNING id INTO v_inv_je_id;

  INSERT INTO public.general_ledger
    (company_id, journal_entry_id, account_id, account_code, date, debit, credit, description, contact_id, related_doc_type, related_doc_id)
  VALUES
    (v_company_id, v_inv_je_id, v_ar_id, '1200', v_inv.date, v_inv.total_amount, 0,
     'Sales Invoice ' || v_inv.invoice_number, v_inv.contact_id, 'invoice', p_invoice_id);

  IF v_sales_disc_id IS NOT NULL AND v_inv.discount_amount > 0 THEN
    INSERT INTO public.general_ledger
      (company_id, journal_entry_id, account_id, account_code, date, debit, credit, description, contact_id, related_doc_type, related_doc_id)
    VALUES
      (v_company_id, v_inv_je_id, v_sales_disc_id, '4150', v_inv.date, v_inv.discount_amount, 0,
       'Sales Discount ' || v_inv.invoice_number, v_inv.contact_id, 'invoice', p_invoice_id);
  END IF;

  INSERT INTO public.general_ledger
    (company_id, journal_entry_id, account_id, account_code, date, debit, credit, description, contact_id, related_doc_type, related_doc_id)
  VALUES
    (v_company_id, v_inv_je_id, v_sales_id, '4100', v_inv.date, 0,
     CASE
       WHEN v_sales_disc_id IS NOT NULL AND v_inv.discount_amount > 0
       THEN v_inv.total_amount - v_inv.tax_amount - COALESCE(v_inv.round_off_amount, 0) + v_inv.discount_amount
       ELSE v_inv.total_amount - v_inv.tax_amount - COALESCE(v_inv.round_off_amount, 0)
     END,
     'Sales Invoice ' || v_inv.invoice_number, v_inv.contact_id, 'invoice', p_invoice_id);

  -- phase122 (Doc 3 Part K): an Indian company posts CGST + SGST (same
  -- state, or unknown) or IGST (other state / export), each line coded with
  -- its own account. Every other country keeps the branch below unchanged.
  IF v_inv.tax_amount > 0 AND (SELECT country_code FROM public.companies WHERE id = v_company_id) = 'IN' THEN
    INSERT INTO public.general_ledger
      (company_id, journal_entry_id, account_id, account_code, date, debit, credit,
       description, contact_id, related_doc_type, related_doc_id)
    SELECT v_company_id, v_inv_je_id, g.account_id, g.account_code, v_inv.date, 0, g.amount,
           'Output GST ' || v_inv.invoice_number, v_inv.contact_id, 'invoice', p_invoice_id
      FROM public._gst_split(v_company_id, COALESCE(NULLIF(v_inv.place_of_supply_code, ''), (SELECT place_of_supply_code FROM public.contacts WHERE id = v_inv.contact_id)), COALESCE(v_inv.is_export, false), v_inv.tax_amount, 'output') g;
  ELSIF v_inv.tax_amount > 0 AND v_vat_id IS NOT NULL THEN
    INSERT INTO public.general_ledger
      (company_id, journal_entry_id, account_id, account_code, date, debit, credit, description, contact_id, related_doc_type, related_doc_id)
    VALUES
      (v_company_id, v_inv_je_id, v_vat_id, '2200', v_inv.date, 0, v_inv.tax_amount,
       'Output VAT ' || v_inv.invoice_number, v_inv.contact_id, 'invoice', p_invoice_id);
  END IF;

  -- Phase 46 — round-off difference (Cr 5900 when rounded up, Dr when down).
  IF COALESCE(v_inv.round_off_amount, 0) <> 0 THEN
    v_round_off_acc := public.ensure_round_off_account(v_company_id);
    INSERT INTO public.general_ledger
      (company_id, journal_entry_id, account_id, account_code, date, debit, credit, description, contact_id, related_doc_type, related_doc_id)
    VALUES
      (v_company_id, v_inv_je_id, v_round_off_acc, '5900', v_inv.date,
       GREATEST(-v_inv.round_off_amount, 0), GREATEST(v_inv.round_off_amount, 0),
       'Round Off ' || v_inv.invoice_number, v_inv.contact_id, 'invoice', p_invoice_id);
  END IF;

  -- Per-item: stock_ledger + COGS (or defer). Phase 12.28 — skip for services.
  FOR v_item IN SELECT * FROM public.invoice_items WHERE invoice_id = p_invoice_id LOOP
    CONTINUE WHEN v_item.product_id IS NULL;

    -- Phase 12.28 — service items have no stock impact and no COGS.
    SELECT type INTO v_product_type FROM public.products WHERE id = v_item.product_id;
    CONTINUE WHEN v_product_type = 'service';

    -- phase155 — stock moves the base quantity (2 BOX of 12 = 24 PCS).
    v_item.quantity := COALESCE(v_item.base_quantity, v_item.quantity);

    SELECT COALESCE(running_avg_cost, 0)::NUMERIC(15,2) INTO v_current_mac
    FROM public.stock_ledger sl
    WHERE sl.company_id = v_company_id
      AND sl.product_id = v_item.product_id
      AND sl.reversal_of_id IS NULL
      AND NOT EXISTS (SELECT 1 FROM public.stock_ledger r WHERE r.reversal_of_id = sl.id)
    ORDER BY sl.seq DESC LIMIT 1;
    v_current_mac := COALESCE(v_current_mac, 0);

    -- phase154 — the exact cost of these goods (company-wide average).
    SELECT * INTO v_issue FROM public._stock_issue_cost(v_company_id, v_item.product_id, v_item.quantity, v_current_mac);
    v_current_mac := v_issue.unit_cost;

    UPDATE public.invoice_items
       SET cost_at_sale = v_issue.unit_cost,
           cost_total   = CASE WHEN v_issue.has_cost THEN v_issue.total_cost END
     WHERE id = v_item.id;

    SELECT COALESCE(running_qty, 0)::NUMERIC(15,3) INTO v_prev_running
    FROM public.stock_ledger sl
    WHERE sl.company_id = v_company_id
      AND sl.product_id = v_item.product_id
      AND sl.warehouse_id = v_wh_id
      AND sl.reversal_of_id IS NULL
      AND NOT EXISTS (SELECT 1 FROM public.stock_ledger r WHERE r.reversal_of_id = sl.id)
    ORDER BY sl.seq DESC LIMIT 1;
    v_prev_running := COALESCE(v_prev_running, 0);

    INSERT INTO public.stock_ledger
      (company_id, product_id, warehouse_id, date, type, direction, quantity, unit_cost, total_cost,
       running_qty, running_avg_cost, related_doc_type, related_doc_id)
    VALUES
      (v_company_id, v_item.product_id, v_wh_id, v_inv.date,
       'sale', -1, v_item.quantity, v_current_mac, v_issue.total_cost,
       v_prev_running - v_item.quantity, v_current_mac, 'invoice', p_invoice_id);

    IF v_issue.has_cost THEN
      v_total_cogs := v_total_cogs + v_issue.total_cost;
    ELSE
      INSERT INTO public.deferred_cogs_queue
        (company_id, product_id, invoice_item_id, sale_invoice_id,
         sale_date, warehouse_id, quantity, status)
      VALUES
        (v_company_id, v_item.product_id, v_item.id, p_invoice_id,
         v_inv.date, v_wh_id, v_item.quantity, 'pending');
    END IF;
  END LOOP;

  IF v_total_cogs > 0 THEN
    INSERT INTO public.document_sequences (company_id, prefix, current_value, format, pad_zeros, reset_yearly)
    VALUES (v_company_id, 'JE', 1001, 'JE-{NUMBER}', 0, false)
    ON CONFLICT (company_id, prefix) DO UPDATE
      SET current_value = public.document_sequences.current_value + 1, updated_at = NOW()
    RETURNING current_value INTO v_seq;
    v_cogs_entry := 'JE-' || v_seq::TEXT;

    INSERT INTO public.journal_entries (
      company_id, entry_number, date, description,
      source_type, source_id, currency, exchange_rate,
      total_debit, total_credit, created_by
    ) VALUES (
      v_company_id, v_cogs_entry, v_inv.date,
      'COGS – Invoice ' || v_inv.invoice_number,
      'inventory_cogs', p_invoice_id, v_inv.currency, v_inv.exchange_rate,
      v_total_cogs, v_total_cogs, v_user_id
    ) RETURNING id INTO v_cogs_je_id;

    INSERT INTO public.general_ledger
      (company_id, journal_entry_id, account_id, account_code, date, debit, credit, description, related_doc_type, related_doc_id)
    VALUES
      (v_company_id, v_cogs_je_id, v_cogs_id, '5100', v_inv.date, v_total_cogs, 0,
       'COGS ' || v_inv.invoice_number, 'invoice', p_invoice_id),
      (v_company_id, v_cogs_je_id, v_inv_acc_id, '1300', v_inv.date, 0, v_total_cogs,
       'COGS ' || v_inv.invoice_number, 'invoice', p_invoice_id);
  END IF;

  UPDATE public.invoices SET status = 'confirmed', updated_at = NOW() WHERE id = p_invoice_id;

  BEGIN
    INSERT INTO public.audit_logs (company_id, user_id, action, entity_type, entity_id, new_data)
    VALUES (v_company_id, v_user_id, 'confirm', 'invoice', p_invoice_id,
      jsonb_build_object('invoice_number', v_inv.invoice_number, 'je', v_inv_entry, 'phase', '12.28'));
  EXCEPTION WHEN OTHERS THEN NULL;
  END;

  RETURN jsonb_build_object(
    'invoice_id', p_invoice_id, 'invoice_number', v_inv.invoice_number,
    'je_id', v_inv_je_id, 'entry_number', v_inv_entry
  );
END;
$function$;

-- ── edit_invoice
CREATE OR REPLACE FUNCTION public.edit_invoice(p_invoice_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
-- Cumulative phase tags (preserved so the regression suite's per-phase
-- markers still resolve): Phase 12.20, Phase 12.21, Phase 12.22, Phase 12.27, Phase 12.28
DECLARE
  v_user_id     UUID := auth.uid();
  v_company_id  UUID;
  v_inv         public.invoices%ROWTYPE;
  v_item        public.invoice_items%ROWTYPE;
  v_product_type TEXT;
  v_lock_date   DATE;
  v_je          public.journal_entries%ROWTYPE;
  v_gl          public.general_ledger%ROWTYPE;
  v_sl          public.stock_ledger%ROWTYPE;
  v_rev_id      UUID;
  v_rev_entry   TEXT;
  v_inv_je_id   UUID;
  v_cogs_je_id  UUID;
  v_inv_entry   TEXT;
  v_cogs_entry  TEXT;
  v_seq         BIGINT;
  v_ar_id       UUID;
  v_sales_id    UUID;
  v_sales_disc_id UUID;
  v_vat_id      UUID;
  v_cogs_id     UUID;
  v_inv_acc_id  UUID;
  v_current_mac   NUMERIC(15,2);
  v_total_cogs    NUMERIC(15,2) := 0;
  v_issue         RECORD;   -- phase154
  v_wh_id         UUID;
  v_prev_running  NUMERIC(15,3);
  v_je_total      NUMERIC(15,2);
  v_round_off_acc UUID;
BEGIN
  SELECT company_id INTO v_company_id FROM public.profiles WHERE id = v_user_id;
  IF v_company_id IS NULL THEN RAISE EXCEPTION 'edit_invoice: no company for user'; END IF;

  SELECT * INTO v_inv FROM public.invoices WHERE id = p_invoice_id AND company_id = v_company_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'edit_invoice: invoice % not found', p_invoice_id; END IF;
  IF v_inv.status <> 'confirmed' THEN
    RAISE EXCEPTION 'edit_invoice: invoice % must be confirmed (status=%)', p_invoice_id, v_inv.status;
  END IF;

  SELECT period_lock_date INTO v_lock_date FROM public.companies WHERE id = v_company_id;
  IF v_lock_date IS NOT NULL AND v_inv.date <= v_lock_date THEN
    RAISE EXCEPTION 'edit_invoice: voucher date % on or before period lock %', v_inv.date, v_lock_date;
  END IF;

  -- Step 1 — Reverse existing sales + cogs JEs (Phase 12.21).
  FOR v_je IN
    SELECT * FROM public.journal_entries
    WHERE company_id = v_company_id
      AND source_id = p_invoice_id
      AND reversed_by_id IS NULL
      AND reversal_of_id IS NULL
      AND source_type IN ('sales_invoice','inventory_cogs')
  LOOP
    INSERT INTO public.document_sequences (company_id, prefix, current_value, format, pad_zeros, reset_yearly)
    VALUES (v_company_id, 'JE', 1001, 'JE-{NUMBER}', 0, false)
    ON CONFLICT (company_id, prefix) DO UPDATE
      SET current_value = public.document_sequences.current_value + 1, updated_at = NOW()
    RETURNING current_value INTO v_seq;
    v_rev_entry := 'JE-' || v_seq::TEXT;
    IF v_lock_date IS NOT NULL AND v_je.date <= v_lock_date THEN
      RAISE EXCEPTION 'Cannot reverse: the original posting dated % is in a locked period (lock %).', v_je.date, v_lock_date;
    END IF;

    INSERT INTO public.journal_entries (
      company_id, entry_number, date, description,
      source_type, source_id, currency, exchange_rate,
      total_debit, total_credit, reversal_of_id, created_by
    ) VALUES (
      v_company_id, v_rev_entry, v_je.date,
      'Edit Reversal – ' || v_inv.invoice_number,
      v_je.source_type, p_invoice_id,
      v_je.currency, v_je.exchange_rate,
      v_je.total_credit, v_je.total_debit,
      v_je.id, v_user_id
    ) RETURNING id INTO v_rev_id;

    FOR v_gl IN SELECT * FROM public.general_ledger WHERE journal_entry_id = v_je.id LOOP
      INSERT INTO public.general_ledger (
        company_id, journal_entry_id, account_id, account_code, date,
        debit, credit, description,
        contact_id, related_doc_type, related_doc_id, reversal_of_id
      ) VALUES (
        v_company_id, v_rev_id, v_gl.account_id, v_gl.account_code, v_gl.date,
        v_gl.credit, v_gl.debit,
        'Edit Reversal – ' || v_inv.invoice_number,
        v_gl.contact_id, v_gl.related_doc_type, v_gl.related_doc_id, v_gl.id
      );
    END LOOP;

    UPDATE public.journal_entries SET reversed_by_id = v_rev_id WHERE id = v_je.id;
  END LOOP;

  -- Step 2 — Reverse stock_ledger rows (Phase 12.21).
  FOR v_sl IN
    SELECT sl.* FROM public.stock_ledger sl
    WHERE sl.company_id = v_company_id
      AND sl.related_doc_id = p_invoice_id
      AND sl.related_doc_type = 'invoice'
      AND sl.reversal_of_id IS NULL
      AND NOT EXISTS (SELECT 1 FROM public.stock_ledger r WHERE r.reversal_of_id = sl.id)
  LOOP
    SELECT COALESCE(running_qty, 0)::NUMERIC(15,3) INTO v_prev_running
    FROM public.stock_ledger
    WHERE company_id = v_company_id AND product_id = v_sl.product_id AND warehouse_id = v_sl.warehouse_id
    ORDER BY seq DESC LIMIT 1;

    INSERT INTO public.stock_ledger (
      company_id, product_id, warehouse_id, date,
      type, direction, quantity, unit_cost, total_cost,
      running_qty, running_avg_cost,
      related_doc_type, related_doc_id, reversal_of_id
    ) VALUES (
      v_company_id, v_sl.product_id, v_sl.warehouse_id, v_sl.date,
      'edit_reversal', -v_sl.direction, v_sl.quantity, v_sl.unit_cost, v_sl.total_cost,
      v_prev_running + v_sl.quantity * (-v_sl.direction),
      v_sl.running_avg_cost,
      'invoice', p_invoice_id, v_sl.id
    );
  END LOOP;

  -- Step 3 — Repost (Phase 12.22 gross method + Phase 12.27 defer + Phase 12.28 service).
  v_wh_id := v_inv.warehouse_id;
  IF v_wh_id IS NULL THEN
    SELECT id INTO v_wh_id FROM public.warehouses WHERE company_id = v_company_id AND is_default LIMIT 1;
  END IF;

  SELECT id INTO v_ar_id          FROM public.chart_of_accounts WHERE company_id = v_company_id AND code = '1200' AND is_active;
  SELECT id INTO v_sales_id       FROM public.chart_of_accounts WHERE company_id = v_company_id AND code = '4100' AND is_active;
  SELECT id INTO v_sales_disc_id  FROM public.chart_of_accounts WHERE company_id = v_company_id AND code = '4150' AND is_active;
  SELECT id INTO v_cogs_id        FROM public.chart_of_accounts WHERE company_id = v_company_id AND code = '5100' AND is_active;
  SELECT id INTO v_inv_acc_id     FROM public.chart_of_accounts WHERE company_id = v_company_id AND code = '1300' AND is_active;

  SELECT * INTO v_inv FROM public.invoices WHERE id = p_invoice_id;

  IF v_inv.tax_amount > 0 THEN
    SELECT id INTO v_vat_id FROM public.chart_of_accounts
    WHERE company_id = v_company_id AND code LIKE '22%' AND is_active ORDER BY code LIMIT 1;
  END IF;

  IF v_sales_disc_id IS NOT NULL AND v_inv.discount_amount > 0 THEN
    v_je_total := v_inv.total_amount + v_inv.discount_amount + GREATEST(-COALESCE(v_inv.round_off_amount, 0), 0);
  ELSE
    v_je_total := v_inv.total_amount + GREATEST(-COALESCE(v_inv.round_off_amount, 0), 0);
  END IF;

  INSERT INTO public.document_sequences (company_id, prefix, current_value, format, pad_zeros, reset_yearly)
  VALUES (v_company_id, 'JE', 1001, 'JE-{NUMBER}', 0, false)
  ON CONFLICT (company_id, prefix) DO UPDATE
    SET current_value = public.document_sequences.current_value + 1, updated_at = NOW()
  RETURNING current_value INTO v_seq;
  v_inv_entry := 'JE-' || v_seq::TEXT;

  INSERT INTO public.journal_entries (
    company_id, entry_number, date, description,
    source_type, source_id, currency, exchange_rate,
    total_debit, total_credit, created_by
  ) VALUES (
    v_company_id, v_inv_entry, v_inv.date,
    'Sales Invoice (Edited) ' || v_inv.invoice_number,
    'sales_invoice', p_invoice_id, v_inv.currency, v_inv.exchange_rate,
    v_je_total, v_je_total, v_user_id
  ) RETURNING id INTO v_inv_je_id;

  INSERT INTO public.general_ledger
    (company_id, journal_entry_id, account_id, account_code, date, debit, credit, description, contact_id, related_doc_type, related_doc_id)
  VALUES
    (v_company_id, v_inv_je_id, v_ar_id, '1200', v_inv.date, v_inv.total_amount, 0,
     'Invoice (Edited) ' || v_inv.invoice_number, v_inv.contact_id, 'invoice', p_invoice_id);

  IF v_sales_disc_id IS NOT NULL AND v_inv.discount_amount > 0 THEN
    INSERT INTO public.general_ledger
      (company_id, journal_entry_id, account_id, account_code, date, debit, credit, description, contact_id, related_doc_type, related_doc_id)
    VALUES
      (v_company_id, v_inv_je_id, v_sales_disc_id, '4150', v_inv.date, v_inv.discount_amount, 0,
       'Sales Discount (Edited) ' || v_inv.invoice_number, v_inv.contact_id, 'invoice', p_invoice_id);
  END IF;

  INSERT INTO public.general_ledger
    (company_id, journal_entry_id, account_id, account_code, date, debit, credit, description, contact_id, related_doc_type, related_doc_id)
  VALUES
    (v_company_id, v_inv_je_id, v_sales_id, '4100', v_inv.date, 0,
     CASE
       WHEN v_sales_disc_id IS NOT NULL AND v_inv.discount_amount > 0
       THEN v_inv.total_amount - v_inv.tax_amount - COALESCE(v_inv.round_off_amount, 0) + v_inv.discount_amount
       ELSE v_inv.total_amount - v_inv.tax_amount - COALESCE(v_inv.round_off_amount, 0)
     END,
     'Invoice (Edited) ' || v_inv.invoice_number, v_inv.contact_id, 'invoice', p_invoice_id);

  -- phase122 (Doc 3 Part K): an Indian company posts CGST + SGST (same
  -- state, or unknown) or IGST (other state / export), each line coded with
  -- its own account. Every other country keeps the branch below unchanged.
  IF v_inv.tax_amount > 0 AND (SELECT country_code FROM public.companies WHERE id = v_company_id) = 'IN' THEN
    INSERT INTO public.general_ledger
      (company_id, journal_entry_id, account_id, account_code, date, debit, credit,
       description, contact_id, related_doc_type, related_doc_id)
    SELECT v_company_id, v_inv_je_id, g.account_id, g.account_code, v_inv.date, 0, g.amount,
           'Output GST (Edited) ' || v_inv.invoice_number, v_inv.contact_id, 'invoice', p_invoice_id
      FROM public._gst_split(v_company_id, COALESCE(NULLIF(v_inv.place_of_supply_code, ''), (SELECT place_of_supply_code FROM public.contacts WHERE id = v_inv.contact_id)), COALESCE(v_inv.is_export, false), v_inv.tax_amount, 'output') g;
  ELSIF v_inv.tax_amount > 0 AND v_vat_id IS NOT NULL THEN
    INSERT INTO public.general_ledger
      (company_id, journal_entry_id, account_id, account_code, date, debit, credit, description, contact_id, related_doc_type, related_doc_id)
    VALUES
      (v_company_id, v_inv_je_id, v_vat_id, '2200', v_inv.date, 0, v_inv.tax_amount,
       'Output VAT (Edited) ' || v_inv.invoice_number, v_inv.contact_id, 'invoice', p_invoice_id);
  END IF;

  -- Phase 46 — round-off difference (Cr 5900 when rounded up, Dr when down).
  IF COALESCE(v_inv.round_off_amount, 0) <> 0 THEN
    v_round_off_acc := public.ensure_round_off_account(v_company_id);
    INSERT INTO public.general_ledger
      (company_id, journal_entry_id, account_id, account_code, date, debit, credit, description, contact_id, related_doc_type, related_doc_id)
    VALUES
      (v_company_id, v_inv_je_id, v_round_off_acc, '5900', v_inv.date,
       GREATEST(-v_inv.round_off_amount, 0), GREATEST(v_inv.round_off_amount, 0),
       'Round Off ' || v_inv.invoice_number, v_inv.contact_id, 'invoice', p_invoice_id);
  END IF;

  -- Per-item: stock + COGS, with Phase 12.28 service bypass.
  FOR v_item IN SELECT * FROM public.invoice_items WHERE invoice_id = p_invoice_id LOOP
    CONTINUE WHEN v_item.product_id IS NULL;
    SELECT type INTO v_product_type FROM public.products WHERE id = v_item.product_id;
    CONTINUE WHEN v_product_type = 'service';

    -- phase155 — stock moves the base quantity (2 BOX of 12 = 24 PCS).
    v_item.quantity := COALESCE(v_item.base_quantity, v_item.quantity);

    SELECT COALESCE(running_avg_cost, 0)::NUMERIC(15,2) INTO v_current_mac
    FROM public.stock_ledger sl
    WHERE sl.company_id = v_company_id AND sl.product_id = v_item.product_id
      AND sl.reversal_of_id IS NULL
      AND NOT EXISTS (SELECT 1 FROM public.stock_ledger r WHERE r.reversal_of_id = sl.id)
    ORDER BY sl.seq DESC LIMIT 1;
    v_current_mac := COALESCE(v_current_mac, 0);

    -- phase154 — the exact cost of these goods (company-wide average).
    SELECT * INTO v_issue FROM public._stock_issue_cost(v_company_id, v_item.product_id, v_item.quantity, v_current_mac);
    v_current_mac := v_issue.unit_cost;

    UPDATE public.invoice_items
       SET cost_at_sale = v_issue.unit_cost,
           cost_total   = CASE WHEN v_issue.has_cost THEN v_issue.total_cost END
     WHERE id = v_item.id;

    SELECT COALESCE(running_qty, 0)::NUMERIC(15,3) INTO v_prev_running
    FROM public.stock_ledger sl
    WHERE sl.company_id = v_company_id AND sl.product_id = v_item.product_id
      AND sl.warehouse_id = v_wh_id
      AND sl.reversal_of_id IS NULL
      AND NOT EXISTS (SELECT 1 FROM public.stock_ledger r WHERE r.reversal_of_id = sl.id)
    ORDER BY sl.seq DESC LIMIT 1;
    v_prev_running := COALESCE(v_prev_running, 0);

    INSERT INTO public.stock_ledger
      (company_id, product_id, warehouse_id, date, type, direction, quantity, unit_cost, total_cost,
       running_qty, running_avg_cost, related_doc_type, related_doc_id)
    VALUES
      (v_company_id, v_item.product_id, v_wh_id, v_inv.date,
       'sale', -1, v_item.quantity, v_current_mac, v_issue.total_cost,
       v_prev_running - v_item.quantity, v_current_mac, 'invoice', p_invoice_id);

    IF v_issue.has_cost THEN
      v_total_cogs := v_total_cogs + v_issue.total_cost;
    ELSE
      INSERT INTO public.deferred_cogs_queue
        (company_id, product_id, invoice_item_id, sale_invoice_id,
         sale_date, warehouse_id, quantity, status)
      VALUES
        (v_company_id, v_item.product_id, v_item.id, p_invoice_id,
         v_inv.date, v_wh_id, v_item.quantity, 'pending');
    END IF;
  END LOOP;

  IF v_total_cogs > 0 THEN
    INSERT INTO public.document_sequences (company_id, prefix, current_value, format, pad_zeros, reset_yearly)
    VALUES (v_company_id, 'JE', 1001, 'JE-{NUMBER}', 0, false)
    ON CONFLICT (company_id, prefix) DO UPDATE
      SET current_value = public.document_sequences.current_value + 1, updated_at = NOW()
    RETURNING current_value INTO v_seq;
    v_cogs_entry := 'JE-' || v_seq::TEXT;

    INSERT INTO public.journal_entries (
      company_id, entry_number, date, description, source_type, source_id,
      currency, exchange_rate, total_debit, total_credit, created_by
    ) VALUES (
      v_company_id, v_cogs_entry, v_inv.date,
      'COGS (Edited) – ' || v_inv.invoice_number,
      'inventory_cogs', p_invoice_id, v_inv.currency, v_inv.exchange_rate,
      v_total_cogs, v_total_cogs, v_user_id
    ) RETURNING id INTO v_cogs_je_id;

    INSERT INTO public.general_ledger
      (company_id, journal_entry_id, account_id, account_code, date, debit, credit, description, related_doc_type, related_doc_id)
    VALUES
      (v_company_id, v_cogs_je_id, v_cogs_id, '5100', v_inv.date, v_total_cogs, 0,
       'COGS (Edited) ' || v_inv.invoice_number, 'invoice', p_invoice_id),
      (v_company_id, v_cogs_je_id, v_inv_acc_id, '1300', v_inv.date, 0, v_total_cogs,
       'COGS (Edited) ' || v_inv.invoice_number, 'invoice', p_invoice_id);
  END IF;

  BEGIN
    INSERT INTO public.audit_logs (company_id, user_id, action, entity_type, entity_id, new_data)
    VALUES (v_company_id, v_user_id, 'edit', 'invoice', p_invoice_id,
      jsonb_build_object('invoice_number', v_inv.invoice_number, 'je', v_inv_entry, 'phase', '12.28'));
  EXCEPTION WHEN OTHERS THEN NULL;
  END;

  RETURN jsonb_build_object(
    'invoice_id', p_invoice_id, 'invoice_number', v_inv.invoice_number,
    'je_id', v_inv_je_id, 'entry_number', v_inv_entry
  );
END;
$function$;

-- ── confirm_pos_sale
CREATE OR REPLACE FUNCTION public.confirm_pos_sale(p_session_id uuid, p_items jsonb, p_payment_method text, p_customer_id uuid DEFAULT NULL::uuid, p_notes text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_user_id       UUID := auth.uid();
  v_company_id    UUID;
  v_currency      TEXT;
  v_session       public.pos_sessions%ROWTYPE;
  v_lock_date     DATE;
  v_today         DATE := CURRENT_DATE;

  v_subtotal      NUMERIC(15,2) := 0;
  v_discount      NUMERIC(15,2) := 0;
  v_tax_total     NUMERIC(15,2) := 0;
  v_grand_total   NUMERIC(15,2) := 0;

  v_elem          JSONB;
  v_product_id    UUID;
  v_product_type  TEXT;          -- Phase 36
  v_item_qty      NUMERIC(15,3);
  v_item_price    NUMERIC(15,2);
  v_item_disc_pct NUMERIC(7,2);
  v_item_disc_amt NUMERIC(15,2);
  v_item_tax_rate NUMERIC(7,2);
  v_item_sub      NUMERIC(15,2);
  v_item_tax      NUMERIC(15,2);
  v_item_total    NUMERIC(15,2);
  v_item_id       UUID;
  v_sort          INT := 0;

  v_seq           BIGINT;
  v_inv_number    TEXT;
  v_inv_id        UUID;
  v_je_id         UUID;
  v_cogs_je_id    UUID;
  v_entry         TEXT;
  v_cogs_entry    TEXT;

  v_debit_id      UUID;
  v_debit_code    TEXT;
  v_sales_id      UUID;
  v_vat_id        UUID;
  v_cogs_id       UUID;
  v_inv_acc_id    UUID;

  v_current_mac   NUMERIC(15,2);
  v_prev_running  NUMERIC(15,3);
  v_total_cogs    NUMERIC(15,2) := 0;
  v_issue         RECORD;   -- phase154
  v_unit_id       UUID;     -- phase155
  v_base_qty      NUMERIC;  -- phase155
  v_round_off_acc UUID;
  v_round_step NUMERIC(6,2) := 0;
  v_round_off NUMERIC(15,2) := 0;
BEGIN
  SELECT company_id INTO v_company_id FROM public.profiles WHERE id = v_user_id;
  IF v_company_id IS NULL THEN
    RAISE EXCEPTION 'confirm_pos_sale: no company for user %', v_user_id;
  END IF;

  SELECT base_currency INTO v_currency FROM public.companies WHERE id = v_company_id;

  SELECT * INTO v_session
  FROM public.pos_sessions
  WHERE id = p_session_id AND company_id = v_company_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'confirm_pos_sale: session % not found', p_session_id;
  END IF;
  IF v_session.status <> 'open' THEN
    RAISE EXCEPTION 'confirm_pos_sale: session % is not open', p_session_id;
  END IF;

  SELECT period_lock_date INTO v_lock_date FROM public.companies WHERE id = v_company_id;
  IF v_lock_date IS NOT NULL AND v_today <= v_lock_date THEN
    RAISE EXCEPTION 'confirm_pos_sale: today is in locked period (lock=%)', v_lock_date;
  END IF;

  CASE p_payment_method
    WHEN 'cash'   THEN v_debit_code := '1100';
    WHEN 'card'   THEN v_debit_code := '1110';
    WHEN 'credit' THEN
      v_debit_code := '1200';
      IF p_customer_id IS NULL THEN
        RAISE EXCEPTION 'confirm_pos_sale: customer_id required for credit sale';
      END IF;
    ELSE
      RAISE EXCEPTION 'confirm_pos_sale: unknown payment method %', p_payment_method;
  END CASE;

  SELECT id INTO v_debit_id    FROM public.chart_of_accounts WHERE company_id = v_company_id AND code = v_debit_code AND is_active LIMIT 1;
  SELECT id INTO v_sales_id    FROM public.chart_of_accounts WHERE company_id = v_company_id AND code = '4100'       AND is_active LIMIT 1;
  SELECT id INTO v_cogs_id     FROM public.chart_of_accounts WHERE company_id = v_company_id AND code = '5100'       AND is_active LIMIT 1;
  SELECT id INTO v_inv_acc_id  FROM public.chart_of_accounts WHERE company_id = v_company_id AND code = '1300'       AND is_active LIMIT 1;
  SELECT id INTO v_vat_id      FROM public.chart_of_accounts WHERE company_id = v_company_id AND code LIKE '22%'     AND is_active ORDER BY code LIMIT 1;

  FOR v_elem IN SELECT * FROM jsonb_array_elements(p_items) LOOP
    v_item_qty      := (v_elem->>'quantity')::NUMERIC;
    v_item_price    := (v_elem->>'unit_price')::NUMERIC;
    v_item_disc_pct := COALESCE((v_elem->>'discount_percent')::NUMERIC, 0);
    v_item_tax_rate := COALESCE((v_elem->>'tax_rate')::NUMERIC, 0);
    v_item_sub      := ROUND(v_item_qty * v_item_price, 2);
    v_item_disc_amt := ROUND(v_item_sub * v_item_disc_pct / 100, 2);
    v_item_tax      := ROUND((v_item_sub - v_item_disc_amt) * v_item_tax_rate / 100, 2);
    v_item_total    := (v_item_sub - v_item_disc_amt) + v_item_tax;
    v_subtotal      := v_subtotal + v_item_sub;
    v_discount      := v_discount + v_item_disc_amt;
    v_tax_total     := v_tax_total + v_item_tax;
    v_grand_total   := v_grand_total + v_item_total;
  END LOOP;

  INSERT INTO public.document_sequences
    (company_id, prefix, current_value, format, pad_zeros, reset_yearly)
  VALUES
    (v_company_id, 'INV', 1000, 'INV-{NUMBER}', 0, false)
  ON CONFLICT (company_id, prefix) DO UPDATE
    SET current_value = public.document_sequences.current_value + 1,
        updated_at    = NOW()
  RETURNING current_value INTO v_seq;
  v_inv_number := 'INV-' || v_seq::TEXT;

  -- Phase 46 — round the grand total per company setting.
  SELECT COALESCE(rounding_step, 0) INTO v_round_step FROM public.companies WHERE id = v_company_id;
  IF v_round_step > 0 THEN
    v_round_off   := ROUND(ROUND(v_grand_total / v_round_step) * v_round_step - v_grand_total, 2);
    v_grand_total := ROUND(v_grand_total + v_round_off, 2);
  END IF;

  INSERT INTO public.invoices (
    company_id, invoice_number, contact_id, warehouse_id,
    date, due_date, currency, exchange_rate,
    subtotal, discount_amount, tax_amount, total_amount, round_off_amount,
    status, sale_channel, pos_session_id, notes
  ) VALUES (
    v_company_id, v_inv_number, p_customer_id, v_session.warehouse_id,
    v_today, v_today, v_currency, 1.0,
    v_subtotal, v_discount, v_tax_total, v_grand_total, v_round_off,
    'confirmed',
    CASE p_payment_method
      WHEN 'cash'  THEN 'pos_cash'
      WHEN 'card'  THEN 'pos_card'
      ELSE              'pos_credit'
    END,
    p_session_id, p_notes
  ) RETURNING id INTO v_inv_id;

  FOR v_elem IN SELECT * FROM jsonb_array_elements(p_items) LOOP
    v_product_id    := (v_elem->>'product_id')::UUID;
    v_item_qty      := (v_elem->>'quantity')::NUMERIC;
    v_item_price    := (v_elem->>'unit_price')::NUMERIC;
    v_item_disc_pct := COALESCE((v_elem->>'discount_percent')::NUMERIC, 0);
    v_item_tax_rate := COALESCE((v_elem->>'tax_rate')::NUMERIC, 0);
    v_item_sub      := ROUND(v_item_qty * v_item_price, 2);
    v_item_disc_amt := ROUND(v_item_sub * v_item_disc_pct / 100, 2);
    v_item_tax      := ROUND((v_item_sub - v_item_disc_amt) * v_item_tax_rate / 100, 2);
    v_item_total    := (v_item_sub - v_item_disc_amt) + v_item_tax;
    v_sort          := v_sort + 1;

    -- Phase 36 — services carry no cost, no stock, no COGS.
    v_product_type := NULL;
    IF v_product_id IS NOT NULL THEN
      SELECT type INTO v_product_type FROM public.products WHERE id = v_product_id;
    END IF;

    SELECT COALESCE(running_avg_cost, 0)::NUMERIC(15,2)
    INTO v_current_mac
    FROM public.stock_ledger
    WHERE company_id = v_company_id AND product_id = v_product_id
    ORDER BY seq DESC LIMIT 1;
    v_current_mac := COALESCE(v_current_mac, 0);
    IF v_product_type = 'service' THEN v_current_mac := 0; END IF;   -- Phase 36

    -- phase155 — stock and cost move the base quantity; the line keeps what was
    -- sold. The line trigger checks the pack again and refuses a wrong one.
    v_unit_id  := NULLIF(v_elem->>'product_unit_id', '')::UUID;
    v_base_qty := v_item_qty;
    IF v_unit_id IS NOT NULL THEN
      SELECT v_item_qty * u.factor INTO v_base_qty FROM public.product_units u
       WHERE u.id = v_unit_id AND u.company_id = v_company_id AND u.product_id = v_product_id;
      IF v_base_qty IS NULL THEN RAISE EXCEPTION 'pack_invalid: this pack does not belong to the product.'; END IF;
    END IF;

    -- phase154 — the exact cost of these goods, company-wide (a service,
    -- or a line without a product, has no stock and so no cost).
    SELECT * INTO v_issue FROM public._stock_issue_cost(v_company_id, v_product_id, v_base_qty, v_current_mac);
    v_current_mac := v_issue.unit_cost;

    INSERT INTO public.invoice_items (
      invoice_id, product_id, description,
      quantity, unit_price,
      discount_percent, discount_amount,
      tax_rate, tax_amount,
      line_subtotal, line_total,
      cost_at_sale, cost_total, sort_order, product_unit_id
    ) VALUES (
      v_inv_id, v_product_id,
      COALESCE(v_elem->>'description', ''),
      v_item_qty, v_item_price,
      v_item_disc_pct, v_item_disc_amt,
      v_item_tax_rate, v_item_tax,
      v_item_sub - v_item_disc_amt, v_item_total,
      v_current_mac, CASE WHEN v_issue.has_cost THEN v_issue.total_cost END, v_sort, v_unit_id
    ) RETURNING id INTO v_item_id;

    -- Phase 36 — services: revenue only. No stock row, no COGS, no deferred queue.
    IF v_product_type IS DISTINCT FROM 'service' THEN
      IF v_issue.has_cost THEN
        v_total_cogs := v_total_cogs + v_issue.total_cost;

        SELECT COALESCE(running_qty, 0)::NUMERIC(15,3)
        INTO v_prev_running
        FROM public.stock_ledger
        WHERE company_id = v_company_id
          AND product_id = v_product_id
          AND warehouse_id = v_session.warehouse_id
        ORDER BY seq DESC LIMIT 1;
        v_prev_running := COALESCE(v_prev_running, 0);

        INSERT INTO public.stock_ledger (
          company_id, product_id, warehouse_id, date,
          type, direction, quantity, unit_cost, total_cost,
          running_qty, running_avg_cost,
          related_doc_type, related_doc_id
        ) VALUES (
          v_company_id, v_product_id, v_session.warehouse_id, v_today,
          'sale', -1, v_base_qty, v_current_mac, v_issue.total_cost,
          v_prev_running - v_base_qty, v_current_mac,
          'invoice', v_inv_id
        );
      ELSE
        INSERT INTO public.deferred_cogs_queue
          (company_id, product_id, invoice_item_id, sale_invoice_id,
           sale_date, warehouse_id, quantity, status)
        VALUES
          (v_company_id, v_product_id, v_item_id, v_inv_id,
           v_today, v_session.warehouse_id, v_base_qty, 'pending');
      END IF;
    END IF;
  END LOOP;

  INSERT INTO public.document_sequences
    (company_id, prefix, current_value, format, pad_zeros, reset_yearly)
  VALUES
    (v_company_id, 'JE', 1001, 'JE-{NUMBER}', 0, false)
  ON CONFLICT (company_id, prefix) DO UPDATE
    SET current_value = public.document_sequences.current_value + 1,
        updated_at    = NOW()
  RETURNING current_value INTO v_seq;
  v_entry := 'JE-' || v_seq::TEXT;

  INSERT INTO public.journal_entries (
    company_id, entry_number, date, description,
    source_type, source_id, currency, exchange_rate,
    total_debit, total_credit, created_by
  ) VALUES (
    v_company_id, v_entry, v_today,
    CASE p_payment_method
      WHEN 'cash'  THEN 'POS Cash '
      WHEN 'card'  THEN 'POS Card '
      ELSE              'POS Credit '
    END || v_inv_number,
    CASE p_payment_method
      WHEN 'cash'  THEN 'pos_cash_sale'
      WHEN 'card'  THEN 'pos_card_sale'
      ELSE              'sales_invoice'
    END,
    v_inv_id, v_currency, 1.0,
    v_grand_total + GREATEST(-v_round_off, 0), v_grand_total + GREATEST(-v_round_off, 0), v_user_id
  ) RETURNING id INTO v_je_id;

  INSERT INTO public.general_ledger (
    company_id, journal_entry_id, account_id, account_code, date,
    debit, credit, description, contact_id, related_doc_type, related_doc_id
  ) VALUES (
    v_company_id, v_je_id, v_debit_id, v_debit_code, v_today,
    v_grand_total, 0,
    v_inv_number, p_customer_id, 'invoice', v_inv_id
  );

  INSERT INTO public.general_ledger (
    company_id, journal_entry_id, account_id, account_code, date,
    debit, credit, description, contact_id, related_doc_type, related_doc_id
  ) VALUES (
    v_company_id, v_je_id, v_sales_id, '4100', v_today,
    0, v_subtotal - v_discount,
    v_inv_number, p_customer_id, 'invoice', v_inv_id
  );

  -- phase122 (Doc 3 Part K): an Indian company posts CGST + SGST (same
  -- state, or unknown) or IGST (other state / export), each line coded with
  -- its own account. Every other country keeps the branch below unchanged.
  IF v_tax_total > 0 AND (SELECT country_code FROM public.companies WHERE id = v_company_id) = 'IN' THEN
    INSERT INTO public.general_ledger
      (company_id, journal_entry_id, account_id, account_code, date, debit, credit,
       description, contact_id, related_doc_type, related_doc_id)
    SELECT v_company_id, v_je_id, g.account_id, g.account_code, v_today, 0, g.amount,
           'GST ' || v_inv_number, p_customer_id, 'invoice', v_inv_id
      FROM public._gst_split(v_company_id, (SELECT place_of_supply_code FROM public.contacts WHERE id = p_customer_id), false, v_tax_total, 'output') g;
  ELSIF v_tax_total > 0 AND v_vat_id IS NOT NULL THEN
    INSERT INTO public.general_ledger (
      company_id, journal_entry_id, account_id, account_code, date,
      debit, credit, description, contact_id, related_doc_type, related_doc_id
    ) VALUES (
      v_company_id, v_je_id, v_vat_id, '2200', v_today,
      0, v_tax_total,
      'VAT ' || v_inv_number, p_customer_id, 'invoice', v_inv_id
    );
  END IF;

  -- Phase 46 — round-off difference (Cr 5900 when rounded up, Dr when down).
  IF v_round_off <> 0 THEN
    v_round_off_acc := public.ensure_round_off_account(v_company_id);
    INSERT INTO public.general_ledger (
      company_id, journal_entry_id, account_id, account_code, date,
      debit, credit, description, contact_id, related_doc_type, related_doc_id
    ) VALUES (
      v_company_id, v_je_id, v_round_off_acc, '5900', v_today,
      GREATEST(-v_round_off, 0), GREATEST(v_round_off, 0),
      'Round Off ' || v_inv_number, p_customer_id, 'invoice', v_inv_id
    );
  END IF;

  IF v_total_cogs > 0 THEN
    INSERT INTO public.document_sequences
      (company_id, prefix, current_value, format, pad_zeros, reset_yearly)
    VALUES
      (v_company_id, 'JE', 1001, 'JE-{NUMBER}', 0, false)
    ON CONFLICT (company_id, prefix) DO UPDATE
      SET current_value = public.document_sequences.current_value + 1,
          updated_at    = NOW()
    RETURNING current_value INTO v_seq;
    v_cogs_entry := 'JE-' || v_seq::TEXT;

    INSERT INTO public.journal_entries (
      company_id, entry_number, date, description,
      source_type, source_id, currency, exchange_rate,
      total_debit, total_credit, created_by
    ) VALUES (
      v_company_id, v_cogs_entry, v_today,
      'COGS – ' || v_inv_number,
      'inventory_cogs', v_inv_id, v_currency, 1.0,
      v_total_cogs, v_total_cogs, v_user_id
    ) RETURNING id INTO v_cogs_je_id;

    INSERT INTO public.general_ledger (
      company_id, journal_entry_id, account_id, account_code, date,
      debit, credit, description, related_doc_type, related_doc_id
    ) VALUES (
      v_company_id, v_cogs_je_id, v_cogs_id, '5100', v_today,
      v_total_cogs, 0, 'COGS ' || v_inv_number, 'invoice', v_inv_id
    );

    INSERT INTO public.general_ledger (
      company_id, journal_entry_id, account_id, account_code, date,
      debit, credit, description, related_doc_type, related_doc_id
    ) VALUES (
      v_company_id, v_cogs_je_id, v_inv_acc_id, '1300', v_today,
      0, v_total_cogs, 'COGS ' || v_inv_number, 'invoice', v_inv_id
    );
  END IF;

  UPDATE public.pos_sessions SET
    total_sales_amount = COALESCE(total_sales_amount, 0) + v_grand_total,
    total_sales_count  = COALESCE(total_sales_count, 0) + 1,
    updated_at         = NOW()
  WHERE id = p_session_id;

  BEGIN
    INSERT INTO public.audit_logs (company_id, user_id, action, entity_type, entity_id, new_data)
    VALUES (v_company_id, v_user_id, 'confirm', 'pos_sale', v_inv_id,
      jsonb_build_object('invoice_number', v_inv_number, 'payment_method', p_payment_method,
                         'total', v_grand_total, 'session', p_session_id, 'phase', '36'));
  EXCEPTION WHEN OTHERS THEN NULL;
  END;

  RETURN jsonb_build_object(
    'invoice_id',     v_inv_id,
    'invoice_number', v_inv_number,
    'total_amount',   v_grand_total
  );
END;
$function$;

-- ── confirm_grn
CREATE OR REPLACE FUNCTION public.confirm_grn(p_grn_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_user_id        UUID := auth.uid();
  v_company_id     UUID;
  v_grn            public.goods_receipts%ROWTYPE;
  v_item           public.goods_receipt_items%ROWTYPE;
  v_lock_date      DATE;
  v_currency       TEXT;
  v_je_id          UUID;
  v_entry          TEXT;
  v_seq            BIGINT;
  v_inv_id         UUID;
  v_accrual_id     UUID;
  v_old_mac        NUMERIC(15,2);
  v_old_total_qty  NUMERIC(15,3);
  v_qty_for_mac    NUMERIC(15,3);
  v_new_mac        NUMERIC(15,2);
  v_prev_wh_qty    NUMERIC(15,3);
  v_total_cost     NUMERIC(15,2) := 0;
BEGIN
  SELECT company_id INTO v_company_id FROM public.profiles WHERE id = v_user_id;
  IF v_company_id IS NULL THEN
    RAISE EXCEPTION 'confirm_grn: no company for user %', v_user_id;
  END IF;

  SELECT * INTO v_grn FROM public.goods_receipts WHERE id = p_grn_id AND company_id = v_company_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'confirm_grn: GRN % not found', p_grn_id;
  END IF;
  IF v_grn.status <> 'draft' THEN
    RAISE EXCEPTION 'confirm_grn: GRN % not in draft (status=%)', p_grn_id, v_grn.status;
  END IF;

  SELECT period_lock_date INTO v_lock_date FROM public.companies WHERE id = v_company_id;
  IF v_lock_date IS NOT NULL AND v_grn.date <= v_lock_date THEN
    RAISE EXCEPTION 'confirm_grn: date % on or before period lock %', v_grn.date, v_lock_date;
  END IF;

  SELECT COALESCE(currency, 'AED') INTO v_currency FROM public.companies WHERE id = v_company_id;

  SELECT id INTO v_inv_id     FROM public.chart_of_accounts WHERE company_id = v_company_id AND code = '1300' AND is_active;
  SELECT id INTO v_accrual_id FROM public.chart_of_accounts WHERE company_id = v_company_id AND code = '2150' AND is_active;

  IF v_inv_id IS NULL THEN
    RAISE EXCEPTION 'confirm_grn: account 1300 not found';
  END IF;
  IF v_accrual_id IS NULL THEN
    RAISE EXCEPTION 'confirm_grn: account 2150 not found';
  END IF;

  FOR v_item IN SELECT * FROM public.goods_receipt_items WHERE grn_id = p_grn_id LOOP
    v_total_cost := v_total_cost + v_item.total_cost;

    -- phase155 — received in a pack: stock moves the base quantity, at the cost
    -- of one base unit. The value (total_cost) is the line's own.
    IF v_item.base_quantity IS NOT NULL THEN
      v_item.unit_cost    := ROUND(v_item.total_cost / NULLIF(v_item.base_quantity, 0), 2);
      v_item.qty_received := v_item.base_quantity;
    END IF;

    SELECT COALESCE(running_avg_cost, 0) INTO v_old_mac
    FROM public.stock_ledger
    WHERE company_id = v_company_id AND product_id = v_item.product_id
    ORDER BY seq DESC LIMIT 1;
    v_old_mac := COALESCE(v_old_mac, 0);

    SELECT COALESCE(SUM(latest_qty), 0) INTO v_old_total_qty
    FROM (
      SELECT DISTINCT ON (warehouse_id) running_qty AS latest_qty
      FROM public.stock_ledger
      WHERE company_id = v_company_id AND product_id = v_item.product_id
      ORDER BY warehouse_id, seq DESC
    ) sub;
    v_old_total_qty := COALESCE(v_old_total_qty, 0);

    -- Clamp to zero for MAC weighting — negative stock from a back-ordered
    -- sale shouldn't pollute the average cost we're about to record.
    v_qty_for_mac := GREATEST(v_old_total_qty, 0);

    IF v_qty_for_mac + v_item.qty_received > 0 THEN
      v_new_mac := ROUND(
        (v_old_mac * v_qty_for_mac + v_item.unit_cost * v_item.qty_received) /
        (v_qty_for_mac + v_item.qty_received),
        2
      );
    ELSE
      v_new_mac := v_item.unit_cost;
    END IF;

    SELECT COALESCE(running_qty, 0) INTO v_prev_wh_qty
    FROM public.stock_ledger
    WHERE company_id = v_company_id AND product_id = v_item.product_id
      AND warehouse_id = v_grn.warehouse_id
    ORDER BY seq DESC LIMIT 1;
    v_prev_wh_qty := COALESCE(v_prev_wh_qty, 0);

    INSERT INTO public.stock_ledger
      (company_id, product_id, warehouse_id, date,
       type, direction, quantity, unit_cost, total_cost,
       running_qty, running_avg_cost,
       related_doc_type, related_doc_id)
    VALUES
      (v_company_id, v_item.product_id, v_grn.warehouse_id, v_grn.date,
       'purchase', 1, v_item.qty_received, v_item.unit_cost, v_item.total_cost,
       v_prev_wh_qty + v_item.qty_received, v_new_mac,
       'goods_receipt', p_grn_id);
  END LOOP;

  IF v_total_cost = 0 THEN
    RAISE EXCEPTION 'confirm_grn: GRN % has no items or zero total cost', p_grn_id;
  END IF;

  INSERT INTO public.document_sequences (company_id, prefix, current_value, format, pad_zeros, reset_yearly)
  VALUES (v_company_id, 'JE', 1001, 'JE-{NUMBER}', 0, false)
  ON CONFLICT (company_id, prefix) DO UPDATE
    SET current_value = public.document_sequences.current_value + 1, updated_at = NOW()
  RETURNING current_value INTO v_seq;
  v_entry := 'JE-' || v_seq::TEXT;

  INSERT INTO public.journal_entries (
    company_id, entry_number, date, description,
    source_type, source_id, currency, exchange_rate,
    total_debit, total_credit, created_by
  ) VALUES (
    v_company_id, v_entry, v_grn.date,
    'Goods Receipt ' || v_grn.grn_number,
    'goods_receipt', p_grn_id,
    v_currency, 1.0,
    v_total_cost, v_total_cost,
    v_user_id
  ) RETURNING id INTO v_je_id;

  INSERT INTO public.general_ledger
    (company_id, journal_entry_id, account_id, account_code, date,
     debit, credit, description, contact_id, related_doc_type, related_doc_id)
  VALUES
    (v_company_id, v_je_id, v_inv_id, '1300', v_grn.date,
     v_total_cost, 0,
     'Goods Receipt ' || v_grn.grn_number,
     v_grn.supplier_id, 'goods_receipt', p_grn_id);

  INSERT INTO public.general_ledger
    (company_id, journal_entry_id, account_id, account_code, date,
     debit, credit, description, contact_id, related_doc_type, related_doc_id)
  VALUES
    (v_company_id, v_je_id, v_accrual_id, '2150', v_grn.date,
     0, v_total_cost,
     'Goods Receipt ' || v_grn.grn_number,
     v_grn.supplier_id, 'goods_receipt', p_grn_id);

  UPDATE public.goods_receipts SET status = 'received', updated_at = NOW() WHERE id = p_grn_id;

  IF v_grn.purchase_order_id IS NOT NULL THEN
    UPDATE public.purchase_orders
    SET status = 'received', updated_at = NOW()
    WHERE id = v_grn.purchase_order_id AND company_id = v_company_id
      AND status IN ('draft','sent','partially_received');
  END IF;

  BEGIN
    INSERT INTO public.audit_logs (company_id, user_id, action, entity_type, entity_id, new_data)
    VALUES (v_company_id, v_user_id, 'confirm', 'goods_receipt', p_grn_id,
      jsonb_build_object('grn_number', v_grn.grn_number, 'je', v_entry, 'total_cost', v_total_cost));
  EXCEPTION WHEN OTHERS THEN NULL;
  END;

  RETURN jsonb_build_object(
    'grn_id',       p_grn_id,
    'grn_number',   v_grn.grn_number,
    'je_id',        v_je_id,
    'entry_number', v_entry
  );
END;
$function$;

-- ── confirm_vendor_bill
CREATE OR REPLACE FUNCTION public.confirm_vendor_bill(p_bill_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_user_id      UUID := auth.uid();
  v_company_id   UUID;
  v_bill         public.vendor_bills%ROWTYPE;
  v_item         public.vendor_bill_items%ROWTYPE;
  v_lock_date    DATE;
  v_je_id        UUID;
  v_entry        TEXT;
  v_seq          BIGINT;
  v_ap_id        UUID;
  v_accrual_id   UUID;
  v_inv_id       UUID;
  v_vat_id       UUID;
  v_cogs_id      UUID;
  v_grn_total    NUMERIC(15,2) := 0;
  v_debit_2150   NUMERIC(15,2) := 0;
  v_variance     NUMERIC(15,2) := 0;
  v_bill_goods   NUMERIC(15,2);
  v_line_acct_id UUID;
  v_line_code    TEXT;
  v_line_class   TEXT;
  v_line_value   NUMERIC(15,2);
  v_eff_unit     NUMERIC(15,4);
  v_old_mac        NUMERIC(15,2);
  v_old_total_qty  NUMERIC(15,3);
  v_qty_for_mac    NUMERIC(15,3);
  v_new_mac        NUMERIC(15,2);
  v_prev_wh_qty    NUMERIC(15,3);
  v_default_wh_id  UUID;
  v_line_wh_id     UUID;
  v_product_total  NUMERIC(15,2) := 0;
  v_product_count  INTEGER := 0;
  v_landed_alloc   NUMERIC(15,2);
  v_landed_used    NUMERIC(15,2) := 0;
  v_is_last_prod   BOOLEAN;
  v_product_type   TEXT;    -- Phase 36
  v_svc_exp_id     UUID;    -- Phase 36 — fallback expense account for services
  v_def            public.deferred_cogs_queue%ROWTYPE;
  v_flush_mac      NUMERIC(15,2);
  v_flush_total    NUMERIC(15,2) := 0;
  v_flush_je_id    UUID;
  v_flush_entry    TEXT;
  v_round_off_acc UUID;
  v_lc      RECORD;   -- Phase 47 landed-cost line
  v_lc_code TEXT;
  v_arrived_qty  NUMERIC(15,3);           -- Phase 63
  v_arrived_cost NUMERIC(15,2);           -- Phase 63
  v_consumed     JSONB := '{}'::JSONB;    -- Phase 63 — receipt used per product
  v_used         NUMERIC(15,3);           -- Phase 63
  v_sale_row_id  UUID;                     -- Phase 64
  v_covered      NUMERIC(15,3);           -- Phase 115
BEGIN
  SELECT company_id INTO v_company_id FROM public.profiles WHERE id = v_user_id;
  IF v_company_id IS NULL THEN
    RAISE EXCEPTION 'confirm_vendor_bill: no company for user %', v_user_id;
  END IF;

  SELECT * INTO v_bill FROM public.vendor_bills WHERE id = p_bill_id AND company_id = v_company_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'confirm_vendor_bill: bill % not found', p_bill_id;
  END IF;
  IF v_bill.status <> 'draft' THEN
    RAISE EXCEPTION 'confirm_vendor_bill: bill % not in draft (status=%)', p_bill_id, v_bill.status;
  END IF;

  -- Phase 47 — landed cost is the SUM of the itemized landed-cost lines; the
  -- child table is authoritative and the column just mirrors it (no cached
  -- aggregate trusted at post time).
  SELECT COALESCE(SUM(amount), 0) INTO v_bill.landed_cost_total
  FROM public.vendor_bill_landed_costs WHERE bill_id = p_bill_id;

  IF v_bill.landed_cost_total > 0 AND v_bill.linked_grn_id IS NOT NULL THEN
    RAISE EXCEPTION
      'confirm_vendor_bill: landed_cost_total is not allowed on GRN-linked bills'
      USING ERRCODE = 'P0001';
  END IF;

  SELECT period_lock_date INTO v_lock_date FROM public.companies WHERE id = v_company_id;
  IF v_lock_date IS NOT NULL AND v_bill.date <= v_lock_date THEN
    RAISE EXCEPTION 'confirm_vendor_bill: date % on or before period lock %', v_bill.date, v_lock_date;
  END IF;

  SELECT id INTO v_ap_id      FROM public.chart_of_accounts WHERE company_id = v_company_id AND code = '2100' AND is_active;
  SELECT id INTO v_accrual_id FROM public.chart_of_accounts WHERE company_id = v_company_id AND code = '2150' AND is_active;
  SELECT id INTO v_inv_id     FROM public.chart_of_accounts WHERE company_id = v_company_id AND code = '1300' AND is_active;
  SELECT id INTO v_cogs_id    FROM public.chart_of_accounts WHERE company_id = v_company_id AND code = '5100' AND is_active;
  IF v_ap_id IS NULL THEN
    RAISE EXCEPTION 'confirm_vendor_bill: account 2100 AP not found';
  END IF;
  IF v_bill.tax_amount > 0 THEN
    SELECT id INTO v_vat_id FROM public.chart_of_accounts
    WHERE company_id = v_company_id AND code LIKE '15%' AND is_active
    ORDER BY code LIMIT 1;
  END IF;

  -- Phase 36 — fallback expense account for purchased services with no
  -- purchase account set on the product: first active direct-expense (5xxx).
  SELECT id INTO v_svc_exp_id FROM public.chart_of_accounts
  WHERE company_id = v_company_id AND type = 'expense' AND code LIKE '5%' AND is_active
  ORDER BY code LIMIT 1;

  SELECT id INTO v_default_wh_id FROM public.warehouses
  WHERE company_id = v_company_id AND is_default = TRUE AND is_active = TRUE LIMIT 1;
  IF v_default_wh_id IS NULL THEN
    SELECT id INTO v_default_wh_id FROM public.warehouses
    WHERE company_id = v_company_id AND is_active = TRUE
    ORDER BY created_at LIMIT 1;
  END IF;

  IF v_bill.landed_cost_total > 0 THEN
    -- Phase 36 — landed cost spreads over GOODS lines only (never services).
    SELECT COALESCE(SUM(vbi.line_total - vbi.tax_amount), 0), COUNT(*)
      INTO v_product_total, v_product_count
    FROM public.vendor_bill_items vbi
    JOIN public.products p ON p.id = vbi.product_id
    WHERE vbi.bill_id = p_bill_id
      AND vbi.product_id IS NOT NULL
      AND vbi.line_subtotal > 0
      AND p.type IS DISTINCT FROM 'service';
    IF v_product_count = 0 THEN
      RAISE EXCEPTION
        'confirm_vendor_bill: landed_cost_total > 0 requires at least one goods line'
        USING ERRCODE = 'P0001';
    END IF;
  END IF;

  INSERT INTO public.document_sequences (company_id, prefix, current_value, format, pad_zeros, reset_yearly)
  VALUES (v_company_id, 'JE', 1001, 'JE-{NUMBER}', 0, false)
  ON CONFLICT (company_id, prefix) DO UPDATE
    SET current_value = public.document_sequences.current_value + 1, updated_at = NOW()
  RETURNING current_value INTO v_seq;
  v_entry := 'JE-' || v_seq::TEXT;

  INSERT INTO public.journal_entries (
    company_id, entry_number, date, description,
    source_type, source_id, currency, exchange_rate,
    total_debit, total_credit, created_by
  ) VALUES (
    v_company_id, v_entry, v_bill.date,
    'Vendor Bill ' || v_bill.bill_number,
    'vendor_bill', p_bill_id,
    v_bill.currency, v_bill.exchange_rate,
    v_bill.total_amount + COALESCE(v_bill.landed_cost_total, 0) + GREATEST(-COALESCE(v_bill.round_off_amount, 0), 0),
    v_bill.total_amount + COALESCE(v_bill.landed_cost_total, 0) + GREATEST(-COALESCE(v_bill.round_off_amount, 0), 0),
    v_user_id
  ) RETURNING id INTO v_je_id;

  IF v_bill.linked_grn_id IS NOT NULL THEN
    SELECT COALESCE(SUM(total_cost), 0) INTO v_grn_total
    FROM public.goods_receipt_items WHERE grn_id = v_bill.linked_grn_id;

    v_bill_goods := v_bill.total_amount - v_bill.tax_amount - COALESCE(v_bill.round_off_amount, 0);
    v_debit_2150 := LEAST(v_grn_total, v_bill_goods);
    v_variance   := v_bill_goods - v_debit_2150;

    IF v_debit_2150 > 0 THEN
      INSERT INTO public.general_ledger
        (company_id, journal_entry_id, account_id, account_code, date,
         debit, credit, description, contact_id, related_doc_type, related_doc_id)
      VALUES
        (v_company_id, v_je_id, v_accrual_id, '2150', v_bill.date,
         v_debit_2150, 0, 'Vendor Bill ' || v_bill.bill_number,
         v_bill.supplier_id, 'vendor_bill', p_bill_id);
    END IF;
    IF v_variance > 0 THEN
      INSERT INTO public.general_ledger
        (company_id, journal_entry_id, account_id, account_code, date,
         debit, credit, description, contact_id, related_doc_type, related_doc_id)
      VALUES
        (v_company_id, v_je_id, v_inv_id, '1300', v_bill.date,
         v_variance, 0, 'Bill variance ' || v_bill.bill_number,
         v_bill.supplier_id, 'vendor_bill', p_bill_id);
    END IF;
    UPDATE public.goods_receipts SET status = 'billed', updated_at = NOW()
    WHERE id = v_bill.linked_grn_id AND company_id = v_company_id;

  ELSE
    FOR v_item IN
      SELECT * FROM public.vendor_bill_items
      WHERE bill_id = p_bill_id
      ORDER BY id
    LOOP
      v_line_value := v_item.line_total - v_item.tax_amount;
      IF v_line_value <= 0 THEN CONTINUE; END IF;

      -- Phase 36 — resolve the product's type once per line.
      v_product_type := NULL;
      IF v_item.product_id IS NOT NULL THEN
        SELECT type INTO v_product_type FROM public.products WHERE id = v_item.product_id;
      END IF;

      v_landed_alloc := 0;
      IF v_bill.landed_cost_total > 0
         AND v_item.product_id IS NOT NULL
         AND v_product_type IS DISTINCT FROM 'service'   -- Phase 36
         AND v_product_total > 0
      THEN
        SELECT (NOT EXISTS (
          SELECT 1 FROM public.vendor_bill_items vbi2
          JOIN public.products p2 ON p2.id = vbi2.product_id
          WHERE vbi2.bill_id = p_bill_id
            AND vbi2.product_id IS NOT NULL
            AND vbi2.line_subtotal > 0
            AND p2.type IS DISTINCT FROM 'service'       -- Phase 36
            AND vbi2.id > v_item.id
        )) INTO v_is_last_prod;
        IF v_is_last_prod THEN
          v_landed_alloc := v_bill.landed_cost_total - v_landed_used;
        ELSE
          v_landed_alloc := ROUND(
            (v_line_value / v_product_total) * v_bill.landed_cost_total, 2
          );
          v_landed_used := v_landed_used + v_landed_alloc;
        END IF;
      END IF;

      v_line_acct_id := NULL;
      IF v_item.product_id IS NOT NULL THEN
        SELECT purchase_account_id INTO v_line_acct_id FROM public.products WHERE id = v_item.product_id;
        IF v_line_acct_id IS NULL THEN
          -- Phase 36 — a purchased SERVICE is an expense, never inventory.
          IF v_product_type = 'service' THEN
            v_line_acct_id := COALESCE(v_svc_exp_id, v_cogs_id);
            IF v_line_acct_id IS NULL THEN
              RAISE EXCEPTION 'confirm_vendor_bill: no expense account found for service line — set a purchase account on the product';
            END IF;
          ELSE
            v_line_acct_id := v_inv_id;
          END IF;
        END IF;
      ELSIF v_item.coa_account_id IS NOT NULL THEN
        v_line_acct_id := v_item.coa_account_id;
      ELSE
        v_line_acct_id := v_inv_id;
      END IF;

      SELECT type, code INTO v_line_class, v_line_code
      FROM public.chart_of_accounts WHERE id = v_line_acct_id;

      INSERT INTO public.general_ledger
        (company_id, journal_entry_id, account_id, account_code, date,
         debit, credit, description, contact_id, related_doc_type, related_doc_id)
      VALUES
        (v_company_id, v_je_id, v_line_acct_id, v_line_code, v_bill.date,
         v_line_value + v_landed_alloc, 0,
         COALESCE(v_item.description, 'Vendor Bill ' || v_bill.bill_number),
         v_bill.supplier_id, 'vendor_bill', p_bill_id);

      IF v_item.product_id IS NOT NULL
         AND v_product_type IS DISTINCT FROM 'service'   -- Phase 36: services never stock
         AND v_line_class = 'asset'
         AND v_item.quantity > 0
         AND v_line_value > 0
      THEN
        -- phase155 — stock moves the base quantity (2 BOX of 12 = 24 PCS).
        v_item.quantity := COALESCE(v_item.base_quantity, v_item.quantity);
        v_eff_unit := ROUND((v_line_value + v_landed_alloc) / v_item.quantity, 4);
        v_line_wh_id := COALESCE(v_item.warehouse_id, v_default_wh_id);
        IF v_line_wh_id IS NULL THEN
          RAISE EXCEPTION 'confirm_vendor_bill: no warehouse and no default';
        END IF;

        SELECT COALESCE(running_avg_cost, 0)::NUMERIC(15,2) INTO v_old_mac
        FROM public.stock_ledger sl
        WHERE sl.company_id = v_company_id
          AND sl.product_id = v_item.product_id
          AND sl.reversal_of_id IS NULL
          AND NOT EXISTS (
            SELECT 1 FROM public.stock_ledger r WHERE r.reversal_of_id = sl.id
          )
        ORDER BY sl.seq DESC
        LIMIT 1;
        v_old_mac := COALESCE(v_old_mac, 0);

        SELECT COALESCE(SUM(latest_qty), 0) INTO v_old_total_qty
        FROM (
          SELECT DISTINCT ON (sl.warehouse_id) sl.running_qty AS latest_qty
          FROM public.stock_ledger sl
          WHERE sl.company_id = v_company_id
            AND sl.product_id = v_item.product_id
            AND sl.reversal_of_id IS NULL
            AND NOT EXISTS (
              SELECT 1 FROM public.stock_ledger r WHERE r.reversal_of_id = sl.id
            )
          ORDER BY sl.warehouse_id, sl.seq DESC
        ) sub;
        v_old_total_qty := COALESCE(v_old_total_qty, 0);

        v_qty_for_mac := GREATEST(v_old_total_qty, 0);

        IF v_qty_for_mac + v_item.quantity > 0 THEN
          v_new_mac := ROUND(
            (v_old_mac * v_qty_for_mac + v_eff_unit * v_item.quantity)
            / (v_qty_for_mac + v_item.quantity), 2
          );
        ELSE
          v_new_mac := ROUND(v_eff_unit, 2);
        END IF;

        SELECT COALESCE(running_qty, 0)::NUMERIC(15,3) INTO v_prev_wh_qty
        FROM public.stock_ledger sl
        WHERE sl.company_id = v_company_id
          AND sl.product_id = v_item.product_id
          AND sl.warehouse_id = v_line_wh_id
          AND sl.reversal_of_id IS NULL
          AND NOT EXISTS (
            SELECT 1 FROM public.stock_ledger r WHERE r.reversal_of_id = sl.id
          )
        ORDER BY sl.seq DESC
        LIMIT 1;
        v_prev_wh_qty := COALESCE(v_prev_wh_qty, 0);

        INSERT INTO public.stock_ledger
          (company_id, product_id, warehouse_id, date,
           type, direction, quantity, unit_cost, total_cost,
           running_qty, running_avg_cost,
           related_doc_type, related_doc_id)
        VALUES
          (v_company_id, v_item.product_id, v_line_wh_id, v_bill.date,
           'purchase', 1, v_item.quantity, v_eff_unit, v_line_value + v_landed_alloc,
           v_prev_wh_qty + v_item.quantity, v_new_mac,
           'vendor_bill', p_bill_id);
      END IF;
    END LOOP;
  END IF;

  -- phase122 (Doc 3 Part K): an Indian company posts CGST + SGST (same
  -- state, or unknown) or IGST (other state / export), each line coded with
  -- its own account. Every other country keeps the branch below unchanged.
  IF v_bill.tax_amount > 0 AND (SELECT country_code FROM public.companies WHERE id = v_company_id) = 'IN' THEN
    INSERT INTO public.general_ledger
      (company_id, journal_entry_id, account_id, account_code, date, debit, credit,
       description, contact_id, related_doc_type, related_doc_id)
    SELECT v_company_id, v_je_id, g.account_id, g.account_code, v_bill.date, g.amount, 0,
           'Input GST ' || v_bill.bill_number, v_bill.supplier_id, 'vendor_bill', p_bill_id
      FROM public._gst_split(v_company_id, (SELECT place_of_supply_code FROM public.contacts WHERE id = v_bill.supplier_id), false, v_bill.tax_amount, 'input') g;
  ELSIF v_bill.tax_amount > 0 AND v_vat_id IS NOT NULL THEN
    INSERT INTO public.general_ledger
      (company_id, journal_entry_id, account_id, account_code, date,
       debit, credit, description, contact_id, related_doc_type, related_doc_id)
    VALUES
      (v_company_id, v_je_id, v_vat_id, '1500', v_bill.date,
       v_bill.tax_amount, 0,
       'Input VAT ' || v_bill.bill_number,
       v_bill.supplier_id, 'vendor_bill', p_bill_id);
  END IF;

  INSERT INTO public.general_ledger
    (company_id, journal_entry_id, account_id, account_code, date,
     debit, credit, description, contact_id, related_doc_type, related_doc_id)
  VALUES
    (v_company_id, v_je_id, v_ap_id, '2100', v_bill.date,
     0, v_bill.total_amount,
     'Vendor Bill ' || v_bill.bill_number,
     v_bill.supplier_id, 'vendor_bill', p_bill_id);

  -- Phase 46 — supplier's rounding on the paper bill (Dr 5900 when we pay
  -- more than the computed lines, Cr when less).
  IF COALESCE(v_bill.round_off_amount, 0) <> 0 THEN
    v_round_off_acc := public.ensure_round_off_account(v_company_id);
    INSERT INTO public.general_ledger
      (company_id, journal_entry_id, account_id, account_code, date,
       debit, credit, description, contact_id, related_doc_type, related_doc_id)
    VALUES
      (v_company_id, v_je_id, v_round_off_acc, '5900', v_bill.date,
       GREATEST(v_bill.round_off_amount, 0), GREATEST(-v_bill.round_off_amount, 0),
       'Round Off ' || v_bill.bill_number,
       v_bill.supplier_id, 'vendor_bill', p_bill_id);
  END IF;

  -- Phase 47 (Option B) — itemized landed costs (freight, customs, insurance…).
  -- The VALUE is already added to inventory by the per-line allocation above;
  -- this routes each line's CREDIT to its own account (bank / cash / a
  -- liability / another party's AP) instead of baking it into the supplier's
  -- payable. contact_id defaults to the supplier when the line has no party.
  FOR v_lc IN
    SELECT * FROM public.vendor_bill_landed_costs
    WHERE bill_id = p_bill_id AND amount <> 0
    ORDER BY sort_order, created_at
  LOOP
    SELECT code INTO v_lc_code FROM public.chart_of_accounts WHERE id = v_lc.credit_account_id;
    IF v_lc_code IS NULL THEN
      RAISE EXCEPTION 'confirm_vendor_bill: landed-cost line "%" has no valid credit account', v_lc.label;
    END IF;
    -- Phase 116 - a credit to the AP control account here has no payable
    -- document behind it: the ledger owes it, bill outstanding, payments and
    -- AP aging do not. Rows saved before the write guard existed stop here.
    IF v_lc_code = '2100' THEN
      RAISE EXCEPTION 'confirm_vendor_bill: landed-cost line "%" credits Accounts Payable 2100. Credit bank or cash if it was paid, or 2300 Accrued Expenses if it is still owed.', v_lc.label
        USING ERRCODE = 'P0001';
    END IF;
    INSERT INTO public.general_ledger
      (company_id, journal_entry_id, account_id, account_code, date,
       debit, credit, description, contact_id, related_doc_type, related_doc_id)
    VALUES
      (v_company_id, v_je_id, v_lc.credit_account_id, v_lc_code, v_bill.date,
       0, v_lc.amount,
       COALESCE(NULLIF(v_lc.label, ''), 'Landed cost') || ' — ' || v_bill.bill_number,
       COALESCE(v_lc.contact_id, v_bill.supplier_id), 'vendor_bill', p_bill_id);
  END LOOP;

  IF v_cogs_id IS NOT NULL AND v_inv_id IS NOT NULL THEN
    FOR v_def IN
      SELECT dcq.*
      FROM public.deferred_cogs_queue dcq
      WHERE dcq.company_id = v_company_id
        AND dcq.status = 'pending'
        AND dcq.product_id IN (
          SELECT DISTINCT vbi.product_id
          FROM public.vendor_bill_items vbi
          WHERE vbi.bill_id = p_bill_id AND vbi.product_id IS NOT NULL
        )
      ORDER BY dcq.sale_date, dcq.created_at
    LOOP
      -- ── Phase 63 ──────────────────────────────────────────────────────────
      -- Cost basis for the flush: the units received on THIS bill are the ones
      -- covering the backorder, so their effective unit cost (landed cost
      -- included, straight off the stock_ledger row this bill just wrote) is
      -- the correct COGS.
      --
      -- This replaces a read of running_avg_cost, which is 0 exactly when a
      -- receipt lands cumulative stock back on zero — the phase 29 valuation
      -- trigger overwrites the correct MAC in the same transaction. That made
      -- the guard below skip the row permanently and strand the purchase value
      -- in 1300 with no stock behind it.
      SELECT COALESCE(SUM(sl.quantity), 0),
             CASE WHEN COALESCE(SUM(sl.quantity), 0) > 0
                  THEN ROUND(SUM(sl.quantity * sl.unit_cost) / SUM(sl.quantity), 2)
                  ELSE 0 END
        INTO v_arrived_qty, v_arrived_cost
      FROM public.stock_ledger sl
      WHERE sl.company_id       = v_company_id
        AND sl.product_id       = v_def.product_id
        AND sl.related_doc_type = 'vendor_bill'
        AND sl.related_doc_id   = p_bill_id
        AND sl.direction        = 1
        AND sl.reversal_of_id IS NULL;

      v_flush_mac := COALESCE(v_arrived_cost, 0);

      -- Fallback: this bill brought no stock for the product (GRN-linked bill,
      -- service line, zero-value receipt) but stock may have arrived by another
      -- route and carry a real average.
      IF v_flush_mac <= 0 THEN
        SELECT COALESCE(running_avg_cost, 0)::NUMERIC(15,2) INTO v_flush_mac
        FROM public.stock_ledger sl
        WHERE sl.company_id = v_company_id
          AND sl.product_id = v_def.product_id
          AND sl.reversal_of_id IS NULL
          AND NOT EXISTS (
            SELECT 1 FROM public.stock_ledger r WHERE r.reversal_of_id = sl.id
          )
        ORDER BY sl.seq DESC
        LIMIT 1;
        v_flush_mac := COALESCE(v_flush_mac, 0);
      END IF;

      IF v_flush_mac <= 0 THEN CONTINUE; END IF;

      -- Partial coverage: never credit 1300 for units that have not arrived.
      -- Rows run oldest-sale-first, so an early row consumes the receipt and
      -- any uncovered remainder correctly stays 'pending' for a later one.
      v_used := COALESCE((v_consumed ->> v_def.product_id::TEXT)::NUMERIC, 0);
      -- Phase 115 - coverage counts every unit that has arrived, not only the
      -- units on this bill. Net stock already subtracts every sale, pending
      -- ones included, so net stock + still-pending quantity is what has
      -- physically arrived to cover them. Rows flushed earlier in this loop
      -- are no longer pending, which consumes them oldest-sale-first. Two
      -- partial receipts that together cover a backorder now flush it on the
      -- second; before, neither bill alone covered it and the row stayed
      -- pending for good.
      IF v_arrived_qty > 0 THEN
        SELECT COALESCE((SELECT SUM(sl.direction * sl.quantity)
                           FROM public.stock_ledger sl
                          WHERE sl.company_id = v_company_id
                            AND sl.product_id = v_def.product_id), 0)
             + COALESCE((SELECT SUM(q.quantity)
                           FROM public.deferred_cogs_queue q
                          WHERE q.company_id = v_company_id
                            AND q.product_id = v_def.product_id
                            AND q.status     = 'pending'), 0)
          INTO v_covered;
        IF v_covered < v_def.quantity THEN
          CONTINUE;
        END IF;
      END IF;
      v_consumed := jsonb_set(
        v_consumed, ARRAY[v_def.product_id::TEXT], to_jsonb(v_used + v_def.quantity)
      );
      -- ── end Phase 63 ──────────────────────────────────────────────────────

      IF v_flush_je_id IS NULL THEN
        INSERT INTO public.document_sequences (company_id, prefix, current_value, format, pad_zeros, reset_yearly)
        VALUES (v_company_id, 'JE', 1001, 'JE-{NUMBER}', 0, false)
        ON CONFLICT (company_id, prefix) DO UPDATE
          SET current_value = public.document_sequences.current_value + 1, updated_at = NOW()
        RETURNING current_value INTO v_seq;
        v_flush_entry := 'JE-' || v_seq::TEXT;

        INSERT INTO public.journal_entries (
          company_id, entry_number, date, description,
          source_type, source_id, currency, exchange_rate,
          total_debit, total_credit, created_by
        ) VALUES (
          v_company_id, v_flush_entry, v_bill.date,
          'Deferred COGS flush — bill ' || v_bill.bill_number,
          'inventory_cogs', p_bill_id,
          v_bill.currency, v_bill.exchange_rate,
          0, 0,
          v_user_id
        ) RETURNING id INTO v_flush_je_id;
      END IF;

      INSERT INTO public.general_ledger
        (company_id, journal_entry_id, account_id, account_code, date,
         debit, credit, description, related_doc_type, related_doc_id)
      VALUES
        (v_company_id, v_flush_je_id, v_cogs_id, '5100', v_bill.date,
         v_def.quantity * v_flush_mac, 0,
         'Deferred COGS — sale ' || v_def.sale_invoice_id::TEXT,
         'invoice', v_def.sale_invoice_id);

      INSERT INTO public.general_ledger
        (company_id, journal_entry_id, account_id, account_code, date,
         debit, credit, description, related_doc_type, related_doc_id)
      VALUES
        (v_company_id, v_flush_je_id, v_inv_id, '1300', v_bill.date,
         0, v_def.quantity * v_flush_mac,
         'Deferred COGS — sale ' || v_def.sale_invoice_id::TEXT,
         'invoice', v_def.sale_invoice_id);

      v_flush_total := v_flush_total + v_def.quantity * v_flush_mac;

      UPDATE public.deferred_cogs_queue
      SET status                   = 'flushed',
          flushed_at               = NOW(),
          flushed_journal_entry_id = v_flush_je_id,
          flush_unit_cost          = v_flush_mac
      WHERE id = v_def.id;

      -- ---- Phase 64 ----------------------------------------------------
      -- Write the recognised cost back onto the originating sale row.
      -- Without this the subledger keeps relieving the sale at zero:
      -- inventory stays overstated by the flushed amount and every later
      -- moving average is computed off an inflated cumulative cost, so the
      -- error compounds into future sales.
      --
      -- The unit_cost = 0 predicate self-sequences. One invoice can carry
      -- several rows for the same product+warehouse (observed up to 6), and
      -- once a row is written back it stops matching, so consecutive
      -- deferred rows each claim a distinct sale row.
      SELECT sl.id INTO v_sale_row_id
      FROM public.stock_ledger sl
      WHERE sl.company_id       = v_company_id
        AND sl.product_id       = v_def.product_id
        AND sl.related_doc_type = 'invoice'
        AND sl.related_doc_id   = v_def.sale_invoice_id
        AND sl.direction        = -1
        AND sl.unit_cost        = 0
        AND sl.warehouse_id IS NOT DISTINCT FROM v_def.warehouse_id
        AND sl.reversal_of_id IS NULL
        AND NOT EXISTS (SELECT 1 FROM public.stock_ledger r WHERE r.reversal_of_id = sl.id)
      ORDER BY sl.seq
      LIMIT 1;

      IF v_sale_row_id IS NOT NULL THEN
        UPDATE public.stock_ledger
        SET unit_cost  = v_flush_mac,
            total_cost = ROUND(quantity * v_flush_mac, 2)
        WHERE id = v_sale_row_id;
      END IF;
      -- ---- end Phase 64 ------------------------------------------------

    END LOOP;

    IF v_flush_je_id IS NOT NULL THEN
      UPDATE public.journal_entries
      SET total_debit  = v_flush_total,
          total_credit = v_flush_total
      WHERE id = v_flush_je_id;

      -- Phase 64 -- stock_ledger_recompute_valuation fires AFTER INSERT
      -- only, so the write-back UPDATEs above do not refresh
      -- running_avg_cost. Do it explicitly, once, and only when a flush
      -- actually happened.
      PERFORM public.recompute_stock_valuation(v_company_id);
    END IF;
  END IF;

  UPDATE public.vendor_bills SET status = 'confirmed', updated_at = NOW() WHERE id = p_bill_id;

  BEGIN
    INSERT INTO public.audit_logs (company_id, user_id, action, entity_type, entity_id, new_data)
    VALUES (v_company_id, v_user_id, 'confirm', 'vendor_bill', p_bill_id,
      jsonb_build_object(
        'bill_number',       v_bill.bill_number,
        'je',                v_entry,
        'landed_cost_total', v_bill.landed_cost_total,
        'cogs_flush_je',     v_flush_entry,
        'cogs_flush_total',  v_flush_total,
        'phase',             '64'
      ));
  EXCEPTION WHEN OTHERS THEN NULL;
  END;

  RETURN jsonb_build_object(
    'bill_id',          p_bill_id,
    'bill_number',      v_bill.bill_number,
    'je_id',            v_je_id,
    'entry_number',     v_entry,
    'cogs_flush_je',    v_flush_je_id,
    'cogs_flush_total', v_flush_total
  );
END;
$function$;

-- ── confirm_credit_note
CREATE OR REPLACE FUNCTION public.confirm_credit_note(p_credit_note_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_user_id       UUID := auth.uid();
  v_company_id    UUID;
  v_cn            public.credit_notes%ROWTYPE;
  v_item          public.credit_note_items%ROWTYPE;
  v_over          RECORD;   -- Phase 73
  v_lock_date     DATE;
  v_currency      TEXT;
  -- JE tracking
  v_je_id         UUID;
  v_je_entry      TEXT;
  v_cogs_je_id    UUID;
  v_cogs_entry    TEXT;
  v_seq           BIGINT;
  -- COA account IDs
  v_ar_id         UUID;  -- 1200
  v_revenue_id    UUID;  -- 4100
  v_vat_id        UUID;  -- 2200
  v_inv_id        UUID;  -- 1300
  v_cogs_id       UUID;  -- 5100
  -- Per-item
  v_restock_cost  NUMERIC(15,2);
  v_total_restock NUMERIC(15,2) := 0;
  v_prev_wh_qty   NUMERIC(15,3);
  v_new_mac       NUMERIC(15,2);
  v_old_qty       NUMERIC(15,3);
  v_old_value     NUMERIC(15,2);
  v_wh_id         UUID;
  v_line_wh_id    UUID;   -- phase83: per-line restock warehouse
  v_prev_wh_mac   NUMERIC(15,4);  -- phase93: last known cost, to hold rather than zero
  v_round_off_acc UUID;
BEGIN
  -- 1. Resolve company
  SELECT company_id INTO v_company_id FROM public.profiles WHERE id = v_user_id;
  IF v_company_id IS NULL THEN
    RAISE EXCEPTION 'confirm_credit_note: no company for user %', v_user_id;
  END IF;

  -- 2. Load credit note
  SELECT * INTO v_cn FROM public.credit_notes WHERE id = p_credit_note_id AND company_id = v_company_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'confirm_credit_note: credit note % not found', p_credit_note_id;
  END IF;
  IF v_cn.status <> 'draft' THEN
    RAISE EXCEPTION 'confirm_credit_note: not in draft (status=%)', v_cn.status;
  END IF;

  -- 3. Period lock
  SELECT period_lock_date INTO v_lock_date FROM public.companies WHERE id = v_company_id;
  IF v_lock_date IS NOT NULL AND v_cn.date <= v_lock_date THEN
    RAISE EXCEPTION 'confirm_credit_note: date % on or before period lock %', v_cn.date, v_lock_date;
  END IF;

  -- ---- Phase 73 (R2b) over-return guard ----------------------------------
  -- A credit note can be raised directly, without ever passing through a
  -- sales return, so the check has to live here too. Only lines that name a
  -- source line are checked: a standalone credit note (goodwill, price
  -- adjustment, no linked invoice) is deliberately unaffected.
  FOR v_over IN
    SELECT COALESCE(cni.base_quantity, cni.quantity) AS quantity,   -- phase155: base units
           COALESCE(cni.description, '(line)') AS descr,
           vr.qty_returnable
    FROM public.credit_note_items cni
    JOIN public.v_invoice_line_returnable vr
      ON vr.invoice_item_id = cni.invoice_item_id
    WHERE cni.credit_note_id = p_credit_note_id
      AND cni.invoice_item_id IS NOT NULL
  LOOP
    IF v_over.quantity > COALESCE(v_over.qty_returnable, 0) THEN
      RAISE EXCEPTION 'confirm_credit_note: crediting % of "%" but only % remain returnable on that invoice line',
        v_over.quantity, v_over.descr, COALESCE(v_over.qty_returnable, 0);
    END IF;
  END LOOP;
  -- ---- end Phase 73 ------------------------------------------------------

  SELECT COALESCE(currency, 'AED') INTO v_currency FROM public.companies WHERE id = v_company_id;

  -- 4. Resolve COA
  SELECT id INTO v_ar_id      FROM public.chart_of_accounts WHERE company_id = v_company_id AND code = '1200' AND is_active;
  SELECT id INTO v_revenue_id FROM public.chart_of_accounts WHERE company_id = v_company_id AND code = '4100' AND is_active;
  SELECT id INTO v_inv_id     FROM public.chart_of_accounts WHERE company_id = v_company_id AND code = '1300' AND is_active;
  SELECT id INTO v_cogs_id    FROM public.chart_of_accounts WHERE company_id = v_company_id AND code = '5100' AND is_active;
  IF v_cn.tax_amount > 0 THEN
    SELECT id INTO v_vat_id FROM public.chart_of_accounts
    WHERE company_id = v_company_id AND code LIKE '22%' AND is_active ORDER BY code LIMIT 1;
  END IF;

  IF v_ar_id IS NULL THEN RAISE EXCEPTION 'confirm_credit_note: account 1200 not found'; END IF;
  IF v_revenue_id IS NULL THEN RAISE EXCEPTION 'confirm_credit_note: account 4100 not found'; END IF;

  -- 5. Default warehouse
  v_wh_id := v_cn.warehouse_id;
  IF v_wh_id IS NULL THEN
    SELECT id INTO v_wh_id FROM public.warehouses WHERE company_id = v_company_id AND is_default LIMIT 1;
  END IF;

  -- 6. Generate JE for the header (sales_credit_note)
  INSERT INTO public.document_sequences (company_id, prefix, current_value, format, pad_zeros, reset_yearly)
  VALUES (v_company_id, 'JE', 1001, 'JE-{NUMBER}', 0, false)
  ON CONFLICT (company_id, prefix) DO UPDATE
    SET current_value = public.document_sequences.current_value + 1, updated_at = NOW()
  RETURNING current_value INTO v_seq;
  v_je_entry := 'JE-' || v_seq::TEXT;

  INSERT INTO public.journal_entries (
    company_id, entry_number, date, description,
    source_type, source_id, currency, exchange_rate,
    total_debit, total_credit, created_by
  ) VALUES (
    v_company_id, v_je_entry, v_cn.date,
    'Credit Note ' || v_cn.credit_note_number,
    'sales_credit_note', p_credit_note_id,
    v_currency, 1.0,
    v_cn.total_amount + GREATEST(-COALESCE(v_cn.round_off_amount, 0), 0),
    v_cn.total_amount + GREATEST(-COALESCE(v_cn.round_off_amount, 0), 0),
    v_user_id
  ) RETURNING id INTO v_je_id;

  -- 6a. Dr 4100 Sales Revenue reversal
  IF (v_cn.total_amount - v_cn.tax_amount - COALESCE(v_cn.round_off_amount, 0)) > 0 THEN
    INSERT INTO public.general_ledger
      (company_id, journal_entry_id, account_id, account_code, date, debit, credit,
       description, contact_id, related_doc_type, related_doc_id)
    VALUES
      (v_company_id, v_je_id, v_revenue_id, '4100', v_cn.date,
       v_cn.total_amount - v_cn.tax_amount - COALESCE(v_cn.round_off_amount, 0), 0,
       'Revenue reversal ' || v_cn.credit_note_number,
       v_cn.contact_id, 'credit_note', p_credit_note_id);
  END IF;

  -- 6b. Dr 2200 Output VAT reversal
  -- phase122 (Doc 3 Part K): an Indian company posts CGST + SGST (same
  -- state, or unknown) or IGST (other state / export), each line coded with
  -- its own account. Every other country keeps the branch below unchanged.
  IF v_cn.tax_amount > 0 AND (SELECT country_code FROM public.companies WHERE id = v_company_id) = 'IN' THEN
    INSERT INTO public.general_ledger
      (company_id, journal_entry_id, account_id, account_code, date, debit, credit,
       description, contact_id, related_doc_type, related_doc_id)
    SELECT v_company_id, v_je_id, g.account_id, g.account_code, v_cn.date, g.amount, 0,
           'GST reversal ' || v_cn.credit_note_number, v_cn.contact_id, 'credit_note', p_credit_note_id
      FROM public._gst_split(v_company_id, COALESCE((SELECT NULLIF(place_of_supply_code, '') FROM public.invoices WHERE id = v_cn.linked_invoice_id), (SELECT place_of_supply_code FROM public.contacts WHERE id = v_cn.contact_id)), COALESCE((SELECT is_export FROM public.invoices WHERE id = v_cn.linked_invoice_id), false), v_cn.tax_amount, 'output') g;
  ELSIF v_cn.tax_amount > 0 AND v_vat_id IS NOT NULL THEN
    INSERT INTO public.general_ledger
      (company_id, journal_entry_id, account_id, account_code, date, debit, credit,
       description, contact_id, related_doc_type, related_doc_id)
    VALUES
      (v_company_id, v_je_id, v_vat_id, '2200', v_cn.date,
       v_cn.tax_amount, 0,
       'VAT reversal ' || v_cn.credit_note_number,
       v_cn.contact_id, 'credit_note', p_credit_note_id);
  END IF;

  -- 6c. Cr 1200 AR reduction
  INSERT INTO public.general_ledger
    (company_id, journal_entry_id, account_id, account_code, date, debit, credit,
     description, contact_id, related_doc_type, related_doc_id)
  VALUES
    (v_company_id, v_je_id, v_ar_id, '1200', v_cn.date,
     0, v_cn.total_amount,
     'AR reduction ' || v_cn.credit_note_number,
     v_cn.contact_id, 'credit_note', p_credit_note_id);

  -- Phase 46 — round-off reversal (Dr 5900 when the original rounded up).
  IF COALESCE(v_cn.round_off_amount, 0) <> 0 THEN
    v_round_off_acc := public.ensure_round_off_account(v_company_id);
    INSERT INTO public.general_ledger
      (company_id, journal_entry_id, account_id, account_code, date, debit, credit,
       description, contact_id, related_doc_type, related_doc_id)
    VALUES
      (v_company_id, v_je_id, v_round_off_acc, '5900', v_cn.date,
       GREATEST(v_cn.round_off_amount, 0), GREATEST(-v_cn.round_off_amount, 0),
       'Round Off ' || v_cn.credit_note_number,
       v_cn.contact_id, 'credit_note', p_credit_note_id);
  END IF;

  -- 7. If restock=true: per-line COGS reversal + stock_ledger (A9)
  IF v_cn.restock THEN
    FOR v_item IN SELECT * FROM public.credit_note_items WHERE credit_note_id = p_credit_note_id LOOP
      CONTINUE WHEN v_item.product_id IS NULL;
      -- phase93: a line with NO KNOWN COST used to be skipped entirely,
      -- which skipped the QUANTITY as well. The goods physically came
      -- back whether or not we know what they cost, so the movement is
      -- always written; only the VALUE is zero. Service lines are still
      -- excluded, by the stock_ledger_a_skip_service trigger.

      -- phase154 — the share of what the sale actually relieved.
      v_restock_cost := public._credit_note_line_cost(v_item.id);
      v_total_restock := v_total_restock + v_restock_cost;
      -- phase155 — stock moves the base quantity.
      v_item.quantity := COALESCE(v_item.base_quantity, v_item.quantity);

      -- phase83: the line may nominate its own warehouse (quarantine for
      -- damaged goods, a different branch); fall back to the document.
      v_line_wh_id := COALESCE(v_item.restock_warehouse_id, v_wh_id);

      -- Stock ledger: restock at original cost_at_sale
      SELECT COALESCE(running_qty, 0)::NUMERIC(15,3), running_avg_cost
        INTO v_prev_wh_qty, v_prev_wh_mac
      FROM public.stock_ledger
      WHERE company_id = v_company_id AND product_id = v_item.product_id AND warehouse_id = v_line_wh_id
      ORDER BY seq DESC LIMIT 1;
      v_prev_wh_qty := COALESCE(v_prev_wh_qty, 0);

      -- Company-wide MAC update for return
      SELECT COALESCE(SUM(latest_qty), 0), COALESCE(SUM(latest_value), 0)
      INTO v_old_qty, v_old_value
      FROM (
        SELECT DISTINCT ON (warehouse_id)
          running_qty AS latest_qty,
          running_qty * running_avg_cost AS latest_value
        FROM public.stock_ledger
        WHERE company_id = v_company_id AND product_id = v_item.product_id
        ORDER BY warehouse_id, seq DESC
      ) sub;

      v_old_qty   := COALESCE(v_old_qty, 0);
      v_old_value := COALESCE(v_old_value, 0);

      -- phase93: only divide when the result is a real holding. Stock can
      -- be negative here (sold before bought), and a negative denominator
      -- FLIPS THE SIGN of the average cost rather than failing. When the
      -- quantity nets to zero or stays negative there is no average to
      -- compute, so keep the cost already on file instead of inventing one.
      IF (v_old_qty + v_item.quantity) > 0 THEN
        v_new_mac := (v_old_value + v_restock_cost) / (v_old_qty + v_item.quantity);
      ELSE
        v_new_mac := COALESCE(NULLIF(v_item.cost_at_sale, 0), v_prev_wh_mac, 0);
      END IF;

      INSERT INTO public.stock_ledger
        (company_id, product_id, warehouse_id, date,
         type, direction, quantity, unit_cost, total_cost,
         running_qty, running_avg_cost,
         related_doc_type, related_doc_id)
      VALUES
        (v_company_id, v_item.product_id, v_line_wh_id, v_cn.date,
         'sales_return', 1, v_item.quantity, COALESCE(v_item.cost_at_sale, 0), v_restock_cost,
         v_prev_wh_qty + v_item.quantity, v_new_mac,
         'credit_note', p_credit_note_id);
    END LOOP;

    -- Post COGS reversal JE if any items restocked
    IF v_total_restock > 0 THEN
      IF v_inv_id IS NULL THEN RAISE EXCEPTION 'confirm_credit_note: account 1300 not found'; END IF;
      IF v_cogs_id IS NULL THEN RAISE EXCEPTION 'confirm_credit_note: account 5100 not found'; END IF;

      INSERT INTO public.document_sequences (company_id, prefix, current_value, format, pad_zeros, reset_yearly)
      VALUES (v_company_id, 'JE', 1001, 'JE-{NUMBER}', 0, false)
      ON CONFLICT (company_id, prefix) DO UPDATE
        SET current_value = public.document_sequences.current_value + 1, updated_at = NOW()
      RETURNING current_value INTO v_seq;
      v_cogs_entry := 'JE-' || v_seq::TEXT;

      INSERT INTO public.journal_entries (
        company_id, entry_number, date, description,
        source_type, source_id, currency, exchange_rate,
        total_debit, total_credit, created_by
      ) VALUES (
        v_company_id, v_cogs_entry, v_cn.date,
        'COGS Reversal – ' || v_cn.credit_note_number,
        'inventory_cogs', p_credit_note_id,
        v_currency, 1.0,
        v_total_restock, v_total_restock,
        v_user_id
      ) RETURNING id INTO v_cogs_je_id;

      -- Dr 1300 Inventory Asset
      INSERT INTO public.general_ledger
        (company_id, journal_entry_id, account_id, account_code, date, debit, credit,
         description, related_doc_type, related_doc_id)
      VALUES
        (v_company_id, v_cogs_je_id, v_inv_id, '1300', v_cn.date,
         v_total_restock, 0,
         'Restock ' || v_cn.credit_note_number, 'credit_note', p_credit_note_id);

      -- Cr 5100 COGS
      INSERT INTO public.general_ledger
        (company_id, journal_entry_id, account_id, account_code, date, debit, credit,
         description, related_doc_type, related_doc_id)
      VALUES
        (v_company_id, v_cogs_je_id, v_cogs_id, '5100', v_cn.date,
         0, v_total_restock,
         'COGS reversal ' || v_cn.credit_note_number, 'credit_note', p_credit_note_id);
    END IF;
  END IF;

  -- 8. Confirm
  UPDATE public.credit_notes
  SET status = 'confirmed', updated_at = NOW()
  WHERE id = p_credit_note_id;

  BEGIN
    INSERT INTO public.audit_logs (company_id, user_id, action, entity_type, entity_id, new_data)
    VALUES (v_company_id, v_user_id, 'confirm', 'credit_note', p_credit_note_id,
      jsonb_build_object('credit_note_number', v_cn.credit_note_number, 'je', v_je_entry));
  EXCEPTION WHEN OTHERS THEN NULL;
  END;

  RETURN jsonb_build_object(
    'credit_note_id',     p_credit_note_id,
    'credit_note_number', v_cn.credit_note_number,
    'journal_entry_id',   v_je_id,
    'entry_number',       v_je_entry
  );
END;
$function$;

-- ── confirm_debit_note
CREATE OR REPLACE FUNCTION public.confirm_debit_note(p_debit_note_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_user_id       UUID := auth.uid();
  v_company_id    UUID;
  v_dn            public.debit_notes%ROWTYPE;
  v_item          public.debit_note_items%ROWTYPE;
  v_over          RECORD;   -- Phase 74
  v_lock_date     DATE;
  v_currency      TEXT;
  -- JE
  v_je_id         UUID;
  v_je_entry      TEXT;
  v_seq           BIGINT;
  -- COA
  v_ap_id         UUID;  -- 2100 AP
  v_inv_id        UUID;  -- 1300 Inventory
  v_vat_id        UUID;  -- 1500 Input VAT
  v_cogs_id       UUID;  -- 5100, phase81 fallback for services
  v_svc_exp_id    UUID;  -- phase81: first active 5xxx expense
  v_product_type  TEXT;  -- phase81
  v_line_acct_id  UUID;  -- phase81
  v_line_class    TEXT;  -- phase81
  v_line_code     TEXT;  -- phase81
  -- Per-item stock
  v_prev_wh_qty   NUMERIC(15,3);
  v_old_qty       NUMERIC(15,3);
  v_old_value     NUMERIC(15,2);
  v_new_mac       NUMERIC(15,2);
  v_item_cost     NUMERIC(15,2);
  v_total_inv_credit NUMERIC(15,2) := 0;
  v_eff_unit      NUMERIC(15,4);   -- phase80
  v_wh_id         UUID;
  v_line_wh_id    UUID;   -- phase83: per-line restock warehouse
  v_round_off_acc UUID;
BEGIN
  -- 1. Resolve company
  SELECT company_id INTO v_company_id FROM public.profiles WHERE id = v_user_id;
  IF v_company_id IS NULL THEN
    RAISE EXCEPTION 'confirm_debit_note: no company for user %', v_user_id;
  END IF;

  -- 2. Load debit note
  SELECT * INTO v_dn FROM public.debit_notes WHERE id = p_debit_note_id AND company_id = v_company_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'confirm_debit_note: debit note % not found', p_debit_note_id;
  END IF;
  IF v_dn.status <> 'draft' THEN
    RAISE EXCEPTION 'confirm_debit_note: not in draft (status=%)', v_dn.status;
  END IF;

  -- 3. Period lock
  SELECT period_lock_date INTO v_lock_date FROM public.companies WHERE id = v_company_id;
  IF v_lock_date IS NOT NULL AND v_dn.date <= v_lock_date THEN
    RAISE EXCEPTION 'confirm_debit_note: date % on or before period lock %', v_dn.date, v_lock_date;
  END IF;

  -- ---- Phase 74 (R2c) over-return guard ----------------------------------
  -- Mirror of the sales side, with one deliberate difference: the link is
  -- OPTIONAL here. A debit note is typed directly rather than generated from
  -- a return document, and legitimately carries lines that were never on the
  -- bill -- a freight adjustment, a short-shipment claim -- as well as
  -- standalone notes with no linked bill at all. So only lines that NAME a
  -- bill line are bound; everything else passes untouched.
  --
  -- Note the other asymmetry: unit_cost is entered by the operator on this
  -- side, so there is no equivalent of the sales-side mis-pricing bug. What
  -- was missing was any notion of how much of a bill line had already gone
  -- back, which is what this closes.
  FOR v_over IN
    SELECT COALESCE(dni.base_quantity, dni.quantity) AS quantity,   -- phase155: base units
           COALESCE(dni.description, '(line)') AS descr,
           vr.qty_returnable
    FROM public.debit_note_items dni
    JOIN public.v_bill_line_returnable vr
      ON vr.vendor_bill_item_id = dni.vendor_bill_item_id
    WHERE dni.debit_note_id = p_debit_note_id
      AND dni.vendor_bill_item_id IS NOT NULL
  LOOP
    IF v_over.quantity > COALESCE(v_over.qty_returnable, 0) THEN
      RAISE EXCEPTION 'confirm_debit_note: returning % of "%" but only % remain returnable on that bill line',
        v_over.quantity, v_over.descr, COALESCE(v_over.qty_returnable, 0);
    END IF;
  END LOOP;
  -- ---- end Phase 74 ------------------------------------------------------

  SELECT COALESCE(currency, 'AED') INTO v_currency FROM public.companies WHERE id = v_company_id;

  -- 4. Resolve COA
  SELECT id INTO v_ap_id  FROM public.chart_of_accounts WHERE company_id = v_company_id AND code = '2100' AND is_active;
  SELECT id INTO v_inv_id FROM public.chart_of_accounts WHERE company_id = v_company_id AND code = '1300' AND is_active;
  IF v_dn.tax_amount > 0 THEN
    SELECT id INTO v_vat_id FROM public.chart_of_accounts
    WHERE company_id = v_company_id AND code = '1500' AND is_active;
  END IF;

  -- phase81: the same two the inbound side keeps for service lines.
  SELECT id INTO v_cogs_id FROM public.chart_of_accounts
   WHERE company_id = v_company_id AND code = '5100' AND is_active;
  SELECT id INTO v_svc_exp_id FROM public.chart_of_accounts
   WHERE company_id = v_company_id AND type = 'expense' AND code LIKE '5%' AND is_active
   ORDER BY code LIMIT 1;

  IF v_ap_id IS NULL THEN RAISE EXCEPTION 'confirm_debit_note: account 2100 not found'; END IF;

  -- 5. Default warehouse
  v_wh_id := v_dn.warehouse_id;
  IF v_wh_id IS NULL THEN
    SELECT id INTO v_wh_id FROM public.warehouses WHERE company_id = v_company_id AND is_default LIMIT 1;
  END IF;

  -- 6. Generate JE number
  INSERT INTO public.document_sequences (company_id, prefix, current_value, format, pad_zeros, reset_yearly)
  VALUES (v_company_id, 'JE', 1001, 'JE-{NUMBER}', 0, false)
  ON CONFLICT (company_id, prefix) DO UPDATE
    SET current_value = public.document_sequences.current_value + 1, updated_at = NOW()
  RETURNING current_value INTO v_seq;
  v_je_entry := 'JE-' || v_seq::TEXT;

  INSERT INTO public.journal_entries (
    company_id, entry_number, date, description,
    source_type, source_id, currency, exchange_rate,
    total_debit, total_credit, created_by
  ) VALUES (
    v_company_id, v_je_entry, v_dn.date,
    'Debit Note ' || v_dn.debit_note_number,
    'vendor_debit_note', p_debit_note_id,
    v_currency, 1.0,
    v_dn.total_amount + GREATEST(-COALESCE(v_dn.round_off_amount, 0), 0),
    v_dn.total_amount + GREATEST(-COALESCE(v_dn.round_off_amount, 0), 0),
    v_user_id
  ) RETURNING id INTO v_je_id;

  -- 7. Dr 2100 AP
  INSERT INTO public.general_ledger
    (company_id, journal_entry_id, account_id, account_code, date, debit, credit,
     description, contact_id, related_doc_type, related_doc_id)
  VALUES
    (v_company_id, v_je_id, v_ap_id, '2100', v_dn.date,
     v_dn.total_amount, 0,
     'AP reduction ' || v_dn.debit_note_number,
     v_dn.supplier_id, 'debit_note', p_debit_note_id);

  -- Phase 46 — round-off reversal (Cr 5900 when the original bill rounded up).
  IF COALESCE(v_dn.round_off_amount, 0) <> 0 THEN
    v_round_off_acc := public.ensure_round_off_account(v_company_id);
    INSERT INTO public.general_ledger
      (company_id, journal_entry_id, account_id, account_code, date, debit, credit,
       description, contact_id, related_doc_type, related_doc_id)
    VALUES
      (v_company_id, v_je_id, v_round_off_acc, '5900', v_dn.date,
       GREATEST(-v_dn.round_off_amount, 0), GREATEST(v_dn.round_off_amount, 0),
       'Round Off ' || v_dn.debit_note_number,
       v_dn.supplier_id, 'debit_note', p_debit_note_id);
  END IF;

  -- 8. Cr 1500 Input VAT reversal
  -- phase122 (Doc 3 Part K): an Indian company posts CGST + SGST (same
  -- state, or unknown) or IGST (other state / export), each line coded with
  -- its own account. Every other country keeps the branch below unchanged.
  IF v_dn.tax_amount > 0 AND (SELECT country_code FROM public.companies WHERE id = v_company_id) = 'IN' THEN
    INSERT INTO public.general_ledger
      (company_id, journal_entry_id, account_id, account_code, date, debit, credit,
       description, contact_id, related_doc_type, related_doc_id)
    SELECT v_company_id, v_je_id, g.account_id, g.account_code, v_dn.date, 0, g.amount,
           'Input GST reversal ' || v_dn.debit_note_number, v_dn.supplier_id, 'debit_note', p_debit_note_id
      FROM public._gst_split(v_company_id, (SELECT place_of_supply_code FROM public.contacts WHERE id = v_dn.supplier_id), false, v_dn.tax_amount, 'input') g;
  ELSIF v_dn.tax_amount > 0 AND v_vat_id IS NOT NULL THEN
    INSERT INTO public.general_ledger
      (company_id, journal_entry_id, account_id, account_code, date, debit, credit,
       description, contact_id, related_doc_type, related_doc_id)
    VALUES
      (v_company_id, v_je_id, v_vat_id, '1500', v_dn.date,
       0, v_dn.tax_amount,
       'Input VAT reversal ' || v_dn.debit_note_number,
       v_dn.supplier_id, 'debit_note', p_debit_note_id);
  END IF;

  -- 9. Process items: stock return + compute total inventory credit
  FOR v_item IN SELECT * FROM public.debit_note_items WHERE debit_note_id = p_debit_note_id LOOP
    v_item_cost := v_item.line_total - v_item.tax_amount;

    -- phase81: resolve the account this line belongs to, by exactly the rule
    -- confirm_vendor_bill uses on the way in. Crediting everything to 1300
    -- meant a returned SERVICE reduced inventory that never held it.
    v_product_type := NULL;
    v_line_acct_id := NULL;
    IF v_item.product_id IS NOT NULL THEN
      SELECT p.type, p.purchase_account_id INTO v_product_type, v_line_acct_id
        FROM public.products p WHERE p.id = v_item.product_id;
      IF v_line_acct_id IS NULL THEN
        IF v_product_type = 'service' THEN
          v_line_acct_id := COALESCE(v_svc_exp_id, v_cogs_id);
          IF v_line_acct_id IS NULL THEN
            RAISE EXCEPTION 'confirm_debit_note: no expense account found for service line - set a purchase account on the product';
          END IF;
        ELSE
          v_line_acct_id := v_inv_id;
        END IF;
      END IF;
    ELSE
      -- No product and no coa_account_id column on this table: 1300, which is
      -- also where confirm_vendor_bill lands an unclassified line.
      v_line_acct_id := v_inv_id;
    END IF;

    SELECT type, code INTO v_line_class, v_line_code
      FROM public.chart_of_accounts WHERE id = v_line_acct_id;

    IF v_line_acct_id IS NOT DISTINCT FROM v_inv_id THEN
      -- Unchanged path: still one aggregate 1300 credit for goods.
      v_total_inv_credit := v_total_inv_credit + v_item_cost;
    ELSIF v_item_cost <> 0 THEN
      INSERT INTO public.general_ledger
        (company_id, journal_entry_id, account_id, account_code, date, debit, credit,
         description, contact_id, related_doc_type, related_doc_id)
      VALUES
        (v_company_id, v_je_id, v_line_acct_id, v_line_code, v_dn.date,
         0, v_item_cost,
         COALESCE(v_item.description, 'Debit Note ' || v_dn.debit_note_number),
         v_dn.supplier_id, 'debit_note', p_debit_note_id);
    END IF;

    -- Stock ledger if product present (B9 return)
    -- phase93: the cost conditions were removed. Goods leaving for a
    -- supplier leave whether or not we know their cost, exactly as on the
    -- sales side. The service and expense-line exclusions STAY: those
    -- never represented stock in the first place.
    IF v_item.product_id IS NOT NULL
       AND v_product_type IS DISTINCT FROM 'service'   -- phase81: services never stock
       AND v_line_class = 'asset' THEN                 -- phase81: nor does an expense line
      -- phase83: honour a line-level warehouse, falling back to the document.
      v_line_wh_id := COALESCE(v_item.restock_warehouse_id, v_wh_id);
      -- phase155 — stock moves the base quantity.
      v_item.quantity := COALESCE(v_item.base_quantity, v_item.quantity);

      -- Per-warehouse running qty
      SELECT COALESCE(running_qty, 0)::NUMERIC(15,3) INTO v_prev_wh_qty
      FROM public.stock_ledger
      WHERE company_id = v_company_id AND product_id = v_item.product_id AND warehouse_id = v_line_wh_id
      ORDER BY seq DESC LIMIT 1;
      v_prev_wh_qty := COALESCE(v_prev_wh_qty, 0);

      -- Company-wide MAC recalc after removing qty
      SELECT COALESCE(SUM(latest_qty), 0), COALESCE(SUM(latest_value), 0)
      INTO v_old_qty, v_old_value
      FROM (
        SELECT DISTINCT ON (warehouse_id)
          running_qty AS latest_qty,
          running_qty * running_avg_cost AS latest_value
        FROM public.stock_ledger
        WHERE company_id = v_company_id AND product_id = v_item.product_id
        ORDER BY warehouse_id, seq DESC
      ) sub;

      v_old_qty   := COALESCE(v_old_qty, 0);
      v_old_value := COALESCE(v_old_value, 0);

      IF (v_old_qty - v_item.quantity) <= 0 THEN
        v_new_mac := 0;
      ELSE
        v_new_mac := (v_old_value - v_item_cost) / (v_old_qty - v_item.quantity);
      END IF;

      -- phase80: the per-unit figure that matches v_item_cost, derived the
      -- same way confirm_vendor_bill derives v_eff_unit on the way in.
      v_eff_unit := ROUND(v_item_cost / v_item.quantity, 4);

      INSERT INTO public.stock_ledger
        (company_id, product_id, warehouse_id, date,
         type, direction, quantity, unit_cost, total_cost,
         running_qty, running_avg_cost,
         related_doc_type, related_doc_id)
      VALUES
        (v_company_id, v_item.product_id, v_line_wh_id, v_dn.date,
         'purchase_return', -1, v_item.quantity, v_eff_unit,
         v_item_cost,
         v_prev_wh_qty - v_item.quantity, GREATEST(v_new_mac, 0),
         'debit_note', p_debit_note_id);
    END IF;
  END LOOP;

  -- 10. Cr 1300 Inventory Asset (total net return value)
  IF v_total_inv_credit > 0 AND v_inv_id IS NOT NULL THEN
    INSERT INTO public.general_ledger
      (company_id, journal_entry_id, account_id, account_code, date, debit, credit,
       description, contact_id, related_doc_type, related_doc_id)
    VALUES
      (v_company_id, v_je_id, v_inv_id, '1300', v_dn.date,
       0, v_total_inv_credit,
       'Inventory return ' || v_dn.debit_note_number,
       v_dn.supplier_id, 'debit_note', p_debit_note_id);
  END IF;

  -- 11. Confirm
  UPDATE public.debit_notes
  SET status = 'confirmed', updated_at = NOW()
  WHERE id = p_debit_note_id;

  BEGIN
    INSERT INTO public.audit_logs (company_id, user_id, action, entity_type, entity_id, new_data)
    VALUES (v_company_id, v_user_id, 'confirm', 'debit_note', p_debit_note_id,
      jsonb_build_object('debit_note_number', v_dn.debit_note_number, 'je', v_je_entry));
  EXCEPTION WHEN OTHERS THEN NULL;
  END;

  RETURN jsonb_build_object(
    'debit_note_id',     p_debit_note_id,
    'debit_note_number', v_dn.debit_note_number,
    'journal_entry_id',  v_je_id,
    'entry_number',      v_je_entry
  );
END;
$function$;

-- ── _credit_note_line_cost
CREATE OR REPLACE FUNCTION public._credit_note_line_cost(p_item uuid)
 RETURNS numeric
 LANGUAGE sql
 STABLE
 SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT CASE
           -- phase155: shares and unit costs are in base units
           WHEN ii.cost_total IS NOT NULL AND ii.quantity > 0
            AND ii.product_id = cni.product_id
            AND ii.cost_at_sale IS NOT DISTINCT FROM cni.cost_at_sale
           THEN ROUND(ii.cost_total * COALESCE(cni.base_quantity, cni.quantity) / COALESCE(ii.base_quantity, ii.quantity), 2)
           ELSE COALESCE(cni.base_quantity, cni.quantity) * COALESCE(cni.cost_at_sale, 0)
         END
    FROM public.credit_note_items cni
    LEFT JOIN public.invoice_items ii ON ii.id = cni.invoice_item_id
   WHERE cni.id = p_item;
$function$;

-- ── repair_vendor_bill_je
CREATE OR REPLACE FUNCTION public.repair_vendor_bill_je(p_je_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_je              public.journal_entries%ROWTYPE;
  v_bill            public.vendor_bills%ROWTYPE;
  v_item            public.vendor_bill_items%ROWTYPE;
  v_company_id      UUID;
  v_line_acct_id    UUID;
  v_line_code       TEXT;
  v_line_class      TEXT;
  v_inv_id          UUID;
  v_body_debit      NUMERIC(15,2) := 0;
  v_body_credit     NUMERIC(15,2) := 0;
  v_wh_id           UUID;
  v_old_mac         NUMERIC(15,2);
  v_old_total_qty   NUMERIC(15,3);
  v_qty_for_mac     NUMERIC(15,3);
  v_new_mac         NUMERIC(15,2);
  v_prev_wh_qty     NUMERIC(15,3);
  v_rows_added      INT := 0;
BEGIN
  -- Load the JE
  SELECT * INTO v_je FROM public.journal_entries WHERE id = p_je_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'repair_vendor_bill_je: JE % not found', p_je_id;
  END IF;
  IF v_je.source_type <> 'vendor_bill' THEN
    RAISE EXCEPTION 'repair_vendor_bill_je: JE % is not from a vendor_bill (source_type=%)', p_je_id, v_je.source_type;
  END IF;

  v_company_id := v_je.company_id;

  -- Load the bill
  SELECT * INTO v_bill FROM public.vendor_bills WHERE id = v_je.source_id AND company_id = v_company_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'repair_vendor_bill_je: source bill % not found', v_je.source_id;
  END IF;

  -- Already balanced?
  SELECT COALESCE(SUM(debit), 0), COALESCE(SUM(credit), 0)
  INTO v_body_debit, v_body_credit
  FROM public.general_ledger
  WHERE journal_entry_id = p_je_id;

  IF ABS(v_body_debit - v_body_credit) < 0.01 THEN
    RETURN jsonb_build_object(
      'status',          'already_balanced',
      'rows_added',      0,
      'new_body_debit',  v_body_debit,
      'new_body_credit', v_body_credit
    );
  END IF;

  -- Default warehouse
  SELECT id INTO v_wh_id FROM public.warehouses
  WHERE company_id = v_company_id AND is_default = TRUE AND is_active = TRUE
  LIMIT 1;
  IF v_wh_id IS NULL THEN
    SELECT id INTO v_wh_id FROM public.warehouses
    WHERE company_id = v_company_id AND is_active = TRUE
    ORDER BY created_at LIMIT 1;
  END IF;

  -- Default 1300 Inventory id (fallback)
  SELECT id INTO v_inv_id FROM public.chart_of_accounts
  WHERE company_id = v_company_id AND code = '1300' AND is_active;

  -- Iterate bill items
  -- phase155 — this repair rebuilds stock from the typed quantities.
  IF EXISTS (SELECT 1 FROM public.vendor_bill_items i WHERE i.bill_id = v_bill.id AND i.product_unit_id IS NOT NULL) THEN
    RAISE EXCEPTION 'repair_vendor_bill_je: this bill uses packs and cannot be repaired this way.';
  END IF;

  FOR v_item IN SELECT * FROM public.vendor_bill_items WHERE bill_id = v_bill.id LOOP
    IF v_item.line_subtotal <= 0 THEN CONTINUE; END IF;
    IF v_item.product_id IS NULL THEN CONTINUE; END IF;

    -- Resolve the account: product's purchase_account_id, falling back to 1300
    SELECT purchase_account_id INTO v_line_acct_id
    FROM public.products WHERE id = v_item.product_id;
    IF v_line_acct_id IS NULL THEN
      v_line_acct_id := v_inv_id;
    END IF;

    SELECT type, code INTO v_line_class, v_line_code
    FROM public.chart_of_accounts WHERE id = v_line_acct_id;

    -- Skip lines that already have a DR row for this account on this JE
    IF EXISTS (
      SELECT 1 FROM public.general_ledger
      WHERE journal_entry_id = p_je_id
        AND account_id = v_line_acct_id
        AND debit > 0
    ) THEN
      CONTINUE;
    END IF;

    -- Insert the missing DR row
    INSERT INTO public.general_ledger
      (company_id, journal_entry_id, account_id, account_code, date,
       debit, credit, description, contact_id, related_doc_type, related_doc_id)
    VALUES
      (v_company_id, p_je_id, v_line_acct_id, v_line_code, v_bill.date,
       v_item.line_subtotal, 0,
       COALESCE(v_item.description, 'Vendor Bill ' || v_bill.bill_number) || ' (repair)',
       v_bill.supplier_id, 'vendor_bill', v_bill.id);

    v_rows_added := v_rows_added + 1;

    -- If asset class, also post the missing stock_ledger row + update MAC.
    -- Skips if a stock_ledger row already exists for this bill+product (idempotent).
    IF v_line_class = 'asset' AND v_item.quantity > 0 AND v_item.unit_cost > 0
       AND NOT EXISTS (
         SELECT 1 FROM public.stock_ledger
         WHERE related_doc_type = 'vendor_bill'
           AND related_doc_id = v_bill.id
           AND product_id = v_item.product_id
       )
    THEN
      SELECT COALESCE(running_avg_cost, 0) INTO v_old_mac
      FROM public.stock_ledger
      WHERE company_id = v_company_id AND product_id = v_item.product_id
      ORDER BY seq DESC LIMIT 1;
      v_old_mac := COALESCE(v_old_mac, 0);

      SELECT COALESCE(SUM(latest_qty), 0) INTO v_old_total_qty
      FROM (
        SELECT DISTINCT ON (warehouse_id) running_qty AS latest_qty
        FROM public.stock_ledger
        WHERE company_id = v_company_id AND product_id = v_item.product_id
        ORDER BY warehouse_id, seq DESC
      ) sub;
      v_old_total_qty := COALESCE(v_old_total_qty, 0);

      v_qty_for_mac := GREATEST(v_old_total_qty, 0);

      IF v_qty_for_mac + v_item.quantity > 0 THEN
        v_new_mac := ROUND(
          (v_old_mac * v_qty_for_mac + v_item.unit_cost * v_item.quantity) /
          (v_qty_for_mac + v_item.quantity),
          2
        );
      ELSE
        v_new_mac := v_item.unit_cost;
      END IF;

      SELECT COALESCE(running_qty, 0) INTO v_prev_wh_qty
      FROM public.stock_ledger
      WHERE company_id = v_company_id AND product_id = v_item.product_id
        AND warehouse_id = v_wh_id
      ORDER BY seq DESC LIMIT 1;
      v_prev_wh_qty := COALESCE(v_prev_wh_qty, 0);

      INSERT INTO public.stock_ledger
        (company_id, product_id, warehouse_id, date,
         type, direction, quantity, unit_cost, total_cost,
         running_qty, running_avg_cost,
         related_doc_type, related_doc_id)
      VALUES
        (v_company_id, v_item.product_id, v_wh_id, v_bill.date,
         'purchase', 1, v_item.quantity, v_item.unit_cost,
         v_item.quantity * v_item.unit_cost,
         v_prev_wh_qty + v_item.quantity, v_new_mac,
         'vendor_bill', v_bill.id);
    END IF;
  END LOOP;

  -- Re-check
  SELECT COALESCE(SUM(debit), 0), COALESCE(SUM(credit), 0)
  INTO v_body_debit, v_body_credit
  FROM public.general_ledger
  WHERE journal_entry_id = p_je_id;

  -- Audit trail
  BEGIN
    INSERT INTO public.audit_logs (company_id, user_id, action, entity_type, entity_id, new_data)
    VALUES (v_company_id, auth.uid(), 'repair', 'journal_entry', p_je_id,
      jsonb_build_object(
        'bill_number',  v_bill.bill_number,
        'rows_added',   v_rows_added,
        'body_debit',   v_body_debit,
        'body_credit',  v_body_credit
      ));
  EXCEPTION WHEN OTHERS THEN NULL;
  END;

  RETURN jsonb_build_object(
    'status',          CASE WHEN ABS(v_body_debit - v_body_credit) < 0.01 THEN 'repaired' ELSE 'partial' END,
    'rows_added',      v_rows_added,
    'new_body_debit',  v_body_debit,
    'new_body_credit', v_body_credit
  );
END;
$function$;

COMMIT;

NOTIFY pgrst, 'reload schema';

-- ── VERIFY after applying (expect: 9 | 7 | 2 | 0 | 0) ─────────────────────
-- SELECT (SELECT count(*) FROM pg_proc WHERE pronamespace = 'public'::regnamespace AND prosrc ~ 'phase155')      AS functions_expect_9,
--        (SELECT count(*) FROM pg_trigger WHERE tgname = 'a_pack_line')                                          AS line_triggers_expect_7,
--        (SELECT count(*) FROM pg_class WHERE relname IN ('v_invoice_line_returnable','v_bill_line_returnable')
--            AND 'security_invoker=true' = ANY (reloptions))                                                     AS safe_views_expect_2,
--        (SELECT count(*) FROM public.inventory_settings WHERE packs_enabled)                                    AS companies_on_expect_0,
--        (SELECT count(*) FROM public.product_units)                                                             AS packs_expect_0;
--
-- ── UNDO ──────────────────────────────────────────────────────────────────
-- Leave packs switched off: nothing uses the new objects. To restore the
-- functions as well, run scripts/undo-phase155-packs.sql (only while no
-- document uses a pack).
