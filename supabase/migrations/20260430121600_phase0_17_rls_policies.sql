-- ─────────────────────────────────────────────────────────────────────────
-- StockBolt v1 — Phase 0 — Migration 17: Row Level Security (THE GATE)
-- ─────────────────────────────────────────────────────────────────────────
-- Per AGENTS.md Rule 4 + §8.5: every tenant-scoped table gets RLS enabled
-- with a tenant_isolation policy keyed on company_id =
-- current_user_company_id().
--
-- Item tables (which don't carry their own company_id) inherit isolation
-- from their parent header via an EXISTS subquery against the parent.
--
-- vehicle_makes is special: NULL company_id = system-wide visible to all
-- tenants but writable only by the owning tenant. vehicle_models follow
-- their make.
--
-- Phase 0 verification: a user in Company A must NOT see any rows from
-- Company B in any of these tables. Tested in Stage 6.
-- ─────────────────────────────────────────────────────────────────────────

-- ─── Helper: tenant policy template applied to a long list of tables ─────

-- Section A — Core / Tenancy ----------------------------------------------

ALTER TABLE public.companies ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON public.companies
  FOR ALL
  USING (id = public.current_user_company_id())
  WITH CHECK (id = public.current_user_company_id());

ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
-- profiles is unique: a user must be able to read THEIR OWN profile to
-- bootstrap the tenant lookup. Anyone in the same company can see colleagues.
CREATE POLICY profiles_self_or_company ON public.profiles
  FOR SELECT
  USING (id = auth.uid() OR company_id = public.current_user_company_id());
CREATE POLICY profiles_company_write ON public.profiles
  FOR INSERT
  WITH CHECK (id = auth.uid() OR company_id = public.current_user_company_id());
CREATE POLICY profiles_company_update ON public.profiles
  FOR UPDATE
  USING (id = auth.uid() OR company_id = public.current_user_company_id())
  WITH CHECK (id = auth.uid() OR company_id = public.current_user_company_id());

ALTER TABLE public.audit_logs ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON public.audit_logs
  FOR ALL
  USING (company_id = public.current_user_company_id())
  WITH CHECK (company_id = public.current_user_company_id());

-- Section B — Master Data --------------------------------------------------

ALTER TABLE public.warehouses ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON public.warehouses
  FOR ALL USING (company_id = public.current_user_company_id())
  WITH CHECK (company_id = public.current_user_company_id());

ALTER TABLE public.categories ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON public.categories
  FOR ALL USING (company_id = public.current_user_company_id())
  WITH CHECK (company_id = public.current_user_company_id());

ALTER TABLE public.brands ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON public.brands
  FOR ALL USING (company_id = public.current_user_company_id())
  WITH CHECK (company_id = public.current_user_company_id());

ALTER TABLE public.units_of_measure ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON public.units_of_measure
  FOR ALL USING (company_id = public.current_user_company_id())
  WITH CHECK (company_id = public.current_user_company_id());

-- vehicle_makes: NULL company_id is system-wide visible. Writes restricted to owner.
ALTER TABLE public.vehicle_makes ENABLE ROW LEVEL SECURITY;
CREATE POLICY vehicle_makes_read ON public.vehicle_makes
  FOR SELECT
  USING (company_id IS NULL OR company_id = public.current_user_company_id());
CREATE POLICY vehicle_makes_insert ON public.vehicle_makes
  FOR INSERT
  WITH CHECK (company_id = public.current_user_company_id());
CREATE POLICY vehicle_makes_update ON public.vehicle_makes
  FOR UPDATE
  USING (company_id = public.current_user_company_id())
  WITH CHECK (company_id = public.current_user_company_id());
CREATE POLICY vehicle_makes_delete ON public.vehicle_makes
  FOR DELETE
  USING (company_id = public.current_user_company_id());

-- vehicle_models inherit make's visibility.
ALTER TABLE public.vehicle_models ENABLE ROW LEVEL SECURITY;
CREATE POLICY vehicle_models_read ON public.vehicle_models
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.vehicle_makes m
      WHERE m.id = vehicle_models.make_id
        AND (m.company_id IS NULL OR m.company_id = public.current_user_company_id())
    )
  );
CREATE POLICY vehicle_models_write ON public.vehicle_models
  FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM public.vehicle_makes m
      WHERE m.id = vehicle_models.make_id
        AND m.company_id = public.current_user_company_id()
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.vehicle_makes m
      WHERE m.id = vehicle_models.make_id
        AND m.company_id = public.current_user_company_id()
    )
  );

