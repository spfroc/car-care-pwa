import { Suspense, useEffect, useLayoutEffect, useRef, useState, type ReactElement } from 'react';
import { useLocation } from 'react-router-dom';
import { HomePage } from '../pages/HomePage';
import { SettingsPage, StatsPage, preloadRootTab } from '../routes/lazyPages';
import { useTabSwipe } from '../hooks/useTabSwipe';
import { useAppData } from '../i18n';
import {
  ROOT_TAB_PATHS,
  hasHorizontalScrollAncestor,
  isRootTabPath,
  neighborRootTabs,
  normalizePath,
  type RootTabPath,
} from '../lib/tabNav';
import { TabPanePortalContext } from './tabPanePortal';

const PAGES: Record<RootTabPath, () => ReactElement> = {
  '/': () => <HomePage />,
  '/stats': () => <StatsPage />,
  '/settings': () => <SettingsPage />,
};

/**
 * Keeps visited root tabs mounted so a swipe can slide between real pages.
 * Stats and Settings stay out of the first paint: their chunks mount when the
 * route is that tab, or when a horizontal swipe toward them starts.
 * Nested routes unmount this pager and use `<Outlet />`.
 */
export function RootTabPager() {
  const { t } = useAppData();
  const { pathname } = useLocation();
  const active = normalizePath(pathname);
  const stageRef = useRef<HTMLDivElement>(null);
  const activeRef = useRef(active);
  const [warm, setWarm] = useState<ReadonlySet<string>>(() => new Set());
  useTabSwipe(true, stageRef);

  useLayoutEffect(() => {
    activeRef.current = active;
  }, [active]);

  useEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;
    let sx = 0;
    let sy = 0;
    let tracking = false;
    let ignore = false;

    const arm = () => {
      const path = activeRef.current;
      if (!isRootTabPath(path)) return;
      const neighbors = neighborRootTabs(path);
      for (const n of neighbors) preloadRootTab(n);
      setWarm((prev) => {
        let changed = false;
        const next = new Set(prev);
        for (const n of neighbors) {
          if (!next.has(n)) {
            next.add(n);
            changed = true;
          }
        }
        return changed ? next : prev;
      });
    };

    const onStart = (e: TouchEvent) => {
      if (e.touches.length !== 1) return;
      const target = e.target;
      if (!(target instanceof Node) || !stage.contains(target)) return;
      sx = e.touches[0]!.clientX;
      sy = e.touches[0]!.clientY;
      tracking = true;
      ignore = hasHorizontalScrollAncestor(e.target);
    };
    const onMove = (e: TouchEvent) => {
      if (!tracking || ignore || e.touches.length !== 1) return;
      const dx = e.touches[0]!.clientX - sx;
      const dy = e.touches[0]!.clientY - sy;
      if (Math.abs(dx) < 12 && Math.abs(dy) < 12) return;
      tracking = false;
      if (Math.abs(dx) > Math.abs(dy) * 1.15) arm();
    };
    const onEnd = () => {
      tracking = false;
    };

    window.addEventListener('touchstart', onStart, { passive: true });
    window.addEventListener('touchmove', onMove, { passive: true });
    window.addEventListener('touchend', onEnd, { passive: true });
    window.addEventListener('touchcancel', onEnd, { passive: true });
    return () => {
      window.removeEventListener('touchstart', onStart);
      window.removeEventListener('touchmove', onMove);
      window.removeEventListener('touchend', onEnd);
      window.removeEventListener('touchcancel', onEnd);
    };
  }, []);

  return (
    <div className="tab-stage" ref={stageRef}>
      <div className="tab-edge-wash" aria-hidden="true" />
      {ROOT_TAB_PATHS.map((path) => (
        <TabPane
          key={path}
          path={path}
          show={path === active || warm.has(path)}
          loadingLabel={t('app.loading')}
        />
      ))}
    </div>
  );
}

function TabPane({
  path,
  show,
  loadingLabel,
}: {
  path: RootTabPath;
  show: boolean;
  loadingLabel: string;
}) {
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
          {show ? (
            <Suspense
              fallback={
                <div className="page">
                  <p className="muted">{loadingLabel}</p>
                </div>
              }
            >
              <Page />
            </Suspense>
          ) : null}
        </div>
      </TabPanePortalContext.Provider>
    </div>
  );
}
