import React from 'react';
import ReactDOM from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import App from './App';
import { setupI18n } from './i18n/config';
import { installGlobalErrorHandlers } from './lib/error-reporting';
import './index.css';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      retry: 1,
    },
  },
});

// H6-P1: capture uncaught errors + unhandled promise rejections (the errors the
// React ErrorBoundary can't see) as early as possible, before anything renders.
installGlobalErrorHandlers();

// i18n initialised synchronously from bundled JSON — no async needed
setupI18n();

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <App />
    </QueryClientProvider>
  </React.StrictMode>,
);
