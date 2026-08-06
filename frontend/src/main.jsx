/**
 * main.jsx — Application entry point.
 * Renders App wrapped with React Query's QueryClientProvider.
 */
import React from 'react';
import ReactDOM from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import App from './App';
import './theme/index.css';

/** React Query client with sensible defaults. */
const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      refetchOnWindowFocus: false,
      retry: 1,
      staleTime: 30_000,          // 30 seconds
      gcTime: 5 * 60 * 1000,     // 5 minutes (was cacheTime in v4)
    },
    mutations: {
      retry: 0,
    },
  },
});

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <App />
    </QueryClientProvider>
  </React.StrictMode>,
);
