-- ─────────────────────────────────────────────────────────────────────────
-- StockBolt v1 — Phase 0 — Migration 14: Section J (POS)
-- ─────────────────────────────────────────────────────────────────────────
-- Per Doc 2 §J: pos_sessions.
-- Also wires up the deferred FK invoices.pos_session_id -> pos_sessions.
-- ─────────────────────────────────────────────────────────────────────────

CREATE TABLE public.pos_sessions (
  id                          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id                  UUID NOT NULL REFERENCES public.companies(id) ON DELETE RESTRICT,
  session_number              TEXT NOT NULL,
  user_id                     UUID NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  warehouse_id                UUID NOT NULL REFERENCES public.warehouses(id) ON DELETE RESTRICT,
  opened_at                   TIMESTAMPTZ NOT NULL,
  opening_cash                NUMERIC(15,2) NOT NULL,
  closed_at                   TIMESTAMPTZ,
  closing_cash_counted        NUMERIC(15,2),
  closing_cash_expected       NUMERIC(15,2),
  cash_variance               NUMERIC(15,2),
  variance_reason             TEXT,
  status                      TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','closed')),
  total_sales_amount          NUMERIC(15,2),
  total_sales_count           INTEGER,
  notes                       TEXT,
  created_at                  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at                  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (company_id, session_number)
);
CREATE INDEX pos_sessions_user_status_idx          ON public.pos_sessions (user_id, status);
CREATE INDEX pos_sessions_warehouse_opened_at_idx  ON public.pos_sessions (warehouse_id, opened_at);
CREATE TRIGGER pos_sessions_set_updated_at BEFORE UPDATE ON public.pos_sessions
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- Wire deferred FK on invoices.pos_session_id (created bare in migration 08).
ALTER TABLE public.invoices
  ADD CONSTRAINT invoices_pos_session_id_fkey
  FOREIGN KEY (pos_session_id)
  REFERENCES public.pos_sessions(id)
  ON DELETE SET NULL;
