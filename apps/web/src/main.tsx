import '@fontsource-variable/archivo/wdth.css';
import '@fontsource/jetbrains-mono/400.css';
import '@fontsource/jetbrains-mono/700.css';
import './styles.css';
import { MutationCache, QueryCache, QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { StrictMode, Suspense, lazy, type ComponentType } from 'react';
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

/**
 * A page loaded on first visit. After an upgrade, a tab opened before it asks for page files
 * that no longer exist; reload once to get the new version instead of showing an error.
 */
function lazyPage<M, P extends object>(load: () => Promise<M>, pick: (m: M) => ComponentType<P>) {
  return lazy(async () => {
    try {
      const page = pick(await load());
      reloaded(false);
      return { default: page };
    } catch (err) {
      if (!reloaded()) {
        reloaded(true);
        window.location.reload();
        return new Promise<never>(() => undefined);
      }
      throw err;
    }
  });
}
const RELOADED_KEY = 'cbt-reloaded-for-update';
/** Read, or set, whether this tab already reloaded for an update. Blocked storage means no retry. */
function reloaded(set?: boolean): boolean {
  try {
    if (set === true) sessionStorage.setItem(RELOADED_KEY, '1');
    else if (set === false) sessionStorage.removeItem(RELOADED_KEY);
    return sessionStorage.getItem(RELOADED_KEY) === '1';
  } catch {
    return true;
  }
}

// Pages beyond the first screen load when they are opened, keeping the first download small.
const GeneratorPage = lazyPage(
  () => import('./pages/Generators'),
  (m) => m.GeneratorPage,
);
const DevicePage = lazyPage(
  () => import('./pages/Devices'),
  (m) => m.DevicePage,
);
const EquipmentListPage = lazyPage(
  () => import('./pages/Equipment'),
  (m) => m.EquipmentListPage,
);
const EquipmentPage = lazyPage(
  () => import('./pages/Equipment'),
  (m) => m.EquipmentPage,
);
const PowerPage = lazyPage(
  () => import('./pages/Power'),
  (m) => m.PowerPage,
);
const AccessPage = lazyPage(
  () => import('./pages/Access'),
  (m) => m.AccessPage,
);
const AccountPage = lazyPage(
  () => import('./pages/Account'),
  (m) => m.AccountPage,
);
const ActivityPage = lazyPage(
  () => import('./pages/Activity'),
  (m) => m.ActivityPage,
);
const InvitePage = lazyPage(
  () => import('./pages/Invite'),
  (m) => m.InvitePage,
);
const PanelEditorPage = lazyPage(
  () => import('./pages/PanelEditor'),
  (m) => m.PanelEditorPage,
);
const PublicPanelPage = lazyPage(
  () => import('./pages/PublicPanel'),
  (m) => m.PublicPanelPage,
);
const ResetPage = lazyPage(
  () => import('./pages/Reset'),
  (m) => m.ResetPage,
);
const SettingsPage = lazyPage(
  () => import('./pages/Settings'),
  (m) => m.SettingsPage,
);
const SetupPage = lazyPage(
  () => import('./pages/Setup'),
  (m) => m.SetupPage,
);
const UsersPage = lazyPage(
  () => import('./pages/Users'),
  (m) => m.UsersPage,
);

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
                <Route path="/generators/:id" element={<GeneratorPage />} />
                <Route path="/power" element={<PowerPage />} />
                <Route path="/devices/:id" element={<DevicePage />} />
                <Route path="/equipment" element={<EquipmentListPage />} />
                <Route path="/equipment/:id" element={<EquipmentPage />} />
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
