import { useEffect } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import {
  TAB_SWIPE_MIN_DX,
  adjacentTabPath,
  hasHorizontalScrollAncestor,
  isRootTabPath,
} from '../lib/tabNav';

/**
 * Horizontal swipe between `/` ↔ `/stats` ↔ `/settings` on the main shell.
 * Ignores gestures that begin on a horizontally scrollable ancestor.
 */
export function useTabSwipe(enabled = true): void {
  const navigate = useNavigate();
  const { pathname } = useLocation();

  useEffect(() => {
    if (!enabled || !isRootTabPath(pathname)) return;

    let startX = 0;
    let startY = 0;
    let tracking = false;
    let locked: 'h' | 'v' | null = null;
    let ignore = false;

    const onStart = (e: TouchEvent) => {
      if (e.touches.length !== 1) return;
      const t = e.touches[0]!;
      startX = t.clientX;
      startY = t.clientY;
      tracking = true;
      locked = null;
      ignore = hasHorizontalScrollAncestor(e.target);
    };

    const onMove = (e: TouchEvent) => {
      if (!tracking || ignore || e.touches.length !== 1) return;
      const t = e.touches[0]!;
      const dx = t.clientX - startX;
      const dy = t.clientY - startY;
      if (!locked) {
        if (Math.abs(dx) < 12 && Math.abs(dy) < 12) return;
        locked = Math.abs(dx) > Math.abs(dy) * 1.15 ? 'h' : 'v';
      }
      if (locked !== 'h') return;
      // Prevent pull-to-refresh / browser back-gesture fighting when we own the swipe.
      if (Math.abs(dx) > 24 && e.cancelable) e.preventDefault();
    };

    const onEnd = (e: TouchEvent) => {
      if (!tracking) return;
      tracking = false;
      if (ignore || locked !== 'h') return;
      const t = e.changedTouches[0];
      if (!t) return;
      const dx = t.clientX - startX;
      if (Math.abs(dx) < TAB_SWIPE_MIN_DX) return;
      const direction: -1 | 1 = dx < 0 ? 1 : -1; // swipe left → next tab
      const next = adjacentTabPath(pathname, direction);
      if (next) navigate(next);
    };

    const onCancel = () => {
      tracking = false;
    };

    window.addEventListener('touchstart', onStart, { passive: true });
    window.addEventListener('touchmove', onMove, { passive: false });
    window.addEventListener('touchend', onEnd, { passive: true });
    window.addEventListener('touchcancel', onCancel, { passive: true });
    return () => {
      window.removeEventListener('touchstart', onStart);
      window.removeEventListener('touchmove', onMove);
      window.removeEventListener('touchend', onEnd);
      window.removeEventListener('touchcancel', onCancel);
    };
  }, [enabled, navigate, pathname]);
}
