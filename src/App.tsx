import { lazy, Suspense } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { useAuthInit } from '@/hooks/use-auth-init';
import { RequireAuth } from '@/components/require-auth';
import { RequireOnboarded } from '@/components/require-onboarded';

// Route-level code splitting
const LoginPage          = lazy(() => import('@/modules/auth/login'));
const RegisterPage       = lazy(() => import('@/modules/auth/register'));
const ForgotPasswordPage = lazy(() => import('@/modules/auth/forgot-password'));
const ResetPasswordPage  = lazy(() => import('@/modules/auth/reset-password'));
const EmailVerifyPage    = lazy(() => import('@/modules/auth/email-verification'));
const SetupWizardPage    = lazy(() => import('@/modules/onboarding/setup-wizard'));
const DashboardPage      = lazy(() => import('@/modules/dashboard/index'));
const CompanySettingsPage = lazy(() => import('@/modules/settings/company-settings'));

function Loading() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-surface-page">
      <div className="h-6 w-6 animate-spin rounded-full border-2 border-brand-500 border-t-transparent" />
    </div>
  );
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

        {/* ── Authenticated: setup wizard (not yet onboarded) ──────── */}
        <Route element={<RequireAuth />}>
          <Route path="/setup" element={<SetupWizardPage />} />

          {/* ── Authenticated + onboarded ──────────────────────────── */}
          <Route element={<RequireOnboarded />}>
            <Route path="/dashboard"            element={<DashboardPage />} />
            <Route path="/settings/company"     element={<CompanySettingsPage />} />
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
