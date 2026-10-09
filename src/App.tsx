import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { Layout } from './components/Layout';
import { HomePage } from './pages/HomePage';
import { VehicleDetailPage } from './pages/VehicleDetailPage';
import { VehicleFormPage } from './pages/VehicleFormPage';
import { RecordFormPage } from './pages/RecordFormPage';
import { SettingsPage } from './pages/SettingsPage';
import { StatsPage } from './pages/StatsPage';
import { useEffect } from 'react';
import { useAppBootstrap, useSettings } from './hooks/useAppData';
import { documentLangFor } from './lib/datetime';

export default function App() {
  const { ready, error, persisted } = useAppBootstrap();
  const { settings } = useSettings();

  useEffect(() => {
    if (settings?.language) {
      document.documentElement.lang = documentLangFor(settings.language);
    }
  }, [settings?.language]);

  if (error) {
    return (
      <div className="fatal">
        <h1>无法打开本地数据库</h1>
        <p>{error}</p>
        <p className="muted">请检查浏览器是否允许 IndexedDB / 是否处于隐私模式配额受限，然后刷新重试。</p>
        <button type="button" className="btn primary" onClick={() => location.reload()}>
          重试
        </button>
      </div>
    );
  }

  if (!ready) {
    return (
      <div className="fatal">
        <p>正在初始化车护助手…</p>
      </div>
    );
  }

  return (
    <BrowserRouter basename="/car-care-pwa">
      {!persisted && (
        <div className="banner">存储持久化未启用，浏览器可能清理数据；请定期导出备份。</div>
      )}
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
