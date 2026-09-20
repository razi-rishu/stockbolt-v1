-- ============================================================================
-- Phase 82 — Lock anon out of the customer credit-refund RPCs
--
-- MY MISTAKE, CAUGHT BY MY OWN TRIPWIRE
-- Phase 78 revoked the credit-refund functions FROM PUBLIC:
--
--     REVOKE ALL ON FUNCTION public.confirm_customer_credit_refund(uuid) FROM PUBLIC;
--
-- Every other refund RPC in this codebase names anon explicitly. Phase 69:
--
--     REVOKE ALL ON FUNCTION public.confirm_vendor_refund(uuid) FROM PUBLIC, anon;
--
-- That difference matters, because Supabase grants EXECUTE to anon DIRECTLY on
-- functions in the public schema rather than through PUBLIC. Revoking from
-- PUBLIC leaves anon's own grant sitting there untouched.
--
-- WHAT IT ACTUALLY MEANT
-- Confirmed with the public anon key and no session:
--
--   confirm_customer_credit_refund  -> 42501 forbidden: requires accounting.write
--   void_customer_credit_refund     -> 42501 forbidden: requires accounting.write
--   confirm_vendor_refund           -> 42501 permission denied for function
--
-- So this was NOT a breach. anon could reach the two phase 78 functions and was
-- stopped inside them by auth_require('accounting.write'), which sees a NULL
-- auth.uid() and raises. The phase 69 function could not be reached at all.
--
-- The difference is one lock versus two. A SECURITY DEFINER function that moves
-- money should not be relying on its own first line for the whole of its access
-- control -- that is a single point of failure, and the grant layer costs
-- nothing. Phase 71 was the same lesson about views: a guard that happens to
-- hold today is not the same as one that cannot be reached.
--
-- Grants only. No function body changes, no data touched.
-- Idempotent: REVOKE of a privilege that is already gone is a no-op.
-- ============================================================================

REVOKE ALL    ON FUNCTION public.confirm_customer_credit_refund(uuid)      FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.confirm_customer_credit_refund(uuid)      TO authenticated;

REVOKE ALL    ON FUNCTION public.void_customer_credit_refund(uuid, text)   FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.void_customer_credit_refund(uuid, text)   TO authenticated;

NOTIFY pgrst, 'reload schema';
