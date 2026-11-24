import { lazy, Suspense } from 'react';
import { BrowserRouter, Routes, Route, Navigate, Outlet, useLocation, useParams } from 'react-router-dom';
import { useAuthInit } from '@/hooks/use-auth-init';
import { useAuthStore } from '@/store/auth';
import { RequireAuth } from '@/components/require-auth';
import { CurrencyDisplaySync } from '@/components/currency-display-sync';
import { RequireOnboarded } from '@/components/require-onboarded';
import { ModuleGate } from '@/components/module-gate';
import { GLOBAL_ONBOARDING } from '@/core/global-config/flag';
import { KeyboardShortcutProvider } from '@/keyboard/shortcut-registry';
import { RequireNotOnboarded } from '@/components/require-not-onboarded';
import { RequirePermission } from '@/components/require-permission';
import { UnsavedNavGuard } from '@/components/unsaved-nav-guard';
import { BackButtonHandler } from '@/navigation/BackButtonHandler';
import { NativeBridge } from '@/native/NativeBridge';
import { isAppShell, isNative } from '@/lib/platform';
import { UpdateBanner } from '@/components/update-banner';
import { AppLayout } from '@/components/app-layout';
import { ErrorBoundary } from '@/components/error-boundary';
import { OceanNotice } from '@/components/ocean-notice';
import { useTranslation } from 'react-i18next';
import { ChevronLeft, SearchX } from 'lucide-react';

// Marketing — public landing page (Phase 14.14c)
const LandingPage       = lazy(() => import('@/modules/marketing/landing-page'));
const PrivacyPolicyPage = lazy(() => import('@/modules/marketing/legal/privacy-policy'));
const DeleteAccountPage = lazy(() => import('@/modules/marketing/legal/delete-account'));
const RefundPolicyPage = lazy(() => import('@/modules/marketing/legal/refund-policy'));
const ContactPage = lazy(() => import('@/modules/marketing/legal/contact'));
const TermsOfServicePage = lazy(() => import('@/modules/marketing/legal/terms-of-service'));
const AgreementPage      = lazy(() => import('@/modules/legal/agreement-screen'));

// Auth routes
const LoginPage          = lazy(() => import('@/modules/auth/login'));
const RegisterPage       = lazy(() => import('@/modules/auth/register'));
const ForgotPasswordPage = lazy(() => import('@/modules/auth/forgot-password'));
const ResetPasswordPage  = lazy(() => import('@/modules/auth/reset-password'));
const EmailVerifyPage    = lazy(() => import('@/modules/auth/email-verification'));
const OAuthCallbackPage  = lazy(() => import('@/modules/auth/oauth-callback'));

// Onboarding
const SetupWizardPage    = lazy(() => import('@/modules/onboarding/setup-wizard'));
const BillingPage        = lazy(() => import('@/modules/settings/billing'));
const AcceptInvitePage   = lazy(() => import('@/modules/onboarding/accept-invite'));
const InviteLinkPage     = lazy(() => import('@/modules/onboarding/invite-link'));
const UsersRolesPage     = lazy(() => import('@/modules/settings/users/index'));

// App shell pages
const DashboardPage      = lazy(() => import('@/modules/dashboard/index'));
const DesignSystemPage   = lazy(() => import('@/modules/design-system/index'));
// Global v1 — dev-only preview of the configuration engine (never in production builds).
const GlobalConfigPreviewPage = import.meta.env.DEV
  ? lazy(() => import('@/modules/onboarding/global-config/global-config-preview'))
  : null;
// Global v1 — the seven-step business configuration wizard for an existing
// company: /dev/global-setup in development, and Settings → Business
// Configuration while the Global flag is on. Neither exists in a production
// build with the flag off.
const GlobalSetupWizardPage = import.meta.env.DEV || GLOBAL_ONBOARDING
  ? lazy(() => import('@/modules/onboarding/global-config/global-setup-wizard'))
  : null;
