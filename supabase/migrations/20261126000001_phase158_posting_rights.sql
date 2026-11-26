-- ═══════════════════════════════════════════════════════════════════════════
-- phase158 — Posting functions ask for the right they need (audit SEC-01), and
-- nobody can write the audit log directly (SEC-04). Release 1A.
-- ═══════════════════════════════════════════════════════════════════════════
-- Until now most posting functions only checked that the caller belongs to the
-- company: any user with one write right could post journals, confirm expenses
-- or void receipts by calling the function. The screens hid it; the server did
-- not refuse it.
--
-- HOW: one line is added at the start of each function's CURRENT body (read
-- from this database, never from a file). Nothing else in the body changes:
-- same name, arguments, owner, grants, settings and result.
--
-- INTERNAL CALLS ARE NOT CHECKED AGAIN: an approval is confirmed by an approver
-- who may not hold the module right, and a sales user's credit note posts its
-- write-off through post_journal_entry. The function the user called has already
-- been checked. "Internal" is read from the call stack, which a client cannot
-- shape: the API can only call functions, one at a time.
--
-- SAFE TO RE-RUN. No table, row, amount or accounting rule changes.
-- UNDO: scripts/undo-phase158-posting-rights.sql
-- ═══════════════════════════════════════════════════════════════════════════
BEGIN;

-- Frames: this helper + the posting function = 2. More means another function
-- or trigger called it.
CREATE OR REPLACE FUNCTION public._require_post(p_rights text[])
RETURNS void LANGUAGE plpgsql SET search_path TO 'public' AS $fn$
DECLARE
  v_stack text;
  v_right text;
BEGIN
  GET DIAGNOSTICS v_stack = PG_CONTEXT;
  IF (SELECT count(*) FROM regexp_matches(v_stack, '(^|\n)(PL/pgSQL|SQL) function ', 'g')) > 2 THEN
    RETURN;
  END IF;
  FOREACH v_right IN ARRAY p_rights LOOP
    IF public.has_perm(v_right) THEN RETURN; END IF;
  END LOOP;
  RAISE EXCEPTION 'You do not have permission to do this (needs %).', array_to_string(p_rights, ' or ')
    USING ERRCODE = '42501';
END;
$fn$;

-- A payment is a customer receipt or a supplier payment: its type decides.
CREATE OR REPLACE FUNCTION public._require_post_payment(p_payment_id uuid)
RETURNS void LANGUAGE plpgsql SET search_path TO 'public' AS $fn$
DECLARE
  v_stack text;
  v_type  text;
  v_right text;
  v_need  text[];
BEGIN
  GET DIAGNOSTICS v_stack = PG_CONTEXT;
  IF (SELECT count(*) FROM regexp_matches(v_stack, '(^|\n)(PL/pgSQL|SQL) function ', 'g')) > 2 THEN
    RETURN;
  END IF;
  SELECT type INTO v_type FROM public.payments WHERE id = p_payment_id;
  v_need := CASE v_type
    WHEN 'inbound'  THEN ARRAY['sales.write', 'accounting.write']
    WHEN 'outbound' THEN ARRAY['purchasing.write', 'accounting.write']
    ELSE ARRAY['sales.write', 'purchasing.write', 'accounting.write'] END;
  FOREACH v_right IN ARRAY v_need LOOP
    IF public.has_perm(v_right) THEN RETURN; END IF;
  END LOOP;
  RAISE EXCEPTION 'You do not have permission to do this (needs %).', array_to_string(v_need, ' or ')
    USING ERRCODE = '42501';
END;
$fn$;