ALTER TABLE public.products ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON public.products
  FOR ALL USING (company_id = public.current_user_company_id())
  WITH CHECK (company_id = public.current_user_company_id());

-- product_compatibility — child of products
ALTER TABLE public.product_compatibility ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON public.product_compatibility
  FOR ALL
  USING (
    EXISTS (SELECT 1 FROM public.products p
            WHERE p.id = product_compatibility.product_id
              AND p.company_id = public.current_user_company_id())
  )
  WITH CHECK (
    EXISTS (SELECT 1 FROM public.products p
            WHERE p.id = product_compatibility.product_id
              AND p.company_id = public.current_user_company_id())
  );

ALTER TABLE public.price_levels ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON public.price_levels
  FOR ALL USING (company_id = public.current_user_company_id())
  WITH CHECK (company_id = public.current_user_company_id());

ALTER TABLE public.product_price_levels ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON public.product_price_levels
  FOR ALL
  USING (
    EXISTS (SELECT 1 FROM public.products p
            WHERE p.id = product_price_levels.product_id
              AND p.company_id = public.current_user_company_id())
  )
  WITH CHECK (
    EXISTS (SELECT 1 FROM public.products p
            WHERE p.id = product_price_levels.product_id
              AND p.company_id = public.current_user_company_id())
  );

-- Section C — Contacts -----------------------------------------------------

ALTER TABLE public.contacts ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON public.contacts
  FOR ALL USING (company_id = public.current_user_company_id())
  WITH CHECK (company_id = public.current_user_company_id());

ALTER TABLE public.product_supplier_codes ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON public.product_supplier_codes
  FOR ALL USING (company_id = public.current_user_company_id())
  WITH CHECK (company_id = public.current_user_company_id());

ALTER TABLE public.product_serials ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON public.product_serials
  FOR ALL USING (company_id = public.current_user_company_id())
  WITH CHECK (company_id = public.current_user_company_id());

-- Section D — Sales --------------------------------------------------------

ALTER TABLE public.sales_quotes ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON public.sales_quotes
  FOR ALL USING (company_id = public.current_user_company_id())
  WITH CHECK (company_id = public.current_user_company_id());

ALTER TABLE public.sales_quote_items ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON public.sales_quote_items
  FOR ALL
  USING (
    EXISTS (SELECT 1 FROM public.sales_quotes h
            WHERE h.id = sales_quote_items.quote_id
              AND h.company_id = public.current_user_company_id())
  )
  WITH CHECK (
    EXISTS (SELECT 1 FROM public.sales_quotes h
            WHERE h.id = sales_quote_items.quote_id
              AND h.company_id = public.current_user_company_id())
  );

ALTER TABLE public.sales_orders ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON public.sales_orders
  FOR ALL USING (company_id = public.current_user_company_id())
  WITH CHECK (company_id = public.current_user_company_id());

ALTER TABLE public.sales_order_items ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON public.sales_order_items
  FOR ALL
  USING (
    EXISTS (SELECT 1 FROM public.sales_orders h
            WHERE h.id = sales_order_items.order_id
              AND h.company_id = public.current_user_company_id())
  )
  WITH CHECK (
    EXISTS (SELECT 1 FROM public.sales_orders h
            WHERE h.id = sales_order_items.order_id
              AND h.company_id = public.current_user_company_id())
  );

ALTER TABLE public.invoices ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON public.invoices
  FOR ALL USING (company_id = public.current_user_company_id())
  WITH CHECK (company_id = public.current_user_company_id());

ALTER TABLE public.invoice_items ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON public.invoice_items
  FOR ALL
  USING (
    EXISTS (SELECT 1 FROM public.invoices h
            WHERE h.id = invoice_items.invoice_id
              AND h.company_id = public.current_user_company_id())
  )
  WITH CHECK (
    EXISTS (SELECT 1 FROM public.invoices h
            WHERE h.id = invoice_items.invoice_id
              AND h.company_id = public.current_user_company_id())
  );

ALTER TABLE public.credit_notes ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON public.credit_notes
  FOR ALL USING (company_id = public.current_user_company_id())
  WITH CHECK (company_id = public.current_user_company_id());

ALTER TABLE public.credit_note_items ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON public.credit_note_items
  FOR ALL
  USING (
    EXISTS (SELECT 1 FROM public.credit_notes h
            WHERE h.id = credit_note_items.credit_note_id
              AND h.company_id = public.current_user_company_id())
  )
  WITH CHECK (
    EXISTS (SELECT 1 FROM public.credit_notes h
            WHERE h.id = credit_note_items.credit_note_id
              AND h.company_id = public.current_user_company_id())
  );

