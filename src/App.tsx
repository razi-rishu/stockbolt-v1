import { lazy, Suspense } from 'react';
import { BrowserRouter, Routes, Route, Navigate, Outlet } from 'react-router-dom';
import { useAuthInit } from '@/hooks/use-auth-init';
import { RequireAuth } from '@/components/require-auth';
import { RequireOnboarded } from '@/components/require-onboarded';
import { AppLayout } from '@/components/app-layout';

// Auth routes
const LoginPage          = lazy(() => import('@/modules/auth/login'));
const RegisterPage       = lazy(() => import('@/modules/auth/register'));
const ForgotPasswordPage = lazy(() => import('@/modules/auth/forgot-password'));
const ResetPasswordPage  = lazy(() => import('@/modules/auth/reset-password'));
const EmailVerifyPage    = lazy(() => import('@/modules/auth/email-verification'));

// Onboarding
const SetupWizardPage    = lazy(() => import('@/modules/onboarding/setup-wizard'));

// App shell pages
const DashboardPage      = lazy(() => import('@/modules/dashboard/index'));
const CompanySettingsPage = lazy(() => import('@/modules/settings/company-settings'));
const WarehousesPage     = lazy(() => import('@/modules/settings/warehouses'));
const UnitsPage          = lazy(() => import('@/modules/settings/units-of-measure'));
const PriceLevelsPage    = lazy(() => import('@/modules/settings/price-levels'));
const CategoriesPage     = lazy(() => import('@/modules/catalog/categories'));
const BrandsPage         = lazy(() => import('@/modules/catalog/brands'));
const VehicleMakesPage   = lazy(() => import('@/modules/catalog/vehicle-makes'));
const PartsCatalogPage   = lazy(() => import('@/modules/catalog/parts-catalog'));
const ProductsListPage   = lazy(() => import('@/modules/catalog/products/index'));
const ProductDetailPage  = lazy(() => import('@/modules/catalog/products/detail'));
const CustomersPage      = lazy(() => import('@/modules/contacts/customers'));
const SuppliersPage      = lazy(() => import('@/modules/contacts/suppliers'));

// Accounting
const CoAPage            = lazy(() => import('@/modules/accounting/chart-of-accounts'));
const JournalEntriesPage = lazy(() => import('@/modules/accounting/journal-entries'));
const JEEditorPage       = lazy(() => import('@/modules/accounting/journal-entry-editor'));
const GeneralLedgerPage  = lazy(() => import('@/modules/accounting/general-ledger'));
const PeriodLockPage     = lazy(() => import('@/modules/accounting/period-lock'));

// Reports
const TrialBalancePage       = lazy(() => import('@/modules/reports/trial-balance'));
const ProfitLossPage         = lazy(() => import('@/modules/reports/profit-loss'));
const BalanceSheetPage       = lazy(() => import('@/modules/reports/balance-sheet'));
const ARAgingPage            = lazy(() => import('@/modules/reports/ar-aging'));
const StockValuationPage     = lazy(() => import('@/modules/reports/stock-valuation'));

// Sales
const InvoicesPage       = lazy(() => import('@/modules/sales/invoices'));
const InvoiceEditorPage  = lazy(() => import('@/modules/sales/invoice-editor'));
const QuotesPage         = lazy(() => import('@/modules/sales/quotes'));
const QuoteEditorPage    = lazy(() => import('@/modules/sales/quote-editor'));
const PaymentsPage       = lazy(() => import('@/modules/sales/payments'));
const PaymentEditorPage  = lazy(() => import('@/modules/sales/payment-editor'));

// Customer / Supplier detail
const CustomerDetailPage  = lazy(() => import('@/modules/contacts/customer-detail'));
const SupplierDetailPage  = lazy(() => import('@/modules/contacts/supplier-detail'));

// Purchasing
const PurchaseOrdersPage     = lazy(() => import('@/modules/purchasing/purchase-orders'));
const POEditorPage           = lazy(() => import('@/modules/purchasing/po-editor'));
const GoodsReceiptsPage      = lazy(() => import('@/modules/purchasing/goods-receipts'));
const GRNEditorPage          = lazy(() => import('@/modules/purchasing/grn-editor'));
const VendorBillsPage        = lazy(() => import('@/modules/purchasing/vendor-bills'));
const VendorBillEditorPage   = lazy(() => import('@/modules/purchasing/vendor-bill-editor'));
const VendorPaymentsPage     = lazy(() => import('@/modules/purchasing/vendor-payments'));
const VendorPaymentEditorPage = lazy(() => import('@/modules/purchasing/vendor-payment-editor'));

