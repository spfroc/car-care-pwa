import { useLayoutEffect, useRef, type RefObject } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import {
  applyTabSwipeFrame,
  commitDurationMs,
  createCommitAnimator,
  createSpringAnimator,
  tabSwipeReleasePlan,
  visualDragOffset,
} from '../lib/tabSwipeMotion';
import {
  ROOT_TAB_PATHS,
  adjacentTabPath,
  hasHorizontalScrollAncestor,
  rootTabIndex,
} from '../lib/tabNav';

/**
 * Follow-the-finger slide + crossfade between `/` ↔ `/stats` ↔ `/settings`.
 * Transforms are written on the pane nodes (no gesture library). End tabs
 * rubber-band to about one-third of the stage and spring back.
 * Ignores gestures that begin on a horizontally scrollable ancestor.
 *
 * The stage owns `.tab-edge-wash` and one `.tab-pane` per root tab, in order.
 */
export function useTabSwipe(enabled: boolean, stageRef: RefObject<HTMLElement | null>): void {
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const navigateRef = useRef(navigate);
  const pathnameRef = useRef(pathname);
  const seenPathRef = useRef<string | null>(null);
  const prevIndexRef = useRef<number | null>(null);
  const offsetRef = useRef(0);
  const gesturingRef = useRef(false);
  const skipRouteMotionRef = useRef(false);
  const animTokenRef = useRef(0);
  const animatingRef = useRef(false);
  const apiRef = useRef({
    apply: () => {},
    cancelAnim: () => {},
    startAnim: (_animator: { step: (dtMs: number) => { x: number; done: boolean } }, _onDone?: () => void) => {},
  });

  const apply = () => {
    const stage = stageRef.current;
    const width = stage?.clientWidth ?? 0;
    const parts = readStageParts(stage);
    applyTabSwipeFrame({
      panes: parts.panes,
      wash: parts.wash,
      stage,
      index: rootTabIndex(pathnameRef.current),
      offsetX: offsetRef.current,
      width,
      gesturing: gesturingRef.current,
    });
  };

  const cancelAnim = () => {
    animTokenRef.current += 1;
    animatingRef.current = false;
  };

  const startAnim = (
    animator: { step: (dtMs: number) => { x: number; done: boolean } },
    onDone?: () => void,
  ) => {
    const token = ++animTokenRef.current;
    animatingRef.current = true;
    gesturingRef.current = true;
    let last: number | null = null;
    let frames = 0;
    const frame = (now: number) => {
      if (token !== animTokenRef.current) return;
      if (last == null) {
        last = now;
        requestAnimationFrame(frame);
        return;
      }
      frames += 1;
      const dt = Math.min(48, now - last);
      last = now;
      const tick = animator.step(dt);
      offsetRef.current = tick.x;
      apply();
      if (tick.done || frames > 120) {
        animatingRef.current = false;
        if (token === animTokenRef.current) onDone?.();
        return;
      }
      requestAnimationFrame(frame);
    };
    requestAnimationFrame(frame);
  };

  useLayoutEffect(() => {
    navigateRef.current = navigate;
    pathnameRef.current = pathname;
    apiRef.current.apply = apply;
    apiRef.current.cancelAnim = cancelAnim;
    apiRef.current.startAnim = startAnim;
  });

  useLayoutEffect(() => {
    if (!enabled) return;
    const stage = stageRef.current;
    if (!stage) return;

    let suppressClick = false;
    let suppressTimer = 0;
    const armSuppressClick = () => {
      suppressClick = true;
      window.clearTimeout(suppressTimer);
      // Swallow the ghost click that follows a swipe, then expire so a later tap still lands.
      suppressTimer = window.setTimeout(() => {
        suppressClick = false;
      }, 400);
    };
    let tracking = false;
    let locked: 'h' | 'v' | null = null;
    let ignore = false;
    let startX = 0;
    let startY = 0;
    let originOffset = 0;
    let lastOffset = 0;
    let lastT = 0;
    let velocity = 0;

    const reduced = () => {
      if (typeof window.matchMedia !== 'function') return false;
      return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    };

    const finishRelease = (fingerDx: number) => {
      const width = stage.clientWidth;
      const index = rootTabIndex(pathnameRef.current);
      const reducedMotion = reduced();
      const offsetX = reducedMotion ? fingerDx : offsetRef.current;
      const plan = tabSwipeReleasePlan({
        offsetX,
        velocityX: velocity,
        index,
        tabCount: ROOT_TAB_PATHS.length,
      });
      if (Math.abs(fingerDx) > 8 || Math.abs(offsetRef.current) > 8) armSuppressClick();

      if (plan.action === 'commit') {
        const next = adjacentTabPath(pathnameRef.current, plan.direction);
        if (next && (reducedMotion || !(width > 0))) {
          apiRef.current.cancelAnim();
          skipRouteMotionRef.current = true;
          offsetRef.current = 0;
          gesturingRef.current = false;
          navigateRef.current(next);
          return;
        }
        if (next && width > 0) {
          const target = plan.direction === 1 ? -width : width;
          const from = offsetRef.current;
          apiRef.current.startAnim(createCommitAnimator(from, target, commitDurationMs(from, target, width)), () => {
            skipRouteMotionRef.current = true;
            offsetRef.current = target;
            navigateRef.current(next);
          });
          return;
        }
      }

      if (reducedMotion || !(width > 0) || offsetRef.current === 0) {
        apiRef.current.cancelAnim();
        offsetRef.current = 0;
        gesturingRef.current = false;
        apiRef.current.apply();
        return;
      }
      const from = offsetRef.current;
      const edge = from > 0 ? index <= 0 : index >= ROOT_TAB_PATHS.length - 1;
      const clamp = edge ? (from > 0 ? { min: 0 } : { max: 0 }) : undefined;
      apiRef.current.startAnim(createSpringAnimator(from, 0, velocity, clamp), () => {
        gesturingRef.current = false;
        offsetRef.current = 0;
        apiRef.current.apply();
      });
    };

    const onStart = (e: TouchEvent) => {
      if (e.touches.length !== 1) return;
      const t = e.touches[0]!;
      apiRef.current.cancelAnim();
      startX = t.clientX;
      startY = t.clientY;
      originOffset = offsetRef.current;
      lastOffset = originOffset;
      lastT = performance.now();
      velocity = 0;
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
        if (locked === 'h') gesturingRef.current = true;
      }
      if (locked !== 'h') return;
      if (e.cancelable) e.preventDefault();
      const width = stage.clientWidth;
      const index = rootTabIndex(pathnameRef.current);
      if (reduced()) return;
      const visual = visualDragOffset(originOffset + dx, width, index, ROOT_TAB_PATHS.length);
      const now = performance.now();
      const dt = now - lastT;
      if (dt > 0) velocity = (visual.offset - lastOffset) / dt;
      lastOffset = visual.offset;
      lastT = now;
      offsetRef.current = visual.offset;
      apiRef.current.apply();
    };

    const onEnd = (e: TouchEvent) => {
      if (!tracking) return;
      tracking = false;
      const t = e.changedTouches[0];
      const fingerDx = t ? t.clientX - startX : 0;
      if (ignore || locked !== 'h') {
        gesturingRef.current = false;
        apiRef.current.apply();
        return;
      }
      finishRelease(fingerDx);
    };

    const onCancel = () => {
      if (!tracking) return;
      tracking = false;
      if (ignore || locked !== 'h') {
        gesturingRef.current = false;
        apiRef.current.apply();
        return;
      }
      finishRelease(0);
    };

    const onClick = (e: MouseEvent) => {
      if (!suppressClick) return;
      suppressClick = false;
      e.preventDefault();
      e.stopPropagation();
    };

    let lastWidth = stage.clientWidth;
    const ro =
      typeof ResizeObserver !== 'undefined'
        ? new ResizeObserver(() => {
            const next = stage.clientWidth;
            if (Math.abs(next - lastWidth) < 1) return;
            lastWidth = next;
            if (animatingRef.current || tracking) {
              apiRef.current.cancelAnim();
              offsetRef.current = 0;
              gesturingRef.current = false;
            }
            apiRef.current.apply();
          })
        : null;
    ro?.observe(stage);

    window.addEventListener('touchstart', onStart, { passive: true });
    window.addEventListener('touchmove', onMove, { passive: false });
    window.addEventListener('touchend', onEnd, { passive: true });
    window.addEventListener('touchcancel', onCancel, { passive: true });
    window.addEventListener('click', onClick, true);
    return () => {
      animTokenRef.current += 1;
      animatingRef.current = false;
      window.clearTimeout(suppressTimer);
      ro?.disconnect();
      window.removeEventListener('touchstart', onStart);
      window.removeEventListener('touchmove', onMove);
      window.removeEventListener('touchend', onEnd);
      window.removeEventListener('touchcancel', onCancel);
      window.removeEventListener('click', onClick, true);
    };
    // pathname/navigate are mirrored into refs so a route change does not drop
    // an in-flight touch. stageRef is the pager's stable ref.
  }, [enabled, stageRef]);

  useLayoutEffect(() => {
    if (!enabled) return;
    const index = rootTabIndex(pathname);
    const pathChanged = seenPathRef.current !== pathname;
    seenPathRef.current = pathname;

    if (!pathChanged) {
      apiRef.current.apply();
      return;
    }

    apiRef.current.cancelAnim();
    if (skipRouteMotionRef.current) {
      skipRouteMotionRef.current = false;
      prevIndexRef.current = index;
      offsetRef.current = 0;
      gesturingRef.current = false;
      apiRef.current.apply();
      return;
    }

    const prev = prevIndexRef.current;
    prevIndexRef.current = index;
    const width = stageRef.current?.clientWidth ?? 0;
    const reduced =
      typeof window.matchMedia === 'function' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (prev != null && prev !== index && index >= 0 && !reduced && width > 0) {
      const start = (index - prev) * width;
      offsetRef.current = start;
      gesturingRef.current = true;
      apiRef.current.apply();
      apiRef.current.startAnim(createCommitAnimator(start, 0, commitDurationMs(start, 0, width)), () => {
        gesturingRef.current = false;
        offsetRef.current = 0;
        apiRef.current.apply();
      });
      return;
    }

    offsetRef.current = 0;
    gesturingRef.current = false;
    apiRef.current.apply();
  });
}

function readStageParts(stage: HTMLElement | null): {
  panes: Array<HTMLElement | null>;
  wash: HTMLElement | null;
} {
  const panes: Array<HTMLElement | null> = ROOT_TAB_PATHS.map(() => null);
  if (!stage) return { panes, wash: null };
  let wash: HTMLElement | null = null;
  for (const child of Array.from(stage.children)) {
    if (!(child instanceof HTMLElement)) continue;
    if (child.classList.contains('tab-edge-wash')) {
      wash = child;
      continue;
    }
    if (!child.classList.contains('tab-pane')) continue;
    const index = ROOT_TAB_PATHS.indexOf(child.dataset.tab as (typeof ROOT_TAB_PATHS)[number]);
    if (index >= 0) panes[index] = child;
  }
  return { panes, wash };
}
