-- ═══════════════════════════════════════════════════════════════════════════
-- phase90 (Z5) — a refund records which document it settled
--
-- "Here the return and refund is confirmed, but where is the sign if users
--  check later how they know is it refund or not."
--
-- There was no way to answer that, because the data could not. A refund
-- payment carries contact_id and nothing else: it knows WHO was paid, never
-- WHAT it settled. So a credit note could not say it had been refunded, and
-- a second refund against the same note looked exactly like the first.
--
-- WHY NOT payment_allocations
-- That table already links a payment to a document, and reaching for it would
-- be the obvious move. It is also the wrong one: allocations are how the app
-- DERIVES what an invoice has been paid (Rule 1 — no cached aggregates, the
-- ledger and the allocations are the truth). Writing a row there for a refund
-- would make a credit note look settled to every query that reads them, and
-- would corrupt AR balances that are computed from exactly those rows.
--
-- This is a provenance link, not a settlement, so it gets its own columns and
-- touches nothing that computes money.
--
--   payments.source_doc_type   'credit_note' | 'sales_return' | 'debit_note'
--                              | 'purchase_return'
--   payments.source_doc_id     the document the refund was raised from
--
-- Both nullable: every refund posted before this has no answer, and inventing
-- one by guessing from the contact and the date would be worse than an honest
-- blank. The UI shows nothing rather than something it cannot stand behind.
--
-- NOT A FOREIGN KEY, deliberately: the id points at one of four tables
-- depending on the type, which no single FK can express. The CHECK below
-- constrains the type, and the pair is written only by the adapter at the
-- moment the refund is raised from that document.
--
-- SAFE TO APPLY: two additive nullable columns and one index. No existing row
-- changes, no function is reopened, and nothing reads the columns until the
-- UI that writes them ships.
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

ALTER TABLE public.payments
  ADD COLUMN IF NOT EXISTS source_doc_type text,
  ADD COLUMN IF NOT EXISTS source_doc_id   uuid;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'payments_source_doc_type_check'
       AND conrelid = 'public.payments'::regclass
  ) THEN
    ALTER TABLE public.payments
      ADD CONSTRAINT payments_source_doc_type_check
      CHECK (source_doc_type IS NULL OR source_doc_type IN
             ('credit_note', 'sales_return', 'debit_note', 'purchase_return'));
  END IF;
END $$;

-- Both halves or neither. A type with no id, or an id with no type, is a row
-- nothing can resolve.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'payments_source_doc_pair_check'
       AND conrelid = 'public.payments'::regclass
  ) THEN
    ALTER TABLE public.payments
      ADD CONSTRAINT payments_source_doc_pair_check
      CHECK ((source_doc_type IS NULL) = (source_doc_id IS NULL));
  END IF;
END $$;

-- The lookup the document pages make: "has anything been refunded against
-- me?" Partial, because only refunds carry the pair.
CREATE INDEX IF NOT EXISTS payments_source_doc_idx
  ON public.payments (source_doc_type, source_doc_id)
  WHERE source_doc_id IS NOT NULL;

COMMENT ON COLUMN public.payments.source_doc_type IS
  'Z5 - provenance, NOT settlement. Which kind of document this refund was raised from. Deliberately not a payment_allocations row: those are how AR settlement is derived, and a synthetic one would corrupt balances.';

COMMIT;

-- ── ROLLBACK ───────────────────────────────────────────────────────────────
-- Unconditionally safe: the columns are read only for display, so dropping
-- them loses a label, never a balance.
--
-- BEGIN;
--
-- DROP INDEX IF EXISTS public.payments_source_doc_idx;
-- ALTER TABLE public.payments DROP CONSTRAINT IF EXISTS payments_source_doc_pair_check;
-- ALTER TABLE public.payments DROP CONSTRAINT IF EXISTS payments_source_doc_type_check;
-- ALTER TABLE public.payments DROP COLUMN IF EXISTS source_doc_id;
-- ALTER TABLE public.payments DROP COLUMN IF EXISTS source_doc_type;
--
-- COMMIT;
