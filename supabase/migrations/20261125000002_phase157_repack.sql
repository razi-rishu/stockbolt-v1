-- ═══════════════════════════════════════════════════════════════════════════
-- phase157 — Repack: turn one stocked product into another (inventory plan,
-- Part 7). Rule approved 2026-11-25, Document 3 C5.
-- ═══════════════════════════════════════════════════════════════════════════
-- 48 KG of loose sugar become 240 packets of 200 g. The packet is a product of
-- its own with its own stock; packing material can be used up the same way;
-- unpacking is the same document the other way round.
--
-- ACCOUNTING (Document 3 C5)
--   * Goods used leave at the exact company-wide cost; the product made comes
--     in at exactly that total. Value moves inside 1300: NO journal entry.
--   * Only wastage posts: Dr 6700 / Cr 1300, as C3.
--   * Void reverses both on the document's own date, at the original values.
--
-- STRICTER THAN OTHER DOCUMENTS, so the cost of what is made is always true:
--   * the goods used must be in stock in that warehouse, even where selling
--     without stock is allowed, and must have a cost;
--   * a product with sales still waiting for a cost (deferred COGS) cannot be
--     made by a repack: only a purchase bill settles those;
--   * wastage that needs approval as an inventory adjustment must be recorded
--     there: a repack is not a way around the approval.
--
-- OPTIONAL: inventory_settings.repack_enabled, default FALSE for every company.
--
-- ADDS: two tables, the switch, two functions (owned by ledger_writer), two
--   stock_ledger types (repack_in, repack_out), one journal source type
--   (stock_repack). The two CHECK lists are read from the live database and
--   extended, never replaced from this file.
--
-- SAFE TO APPLY: no data changes, no existing function changes. Needs phase154
-- and phase155. Re-runnable.
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

DO $guard$
BEGIN
  IF to_regprocedure('public._stock_issue_cost(uuid,uuid,numeric,numeric)') IS NULL
     OR to_regprocedure('public._unit_allows_decimals(uuid)') IS NULL THEN
    RAISE EXCEPTION 'phase157 stopped: run phase154 and phase155 first. Nothing was changed.';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'ledger_writer') THEN
    RAISE EXCEPTION 'phase157 stopped: role ledger_writer not found (phase119). Nothing was changed.';
  END IF;
END
$guard$;

-- ── 1. The switch ─────────────────────────────────────────────────────────
ALTER TABLE public.inventory_settings ADD COLUMN IF NOT EXISTS repack_enabled boolean NOT NULL DEFAULT false;

