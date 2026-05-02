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
const TrialBalancePage   = lazy(() => import('@/modules/reports/trial-balance'));

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
