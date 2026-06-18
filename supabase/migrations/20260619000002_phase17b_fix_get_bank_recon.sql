-- ─────────────────────────────────────────────────────────────────────────
-- StockBolt v1 — Fix get_bank_recon (Bank Reconciliation report)
-- ─────────────────────────────────────────────────────────────────────────
-- BUG: the original get_bank_recon (phase8_04_reports) queried a table
-- `journal_entry_lines` and a column `journal_entries.is_reversed` — NEITHER
-- exists in this schema. The financial source of truth is `general_ledger`
-- (per AGENTS.md Rule 1), which is what the General Ledger page and the
-- /banking/reconciliation page read. The report therefore returned nothing
-- ("No transactions found") even when the bank account had GL activity.
--
-- This rewrites the function to read general_ledger, joined to journal_entries
-- for the entry number + source type. Read-only report — no posting/GL-engine
-- change. Reversed entries are hidden (both the original and its reversing
-- line) to match the General Ledger page's default; balances are unaffected
-- since a reversed pair nets to zero either way.
-- ─────────────────────────────────────────────────────────────────────────

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

  -- Opening balance = net of all (non-reversed) GL lines before p_date_from
  SELECT COALESCE(SUM(gl.debit - gl.credit), 0) INTO v_opening
  FROM   general_ledger gl
  WHERE  gl.company_id  = p_company_id
    AND  gl.account_id  = v_coa_id
    AND  gl.date        < p_date_from
    AND  gl.reversal_of_id IS NULL
    AND  gl.id NOT IN (
           SELECT r.reversal_of_id FROM general_ledger r
           WHERE  r.company_id = p_company_id AND r.reversal_of_id IS NOT NULL
         );

  RETURN QUERY
  SELECT
    gl.date                                                          AS date,
    je.entry_number                                                  AS je_number,
    je.source_type                                                   AS source_type,
    gl.description                                                   AS description,
    gl.debit                                                         AS debit,
    gl.credit                                                        AS credit,
    v_opening + SUM(gl.debit - gl.credit)
      OVER (ORDER BY gl.date, je.entry_number ROWS UNBOUNDED PRECEDING) AS running_balance
  FROM   general_ledger gl
  JOIN   journal_entries je ON je.id = gl.journal_entry_id
  WHERE  gl.company_id  = p_company_id
    AND  gl.account_id  = v_coa_id
    AND  gl.date        BETWEEN p_date_from AND p_date_to
    AND  gl.reversal_of_id IS NULL
    AND  gl.id NOT IN (
           SELECT r.reversal_of_id FROM general_ledger r
           WHERE  r.company_id = p_company_id AND r.reversal_of_id IS NOT NULL
         )
  ORDER  BY gl.date, je.entry_number;
END;
$$;

GRANT EXECUTE ON FUNCTION get_bank_recon(UUID, UUID, DATE, DATE) TO authenticated;
