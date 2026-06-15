-- ─────────────────────────────────────────────────────────────────────────
-- StockBolt — Payroll P1 (2026-06-13)
-- ─────────────────────────────────────────────────────────────────────────
-- OWNER OVERRIDE: payroll was deferred to v2 per Doc 1 / Doc 5. Rashid
-- explicitly amended that decision on 2026-06-13 and chose the full
-- module, built in phases:
--   P1 (this migration): employees master · monthly payroll runs ·
--       GL accrual + payment posting
--   P2: WPS SIF export · gratuity accrual engine
--   P3: employee loans & advances UI
--   P4: leave tracking
--
-- Accounting (Doc 3 conventions):
--   Confirm run:  Dr 6100 Salaries & Benefits (gross − deductions)
--                 Cr 1450 Employee Advances   (loan recoveries)
--                 Cr 2350 Salaries Payable    (net pay)
--   Pay run:      Dr 2350 Salaries Payable    (net pay)
--                 Cr <bank CoA>               (net pay)
-- ─────────────────────────────────────────────────────────────────────────

-- ─── 1. Chart of accounts — new payroll accounts ──────────────────────────
-- For every existing company. New companies get them via seedCOA.ts.
INSERT INTO public.chart_of_accounts (company_id, code, name, name_ar, type, sub_type, is_system, is_active)
SELECT c.id, v.code, v.name, v.name_ar, v.type, v.sub_type, true, true
FROM public.companies c
CROSS JOIN (VALUES
  ('6100', 'Salaries & Benefits', 'الرواتب والمزايا',      'expense',   'indirect'),
  ('2350', 'Salaries Payable',    'رواتب مستحقة الدفع',    'liability', 'current'),
  ('2360', 'Gratuity Accrual',    'مخصص مكافأة نهاية الخدمة','liability','current'),
  ('1450', 'Employee Advances',   'سلف الموظفين',          'asset',     'current')
) AS v(code, name, name_ar, type, sub_type)
WHERE NOT EXISTS (
  SELECT 1 FROM public.chart_of_accounts a
  WHERE a.company_id = c.id AND a.code = v.code
);

-- ─── 2. Tables ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.employees (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id          UUID NOT NULL REFERENCES public.companies(id),
  code                TEXT,                          -- EMP-0001
  name                TEXT NOT NULL,
  name_ar             TEXT,
  designation         TEXT,
  phone               TEXT,
  email               TEXT,
  emirates_id         TEXT,
  passport_no         TEXT,
  mol_id              TEXT,                          -- WPS labour card / MOL personal no (P2)
  bank_name           TEXT,
  iban                TEXT,                          -- WPS payout (P2)
  joining_date        DATE,                          -- gratuity base (P2)
  basic_salary        NUMERIC(15,2) NOT NULL DEFAULT 0,
  housing_allowance   NUMERIC(15,2) NOT NULL DEFAULT 0,
  transport_allowance NUMERIC(15,2) NOT NULL DEFAULT 0,
  other_allowance     NUMERIC(15,2) NOT NULL DEFAULT 0,
  is_active           BOOLEAN NOT NULL DEFAULT true,
  notes               TEXT,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (company_id, code)
);

CREATE TABLE IF NOT EXISTS public.payroll_runs (
  id                       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id               UUID NOT NULL REFERENCES public.companies(id),
  run_number               TEXT NOT NULL,            -- PAY-1001
  period_year              INT  NOT NULL,
  period_month             INT  NOT NULL CHECK (period_month BETWEEN 1 AND 12),
  date                     DATE NOT NULL,            -- posting date (usually month end)
  status                   TEXT NOT NULL DEFAULT 'draft'
                           CHECK (status IN ('draft','confirmed','paid','void')),
  journal_entry_id         UUID REFERENCES public.journal_entries(id),
  payment_journal_entry_id UUID REFERENCES public.journal_entries(id),
  bank_account_id          UUID REFERENCES public.bank_accounts(id),
  total_gross              NUMERIC(15,2) NOT NULL DEFAULT 0,
  total_deductions         NUMERIC(15,2) NOT NULL DEFAULT 0,
  total_loan_repayment     NUMERIC(15,2) NOT NULL DEFAULT 0,
  total_net                NUMERIC(15,2) NOT NULL DEFAULT 0,
  notes                    TEXT,
  created_at               TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at               TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (company_id, run_number),
  UNIQUE (company_id, period_year, period_month)
);