ALTER TABLE public.sales_returns ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON public.sales_returns
  FOR ALL USING (company_id = public.current_user_company_id())
  WITH CHECK (company_id = public.current_user_company_id());

ALTER TABLE public.sales_return_items ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON public.sales_return_items
  FOR ALL
  USING (
    EXISTS (SELECT 1 FROM public.sales_returns h
            WHERE h.id = sales_return_items.sales_return_id
              AND h.company_id = public.current_user_company_id())
  )
  WITH CHECK (
    EXISTS (SELECT 1 FROM public.sales_returns h
            WHERE h.id = sales_return_items.sales_return_id
              AND h.company_id = public.current_user_company_id())
  );

-- Section E — Purchases ----------------------------------------------------

ALTER TABLE public.purchase_orders ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON public.purchase_orders
  FOR ALL USING (company_id = public.current_user_company_id())
  WITH CHECK (company_id = public.current_user_company_id());

ALTER TABLE public.purchase_order_items ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON public.purchase_order_items
  FOR ALL
  USING (
    EXISTS (SELECT 1 FROM public.purchase_orders h
            WHERE h.id = purchase_order_items.po_id
              AND h.company_id = public.current_user_company_id())
  )
  WITH CHECK (
    EXISTS (SELECT 1 FROM public.purchase_orders h
            WHERE h.id = purchase_order_items.po_id
              AND h.company_id = public.current_user_company_id())
  );

ALTER TABLE public.goods_receipts ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON public.goods_receipts
  FOR ALL USING (company_id = public.current_user_company_id())
  WITH CHECK (company_id = public.current_user_company_id());

ALTER TABLE public.goods_receipt_items ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON public.goods_receipt_items
  FOR ALL
  USING (
    EXISTS (SELECT 1 FROM public.goods_receipts h
            WHERE h.id = goods_receipt_items.grn_id
              AND h.company_id = public.current_user_company_id())
  )
  WITH CHECK (
    EXISTS (SELECT 1 FROM public.goods_receipts h
            WHERE h.id = goods_receipt_items.grn_id
              AND h.company_id = public.current_user_company_id())
  );

ALTER TABLE public.vendor_bills ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON public.vendor_bills
  FOR ALL USING (company_id = public.current_user_company_id())
  WITH CHECK (company_id = public.current_user_company_id());

ALTER TABLE public.vendor_bill_items ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON public.vendor_bill_items
  FOR ALL
  USING (
    EXISTS (SELECT 1 FROM public.vendor_bills h
            WHERE h.id = vendor_bill_items.bill_id
              AND h.company_id = public.current_user_company_id())
  )
  WITH CHECK (
    EXISTS (SELECT 1 FROM public.vendor_bills h
            WHERE h.id = vendor_bill_items.bill_id
              AND h.company_id = public.current_user_company_id())
  );

ALTER TABLE public.debit_notes ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON public.debit_notes
  FOR ALL USING (company_id = public.current_user_company_id())
  WITH CHECK (company_id = public.current_user_company_id());

ALTER TABLE public.debit_note_items ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON public.debit_note_items
  FOR ALL
  USING (
    EXISTS (SELECT 1 FROM public.debit_notes h
            WHERE h.id = debit_note_items.debit_note_id
              AND h.company_id = public.current_user_company_id())
  )
  WITH CHECK (
    EXISTS (SELECT 1 FROM public.debit_notes h
            WHERE h.id = debit_note_items.debit_note_id
              AND h.company_id = public.current_user_company_id())
  );

-- Section F — Payments -----------------------------------------------------

ALTER TABLE public.payments ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON public.payments
  FOR ALL USING (company_id = public.current_user_company_id())
  WITH CHECK (company_id = public.current_user_company_id());

ALTER TABLE public.payment_allocations ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON public.payment_allocations
  FOR ALL USING (company_id = public.current_user_company_id())
  WITH CHECK (company_id = public.current_user_company_id());

ALTER TABLE public.payment_methods ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON public.payment_methods
  FOR ALL USING (company_id = public.current_user_company_id())
  WITH CHECK (company_id = public.current_user_company_id());

-- Section G — Banking ------------------------------------------------------