REVOKE ALL ON FUNCTION public._require_post(text[]), public._require_post_payment(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public._require_post(text[]), public._require_post_payment(uuid)
  TO authenticated, service_role, ledger_writer;

DO $patch$
DECLARE
  r      record;
  v_def  text;
  v_new  text;
  v_call text;
  v_seen int := 0;
BEGIN
  FOR r IN
    SELECT m.fn, m.rights, p.oid
      FROM (VALUES
        -- sales
        ('confirm_invoice', 'sales.write'), ('edit_invoice', 'sales.write'),
        ('confirm_credit_note', 'sales.write'), ('reopen_credit_note', 'sales.write'),
        ('confirm_sales_return', 'sales.write'), ('confirm_pos_sale', 'sales.write'),
        ('void_invoice', 'sales.write,accounting.write'), ('void_credit_note', 'sales.write,accounting.write'),
        ('void_sales_return', 'sales.write,accounting.write'), ('reopen_sales_return', 'sales.write,accounting.write'),
        ('post_credit_note_fee', 'sales.write,accounting.write'), ('post_credit_note_writeoff', 'sales.write,accounting.write'),
        ('reverse_credit_note_fee', 'sales.write,accounting.write'), ('reverse_credit_note_writeoff', 'sales.write,accounting.write'),
        ('post_sales_return_fee', 'sales.write,accounting.write'), ('post_sales_return_writeoff', 'sales.write,accounting.write'),
        ('reverse_sales_return_fee', 'sales.write,accounting.write'), ('reverse_sales_return_writeoff', 'sales.write,accounting.write'),
        -- receipts and supplier payments (by the payment's own type)
        ('confirm_payment', 'payment'), ('reopen_payment', 'payment'), ('void_payment', 'payment'),
        ('apply_advance', 'payment'), ('apply_vendor_advance', 'payment'),
        ('confirm_pdc_payment', 'payment'), ('confirm_pdc_vendor_payment', 'payment'),
        ('confirm_vendor_payment', 'payment'), ('reopen_vendor_payment', 'payment'),
        -- purchasing
        ('confirm_vendor_bill', 'purchasing.write'), ('edit_vendor_bill', 'purchasing.write'),
        ('confirm_debit_note', 'purchasing.write'), ('reopen_debit_note', 'purchasing.write'),
        ('confirm_purchase_return', 'purchasing.write'), ('reopen_purchase_return', 'purchasing.write'),
        ('void_debit_note', 'purchasing.write,accounting.write'), ('void_purchase_return', 'purchasing.write,accounting.write'),
        ('confirm_grn', 'purchasing.write,inventory.write'),
        ('confirm_expense', 'purchasing.write,accounting.write'), ('reopen_expense', 'purchasing.write,accounting.write'),
        ('void_expense', 'purchasing.write,accounting.write'),
        -- inventory
        ('confirm_stock_transfer', 'inventory.write'), ('confirm_inventory_adjustment', 'inventory.write'),
        ('post_opening_stock', 'inventory.write,accounting.write'), ('void_opening_stock', 'inventory.write,accounting.write'),
        -- accounting
        ('post_journal_entry', 'accounting.write'), ('reverse_journal_entry', 'accounting.write'),
        ('post_bank_opening_balance', 'accounting.write'), ('post_gl_opening_balance', 'accounting.write'),
        ('post_opening_balance', 'accounting.write'), ('edit_opening_balance', 'accounting.write'),
        ('void_opening_balance', 'accounting.write'), ('repair_vendor_bill_je', 'accounting.write'),
        ('confirm_bank_transfer', 'accounting.write'), ('reopen_bank_transfer', 'accounting.write'),
        ('void_bank_transfer', 'accounting.write'), ('create_pdc', 'accounting.write'),
        ('deposit_pdc', 'accounting.write'), ('clear_pdc', 'accounting.write'),
        ('bounce_pdc', 'accounting.write'), ('cancel_pdc', 'accounting.write'),
        ('post_fixed_asset_purchase', 'accounting.write,purchasing.write'),
        ('reopen_fixed_asset_purchase', 'accounting.write,purchasing.write'),
        ('dispose_fixed_asset_partial', 'accounting.write'), ('void_fixed_asset', 'accounting.write'),
        -- payroll (admin)
        ('confirm_payroll_run', 'payroll.write'), ('pay_payroll_run', 'payroll.write'),
        ('pay_leave_salary', 'payroll.write'), ('settle_gratuity', 'payroll.write')
      ) AS m(fn, rights)
      LEFT JOIN pg_proc p ON p.proname = m.fn AND p.pronamespace = 'public'::regnamespace
  LOOP
    -- Not in this database: say so instead of leaving it open by accident.
    IF r.oid IS NULL THEN
      RAISE EXCEPTION 'phase158: function % not found', r.fn;
    END IF;
    v_seen := v_seen + 1;
    v_def := pg_get_functiondef(r.oid);
    CONTINUE WHEN v_def ~ '_require_post';                    -- already done

    IF r.rights = 'payment' THEN
      IF NOT 'p_payment_id' = ANY (SELECT unnest(proargnames) FROM pg_proc WHERE oid = r.oid) THEN
        RAISE EXCEPTION 'phase158: % has no p_payment_id', r.fn;
      END IF;
      v_call := 'PERFORM public._require_post_payment(p_payment_id);';
    ELSE
      v_call := 'PERFORM public._require_post(ARRAY[''' || replace(r.rights, ',', ''',''') || ''']);';
    END IF;
    -- After the function's own (first) BEGIN, alone on its line.
    v_new := regexp_replace(v_def, E'(\\n[ \\t]*BEGIN[ \\t]*\\r?\\n)', E'\\1  ' || v_call || E' -- phase158\n');
    IF v_new = v_def THEN
      RAISE EXCEPTION 'phase158: no BEGIN line found in %', r.fn;
    END IF;
    EXECUTE v_new;
  END LOOP;
  RAISE NOTICE 'phase158: % functions checked', v_seen;
END;
$patch$;

-- ── Audit log: only the database writes it ─────────────────────────────────
-- Some functions run as the signed-in user, so the INSERT policy must stay; a
-- direct insert has no function above this trigger and is refused. The user
-- recorded is always the real one.
CREATE OR REPLACE FUNCTION public.tg_audit_logs_guard()
RETURNS trigger LANGUAGE plpgsql SET search_path TO 'public' AS $fn$
DECLARE v_stack text;
BEGIN
  IF current_user IN ('authenticated', 'anon') THEN
    GET DIAGNOSTICS v_stack = PG_CONTEXT;
    IF (SELECT count(*) FROM regexp_matches(v_stack, '(^|\n)(PL/pgSQL|SQL) function ', 'g')) < 2 THEN
      RAISE EXCEPTION 'The audit log cannot be written directly.' USING ERRCODE = '42501';
    END IF;
    NEW.user_id := auth.uid();
  END IF;
  RETURN NEW;
END;
$fn$;
REVOKE ALL ON FUNCTION public.tg_audit_logs_guard() FROM PUBLIC, anon;
DROP TRIGGER IF EXISTS audit_logs_guard ON public.audit_logs;
CREATE TRIGGER audit_logs_guard BEFORE INSERT ON public.audit_logs
  FOR EACH ROW EXECUTE FUNCTION public.tg_audit_logs_guard();

NOTIFY pgrst, 'reload schema';
COMMIT;

-- Check: "protected" must be 67, "still_open" 0, "audit_guard" 1.
SELECT (SELECT count(*) FROM pg_proc WHERE pronamespace = 'public'::regnamespace AND prosrc ~ '-- phase158') AS protected,
       (SELECT count(*) FROM pg_proc p WHERE pronamespace = 'public'::regnamespace AND prosecdef
          AND pg_get_userbyid(proowner) = 'ledger_writer' AND has_function_privilege('authenticated', p.oid, 'execute')
          AND prorettype <> 'trigger'::regtype AND prosrc !~* '_require_post|has_perm|auth_require') AS still_open,
       (SELECT count(*) FROM pg_trigger WHERE tgname = 'audit_logs_guard') AS audit_guard;
