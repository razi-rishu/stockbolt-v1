-- Phase 8 Report RPCs: Daily Cash + Bank Reconciliation
-- G2: Daily Cash — opening balance, inflows, outflows, closing balance per bank account
-- G4: Bank Reconciliation — GL entries for a bank account with running balance

-- ── get_daily_cash_report ────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION get_daily_cash_report(
  p_company_id  UUID,
  p_date        DATE
)
RETURNS TABLE (
  account_id       UUID,
  account_code     TEXT,
  account_name     TEXT,
  opening_balance  NUMERIC,
  total_in         NUMERIC,
  total_out        NUMERIC,
  closing_balance  NUMERIC
)
LANGUAGE plpgsql SECURITY DEFINER
AS $$
BEGIN
  RETURN QUERY
  WITH bank_coa AS (
    -- Get all COA accounts linked to bank accounts for this company
    SELECT DISTINCT ba.coa_account_id
    FROM   bank_accounts ba
    WHERE  ba.company_id = p_company_id
      AND  ba.coa_account_id IS NOT NULL
  ),
  opening AS (
    -- Sum all JE lines for this COA account BEFORE p_date
    SELECT
      jel.account_id,
      SUM(jel.debit - jel.credit) AS opening_balance
    FROM   journal_entry_lines  jel
    JOIN   journal_entries      je  ON je.id = jel.journal_entry_id
    JOIN   bank_coa             bc  ON bc.coa_account_id = jel.account_id
    WHERE  je.company_id = p_company_id
      AND  je.date        < p_date
      AND  je.is_reversed = FALSE
    GROUP  BY jel.account_id
  ),
  day_flows AS (
    -- Sum JE lines ON p_date
    SELECT
      jel.account_id,
      SUM(CASE WHEN jel.debit  > 0 THEN jel.debit  ELSE 0 END) AS total_in,
      SUM(CASE WHEN jel.credit > 0 THEN jel.credit ELSE 0 END) AS total_out
    FROM   journal_entry_lines  jel
    JOIN   journal_entries      je  ON je.id = jel.journal_entry_id
    JOIN   bank_coa             bc  ON bc.coa_account_id = jel.account_id
    WHERE  je.company_id = p_company_id
      AND  je.date        = p_date
      AND  je.is_reversed = FALSE
    GROUP  BY jel.account_id
  )
  SELECT
    ca.id                                            AS account_id,
    ca.code                                          AS account_code,
    ca.name                                          AS account_name,
    COALESCE(o.opening_balance, 0)                   AS opening_balance,
    COALESCE(d.total_in,  0)                         AS total_in,
    COALESCE(d.total_out, 0)                         AS total_out,
    COALESCE(o.opening_balance, 0)
      + COALESCE(d.total_in,  0)
      - COALESCE(d.total_out, 0)                     AS closing_balance
  FROM   bank_coa    bc
  JOIN   chart_of_accounts ca ON ca.id = bc.coa_account_id
  LEFT   JOIN opening       o  ON o.account_id = bc.coa_account_id
  LEFT   JOIN day_flows     d  ON d.account_id = bc.coa_account_id
  WHERE  ca.company_id = p_company_id
  ORDER  BY ca.code;
END;
$$;

-- ── get_bank_recon ───────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION get_bank_recon(
  p_company_id  UUID,
  p_account_id  UUID,       -- bank_accounts.id
  p_date_from   DATE,
  p_date_to     DATE
)
RETURNS TABLE (
  date             DATE,
  je_number        TEXT,
  source_type      TEXT,
  description      TEXT,
  debit            NUMERIC,
  credit           NUMERIC,
  running_balance  NUMERIC
)
LANGUAGE plpgsql SECURITY DEFINER
AS $$
DECLARE
  v_coa_id UUID;
  v_opening NUMERIC;
BEGIN
  -- Resolve bank account → COA account
  SELECT coa_account_id INTO v_coa_id
  FROM   bank_accounts
  WHERE  id = p_account_id AND company_id = p_company_id;

  IF v_coa_id IS NULL THEN
    RETURN;
  END IF;

  -- Opening balance = sum of all lines before p_date_from
  SELECT COALESCE(SUM(jel.debit - jel.credit), 0) INTO v_opening
  FROM   journal_entry_lines jel
  JOIN   journal_entries     je  ON je.id = jel.journal_entry_id
  WHERE  je.company_id  = p_company_id
    AND  jel.account_id = v_coa_id
    AND  je.date        < p_date_from
    AND  je.is_reversed = FALSE;

  RETURN QUERY
  SELECT
    je.date                                                          AS date,
    je.entry_number                                                  AS je_number,
    je.source_type                                                   AS source_type,
    je.description                                                   AS description,
    jel.debit                                                        AS debit,
    jel.credit                                                       AS credit,
    v_opening + SUM(jel.debit - jel.credit)
      OVER (ORDER BY je.date, je.entry_number ROWS UNBOUNDED PRECEDING) AS running_balance
  FROM   journal_entry_lines  jel
  JOIN   journal_entries      je  ON je.id = jel.journal_entry_id
  WHERE  je.company_id  = p_company_id
    AND  jel.account_id = v_coa_id
    AND  je.date        BETWEEN p_date_from AND p_date_to
    AND  je.is_reversed = FALSE
  ORDER  BY je.date, je.entry_number;
END;
$$;

GRANT EXECUTE ON FUNCTION get_daily_cash_report(UUID, DATE)            TO authenticated;
GRANT EXECUTE ON FUNCTION get_bank_recon(UUID, UUID, DATE, DATE)       TO authenticated;
