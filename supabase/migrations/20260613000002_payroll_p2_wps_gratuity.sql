-- ─────────────────────────────────────────────────────────────────────────
-- StockBolt — Payroll P2: WPS SIF export + Gratuity accrual (2026-06-13)
-- ─────────────────────────────────────────────────────────────────────────
-- 1. WPS fields:
--    - employees.bank_routing_code  (9-digit UAE agent/bank routing for EDR)
--    - companies.mol_establishment_id (13-digit MOHRE employer ID for SCR)
--    - companies.wps_routing_code     (employer bank routing for SCR)
--    The .SIF file itself is generated client-side from confirmed runs.
--
-- 2. Gratuity accrual (UAE EOSB, basic-salary based):
--    confirm_payroll_run now ALSO accrues one month of end-of-service
--    benefit per employee with a joining_date:
--      service < 5 years:  basic × (21/30) / 12   per month
--      service ≥ 5 years:  basic × (30/30) / 12   per month
--    Posting added to the accrual JE:  Dr 6100  /  Cr 2360 Gratuity Accrual
--    payroll_runs.total_gratuity records the accrued amount.
-- ─────────────────────────────────────────────────────────────────────────

ALTER TABLE public.employees    ADD COLUMN IF NOT EXISTS bank_routing_code TEXT;
ALTER TABLE public.companies    ADD COLUMN IF NOT EXISTS mol_establishment_id TEXT;
ALTER TABLE public.companies    ADD COLUMN IF NOT EXISTS wps_routing_code TEXT;
ALTER TABLE public.payroll_runs ADD COLUMN IF NOT EXISTS total_gratuity NUMERIC(15,2) NOT NULL DEFAULT 0;

