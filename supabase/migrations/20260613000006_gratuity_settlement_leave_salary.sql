-- ─────────────────────────────────────────────────────────────────────────
-- StockBolt — Payroll P3a: Gratuity Settlement + Leave Salary (2026-06-13)
-- ─────────────────────────────────────────────────────────────────────────
-- Gratuity already ACCRUES monthly (P2: Dr 6100 / Cr 2360). This adds the
-- payout side + a standalone leave-salary advance.
--
-- 1. settle_gratuity(employee, amount, bank, date)
--    End-of-service payout. Dr 2360 Gratuity Accrual / Cr <bank>.
--    Deactivates the employee (they've left). One JE, audit logged.
--
-- 2. leave_salary_payments table + pay_leave_salary RPC
--    Leave salary paid for an employee's annual-leave period, separate
--    from the monthly run. Posts Dr 6100 Salaries & Benefits / Cr <bank>.
-- ─────────────────────────────────────────────────────────────────────────

-- ─── 1. Gratuity settlement ───────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.settle_gratuity(
  p_employee_id UUID, p_amount NUMERIC, p_bank_account_id UUID,
  p_date DATE DEFAULT NULL, p_deactivate BOOLEAN DEFAULT TRUE
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY INVOKER
AS $$
DECLARE
  v_user_id    UUID := auth.uid();
  v_company_id UUID;
  v_emp        public.employees%ROWTYPE;
  v_date       DATE := COALESCE(p_date, CURRENT_DATE);
  v_grat_id    UUID;  v_bank_coa UUID;  v_bank_code TEXT;
  v_seq        BIGINT; v_entry TEXT; v_je_id UUID; v_label TEXT;
BEGIN
  SELECT company_id INTO v_company_id FROM public.profiles WHERE id = v_user_id;
  IF v_company_id IS NULL THEN RAISE EXCEPTION 'settle_gratuity: no company for user'; END IF;
  IF p_amount <= 0 THEN RAISE EXCEPTION 'Settlement amount must be positive'; END IF;

  SELECT * INTO v_emp FROM public.employees WHERE id = p_employee_id AND company_id = v_company_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Employee not found'; END IF;

  SELECT id INTO v_grat_id FROM public.chart_of_accounts WHERE company_id = v_company_id AND code = '2360';
  IF v_grat_id IS NULL THEN RAISE EXCEPTION 'Account 2360 Gratuity Accrual missing'; END IF;
  SELECT ba.coa_account_id, a.code INTO v_bank_coa, v_bank_code
  FROM public.bank_accounts ba JOIN public.chart_of_accounts a ON a.id = ba.coa_account_id
  WHERE ba.id = p_bank_account_id AND ba.company_id = v_company_id;
  IF v_bank_coa IS NULL THEN RAISE EXCEPTION 'Bank account not found'; END IF;

  INSERT INTO public.document_sequences (company_id, prefix, current_value, format, pad_zeros, reset_yearly)
  VALUES (v_company_id, 'JE', 1001, 'JE-{NUMBER}', 0, false)
  ON CONFLICT (company_id, prefix) DO UPDATE
    SET current_value = public.document_sequences.current_value + 1, updated_at = NOW()
  RETURNING current_value INTO v_seq;
  v_entry := 'JE-' || v_seq::TEXT;
  v_label := 'Gratuity settlement — ' || v_emp.name;

  INSERT INTO public.journal_entries (
    company_id, entry_number, date, description, source_type, source_id,
    total_debit, total_credit, created_by
  ) VALUES (
    v_company_id, v_entry, v_date, v_label, 'gratuity_settlement', p_employee_id,
    p_amount, p_amount, v_user_id
  ) RETURNING id INTO v_je_id;

  INSERT INTO public.general_ledger
    (company_id, journal_entry_id, account_id, account_code, date, debit, credit, description, related_doc_type, related_doc_id)
  VALUES
    (v_company_id, v_je_id, v_grat_id, '2360', v_date, p_amount, 0, v_label, 'gratuity_settlement', p_employee_id),
    (v_company_id, v_je_id, v_bank_coa, v_bank_code, v_date, 0, p_amount, v_label, 'gratuity_settlement', p_employee_id);

  IF p_deactivate THEN
    UPDATE public.employees SET is_active = false, updated_at = NOW() WHERE id = p_employee_id;
  END IF;

  BEGIN
    INSERT INTO public.audit_logs (company_id, user_id, action, entity_type, entity_id, new_data)
    VALUES (v_company_id, v_user_id, 'gratuity_settlement', 'employee', p_employee_id,
      jsonb_build_object('name', v_emp.name, 'amount', p_amount, 'je', v_entry, 'deactivated', p_deactivate));
  EXCEPTION WHEN OTHERS THEN NULL;
  END;

  RETURN jsonb_build_object('je_id', v_je_id, 'entry_number', v_entry, 'amount', p_amount);
END;
$$;

-- ─── 2. Leave salary ───────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.leave_salary_payments (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id       UUID NOT NULL REFERENCES public.companies(id),
  employee_id      UUID NOT NULL REFERENCES public.employees(id),
  leave_from       DATE,
  leave_to         DATE,
  days             NUMERIC(6,1) NOT NULL DEFAULT 0,
  amount           NUMERIC(15,2) NOT NULL,
  bank_account_id  UUID REFERENCES public.bank_accounts(id),
  date             DATE NOT NULL,
  status           TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','paid','void')),
  journal_entry_id UUID REFERENCES public.journal_entries(id),
  notes            TEXT,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.leave_salary_payments ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON public.leave_salary_payments
  FOR ALL USING (company_id = public.current_user_company_id())
  WITH CHECK (company_id = public.current_user_company_id());

-- pay_leave_salary — posts Dr 6100 Salaries & Benefits / Cr <bank>.
CREATE OR REPLACE FUNCTION public.pay_leave_salary(p_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY INVOKER
AS $$
DECLARE
  v_user_id    UUID := auth.uid();
  v_company_id UUID;
  v_row        public.leave_salary_payments%ROWTYPE;
  v_emp_name   TEXT;
  v_sal_exp_id UUID;  v_bank_coa UUID;  v_bank_code TEXT;
  v_seq        BIGINT; v_entry TEXT; v_je_id UUID; v_label TEXT;
BEGIN
  SELECT company_id INTO v_company_id FROM public.profiles WHERE id = v_user_id;
  IF v_company_id IS NULL THEN RAISE EXCEPTION 'pay_leave_salary: no company for user'; END IF;

  SELECT * INTO v_row FROM public.leave_salary_payments WHERE id = p_id AND company_id = v_company_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Leave salary record not found'; END IF;
  IF v_row.status <> 'draft' THEN RAISE EXCEPTION 'Only draft leave salary can be paid (status %)', v_row.status; END IF;
  IF v_row.amount <= 0 THEN RAISE EXCEPTION 'Amount must be positive'; END IF;

  SELECT name INTO v_emp_name FROM public.employees WHERE id = v_row.employee_id;
  SELECT id INTO v_sal_exp_id FROM public.chart_of_accounts WHERE company_id = v_company_id AND code = '6100';
  IF v_sal_exp_id IS NULL THEN RAISE EXCEPTION 'Account 6100 Salaries & Benefits missing'; END IF;
  SELECT ba.coa_account_id, a.code INTO v_bank_coa, v_bank_code
  FROM public.bank_accounts ba JOIN public.chart_of_accounts a ON a.id = ba.coa_account_id
  WHERE ba.id = v_row.bank_account_id AND ba.company_id = v_company_id;
  IF v_bank_coa IS NULL THEN RAISE EXCEPTION 'Bank account not found'; END IF;

  INSERT INTO public.document_sequences (company_id, prefix, current_value, format, pad_zeros, reset_yearly)
  VALUES (v_company_id, 'JE', 1001, 'JE-{NUMBER}', 0, false)
  ON CONFLICT (company_id, prefix) DO UPDATE
    SET current_value = public.document_sequences.current_value + 1, updated_at = NOW()
  RETURNING current_value INTO v_seq;
  v_entry := 'JE-' || v_seq::TEXT;
  v_label := 'Leave salary — ' || COALESCE(v_emp_name, '');

  INSERT INTO public.journal_entries (
    company_id, entry_number, date, description, source_type, source_id,
    total_debit, total_credit, created_by
  ) VALUES (
    v_company_id, v_entry, v_row.date, v_label, 'leave_salary', p_id,
    v_row.amount, v_row.amount, v_user_id
  ) RETURNING id INTO v_je_id;

  INSERT INTO public.general_ledger
    (company_id, journal_entry_id, account_id, account_code, date, debit, credit, description, related_doc_type, related_doc_id)
  VALUES
    (v_company_id, v_je_id, v_sal_exp_id, '6100', v_row.date, v_row.amount, 0, v_label, 'leave_salary', p_id),
    (v_company_id, v_je_id, v_bank_coa, v_bank_code, v_row.date, 0, v_row.amount, v_label, 'leave_salary', p_id);

  UPDATE public.leave_salary_payments
  SET status = 'paid', journal_entry_id = v_je_id, updated_at = NOW()
  WHERE id = p_id;

  RETURN jsonb_build_object('je_id', v_je_id, 'entry_number', v_entry, 'amount', v_row.amount);
END;
$$;
