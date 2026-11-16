-- ═══════════════════════════════════════════════════════════════════════════
-- phase134 — close the write-permission gaps found in the 2026-11-15 audit
--
-- ROOT CAUSES
--  1. Tables whose only write rule was "same company" (tenant_isolation), so
--     ANY user of the company — including a read-only Viewer — could change
--     them through the REST API: attachments, notifications,
--     print_template_defaults, vehicle_engines / _generations / _variants,
--     vendor_bill_landed_costs, and (see 2) purchase_returns(+items).
--  2. purchase_returns / purchase_return_items HAD purchasing.write rules, but
--     they were created PERMISSIVE. Permissive policies are OR-ed with
--     tenant_isolation, so they never restricted anything.
--  3. document_sequences and pdc_cheques only required "any write permission"
--     (has_any_write): an inventory-only user could rewind invoice numbering
--     or edit a cheque's status directly.
--  4. audit_logs accepted inserts naming ANY user of the company as user_id,
--     so history could be written in someone else's name.
--  5. update_payment_draft (SECURITY DEFINER, bypasses RLS) was executable by
--     anon and checked neither the caller nor the company: anyone holding a
--     draft payment's id could rewrite it. _recompute_payment_allocation_status
--     (an internal trigger helper) was also callable by anyone.
--
-- HOW THE FIXES AVOID BREAKING POSTING
--  Posting functions run as ledger_writer, which is a MEMBER of
--  authenticated — so a policy "TO authenticated" would bind them too.
--  Direct-write rules here therefore test current_user = 'authenticated'
--  (the REST API, and functions that run as the caller) and leave
--  current_user = 'ledger_writer' / 'postgres' (posting and system
--  functions, which carry their own checks) alone.
--
-- FIXES (intended rights match each table's sibling tables)
--  attachments, notifications   no client writes at all (not written by the
--                               app; system functions unaffected)
--  print_template_defaults      settings.write   (as print_templates)
--  vehicle_engines/_generations/_variants  inventory.write (as vehicle_makes/_models)
--  vendor_bill_landed_costs     purchasing.write (as vendor_bills)
--  purchase_returns(+items)     the existing purchasing.write rules made RESTRICTIVE
--  pdc_cheques                  direct writes: accounting.write (banking);
--                               posting functions (cheques taken with a
--                               customer receipt) unchanged
--  document_sequences           settings.write to change numbering; anyone
--                               with a write permission may still TAKE the
--                               next number (+1), start a new series at the
--                               standard default, or apply the yearly reset
--  audit_logs                   insert only as yourself (user_id = you or empty)
--  deposit_pdc                  accounting.write (it reported success while
--                               the new rule silently updated nothing)
--  save_bank_reconciliation     accounting.write (any company user could save one)
--  update_payment_draft         caller's company + sales.write (receipt) /
--                               purchasing.write (payment); anon revoked
--  _recompute_payment_allocation_status  no longer callable from outside
--  setup_drafts                 unchanged — each user's own wizard draft (intended)
--
-- PRE-CHECK on prod (CR-stripped md5) — expected
--   update_payment_draft 9ee18e229d9dbc4ca42bcbd89bb7d45d, deposit_pdc 1606d2dc052f109f7a8508715361be57,
--   save_bank_reconciliation 14780ab2aab7a8c6887f2c34782a752f:
--   SELECT md5(replace(pg_get_functiondef('public.update_payment_draft(uuid,jsonb,jsonb)'::regprocedure), chr(13), '')),
--          md5(replace(pg_get_functiondef('public.deposit_pdc(uuid)'::regprocedure), chr(13), '')),
--          md5(replace(pg_get_functiondef('public.save_bank_reconciliation(uuid,uuid,date,numeric,uuid[],text,boolean)'::regprocedure), chr(13), ''));
-- If it differs, STOP and send the result.
--
-- SAFE TO APPLY: policies, one trigger, grants, one function patched (guard
-- only). No data changes. One transaction; re-runnable. Rollback at the end.
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

-- ── 1. No client writes: attachments, notifications ────────────────────────
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.attachments, public.notifications FROM anon, authenticated;
-- ledger_writer inherits authenticated; it never writes these, but keep any
-- system path that might: grant it explicitly.
GRANT INSERT, UPDATE, DELETE ON public.attachments, public.notifications TO ledger_writer;

-- ── 2. Restrictive write rules, applied to direct (caller-role) writes ────
DO $$
DECLARE
  r record;
BEGIN
  FOR r IN SELECT * FROM (VALUES
      ('print_template_defaults',  'settings.write'),
      ('vehicle_engines',          'inventory.write'),
      ('vehicle_generations',      'inventory.write'),
      ('vehicle_variants',         'inventory.write'),
      ('vendor_bill_landed_costs', 'purchasing.write'),
      ('pdc_cheques',              'accounting.write')) AS t(tbl, perm)
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS p134_ins ON public.%I', r.tbl);
    EXECUTE format('DROP POLICY IF EXISTS p134_upd ON public.%I', r.tbl);
    EXECUTE format('DROP POLICY IF EXISTS p134_del ON public.%I', r.tbl);
    EXECUTE format($f$CREATE POLICY p134_ins ON public.%I AS RESTRICTIVE FOR INSERT
      WITH CHECK (current_user <> 'authenticated' OR public.has_perm(%L))$f$, r.tbl, r.perm);
    EXECUTE format($f$CREATE POLICY p134_upd ON public.%I AS RESTRICTIVE FOR UPDATE
      USING (current_user <> 'authenticated' OR public.has_perm(%L))
      WITH CHECK (current_user <> 'authenticated' OR public.has_perm(%L))$f$, r.tbl, r.perm, r.perm);
    EXECUTE format($f$CREATE POLICY p134_del ON public.%I AS RESTRICTIVE FOR DELETE
      USING (current_user <> 'authenticated' OR public.has_perm(%L))$f$, r.tbl, r.perm);
  END LOOP;
END $$;

-- ── 3. purchase_returns(+items): make the existing rules restrictive ──────
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['purchase_returns', 'purchase_return_items'] LOOP
    EXECUTE format('DROP POLICY IF EXISTS rbac_w_ins_%s ON public.%I', t, t);
    EXECUTE format('DROP POLICY IF EXISTS rbac_w_upd_%s ON public.%I', t, t);
    EXECUTE format('DROP POLICY IF EXISTS rbac_w_del_%s ON public.%I', t, t);
    EXECUTE format($f$CREATE POLICY rbac_w_ins_%s ON public.%I AS RESTRICTIVE FOR INSERT
      WITH CHECK (public.has_perm('purchasing.write'))$f$, t, t);
    EXECUTE format($f$CREATE POLICY rbac_w_upd_%s ON public.%I AS RESTRICTIVE FOR UPDATE
      USING (public.has_perm('purchasing.write')) WITH CHECK (public.has_perm('purchasing.write'))$f$, t, t);
    EXECUTE format($f$CREATE POLICY rbac_w_del_%s ON public.%I AS RESTRICTIVE FOR DELETE
      USING (public.has_perm('purchasing.write'))$f$, t, t);
  END LOOP;
END $$;

-- ── 4. Document numbering: take the next number, but not rewrite it ───────
CREATE OR REPLACE FUNCTION public.tg_document_sequences_guard()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $function$
BEGIN
  -- Posting / system functions and Settings users: unrestricted.
  IF current_user <> 'authenticated' OR public.has_perm('settings.write') THEN
    RETURN COALESCE(NEW, OLD);
  END IF;
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Changing document numbering needs the Settings permission.' USING ERRCODE = '42501';
  END IF;
  IF TG_OP = 'INSERT' THEN
    -- Starting a series at the standard default (get_next_document_number /
    -- open_pos_session do exactly this on first use).
    IF NEW.current_value = 1000 AND NEW.pad_zeros = 0 AND NEW.reset_yearly = false
       AND NEW.format = NEW.prefix || '-{NUMBER}' THEN
      RETURN NEW;
    END IF;
    RAISE EXCEPTION 'Changing document numbering needs the Settings permission.' USING ERRCODE = '42501';
  END IF;
  -- UPDATE: only "take the next number" or the yearly reset; nothing else moves.
  IF NEW.company_id = OLD.company_id AND NEW.prefix = OLD.prefix
     AND NEW.format IS NOT DISTINCT FROM OLD.format
     AND NEW.pad_zeros IS NOT DISTINCT FROM OLD.pad_zeros
     AND NEW.reset_yearly IS NOT DISTINCT FROM OLD.reset_yearly
     AND (
       (NEW.current_value = OLD.current_value + 1
        AND NEW.last_reset_year IS NOT DISTINCT FROM OLD.last_reset_year)
       OR (OLD.reset_yearly AND NEW.current_value = 0
           AND NEW.last_reset_year = EXTRACT(YEAR FROM CURRENT_DATE)::int
           AND COALESCE(OLD.last_reset_year, 0) < NEW.last_reset_year)
     ) THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'Changing document numbering needs the Settings permission.' USING ERRCODE = '42501';
END;
$function$;

DROP TRIGGER IF EXISTS document_sequences_guard ON public.document_sequences;
CREATE TRIGGER document_sequences_guard
  BEFORE INSERT OR UPDATE OR DELETE ON public.document_sequences
  FOR EACH ROW EXECUTE FUNCTION public.tg_document_sequences_guard();
REVOKE ALL ON FUNCTION public.tg_document_sequences_guard() FROM PUBLIC, anon, authenticated;

-- ── 5. Audit log: write only as yourself ──────────────────────────────────
DROP POLICY IF EXISTS audit_logs_insert ON public.audit_logs;
CREATE POLICY audit_logs_insert ON public.audit_logs FOR INSERT
  WITH CHECK (company_id = public.current_user_company_id()
              AND (user_id IS NULL OR user_id = auth.uid()));

-- ── 6. update_payment_draft: caller check (patched from the live definition)
CREATE OR REPLACE FUNCTION public.update_payment_draft(p_payment_id uuid, p_row jsonb, p_allocations jsonb DEFAULT NULL::jsonb)
 RETURNS payments
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_pmt          public.payments;
  v_company_id   UUID;
  v_type         TEXT;
  v_new_contact  UUID;
  v_alloc        JSONB;
  v_doc_type     TEXT;
  v_doc_id       UUID;
  v_amount       NUMERIC(15,2);
  v_doc_contact  UUID;
  v_total_alloc  NUMERIC(15,2) := 0;
  v_new_amount   NUMERIC(15,2);
BEGIN
  -- 1. Lock the payment row and assert it's a draft. If not, we refuse
  --    immediately — confirmed/void payments already have GL postings
  --    that were computed from the existing row, so a silent update would
  --    desync the ledger.
  SELECT * INTO v_pmt
  FROM public.payments
  WHERE id = p_payment_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'update_payment_draft: payment % not found', p_payment_id
      USING ERRCODE = 'P0002';
  END IF;

  IF v_pmt.status <> 'draft' THEN
    RAISE EXCEPTION
      'update_payment_draft: cannot edit payment %; status is % (only draft is editable)',
      v_pmt.payment_number, v_pmt.status
      USING ERRCODE = 'P0001';
  END IF;

  v_company_id := v_pmt.company_id;
  v_type       := v_pmt.type;

  -- phase134 — caller check. This function bypasses RLS (SECURITY DEFINER,
  -- owner postgres) and was callable by anyone, for any company's payment.
  -- Same rule as the payments table's own policies: the caller's company,
  -- and sales.write for a receipt (inbound) / purchasing.write for a payment
  -- (outbound). Server-side callers (service role) keep working.
  IF auth.uid() IS NULL THEN
    IF session_user = 'authenticator' AND coalesce(auth.role(), '') <> 'service_role' THEN
      RAISE EXCEPTION 'update_payment_draft: not signed in' USING ERRCODE = '42501';
    END IF;
  ELSE
    IF v_company_id IS DISTINCT FROM public.current_user_company_id() THEN
      RAISE EXCEPTION 'update_payment_draft: payment % not found', p_payment_id USING ERRCODE = 'P0002';
    END IF;
    PERFORM public.auth_require(CASE WHEN v_type = 'outbound' THEN 'purchasing.write' ELSE 'sales.write' END);
  END IF;

  -- 2. Resolve the (possibly new) contact_id from the JSONB. Default to
  --    the existing one if not provided so partial updates work.
  v_new_contact := COALESCE(
    (p_row->>'contact_id')::UUID,
    v_pmt.contact_id
  );

  v_new_amount := COALESCE(
    (p_row->>'amount')::NUMERIC(15,2),
    v_pmt.amount
  );

  IF v_new_amount <= 0 THEN
    RAISE EXCEPTION 'update_payment_draft: amount must be > 0 (got %)', v_new_amount
      USING ERRCODE = 'P0001';
  END IF;

  -- 3. Period lock — same rule as confirm. A draft dated on/before the
  --    lock date cannot be edited (would let users back-date around the
  --    close).
  IF v_pmt.date IS NOT NULL THEN
    DECLARE v_lock_date DATE;
    BEGIN
      SELECT period_lock_date INTO v_lock_date
      FROM public.companies WHERE id = v_company_id;
      IF v_lock_date IS NOT NULL
         AND COALESCE((p_row->>'date')::DATE, v_pmt.date) <= v_lock_date THEN
        RAISE EXCEPTION
          'update_payment_draft: date % is on/before period lock %',
          COALESCE((p_row->>'date')::DATE, v_pmt.date), v_lock_date
          USING ERRCODE = 'P0001';
      END IF;
    END;
  END IF;

  -- 4. Apply whitelisted updates. NEVER touch id, company_id, type,
  --    payment_number, status, void_*, created_at.
  UPDATE public.payments SET
    contact_id        = v_new_contact,
    date              = COALESCE((p_row->>'date')::DATE,              date),
    amount            = v_new_amount,
    currency          = COALESCE( p_row->>'currency',                 currency),
    exchange_rate     = COALESCE((p_row->>'exchange_rate')::NUMERIC,  exchange_rate),
    payment_method_id = CASE WHEN p_row ? 'payment_method_id'
                             THEN NULLIF(p_row->>'payment_method_id','')::UUID
                             ELSE payment_method_id END,
    bank_account_id   = CASE WHEN p_row ? 'bank_account_id'
                             THEN NULLIF(p_row->>'bank_account_id','')::UUID
                             ELSE bank_account_id END,
    reference         = CASE WHEN p_row ? 'reference'
                             THEN NULLIF(p_row->>'reference','')
                             ELSE reference END,
    classification    = COALESCE( p_row->>'classification',           classification),
    notes             = CASE WHEN p_row ? 'notes'
                             THEN NULLIF(p_row->>'notes','')
                             ELSE notes END,
    updated_at        = NOW()
  WHERE id = p_payment_id
  RETURNING * INTO v_pmt;

  -- 5. Replace allocations atomically (only if caller provided them).
  --    NULL = don't touch existing allocations.
  --    [] / [...] = replace whole set.
  --    Drafts have no GL yet, so this is safe to do without reversal.
  IF p_allocations IS NULL THEN
    -- Caller chose to leave allocations untouched. Still need to validate
    -- that existing total <= new amount (the amount may have shrunk).
    SELECT COALESCE(SUM(amount_applied), 0) INTO v_total_alloc
    FROM public.payment_allocations
    WHERE payment_id = p_payment_id;

    IF v_total_alloc > v_new_amount + 0.005 THEN
      RAISE EXCEPTION
        'update_payment_draft: existing allocations total % exceed new payment amount % — clear allocations first',
        v_total_alloc, v_new_amount
        USING ERRCODE = 'P0001';
    END IF;
    RETURN v_pmt;
  END IF;

  DELETE FROM public.payment_allocations
   WHERE payment_id = p_payment_id;

  IF jsonb_typeof(p_allocations) = 'array' THEN
    FOR v_alloc IN SELECT * FROM jsonb_array_elements(p_allocations)
    LOOP
      v_doc_type := v_alloc->>'doc_type';
      v_doc_id   := (v_alloc->>'doc_id')::UUID;
      v_amount   := (v_alloc->>'amount_applied')::NUMERIC(15,2);

      IF v_amount IS NULL OR v_amount <= 0 THEN
        RAISE EXCEPTION
          'update_payment_draft: allocation amount must be > 0 (got %)', v_amount
          USING ERRCODE = 'P0001';
      END IF;

      -- doc_type must match payment direction
      IF v_type = 'inbound'  AND v_doc_type NOT IN ('invoice','credit_note') THEN
        RAISE EXCEPTION
          'update_payment_draft: inbound payment cannot allocate to %', v_doc_type
          USING ERRCODE = 'P0001';
      END IF;
      IF v_type = 'outbound' AND v_doc_type NOT IN ('vendor_bill','debit_note') THEN
        RAISE EXCEPTION
          'update_payment_draft: outbound payment cannot allocate to %', v_doc_type
          USING ERRCODE = 'P0001';
      END IF;

      -- doc must exist in this company, and belong to the same contact
      v_doc_contact := NULL;
      IF v_doc_type = 'invoice' THEN
        SELECT contact_id INTO v_doc_contact
        FROM public.invoices
        WHERE id = v_doc_id AND company_id = v_company_id;
      ELSIF v_doc_type = 'vendor_bill' THEN
        SELECT supplier_id INTO v_doc_contact
        FROM public.vendor_bills
        WHERE id = v_doc_id AND company_id = v_company_id;
      ELSIF v_doc_type = 'credit_note' THEN
        SELECT contact_id INTO v_doc_contact
        FROM public.credit_notes
        WHERE id = v_doc_id AND company_id = v_company_id;
      ELSIF v_doc_type = 'debit_note' THEN
        SELECT supplier_id INTO v_doc_contact
        FROM public.debit_notes
        WHERE id = v_doc_id AND company_id = v_company_id;
      END IF;

      IF v_doc_contact IS NULL THEN
        RAISE EXCEPTION
          'update_payment_draft: allocation doc % (%) not found in this company',
          v_doc_id, v_doc_type
          USING ERRCODE = 'P0001';
      END IF;

      IF v_doc_contact <> v_new_contact THEN
        RAISE EXCEPTION
          'update_payment_draft: allocation doc % belongs to a different contact than the payment',
          v_doc_id
          USING ERRCODE = 'P0001';
      END IF;

      INSERT INTO public.payment_allocations
        (company_id, payment_id, doc_type, doc_id, amount_applied)
      VALUES
        (v_company_id, p_payment_id, v_doc_type, v_doc_id, v_amount);

      v_total_alloc := v_total_alloc + v_amount;
    END LOOP;
  END IF;

  -- 6. Total allocations cannot exceed payment amount (would create
  --    over-applied state on confirm).
  IF v_total_alloc > v_new_amount + 0.005 THEN
    RAISE EXCEPTION
      'update_payment_draft: allocations total % exceeds payment amount %',
      v_total_alloc, v_new_amount
      USING ERRCODE = 'P0001';
  END IF;

  RETURN v_pmt;
END;
$function$;

REVOKE ALL ON FUNCTION public.update_payment_draft(uuid, jsonb, jsonb) FROM PUBLIC, anon;

-- ── 6b. deposit_pdc: refuse without the banking permission (patched from live)
CREATE OR REPLACE FUNCTION public.deposit_pdc(p_pdc_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
AS $function$
DECLARE v_user_id UUID := auth.uid(); v_company_id UUID; v_pdc public.pdc_cheques%ROWTYPE;
BEGIN
  SELECT company_id INTO v_company_id FROM public.profiles WHERE id = v_user_id;
  IF v_company_id IS NULL THEN RAISE EXCEPTION 'deposit_pdc: no company for user %', v_user_id; END IF;
  -- phase134 — depositing a cheque is a banking action (as the pdc_cheques
  -- write rule): refuse clearly instead of silently updating nothing.
  PERFORM public.auth_require('accounting.write');
  SELECT * INTO v_pdc FROM public.pdc_cheques WHERE id = p_pdc_id AND company_id = v_company_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'deposit_pdc: PDC % not found', p_pdc_id; END IF;
  IF v_pdc.type <> 'received' THEN RAISE EXCEPTION 'deposit_pdc: only received PDCs can be deposited'; END IF;
  IF v_pdc.status <> 'pending' THEN RAISE EXCEPTION 'deposit_pdc: PDC must be pending to deposit (status=%)', v_pdc.status; END IF;

  UPDATE public.pdc_cheques SET status = 'deposited', updated_at = NOW() WHERE id = p_pdc_id;

  INSERT INTO public.audit_logs (company_id, entity_type, entity_id, action, user_id, new_data)
  VALUES (v_company_id, 'pdc_cheques', p_pdc_id, 'update', v_user_id, jsonb_build_object('status', 'deposited'));

  RETURN jsonb_build_object('pdc_id', p_pdc_id, 'status', 'deposited');
END; $function$;
GRANT EXECUTE ON FUNCTION public.update_payment_draft(uuid, jsonb, jsonb) TO authenticated;

-- ── 6c. save_bank_reconciliation: banking permission (patched from live) ─
CREATE OR REPLACE FUNCTION public.save_bank_reconciliation(p_company_id uuid, p_bank_account_id uuid, p_statement_end_date date, p_statement_closing_balance numeric, p_gl_line_ids uuid[], p_notes text DEFAULT NULL::text, p_lock boolean DEFAULT false)
 RETURNS bank_reconciliations
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_bank_coa_id UUID;
  v_recon       public.bank_reconciliations;
  v_existing_id UUID;
  v_book_bal    NUMERIC(15,2) := 0;
  v_line_count  INTEGER       := 0;
  v_user_id     UUID;
BEGIN
  -- global06 (B2): company-wide ledger/report data is not for branch-restricted users.
  PERFORM public._branch_require_unrestricted();

  -- ---- Phase 65 (AC-V2) cross-tenant guard --------------------------------
  -- This function is SECURITY DEFINER, so it bypasses RLS. Without this check
  -- any authenticated user could pass another company's UUID and read or
  -- write that tenant's data.
  --
  -- Two deliberate carve-outs keep existing behaviour intact:
  --   * auth.uid() IS NULL  -> service_role / maintenance / the test harness
  --   * caller has no company yet -> onboarding, where seed_default_tax_rates
  --     runs from a trigger on companies INSERT before the profile is linked
  -- phase109 (E2): no caller without a company passes. A missing user is
  -- allowed only for trusted server-side callers: the service_role key, or a
  -- direct database session (SQL editor, migrations), whose session_user is
  -- not PostgREST's 'authenticator'.
  IF auth.uid() IS NULL THEN
    IF session_user = 'authenticator' AND coalesce(auth.role(), '') <> 'service_role' THEN
      RAISE EXCEPTION 'save_bank_reconciliation: not signed in' USING ERRCODE = '42501';
    END IF;
  ELSIF p_company_id IS DISTINCT FROM public.current_user_company_id() THEN
    RAISE EXCEPTION 'save_bank_reconciliation: cross-tenant access denied' USING ERRCODE = '42501';
  END IF;
  -- phase134 — saving a reconciliation needs the banking permission, as
  -- deleting one already did (phase109c); before, any company user could.
  IF auth.uid() IS NOT NULL THEN
    PERFORM public.auth_require('accounting.write');
  END IF;
  -- ---- end Phase 65 -------------------------------------------------------
  v_user_id := auth.uid();
  SELECT coa_account_id INTO v_bank_coa_id
  FROM public.bank_accounts
  WHERE id = p_bank_account_id AND company_id = p_company_id;
  IF v_bank_coa_id IS NULL THEN
    RAISE EXCEPTION 'save_bank_reconciliation: bank account % not found in company %',
      p_bank_account_id, p_company_id USING ERRCODE = 'P0002';
  END IF;

  SELECT id INTO v_existing_id FROM public.bank_reconciliations
  WHERE company_id = p_company_id AND bank_account_id = p_bank_account_id
    AND statement_end_date = p_statement_end_date;

  IF v_existing_id IS NOT NULL THEN
    SELECT * INTO v_recon FROM public.bank_reconciliations WHERE id = v_existing_id;
    IF v_recon.status = 'locked' THEN
      RAISE EXCEPTION 'save_bank_reconciliation: reconciliation % is locked, cannot edit',
        v_existing_id USING ERRCODE = 'P0001';
    END IF;
    UPDATE public.general_ledger SET reconciliation_id = NULL
     WHERE reconciliation_id = v_existing_id;
  ELSE
    INSERT INTO public.bank_reconciliations
      (company_id, bank_account_id, statement_end_date, statement_closing_balance,
       reconciled_book_balance, outstanding_amount, line_count, notes, created_by)
    VALUES
      (p_company_id, p_bank_account_id, p_statement_end_date,
       p_statement_closing_balance, 0, 0, 0, p_notes, v_user_id)
    RETURNING * INTO v_recon;
    v_existing_id := v_recon.id;
  END IF;

  IF array_length(p_gl_line_ids, 1) IS NOT NULL THEN
    WITH validated AS (
      SELECT gl.id, gl.debit, gl.credit FROM public.general_ledger gl
      WHERE gl.id = ANY(p_gl_line_ids) AND gl.company_id = p_company_id
        AND gl.account_id = v_bank_coa_id
        AND (gl.reconciliation_id IS NULL OR gl.reconciliation_id = v_existing_id)
        AND gl.date <= p_statement_end_date
    )
    SELECT COALESCE(SUM(debit) - SUM(credit), 0), COUNT(*)
      INTO v_book_bal, v_line_count FROM validated;

    IF v_line_count <> array_length(p_gl_line_ids, 1) THEN
      RAISE EXCEPTION
        'save_bank_reconciliation: % of % GL lines rejected (wrong bank, already reconciled elsewhere, or after statement date)',
        array_length(p_gl_line_ids, 1) - v_line_count, array_length(p_gl_line_ids, 1)
        USING ERRCODE = 'P0001';
    END IF;
    UPDATE public.general_ledger SET reconciliation_id = v_existing_id
     WHERE id = ANY(p_gl_line_ids);
  END IF;

  UPDATE public.bank_reconciliations
     SET statement_closing_balance = p_statement_closing_balance,
         reconciled_book_balance   = v_book_bal,
         outstanding_amount        = p_statement_closing_balance - v_book_bal,
         line_count                = v_line_count, notes = p_notes,
         status = CASE WHEN p_lock THEN 'locked' ELSE 'open' END,
         locked_at = CASE WHEN p_lock THEN NOW() ELSE NULL END,
         locked_by = CASE WHEN p_lock THEN v_user_id ELSE NULL END
   WHERE id = v_existing_id RETURNING * INTO v_recon;
  RETURN v_recon;
END;
$function$;

-- ── 7. Internal trigger helper: not callable from outside ─────────────────
REVOKE ALL ON FUNCTION public._recompute_payment_allocation_status(uuid) FROM PUBLIC, anon, authenticated;

COMMIT;

-- ── Verify after applying (read-only) — expect all true ───────────────────
-- SELECT
--   NOT has_table_privilege('authenticated', 'public.notifications', 'INSERT') AS notif_closed,
--   NOT has_table_privilege('authenticated', 'public.attachments', 'UPDATE') AS attach_closed,
--   (SELECT count(*) FROM pg_policies WHERE policyname LIKE 'p134_%') = 18 AS direct_write_rules,
--   (SELECT bool_and(permissive = 'RESTRICTIVE') FROM pg_policies
--     WHERE tablename IN ('purchase_returns','purchase_return_items') AND policyname LIKE 'rbac_w_%') AS returns_restrictive,
--   EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'document_sequences_guard') AS numbering_guard,
--   NOT has_function_privilege('anon', 'public.update_payment_draft(uuid,jsonb,jsonb)', 'EXECUTE') AS payment_fn_closed,
--   NOT has_function_privilege('authenticated', 'public._recompute_payment_allocation_status(uuid)', 'EXECUTE') AS helper_closed;
--
-- ── ROLLBACK ──────────────────────────────────────────────────────────────
--   GRANT INSERT, UPDATE, DELETE ON public.attachments, public.notifications TO authenticated;
--   DROP POLICY p134_ins/p134_upd/p134_del ON each of: print_template_defaults, vehicle_engines,
--     vehicle_generations, vehicle_variants, vendor_bill_landed_costs, pdc_cheques;
--   recreate the six purchase_returns / purchase_return_items rbac_w_* policies as PERMISSIVE;
--   DROP TRIGGER document_sequences_guard ON public.document_sequences;
--   DROP FUNCTION public.tg_document_sequences_guard();
--   recreate audit_logs_insert WITH CHECK (company_id = current_user_company_id());
--   re-run the pre-phase134 update_payment_draft definition and GRANT EXECUTE ... TO anon;
--   GRANT EXECUTE ON FUNCTION public._recompute_payment_allocation_status(uuid) TO PUBLIC;