const SignatureTemplateGalleryPage = lazy(() => import('@/modules/print/_signature/gallery'));
const SettingsHubPage    = lazy(() => import('@/modules/settings/index'));
const SettingsLayout     = lazy(() => import('@/modules/settings/_layout'));
const HardwareSettingsPage = lazy(() => import('@/modules/settings/hardware'));
const CompanySettingsPage = lazy(() => import('@/modules/settings/company-settings'));
const WarehousesPage     = lazy(() => import('@/modules/settings/warehouses'));
const InventorySettingsPage = lazy(() => import('@/modules/settings/inventory-settings'));
const UnitsPage          = lazy(() => import('@/modules/settings/units-of-measure'));
const PriceLevelsPage    = lazy(() => import('@/modules/settings/price-levels'));
const BankAccountsPage   = lazy(() => import('@/modules/banking/bank-accounts'));
const TaxRatesPage       = lazy(() => import('@/modules/settings/tax-rates'));
const ExchangeRatesPage  = lazy(() => import('@/modules/settings/exchange-rates'));
const OpeningBalancesPage = lazy(() => import('@/modules/settings/opening-balances'));
const DocumentNumberingPage = lazy(() => import('@/modules/settings/document-numbering'));
const ImportExportPage    = lazy(() => import('@/modules/settings/import-export'));
const DeveloperSettingsPage = lazy(() => import('@/modules/settings/developer'));
const CategoriesPage     = lazy(() => import('@/modules/catalog/categories'));
const ProjectsListPage   = lazy(() => import('@/modules/projects/projects-list'));
const ProjectProfitPage  = lazy(() => import('@/modules/reports/project-profitability'));
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
const PendingJournalPage = lazy(() => import('@/modules/accounting/pending-journal'));
const JEEditorPage       = lazy(() => import('@/modules/accounting/journal-entry-editor'));
const GeneralLedgerPage  = lazy(() => import('@/modules/accounting/general-ledger'));
const PeriodLockPage     = lazy(() => import('@/modules/accounting/period-lock'));
const YearEndClosePage   = lazy(() => import('@/modules/accounting/year-end-close'));
const TaxReturnPage      = lazy(() => import('@/modules/accounting/tax-return'));
const FixedAssetsPage    = lazy(() => import('@/modules/accounting/fixed-assets'));
const AssetPurchasePage  = lazy(() => import('@/modules/accounting/asset-purchase/asset-purchase-page'));
const AmortizationPage   = lazy(() => import('@/modules/accounting/amortization'));
const TdsPage            = lazy(() => import('@/modules/accounting/tds'));

// Reports
const TrialBalancePage       = lazy(() => import('@/modules/reports/trial-balance'));
const ProfitLossPage         = lazy(() => import('@/modules/reports/profit-loss'));
const BalanceSheetPage       = lazy(() => import('@/modules/reports/balance-sheet'));
const ARAgingPage            = lazy(() => import('@/modules/reports/ar-aging'));
const StockValuationPage     = lazy(() => import('@/modules/reports/stock-valuation'));
const FixedAssetRegisterPage = lazy(() => import('@/modules/reports/fixed-asset-register'));
const DepreciationSchedulePage = lazy(() => import('@/modules/reports/depreciation-schedule'));

// Sales
const InvoicesPage       = lazy(() => import('@/modules/sales/invoices'));
const InvoiceEditorPage  = lazy(() => import('@/modules/sales/invoice-editor'));
// The invoice detail/new editor renders inside the Invoices master-detail
// workspace via a single :id route, so navigating 66d4… → new (or A → B)
// changes only the param without remounting. Keying by :id forces a fresh
// mount so no state (loaded lines, edit mode) leaks between invoices.
function KeyedInvoiceEditor() {
  const { id } = useParams();
  return <InvoiceEditorPage key={id ?? 'new'} />;
}
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
// Phase 13.02 — multi-line expenses under Purchasing
const PurchasingExpensesPage      = lazy(() => import('@/modules/purchasing/expenses'));
const PurchasingExpenseEditorPage = lazy(() => import('@/modules/purchasing/expense-editor'));

// Payroll P1 (owner override 2026-06-13)
const EmployeesPage        = lazy(() => import('@/modules/payroll/employees'));
const PayrollRunsPage      = lazy(() => import('@/modules/payroll/payroll-runs'));
const PayrollRunEditorPage = lazy(() => import('@/modules/payroll/payroll-run-editor'));
const LeaveSalaryPage      = lazy(() => import('@/modules/payroll/leave-salary'));

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
const PDCReceivedPage                 = lazy(() => import('@/modules/banking/pdc-received'));
const PDCIssuedPage                   = lazy(() => import('@/modules/banking/pdc-issued'));
const BankReconciliationPage          = lazy(() => import('@/modules/banking/bank-reconciliation'));

