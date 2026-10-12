import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { Layout } from './components/Layout';
import { HomePage } from './pages/HomePage';
import { VehicleDetailPage } from './pages/VehicleDetailPage';
import { VehicleFormPage } from './pages/VehicleFormPage';
import { RecordFormPage } from './pages/RecordFormPage';
import { SettingsPage } from './pages/SettingsPage';
import { StatsPage } from './pages/StatsPage';
import { useAppBootstrap } from './hooks/useAppData';
import { AppDataProvider } from './i18n';
import { PwaInstallBanner } from './components/PwaInstallBanner';
import { translate } from './i18n/messages';
import { useEffect } from 'react';
import { installSyncLifecycle } from './sync/syncLifecycle';

function AppRoutes({ persisted }: { persisted: boolean }) {
  return (
    <BrowserRouter basename={import.meta.env.BASE_URL.replace(/\/$/, '') || '/'}>
      <PwaInstallBanner persisted={persisted} />
      <Routes>
        <Route element={<Layout />}>
          <Route path="/" element={<HomePage />} />
          <Route path="/stats" element={<StatsPage />} />
          <Route path="/settings" element={<SettingsPage />} />
          <Route path="/vehicles/new" element={<VehicleFormPage />} />
          <Route path="/vehicles/:id" element={<VehicleDetailPage />} />
          <Route path="/vehicles/:id/edit" element={<VehicleFormPage />} />
          <Route path="/vehicles/:vehicleId/records/new/:type" element={<RecordFormPage />} />
          <Route path="/vehicles/:vehicleId/records/:recordId" element={<RecordFormPage />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Route>
      </Routes>
    </BrowserRouter>
  );
}

export default function App() {
  const { ready, error, persisted } = useAppBootstrap();

  useEffect(() => {
    if (!ready || error) return;
    const { stop } = installSyncLifecycle();
    return stop;
  }, [ready, error]);

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

  if (!ready) {
    return (
      <div className="fatal">
        <p>{translate('zh-CN', 'app.init')}</p>
      </div>
    );
  }

  return (
    <AppDataProvider>
      <AppRoutes persisted={persisted} />
    </AppDataProvider>
  );
}
