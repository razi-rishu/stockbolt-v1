-- ═══════════════════════════════════════════════════════════════════════════
-- phase91 — link refunds raised BEFORE phase90 to the document they settled,
-- but only where the match is determined rather than guessed
--
-- phase90 made a refund record its source document, written at the moment the
-- refund is raised. Refunds raised before it have no link, so the credit note
-- they settled still shows nothing: CN-1004 was refunded by CCR-1002 on
-- 2026-09-07 and says so nowhere.
--
-- I argued against guessing, and this is not that. A refund is linked here
-- ONLY when exactly ONE confirmed document of the right kind matches on all
-- of company, contact and amount. One candidate means the answer is
-- determined by the data. Two candidates means it is a coin toss, and those
-- are left null — a blank is honest, a wrong link is not.
--
-- WHY AMOUNT AND NOT DATE
-- A refund is often paid days after the note is raised, so date proximity
-- would be a heuristic. Amount is not: a refund of the credit balance is for
-- the amount of the credit. Matching on amount alone, within one contact,
-- either resolves uniquely or does not resolve at all.
--
-- ONLY CONFIRMED documents are candidates. A void note settled nothing.
--
-- RE-RUNNABLE: the UPDATE skips rows that already carry a link, so applying
-- this twice changes nothing the second time.
--
-- SAFE TO APPLY: touches two display-only columns on `payments`. No ledger
-- row, no balance, no posting function. The worst case of a bad link is a
-- wrong label, and the uniqueness guard is what prevents even that.
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

-- ── Customer credit refunds → credit notes ─────────────────────────────────
WITH candidate AS (
  SELECT p.id AS payment_id,
         (SELECT cn.id FROM public.credit_notes cn
           WHERE cn.company_id = p.company_id
             AND cn.contact_id = p.contact_id
             AND cn.status     = 'confirmed'
             AND ROUND(cn.total_amount, 2) = ROUND(p.amount, 2)
           LIMIT 1) AS doc_id,
         (SELECT count(*) FROM public.credit_notes cn
           WHERE cn.company_id = p.company_id
             AND cn.contact_id = p.contact_id
             AND cn.status     = 'confirmed'
             AND ROUND(cn.total_amount, 2) = ROUND(p.amount, 2)) AS n
  FROM public.payments p
  WHERE p.source_doc_id IS NULL
    AND p.type           = 'outbound'
    AND p.classification = 'on_account'
)
UPDATE public.payments p
   SET source_doc_type = 'credit_note',
       source_doc_id   = c.doc_id
  FROM candidate c
 WHERE p.id = c.payment_id
   AND c.n  = 1                 -- determined, not guessed
   AND c.doc_id IS NOT NULL;

-- ── Vendor credit refunds → debit notes (same rule, mirrored) ──────────────
WITH candidate AS (
  SELECT p.id AS payment_id,
         (SELECT dn.id FROM public.debit_notes dn
           WHERE dn.company_id  = p.company_id
             AND dn.supplier_id = p.contact_id
             AND dn.status      = 'confirmed'
             AND ROUND(dn.total_amount, 2) = ROUND(p.amount, 2)
           LIMIT 1) AS doc_id,
         (SELECT count(*) FROM public.debit_notes dn
           WHERE dn.company_id  = p.company_id
             AND dn.supplier_id = p.contact_id
             AND dn.status      = 'confirmed'
             AND ROUND(dn.total_amount, 2) = ROUND(p.amount, 2)) AS n
  FROM public.payments p
  WHERE p.source_doc_id IS NULL
    AND p.type           = 'inbound'
    AND p.classification = 'on_account'
)
UPDATE public.payments p
   SET source_doc_type = 'debit_note',
       source_doc_id   = c.doc_id
  FROM candidate c
 WHERE p.id = c.payment_id
   AND c.n  = 1
   AND c.doc_id IS NOT NULL;

COMMIT;

-- ── VERIFY (expect CCR-1002 → CN-1004, and nothing ambiguous linked) ───────
-- SELECT p.payment_number, p.source_doc_type, cn.credit_note_number
--   FROM public.payments p
--   LEFT JOIN public.credit_notes cn ON cn.id = p.source_doc_id
--  WHERE p.classification = 'on_account'
--  ORDER BY p.date;

-- ── ROLLBACK ───────────────────────────────────────────────────────────────
-- Clears ONLY what this backfill set. A refund raised after phase90 carries
-- its link from the moment it was created and must not be cleared here, so
-- the predicate cannot simply be "source_doc_id IS NOT NULL". There is no
-- marker distinguishing the two, which is the honest limitation of a
-- backfill: if you need to undo it, re-check the list from the VERIFY query
-- above first and clear by payment_number.
--
-- BEGIN;
-- UPDATE public.payments
--    SET source_doc_type = NULL, source_doc_id = NULL
--  WHERE payment_number IN ( /* the ones this migration linked */ );
-- COMMIT;
