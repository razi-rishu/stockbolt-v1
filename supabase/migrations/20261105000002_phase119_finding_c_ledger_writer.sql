-- phase119: Finding C - clients can no longer write the ledgers directly
--
-- WHAT WENT WRONG
-- general_ledger, journal_entries, stock_ledger and deferred_cogs_queue were
-- writable by every signed-in client (INSERT/UPDATE/DELETE granted to
-- authenticated, RLS allowing any user with the matching permission). The 51
-- posting functions that write them run as the calling user, so they needed
-- those rights - and so did anyone calling the REST API directly: a user with
-- write permission could insert an unbalanced-free but fabricated journal,
-- edit a posted ledger line, or delete stock movements, bypassing every
-- posting rule (period lock, document state, source-type mapping).
--
-- THE FIX (the approved trusted-privilege design; staging first)
--  * ledger_writer: NOLOGIN, NOBYPASSRLS. It inherits exactly the client
--    rights of authenticated plus INSERT/UPDATE/DELETE on the four ledger
--    tables. No login role is ever granted it, so no JWT or session can
--    become it (PostgREST only switches to anon/authenticated/service_role).
--  * The 51 posting functions become SECURITY DEFINER owned by ledger_writer,
--    with a fixed search_path. Their bodies are unchanged. Because
--    ledger_writer does NOT bypass RLS and auth.uid() still reads the caller's
--    JWT, every RLS policy (company isolation, has_perm write permissions)
--    applies inside a posting exactly as before.
--  * authenticated and anon lose INSERT/UPDATE/DELETE/TRUNCATE on the four
--    tables; anon loses EXECUTE on the 51 functions (it never needed it).
--    Reads are unchanged. service_role and the postgres-owned maintenance
--    functions are unchanged.
--  * postgres (the admin and migration role, which already holds every right
--    ledger_writer has) is made a member so it can transfer ownership and later ALTER or CREATE OR REPLACE these functions. A later
--    migration that redefines one of them MUST keep SECURITY DEFINER and
--    SET search_path (pg_get_functiondef output already does); if it drops
--    them the function fails closed (permission denied), never open.
--
-- No data changes. Rollback: supabase/manual-apply/phase119_rollback.sql.

BEGIN;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'ledger_writer') THEN
    CREATE ROLE ledger_writer NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS NOREPLICATION;
  END IF;
END $$;
-- An existing role must be exactly this kind of role, or nothing proceeds.
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'ledger_writer'
             AND (rolcanlogin OR rolsuper OR rolbypassrls OR rolcreaterole OR rolcreatedb OR rolreplication)) THEN
    RAISE EXCEPTION 'ledger_writer exists with unsafe attributes (login/superuser/bypassrls/...); refusing';
  END IF;
END $$;

GRANT authenticated TO ledger_writer;
GRANT ledger_writer TO postgres WITH INHERIT TRUE, SET TRUE;
GRANT USAGE ON SCHEMA public TO ledger_writer;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.general_ledger, public.journal_entries, public.stock_ledger, public.deferred_cogs_queue TO ledger_writer;

-- ALTER ... OWNER needs the new owner to hold CREATE on the schema. Granted
-- only for the transfer and taken back in this same transaction: ledger_writer
-- ends up able to create nothing.
GRANT CREATE ON SCHEMA public TO ledger_writer;

