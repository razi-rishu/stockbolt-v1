export default function App() {
  return (
    <div className="min-h-screen bg-surface-page flex items-center justify-center p-8">
      <div className="max-w-md w-full bg-surface-card rounded-card shadow-card border border-border-subtle p-8 text-center">
        <div className="mx-auto mb-4 h-14 w-14 rounded-2xl bg-brand-500 flex items-center justify-center">
          <svg
            xmlns="http://www.w3.org/2000/svg"
            viewBox="0 0 24 24"
            fill="white"
            className="h-8 w-8"
          >
            <path d="M13 2 3 14h7l-1 8 10-12h-7l1-8z" />
          </svg>
        </div>
        <h1 className="text-2xl font-bold text-ink-primary">StockBolt</h1>
        <p className="text-sm text-ink-secondary mt-1">ERP CORE — Phase 0 foundation</p>
        <p className="mt-6 text-xs text-ink-tertiary">
          No business logic yet. Database, auth, RLS, and folder structure only.
        </p>
      </div>
    </div>
  );
}
