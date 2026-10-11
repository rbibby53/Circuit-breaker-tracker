import '@fontsource-variable/archivo/wdth.css';
import '@fontsource/jetbrains-mono/400.css';
import '@fontsource/jetbrains-mono/700.css';
import './styles.css';
import { MutationCache, QueryCache, QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { StrictMode, Suspense, lazy } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Route, Routes } from 'react-router-dom';
import { ApiError } from './api';
import { RequireAuth } from './auth';
import { ConfirmProvider } from './components/ConfirmDialog';
import { Layout } from './components/Layout';
import { applyTheme } from './lib/theme';
import { LoginPage } from './pages/Login';
import { NotFoundPage } from './pages/NotFound';
import { SitesPage } from './pages/Sites';

// Pages beyond the first screen load when they are opened, keeping the first download small.
const AccessPage = lazy(() => import('./pages/Access').then((m) => ({ default: m.AccessPage })));
const AccountPage = lazy(() => import('./pages/Account').then((m) => ({ default: m.AccountPage })));
const ActivityPage = lazy(() => import('./pages/Activity').then((m) => ({ default: m.ActivityPage })));
const InvitePage = lazy(() => import('./pages/Invite').then((m) => ({ default: m.InvitePage })));
const PanelEditorPage = lazy(() => import('./pages/PanelEditor').then((m) => ({ default: m.PanelEditorPage })));
const PublicPanelPage = lazy(() => import('./pages/PublicPanel').then((m) => ({ default: m.PublicPanelPage })));
const ResetPage = lazy(() => import('./pages/Reset').then((m) => ({ default: m.ResetPage })));
const SettingsPage = lazy(() => import('./pages/Settings').then((m) => ({ default: m.SettingsPage })));
const SetupPage = lazy(() => import('./pages/Setup').then((m) => ({ default: m.SetupPage })));
const UsersPage = lazy(() => import('./pages/Users').then((m) => ({ default: m.UsersPage })));

applyTheme();

/** A 401 anywhere means the session ended (expired, signed out elsewhere): re-check who we are. */
const onError = (err: unknown) => {
  if (err instanceof ApiError && err.status === 401) void queryClient.invalidateQueries({ queryKey: ['me'] });
};

const queryClient: QueryClient = new QueryClient({
  defaultOptions: { queries: { refetchOnWindowFocus: false } },
  queryCache: new QueryCache({ onError: (err, query) => query.queryKey[0] !== 'me' && onError(err) }),
  mutationCache: new MutationCache({ onError }),
});

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <ConfirmProvider>
        <BrowserRouter>
          <Suspense fallback={<div className="page-loading">Loading…</div>}>
            <Routes>
              <Route path="/setup" element={<SetupPage />} />
              <Route path="/login" element={<LoginPage />} />
              <Route path="/invite/:token" element={<InvitePage />} />
              <Route path="/reset/:token" element={<ResetPage />} />
              <Route path="/p/:token" element={<PublicPanelPage />} />
              <Route
                element={
                  <RequireAuth>
                    <Layout />
                  </RequireAuth>
                }
              >
                <Route path="/" element={<SitesPage />} />
                <Route path="/panels/:id" element={<PanelEditorPage />} />
                <Route path="/access" element={<AccessPage />} />
                <Route path="/users" element={<UsersPage />} />
                <Route path="/activity" element={<ActivityPage />} />
                <Route path="/account" element={<AccountPage />} />
                <Route path="/settings" element={<SettingsPage />} />
                <Route path="*" element={<NotFoundPage />} />
              </Route>
            </Routes>
          </Suspense>
        </BrowserRouter>
      </ConfirmProvider>
    </QueryClientProvider>
  </StrictMode>,
);
