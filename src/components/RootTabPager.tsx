import { useLayoutEffect, useRef, useState, type ReactElement } from 'react';
import { HomePage } from '../pages/HomePage';
import { SettingsPage } from '../pages/SettingsPage';
import { StatsPage } from '../pages/StatsPage';
import { useTabSwipe } from '../hooks/useTabSwipe';
import { ROOT_TAB_PATHS, type RootTabPath } from '../lib/tabNav';
import { TabPanePortalContext } from './tabPanePortal';

const PAGES: Record<RootTabPath, () => ReactElement> = {
  '/': () => <HomePage />,
  '/stats': () => <StatsPage />,
  '/settings': () => <SettingsPage />,
};

/**
 * Keeps the three root tabs mounted so a swipe can slide and crossfade
 * between real pages. Nested routes unmount this pager and use `<Outlet />`.
 */
export function RootTabPager() {
  const stageRef = useRef<HTMLDivElement>(null);
  useTabSwipe(true, stageRef);

  return (
    <div className="tab-stage" ref={stageRef}>
      <div className="tab-edge-wash" aria-hidden="true" />
      {ROOT_TAB_PATHS.map((path) => (
        <TabPane key={path} path={path} />
      ))}
    </div>
  );
}

function TabPane({ path }: { path: RootTabPath }) {
  const elRef = useRef<HTMLDivElement>(null);
  const [portalEl, setPortalEl] = useState<HTMLDivElement | null>(null);
  const Page = PAGES[path];

  useLayoutEffect(() => {
    setPortalEl(elRef.current);
  }, []);

  return (
    <div className="tab-pane" data-tab={path} ref={elRef}>
      <TabPanePortalContext.Provider value={portalEl}>
        <div className="tab-pane-scroll">
          <Page />
        </div>
      </TabPanePortalContext.Provider>
    </div>
  );
}