-- ── 2. Allowed values: extend the live lists ──────────────────────────────
DO $lists$
DECLARE r record; v_def text; v_new text;
BEGIN
  FOR r IN SELECT * FROM (VALUES
    ('stock_ledger',    'stock_ledger_type_check',           '''edit_reversal''::text', ', ''repack_in''::text, ''repack_out''::text', 'repack_in'),
    ('journal_entries', 'journal_entries_source_type_check', '''stock_transfer''::text', ', ''stock_repack''::text', 'stock_repack')
  ) AS v(tbl, con, anchor, addition, marker)
  LOOP
    SELECT pg_get_constraintdef(c.oid) INTO v_def FROM pg_constraint c
     WHERE c.conname = r.con AND c.conrelid = ('public.' || r.tbl)::regclass;
    IF v_def IS NULL THEN
      RAISE EXCEPTION 'phase157 stopped: constraint % not found. Nothing was changed.', r.con;
    END IF;
    IF position('''' || r.marker || '''' IN v_def) > 0 THEN CONTINUE; END IF;
    v_new := replace(v_def, r.anchor, r.anchor || r.addition);
    IF v_new = v_def THEN
      RAISE EXCEPTION 'phase157 stopped: % has an unexpected form. Nothing was changed. Send this message back.', r.con;
    END IF;
    EXECUTE format('ALTER TABLE public.%I DROP CONSTRAINT %I', r.tbl, r.con);
    EXECUTE format('ALTER TABLE public.%I ADD CONSTRAINT %I %s', r.tbl, r.con, v_new);
  END LOOP;
END
$lists$;

-- ── 3. Tables ─────────────────────────────────────────────────────────────
-- Products, warehouses and the company delete their repacks with them: none of
-- them can be deleted while it has stock movements, so only drafts can go.
CREATE TABLE IF NOT EXISTS public.stock_repacks (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id        uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  repack_number     text NOT NULL,
  date              date NOT NULL,
  warehouse_id      uuid NOT NULL REFERENCES public.warehouses(id) ON DELETE CASCADE,
  status            text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'confirmed', 'void')),
  output_product_id uuid NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
  output_quantity   numeric(15,3) NOT NULL CHECK (output_quantity > 0),
  notes             text,
  void_reason       text,
  voided_at         timestamptz,
  voided_by         uuid,
  created_by        uuid DEFAULT auth.uid(),
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  UNIQUE (company_id, repack_number)
);
CREATE INDEX IF NOT EXISTS stock_repacks_company_date_idx ON public.stock_repacks (company_id, date);
CREATE INDEX IF NOT EXISTS stock_repacks_warehouse_idx    ON public.stock_repacks (warehouse_id);
CREATE INDEX IF NOT EXISTS stock_repacks_output_idx       ON public.stock_repacks (output_product_id);

