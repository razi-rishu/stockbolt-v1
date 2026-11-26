-- READ-ONLY check before phase158 (audit release 1A). Changes nothing: the
-- transaction is read only and is rolled back. Shows counts and document
-- numbers only: no customer names, amounts of people, emails or keys.
--
-- Paste all of it into Supabase → SQL Editor → Run. One result table comes back.
--   A = is this database ready for phase158 (every row must say OK)
--   B = who might notice (custom roles and personal overrides)
--   C = documents that do not agree with the ledger (0 = good)
BEGIN TRANSACTION READ ONLY;

WITH fns(fn) AS (SELECT unnest(string_to_array(
  'confirm_invoice,edit_invoice,confirm_credit_note,reopen_credit_note,confirm_sales_return,confirm_pos_sale,void_invoice,void_credit_note,void_sales_return,reopen_sales_return,post_credit_note_fee,post_credit_note_writeoff,reverse_credit_note_fee,reverse_credit_note_writeoff,post_sales_return_fee,post_sales_return_writeoff,reverse_sales_return_fee,reverse_sales_return_writeoff,confirm_payment,reopen_payment,void_payment,apply_advance,apply_vendor_advance,confirm_pdc_payment,confirm_pdc_vendor_payment,confirm_vendor_payment,reopen_vendor_payment,confirm_vendor_bill,edit_vendor_bill,confirm_debit_note,reopen_debit_note,confirm_purchase_return,reopen_purchase_return,void_debit_note,void_purchase_return,confirm_grn,confirm_expense,reopen_expense,void_expense,confirm_stock_transfer,confirm_inventory_adjustment,post_opening_stock,void_opening_stock,post_journal_entry,reverse_journal_entry,post_bank_opening_balance,post_gl_opening_balance,post_opening_balance,edit_opening_balance,void_opening_balance,repair_vendor_bill_je,confirm_bank_transfer,reopen_bank_transfer,void_bank_transfer,create_pdc,deposit_pdc,clear_pdc,bounce_pdc,cancel_pdc,post_fixed_asset_purchase,reopen_fixed_asset_purchase,dispose_fixed_asset_partial,void_fixed_asset,confirm_payroll_run,pay_payroll_run,pay_leave_salary,settle_gratuity', ','))),
f AS (SELECT fns.fn, p.oid, p.prosrc FROM fns LEFT JOIN pg_proc p ON p.proname = fns.fn AND p.pronamespace = 'public'::regnamespace),
je AS (SELECT id, company_id, entry_number, source_type, source_id FROM public.journal_entries
        WHERE reversed_by_id IS NULL AND reversal_of_id IS NULL AND source_id IS NOT NULL),
docs AS (
  SELECT 'invoice' AS kind, id, company_id, invoice_number AS no, status, total_amount AS total, COALESCE(is_opening, false) AS opening FROM public.invoices
  UNION ALL SELECT 'bill', id, company_id, bill_number, status, total_amount, COALESCE(is_opening, false) FROM public.vendor_bills
  UNION ALL SELECT 'payment', id, company_id, payment_number, status, amount, COALESCE(is_opening, false) FROM public.payments
  UNION ALL SELECT 'credit note', id, company_id, credit_note_number, status, total_amount, false FROM public.credit_notes
  UNION ALL SELECT 'debit note', id, company_id, debit_note_number, status, total_amount, false FROM public.debit_notes
  UNION ALL SELECT 'expense', id, company_id, expense_number, status, total_amount, false FROM public.expenses),
hasje AS (SELECT d.kind, d.id, EXISTS (SELECT 1 FROM je WHERE je.source_id = d.id)
            OR (d.kind = 'payment' AND EXISTS (SELECT 1 FROM public.pdc_cheques q WHERE q.linked_payment_id = d.id)) AS yes FROM docs d),
-- invoice / bill total against its own receivable / payable line
led AS (
  SELECT je.source_id, sum(g.debit - g.credit) AS net
    FROM je JOIN public.general_ledger g ON g.journal_entry_id = je.id
   WHERE (je.source_type = 'sales_invoice' AND g.account_code = '1200')
      OR (je.source_type = 'vendor_bill' AND g.account_code IN ('2100', '2110', '2120'))
      OR (je.source_type = 'sales_credit_note' AND g.account_code = '1200')
   GROUP BY 1),
