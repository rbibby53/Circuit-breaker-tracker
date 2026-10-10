import '@fontsource-variable/archivo/wdth.css';
import '@fontsource/jetbrains-mono/400.css';
import '@fontsource/jetbrains-mono/700.css';
import './styles.css';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Route, Routes } from 'react-router-dom';
import { RequireAuth } from './auth';
import { Layout } from './components/Layout';
import { AccessPage } from './pages/Access';
import { AccountPage } from './pages/Account';
import { ActivityPage } from './pages/Activity';
import { InvitePage } from './pages/Invite';
import { LoginPage } from './pages/Login';
import { ResetPage } from './pages/Reset';
import { SetupPage } from './pages/Setup';
import { SitesPage } from './pages/Sites';
import { UsersPage } from './pages/Users';

const queryClient = new QueryClient({
  defaultOptions: { queries: { refetchOnWindowFocus: false } },
});

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
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
            <Route path="/access" element={<AccessPage />} />
            <Route path="/users" element={<UsersPage />} />
            <Route path="/activity" element={<ActivityPage />} />
            <Route path="/account" element={<AccountPage />} />
          </Route>
        </Routes>
      </BrowserRouter>
    </QueryClientProvider>
  </StrictMode>,
);
