-- ─────────────────────────────────────────────────────────────────────────
-- StockBolt v1 — Phase 12 — Migration 10: update_payment_draft RPC
-- ─────────────────────────────────────────────────────────────────────────
-- Lets the customer and vendor payment editors save changes to an existing
-- DRAFT payment (including replacing its payment_allocations atomically).
--
-- Background:
--   - The payment editor UI shows canEdit = isNew || status='draft', but
--     saveMutation always called payments.create() / vendorPayments.create()
--     even for existing drafts. Re-saving an existing draft would fail on
--     the (company_id, payment_number) UNIQUE constraint.
--   - This RPC is the missing piece. It allows mutating a draft row plus
--     replacing its allocations in a single transaction.
--
-- Safety contract (the charter):
--   - status must be 'draft' (FOR UPDATE lock + assertion). Refuses to
--     touch confirmed or void payments — those would have GL already
--     posted from the OLD values, so a silent update would corrupt the
--     ledger, AR/AP aging, and bank balance forever.
--   - Immutable fields are NEVER overwritten: id, company_id,
--     payment_number, type, status, void_*, created_at, audit fields.
--   - Allocations are fully replaced (delete + insert). Drafts have no GL
--     impact yet, so replacing them does NOT need any GL reversal.
--   - Each new allocation is validated:
--       * doc_type must match payment type:
--           inbound  → invoice or credit_note
--           outbound → vendor_bill or debit_note
--       * doc_id must reference a real document in this company
--       * doc's contact_id must match the (possibly updated) payment.contact_id
--       * amount_applied must be > 0
--   - Used by BOTH PaymentsAPI.update (customer) and
--     VendorPaymentsAPI.update (vendor) — they share the payments table.
-- ─────────────────────────────────────────────────────────────────────────

-- Allocation semantics:
--   p_allocations = NULL          → do NOT touch existing allocations
--   p_allocations = '[]'::jsonb   → clear all allocations
--   p_allocations = '[ {...} ]'   → replace with this set
CREATE OR REPLACE FUNCTION public.update_payment_draft(
  p_payment_id   UUID,
  p_row          JSONB,
  p_allocations  JSONB DEFAULT NULL
)
RETURNS public.payments
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_pmt          public.payments;
  v_company_id   UUID;
  v_type         TEXT;
  v_new_contact  UUID;
  v_alloc        JSONB;
  v_doc_type     TEXT;
  v_doc_id       UUID;
  v_amount       NUMERIC(15,2);
  v_doc_contact  UUID;
  v_total_alloc  NUMERIC(15,2) := 0;
  v_new_amount   NUMERIC(15,2);