// Phase 5 reports
const APAgingPage            = lazy(() => import('@/modules/reports/ap-aging'));
const SupplierStatementPage  = lazy(() => import('@/modules/reports/supplier-statement'));
const GRNReconciliationPage  = lazy(() => import('@/modules/reports/grn-reconciliation'));

// Phase 6 — Inventory Operations
const StockTransfersPage       = lazy(() => import('@/modules/inventory/stock-transfers'));
const TransferEditorPage       = lazy(() => import('@/modules/inventory/transfer-editor'));
const InventoryAdjustmentsPage = lazy(() => import('@/modules/inventory/inventory-adjustments'));
const AdjustmentEditorPage     = lazy(() => import('@/modules/inventory/adjustment-editor'));
const StockLedgerPage          = lazy(() => import('@/modules/inventory/stock-ledger'));

// Phase 6 — Inventory reports
const StockMovementReportPage         = lazy(() => import('@/modules/reports/stock-movement'));
const SlowMovingReportPage            = lazy(() => import('@/modules/reports/slow-moving'));
const ReorderReportPage               = lazy(() => import('@/modules/reports/reorder'));
const StockAgingReportPage            = lazy(() => import('@/modules/reports/stock-aging'));
const InventoryAdjustmentReportPage   = lazy(() => import('@/modules/reports/inventory-adjustment-report'));

// Phase 7 — POS Counter Sales
const POSScreenPage                   = lazy(() => import('@/modules/pos/pos-screen'));

// Phase 7 — POS reports
const POSSessionReportPage            = lazy(() => import('@/modules/reports/pos-session'));
const DailySalesReportPage            = lazy(() => import('@/modules/reports/daily-sales'));

// Phase 8 — Banking & PDC
const BankTransfersPage               = lazy(() => import('@/modules/banking/bank-transfers'));
const BankTransferEditorPage          = lazy(() => import('@/modules/banking/bank-transfer-editor'));
const ExpensesPage                    = lazy(() => import('@/modules/banking/expenses'));
const ExpenseEditorPage               = lazy(() => import('@/modules/banking/expense-editor'));
const PDCReceivedPage                 = lazy(() => import('@/modules/banking/pdc-received'));
const PDCIssuedPage                   = lazy(() => import('@/modules/banking/pdc-issued'));

// Phase 8 — Banking reports
const DailyCashPage                   = lazy(() => import('@/modules/reports/daily-cash'));
const BankReconPage                   = lazy(() => import('@/modules/reports/bank-recon'));

// Phase 9 — Returns & Credit/Debit Notes
const CreditNotesPage                 = lazy(() => import('@/modules/sales/credit-notes'));
const CreditNoteEditorPage            = lazy(() => import('@/modules/sales/credit-note-editor'));
const SalesReturnsPage                = lazy(() => import('@/modules/sales/sales-returns'));
const SalesReturnEditorPage           = lazy(() => import('@/modules/sales/sales-return-editor'));
const DebitNotesPage                  = lazy(() => import('@/modules/purchasing/debit-notes'));
const DebitNoteEditorPage             = lazy(() => import('@/modules/purchasing/debit-note-editor'));

function Loading() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-surface-page">
      <div className="h-6 w-6 animate-spin rounded-full border-2 border-brand-500 border-t-transparent" />
    </div>
  );
}

function WithAppLayout() {
  return <AppLayout><Outlet /></AppLayout>;
}