bad AS (
  SELECT 'C1 confirmed but nothing posted' AS chk, d.kind, d.company_id, d.no FROM docs d JOIN hasje h ON h.id = d.id AND h.kind = d.kind
   WHERE d.status = 'confirmed' AND NOT d.opening AND d.total <> 0 AND NOT h.yes
  UNION ALL SELECT 'C2 draft but still posted', d.kind, d.company_id, d.no FROM docs d JOIN je ON je.source_id = d.id
   WHERE d.status = 'draft' AND je.source_type NOT IN ('inventory_cogs', 'advance_application')
  UNION ALL SELECT 'C3 void but still posted', d.kind, d.company_id, d.no FROM docs d JOIN je ON je.source_id = d.id
   WHERE d.status = 'void' AND je.source_type NOT IN ('inventory_cogs', 'advance_application')
  UNION ALL SELECT 'C4 total differs from ledger', d.kind, d.company_id, d.no FROM docs d JOIN led ON led.source_id = d.id
   WHERE d.status = 'confirmed' AND NOT d.opening AND d.kind IN ('invoice', 'bill', 'credit note') AND abs(abs(led.net) - d.total) > 0.011
  UNION ALL SELECT 'C5 posted but document deleted', je.source_type, je.company_id, je.entry_number FROM je
   WHERE je.source_type IN ('sales_invoice', 'vendor_bill', 'customer_receipt', 'vendor_payment', 'customer_advance', 'vendor_advance', 'sales_credit_note', 'vendor_debit_note', 'expense')
     AND NOT EXISTS (SELECT 1 FROM docs d WHERE d.id = je.source_id)
     AND NOT EXISTS (SELECT 1 FROM public.sales_returns r WHERE r.id = je.source_id)
     AND NOT EXISTS (SELECT 1 FROM public.purchase_returns r WHERE r.id = je.source_id)
  UNION ALL SELECT 'C6 invoice total differs from lines', 'invoice', i.company_id, i.invoice_number FROM public.invoices i
   WHERE i.status = 'confirmed' AND NOT COALESCE(i.is_opening, false)
     AND abs((SELECT COALESCE(sum(line_total), 0) FROM public.invoice_items x WHERE x.invoice_id = i.id) + COALESCE(i.round_off_amount, 0) - i.total_amount) > 0.05
  UNION ALL SELECT 'C7 journal without lines', 'journal', j.company_id, j.entry_number FROM public.journal_entries j
   WHERE NOT EXISTS (SELECT 1 FROM public.general_ledger g WHERE g.journal_entry_id = j.id)
  UNION ALL SELECT 'C8 audit row without a user', a.entity_type, a.company_id, a.action FROM public.audit_logs a
   WHERE a.user_id IS NULL
),
names(chk) AS (VALUES ('C1 confirmed but nothing posted'), ('C2 draft but still posted'), ('C3 void but still posted'), ('C4 total differs from ledger'),
  ('C5 posted but document deleted'), ('C6 invoice total differs from lines'), ('C7 journal without lines'), ('C8 audit row without a user')),
built AS (SELECT unnest(ARRAY['accountant', 'viewer', 'counter', 'sales', 'admin']) AS role)
SELECT 1 AS ord, 'A1 functions found (67)' AS check_name, count(DISTINCT fn) FILTER (WHERE oid IS NOT NULL) AS n,
       CASE WHEN bool_and(oid IS NOT NULL) THEN 'OK' ELSE 'MISSING: ' || string_agg(fn, ', ') FILTER (WHERE oid IS NULL) END AS detail FROM f
UNION ALL SELECT 2, 'A2 functions with a usable start line', count(*) FILTER (WHERE prosrc ~ E'\\n[ \\t]*BEGIN[ \\t]*\\r?\\n'),
       CASE WHEN bool_and(prosrc ~ E'\\n[ \\t]*BEGIN[ \\t]*\\r?\\n') THEN 'OK' ELSE 'CHECK: ' || string_agg(fn, ', ') FILTER (WHERE prosrc !~ E'\\n[ \\t]*BEGIN[ \\t]*\\r?\\n') END FROM f WHERE oid IS NOT NULL
UNION ALL SELECT 3, 'A3 more than one version of a name', count(*), COALESCE('INFO: ' || string_agg(fn, ', '), 'OK') FROM (SELECT fn FROM f GROUP BY fn HAVING count(*) > 1) x
UNION ALL SELECT 4, 'A4 posting functions not on the list', count(*), COALESCE('SEND ME: ' || string_agg(p.proname, ', '), 'OK') FROM pg_proc p
   WHERE p.pronamespace = 'public'::regnamespace AND p.prosecdef AND p.prorettype <> 'trigger'::regtype
     AND pg_get_userbyid(p.proowner) = 'ledger_writer' AND has_function_privilege('authenticated', p.oid, 'execute')
     AND p.prosrc !~* 'has_perm|auth_require|_require_post' AND p.proname NOT IN (SELECT fn FROM fns)
UNION ALL SELECT 5, 'A5 rights function and ledger owner', 1, CASE WHEN to_regprocedure('public.has_perm(text)') IS NOT NULL AND EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'ledger_writer')
       AND pg_has_role(current_user, 'ledger_writer', 'member') THEN 'OK' ELSE 'STOP: not ready' END
UNION ALL SELECT 6, 'A6 fingerprint of the 67 functions', 67, md5(string_agg(md5(prosrc), '' ORDER BY oid::regprocedure::text)) FROM f WHERE oid IS NOT NULL
UNION ALL SELECT 10, 'B1 role rights: ' || rp.role || ' (' || CASE WHEN b.role IS NULL THEN 'custom' ELSE 'built-in' END || ')', count(DISTINCT pr.id), string_agg(DISTINCT rp.permission, ', ')
  FROM public.role_permissions rp LEFT JOIN built b ON b.role = rp.role
  LEFT JOIN public.profiles pr ON pr.role = rp.role AND pr.is_active AND (rp.company_id IS NULL OR rp.company_id = pr.company_id)
  GROUP BY rp.role, b.role
UNION ALL SELECT 11, 'B2 active users per role: ' || role, count(*), count(DISTINCT company_id) || ' companies' FROM public.profiles WHERE is_active GROUP BY role
UNION ALL SELECT 12, 'B3 personal override: ' || permission || ' ' || mode, count(*), '' FROM public.user_permission_overrides GROUP BY permission, mode
UNION ALL SELECT 20, n.chk || COALESCE(' / ' || b.kind, ''), count(b.no),
       CASE WHEN count(b.no) = 0 THEN 'OK' ELSE count(DISTINCT b.company_id) || ' companies; e.g. ' || array_to_string((array_agg(DISTINCT left(b.company_id::text, 8) || ':' || b.no))[1:8], ', ') END
  FROM names n LEFT JOIN bad b ON b.chk = n.chk GROUP BY n.chk, b.kind
ORDER BY 1, 2;

ROLLBACK;
