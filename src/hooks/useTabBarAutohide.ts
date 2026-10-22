import { useCallback, useEffect, useRef, useState } from 'react';
import { TAB_BAR_HIDE_DELAY_MS, TAB_BAR_SHOW_SCROLL_PX } from '../lib/tabNav';

/**
 * Hide the bottom tab bar while using the app; show again after a meaningful
 * vertical swipe/scroll (~56px). Once motion stops, hide again after 1000ms.
 */
export function useTabBarAutohide() {
  // Start visible so first paint shows navigation; hide after first idle.
  const [visible, setVisible] = useState(true);
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const accumDy = useRef(0);
  const lastY = useRef<number | null>(null);
  const touching = useRef(false);

  const clearHideTimer = useCallback(() => {
    if (hideTimer.current != null) {
      clearTimeout(hideTimer.current);
      hideTimer.current = null;
    }
  }, []);

  const scheduleHide = useCallback(() => {
    clearHideTimer();
    hideTimer.current = setTimeout(() => {
      setVisible(false);
      hideTimer.current = null;
      accumDy.current = 0;
    }, TAB_BAR_HIDE_DELAY_MS);
  }, [clearHideTimer]);

  const noteVerticalDelta = useCallback(
    (dy: number) => {
      const abs = Math.abs(dy);
      if (abs < 1) return;
      clearHideTimer();
      accumDy.current += abs;
      if (accumDy.current >= TAB_BAR_SHOW_SCROLL_PX) {
        setVisible(true);
        accumDy.current = 0;
      }
    },
    [clearHideTimer],
  );

  useEffect(() => {
    // Initial: briefly show, then hide so immersive default kicks in.
    const boot = setTimeout(() => setVisible(false), TAB_BAR_HIDE_DELAY_MS);
    return () => clearTimeout(boot);
  }, []);

  useEffect(() => {
    const onTouchStart = (e: TouchEvent) => {
      if (e.touches.length !== 1) return;
      touching.current = true;
      lastY.current = e.touches[0]!.clientY;
      accumDy.current = 0;
      clearHideTimer();
    };

    const onTouchMove = (e: TouchEvent) => {
      if (!touching.current || e.touches.length !== 1 || lastY.current == null) return;
      const y = e.touches[0]!.clientY;
      noteVerticalDelta(y - lastY.current);
      lastY.current = y;
    };

    const onTouchEnd = () => {
      touching.current = false;
      lastY.current = null;
      scheduleHide();
    };

    let lastScrollY = window.scrollY;
    const onScroll = () => {
      const y = window.scrollY;
      noteVerticalDelta(y - lastScrollY);
      lastScrollY = y;
      // While scrolling (wheel / programmatic), keep resetting the hide timer
      // via noteVerticalDelta's clear; schedule hide when scroll quiets.
      if (!touching.current) {
        scheduleHide();
      }
    };

    window.addEventListener('touchstart', onTouchStart, { passive: true });
    window.addEventListener('touchmove', onTouchMove, { passive: true });
    window.addEventListener('touchend', onTouchEnd, { passive: true });
    window.addEventListener('touchcancel', onTouchEnd, { passive: true });
    window.addEventListener('scroll', onScroll, { passive: true });

    return () => {
      clearHideTimer();
      window.removeEventListener('touchstart', onTouchStart);
      window.removeEventListener('touchmove', onTouchMove);
      window.removeEventListener('touchend', onTouchEnd);
      window.removeEventListener('touchcancel', onTouchEnd);
      window.removeEventListener('scroll', onScroll);
    };
  }, [clearHideTimer, noteVerticalDelta, scheduleHide]);

  return { tabBarVisible: visible };
}