-- ─── confirm_payroll_run v2 — adds gratuity accrual ───────────────────────
CREATE OR REPLACE FUNCTION public.confirm_payroll_run(p_run_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY INVOKER
AS $$
DECLARE
  v_user_id    UUID := auth.uid();
  v_run        public.payroll_runs%ROWTYPE;
  v_company_id UUID;
  v_gross      NUMERIC(15,2) := 0;
  v_ded        NUMERIC(15,2) := 0;
  v_loan       NUMERIC(15,2) := 0;
  v_net        NUMERIC(15,2) := 0;
  v_expense    NUMERIC(15,2) := 0;
  v_grat       NUMERIC(15,2) := 0;
  v_sal_exp_id UUID;  v_sal_pay_id UUID;  v_emp_adv_id UUID;  v_grat_id UUID;
  v_seq        BIGINT;
  v_entry      TEXT;
  v_je_id      UUID;
  v_label      TEXT;
BEGIN
  SELECT * INTO v_run FROM public.payroll_runs WHERE id = p_run_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Payroll run not found'; END IF;
  IF v_run.status <> 'draft' THEN RAISE EXCEPTION 'Only draft runs can be confirmed (status: %)', v_run.status; END IF;
  v_company_id := v_run.company_id;

  SELECT
    COALESCE(SUM(basic_salary + housing_allowance + transport_allowance + other_allowance + overtime + bonus), 0),
    COALESCE(SUM(deductions), 0),
    COALESCE(SUM(loan_repayment), 0)
  INTO v_gross, v_ded, v_loan
  FROM public.payroll_run_items WHERE run_id = p_run_id;

  IF v_gross <= 0 THEN RAISE EXCEPTION 'Payroll run has no earnings to post'; END IF;
  v_expense := v_gross - v_ded;
  v_net     := v_expense - v_loan;
  IF v_net < 0 THEN RAISE EXCEPTION 'Net pay is negative — check deductions / loan recoveries'; END IF;

  -- P2: one month of EOSB per employee with a joining date.
  -- 21 days/year of basic for the first 5 years of service, 30 after.
  SELECT COALESCE(SUM(
    CASE
      WHEN e.joining_date IS NULL OR i.basic_salary <= 0 THEN 0
      WHEN (EXTRACT(YEAR  FROM AGE(v_run.date, e.joining_date)) * 12
          + EXTRACT(MONTH FROM AGE(v_run.date, e.joining_date))) >= 60
        THEN ROUND(i.basic_salary * 30.0 / 30.0 / 12.0, 2)
      ELSE   ROUND(i.basic_salary * 21.0 / 30.0 / 12.0, 2)
    END
  ), 0)
  INTO v_grat
  FROM public.payroll_run_items i
  JOIN public.employees e ON e.id = i.employee_id
  WHERE i.run_id = p_run_id;

  SELECT id INTO v_sal_exp_id FROM public.chart_of_accounts WHERE company_id = v_company_id AND code = '6100';
  SELECT id INTO v_sal_pay_id FROM public.chart_of_accounts WHERE company_id = v_company_id AND code = '2350';
  SELECT id INTO v_emp_adv_id FROM public.chart_of_accounts WHERE company_id = v_company_id AND code = '1450';
  SELECT id INTO v_grat_id    FROM public.chart_of_accounts WHERE company_id = v_company_id AND code = '2360';
  IF v_sal_exp_id IS NULL OR v_sal_pay_id IS NULL THEN
    RAISE EXCEPTION 'Payroll accounts (6100 / 2350) missing — run the payroll migration CoA step';
  END IF;
  IF v_grat > 0 AND v_grat_id IS NULL THEN
    RAISE EXCEPTION 'Account 2360 Gratuity Accrual missing — run the payroll migration CoA step';
  END IF;

  INSERT INTO public.document_sequences (company_id, prefix, current_value, format, pad_zeros, reset_yearly)
  VALUES (v_company_id, 'JE', 1001, 'JE-{NUMBER}', 0, false)
  ON CONFLICT (company_id, prefix) DO UPDATE
    SET current_value = public.document_sequences.current_value + 1, updated_at = NOW()
  RETURNING current_value INTO v_seq;
  v_entry := 'JE-' || v_seq::TEXT;
  v_label := 'Payroll ' || v_run.run_number || ' — ' ||
             TO_CHAR(MAKE_DATE(v_run.period_year, v_run.period_month, 1), 'FMMonth YYYY');

  INSERT INTO public.journal_entries (
    company_id, entry_number, date, description,
    source_type, source_id, total_debit, total_credit, created_by
  ) VALUES (
    v_company_id, v_entry, v_run.date, v_label,
    'payroll_run', p_run_id, v_expense + v_grat, v_expense + v_grat, v_user_id
  ) RETURNING id INTO v_je_id;

  -- Dr 6100 — salaries (gross − deductions)
  INSERT INTO public.general_ledger
    (company_id, journal_entry_id, account_id, account_code, date, debit, credit, description, related_doc_type, related_doc_id)
  VALUES
    (v_company_id, v_je_id, v_sal_exp_id, '6100', v_run.date, v_expense, 0, v_label, 'payroll_run', p_run_id);

  -- Dr 6100 / Cr 2360 — gratuity accrual
  IF v_grat > 0 THEN
    INSERT INTO public.general_ledger
      (company_id, journal_entry_id, account_id, account_code, date, debit, credit, description, related_doc_type, related_doc_id)
    VALUES
      (v_company_id, v_je_id, v_sal_exp_id, '6100', v_run.date, v_grat, 0, v_label || ' — gratuity accrual (EOSB)', 'payroll_run', p_run_id),
      (v_company_id, v_je_id, v_grat_id,    '2360', v_run.date, 0, v_grat, v_label || ' — gratuity accrual (EOSB)', 'payroll_run', p_run_id);
  END IF;

  -- Cr 1450 — loan recoveries
  IF v_loan > 0 THEN
    IF v_emp_adv_id IS NULL THEN RAISE EXCEPTION 'Account 1450 Employee Advances missing'; END IF;
    INSERT INTO public.general_ledger
      (company_id, journal_entry_id, account_id, account_code, date, debit, credit, description, related_doc_type, related_doc_id)
    VALUES
      (v_company_id, v_je_id, v_emp_adv_id, '1450', v_run.date, 0, v_loan, v_label || ' — loan recovery', 'payroll_run', p_run_id);
  END IF;

  -- Cr 2350 — net pay
  INSERT INTO public.general_ledger
    (company_id, journal_entry_id, account_id, account_code, date, debit, credit, description, related_doc_type, related_doc_id)
  VALUES
    (v_company_id, v_je_id, v_sal_pay_id, '2350', v_run.date, 0, v_net, v_label, 'payroll_run', p_run_id);

  UPDATE public.payroll_runs SET
    status = 'confirmed', journal_entry_id = v_je_id,
    total_gross = v_gross, total_deductions = v_ded,
    total_loan_repayment = v_loan, total_net = v_net,
    total_gratuity = v_grat,
    updated_at = NOW()
  WHERE id = p_run_id;

  BEGIN
    INSERT INTO public.audit_logs (company_id, user_id, action, entity_type, entity_id, new_data)
    VALUES (v_company_id, v_user_id, 'confirm', 'payroll_run', p_run_id,
      jsonb_build_object('run_number', v_run.run_number, 'je', v_entry,
                         'gross', v_gross, 'net', v_net, 'gratuity', v_grat, 'phase', 'payroll-p2'));
  EXCEPTION WHEN OTHERS THEN NULL;
  END;

  RETURN jsonb_build_object('run_id', p_run_id, 'je_id', v_je_id, 'entry_number', v_entry,
                            'total_gross', v_gross, 'total_net', v_net, 'total_gratuity', v_grat);
END;
$$;