function AppRoutes() {
  const { loading } = useAuthInit();

  if (loading) return <Loading />;

  return (
    <Suspense fallback={<Loading />}>
      <Routes>
        {/* ── Public auth routes ───────────────────────────────────── */}
        <Route path="/login"            element={<LoginPage />} />
        <Route path="/register"         element={<RegisterPage />} />
        <Route path="/forgot-password"  element={<ForgotPasswordPage />} />
        <Route path="/reset-password"   element={<ResetPasswordPage />} />
        <Route path="/verify-email"     element={<EmailVerifyPage />} />

        {/* ── Authenticated ────────────────────────────────────────── */}
        <Route element={<RequireAuth />}>
          <Route path="/setup" element={<SetupWizardPage />} />

          {/* ── Authenticated + onboarded (wrapped in AppLayout) ───── */}
          <Route element={<RequireOnboarded />}>
            <Route element={<WithAppLayout />}>
              <Route path="/dashboard"                element={<DashboardPage />} />

              {/* Settings */}
              <Route path="/settings/company"         element={<CompanySettingsPage />} />
              <Route path="/settings/warehouses"      element={<WarehousesPage />} />
              <Route path="/settings/units"           element={<UnitsPage />} />
              <Route path="/settings/price-levels"    element={<PriceLevelsPage />} />

              {/* Catalog */}
              <Route path="/products/categories"      element={<CategoriesPage />} />
              <Route path="/products/brands"          element={<BrandsPage />} />
              <Route path="/products/vehicles"        element={<VehicleMakesPage />} />
              <Route path="/products/new"             element={<ProductDetailPage />} />
              <Route path="/products/:id"             element={<ProductDetailPage />} />
              <Route path="/products"                 element={<ProductsListPage />} />
              <Route path="/catalog"                  element={<PartsCatalogPage />} />

              {/* Contacts */}
              <Route path="/contacts/customers"       element={<CustomersPage />} />
              <Route path="/contacts/suppliers"       element={<SuppliersPage />} />

              {/* Accounting */}
              <Route path="/accounting/chart-of-accounts"        element={<CoAPage />} />
              <Route path="/accounting/journal-entries/new"      element={<JEEditorPage />} />
              <Route path="/accounting/journal-entries/:id"      element={<JEEditorPage />} />
              <Route path="/accounting/journal-entries"          element={<JournalEntriesPage />} />
              <Route path="/accounting/general-ledger"           element={<GeneralLedgerPage />} />
              <Route path="/accounting/period-lock"              element={<PeriodLockPage />} />

              {/* Reports */}
              <Route path="/reports/trial-balance"               element={<TrialBalancePage />} />
              <Route path="/reports/profit-loss"                element={<ProfitLossPage />} />
              <Route path="/reports/balance-sheet"              element={<BalanceSheetPage />} />
              <Route path="/reports/ar-aging"                   element={<ARAgingPage />} />
              <Route path="/reports/stock-valuation"            element={<StockValuationPage />} />

              {/* Sales */}
              <Route path="/sales/invoices/new"                 element={<InvoiceEditorPage />} />
              <Route path="/sales/invoices/:id"                 element={<InvoiceEditorPage />} />
              <Route path="/sales/invoices"                     element={<InvoicesPage />} />
              <Route path="/sales/quotes/new"                   element={<QuoteEditorPage />} />
              <Route path="/sales/quotes/:id"                   element={<QuoteEditorPage />} />
              <Route path="/sales/quotes"                       element={<QuotesPage />} />
              <Route path="/sales/payments/new"                 element={<PaymentEditorPage />} />
              <Route path="/sales/payments/:id"                 element={<PaymentEditorPage />} />
              <Route path="/sales/payments"                     element={<PaymentsPage />} />

              {/* Customer / Supplier detail */}
              <Route path="/contacts/customers/:id"             element={<CustomerDetailPage />} />
              <Route path="/contacts/suppliers/:id"             element={<SupplierDetailPage />} />

              {/* Purchasing */}
              <Route path="/purchasing/orders/new"              element={<POEditorPage />} />
              <Route path="/purchasing/orders/:id"              element={<POEditorPage />} />
              <Route path="/purchasing/orders"                  element={<PurchaseOrdersPage />} />
              <Route path="/purchasing/grns/new"                element={<GRNEditorPage />} />
              <Route path="/purchasing/grns/:id"                element={<GRNEditorPage />} />
              <Route path="/purchasing/grns"                    element={<GoodsReceiptsPage />} />
              <Route path="/purchasing/bills/new"               element={<VendorBillEditorPage />} />
              <Route path="/purchasing/bills/:id"               element={<VendorBillEditorPage />} />
              <Route path="/purchasing/bills"                   element={<VendorBillsPage />} />
              <Route path="/purchasing/payments/new"            element={<VendorPaymentEditorPage />} />
              <Route path="/purchasing/payments/:id"            element={<VendorPaymentEditorPage />} />
              <Route path="/purchasing/payments"                element={<VendorPaymentsPage />} />

              {/* Phase 5 reports */}
              <Route path="/reports/ap-aging"                   element={<APAgingPage />} />
              <Route path="/reports/supplier-statement"         element={<SupplierStatementPage />} />
              <Route path="/reports/grn-reconciliation"         element={<GRNReconciliationPage />} />

              {/* Phase 6 — Inventory Operations */}
              <Route path="/inventory/transfers/new"            element={<TransferEditorPage />} />
              <Route path="/inventory/transfers/:id"            element={<TransferEditorPage />} />
              <Route path="/inventory/transfers"                element={<StockTransfersPage />} />
              <Route path="/inventory/adjustments/new"          element={<AdjustmentEditorPage />} />
              <Route path="/inventory/adjustments/:id"          element={<AdjustmentEditorPage />} />
              <Route path="/inventory/adjustments"              element={<InventoryAdjustmentsPage />} />
              <Route path="/inventory/stock-ledger"             element={<StockLedgerPage />} />

              {/* Phase 6 — Inventory reports */}
              <Route path="/reports/stock-movement"             element={<StockMovementReportPage />} />
              <Route path="/reports/slow-moving"                element={<SlowMovingReportPage />} />
              <Route path="/reports/reorder"                    element={<ReorderReportPage />} />
              <Route path="/reports/stock-aging"                element={<StockAgingReportPage />} />
              <Route path="/reports/inventory-adjustment-report" element={<InventoryAdjustmentReportPage />} />

              {/* Phase 7 — POS Counter Sales */}
              <Route path="/pos"                                element={<POSScreenPage />} />

              {/* Phase 7 — POS reports */}
              <Route path="/reports/pos-session"                element={<POSSessionReportPage />} />
              <Route path="/reports/daily-sales"                element={<DailySalesReportPage />} />

              {/* Phase 8 — Banking & PDC */}
              <Route path="/banking/transfers/new"              element={<BankTransferEditorPage />} />
              <Route path="/banking/transfers/:id"              element={<BankTransferEditorPage />} />
              <Route path="/banking/transfers"                  element={<BankTransfersPage />} />
              <Route path="/banking/expenses/new"               element={<ExpenseEditorPage />} />
              <Route path="/banking/expenses/:id"               element={<ExpenseEditorPage />} />
              <Route path="/banking/expenses"                   element={<ExpensesPage />} />
              <Route path="/banking/pdc-received"               element={<PDCReceivedPage />} />
              <Route path="/banking/pdc-issued"                 element={<PDCIssuedPage />} />

              {/* Phase 8 — Banking reports */}
              <Route path="/reports/daily-cash"                 element={<DailyCashPage />} />
              <Route path="/reports/bank-recon"                 element={<BankReconPage />} />

              {/* Phase 9 — Returns & Credit/Debit Notes */}
              <Route path="/sales/returns/new"                  element={<SalesReturnEditorPage />} />
              <Route path="/sales/returns/:id"                  element={<SalesReturnEditorPage />} />
              <Route path="/sales/returns"                      element={<SalesReturnsPage />} />
              <Route path="/sales/credit-notes/new"             element={<CreditNoteEditorPage />} />
              <Route path="/sales/credit-notes/:id"             element={<CreditNoteEditorPage />} />
              <Route path="/sales/credit-notes"                 element={<CreditNotesPage />} />
              <Route path="/purchasing/debit-notes/new"         element={<DebitNoteEditorPage />} />
              <Route path="/purchasing/debit-notes/:id"         element={<DebitNoteEditorPage />} />
              <Route path="/purchasing/debit-notes"             element={<DebitNotesPage />} />
            </Route>
          </Route>
        </Route>

        {/* ── Default redirect ─────────────────────────────────────── */}
        <Route path="/" element={<Navigate to="/dashboard" replace />} />
        <Route path="*" element={<Navigate to="/dashboard" replace />} />
      </Routes>
    </Suspense>
  );
}

export default function App() {
  return (
    <BrowserRouter>
      <AppRoutes />
    </BrowserRouter>
  );
}
