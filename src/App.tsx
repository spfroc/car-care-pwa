import { Suspense, useEffect, type ReactNode } from 'react';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { Layout } from './components/Layout';
import { AppDataProvider, useAppData } from './i18n';
import { PwaInstallBanner } from './components/PwaInstallBanner';
import { translate } from './i18n/messages';
import {
  RecordFormPage,
  VehicleDetailPage,
  VehicleFormPage,
} from './routes/lazyPages';

function RouteFallback() {
  const { t } = useAppData();
  return (
    <div className="page">
      <p className="muted">{t('app.loading')}</p>
    </div>
  );
}

function LazyPage({ children }: { children: ReactNode }) {
  return <Suspense fallback={<RouteFallback />}>{children}</Suspense>;
}

function SyncLifecycleHost() {
  const { dbReady, error } = useAppData();

  useEffect(() => {
    if (!dbReady || error) return;
    let stop = () => {};
    let cancelled = false;
    void import('./sync/syncLifecycle').then((m) => {
      if (cancelled) return;
      stop = m.installSyncLifecycle().stop;
    });
    return () => {
      cancelled = true;
      stop();
    };
  }, [dbReady, error]);

  return null;
}

function AppRoutes({ persisted }: { persisted: boolean }) {
  return (
    <BrowserRouter basename={import.meta.env.BASE_URL.replace(/\/$/, '') || '/'}>
      <PwaInstallBanner persisted={persisted} />
      <SyncLifecycleHost />
      <Routes>
        <Route element={<Layout />}>
          <Route path="/" element={null} />
          <Route path="/stats" element={null} />
          <Route path="/settings" element={null} />
          <Route
            path="/vehicles/new"
            element={
              <LazyPage>
                <VehicleFormPage />
              </LazyPage>
            }
          />
          <Route
            path="/vehicles/:id"
            element={
              <LazyPage>
                <VehicleDetailPage />
              </LazyPage>
            }
          />
          <Route
            path="/vehicles/:id/edit"
            element={
              <LazyPage>
                <VehicleFormPage />
              </LazyPage>
            }
          />
          <Route
            path="/vehicles/:vehicleId/records/new/:type"
            element={
              <LazyPage>
                <RecordFormPage />
              </LazyPage>
            }
          />
          <Route
            path="/vehicles/:vehicleId/records/:recordId"
            element={
              <LazyPage>
                <RecordFormPage />
              </LazyPage>
            }
          />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Route>
      </Routes>
    </BrowserRouter>
  );
}

function BootstrappedApp() {
  const { error, persisted } = useAppData();

  if (error) {
    return (
      <div className="fatal">
        <h1>{translate('zh-CN', 'app.dbFatalTitle')}</h1>
        <p>{error}</p>
        <p className="muted">{translate('zh-CN', 'app.dbFatalHint')}</p>
        <button type="button" className="btn primary" onClick={() => location.reload()}>
          {translate('zh-CN', 'app.retry')}
        </button>
      </div>
    );
  }

  return <AppRoutes persisted={persisted} />;
}

export default function App() {
  return (
    <AppDataProvider>
      <BootstrappedApp />
    </AppDataProvider>
  );
}