CREATE TABLE IF NOT EXISTS public.stock_repack_items (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  repack_id  uuid NOT NULL REFERENCES public.stock_repacks(id) ON DELETE CASCADE,
  kind       text NOT NULL CHECK (kind IN ('input', 'waste')),
  product_id uuid NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
  quantity   numeric(15,3) NOT NULL CHECK (quantity > 0),
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS stock_repack_items_repack_idx  ON public.stock_repack_items (repack_id);
CREATE INDEX IF NOT EXISTS stock_repack_items_product_idx ON public.stock_repack_items (product_id);
CREATE INDEX IF NOT EXISTS stock_repack_items_company_idx ON public.stock_repack_items (company_id);

DROP TRIGGER IF EXISTS stock_repacks_set_updated_at ON public.stock_repacks;
CREATE TRIGGER stock_repacks_set_updated_at BEFORE UPDATE ON public.stock_repacks
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.stock_repacks      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.stock_repack_items ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.stock_repacks, public.stock_repack_items FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.stock_repacks, public.stock_repack_items TO authenticated, ledger_writer;
GRANT ALL ON public.stock_repacks, public.stock_repack_items TO service_role;

DROP POLICY IF EXISTS tenant_isolation ON public.stock_repacks;
CREATE POLICY tenant_isolation ON public.stock_repacks FOR ALL
  USING (company_id = public.current_user_company_id()) WITH CHECK (company_id = public.current_user_company_id());
DROP POLICY IF EXISTS tenant_isolation ON public.stock_repack_items;
CREATE POLICY tenant_isolation ON public.stock_repack_items FOR ALL
  USING (company_id = public.current_user_company_id())
  WITH CHECK (company_id = public.current_user_company_id());

DO $pol$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['stock_repacks', 'stock_repack_items'] LOOP
    EXECUTE format('DROP POLICY IF EXISTS rbac_w_ins_%1$s ON public.%1$I', t);
    EXECUTE format('CREATE POLICY rbac_w_ins_%1$s ON public.%1$I AS RESTRICTIVE FOR INSERT WITH CHECK (public.has_perm(''inventory.write''))', t);
    EXECUTE format('DROP POLICY IF EXISTS rbac_w_upd_%1$s ON public.%1$I', t);
    EXECUTE format('CREATE POLICY rbac_w_upd_%1$s ON public.%1$I AS RESTRICTIVE FOR UPDATE USING (public.has_perm(''inventory.write'')) WITH CHECK (public.has_perm(''inventory.write''))', t);
    EXECUTE format('DROP POLICY IF EXISTS rbac_w_del_%1$s ON public.%1$I', t);
    EXECUTE format('CREATE POLICY rbac_w_del_%1$s ON public.%1$I AS RESTRICTIVE FOR DELETE USING (public.has_perm(''inventory.write''))', t);
  END LOOP;
END
$pol$;
DROP POLICY IF EXISTS branch_scope ON public.stock_repacks;
CREATE POLICY branch_scope ON public.stock_repacks AS RESTRICTIVE FOR ALL
  USING ((SELECT public._branch_restricted()) = false OR public._branch_allows_warehouse(warehouse_id))
  WITH CHECK ((SELECT public._branch_restricted()) = false OR public._branch_allows_warehouse(warehouse_id));
DROP POLICY IF EXISTS branch_scope ON public.stock_repack_items;
CREATE POLICY branch_scope ON public.stock_repack_items AS RESTRICTIVE FOR ALL
  USING ((SELECT public._branch_restricted()) = false OR EXISTS (SELECT 1 FROM public.stock_repacks d WHERE d.id = repack_id))
  WITH CHECK ((SELECT public._branch_restricted()) = false OR EXISTS (SELECT 1 FROM public.stock_repacks d WHERE d.id = repack_id));

-- ── 4. Clients write drafts only; everything belongs to the company ───────
CREATE OR REPLACE FUNCTION public.tg_stock_repack_guard()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF current_user = 'authenticated' AND OLD.status <> 'draft' THEN
      RAISE EXCEPTION 'repack_locked: only a draft repack can be deleted. Void a confirmed one.' USING ERRCODE = 'P0001';
    END IF;
    RETURN OLD;
  END IF;
  IF current_user = 'authenticated' THEN
    IF NEW.status <> 'draft' OR (TG_OP = 'UPDATE' AND OLD.status <> 'draft') THEN
      RAISE EXCEPTION 'repack_locked: a repack is confirmed or voided only through its own actions.' USING ERRCODE = 'P0001';
    END IF;
    IF TG_OP = 'INSERT' AND NOT EXISTS (SELECT 1 FROM public.inventory_settings s WHERE s.company_id = NEW.company_id AND s.repack_enabled) THEN
      RAISE EXCEPTION 'repack_off: Repack is not turned on in Inventory settings.' USING ERRCODE = 'P0001';
    END IF;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.warehouses w WHERE w.id = NEW.warehouse_id AND w.company_id = NEW.company_id)
     OR NOT EXISTS (SELECT 1 FROM public.products p WHERE p.id = NEW.output_product_id AND p.company_id = NEW.company_id) THEN
    RAISE EXCEPTION 'repack_invalid: warehouse or product not found in this company.' USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END;
$function$;
DROP TRIGGER IF EXISTS stock_repacks_guard ON public.stock_repacks;
CREATE TRIGGER stock_repacks_guard BEFORE INSERT OR UPDATE OR DELETE ON public.stock_repacks
  FOR EACH ROW EXECUTE FUNCTION public.tg_stock_repack_guard();

CREATE OR REPLACE FUNCTION public.tg_stock_repack_items_guard()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE v_id uuid; v_status text; v_company uuid;
BEGIN
  v_id := CASE WHEN TG_OP = 'DELETE' THEN OLD.repack_id ELSE NEW.repack_id END;
  SELECT r.status, r.company_id INTO v_status, v_company FROM public.stock_repacks r WHERE r.id = v_id;
  IF current_user = 'authenticated' AND v_status IS DISTINCT FROM 'draft' AND (TG_OP <> 'DELETE' OR v_status IS NOT NULL) THEN
    RAISE EXCEPTION 'repack_locked: the lines of a confirmed repack cannot be changed.' USING ERRCODE = 'P0001';
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  IF v_company IS NULL OR NEW.company_id <> v_company
     OR NOT EXISTS (SELECT 1 FROM public.products p WHERE p.id = NEW.product_id AND p.company_id = v_company) THEN
    RAISE EXCEPTION 'repack_invalid: product not found in this company.' USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END;