// Phase 8 — Banking reports
const DailyCashPage                   = lazy(() => import('@/modules/reports/daily-cash'));
const BankReconPage                   = lazy(() => import('@/modules/reports/bank-recon'));

// Phase 9 — Returns & Credit/Debit Notes
const CreditNotesPage                 = lazy(() => import('@/modules/sales/credit-notes'));
const CreditNoteEditorPage            = lazy(() => import('@/modules/sales/credit-note-editor'));
const SalesReturnsPage                = lazy(() => import('@/modules/sales/sales-returns'));
const SalesReturnEditorPage           = lazy(() => import('@/modules/sales/sales-return-editor'));
const PurchaseReturnsPage             = lazy(() => import('@/modules/purchasing/purchase-returns'));
const PurchaseReturnEditorPage        = lazy(() => import('@/modules/purchasing/purchase-return-editor'));
const DebitNotesPage                  = lazy(() => import('@/modules/purchasing/debit-notes'));
const DebitNoteEditorPage             = lazy(() => import('@/modules/purchasing/debit-note-editor'));

// Phase 11 — Print Templates
const PrintPage                       = lazy(() => import('@/modules/print/PrintPage'));
const PrintSettingsPage               = lazy(() => import('@/modules/settings/print-settings'));

// Phase 10 — Reports Completion & Dashboards
const ReturnsAnalysisPage             = lazy(() => import('@/modules/reports/returns-analysis'));
const SalesByCustomerPage             = lazy(() => import('@/modules/reports/sales-by-customer'));
const SalesByProductPage              = lazy(() => import('@/modules/reports/sales-by-product'));
const SalesByBrandPage                = lazy(() => import('@/modules/reports/sales-by-brand'));
const SalesByVehiclePage              = lazy(() => import('@/modules/reports/sales-by-vehicle'));
const SalesBySalespersonPage          = lazy(() => import('@/modules/reports/sales-by-salesperson'));
const SalesTrendPage                  = lazy(() => import('@/modules/reports/sales-trend'));
const PurchasesBySupplierPage         = lazy(() => import('@/modules/reports/purchases-by-supplier'));
const PurchasesByProductPage          = lazy(() => import('@/modules/reports/purchases-by-product'));
const OutstandingPOsPage              = lazy(() => import('@/modules/reports/outstanding-pos'));
const VATReturnPage                   = lazy(() => import('@/modules/reports/vat-return'));
const AuditLogPage                    = lazy(() => import('@/modules/reports/audit-log'));
const ReversalTrailPage               = lazy(() => import('@/modules/reports/reversal-trail'));
const CashFlowPage                    = lazy(() => import('@/modules/reports/cash-flow'));
const SystemHealthPage                = lazy(() => import('@/modules/settings/system-health'));
const MaintenancePage                 = lazy(() => import('@/modules/settings/maintenance'));
const ResetDataPage                   = lazy(() => import('@/modules/settings/reset-data'));
const SalespeoplePage                 = lazy(() => import('@/modules/settings/salespeople'));
const TeamPage                        = lazy(() => import('@/modules/settings/team/index'));
const ApprovalsSettingsPage           = lazy(() => import('@/modules/settings/approvals/index'));
const ApprovalsInboxPage              = lazy(() => import('@/modules/approvals/inbox'));
const AdminControlCenter              = lazy(() => import('@/modules/admin/control-center'));
const RequirePlatformAdmin            = lazy(() => import('@/modules/admin/require-platform-admin'));
// phase133 — Help & Support (every signed-in user; the inbox checks operator rights)
const SupportHomePage                 = lazy(() => import('@/modules/support/support-home'));
const SupportNewPage                  = lazy(() => import('@/modules/support/support-new'));
const SupportTicketPage               = lazy(() => import('@/modules/support/support-ticket'));
const SupportInboxPage                = lazy(() => import('@/modules/support/support-inbox'));

