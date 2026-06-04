-- ═══════════════════════════════════════════════════════════════════════════
-- StockBolt — Phase 14.14o hotfix
-- Fix: _guard_no_double_post — extend whitelist beyond the original 4 types.
--
-- Why: the existing guard only blocked double-confirm on sales_invoice,
-- vendor_bill, sales_credit_note, vendor_debit_note. Everything else
-- (expenses, transfers, POS sales, vendor / customer payments, PDCs, GRNs,
-- inventory adjustments, sales returns) had no protection. A retry after a
-- transient network blip silently posted a duplicate JE, overstating books.
--
-- This hotfix replaces the function body with the expanded whitelist. The
-- trigger definition is unchanged.
--
-- Deliberately EXCLUDED from the guard (multi-JE-per-source or no source):
--   inventory_cogs, opening_balance, opening_gl, opening_bank,
--   advance_application, advance_refund, manual, year_end_close.
--
-- HOW TO RUN
-- ──────────
-- Supabase Dashboard → SQL Editor → New query → paste this → Run.
-- "Success. No rows returned." → done.
-- Idempotent (CREATE OR REPLACE FUNCTION + DROP TRIGGER IF EXISTS).
-- ═══════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public._guard_no_double_post()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_existing TEXT;
BEGIN
  IF NEW.source_type NOT IN (
    'sales_invoice',
    'sales_credit_note',
    'sales_return',
    'customer_receipt',
    'customer_advance',
    'pos_cash_sale',
    'pos_card_sale',
    'vendor_bill',
    'vendor_debit_note',
    'goods_receipt',
    'vendor_payment',
    'vendor_advance',
    'stock_transfer',
    'inventory_adjustment',
    'bank_transfer',
    'direct_receipt',
    'expense',
    'pdc_creation',
    'pdc_bank_post',
    'pdc_clear',
    'pdc_bounce'
  ) THEN
    RETURN NEW;
  END IF;

  IF NEW.reversal_of_id IS NOT NULL THEN
    RETURN NEW;
  END IF;

  SELECT entry_number INTO v_existing
  FROM public.journal_entries
  WHERE company_id      = NEW.company_id
    AND source_type     = NEW.source_type
    AND source_id       = NEW.source_id
    AND reversed_by_id IS NULL
    AND reversal_of_id IS NULL
    AND id              <> NEW.id
  LIMIT 1;

  IF v_existing IS NOT NULL THEN
    RAISE EXCEPTION
      'Double-post blocked: an unreversed % entry (%) already exists for this document (source_id=%). Void it or use Save & Repost to revise.',
      NEW.source_type, v_existing, NEW.source_id
      USING ERRCODE = 'P0001';
  END IF;

  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public._guard_no_double_post() IS
  'BEFORE INSERT trigger on journal_entries. Phase 14.14o extended whitelist '
  'to cover expenses, transfers, GRNs, POS, payments, PDC events. Reversal '
  'and edit-and-repost flows still work.';

DROP TRIGGER IF EXISTS journal_entries_guard_no_double_post ON public.journal_entries;
CREATE TRIGGER journal_entries_guard_no_double_post
BEFORE INSERT ON public.journal_entries
FOR EACH ROW EXECUTE FUNCTION public._guard_no_double_post();

NOTIFY pgrst, 'reload schema';