$function$;
DROP TRIGGER IF EXISTS stock_repack_items_guard ON public.stock_repack_items;
CREATE TRIGGER stock_repack_items_guard BEFORE INSERT OR UPDATE OR DELETE ON public.stock_repack_items
  FOR EACH ROW EXECUTE FUNCTION public.tg_stock_repack_items_guard();

REVOKE ALL ON FUNCTION public.tg_stock_repack_guard(), public.tg_stock_repack_items_guard() FROM PUBLIC, anon, authenticated;

-- ── 5. Confirm ────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.confirm_stock_repack(p_repack_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_user      uuid := auth.uid();
  v_company   uuid;
  v_doc       public.stock_repacks%ROWTYPE;
  v_lock      date;
  v_allow_dec boolean;
  v_currency  text;
  r           record;
  v_issue     record;
  v_mac       numeric(15,2);
  v_qty       numeric(15,3);
  v_made      numeric(15,2) := 0;   -- value of the goods used
  v_waste     numeric(15,2) := 0;
  v_unit      numeric(15,2);
  v_1300      uuid;
  v_6700      uuid;
  v_seq       bigint;
  v_je        uuid;
BEGIN
  SELECT company_id INTO v_company FROM public.profiles WHERE id = v_user;
  IF v_company IS NULL THEN RAISE EXCEPTION 'confirm_stock_repack: no company for user'; END IF;
  IF NOT public.has_perm('inventory.write') THEN
    RAISE EXCEPTION 'confirm_stock_repack: not allowed' USING ERRCODE = '42501';
  END IF;

  -- Locked: two people cannot confirm the same repack at once.
  SELECT * INTO v_doc FROM public.stock_repacks WHERE id = p_repack_id AND company_id = v_company FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'confirm_stock_repack: repack not found'; END IF;
  IF v_doc.status <> 'draft' THEN RAISE EXCEPTION 'confirm_stock_repack: already % ', v_doc.status; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.inventory_settings s WHERE s.company_id = v_company AND s.repack_enabled) THEN
    RAISE EXCEPTION 'repack_off: Repack is not turned on in Inventory settings.' USING ERRCODE = 'P0001';
  END IF;
  SELECT period_lock_date, COALESCE(currency, 'AED') INTO v_lock, v_currency FROM public.companies WHERE id = v_company;
  IF v_lock IS NOT NULL AND v_doc.date <= v_lock THEN
    RAISE EXCEPTION 'confirm_stock_repack: date % on or before period lock %', v_doc.date, v_lock;
  END IF;

  -- What is used and what is made.
  IF NOT EXISTS (SELECT 1 FROM public.stock_repack_items WHERE repack_id = v_doc.id AND kind = 'input') THEN
    RAISE EXCEPTION 'repack_no_input: enter what is used.' USING ERRCODE = 'P0001';
  END IF;
  IF EXISTS (SELECT 1 FROM public.stock_repack_items WHERE repack_id = v_doc.id AND product_id = v_doc.output_product_id) THEN
    RAISE EXCEPTION 'repack_same_product: the product made cannot also be used.' USING ERRCODE = 'P0001';
  END IF;
  FOR r IN
    SELECT p.sku, p.type, p.requires_serial, p.unit_id, x.quantity
      FROM (SELECT v_doc.output_product_id AS product_id, v_doc.output_quantity AS quantity
            UNION ALL SELECT i.product_id, i.quantity FROM public.stock_repack_items i WHERE i.repack_id = v_doc.id) x
      JOIN public.products p ON p.id = x.product_id
  LOOP
    IF r.type = 'service' OR COALESCE(r.requires_serial, false) THEN
      RAISE EXCEPTION 'repack_not_allowed: % is a service or has serial numbers.', r.sku USING ERRCODE = 'P0001';
    END IF;
    v_allow_dec := public._unit_allows_decimals(r.unit_id);
    IF r.quantity <> trunc(r.quantity) AND NOT v_allow_dec THEN
      RAISE EXCEPTION 'whole_units_only: % is counted in whole units (%).', r.sku, r.quantity USING ERRCODE = 'P0001';
    END IF;
  END LOOP;
  IF EXISTS (SELECT 1 FROM public.deferred_cogs_queue d
              WHERE d.company_id = v_company AND d.product_id = v_doc.output_product_id AND d.status = 'pending') THEN
    RAISE EXCEPTION 'repack_pending_cost: the product made has sales waiting for a cost. Only a purchase bill settles them.' USING ERRCODE = 'P0001';
  END IF;

  -- In stock in this warehouse, whatever the backorder setting.
  FOR r IN
    SELECT p.sku, i.product_id, SUM(i.quantity) AS need
      FROM public.stock_repack_items i JOIN public.products p ON p.id = i.product_id
     WHERE i.repack_id = v_doc.id GROUP BY p.sku, i.product_id
  LOOP
    SELECT COALESCE(SUM(direction * quantity), 0) INTO v_qty FROM public.stock_ledger
     WHERE company_id = v_company AND product_id = r.product_id AND warehouse_id = v_doc.warehouse_id;
    IF v_qty < r.need THEN
      RAISE EXCEPTION 'repack_not_enough: % has % in this warehouse, % needed.', r.sku, v_qty, r.need USING ERRCODE = 'P0001';
    END IF;
  END LOOP;

  -- Out: goods used, then wastage, each at the exact company-wide cost.
  FOR r IN
    SELECT i.*, p.sku FROM public.stock_repack_items i JOIN public.products p ON p.id = i.product_id
     WHERE i.repack_id = v_doc.id ORDER BY (i.kind = 'waste'), i.sort_order, i.id
  LOOP
    SELECT running_avg_cost INTO v_mac FROM public.stock_ledger
     WHERE company_id = v_company AND product_id = r.product_id ORDER BY seq DESC LIMIT 1;
    SELECT * INTO v_issue FROM public._stock_issue_cost(v_company, r.product_id, r.quantity, COALESCE(v_mac, 0));
    IF NOT v_issue.has_cost THEN
      RAISE EXCEPTION 'repack_no_cost: % has no cost yet.', r.sku USING ERRCODE = 'P0001';
    END IF;
    SELECT COALESCE(SUM(direction * quantity), 0) INTO v_qty FROM public.stock_ledger
     WHERE company_id = v_company AND product_id = r.product_id AND warehouse_id = v_doc.warehouse_id;
    INSERT INTO public.stock_ledger
      (company_id, product_id, warehouse_id, date, type, direction, quantity, unit_cost, total_cost,
       running_qty, running_avg_cost, related_doc_type, related_doc_id)
    VALUES
      (v_company, r.product_id, v_doc.warehouse_id, v_doc.date,
       CASE WHEN r.kind = 'waste' THEN 'adjustment_out' ELSE 'repack_out' END, -1,
       r.quantity, v_issue.unit_cost, v_issue.total_cost,
       v_qty - r.quantity, v_issue.unit_cost, 'stock_repack', v_doc.id);
    IF r.kind = 'waste' THEN v_waste := v_waste + v_issue.total_cost;
    ELSE v_made := v_made + v_issue.total_cost; END IF;
  END LOOP;
  IF v_made <= 0 THEN
    RAISE EXCEPTION 'repack_no_cost: the goods used have no value.' USING ERRCODE = 'P0001';
  END IF;

  -- In: exactly what was used, to the cent.
  v_unit := ROUND(v_made / v_doc.output_quantity, 2);
  SELECT COALESCE(SUM(direction * quantity), 0) INTO v_qty FROM public.stock_ledger
   WHERE company_id = v_company AND product_id = v_doc.output_product_id AND warehouse_id = v_doc.warehouse_id;
  INSERT INTO public.stock_ledger
    (company_id, product_id, warehouse_id, date, type, direction, quantity, unit_cost, total_cost,
     running_qty, running_avg_cost, related_doc_type, related_doc_id)
  VALUES
    (v_company, v_doc.output_product_id, v_doc.warehouse_id, v_doc.date, 'repack_in', 1,
     v_doc.output_quantity, v_unit, v_made, v_qty + v_doc.output_quantity, v_unit, 'stock_repack', v_doc.id);

  -- Wastage (Document 3 C3): Dr 6700 / Cr 1300.
  IF v_waste > 0 THEN
    IF public._approval_rule_applies(v_company, ARRAY['inventory_adjustment'], v_waste) THEN
      RAISE EXCEPTION 'repack_waste_approval: this wastage (%) needs approval. Record it as an inventory adjustment instead.', v_waste USING ERRCODE = 'P0001';
    END IF;
    SELECT id INTO v_1300 FROM public.chart_of_accounts WHERE company_id = v_company AND code = '1300' AND is_active LIMIT 1;
    SELECT id INTO v_6700 FROM public.chart_of_accounts WHERE company_id = v_company AND code = '6700' AND is_active LIMIT 1;
    IF v_1300 IS NULL OR v_6700 IS NULL THEN RAISE EXCEPTION 'Account 1300 or 6700 not found'; END IF;

    INSERT INTO public.document_sequences (company_id, prefix, current_value, format, pad_zeros, reset_yearly)
    VALUES (v_company, 'JE', 1001, 'JE-{NUMBER}', 0, false)
    ON CONFLICT (company_id, prefix) DO UPDATE SET current_value = public.document_sequences.current_value + 1, updated_at = NOW()
    RETURNING current_value INTO v_seq;
    INSERT INTO public.journal_entries
      (company_id, entry_number, date, description, source_type, source_id, currency, exchange_rate, total_debit, total_credit, created_by)
    VALUES
      (v_company, 'JE-' || v_seq, v_doc.date, 'Repack wastage — ' || v_doc.repack_number, 'stock_repack', v_doc.id,
       v_currency, 1.0, v_waste, v_waste, v_user)
    RETURNING id INTO v_je;
    INSERT INTO public.general_ledger
      (company_id, journal_entry_id, account_id, account_code, date, debit, credit, description, related_doc_type, related_doc_id)
    VALUES
      (v_company, v_je, v_6700, '6700', v_doc.date, v_waste, 0, 'Repack wastage — ' || v_doc.repack_number, 'stock_repack', v_doc.id),
      (v_company, v_je, v_1300, '1300', v_doc.date, 0, v_waste, 'Repack wastage — ' || v_doc.repack_number, 'stock_repack', v_doc.id);
  END IF;

  UPDATE public.stock_repacks SET status = 'confirmed' WHERE id = v_doc.id;
  IF NOT FOUND THEN RAISE EXCEPTION 'confirm_stock_repack: the repack could not be updated'; END IF;

  BEGIN
    INSERT INTO public.audit_logs (company_id, user_id, action, entity_type, entity_id, new_data)
    VALUES (v_company, v_user, 'confirm', 'stock_repack', v_doc.id,
      jsonb_build_object('repack_number', v_doc.repack_number, 'value', v_made, 'wastage', v_waste));
  EXCEPTION WHEN OTHERS THEN NULL;
  END;
  RETURN jsonb_build_object('repack_id', v_doc.id, 'repack_number', v_doc.repack_number, 'value', v_made, 'wastage', v_waste, 'je_id', v_je);