function Loading() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-surface-page">
      <div className="h-6 w-6 animate-spin rounded-full border-2 border-brand-500 border-t-transparent" />
    </div>
  );
}

function WithAppLayout() {
  return (
    <KeyboardShortcutProvider>
      {/* Global v1 — routes into a disabled module are refused here. */}
      <AppLayout><ModuleGate><Outlet /></ModuleGate></AppLayout>
    </KeyboardShortcutProvider>
  );
}

/**
 * Landing gateway (Phase 14.14c). Pure routing helper:
 *   - logged-in operator at `/`  → bounce to /dashboard
 *   - anonymous visitor at `/`   → render the marketing landing page
 * Live preview of the marketing page while logged-in is still available
 * at `/landing` (registered as its own route below).
 */
function LandingGateway() {
  const user_id = useAuthStore((s) => s.user_id);
  if (user_id) return <Navigate to="/dashboard" replace />;
  return <LandingPage />;
}

function AppRoutes() {
  const { loading } = useAuthInit();

  if (loading) return <Loading />;

  return (
    <Suspense fallback={<Loading />}>
      {/* Phase 27 — warn before navigating away from an editor with unsaved edits. */}
      <UnsavedNavGuard />
      {/* phase143 — company currency display (code / symbol), app-wide incl. print. */}
      <CurrencyDisplaySync />
      {/* Android app only — hardware Back closes dialogs, then navigates back. */}
      {isNative() && <BackButtonHandler />}
      {isNative() && <NativeBridge />}
      <Routes>
        {/* ── Public auth routes ───────────────────────────────────── */}
        {/* Global v1 preview: registered only by the Vite dev server (import.meta.env.DEV). */}
        {GlobalConfigPreviewPage && <Route path="/dev/global-config" element={<GlobalConfigPreviewPage />} />}
        <Route path="/login"            element={<LoginPage />} />
        <Route path="/register"         element={<RegisterPage />} />
        <Route path="/forgot-password"  element={<ForgotPasswordPage />} />
        <Route path="/reset-password"   element={<ResetPasswordPage />} />
        <Route path="/verify-email"     element={<EmailVerifyPage />} />
        <Route path="/auth/callback"    element={<OAuthCallbackPage />} />
        {/* phase140 — shared invite link; opens before the invitee has an account. */}
        <Route path="/invite/:token"    element={<InviteLinkPage />} />

        {/* ── Authenticated ────────────────────────────────────────── */}
        <Route element={<RequireAuth />}>
          {/* /setup is only reachable when NOT yet onboarded; otherwise
              bounce to /dashboard (avoids a one-frame flash of the wizard
              on refresh and Rules-of-Hooks issues from an in-component
              early return). */}
          <Route element={<RequireNotOnboarded />}>
            <Route path="/setup" element={<SetupWizardPage />} />
          </Route>
          {/* phase135 — review / accept updated Terms: every signed-in user, before or after onboarding. */}
          <Route path="/legal/accept" element={<AgreementPage />} />

          {/* Phase 22 — invited teammates accept here (no tenant chrome). */}
          <Route path="/accept-invite" element={<AcceptInvitePage />} />

          {/* ── Platform Admin (owner-only) — standalone, no tenant chrome.
               Guarded client-side; the get_admin_dashboard RPC enforces it
               server-side regardless. Not in any tenant navigation. ───── */}
          <Route element={<RequirePlatformAdmin />}>
            <Route path="/admin/*" element={<AdminControlCenter />} />
          </Route>

          {/* ── Authenticated + onboarded (wrapped in AppLayout) ───── */}
          <Route element={<RequireOnboarded />}>
            <Route element={<WithAppLayout />}>
              <Route path="/dashboard"                element={<DashboardPage />} />
              {/* phase133 — Help & Support. No module permission: anyone can ask for help.
                  Tickets are private to their author; the server enforces it. */}
              <Route path="/support"                  element={<SupportHomePage />} />
              <Route path="/approvals"                element={<ApprovalsInboxPage />} />
              <Route path="/support/new/:category"    element={<SupportNewPage />} />
              <Route path="/support/tickets/:id"      element={<SupportTicketPage />} />
              <Route path="/support/inbox"            element={<SupportInboxPage />} />
              <Route path="/design-system"            element={<DesignSystemPage />} />
              {GlobalSetupWizardPage && <Route path="/dev/global-setup" element={<GlobalSetupWizardPage />} />}
              <Route path="/print-templates"          element={<SignatureTemplateGalleryPage />} />

              {/* Settings — two-pane layout with a pinned left nav rail */}
              <Route path="/settings" element={<SettingsLayout />}>
                <Route element={<RequirePermission perm="settings.read" />}>
                  <Route index                   element={<SettingsHubPage />} />
                  <Route path="company"          element={<CompanySettingsPage />} />
                  {/* Website only: the Android app never shows billing (Google Play payments policy). */}
                  <Route path="billing"          element={isAppShell() ? <Navigate to="/settings" replace /> : <BillingPage />} />
                  <Route path="warehouses"       element={<WarehousesPage />} />
                  <Route path="inventory"        element={<InventorySettingsPage />} />
                  <Route path="units"            element={<UnitsPage />} />
                  <Route path="price-levels"     element={<PriceLevelsPage />} />
                  <Route path="tax-rates"        element={<TaxRatesPage />} />
                  <Route path="exchange-rates"   element={<ExchangeRatesPage />} />
                  <Route path="opening-balances" element={<OpeningBalancesPage />} />
                  <Route path="numbering"        element={<DocumentNumberingPage />} />
                  <Route path="import-export"    element={<ImportExportPage />} />
                  {GLOBAL_ONBOARDING && GlobalSetupWizardPage && (
                    <Route path="business-configuration" element={<GlobalSetupWizardPage />} />
                  )}
                  <Route path="users" element={<RequirePermission perm="users.manage" />}>
                    <Route index element={<UsersRolesPage />} />
                  </Route>
                  <Route path="approvals" element={<RequirePermission perm="users.manage" />}>
                    <Route index element={<ApprovalsSettingsPage />} />
                  </Route>
                  <Route path="developer" element={<RequirePermission perm="settings.write" />}>
                    <Route index element={<DeveloperSettingsPage />} />
                  </Route>
                </Route>
                {/* Catalog masters + admin tools — authenticated; writes still RLS-gated */}
                <Route path="categories"    element={<CategoriesPage />} />
                <Route path="brands"        element={<BrandsPage />} />
                <Route path="vehicles"      element={<VehicleMakesPage />} />
                <Route path="salespeople"   element={<SalespeoplePage />} />
                <Route path="team"          element={<TeamPage />} />
                <Route path="print"         element={<PrintSettingsPage />} />
                <Route path="hardware"      element={<HardwareSettingsPage />} />
                <Route path="system-health" element={<SystemHealthPage />} />
                <Route path="maintenance"   element={<MaintenancePage />} />
                <Route path="reset-data"    element={<ResetDataPage />} />
                <Route path="audit-log"     element={<AuditLogPage />} />
                {/* Accounting masters — require accounting.read */}
                <Route element={<RequirePermission perm="accounting.read" />}>
                  <Route path="chart-of-accounts" element={<CoAPage />} />
                  <Route path="period-lock"       element={<PeriodLockPage />} />
                </Route>
              </Route>

              {/* Catalog */}
              {/* phase104 Stage 3 — the page itself re-checks projects_enabled,
                  so a hand-typed URL cannot reach it with the module off. */}
              <Route path="/projects"                 element={<ProjectsListPage />} />
              <Route path="/reports/project-profitability" element={<ProjectProfitPage />} />
              <Route path="/products/categories"      element={<CategoriesPage />} />
              <Route path="/products/brands"          element={<BrandsPage />} />
              <Route path="/products/vehicles"        element={<VehicleMakesPage />} />
              <Route path="/products/:id"             element={<ProductDetailPage />} />
              <Route path="/products"                 element={<ProductsListPage />} />
              <Route path="/catalog"                  element={<PartsCatalogPage />} />

              {/* Contacts */}
              <Route path="/contacts/customers"       element={<CustomersPage />} />
              <Route path="/contacts/suppliers"       element={<SuppliersPage />} />

              {/* Accounting — require accounting.read (Phase 22) */}
              <Route element={<RequirePermission perm="accounting.read" />}>
                <Route path="/accounting/chart-of-accounts"        element={<CoAPage />} />
                <Route path="/accounting/journal-entries/pending/:docId" element={<PendingJournalPage />} />
                <Route path="/accounting/journal-entries/:id"      element={<JEEditorPage />} />
                <Route path="/accounting/journal-entries"          element={<JournalEntriesPage />} />
                <Route path="/accounting/general-ledger"           element={<GeneralLedgerPage />} />
                <Route path="/accounting/period-lock"              element={<PeriodLockPage />} />
                <Route path="/accounting/year-end-close"           element={<YearEndClosePage />} />
                <Route path="/accounting/tax-return"               element={<TaxReturnPage />} />
                <Route path="/accounting/fixed-assets"             element={<FixedAssetsPage />} />
                {/* phase126 — New Asset: register, or buy on credit / cash / bank */}
                <Route path="/accounting/fixed-assets/new"         element={<AssetPurchasePage />} />
                <Route path="/accounting/fixed-assets/purchase/:id" element={<AssetPurchasePage />} />
                <Route path="/accounting/amortization"            element={<AmortizationPage />} />
                <Route path="/accounting/tds"                     element={<TdsPage />} />
              </Route>

              {/* Reports */}
              <Route path="/reports/trial-balance"               element={<TrialBalancePage />} />
              <Route path="/reports/profit-loss"                element={<ProfitLossPage />} />
              <Route path="/reports/balance-sheet"              element={<BalanceSheetPage />} />
              <Route path="/reports/ar-aging"                   element={<ARAgingPage />} />
              <Route path="/reports/stock-valuation"            element={<StockValuationPage />} />
              <Route path="/reports/fixed-asset-register"       element={<FixedAssetRegisterPage />} />
              <Route path="/reports/depreciation-schedule"      element={<DepreciationSchedulePage />} />

              {/* Sales */}
              {/* Phase 46b/47b — creating OR editing an invoice needs the full
                  screen (the line-item grid gets crushed in the master-detail
                  pane), so /new and /:id/edit render standalone; VIEWING an
                  existing invoice stays in the list + preview workspace. The
                  static "new" and "/edit" routes outrank the nested ":id". */}
              <Route path="/sales/invoices/new" element={<KeyedInvoiceEditor />} />
              <Route path="/sales/invoices/:id/edit" element={<KeyedInvoiceEditor />} />
              <Route path="/sales/invoices" element={<InvoicesPage />}>
                <Route index element={<div className="flex items-center justify-center rounded-card border border-border-subtle p-12 text-center text-sm text-ink-tertiary">Select an invoice to view it here.</div>} />
                <Route path=":id" element={<KeyedInvoiceEditor />} />
              </Route>
              <Route path="/sales/quotes/:id"                   element={<QuoteEditorPage />} />
              <Route path="/sales/quotes"                       element={<QuotesPage />} />
              <Route path="/sales/payments/:id"                 element={<PaymentEditorPage />} />
              <Route path="/sales/payments"                     element={<PaymentsPage />} />

              {/* Customer / Supplier detail */}
              <Route path="/contacts/customers/:id"             element={<CustomerDetailPage />} />
              <Route path="/contacts/suppliers/:id"             element={<SupplierDetailPage />} />

              {/* Purchasing */}
              <Route path="/purchasing/orders/:id"              element={<POEditorPage />} />
              <Route path="/purchasing/orders"                  element={<PurchaseOrdersPage />} />
              <Route path="/purchasing/grns/:id"                element={<GRNEditorPage />} />
              <Route path="/purchasing/grns"                    element={<GoodsReceiptsPage />} />
              <Route path="/purchasing/bills/:id"               element={<VendorBillEditorPage />} />
              <Route path="/purchasing/bills"                   element={<VendorBillsPage />} />
              <Route path="/purchasing/payments/:id"            element={<VendorPaymentEditorPage />} />
              <Route path="/purchasing/payments"                element={<VendorPaymentsPage />} />
              {/* Phase 13.02 — multi-line expenses under Purchasing */}
              <Route path="/purchasing/expenses/:id"            element={<PurchasingExpenseEditorPage />} />
              <Route path="/purchasing/expenses"                element={<PurchasingExpensesPage />} />

              {/* Payroll — require payroll.read (Phase 22) */}
              <Route element={<RequirePermission perm="payroll.read" />}>
                <Route path="/payroll/employees"                  element={<EmployeesPage />} />
                <Route path="/payroll/runs/:id"                   element={<PayrollRunEditorPage />} />
                <Route path="/payroll/runs"                       element={<PayrollRunsPage />} />
                <Route path="/payroll/leave-salary"               element={<LeaveSalaryPage />} />
              </Route>

              {/* Phase 5 reports */}
              <Route path="/reports/ap-aging"                   element={<APAgingPage />} />
              <Route path="/reports/supplier-statement"         element={<SupplierStatementPage />} />
              <Route path="/reports/grn-reconciliation"         element={<GRNReconciliationPage />} />

              {/* Phase 6 — Inventory Operations */}
              <Route path="/inventory/transfers/:id"            element={<TransferEditorPage />} />
              <Route path="/inventory/transfers"                element={<StockTransfersPage />} />
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

              {/* Expenses merged into Purchasing (2026-06-14). Old Banking
                  paths redirect — same underlying expenses table. */}
              {/* Phase 95 — Bank Accounts moved out of the Settings shell.
                   Old links, bookmarks and anything still pointing at the
                   settings path keep working. */}
              <Route path="/settings/bank-accounts"            element={<Navigate to="/banking/bank-accounts" replace />} />
              <Route path="/banking/expenses/:id"               element={<Navigate to="/purchasing/expenses" replace />} />
              <Route path="/banking/expenses"                   element={<Navigate to="/purchasing/expenses" replace />} />
              {/* Phase 8 — Banking & PDC — require accounting.read (Phase 22) */}
              <Route element={<RequirePermission perm="accounting.read" />}>
                <Route path="/banking/bank-accounts"              element={<BankAccountsPage />} />
                <Route path="/banking/transfers/:id"              element={<BankTransferEditorPage />} />
                <Route path="/banking/transfers"                  element={<BankTransfersPage />} />
                <Route path="/banking/pdc-received"               element={<PDCReceivedPage />} />
                <Route path="/banking/pdc-issued"                 element={<PDCIssuedPage />} />
                <Route path="/banking/reconciliation"             element={<BankReconciliationPage />} />
              </Route>

              {/* Phase 8 — Banking reports */}
              <Route path="/reports/daily-cash"                 element={<DailyCashPage />} />
              <Route path="/reports/bank-recon"                 element={<BankReconPage />} />

              {/* Phase 9 — Returns & Credit/Debit Notes */}
              {/* Z3 — the credit note is the document now, so there is no
                  such thing as a NEW sales return. Every return already
                  raised keeps its own URL and stays readable, printable and
                  voidable; only creation moved. A bookmark to /new lands on
                  the credit note form rather than a dead end. */}
              <Route path="/sales/returns/new"                  element={<Navigate to="/sales/credit-notes/new" replace />} />
              <Route path="/sales/returns/:id"                  element={<SalesReturnEditorPage />} />
              <Route path="/sales/returns"                      element={<SalesReturnsPage />} />
              <Route path="/sales/credit-notes/:id"             element={<CreditNoteEditorPage />} />
              <Route path="/sales/credit-notes"                 element={<CreditNotesPage />} />
              {/* Z6 — as Z3 on the sales side: no new purchase returns, but
                  every one already raised keeps its URL. */}
              <Route path="/purchasing/returns/new"            element={<Navigate to="/purchasing/debit-notes/new" replace />} />
              <Route path="/purchasing/returns/:id"             element={<PurchaseReturnEditorPage />} />
              <Route path="/purchasing/returns"                 element={<PurchaseReturnsPage />} />
              <Route path="/purchasing/debit-notes/:id"         element={<DebitNoteEditorPage />} />
              <Route path="/purchasing/debit-notes"             element={<DebitNotesPage />} />

              {/* Phase 10 — Reports Completion & Dashboards */}
              <Route path="/reports/returns-analysis"          element={<ReturnsAnalysisPage />} />
              <Route path="/reports/sales-by-customer"          element={<SalesByCustomerPage />} />
              <Route path="/reports/sales-by-product"           element={<SalesByProductPage />} />
              <Route path="/reports/sales-by-brand"             element={<SalesByBrandPage />} />
              <Route path="/reports/sales-by-vehicle"           element={<SalesByVehiclePage />} />
              <Route path="/reports/sales-by-salesperson"       element={<SalesBySalespersonPage />} />
              <Route path="/reports/sales-trend"                element={<SalesTrendPage />} />
              <Route path="/reports/purchases-by-supplier"      element={<PurchasesBySupplierPage />} />
              <Route path="/reports/purchases-by-product"       element={<PurchasesByProductPage />} />
              <Route path="/reports/outstanding-pos"            element={<OutstandingPOsPage />} />
              <Route path="/reports/vat-return"                 element={<VATReturnPage />} />
              <Route path="/reports/audit-log"                  element={<AuditLogPage />} />
              <Route path="/reports/reversal-trail"             element={<ReversalTrailPage />} />
              <Route path="/reports/cash-flow"                  element={<CashFlowPage />} />
            </Route>
          </Route>

          {/* ── Print routes — authenticated + onboarded, NO AppLayout ──── */}
          <Route element={<RequireOnboarded />}>
            <Route path="/print/:docType/:id"                   element={<PrintPage />} />
          </Route>
        </Route>

        {/* ── Public marketing routes (Phase 14.14c) ───────────────────
             - `/`         anonymous visitors see the landing page;
                           logged-in users get bounced to /dashboard.
             - `/landing`  always renders the landing page (lets logged-in
                           operators preview marketing copy without
                           logging out). */}
        <Route path="/" element={<LandingGateway />} />
        <Route path="/landing" element={<LandingPage />} />
        {/* Public legal pages — no login; Google Play links to both. */}
        <Route path="/terms" element={<TermsOfServicePage />} />
        <Route path="/privacy" element={<PrivacyPolicyPage />} />
        <Route path="/delete-account" element={<DeleteAccountPage />} />
        {/* Razorpay checks these before activating payments. */}
        <Route path="/refund-policy" element={<RefundPolicyPage />} />
        <Route path="/contact" element={<ContactPage />} />
        {/* Phase 14.12 — catch-all now shows a visible 404 instead of
             silently bouncing to /dashboard. The previous redirect
             masked routing bugs ("refresh always goes to dashboard"
             actually meant "route didn't match"). Showing the attempted
             URL + a manual "Go to Dashboard" button makes the failure
             diagnosable. */}
        <Route path="*" element={<NotFoundPage />} />
      </Routes>
    </Suspense>
  );
}

