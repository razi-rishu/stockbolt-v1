-- ============================================================================
-- Phase 59 — AC-4C: e-invoice document register (e_invoice_documents)
--   + record_einvoice_document() / mark_einvoice_submitted()
--   + cancel_einvoice_document()
-- ============================================================================
-- Approved design (AC-4C spec, 2026-07-27):
--   • Persists the e-invoice PAYLOAD produced client-side by the AC-4B
--     formatters (India GST JSON / UAE PINT-AE UBL) as an immutable, per-invoice
--     legal record with a lifecycle (generated → submitted → cancelled;
--     regenerating supersedes the prior 'generated' snapshot).
--   • METADATA ONLY — posts NO journal entry, reads/writes NO general_ledger,
--     changes NO posting RPC and NO existing table. There is NO period-lock gate
--     (an e-invoice is produced after the invoice is confirmed, often after the
--     period is locked).
--   • RLS: tenant READ ONLY; every write goes through a SECURITY DEFINER RPC
--     gated by sales.write (the sales desk that raises the invoice also files
--     its e-invoice). The DB never runs the formatter — the client passes the
--     payload in and the RPC snapshots it.
--
-- Relies on (VERIFIED live): current_user_company_id(); auth_require(text) ->
-- has_perm; public.invoices(id, company_id, status); audit_logs(company_id,
-- user_id, action, entity_type, entity_id, new_data). Permission sales.write is
-- seeded in role_permissions (admin/sales/counter).
--
-- Additive + idempotent. Apply BY HAND in the Supabase SQL editor.
-- ROLLBACK:
--   DROP FUNCTION IF EXISTS public.cancel_einvoice_document(uuid,text);
--   DROP FUNCTION IF EXISTS public.mark_einvoice_submitted(uuid,text,text,date,text,text);
--   DROP FUNCTION IF EXISTS public.record_einvoice_document(uuid,text,text,text,text);
--   DROP TABLE    IF EXISTS public.e_invoice_documents;
-- ============================================================================

-- 1. Document register -------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.e_invoice_documents (
  id               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id       uuid        NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  invoice_id       uuid        NOT NULL REFERENCES public.invoices(id)  ON DELETE CASCADE,
  jurisdiction     text        NOT NULL CHECK (jurisdiction IN ('AE_VAT','IN_GST')),
  format           text        NOT NULL CHECK (format IN ('india_gst_json','pint_ae_ubl')),
  status           text        NOT NULL DEFAULT 'generated'
                     CHECK (status IN ('generated','submitted','cancelled','superseded')),
  payload          text        NOT NULL,                    -- serialized JSON/XML snapshot (immutable record)
  content_hash     text        NOT NULL,                    -- sha-256 of payload (integrity + dedupe)
  irn              text,                                     -- India IRN (manual, post portal-filing)
  ack_no           text,                                     -- acknowledgement / clearance reference
  ack_date         date,
  qr_data          text,                                     -- signed QR payload (manual)
  reference_number text,
  error_message    text,
  generated_at     timestamptz NOT NULL DEFAULT now(),  generated_by uuid,
  submitted_at     timestamptz,                         submitted_by uuid,
  cancelled_at     timestamptz,                         cancelled_by uuid,  cancel_reason text,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);

-- 2. Constraints & indexes ---------------------------------------------------
-- At most ONE active (non-superseded, non-cancelled) document per invoice.
CREATE UNIQUE INDEX IF NOT EXISTS e_invoice_documents_active_per_invoice
  ON public.e_invoice_documents (invoice_id)
  WHERE status NOT IN ('superseded','cancelled');
CREATE INDEX IF NOT EXISTS e_invoice_documents_company_status_idx
  ON public.e_invoice_documents (company_id, status);
CREATE INDEX IF NOT EXISTS e_invoice_documents_invoice_idx
  ON public.e_invoice_documents (invoice_id);

-- 3. RLS: tenant read only; all writes via the SECURITY DEFINER RPCs ----------
ALTER TABLE public.e_invoice_documents ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS e_invoice_documents_read ON public.e_invoice_documents;
CREATE POLICY e_invoice_documents_read ON public.e_invoice_documents
  FOR SELECT USING (company_id = public.current_user_company_id());
REVOKE ALL ON public.e_invoice_documents FROM anon, authenticated;
GRANT  SELECT ON public.e_invoice_documents TO authenticated;

