import '@fontsource-variable/archivo/wdth.css';
import '@fontsource/jetbrains-mono/400.css';
import '@fontsource/jetbrains-mono/700.css';
import './styles.css';
import { MutationCache, QueryCache, QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Route, Routes } from 'react-router-dom';
import { ApiError } from './api';
import { RequireAuth } from './auth';
import { ConfirmProvider } from './components/ConfirmDialog';
import { Layout } from './components/Layout';
import { AccessPage } from './pages/Access';
import { AccountPage } from './pages/Account';
import { ActivityPage } from './pages/Activity';
import { InvitePage } from './pages/Invite';
import { applyTheme } from './lib/theme';
import { LoginPage } from './pages/Login';
import { NotFoundPage } from './pages/NotFound';
import { PanelEditorPage } from './pages/PanelEditor';
import { ResetPage } from './pages/Reset';
import { SetupPage } from './pages/Setup';
import { SitesPage } from './pages/Sites';
import { UsersPage } from './pages/Users';

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
          <Routes>
            <Route path="/setup" element={<SetupPage />} />
            <Route path="/login" element={<LoginPage />} />
            <Route path="/invite/:token" element={<InvitePage />} />
            <Route path="/reset/:token" element={<ResetPage />} />
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
              <Route path="*" element={<NotFoundPage />} />
            </Route>
          </Routes>
        </BrowserRouter>
      </ConfirmProvider>
    </QueryClientProvider>
  </StrictMode>,
);
