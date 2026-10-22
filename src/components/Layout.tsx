import { NavLink, Outlet } from 'react-router-dom';
import { useI18n } from '../i18n';
import { useTabBarAutohide } from '../hooks/useTabBarAutohide';
import { useTabSwipe } from '../hooks/useTabSwipe';

export function Layout() {
  const { t } = useI18n();
  const { tabBarVisible } = useTabBarAutohide();
  useTabSwipe(true);

  return (
    <div className={`app-shell${tabBarVisible ? '' : ' tab-bar-hidden'}`}>
      <main className="app-main">
        <Outlet />
      </main>
      <nav className="tab-bar" aria-hidden={!tabBarVisible} inert={!tabBarVisible || undefined}>
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
