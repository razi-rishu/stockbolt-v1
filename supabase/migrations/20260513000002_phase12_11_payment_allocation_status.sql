-- ─────────────────────────────────────────────────────────────────────────
-- StockBolt v1 — Phase 12 — Migration 11: payment allocation_status
-- ─────────────────────────────────────────────────────────────────────────
-- Surfaces "is this payment fully applied, partially applied, or just
-- sitting as advance" as a queryable column on the payments table.
--
-- Why a separate column (not an expansion of payments.status):
--   - status drives the lifecycle (draft → confirmed → void) and is
--     written by confirm_*, void_*, etc. RPCs. Expanding it would force
--     every alloc-changing RPC (apply_advance, apply_vendor_advance,
--     confirm_credit_note, etc.) to recompute the bucket. High blast
--     radius and easy to drift.
--   - allocation_status is a derived attribute. It depends only on
--     (payment.amount, payment.status, SUM(payment_allocations.amount_applied)).
--     A trigger keeps it in sync; nothing else needs to know.
--
-- Charter labels → values used here:
--   "Posted" (no allocations yet)         → 'unallocated'
--   "Partially Allocated"                 → 'partial'
--   "Completed" (fully applied)           → 'full'
--   "Draft" / "Cancelled" / "Reconciled"  → NULL (irrelevant for those
--                                            states; UI shows status only)
-- ─────────────────────────────────────────────────────────────────────────

-- ── Column ───────────────────────────────────────────────────────────────
ALTER TABLE public.payments
  ADD COLUMN IF NOT EXISTS allocation_status TEXT
    CHECK (allocation_status IN ('unallocated','partial','full'))
    DEFAULT NULL;

COMMENT ON COLUMN public.payments.allocation_status IS
  'Secondary state showing how much of a confirmed payment has been applied. '
  'unallocated = nothing applied (advance/on_account); '
  'partial = some applied, the rest sits as advance; '
  'full = allocations sum to the payment amount. '
  'NULL when status is not confirmed.';

CREATE INDEX IF NOT EXISTS payments_allocation_status_idx
  ON public.payments (allocation_status) WHERE allocation_status IS NOT NULL;

-- ── Recompute function ───────────────────────────────────────────────────
-- One source of truth. Triggers below all call this.
CREATE OR REPLACE FUNCTION public._recompute_payment_allocation_status(p_payment_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_status   TEXT;
  v_amount   NUMERIC(15,2);
  v_alloc    NUMERIC(15,2);
  v_new      TEXT;
BEGIN
  SELECT status, amount INTO v_status, v_amount
  FROM public.payments WHERE id = p_payment_id;

  IF NOT FOUND THEN
    RETURN;
  END IF;

  -- Only confirmed payments carry an allocation_status. Drafts and
  -- voided payments leave it NULL.
  IF v_status <> 'confirmed' THEN
    UPDATE public.payments SET allocation_status = NULL
     WHERE id = p_payment_id AND allocation_status IS DISTINCT FROM NULL;
    RETURN;
  END IF;

  SELECT COALESCE(SUM(amount_applied), 0) INTO v_alloc
  FROM public.payment_allocations
  WHERE payment_id = p_payment_id;

  v_new := CASE
    WHEN v_alloc <= 0.005                       THEN 'unallocated'
    WHEN v_alloc + 0.005 >= COALESCE(v_amount, 0) THEN 'full'
    ELSE                                              'partial'
  END;

  UPDATE public.payments
     SET allocation_status = v_new
   WHERE id = p_payment_id
     AND allocation_status IS DISTINCT FROM v_new;
END;
$$;

-- ── Trigger A: when payment_allocations rows change ──────────────────────
-- Fires per row; we want one recompute per (changed) payment_id.
CREATE OR REPLACE FUNCTION public._trg_payment_alloc_status_alloc()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    PERFORM public._recompute_payment_allocation_status(OLD.payment_id);
  ELSIF TG_OP = 'UPDATE' AND OLD.payment_id IS DISTINCT FROM NEW.payment_id THEN
    PERFORM public._recompute_payment_allocation_status(OLD.payment_id);
    PERFORM public._recompute_payment_allocation_status(NEW.payment_id);
  ELSE
    PERFORM public._recompute_payment_allocation_status(NEW.payment_id);
  END IF;
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS payment_allocations_recompute_status ON public.payment_allocations;
CREATE TRIGGER payment_allocations_recompute_status
AFTER INSERT OR UPDATE OR DELETE ON public.payment_allocations
FOR EACH ROW EXECUTE FUNCTION public._trg_payment_alloc_status_alloc();

-- ── Trigger B: when payment.amount or payment.status changes ─────────────
-- A confirmation, voiding, or amount edit on a draft can flip the bucket.
-- Note WHEN clause excludes recursive triggers from our own
-- allocation_status writes (we only fire on amount or status changes).
CREATE OR REPLACE FUNCTION public._trg_payment_alloc_status_pmt()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  PERFORM public._recompute_payment_allocation_status(NEW.id);
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS payments_recompute_alloc_status ON public.payments;
CREATE TRIGGER payments_recompute_alloc_status
AFTER UPDATE OF amount, status ON public.payments
FOR EACH ROW
WHEN (
     OLD.amount IS DISTINCT FROM NEW.amount
  OR OLD.status IS DISTINCT FROM NEW.status
)
EXECUTE FUNCTION public._trg_payment_alloc_status_pmt();

-- Also need to fire on INSERT in case payments are inserted in
-- 'confirmed' state with allocations in the same transaction
-- (shouldn't happen in normal flow, but defensive).
DROP TRIGGER IF EXISTS payments_recompute_alloc_status_ins ON public.payments;
CREATE TRIGGER payments_recompute_alloc_status_ins
AFTER INSERT ON public.payments
FOR EACH ROW
WHEN (NEW.status = 'confirmed')
EXECUTE FUNCTION public._trg_payment_alloc_status_pmt();

-- ── Backfill existing rows ───────────────────────────────────────────────
DO $$
DECLARE r RECORD;
BEGIN
  FOR r IN SELECT id FROM public.payments WHERE status = 'confirmed' LOOP
    PERFORM public._recompute_payment_allocation_status(r.id);
  END LOOP;
END $$;

REVOKE ALL ON FUNCTION public._recompute_payment_allocation_status(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public._recompute_payment_allocation_status(UUID) TO authenticated;