END;
$function$;

-- ── 6. Void ───────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.void_stock_repack(p_repack_id uuid, p_reason text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_user    uuid := auth.uid();
  v_company uuid;
  v_doc     public.stock_repacks%ROWTYPE;
  v_lock    date;
  v_allow   boolean;
  v_qty     numeric(15,3);
  v_sl      public.stock_ledger%ROWTYPE;
  v_je      public.journal_entries%ROWTYPE;
  v_gl      public.general_ledger%ROWTYPE;
  v_seq     bigint;
  v_rev     uuid;
  v_text    text;
BEGIN
  SELECT company_id INTO v_company FROM public.profiles WHERE id = v_user;
  IF v_company IS NULL THEN RAISE EXCEPTION 'void_stock_repack: no company for user'; END IF;
  IF NOT public.has_perm('inventory.write') THEN
    RAISE EXCEPTION 'void_stock_repack: not allowed' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO v_doc FROM public.stock_repacks WHERE id = p_repack_id AND company_id = v_company FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'void_stock_repack: repack not found'; END IF;
  IF v_doc.status <> 'confirmed' THEN RAISE EXCEPTION 'void_stock_repack: not confirmed (status=%)', v_doc.status; END IF;
  SELECT period_lock_date, COALESCE(allow_negative_stock, false) INTO v_lock, v_allow FROM public.companies WHERE id = v_company;
  IF v_lock IS NOT NULL AND v_doc.date <= v_lock THEN
    RAISE EXCEPTION 'void_stock_repack: voucher date % on or before period lock %', v_doc.date, v_lock;
  END IF;

  -- The goods made must still be here to be taken back.
  SELECT COALESCE(SUM(direction * quantity), 0) INTO v_qty FROM public.stock_ledger
   WHERE company_id = v_company AND product_id = v_doc.output_product_id AND warehouse_id = v_doc.warehouse_id;
  IF v_qty < v_doc.output_quantity AND NOT v_allow THEN
    RAISE EXCEPTION 'repack_output_gone: only % of the % made are left in this warehouse.', v_qty, v_doc.output_quantity USING ERRCODE = 'P0001';
  END IF;
  v_text := COALESCE(NULLIF(p_reason, ''), 'Void – ' || v_doc.repack_number);

  FOR v_sl IN
    SELECT * FROM public.stock_ledger
     WHERE company_id = v_company AND related_doc_type = 'stock_repack' AND related_doc_id = v_doc.id AND reversal_of_id IS NULL
     ORDER BY seq DESC
  LOOP
    SELECT COALESCE(SUM(direction * quantity), 0) INTO v_qty FROM public.stock_ledger
     WHERE company_id = v_company AND product_id = v_sl.product_id AND warehouse_id = v_sl.warehouse_id;
    INSERT INTO public.stock_ledger
      (company_id, product_id, warehouse_id, date, type, direction, quantity, unit_cost, total_cost,
       running_qty, running_avg_cost, related_doc_type, related_doc_id, reversal_of_id)
    VALUES
      (v_company, v_sl.product_id, v_sl.warehouse_id, v_sl.date, 'void', -v_sl.direction, v_sl.quantity, v_sl.unit_cost, v_sl.total_cost,
       v_qty - v_sl.direction * v_sl.quantity, v_sl.running_avg_cost, 'stock_repack', v_doc.id, v_sl.id);
  END LOOP;

  FOR v_je IN
    SELECT * FROM public.journal_entries
     WHERE company_id = v_company AND source_type = 'stock_repack' AND source_id = v_doc.id
       AND reversed_by_id IS NULL AND reversal_of_id IS NULL
  LOOP
    INSERT INTO public.document_sequences (company_id, prefix, current_value, format, pad_zeros, reset_yearly)
    VALUES (v_company, 'JE', 1001, 'JE-{NUMBER}', 0, false)
    ON CONFLICT (company_id, prefix) DO UPDATE SET current_value = public.document_sequences.current_value + 1, updated_at = NOW()
    RETURNING current_value INTO v_seq;
    INSERT INTO public.journal_entries
      (company_id, entry_number, date, description, source_type, source_id, currency, exchange_rate, total_debit, total_credit, reversal_of_id, created_by)
    VALUES
      (v_company, 'JE-' || v_seq, v_je.date, v_text, v_je.source_type, v_doc.id, v_je.currency, v_je.exchange_rate,
       v_je.total_credit, v_je.total_debit, v_je.id, v_user)
    RETURNING id INTO v_rev;
    FOR v_gl IN SELECT * FROM public.general_ledger WHERE journal_entry_id = v_je.id LOOP
      INSERT INTO public.general_ledger
        (company_id, journal_entry_id, account_id, account_code, date, debit, credit, description, related_doc_type, related_doc_id, reversal_of_id)
      VALUES
        (v_company, v_rev, v_gl.account_id, v_gl.account_code, v_gl.date, v_gl.credit, v_gl.debit, v_text, v_gl.related_doc_type, v_gl.related_doc_id, v_gl.id);
    END LOOP;
    UPDATE public.journal_entries SET reversed_by_id = v_rev WHERE id = v_je.id;
  END LOOP;

  UPDATE public.stock_repacks SET status = 'void', void_reason = p_reason, voided_at = now(), voided_by = v_user WHERE id = v_doc.id;
  IF NOT FOUND THEN RAISE EXCEPTION 'void_stock_repack: the repack could not be updated'; END IF;

  BEGIN
    INSERT INTO public.audit_logs (company_id, user_id, action, entity_type, entity_id, new_data)
    VALUES (v_company, v_user, 'void', 'stock_repack', v_doc.id, jsonb_build_object('repack_number', v_doc.repack_number, 'reason', p_reason));
  EXCEPTION WHEN OTHERS THEN NULL;
  END;
  RETURN jsonb_build_object('repack_id', v_doc.id, 'repack_number', v_doc.repack_number);
END;
$function$;

-- ledger_writer may own functions only while it briefly holds CREATE (phase119).
GRANT EXECUTE ON FUNCTION public._approval_rule_applies(uuid, text[], numeric) TO ledger_writer;
GRANT CREATE ON SCHEMA public TO ledger_writer;
ALTER FUNCTION public.confirm_stock_repack(uuid) OWNER TO ledger_writer;
ALTER FUNCTION public.void_stock_repack(uuid, text) OWNER TO ledger_writer;
REVOKE CREATE ON SCHEMA public FROM ledger_writer;
REVOKE ALL ON FUNCTION public.confirm_stock_repack(uuid), public.void_stock_repack(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.confirm_stock_repack(uuid), public.void_stock_repack(uuid, text) TO authenticated, service_role;

COMMIT;

NOTIFY pgrst, 'reload schema';

-- ── VERIFY after applying (expect: 2 | 2 | 2 | true | true | 0 | false) ───
-- SELECT (SELECT count(*) FROM pg_class WHERE relname IN ('stock_repacks','stock_repack_items') AND relrowsecurity)          AS tables_expect_2,
--        (SELECT count(*) FROM pg_proc WHERE proname IN ('confirm_stock_repack','void_stock_repack')
--            AND prosecdef AND pg_get_userbyid(proowner) = 'ledger_writer')                                                  AS functions_expect_2,
--        (SELECT count(*) FROM pg_trigger WHERE tgname IN ('stock_repacks_guard','stock_repack_items_guard'))                AS guards_expect_2,
--        (SELECT pg_get_constraintdef(oid) ~ 'repack_in'    FROM pg_constraint WHERE conname = 'stock_ledger_type_check')             AS stock_types,
--        (SELECT pg_get_constraintdef(oid) ~ 'stock_repack' FROM pg_constraint WHERE conname = 'journal_entries_source_type_check')   AS journal_types,
--        (SELECT count(*) FROM public.inventory_settings WHERE repack_enabled)                                               AS companies_on_expect_0,
--        has_schema_privilege('ledger_writer', 'public', 'CREATE')                                                           AS writer_create_expect_false;
--
-- ── UNDO ──────────────────────────────────────────────────────────────────
-- Leave Repack switched off: nothing uses the new objects.
