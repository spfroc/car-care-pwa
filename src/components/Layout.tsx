import { NavLink, Outlet } from 'react-router-dom';
import { useI18n } from '../i18n';

export function Layout() {
  const { t } = useI18n();
  return (
    <div className="app-shell">
      <main className="app-main">
        <Outlet />
      </main>
      <nav className="tab-bar">
        <NavLink to="/" end className={({ isActive }) => (isActive ? 'tab active' : 'tab')}>
          <span>🏠</span>
          <span>{t('nav.home')}</span>
        </NavLink>
        <NavLink to="/stats" className={({ isActive }) => (isActive ? 'tab active' : 'tab')}>
          <span>📊</span>
          <span>{t('nav.stats')}</span>
        </NavLink>
        <NavLink to="/settings" className={({ isActive }) => (isActive ? 'tab active' : 'tab')}>
          <span>⚙️</span>
          <span>{t('nav.settings')}</span>
        </NavLink>
      </nav>
    </div>
  );
}