// Phase 14.12 — diagnostic 404. Shows the URL React Router couldn't
// match instead of silently sending the operator to /dashboard. If a
// refresh on a valid page lands here, the bug is the URL mismatch
// (typo, wrong route order, stale build); if a refresh DOESN'T land
// here but still bounces to /dashboard, the bug is elsewhere (a
// component-level navigate(), error-boundary fallback, etc.).
function NotFoundPage() {
  const location = useLocation();
  const { t } = useTranslation();
  return (
    <OceanNotice
      fullPage testid="not-found" tone="warn" icon={<SearchX size={24} />}
      title={t('notFound.title')}
      actions={<>
        <a href="/dashboard" className="sb-primary-btn sb-btn-inline">{t('notFound.go_dashboard')}</a>
        <button type="button" className="sb-secondary-btn sb-btn-inline" onClick={() => window.history.back()}>
          <ChevronLeft size={16} className="sb-rtl-flip" aria-hidden="true" /> {t('notFound.back')}
        </button>
      </>}
    >
      <bdi dir="ltr" className="sb-notice-url">{location.pathname}{location.search}</bdi>
      <p style={{ margin: 0 }}>{t('notFound.body')}</p>
    </OceanNotice>
  );
}

export default function App() {
  return (
    <ErrorBoundary>
      {/*
        Opt into v7 behavior NOW so the console-warning noise goes away.
        Both flags are safe — we already render under React 18 with
        Suspense for code-splitting, and our routes are all absolute,
        so the relative-splat-path change is a no-op for us.
      */}
      <BrowserRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
        <AppRoutes />
        <UpdateBanner />
      </BrowserRouter>
    </ErrorBoundary>
  );
}
