import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Layout } from './components/Layout';
import { DashboardPage } from './pages/DashboardPage';
import { MediaPage } from './pages/MediaPage';
import { ConversionsPage } from './pages/ConversionsPage';
import { ServerPage } from './pages/ServerPage';
import { SettingsPage } from './pages/SettingsPage';
import { TroubleshootingPage } from './pages/TroubleshootingPage';
import './index.css';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // Polling already retries; show connection problems quickly instead.
      retry: 1,
      refetchOnWindowFocus: true,
    },
  },
});

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <Layout>
          <Routes>
            <Route path="/" element={<DashboardPage />} />
            <Route path="/media" element={<MediaPage />} />
            <Route path="/conversions" element={<ConversionsPage />} />
            <Route path="/server" element={<ServerPage />} />
            <Route path="/troubleshooting" element={<TroubleshootingPage />} />
            <Route path="/settings" element={<SettingsPage />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </Layout>
      </BrowserRouter>
    </QueryClientProvider>
  </StrictMode>,
);
