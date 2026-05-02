-- Phase 4 — Helper: get_next_document_number
-- Lazily seeds the sequence row on first call; thread-safe via ON CONFLICT.
-- Used by TypeScript when creating draft invoices, quotes, payments.

CREATE OR REPLACE FUNCTION public.get_next_document_number(
  p_company_id UUID,
  p_prefix     TEXT
)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY INVOKER
AS $$
DECLARE
  v_seq BIGINT;
BEGIN
  INSERT INTO public.document_sequences
    (company_id, prefix, current_value, format, pad_zeros, reset_yearly)
  VALUES
    (p_company_id, p_prefix, 1000, p_prefix || '-{NUMBER}', 0, false)
  ON CONFLICT (company_id, prefix) DO UPDATE
    SET current_value = public.document_sequences.current_value + 1,
        updated_at    = NOW()
  RETURNING current_value INTO v_seq;

  RETURN p_prefix || '-' || v_seq::TEXT;
END;
$$;