CREATE TABLE IF NOT EXISTS public.payroll_run_items (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id          UUID NOT NULL REFERENCES public.companies(id),
  run_id              UUID NOT NULL REFERENCES public.payroll_runs(id) ON DELETE CASCADE,
  employee_id         UUID NOT NULL REFERENCES public.employees(id),
  basic_salary        NUMERIC(15,2) NOT NULL DEFAULT 0,
  housing_allowance   NUMERIC(15,2) NOT NULL DEFAULT 0,
  transport_allowance NUMERIC(15,2) NOT NULL DEFAULT 0,
  other_allowance     NUMERIC(15,2) NOT NULL DEFAULT 0,
  overtime            NUMERIC(15,2) NOT NULL DEFAULT 0,
  bonus               NUMERIC(15,2) NOT NULL DEFAULT 0,
  deductions          NUMERIC(15,2) NOT NULL DEFAULT 0,  -- absence / fines (reduces 6100)
  loan_repayment      NUMERIC(15,2) NOT NULL DEFAULT 0,  -- recovers 1450
  notes               TEXT,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (run_id, employee_id)
);

-- Groundwork for P3 (loans UI). No client access yet.
CREATE TABLE IF NOT EXISTS public.employee_loans (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id          UUID NOT NULL REFERENCES public.companies(id),
  employee_id         UUID NOT NULL REFERENCES public.employees(id),
  date                DATE NOT NULL,
  amount              NUMERIC(15,2) NOT NULL,
  monthly_installment NUMERIC(15,2) NOT NULL DEFAULT 0,
  balance             NUMERIC(15,2) NOT NULL,
  status              TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','settled','written_off')),
  journal_entry_id    UUID REFERENCES public.journal_entries(id),
  notes               TEXT,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ─── 3. RLS — standard tenant isolation ───────────────────────────────────
ALTER TABLE public.employees ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON public.employees
  FOR ALL USING (company_id = public.current_user_company_id())
  WITH CHECK (company_id = public.current_user_company_id());

ALTER TABLE public.payroll_runs ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON public.payroll_runs
  FOR ALL USING (company_id = public.current_user_company_id())
  WITH CHECK (company_id = public.current_user_company_id());

ALTER TABLE public.payroll_run_items ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON public.payroll_run_items
  FOR ALL USING (company_id = public.current_user_company_id())
  WITH CHECK (company_id = public.current_user_company_id());

ALTER TABLE public.employee_loans ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON public.employee_loans
  FOR ALL USING (company_id = public.current_user_company_id())
  WITH CHECK (company_id = public.current_user_company_id());

-- ─── 4. confirm_payroll_run ────────────────────────────────────────────────
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
  v_sal_exp_id UUID;  v_sal_pay_id UUID;  v_emp_adv_id UUID;
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

  SELECT id INTO v_sal_exp_id FROM public.chart_of_accounts WHERE company_id = v_company_id AND code = '6100';
  SELECT id INTO v_sal_pay_id FROM public.chart_of_accounts WHERE company_id = v_company_id AND code = '2350';
  SELECT id INTO v_emp_adv_id FROM public.chart_of_accounts WHERE company_id = v_company_id AND code = '1450';
  IF v_sal_exp_id IS NULL OR v_sal_pay_id IS NULL THEN
    RAISE EXCEPTION 'Payroll accounts (6100 / 2350) missing — run the payroll migration CoA step';
  END IF;

  -- JE number from the shared sequence
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
    'payroll_run', p_run_id, v_expense, v_expense, v_user_id
  ) RETURNING id INTO v_je_id;

  -- Dr 6100 Salaries & Benefits (gross − deductions)
  INSERT INTO public.general_ledger
    (company_id, journal_entry_id, account_id, account_code, date, debit, credit, description, related_doc_type, related_doc_id)
  VALUES
    (v_company_id, v_je_id, v_sal_exp_id, '6100', v_run.date, v_expense, 0, v_label, 'payroll_run', p_run_id);

  -- Cr 1450 Employee Advances (loan recoveries)
  IF v_loan > 0 THEN
    IF v_emp_adv_id IS NULL THEN RAISE EXCEPTION 'Account 1450 Employee Advances missing'; END IF;
    INSERT INTO public.general_ledger
      (company_id, journal_entry_id, account_id, account_code, date, debit, credit, description, related_doc_type, related_doc_id)
    VALUES
      (v_company_id, v_je_id, v_emp_adv_id, '1450', v_run.date, 0, v_loan, v_label || ' — loan recovery', 'payroll_run', p_run_id);
  END IF;

  -- Cr 2350 Salaries Payable (net pay)
  INSERT INTO public.general_ledger
    (company_id, journal_entry_id, account_id, account_code, date, debit, credit, description, related_doc_type, related_doc_id)
  VALUES
    (v_company_id, v_je_id, v_sal_pay_id, '2350', v_run.date, 0, v_net, v_label, 'payroll_run', p_run_id);

  UPDATE public.payroll_runs SET
    status = 'confirmed', journal_entry_id = v_je_id,
    total_gross = v_gross, total_deductions = v_ded,
    total_loan_repayment = v_loan, total_net = v_net,
    updated_at = NOW()
  WHERE id = p_run_id;

  BEGIN
    INSERT INTO public.audit_logs (company_id, user_id, action, entity_type, entity_id, new_data)
    VALUES (v_company_id, v_user_id, 'confirm', 'payroll_run', p_run_id,
      jsonb_build_object('run_number', v_run.run_number, 'je', v_entry,
                         'gross', v_gross, 'net', v_net, 'phase', 'payroll-p1'));
  EXCEPTION WHEN OTHERS THEN NULL;
  END;

  RETURN jsonb_build_object('run_id', p_run_id, 'je_id', v_je_id, 'entry_number', v_entry,
                            'total_gross', v_gross, 'total_net', v_net);
