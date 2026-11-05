-- phase119 ROLLBACK - re-opens direct client writes to the ledgers (Finding C).
--
-- WARNING: after this, any signed-in user with write permission can again
-- insert, edit or delete general ledger, journal, stock-ledger and
-- deferred-COGS rows directly through the REST API, bypassing posting rules.
-- Use only if a posting function fails under phase119 and must be restored
-- while it is fixed.

BEGIN;

-- ROLLBACK GUARD - rollbacks are refused unless this block is deliberately removed.
DO $$ BEGIN
  RAISE EXCEPTION 'ROLLBACK GUARD: this rollback re-opens direct ledger writes (Finding C). Delete this block to run it deliberately.';
END $$;

GRANT INSERT, UPDATE, DELETE, TRUNCATE ON public.general_ledger, public.journal_entries, public.stock_ledger, public.deferred_cogs_queue TO authenticated, anon;

GRANT CREATE ON SCHEMA public TO ledger_writer;  -- only so the owner change can run
ALTER FUNCTION public.apply_advance(p_payment_id uuid, p_invoice_id uuid, p_amount numeric) OWNER TO postgres;
ALTER FUNCTION public.apply_advance(p_payment_id uuid, p_invoice_id uuid, p_amount numeric) SECURITY INVOKER RESET search_path;
GRANT EXECUTE ON FUNCTION public.apply_advance(p_payment_id uuid, p_invoice_id uuid, p_amount numeric) TO anon;
ALTER FUNCTION public.apply_vendor_advance(p_payment_id uuid, p_bill_id uuid, p_amount numeric) OWNER TO postgres;
ALTER FUNCTION public.apply_vendor_advance(p_payment_id uuid, p_bill_id uuid, p_amount numeric) SECURITY INVOKER RESET search_path;
GRANT EXECUTE ON FUNCTION public.apply_vendor_advance(p_payment_id uuid, p_bill_id uuid, p_amount numeric) TO anon;
ALTER FUNCTION public.bounce_pdc(p_pdc_id uuid) OWNER TO postgres;
ALTER FUNCTION public.bounce_pdc(p_pdc_id uuid) SECURITY INVOKER RESET search_path;
GRANT EXECUTE ON FUNCTION public.bounce_pdc(p_pdc_id uuid) TO anon;
ALTER FUNCTION public.cancel_pdc(p_pdc_id uuid) OWNER TO postgres;
ALTER FUNCTION public.cancel_pdc(p_pdc_id uuid) SECURITY INVOKER RESET search_path;
GRANT EXECUTE ON FUNCTION public.cancel_pdc(p_pdc_id uuid) TO anon;
ALTER FUNCTION public.clear_pdc(p_pdc_id uuid, p_deposit_account_id uuid) OWNER TO postgres;
ALTER FUNCTION public.clear_pdc(p_pdc_id uuid, p_deposit_account_id uuid) SECURITY INVOKER RESET search_path;
GRANT EXECUTE ON FUNCTION public.clear_pdc(p_pdc_id uuid, p_deposit_account_id uuid) TO anon;
ALTER FUNCTION public.confirm_bank_transfer(p_transfer_id uuid) OWNER TO postgres;
ALTER FUNCTION public.confirm_bank_transfer(p_transfer_id uuid) SECURITY INVOKER RESET search_path;
GRANT EXECUTE ON FUNCTION public.confirm_bank_transfer(p_transfer_id uuid) TO anon;
ALTER FUNCTION public.confirm_credit_note(p_credit_note_id uuid) OWNER TO postgres;
ALTER FUNCTION public.confirm_credit_note(p_credit_note_id uuid) SECURITY INVOKER RESET search_path;
GRANT EXECUTE ON FUNCTION public.confirm_credit_note(p_credit_note_id uuid) TO anon;
ALTER FUNCTION public.confirm_debit_note(p_debit_note_id uuid) OWNER TO postgres;
ALTER FUNCTION public.confirm_debit_note(p_debit_note_id uuid) SECURITY INVOKER RESET search_path;
GRANT EXECUTE ON FUNCTION public.confirm_debit_note(p_debit_note_id uuid) TO anon;
ALTER FUNCTION public.confirm_expense(p_expense_id uuid) OWNER TO postgres;
ALTER FUNCTION public.confirm_expense(p_expense_id uuid) SECURITY INVOKER RESET search_path;
GRANT EXECUTE ON FUNCTION public.confirm_expense(p_expense_id uuid) TO anon;
ALTER FUNCTION public.confirm_grn(p_grn_id uuid) OWNER TO postgres;
ALTER FUNCTION public.confirm_grn(p_grn_id uuid) SECURITY INVOKER RESET search_path;
GRANT EXECUTE ON FUNCTION public.confirm_grn(p_grn_id uuid) TO anon;
ALTER FUNCTION public.confirm_inventory_adjustment(p_adjustment_id uuid) OWNER TO postgres;
ALTER FUNCTION public.confirm_inventory_adjustment(p_adjustment_id uuid) SECURITY INVOKER RESET search_path;
GRANT EXECUTE ON FUNCTION public.confirm_inventory_adjustment(p_adjustment_id uuid) TO anon;
ALTER FUNCTION public.confirm_invoice(p_invoice_id uuid) OWNER TO postgres;
ALTER FUNCTION public.confirm_invoice(p_invoice_id uuid) SECURITY INVOKER RESET search_path;
GRANT EXECUTE ON FUNCTION public.confirm_invoice(p_invoice_id uuid) TO anon;
ALTER FUNCTION public.confirm_payment(p_payment_id uuid) OWNER TO postgres;
ALTER FUNCTION public.confirm_payment(p_payment_id uuid) SECURITY INVOKER RESET search_path;
GRANT EXECUTE ON FUNCTION public.confirm_payment(p_payment_id uuid) TO anon;
ALTER FUNCTION public.confirm_payroll_run(p_run_id uuid) OWNER TO postgres;
ALTER FUNCTION public.confirm_payroll_run(p_run_id uuid) SECURITY INVOKER RESET search_path;
GRANT EXECUTE ON FUNCTION public.confirm_payroll_run(p_run_id uuid) TO anon;
ALTER FUNCTION public.confirm_pdc_payment(p_payment_id uuid, p_cheque_number text, p_bank_name text, p_due_date date) OWNER TO postgres;
ALTER FUNCTION public.confirm_pdc_payment(p_payment_id uuid, p_cheque_number text, p_bank_name text, p_due_date date) SECURITY INVOKER RESET search_path;
GRANT EXECUTE ON FUNCTION public.confirm_pdc_payment(p_payment_id uuid, p_cheque_number text, p_bank_name text, p_due_date date) TO anon;
ALTER FUNCTION public.confirm_pdc_vendor_payment(p_payment_id uuid, p_cheque_number text, p_bank_name text, p_due_date date) OWNER TO postgres;
ALTER FUNCTION public.confirm_pdc_vendor_payment(p_payment_id uuid, p_cheque_number text, p_bank_name text, p_due_date date) SECURITY INVOKER RESET search_path;
GRANT EXECUTE ON FUNCTION public.confirm_pdc_vendor_payment(p_payment_id uuid, p_cheque_number text, p_bank_name text, p_due_date date) TO anon;
ALTER FUNCTION public.confirm_pos_sale(p_session_id uuid, p_items jsonb, p_payment_method text, p_customer_id uuid, p_notes text) OWNER TO postgres;
ALTER FUNCTION public.confirm_pos_sale(p_session_id uuid, p_items jsonb, p_payment_method text, p_customer_id uuid, p_notes text) SECURITY INVOKER RESET search_path;
GRANT EXECUTE ON FUNCTION public.confirm_pos_sale(p_session_id uuid, p_items jsonb, p_payment_method text, p_customer_id uuid, p_notes text) TO anon;
ALTER FUNCTION public.confirm_stock_transfer(p_transfer_id uuid) OWNER TO postgres;
ALTER FUNCTION public.confirm_stock_transfer(p_transfer_id uuid) SECURITY INVOKER RESET search_path;
GRANT EXECUTE ON FUNCTION public.confirm_stock_transfer(p_transfer_id uuid) TO anon;
ALTER FUNCTION public.confirm_vendor_bill(p_bill_id uuid) OWNER TO postgres;
ALTER FUNCTION public.confirm_vendor_bill(p_bill_id uuid) SECURITY INVOKER RESET search_path;
GRANT EXECUTE ON FUNCTION public.confirm_vendor_bill(p_bill_id uuid) TO anon;
ALTER FUNCTION public.confirm_vendor_payment(p_payment_id uuid) OWNER TO postgres;
ALTER FUNCTION public.confirm_vendor_payment(p_payment_id uuid) SECURITY INVOKER RESET search_path;
GRANT EXECUTE ON FUNCTION public.confirm_vendor_payment(p_payment_id uuid) TO anon;
ALTER FUNCTION public.create_pdc(p_type text, p_contact_id uuid, p_cheque_number text, p_amount numeric, p_issue_date date, p_due_date date, p_bank_name text, p_currency text, p_deposit_account_id uuid, p_linked_payment_id uuid, p_is_advance boolean, p_notes text) OWNER TO postgres;
ALTER FUNCTION public.create_pdc(p_type text, p_contact_id uuid, p_cheque_number text, p_amount numeric, p_issue_date date, p_due_date date, p_bank_name text, p_currency text, p_deposit_account_id uuid, p_linked_payment_id uuid, p_is_advance boolean, p_notes text) SECURITY INVOKER RESET search_path;
GRANT EXECUTE ON FUNCTION public.create_pdc(p_type text, p_contact_id uuid, p_cheque_number text, p_amount numeric, p_issue_date date, p_due_date date, p_bank_name text, p_currency text, p_deposit_account_id uuid, p_linked_payment_id uuid, p_is_advance boolean, p_notes text) TO anon;
ALTER FUNCTION public.edit_invoice(p_invoice_id uuid) OWNER TO postgres;
ALTER FUNCTION public.edit_invoice(p_invoice_id uuid) SECURITY INVOKER RESET search_path;
GRANT EXECUTE ON FUNCTION public.edit_invoice(p_invoice_id uuid) TO anon;
ALTER FUNCTION public.edit_vendor_bill(p_bill_id uuid) OWNER TO postgres;
ALTER FUNCTION public.edit_vendor_bill(p_bill_id uuid) SECURITY INVOKER RESET search_path;
GRANT EXECUTE ON FUNCTION public.edit_vendor_bill(p_bill_id uuid) TO anon;
ALTER FUNCTION public.pay_leave_salary(p_id uuid) OWNER TO postgres;
ALTER FUNCTION public.pay_leave_salary(p_id uuid) SECURITY INVOKER RESET search_path;
GRANT EXECUTE ON FUNCTION public.pay_leave_salary(p_id uuid) TO anon;
ALTER FUNCTION public.pay_payroll_run(p_run_id uuid, p_bank_account_id uuid, p_date date) OWNER TO postgres;
ALTER FUNCTION public.pay_payroll_run(p_run_id uuid, p_bank_account_id uuid, p_date date) SECURITY INVOKER RESET search_path;
GRANT EXECUTE ON FUNCTION public.pay_payroll_run(p_run_id uuid, p_bank_account_id uuid, p_date date) TO anon;
ALTER FUNCTION public.post_bank_opening_balance(p_bank_account_id uuid, p_direction text, p_amount numeric, p_date date, p_notes text) OWNER TO postgres;
ALTER FUNCTION public.post_bank_opening_balance(p_bank_account_id uuid, p_direction text, p_amount numeric, p_date date, p_notes text) SECURITY INVOKER RESET search_path;
GRANT EXECUTE ON FUNCTION public.post_bank_opening_balance(p_bank_account_id uuid, p_direction text, p_amount numeric, p_date date, p_notes text) TO anon;
ALTER FUNCTION public.post_gl_opening_balance(p_account_id uuid, p_direction text, p_amount numeric, p_date date, p_notes text) OWNER TO postgres;
ALTER FUNCTION public.post_gl_opening_balance(p_account_id uuid, p_direction text, p_amount numeric, p_date date, p_notes text) SECURITY INVOKER RESET search_path;
GRANT EXECUTE ON FUNCTION public.post_gl_opening_balance(p_account_id uuid, p_direction text, p_amount numeric, p_date date, p_notes text) TO anon;
ALTER FUNCTION public.post_journal_entry(p_data jsonb) OWNER TO postgres;
ALTER FUNCTION public.post_journal_entry(p_data jsonb) SECURITY INVOKER RESET search_path;
GRANT EXECUTE ON FUNCTION public.post_journal_entry(p_data jsonb) TO anon;
ALTER FUNCTION public.post_opening_balance(p_type text, p_contact_id uuid, p_doc_number text, p_date date, p_due_date date, p_amount numeric, p_currency text, p_notes text) OWNER TO postgres;
ALTER FUNCTION public.post_opening_balance(p_type text, p_contact_id uuid, p_doc_number text, p_date date, p_due_date date, p_amount numeric, p_currency text, p_notes text) SECURITY INVOKER RESET search_path;
GRANT EXECUTE ON FUNCTION public.post_opening_balance(p_type text, p_contact_id uuid, p_doc_number text, p_date date, p_due_date date, p_amount numeric, p_currency text, p_notes text) TO anon;
ALTER FUNCTION public.post_opening_stock(p_product_id uuid, p_warehouse_id uuid, p_quantity numeric, p_unit_cost numeric, p_date date) OWNER TO postgres;
ALTER FUNCTION public.post_opening_stock(p_product_id uuid, p_warehouse_id uuid, p_quantity numeric, p_unit_cost numeric, p_date date) SECURITY INVOKER RESET search_path;
GRANT EXECUTE ON FUNCTION public.post_opening_stock(p_product_id uuid, p_warehouse_id uuid, p_quantity numeric, p_unit_cost numeric, p_date date) TO anon;
ALTER FUNCTION public.reopen_bank_transfer(p_transfer_id uuid) OWNER TO postgres;
ALTER FUNCTION public.reopen_bank_transfer(p_transfer_id uuid) SECURITY INVOKER RESET search_path;
GRANT EXECUTE ON FUNCTION public.reopen_bank_transfer(p_transfer_id uuid) TO anon;
ALTER FUNCTION public.reopen_credit_note(p_credit_note_id uuid) OWNER TO postgres;
ALTER FUNCTION public.reopen_credit_note(p_credit_note_id uuid) SECURITY INVOKER RESET search_path;
GRANT EXECUTE ON FUNCTION public.reopen_credit_note(p_credit_note_id uuid) TO anon;
ALTER FUNCTION public.reopen_debit_note(p_debit_note_id uuid) OWNER TO postgres;
ALTER FUNCTION public.reopen_debit_note(p_debit_note_id uuid) SECURITY INVOKER RESET search_path;
GRANT EXECUTE ON FUNCTION public.reopen_debit_note(p_debit_note_id uuid) TO anon;
ALTER FUNCTION public.reopen_expense(p_expense_id uuid) OWNER TO postgres;
ALTER FUNCTION public.reopen_expense(p_expense_id uuid) SECURITY INVOKER RESET search_path;
GRANT EXECUTE ON FUNCTION public.reopen_expense(p_expense_id uuid) TO anon;
ALTER FUNCTION public.reopen_payment(p_payment_id uuid) OWNER TO postgres;
ALTER FUNCTION public.reopen_payment(p_payment_id uuid) SECURITY INVOKER RESET search_path;
GRANT EXECUTE ON FUNCTION public.reopen_payment(p_payment_id uuid) TO anon;
ALTER FUNCTION public.reopen_vendor_payment(p_payment_id uuid) OWNER TO postgres;
ALTER FUNCTION public.reopen_vendor_payment(p_payment_id uuid) SECURITY INVOKER RESET search_path;
GRANT EXECUTE ON FUNCTION public.reopen_vendor_payment(p_payment_id uuid) TO anon;
ALTER FUNCTION public.repair_vendor_bill_je(p_je_id uuid) OWNER TO postgres;
ALTER FUNCTION public.repair_vendor_bill_je(p_je_id uuid) SECURITY INVOKER RESET search_path;
GRANT EXECUTE ON FUNCTION public.repair_vendor_bill_je(p_je_id uuid) TO anon;
ALTER FUNCTION public.reverse_credit_note_fee(p_credit_note_id uuid, p_reason text) OWNER TO postgres;
ALTER FUNCTION public.reverse_credit_note_fee(p_credit_note_id uuid, p_reason text) SECURITY INVOKER RESET search_path;
GRANT EXECUTE ON FUNCTION public.reverse_credit_note_fee(p_credit_note_id uuid, p_reason text) TO anon;
ALTER FUNCTION public.reverse_credit_note_writeoff(p_credit_note_id uuid, p_reason text) OWNER TO postgres;
ALTER FUNCTION public.reverse_credit_note_writeoff(p_credit_note_id uuid, p_reason text) SECURITY INVOKER RESET search_path;
GRANT EXECUTE ON FUNCTION public.reverse_credit_note_writeoff(p_credit_note_id uuid, p_reason text) TO anon;
ALTER FUNCTION public.reverse_journal_entry(p_je_id uuid, p_description text) OWNER TO postgres;
ALTER FUNCTION public.reverse_journal_entry(p_je_id uuid, p_description text) SECURITY INVOKER RESET search_path;
GRANT EXECUTE ON FUNCTION public.reverse_journal_entry(p_je_id uuid, p_description text) TO anon;
ALTER FUNCTION public.reverse_sales_return_fee(p_sales_return_id uuid, p_reason text) OWNER TO postgres;
ALTER FUNCTION public.reverse_sales_return_fee(p_sales_return_id uuid, p_reason text) SECURITY INVOKER RESET search_path;
GRANT EXECUTE ON FUNCTION public.reverse_sales_return_fee(p_sales_return_id uuid, p_reason text) TO anon;
ALTER FUNCTION public.reverse_sales_return_writeoff(p_sales_return_id uuid, p_reason text) OWNER TO postgres;
ALTER FUNCTION public.reverse_sales_return_writeoff(p_sales_return_id uuid, p_reason text) SECURITY INVOKER RESET search_path;
GRANT EXECUTE ON FUNCTION public.reverse_sales_return_writeoff(p_sales_return_id uuid, p_reason text) TO anon;
ALTER FUNCTION public.settle_gratuity(p_employee_id uuid, p_amount numeric, p_bank_account_id uuid, p_date date, p_deactivate boolean) OWNER TO postgres;
ALTER FUNCTION public.settle_gratuity(p_employee_id uuid, p_amount numeric, p_bank_account_id uuid, p_date date, p_deactivate boolean) SECURITY INVOKER RESET search_path;
GRANT EXECUTE ON FUNCTION public.settle_gratuity(p_employee_id uuid, p_amount numeric, p_bank_account_id uuid, p_date date, p_deactivate boolean) TO anon;
ALTER FUNCTION public.tg_retag_gl_project() OWNER TO postgres;
ALTER FUNCTION public.tg_retag_gl_project() SECURITY INVOKER RESET search_path;
GRANT EXECUTE ON FUNCTION public.tg_retag_gl_project() TO anon;
ALTER FUNCTION public.void_bank_transfer(p_transfer_id uuid, p_void_reason text) OWNER TO postgres;
ALTER FUNCTION public.void_bank_transfer(p_transfer_id uuid, p_void_reason text) SECURITY INVOKER RESET search_path;
GRANT EXECUTE ON FUNCTION public.void_bank_transfer(p_transfer_id uuid, p_void_reason text) TO anon;
ALTER FUNCTION public.void_credit_note(p_credit_note_id uuid, p_reason text) OWNER TO postgres;
ALTER FUNCTION public.void_credit_note(p_credit_note_id uuid, p_reason text) SECURITY INVOKER RESET search_path;
GRANT EXECUTE ON FUNCTION public.void_credit_note(p_credit_note_id uuid, p_reason text) TO anon;
ALTER FUNCTION public.void_debit_note(p_debit_note_id uuid, p_reason text) OWNER TO postgres;
ALTER FUNCTION public.void_debit_note(p_debit_note_id uuid, p_reason text) SECURITY INVOKER RESET search_path;
GRANT EXECUTE ON FUNCTION public.void_debit_note(p_debit_note_id uuid, p_reason text) TO anon;
ALTER FUNCTION public.void_expense(p_expense_id uuid, p_void_reason text) OWNER TO postgres;
ALTER FUNCTION public.void_expense(p_expense_id uuid, p_void_reason text) SECURITY INVOKER RESET search_path;
GRANT EXECUTE ON FUNCTION public.void_expense(p_expense_id uuid, p_void_reason text) TO anon;
ALTER FUNCTION public.void_invoice(p_invoice_id uuid, p_reason text) OWNER TO postgres;
ALTER FUNCTION public.void_invoice(p_invoice_id uuid, p_reason text) SECURITY INVOKER RESET search_path;
GRANT EXECUTE ON FUNCTION public.void_invoice(p_invoice_id uuid, p_reason text) TO anon;
ALTER FUNCTION public.void_opening_stock(p_stock_ledger_id uuid) OWNER TO postgres;
ALTER FUNCTION public.void_opening_stock(p_stock_ledger_id uuid) SECURITY INVOKER RESET search_path;
GRANT EXECUTE ON FUNCTION public.void_opening_stock(p_stock_ledger_id uuid) TO anon;
ALTER FUNCTION public.void_payment(p_payment_id uuid, p_reason text) OWNER TO postgres;
ALTER FUNCTION public.void_payment(p_payment_id uuid, p_reason text) SECURITY INVOKER RESET search_path;
GRANT EXECUTE ON FUNCTION public.void_payment(p_payment_id uuid, p_reason text) TO anon;
REVOKE CREATE ON SCHEMA public FROM ledger_writer;

REVOKE INSERT, UPDATE, DELETE ON public.general_ledger, public.journal_entries, public.stock_ledger, public.deferred_cogs_queue FROM ledger_writer;
-- The role itself is left in place (harmless: no login, no members but postgres).

COMMIT;
