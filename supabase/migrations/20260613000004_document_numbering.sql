-- ─────────────────────────────────────────────────────────────────────────
-- StockBolt — Document Numbering (2026-06-13)
-- ─────────────────────────────────────────────────────────────────────────
-- The document_sequences table always had format / pad_zeros /
-- reset_yearly / last_reset_year columns, but get_next_document_number
-- ignored them and returned a fixed "<PREFIX>-<n>". This upgrade makes
-- the Settings → Document Numbering page real:
--
--   format tokens:  {NUMBER}  the sequence value (padded per pad_zeros)
--                   {YYYY}    4-digit year   ·   {YY}  2-digit year
--   pad_zeros:      0 = no padding · e.g. 5 → 00042
--   reset_yearly:   restart at 1 each January (combine with {YYYY} in the
--                   format so numbers stay unique across years)
--
-- Existing behavior is preserved: default format '<PREFIX>-{NUMBER}',
-- first issued number 1001, lazy seeding on first use.
-- ─────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.get_next_document_number(
  p_company_id UUID,
  p_prefix     TEXT
)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY INVOKER
AS $$
DECLARE
  v_row  public.document_sequences%ROWTYPE;
  v_year INT := EXTRACT(YEAR FROM CURRENT_DATE)::INT;
  v_num  TEXT;
BEGIN
  -- Lazy-seed on first use (same defaults as before).
  INSERT INTO public.document_sequences
    (company_id, prefix, current_value, format, pad_zeros, reset_yearly)
  VALUES
    (p_company_id, p_prefix, 1000, p_prefix || '-{NUMBER}', 0, false)
  ON CONFLICT (company_id, prefix) DO NOTHING;

  -- Yearly reset, when enabled and a new year has started.
  UPDATE public.document_sequences
  SET current_value = 0, last_reset_year = v_year, updated_at = NOW()
  WHERE company_id = p_company_id AND prefix = p_prefix
    AND reset_yearly
    AND COALESCE(last_reset_year, EXTRACT(YEAR FROM updated_at)::INT) < v_year;

  UPDATE public.document_sequences
  SET current_value = current_value + 1, updated_at = NOW()
  WHERE company_id = p_company_id AND prefix = p_prefix
  RETURNING * INTO v_row;

  v_num := CASE
    WHEN v_row.pad_zeros > 0 THEN LPAD(v_row.current_value::TEXT, v_row.pad_zeros, '0')
    ELSE v_row.current_value::TEXT
  END;

  RETURN REPLACE(REPLACE(REPLACE(
    COALESCE(NULLIF(v_row.format, ''), p_prefix || '-{NUMBER}'),
    '{YYYY}', v_year::TEXT),
    '{YY}',   RIGHT(v_year::TEXT, 2)),
    '{NUMBER}', v_num);
END;
$$;