END;
$$;

-- ─── 5. pay_payroll_run ────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.pay_payroll_run(
  p_run_id UUID, p_bank_account_id UUID, p_date DATE DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY INVOKER
AS $$
DECLARE
  v_user_id    UUID := auth.uid();
  v_run        public.payroll_runs%ROWTYPE;
  v_company_id UUID;
  v_pay_date   DATE;
  v_bank_coa   UUID;
  v_bank_code  TEXT;
  v_sal_pay_id UUID;
  v_seq        BIGINT;
  v_entry      TEXT;
  v_je_id      UUID;
  v_label      TEXT;
BEGIN
  SELECT * INTO v_run FROM public.payroll_runs WHERE id = p_run_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Payroll run not found'; END IF;
  IF v_run.status <> 'confirmed' THEN RAISE EXCEPTION 'Only confirmed runs can be paid (status: %)', v_run.status; END IF;
  IF v_run.total_net <= 0 THEN RAISE EXCEPTION 'Nothing to pay — net total is zero'; END IF;
  v_company_id := v_run.company_id;
  v_pay_date   := COALESCE(p_date, CURRENT_DATE);

  SELECT ba.coa_account_id, a.code INTO v_bank_coa, v_bank_code
  FROM public.bank_accounts ba
  JOIN public.chart_of_accounts a ON a.id = ba.coa_account_id
  WHERE ba.id = p_bank_account_id AND ba.company_id = v_company_id;
  IF v_bank_coa IS NULL THEN RAISE EXCEPTION 'Bank account not found'; END IF;

  SELECT id INTO v_sal_pay_id FROM public.chart_of_accounts WHERE company_id = v_company_id AND code = '2350';

  INSERT INTO public.document_sequences (company_id, prefix, current_value, format, pad_zeros, reset_yearly)
  VALUES (v_company_id, 'JE', 1001, 'JE-{NUMBER}', 0, false)
  ON CONFLICT (company_id, prefix) DO UPDATE
    SET current_value = public.document_sequences.current_value + 1, updated_at = NOW()
  RETURNING current_value INTO v_seq;
  v_entry := 'JE-' || v_seq::TEXT;
  v_label := 'Salary payment ' || v_run.run_number;

  INSERT INTO public.journal_entries (
    company_id, entry_number, date, description,
    source_type, source_id, total_debit, total_credit, created_by
  ) VALUES (
    v_company_id, v_entry, v_pay_date, v_label,
    'payroll_run', p_run_id, v_run.total_net, v_run.total_net, v_user_id
  ) RETURNING id INTO v_je_id;

  INSERT INTO public.general_ledger
    (company_id, journal_entry_id, account_id, account_code, date, debit, credit, description, related_doc_type, related_doc_id)
  VALUES
    (v_company_id, v_je_id, v_sal_pay_id, '2350', v_pay_date, v_run.total_net, 0, v_label, 'payroll_run', p_run_id),
    (v_company_id, v_je_id, v_bank_coa, v_bank_code, v_pay_date, 0, v_run.total_net, v_label, 'payroll_run', p_run_id);

  UPDATE public.payroll_runs SET
    status = 'paid', payment_journal_entry_id = v_je_id,
    bank_account_id = p_bank_account_id, updated_at = NOW()
  WHERE id = p_run_id;

  BEGIN
    INSERT INTO public.audit_logs (company_id, user_id, action, entity_type, entity_id, new_data)
    VALUES (v_company_id, v_user_id, 'pay', 'payroll_run', p_run_id,
      jsonb_build_object('run_number', v_run.run_number, 'je', v_entry, 'net', v_run.total_net));
  EXCEPTION WHEN OTHERS THEN NULL;
  END;

  RETURN jsonb_build_object('run_id', p_run_id, 'je_id', v_je_id, 'entry_number', v_entry);
END;
$$;