BEGIN
  -- 1. Lock the payment row and assert it's a draft. If not, we refuse
  --    immediately — confirmed/void payments already have GL postings
  --    that were computed from the existing row, so a silent update would
  --    desync the ledger.
  SELECT * INTO v_pmt
  FROM public.payments
  WHERE id = p_payment_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'update_payment_draft: payment % not found', p_payment_id
      USING ERRCODE = 'P0002';
  END IF;

  IF v_pmt.status <> 'draft' THEN
    RAISE EXCEPTION
      'update_payment_draft: cannot edit payment %; status is % (only draft is editable)',
      v_pmt.payment_number, v_pmt.status
      USING ERRCODE = 'P0001';
  END IF;

  v_company_id := v_pmt.company_id;
  v_type       := v_pmt.type;

  -- 2. Resolve the (possibly new) contact_id from the JSONB. Default to
  --    the existing one if not provided so partial updates work.
  v_new_contact := COALESCE(
    (p_row->>'contact_id')::UUID,
    v_pmt.contact_id
  );

  v_new_amount := COALESCE(
    (p_row->>'amount')::NUMERIC(15,2),
    v_pmt.amount
  );

  IF v_new_amount <= 0 THEN
    RAISE EXCEPTION 'update_payment_draft: amount must be > 0 (got %)', v_new_amount
      USING ERRCODE = 'P0001';
  END IF;

  -- 3. Period lock — same rule as confirm. A draft dated on/before the
  --    lock date cannot be edited (would let users back-date around the
  --    close).
  IF v_pmt.date IS NOT NULL THEN
    DECLARE v_lock_date DATE;
    BEGIN
      SELECT period_lock_date INTO v_lock_date
      FROM public.companies WHERE id = v_company_id;
      IF v_lock_date IS NOT NULL
         AND COALESCE((p_row->>'date')::DATE, v_pmt.date) <= v_lock_date THEN
        RAISE EXCEPTION
          'update_payment_draft: date % is on/before period lock %',
          COALESCE((p_row->>'date')::DATE, v_pmt.date), v_lock_date
          USING ERRCODE = 'P0001';
      END IF;
    END;
  END IF;

  -- 4. Apply whitelisted updates. NEVER touch id, company_id, type,
  --    payment_number, status, void_*, created_at.
  UPDATE public.payments SET
    contact_id        = v_new_contact,
    date              = COALESCE((p_row->>'date')::DATE,              date),
    amount            = v_new_amount,
    currency          = COALESCE( p_row->>'currency',                 currency),
    exchange_rate     = COALESCE((p_row->>'exchange_rate')::NUMERIC,  exchange_rate),
    payment_method_id = CASE WHEN p_row ? 'payment_method_id'
                             THEN NULLIF(p_row->>'payment_method_id','')::UUID
                             ELSE payment_method_id END,
    bank_account_id   = CASE WHEN p_row ? 'bank_account_id'
                             THEN NULLIF(p_row->>'bank_account_id','')::UUID
                             ELSE bank_account_id END,
    reference         = CASE WHEN p_row ? 'reference'
                             THEN NULLIF(p_row->>'reference','')
                             ELSE reference END,
    classification    = COALESCE( p_row->>'classification',           classification),
    notes             = CASE WHEN p_row ? 'notes'
                             THEN NULLIF(p_row->>'notes','')
                             ELSE notes END,
    updated_at        = NOW()
  WHERE id = p_payment_id
  RETURNING * INTO v_pmt;

  -- 5. Replace allocations atomically (only if caller provided them).
  --    NULL = don't touch existing allocations.
  --    [] / [...] = replace whole set.
  --    Drafts have no GL yet, so this is safe to do without reversal.
  IF p_allocations IS NULL THEN
    -- Caller chose to leave allocations untouched. Still need to validate
    -- that existing total <= new amount (the amount may have shrunk).
    SELECT COALESCE(SUM(amount_applied), 0) INTO v_total_alloc
    FROM public.payment_allocations
    WHERE payment_id = p_payment_id;

    IF v_total_alloc > v_new_amount + 0.005 THEN
      RAISE EXCEPTION
        'update_payment_draft: existing allocations total % exceed new payment amount % — clear allocations first',
        v_total_alloc, v_new_amount
        USING ERRCODE = 'P0001';
    END IF;
    RETURN v_pmt;
  END IF;

  DELETE FROM public.payment_allocations
   WHERE payment_id = p_payment_id;

  IF jsonb_typeof(p_allocations) = 'array' THEN
    FOR v_alloc IN SELECT * FROM jsonb_array_elements(p_allocations)
    LOOP
      v_doc_type := v_alloc->>'doc_type';
      v_doc_id   := (v_alloc->>'doc_id')::UUID;
      v_amount   := (v_alloc->>'amount_applied')::NUMERIC(15,2);

      IF v_amount IS NULL OR v_amount <= 0 THEN
        RAISE EXCEPTION
          'update_payment_draft: allocation amount must be > 0 (got %)', v_amount
          USING ERRCODE = 'P0001';
      END IF;

      -- doc_type must match payment direction
      IF v_type = 'inbound'  AND v_doc_type NOT IN ('invoice','credit_note') THEN
        RAISE EXCEPTION
          'update_payment_draft: inbound payment cannot allocate to %', v_doc_type
          USING ERRCODE = 'P0001';
      END IF;
      IF v_type = 'outbound' AND v_doc_type NOT IN ('vendor_bill','debit_note') THEN
        RAISE EXCEPTION
          'update_payment_draft: outbound payment cannot allocate to %', v_doc_type
          USING ERRCODE = 'P0001';
      END IF;

      -- doc must exist in this company, and belong to the same contact
      v_doc_contact := NULL;
      IF v_doc_type = 'invoice' THEN
        SELECT contact_id INTO v_doc_contact
        FROM public.invoices
        WHERE id = v_doc_id AND company_id = v_company_id;
      ELSIF v_doc_type = 'vendor_bill' THEN
        SELECT supplier_id INTO v_doc_contact
        FROM public.vendor_bills
        WHERE id = v_doc_id AND company_id = v_company_id;
      ELSIF v_doc_type = 'credit_note' THEN
        SELECT contact_id INTO v_doc_contact
        FROM public.credit_notes
        WHERE id = v_doc_id AND company_id = v_company_id;
      ELSIF v_doc_type = 'debit_note' THEN
        SELECT supplier_id INTO v_doc_contact
        FROM public.debit_notes
        WHERE id = v_doc_id AND company_id = v_company_id;
      END IF;

      IF v_doc_contact IS NULL THEN
        RAISE EXCEPTION
          'update_payment_draft: allocation doc % (%) not found in this company',
          v_doc_id, v_doc_type
          USING ERRCODE = 'P0001';
      END IF;

      IF v_doc_contact <> v_new_contact THEN
        RAISE EXCEPTION
          'update_payment_draft: allocation doc % belongs to a different contact than the payment',
          v_doc_id
          USING ERRCODE = 'P0001';
      END IF;

      INSERT INTO public.payment_allocations
        (company_id, payment_id, doc_type, doc_id, amount_applied)
      VALUES
        (v_company_id, p_payment_id, v_doc_type, v_doc_id, v_amount);

      v_total_alloc := v_total_alloc + v_amount;
    END LOOP;
  END IF;

  -- 6. Total allocations cannot exceed payment amount (would create
  --    over-applied state on confirm).
  IF v_total_alloc > v_new_amount + 0.005 THEN
    RAISE EXCEPTION
      'update_payment_draft: allocations total % exceeds payment amount %',
      v_total_alloc, v_new_amount
      USING ERRCODE = 'P0001';
  END IF;

  RETURN v_pmt;
END;
$$;

REVOKE ALL ON FUNCTION public.update_payment_draft(UUID, JSONB, JSONB) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.update_payment_draft(UUID, JSONB, JSONB) TO authenticated;

COMMENT ON FUNCTION public.update_payment_draft(UUID, JSONB, JSONB) IS
  'Atomically updates a draft payment row and replaces its payment_allocations. '
  'Refuses to touch confirmed or void payments. Used by PaymentsAPI.update and '
  'VendorPaymentsAPI.update (single RPC, both directions share the payments table).';