-- 4. record_einvoice_document(...) -------------------------------------------
--    Snapshots a client-generated payload for a CONFIRMED invoice. Supersedes
--    any prior 'generated' snapshot; blocks if a 'submitted' one exists. No JE.
CREATE OR REPLACE FUNCTION public.record_einvoice_document(
  p_invoice_id   uuid,
  p_format       text,
  p_jurisdiction text,
  p_payload      text,
  p_content_hash text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user    uuid := auth.uid();
  v_company uuid := public.current_user_company_id();
  v_status  text;
  v_existing public.e_invoice_documents%ROWTYPE;
  v_id      uuid;
BEGIN
  IF v_user IS NULL OR v_company IS NULL THEN
    RAISE EXCEPTION 'Not signed in to a company.' USING ERRCODE = '42501';
  END IF;
  PERFORM public.auth_require('sales.write');

  IF p_format NOT IN ('india_gst_json','pint_ae_ubl') THEN
    RAISE EXCEPTION 'Unknown e-invoice format %.', p_format USING ERRCODE = 'P0001';
  END IF;
  IF p_jurisdiction NOT IN ('AE_VAT','IN_GST') THEN
    RAISE EXCEPTION 'Unknown e-invoice jurisdiction %.', p_jurisdiction USING ERRCODE = 'P0001';
  END IF;
  IF p_payload IS NULL OR length(p_payload) = 0 THEN
    RAISE EXCEPTION 'E-invoice payload is empty.' USING ERRCODE = 'P0001';
  END IF;

  -- The invoice must belong to this company and be confirmed. Lock it so a
  -- concurrent void/edit cannot race the snapshot.
  SELECT status INTO v_status FROM public.invoices
    WHERE id = p_invoice_id AND company_id = v_company
    FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Invoice not found.' USING ERRCODE = 'P0001';
  END IF;
  IF v_status <> 'confirmed' THEN
    RAISE EXCEPTION 'E-invoice requires a confirmed invoice (status is %).', v_status USING ERRCODE = 'P0001';
  END IF;

  -- A filed (submitted) e-invoice must be cancelled before regenerating.
  SELECT * INTO v_existing FROM public.e_invoice_documents
    WHERE invoice_id = p_invoice_id AND status = 'submitted'
    FOR UPDATE;
  IF FOUND THEN
    RAISE EXCEPTION 'Cancel the filed e-invoice before generating a new one.' USING ERRCODE = 'P0001';
  END IF;

  -- Idempotent re-generate: if an active 'generated' snapshot with the same
  -- content already exists, return it unchanged.
  SELECT * INTO v_existing FROM public.e_invoice_documents
    WHERE invoice_id = p_invoice_id AND status = 'generated' AND content_hash = p_content_hash
    FOR UPDATE;
  IF FOUND THEN
    RETURN jsonb_build_object('document_id', v_existing.id, 'status', 'generated', 'unchanged', true);
  END IF;

  -- Supersede any prior active 'generated' snapshot, then insert the new one.
  UPDATE public.e_invoice_documents
    SET status = 'superseded', updated_at = now()
    WHERE invoice_id = p_invoice_id AND status = 'generated';

  INSERT INTO public.e_invoice_documents (
    company_id, invoice_id, jurisdiction, format, status,
    payload, content_hash, generated_at, generated_by
  ) VALUES (
    v_company, p_invoice_id, p_jurisdiction, p_format, 'generated',
    p_payload, p_content_hash, now(), v_user
  )
  RETURNING id INTO v_id;

  BEGIN
    INSERT INTO public.audit_logs (company_id, user_id, action, entity_type, entity_id, new_data)
    VALUES (v_company, v_user, 'record_einvoice_document', 'e_invoice_document', v_id,
      jsonb_build_object('invoice_id', p_invoice_id, 'format', p_format, 'jurisdiction', p_jurisdiction));
  EXCEPTION WHEN OTHERS THEN NULL;
  END;

  RETURN jsonb_build_object('document_id', v_id, 'status', 'generated', 'unchanged', false);
END;
$$;

-- 5. mark_einvoice_submitted(...) --------------------------------------------
--    Records the manual government reference (IRN / ack / QR) after the user
--    files on the portal, moving 'generated' → 'submitted'. No JE.
CREATE OR REPLACE FUNCTION public.mark_einvoice_submitted(
  p_document_id uuid,
  p_irn         text DEFAULT NULL,
  p_ack_no      text DEFAULT NULL,
  p_ack_date    date DEFAULT NULL,
  p_qr_data     text DEFAULT NULL,
  p_reference   text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user    uuid := auth.uid();
  v_company uuid := public.current_user_company_id();
  v_row     public.e_invoice_documents%ROWTYPE;
BEGIN
  IF v_user IS NULL OR v_company IS NULL THEN
    RAISE EXCEPTION 'Not signed in to a company.' USING ERRCODE = '42501';
  END IF;
  PERFORM public.auth_require('sales.write');

  SELECT * INTO v_row FROM public.e_invoice_documents
    WHERE id = p_document_id AND company_id = v_company
    FOR UPDATE;
  IF NOT FOUND OR v_row.status <> 'generated' THEN
    RAISE EXCEPTION 'E-invoice is not in a submittable state.' USING ERRCODE = 'P0001';
  END IF;

  UPDATE public.e_invoice_documents SET
    status = 'submitted',
    irn = p_irn, ack_no = p_ack_no, ack_date = p_ack_date, qr_data = p_qr_data,
    reference_number = p_reference,
    submitted_at = now(), submitted_by = v_user, updated_at = now()
    WHERE id = v_row.id;

  BEGIN
    INSERT INTO public.audit_logs (company_id, user_id, action, entity_type, entity_id, new_data)
    VALUES (v_company, v_user, 'mark_einvoice_submitted', 'e_invoice_document', v_row.id,
      jsonb_build_object('invoice_id', v_row.invoice_id, 'irn', p_irn, 'ack_no', p_ack_no));
  EXCEPTION WHEN OTHERS THEN NULL;
  END;

  RETURN jsonb_build_object('document_id', v_row.id, 'status', 'submitted');
END;
$$;

-- 6. cancel_einvoice_document(...) -------------------------------------------
--    Cancels an active document (generated or submitted). No JE.
CREATE OR REPLACE FUNCTION public.cancel_einvoice_document(
  p_document_id uuid,
  p_reason      text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user    uuid := auth.uid();
  v_company uuid := public.current_user_company_id();
  v_row     public.e_invoice_documents%ROWTYPE;
BEGIN
  IF v_user IS NULL OR v_company IS NULL THEN
    RAISE EXCEPTION 'Not signed in to a company.' USING ERRCODE = '42501';
  END IF;
  PERFORM public.auth_require('sales.write');

  SELECT * INTO v_row FROM public.e_invoice_documents
    WHERE id = p_document_id AND company_id = v_company
    FOR UPDATE;
  IF NOT FOUND OR v_row.status NOT IN ('generated','submitted') THEN
    RAISE EXCEPTION 'E-invoice cannot be cancelled from its current state.' USING ERRCODE = 'P0001';
  END IF;

  UPDATE public.e_invoice_documents SET
    status = 'cancelled', cancel_reason = p_reason,
    cancelled_at = now(), cancelled_by = v_user, updated_at = now()
    WHERE id = v_row.id;

  BEGIN
    INSERT INTO public.audit_logs (company_id, user_id, action, entity_type, entity_id, new_data)
    VALUES (v_company, v_user, 'cancel_einvoice_document', 'e_invoice_document', v_row.id,
      jsonb_build_object('invoice_id', v_row.invoice_id, 'reason', p_reason));
  EXCEPTION WHEN OTHERS THEN NULL;
  END;

  RETURN jsonb_build_object('document_id', v_row.id, 'status', 'cancelled');
END;
$$;

-- 7. Grants: user-facing, permission-gated inside; never PUBLIC/anon ---------
REVOKE ALL     ON FUNCTION public.record_einvoice_document(uuid,text,text,text,text) FROM PUBLIC, anon;
REVOKE ALL     ON FUNCTION public.mark_einvoice_submitted(uuid,text,text,date,text,text) FROM PUBLIC, anon;
REVOKE ALL     ON FUNCTION public.cancel_einvoice_document(uuid,text) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.record_einvoice_document(uuid,text,text,text,text) TO authenticated;
GRANT  EXECUTE ON FUNCTION public.mark_einvoice_submitted(uuid,text,text,date,text,text) TO authenticated;
GRANT  EXECUTE ON FUNCTION public.cancel_einvoice_document(uuid,text) TO authenticated;