REVOKE EXECUTE ON FUNCTION public.apply_advance(p_payment_id uuid, p_invoice_id uuid, p_amount numeric) FROM PUBLIC, anon;
ALTER FUNCTION public.apply_advance(p_payment_id uuid, p_invoice_id uuid, p_amount numeric) SECURITY DEFINER SET search_path = public, pg_temp;
ALTER FUNCTION public.apply_advance(p_payment_id uuid, p_invoice_id uuid, p_amount numeric) OWNER TO ledger_writer;
REVOKE EXECUTE ON FUNCTION public.apply_vendor_advance(p_payment_id uuid, p_bill_id uuid, p_amount numeric) FROM PUBLIC, anon;
ALTER FUNCTION public.apply_vendor_advance(p_payment_id uuid, p_bill_id uuid, p_amount numeric) SECURITY DEFINER SET search_path = public, pg_temp;
ALTER FUNCTION public.apply_vendor_advance(p_payment_id uuid, p_bill_id uuid, p_amount numeric) OWNER TO ledger_writer;
REVOKE EXECUTE ON FUNCTION public.bounce_pdc(p_pdc_id uuid) FROM PUBLIC, anon;
ALTER FUNCTION public.bounce_pdc(p_pdc_id uuid) SECURITY DEFINER SET search_path = public, pg_temp;
ALTER FUNCTION public.bounce_pdc(p_pdc_id uuid) OWNER TO ledger_writer;
REVOKE EXECUTE ON FUNCTION public.cancel_pdc(p_pdc_id uuid) FROM PUBLIC, anon;
ALTER FUNCTION public.cancel_pdc(p_pdc_id uuid) SECURITY DEFINER SET search_path = public, pg_temp;
ALTER FUNCTION public.cancel_pdc(p_pdc_id uuid) OWNER TO ledger_writer;
REVOKE EXECUTE ON FUNCTION public.clear_pdc(p_pdc_id uuid, p_deposit_account_id uuid) FROM PUBLIC, anon;
ALTER FUNCTION public.clear_pdc(p_pdc_id uuid, p_deposit_account_id uuid) SECURITY DEFINER SET search_path = public, pg_temp;
ALTER FUNCTION public.clear_pdc(p_pdc_id uuid, p_deposit_account_id uuid) OWNER TO ledger_writer;
REVOKE EXECUTE ON FUNCTION public.confirm_bank_transfer(p_transfer_id uuid) FROM PUBLIC, anon;
ALTER FUNCTION public.confirm_bank_transfer(p_transfer_id uuid) SECURITY DEFINER SET search_path = public, pg_temp;
ALTER FUNCTION public.confirm_bank_transfer(p_transfer_id uuid) OWNER TO ledger_writer;
REVOKE EXECUTE ON FUNCTION public.confirm_credit_note(p_credit_note_id uuid) FROM PUBLIC, anon;
ALTER FUNCTION public.confirm_credit_note(p_credit_note_id uuid) SECURITY DEFINER SET search_path = public, pg_temp;
ALTER FUNCTION public.confirm_credit_note(p_credit_note_id uuid) OWNER TO ledger_writer;
REVOKE EXECUTE ON FUNCTION public.confirm_debit_note(p_debit_note_id uuid) FROM PUBLIC, anon;
ALTER FUNCTION public.confirm_debit_note(p_debit_note_id uuid) SECURITY DEFINER SET search_path = public, pg_temp;
ALTER FUNCTION public.confirm_debit_note(p_debit_note_id uuid) OWNER TO ledger_writer;
REVOKE EXECUTE ON FUNCTION public.confirm_expense(p_expense_id uuid) FROM PUBLIC, anon;
ALTER FUNCTION public.confirm_expense(p_expense_id uuid) SECURITY DEFINER SET search_path = public, pg_temp;
ALTER FUNCTION public.confirm_expense(p_expense_id uuid) OWNER TO ledger_writer;
REVOKE EXECUTE ON FUNCTION public.confirm_grn(p_grn_id uuid) FROM PUBLIC, anon;
ALTER FUNCTION public.confirm_grn(p_grn_id uuid) SECURITY DEFINER SET search_path = public, pg_temp;
ALTER FUNCTION public.confirm_grn(p_grn_id uuid) OWNER TO ledger_writer;
REVOKE EXECUTE ON FUNCTION public.confirm_inventory_adjustment(p_adjustment_id uuid) FROM PUBLIC, anon;
ALTER FUNCTION public.confirm_inventory_adjustment(p_adjustment_id uuid) SECURITY DEFINER SET search_path = public, pg_temp;
ALTER FUNCTION public.confirm_inventory_adjustment(p_adjustment_id uuid) OWNER TO ledger_writer;
REVOKE EXECUTE ON FUNCTION public.confirm_invoice(p_invoice_id uuid) FROM PUBLIC, anon;
ALTER FUNCTION public.confirm_invoice(p_invoice_id uuid) SECURITY DEFINER SET search_path = public, pg_temp;
ALTER FUNCTION public.confirm_invoice(p_invoice_id uuid) OWNER TO ledger_writer;
REVOKE EXECUTE ON FUNCTION public.confirm_payment(p_payment_id uuid) FROM PUBLIC, anon;
ALTER FUNCTION public.confirm_payment(p_payment_id uuid) SECURITY DEFINER SET search_path = public, pg_temp;
ALTER FUNCTION public.confirm_payment(p_payment_id uuid) OWNER TO ledger_writer;
REVOKE EXECUTE ON FUNCTION public.confirm_payroll_run(p_run_id uuid) FROM PUBLIC, anon;
ALTER FUNCTION public.confirm_payroll_run(p_run_id uuid) SECURITY DEFINER SET search_path = public, pg_temp;
ALTER FUNCTION public.confirm_payroll_run(p_run_id uuid) OWNER TO ledger_writer;
REVOKE EXECUTE ON FUNCTION public.confirm_pdc_payment(p_payment_id uuid, p_cheque_number text, p_bank_name text, p_due_date date) FROM PUBLIC, anon;
ALTER FUNCTION public.confirm_pdc_payment(p_payment_id uuid, p_cheque_number text, p_bank_name text, p_due_date date) SECURITY DEFINER SET search_path = public, pg_temp;
ALTER FUNCTION public.confirm_pdc_payment(p_payment_id uuid, p_cheque_number text, p_bank_name text, p_due_date date) OWNER TO ledger_writer;
REVOKE EXECUTE ON FUNCTION public.confirm_pdc_vendor_payment(p_payment_id uuid, p_cheque_number text, p_bank_name text, p_due_date date) FROM PUBLIC, anon;
ALTER FUNCTION public.confirm_pdc_vendor_payment(p_payment_id uuid, p_cheque_number text, p_bank_name text, p_due_date date) SECURITY DEFINER SET search_path = public, pg_temp;
ALTER FUNCTION public.confirm_pdc_vendor_payment(p_payment_id uuid, p_cheque_number text, p_bank_name text, p_due_date date) OWNER TO ledger_writer;
REVOKE EXECUTE ON FUNCTION public.confirm_pos_sale(p_session_id uuid, p_items jsonb, p_payment_method text, p_customer_id uuid, p_notes text) FROM PUBLIC, anon;
ALTER FUNCTION public.confirm_pos_sale(p_session_id uuid, p_items jsonb, p_payment_method text, p_customer_id uuid, p_notes text) SECURITY DEFINER SET search_path = public, pg_temp;
ALTER FUNCTION public.confirm_pos_sale(p_session_id uuid, p_items jsonb, p_payment_method text, p_customer_id uuid, p_notes text) OWNER TO ledger_writer;
REVOKE EXECUTE ON FUNCTION public.confirm_stock_transfer(p_transfer_id uuid) FROM PUBLIC, anon;
ALTER FUNCTION public.confirm_stock_transfer(p_transfer_id uuid) SECURITY DEFINER SET search_path = public, pg_temp;
ALTER FUNCTION public.confirm_stock_transfer(p_transfer_id uuid) OWNER TO ledger_writer;
REVOKE EXECUTE ON FUNCTION public.confirm_vendor_bill(p_bill_id uuid) FROM PUBLIC, anon;
ALTER FUNCTION public.confirm_vendor_bill(p_bill_id uuid) SECURITY DEFINER SET search_path = public, pg_temp;
ALTER FUNCTION public.confirm_vendor_bill(p_bill_id uuid) OWNER TO ledger_writer;
REVOKE EXECUTE ON FUNCTION public.confirm_vendor_payment(p_payment_id uuid) FROM PUBLIC, anon;
ALTER FUNCTION public.confirm_vendor_payment(p_payment_id uuid) SECURITY DEFINER SET search_path = public, pg_temp;
ALTER FUNCTION public.confirm_vendor_payment(p_payment_id uuid) OWNER TO ledger_writer;
REVOKE EXECUTE ON FUNCTION public.create_pdc(p_type text, p_contact_id uuid, p_cheque_number text, p_amount numeric, p_issue_date date, p_due_date date, p_bank_name text, p_currency text, p_deposit_account_id uuid, p_linked_payment_id uuid, p_is_advance boolean, p_notes text) FROM PUBLIC, anon;
ALTER FUNCTION public.create_pdc(p_type text, p_contact_id uuid, p_cheque_number text, p_amount numeric, p_issue_date date, p_due_date date, p_bank_name text, p_currency text, p_deposit_account_id uuid, p_linked_payment_id uuid, p_is_advance boolean, p_notes text) SECURITY DEFINER SET search_path = public, pg_temp;
ALTER FUNCTION public.create_pdc(p_type text, p_contact_id uuid, p_cheque_number text, p_amount numeric, p_issue_date date, p_due_date date, p_bank_name text, p_currency text, p_deposit_account_id uuid, p_linked_payment_id uuid, p_is_advance boolean, p_notes text) OWNER TO ledger_writer;
REVOKE EXECUTE ON FUNCTION public.edit_invoice(p_invoice_id uuid) FROM PUBLIC, anon;
ALTER FUNCTION public.edit_invoice(p_invoice_id uuid) SECURITY DEFINER SET search_path = public, pg_temp;
ALTER FUNCTION public.edit_invoice(p_invoice_id uuid) OWNER TO ledger_writer;
REVOKE EXECUTE ON FUNCTION public.edit_vendor_bill(p_bill_id uuid) FROM PUBLIC, anon;
ALTER FUNCTION public.edit_vendor_bill(p_bill_id uuid) SECURITY DEFINER SET search_path = public, pg_temp;
ALTER FUNCTION public.edit_vendor_bill(p_bill_id uuid) OWNER TO ledger_writer;
REVOKE EXECUTE ON FUNCTION public.pay_leave_salary(p_id uuid) FROM PUBLIC, anon;
ALTER FUNCTION public.pay_leave_salary(p_id uuid) SECURITY DEFINER SET search_path = public, pg_temp;
ALTER FUNCTION public.pay_leave_salary(p_id uuid) OWNER TO ledger_writer;
REVOKE EXECUTE ON FUNCTION public.pay_payroll_run(p_run_id uuid, p_bank_account_id uuid, p_date date) FROM PUBLIC, anon;
ALTER FUNCTION public.pay_payroll_run(p_run_id uuid, p_bank_account_id uuid, p_date date) SECURITY DEFINER SET search_path = public, pg_temp;
ALTER FUNCTION public.pay_payroll_run(p_run_id uuid, p_bank_account_id uuid, p_date date) OWNER TO ledger_writer;
REVOKE EXECUTE ON FUNCTION public.post_bank_opening_balance(p_bank_account_id uuid, p_direction text, p_amount numeric, p_date date, p_notes text) FROM PUBLIC, anon;
ALTER FUNCTION public.post_bank_opening_balance(p_bank_account_id uuid, p_direction text, p_amount numeric, p_date date, p_notes text) SECURITY DEFINER SET search_path = public, pg_temp;
ALTER FUNCTION public.post_bank_opening_balance(p_bank_account_id uuid, p_direction text, p_amount numeric, p_date date, p_notes text) OWNER TO ledger_writer;
REVOKE EXECUTE ON FUNCTION public.post_gl_opening_balance(p_account_id uuid, p_direction text, p_amount numeric, p_date date, p_notes text) FROM PUBLIC, anon;
ALTER FUNCTION public.post_gl_opening_balance(p_account_id uuid, p_direction text, p_amount numeric, p_date date, p_notes text) SECURITY DEFINER SET search_path = public, pg_temp;
ALTER FUNCTION public.post_gl_opening_balance(p_account_id uuid, p_direction text, p_amount numeric, p_date date, p_notes text) OWNER TO ledger_writer;
REVOKE EXECUTE ON FUNCTION public.post_journal_entry(p_data jsonb) FROM PUBLIC, anon;
ALTER FUNCTION public.post_journal_entry(p_data jsonb) SECURITY DEFINER SET search_path = public, pg_temp;
ALTER FUNCTION public.post_journal_entry(p_data jsonb) OWNER TO ledger_writer;
REVOKE EXECUTE ON FUNCTION public.post_opening_balance(p_type text, p_contact_id uuid, p_doc_number text, p_date date, p_due_date date, p_amount numeric, p_currency text, p_notes text) FROM PUBLIC, anon;
ALTER FUNCTION public.post_opening_balance(p_type text, p_contact_id uuid, p_doc_number text, p_date date, p_due_date date, p_amount numeric, p_currency text, p_notes text) SECURITY DEFINER SET search_path = public, pg_temp;
ALTER FUNCTION public.post_opening_balance(p_type text, p_contact_id uuid, p_doc_number text, p_date date, p_due_date date, p_amount numeric, p_currency text, p_notes text) OWNER TO ledger_writer;
REVOKE EXECUTE ON FUNCTION public.post_opening_stock(p_product_id uuid, p_warehouse_id uuid, p_quantity numeric, p_unit_cost numeric, p_date date) FROM PUBLIC, anon;
ALTER FUNCTION public.post_opening_stock(p_product_id uuid, p_warehouse_id uuid, p_quantity numeric, p_unit_cost numeric, p_date date) SECURITY DEFINER SET search_path = public, pg_temp;
ALTER FUNCTION public.post_opening_stock(p_product_id uuid, p_warehouse_id uuid, p_quantity numeric, p_unit_cost numeric, p_date date) OWNER TO ledger_writer;
REVOKE EXECUTE ON FUNCTION public.reopen_bank_transfer(p_transfer_id uuid) FROM PUBLIC, anon;
ALTER FUNCTION public.reopen_bank_transfer(p_transfer_id uuid) SECURITY DEFINER SET search_path = public, pg_temp;
ALTER FUNCTION public.reopen_bank_transfer(p_transfer_id uuid) OWNER TO ledger_writer;
REVOKE EXECUTE ON FUNCTION public.reopen_credit_note(p_credit_note_id uuid) FROM PUBLIC, anon;
ALTER FUNCTION public.reopen_credit_note(p_credit_note_id uuid) SECURITY DEFINER SET search_path = public, pg_temp;
ALTER FUNCTION public.reopen_credit_note(p_credit_note_id uuid) OWNER TO ledger_writer;
REVOKE EXECUTE ON FUNCTION public.reopen_debit_note(p_debit_note_id uuid) FROM PUBLIC, anon;
ALTER FUNCTION public.reopen_debit_note(p_debit_note_id uuid) SECURITY DEFINER SET search_path = public, pg_temp;
ALTER FUNCTION public.reopen_debit_note(p_debit_note_id uuid) OWNER TO ledger_writer;
REVOKE EXECUTE ON FUNCTION public.reopen_expense(p_expense_id uuid) FROM PUBLIC, anon;
ALTER FUNCTION public.reopen_expense(p_expense_id uuid) SECURITY DEFINER SET search_path = public, pg_temp;
ALTER FUNCTION public.reopen_expense(p_expense_id uuid) OWNER TO ledger_writer;
REVOKE EXECUTE ON FUNCTION public.reopen_payment(p_payment_id uuid) FROM PUBLIC, anon;
ALTER FUNCTION public.reopen_payment(p_payment_id uuid) SECURITY DEFINER SET search_path = public, pg_temp;
ALTER FUNCTION public.reopen_payment(p_payment_id uuid) OWNER TO ledger_writer;
REVOKE EXECUTE ON FUNCTION public.reopen_vendor_payment(p_payment_id uuid) FROM PUBLIC, anon;
ALTER FUNCTION public.reopen_vendor_payment(p_payment_id uuid) SECURITY DEFINER SET search_path = public, pg_temp;
ALTER FUNCTION public.reopen_vendor_payment(p_payment_id uuid) OWNER TO ledger_writer;
REVOKE EXECUTE ON FUNCTION public.repair_vendor_bill_je(p_je_id uuid) FROM PUBLIC, anon;
ALTER FUNCTION public.repair_vendor_bill_je(p_je_id uuid) SECURITY DEFINER SET search_path = public, pg_temp;
ALTER FUNCTION public.repair_vendor_bill_je(p_je_id uuid) OWNER TO ledger_writer;
REVOKE EXECUTE ON FUNCTION public.reverse_credit_note_fee(p_credit_note_id uuid, p_reason text) FROM PUBLIC, anon;
ALTER FUNCTION public.reverse_credit_note_fee(p_credit_note_id uuid, p_reason text) SECURITY DEFINER SET search_path = public, pg_temp;
ALTER FUNCTION public.reverse_credit_note_fee(p_credit_note_id uuid, p_reason text) OWNER TO ledger_writer;
REVOKE EXECUTE ON FUNCTION public.reverse_credit_note_writeoff(p_credit_note_id uuid, p_reason text) FROM PUBLIC, anon;
ALTER FUNCTION public.reverse_credit_note_writeoff(p_credit_note_id uuid, p_reason text) SECURITY DEFINER SET search_path = public, pg_temp;
ALTER FUNCTION public.reverse_credit_note_writeoff(p_credit_note_id uuid, p_reason text) OWNER TO ledger_writer;
REVOKE EXECUTE ON FUNCTION public.reverse_journal_entry(p_je_id uuid, p_description text) FROM PUBLIC, anon;
ALTER FUNCTION public.reverse_journal_entry(p_je_id uuid, p_description text) SECURITY DEFINER SET search_path = public, pg_temp;
ALTER FUNCTION public.reverse_journal_entry(p_je_id uuid, p_description text) OWNER TO ledger_writer;
REVOKE EXECUTE ON FUNCTION public.reverse_sales_return_fee(p_sales_return_id uuid, p_reason text) FROM PUBLIC, anon;
ALTER FUNCTION public.reverse_sales_return_fee(p_sales_return_id uuid, p_reason text) SECURITY DEFINER SET search_path = public, pg_temp;
ALTER FUNCTION public.reverse_sales_return_fee(p_sales_return_id uuid, p_reason text) OWNER TO ledger_writer;
REVOKE EXECUTE ON FUNCTION public.reverse_sales_return_writeoff(p_sales_return_id uuid, p_reason text) FROM PUBLIC, anon;
ALTER FUNCTION public.reverse_sales_return_writeoff(p_sales_return_id uuid, p_reason text) SECURITY DEFINER SET search_path = public, pg_temp;
ALTER FUNCTION public.reverse_sales_return_writeoff(p_sales_return_id uuid, p_reason text) OWNER TO ledger_writer;
REVOKE EXECUTE ON FUNCTION public.settle_gratuity(p_employee_id uuid, p_amount numeric, p_bank_account_id uuid, p_date date, p_deactivate boolean) FROM PUBLIC, anon;
ALTER FUNCTION public.settle_gratuity(p_employee_id uuid, p_amount numeric, p_bank_account_id uuid, p_date date, p_deactivate boolean) SECURITY DEFINER SET search_path = public, pg_temp;
ALTER FUNCTION public.settle_gratuity(p_employee_id uuid, p_amount numeric, p_bank_account_id uuid, p_date date, p_deactivate boolean) OWNER TO ledger_writer;
REVOKE EXECUTE ON FUNCTION public.tg_retag_gl_project() FROM PUBLIC, anon;
ALTER FUNCTION public.tg_retag_gl_project() SECURITY DEFINER SET search_path = public, pg_temp;
ALTER FUNCTION public.tg_retag_gl_project() OWNER TO ledger_writer;
REVOKE EXECUTE ON FUNCTION public.void_bank_transfer(p_transfer_id uuid, p_void_reason text) FROM PUBLIC, anon;
ALTER FUNCTION public.void_bank_transfer(p_transfer_id uuid, p_void_reason text) SECURITY DEFINER SET search_path = public, pg_temp;
ALTER FUNCTION public.void_bank_transfer(p_transfer_id uuid, p_void_reason text) OWNER TO ledger_writer;
REVOKE EXECUTE ON FUNCTION public.void_credit_note(p_credit_note_id uuid, p_reason text) FROM PUBLIC, anon;
ALTER FUNCTION public.void_credit_note(p_credit_note_id uuid, p_reason text) SECURITY DEFINER SET search_path = public, pg_temp;
ALTER FUNCTION public.void_credit_note(p_credit_note_id uuid, p_reason text) OWNER TO ledger_writer;
REVOKE EXECUTE ON FUNCTION public.void_debit_note(p_debit_note_id uuid, p_reason text) FROM PUBLIC, anon;
ALTER FUNCTION public.void_debit_note(p_debit_note_id uuid, p_reason text) SECURITY DEFINER SET search_path = public, pg_temp;
ALTER FUNCTION public.void_debit_note(p_debit_note_id uuid, p_reason text) OWNER TO ledger_writer;
REVOKE EXECUTE ON FUNCTION public.void_expense(p_expense_id uuid, p_void_reason text) FROM PUBLIC, anon;
ALTER FUNCTION public.void_expense(p_expense_id uuid, p_void_reason text) SECURITY DEFINER SET search_path = public, pg_temp;
ALTER FUNCTION public.void_expense(p_expense_id uuid, p_void_reason text) OWNER TO ledger_writer;
REVOKE EXECUTE ON FUNCTION public.void_invoice(p_invoice_id uuid, p_reason text) FROM PUBLIC, anon;
ALTER FUNCTION public.void_invoice(p_invoice_id uuid, p_reason text) SECURITY DEFINER SET search_path = public, pg_temp;
ALTER FUNCTION public.void_invoice(p_invoice_id uuid, p_reason text) OWNER TO ledger_writer;
REVOKE EXECUTE ON FUNCTION public.void_opening_stock(p_stock_ledger_id uuid) FROM PUBLIC, anon;
ALTER FUNCTION public.void_opening_stock(p_stock_ledger_id uuid) SECURITY DEFINER SET search_path = public, pg_temp;
ALTER FUNCTION public.void_opening_stock(p_stock_ledger_id uuid) OWNER TO ledger_writer;
REVOKE EXECUTE ON FUNCTION public.void_payment(p_payment_id uuid, p_reason text) FROM PUBLIC, anon;
ALTER FUNCTION public.void_payment(p_payment_id uuid, p_reason text) SECURITY DEFINER SET search_path = public, pg_temp;
ALTER FUNCTION public.void_payment(p_payment_id uuid, p_reason text) OWNER TO ledger_writer;

REVOKE CREATE ON SCHEMA public FROM ledger_writer;

-- Now that every writer runs as ledger_writer, take the write rights back from clients.
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.general_ledger, public.journal_entries, public.stock_ledger, public.deferred_cogs_queue FROM PUBLIC, anon, authenticated;

COMMIT;