ALTER TABLE public.bank_accounts ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON public.bank_accounts
  FOR ALL USING (company_id = public.current_user_company_id())
  WITH CHECK (company_id = public.current_user_company_id());

ALTER TABLE public.bank_transfers ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON public.bank_transfers
  FOR ALL USING (company_id = public.current_user_company_id())
  WITH CHECK (company_id = public.current_user_company_id());

ALTER TABLE public.pdc_cheques ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON public.pdc_cheques
  FOR ALL USING (company_id = public.current_user_company_id())
  WITH CHECK (company_id = public.current_user_company_id());

ALTER TABLE public.expenses ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON public.expenses
  FOR ALL USING (company_id = public.current_user_company_id())
  WITH CHECK (company_id = public.current_user_company_id());

-- Section H — Inventory Movement -------------------------------------------

ALTER TABLE public.stock_ledger ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON public.stock_ledger
  FOR ALL USING (company_id = public.current_user_company_id())
  WITH CHECK (company_id = public.current_user_company_id());

ALTER TABLE public.stock_transfers ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON public.stock_transfers
  FOR ALL USING (company_id = public.current_user_company_id())
  WITH CHECK (company_id = public.current_user_company_id());

ALTER TABLE public.stock_transfer_items ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON public.stock_transfer_items
  FOR ALL
  USING (
    EXISTS (SELECT 1 FROM public.stock_transfers h
            WHERE h.id = stock_transfer_items.transfer_id
              AND h.company_id = public.current_user_company_id())
  )
  WITH CHECK (
    EXISTS (SELECT 1 FROM public.stock_transfers h
            WHERE h.id = stock_transfer_items.transfer_id
              AND h.company_id = public.current_user_company_id())
  );

ALTER TABLE public.inventory_adjustments ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON public.inventory_adjustments
  FOR ALL USING (company_id = public.current_user_company_id())
  WITH CHECK (company_id = public.current_user_company_id());

ALTER TABLE public.inventory_adjustment_items ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON public.inventory_adjustment_items
  FOR ALL
  USING (
    EXISTS (SELECT 1 FROM public.inventory_adjustments h
            WHERE h.id = inventory_adjustment_items.adjustment_id
              AND h.company_id = public.current_user_company_id())
  )
  WITH CHECK (
    EXISTS (SELECT 1 FROM public.inventory_adjustments h
            WHERE h.id = inventory_adjustment_items.adjustment_id
              AND h.company_id = public.current_user_company_id())
  );

-- Section I — Accounting ---------------------------------------------------

ALTER TABLE public.chart_of_accounts ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON public.chart_of_accounts
  FOR ALL USING (company_id = public.current_user_company_id())
  WITH CHECK (company_id = public.current_user_company_id());

ALTER TABLE public.journal_entries ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON public.journal_entries
  FOR ALL USING (company_id = public.current_user_company_id())
  WITH CHECK (company_id = public.current_user_company_id());

ALTER TABLE public.general_ledger ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON public.general_ledger
  FOR ALL USING (company_id = public.current_user_company_id())
  WITH CHECK (company_id = public.current_user_company_id());

ALTER TABLE public.deferred_cogs_queue ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON public.deferred_cogs_queue
  FOR ALL USING (company_id = public.current_user_company_id())
  WITH CHECK (company_id = public.current_user_company_id());

-- Section J — POS ---------------------------------------------------------

ALTER TABLE public.pos_sessions ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON public.pos_sessions
  FOR ALL USING (company_id = public.current_user_company_id())
  WITH CHECK (company_id = public.current_user_company_id());

-- Section K — Templates & Settings ----------------------------------------

ALTER TABLE public.print_templates ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON public.print_templates
  FOR ALL USING (company_id = public.current_user_company_id())
  WITH CHECK (company_id = public.current_user_company_id());

ALTER TABLE public.document_sequences ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON public.document_sequences
  FOR ALL USING (company_id = public.current_user_company_id())
  WITH CHECK (company_id = public.current_user_company_id());

ALTER TABLE public.tax_rates ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON public.tax_rates
  FOR ALL USING (company_id = public.current_user_company_id())
  WITH CHECK (company_id = public.current_user_company_id());

-- Section L — System ------------------------------------------------------

ALTER TABLE public.attachments ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON public.attachments
  FOR ALL USING (company_id = public.current_user_company_id())
  WITH CHECK (company_id = public.current_user_company_id());

ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON public.notifications
  FOR ALL USING (company_id = public.current_user_company_id())
  WITH CHECK (company_id = public.current_user_company_id());
