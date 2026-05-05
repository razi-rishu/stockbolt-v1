-- Phase 7 — POS Sessions: open_pos_session + close_pos_session RPCs
-- open_pos_session: creates a new POS session for the current user
-- close_pos_session: closes the session, computes expected cash and variance

-- ── open_pos_session ───────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.open_pos_session(
  p_warehouse_id UUID,
  p_opening_cash NUMERIC DEFAULT 0,
  p_notes        TEXT    DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY INVOKER
AS $$
DECLARE
  v_user_id       UUID := auth.uid();
  v_company_id    UUID;
  v_seq           BIGINT;
  v_session_num   TEXT;
  v_session_id    UUID;
BEGIN
  SELECT company_id INTO v_company_id FROM public.profiles WHERE id = v_user_id;
  IF v_company_id IS NULL THEN
    RAISE EXCEPTION 'open_pos_session: no company for user %', v_user_id;
  END IF;

  -- Validate warehouse belongs to company
  IF NOT EXISTS (
    SELECT 1 FROM public.warehouses WHERE id = p_warehouse_id AND company_id = v_company_id
  ) THEN
    RAISE EXCEPTION 'open_pos_session: warehouse % not found', p_warehouse_id;
  END IF;

  -- Reject if user already has an open session
  IF EXISTS (
    SELECT 1 FROM public.pos_sessions
    WHERE company_id = v_company_id AND user_id = v_user_id AND status = 'open'
  ) THEN
    RAISE EXCEPTION 'open_pos_session: user already has an open POS session';
  END IF;

  -- Session number sequence
  INSERT INTO public.document_sequences
    (company_id, prefix, current_value, format, pad_zeros, reset_yearly)
  VALUES
    (v_company_id, 'POS', 1000, 'POS-{NUMBER}', 0, false)
  ON CONFLICT (company_id, prefix) DO UPDATE
    SET current_value = public.document_sequences.current_value + 1,
        updated_at    = NOW()
  RETURNING current_value INTO v_seq;
  v_session_num := 'POS-' || v_seq::TEXT;

  INSERT INTO public.pos_sessions (
    company_id, session_number, user_id, warehouse_id,
    opened_at, opening_cash, status,
    total_sales_amount, total_sales_count, notes
  ) VALUES (
    v_company_id, v_session_num, v_user_id, p_warehouse_id,
    NOW(), p_opening_cash, 'open',
    0, 0, p_notes
  ) RETURNING id INTO v_session_id;

  RETURN jsonb_build_object(
    'session_id',     v_session_id,
    'session_number', v_session_num,
    'warehouse_id',   p_warehouse_id,
    'opening_cash',   p_opening_cash,
    'opened_at',      NOW()
  );
END;
$$;

-- ── close_pos_session ──────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.close_pos_session(
  p_session_id       UUID,
  p_counted_cash     NUMERIC,
  p_variance_reason  TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY INVOKER
AS $$
DECLARE
  v_user_id       UUID := auth.uid();
  v_company_id    UUID;
  v_session       public.pos_sessions%ROWTYPE;
  v_cash_sales    NUMERIC(15,2);
  v_expected      NUMERIC(15,2);
  v_variance      NUMERIC(15,2);
BEGIN
  SELECT company_id INTO v_company_id FROM public.profiles WHERE id = v_user_id;

  SELECT * INTO v_session
  FROM public.pos_sessions
  WHERE id = p_session_id AND company_id = v_company_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'close_pos_session: session % not found', p_session_id;
  END IF;
  IF v_session.status <> 'open' THEN
    RAISE EXCEPTION 'close_pos_session: session % is already %', p_session_id, v_session.status;
  END IF;

  -- Expected cash = opening cash + all confirmed cash-sale totals in this session
  SELECT COALESCE(SUM(total_amount), 0)::NUMERIC(15,2)
  INTO v_cash_sales
  FROM public.invoices
  WHERE pos_session_id = p_session_id
    AND sale_channel = 'pos_cash'
    AND status = 'confirmed';

  v_expected := v_session.opening_cash + v_cash_sales;
  v_variance := p_counted_cash - v_expected;

  UPDATE public.pos_sessions SET
    status                 = 'closed',
    closed_at              = NOW(),
    closing_cash_counted   = p_counted_cash,
    closing_cash_expected  = v_expected,
    cash_variance          = v_variance,
    variance_reason        = p_variance_reason,
    updated_at             = NOW()
  WHERE id = p_session_id;

  RETURN jsonb_build_object(
    'session_id',          p_session_id,
    'session_number',      v_session.session_number,
    'opening_cash',        v_session.opening_cash,
    'cash_sales',          v_cash_sales,
    'expected_cash',       v_expected,
    'counted_cash',        p_counted_cash,
    'variance',            v_variance,
    'total_sales_amount',  v_session.total_sales_amount,
    'total_sales_count',   v_session.total_sales_count
  );
END;
$$;
