import { TAB_SWIPE_MIN_DX } from './tabNav';

/** End tabs resist once the page has traveled this fraction of the viewport. */
export const TAB_EDGE_LIMIT_RATIO = 1 / 3;

/**
 * Past the 1/3 limit, extra finger travel only adds this fraction of the limit.
 * The page therefore stays near one-third of the screen.
 */
export const TAB_EDGE_STRETCH_RATIO = 0.12;

/** Fast flicks commit even when they have not crossed {@link TAB_SWIPE_MIN_DX}. */
export const TAB_SWIPE_FLICK_VX = 0.65;
export const TAB_SWIPE_FLICK_MIN_DX = 24;

export type TabEdgeSide = 'left' | 'right';

/**
 * Map a raw finger delta onto the page offset.
 * Toward a neighbor the page follows 1:1, clamped to one viewport.
 * Toward an end (no neighbor) it follows 1:1 until ~1/3 of the width, then resists.
 * Positive offset moves the current page to the right.
 */
export function visualDragOffset(
  dx: number,
  viewportWidth: number,
  index: number,
  tabCount: number,
): { offset: number; edge: TabEdgeSide | null } {
  if (!(viewportWidth > 0) || index < 0) return { offset: 0, edge: null };
  if (dx > 0 && index <= 0) {
    return { offset: rubberBandDistance(dx, viewportWidth), edge: 'left' };
  }
  if (dx < 0 && index >= tabCount - 1) {
    return { offset: -rubberBandDistance(-dx, viewportWidth), edge: 'right' };
  }
  const clamped = Math.max(-viewportWidth, Math.min(viewportWidth, dx));
  return { offset: clamped, edge: null };
}

/** Distance after the end-tab resistance curve. `distance` is ≥ 0. */
export function rubberBandDistance(distance: number, viewportWidth: number): number {
  if (!(viewportWidth > 0) || !(distance > 0)) return 0;
  const limit = viewportWidth * TAB_EDGE_LIMIT_RATIO;
  if (distance <= limit) return distance;
  const extra = distance - limit;
  const maxStretch = limit * TAB_EDGE_STRETCH_RATIO;
  const softness = limit * 0.45;
  return limit + maxStretch * (1 - Math.exp(-extra / softness));
}

export function edgeForOffset(
  index: number,
  offsetX: number,
  tabCount: number,
): TabEdgeSide | null {
  if (offsetX > 0.5 && index <= 0) return 'left';
  if (offsetX < -0.5 && index >= tabCount - 1) return 'right';
  return null;
}

/**
 * Commit direction from the current offset.
 * `1` = next tab (content moved left), `-1` = previous tab, `0` = cancel.
 * `velocityX` is px/ms of that same offset (negative when moving toward the next tab).
 */
export function shouldCommitTabSwipe(offsetX: number, velocityX: number): -1 | 0 | 1 {
  const towardNext = offsetX < 0;
  const mag = Math.abs(offsetX);
  const velAgrees = towardNext ? velocityX <= -TAB_SWIPE_FLICK_VX : velocityX >= TAB_SWIPE_FLICK_VX;
  if (mag >= TAB_SWIPE_MIN_DX) return towardNext ? 1 : -1;
  if (mag >= TAB_SWIPE_FLICK_MIN_DX && velAgrees) return towardNext ? 1 : -1;
  return 0;
}

export function tabSwipeReleasePlan(args: {
  offsetX: number;
  velocityX: number;
  index: number;
  tabCount: number;
}): { action: 'commit'; direction: -1 | 1 } | { action: 'spring-back' } {
  const { offsetX, velocityX, index, tabCount } = args;
  if (index < 0 || edgeForOffset(index, offsetX, tabCount)) return { action: 'spring-back' };
  const dir = shouldCommitTabSwipe(offsetX, velocityX);
  if (dir === 1 && index < tabCount - 1) return { action: 'commit', direction: 1 };
  if (dir === -1 && index > 0) return { action: 'commit', direction: -1 };
  return { action: 'spring-back' };
}

/** Pixel x of a pane relative to the stage. */
export function paneShiftPx(
  paneIndex: number,
  activeIndex: number,
  viewportWidth: number,
  offsetX: number,
): number {
  return (paneIndex - activeIndex) * viewportWidth + offsetX;
}

/**
 * Crossfade. End-tab drags keep the current page opaque so the gap reads as
 * the blurred wash instead of a faded page.
 */
export function paneOpacity(args: {
  shiftPx: number;
  viewportWidth: number;
  edge: TabEdgeSide | null;
  isActive: boolean;
}): number {
  const { shiftPx, viewportWidth, edge, isActive } = args;
  if (!(viewportWidth > 0)) return isActive ? 1 : 0;
  if (edge) return isActive ? 1 : 0;
  const t = Math.min(1, Math.abs(shiftPx) / viewportWidth);
  return 1 - t;
}

export function commitDurationMs(from: number, to: number, viewportWidth: number): number {
  const dist = Math.abs(to - from);
  const span = viewportWidth > 0 ? viewportWidth : dist || 1;
  const ratio = Math.min(1, dist / span);
  return 160 + ratio * 180;
}

export type MotionTick = { x: number; done: boolean };

/** Ease-out glide used to finish a committed page change. No overshoot. */
export function createCommitAnimator(from: number, to: number, durationMs: number) {
  let elapsed = 0;
  const duration = Math.max(1, durationMs);
  return {
    step(dtMs: number): MotionTick {
      elapsed += Math.max(0, dtMs);
      const t = Math.min(1, elapsed / duration);
      const eased = 1 - (1 - t) ** 3;
      const x = from + (to - from) * eased;
      if (t >= 1) return { x: to, done: true };
      return { x, done: false };
    },
  };
}

/**
 * Release spring. `velocityPxPerMs` uses the same sign as offset
 * (negative = moving toward the next tab). Optional clamps stop an end-tab
 * return from sliding into the neighbor.
 */
export function createSpringAnimator(
  from: number,
  to: number,
  velocityPxPerMs: number,
  clamp?: { min?: number; max?: number },
) {
  let x = from;
  let v = velocityPxPerMs * 1000;
  let elapsed = 0;
  const stiffness = 480;
  const damping = 38;
  const maxMs = 700;
  return {
    step(dtMs: number): MotionTick {
      const frame = Math.min(34, Math.max(0, dtMs));
      elapsed += frame;
      const dt = frame / 1000;
      if (dt > 0) {
        const a = -stiffness * (x - to) - damping * v;
        v += a * dt;
        x += v * dt;
      }
      if (clamp?.min != null && x < clamp.min) {
        x = clamp.min;
        v = 0;
      }
      if (clamp?.max != null && x > clamp.max) {
        x = clamp.max;
        v = 0;
      }
      const settled = Math.abs(x - to) < 0.6 && Math.abs(v) < 40;
      if (settled || elapsed >= maxMs) return { x: to, done: true };
      return { x, done: false };
    },
  };
}

export function applyTabSwipeFrame(args: {
  panes: Array<HTMLElement | null>;
  wash: HTMLElement | null;
  stage: HTMLElement | null;
  index: number;
  offsetX: number;
  width: number;
  gesturing: boolean;
}): void {
  const { panes, wash, stage, index, offsetX, width, gesturing } = args;
  const tabCount = panes.length;
  const edge = width > 0 ? edgeForOffset(index, offsetX, tabCount) : null;

  panes.forEach((el, i) => {
    if (!el) return;
    const shift = width > 0 ? paneShiftPx(i, index, width, offsetX) : 0;
    const opacity = paneOpacity({
      shiftPx: shift,
      viewportWidth: width,
      edge,
      isActive: i === index,
    });
    el.style.transform = width > 0 ? `translate3d(${shift}px, 0, 0)` : 'translate3d(0, 0, 0)';
    el.style.opacity = String(opacity);
    const interactive = i === index && !gesturing && opacity > 0.99;
    el.style.pointerEvents = interactive ? '' : 'none';
    el.style.willChange = gesturing ? 'transform, opacity' : '';
    el.setAttribute('aria-hidden', interactive ? 'false' : 'true');
    el.toggleAttribute('inert', !interactive);
    if (i === index) el.dataset.active = 'true';
    else delete el.dataset.active;
  });

  if (wash) {
    const show = edge != null && Math.abs(offsetX) > 0.5;
    wash.style.opacity = show ? '1' : '0';
    wash.style.visibility = show ? 'visible' : 'hidden';
    wash.style.transform = edge === 'right' ? 'scale(1.15) scaleX(-1)' : 'scale(1.15)';
  }

  if (stage) {
    stage.dataset.offset = offsetX.toFixed(2);
    if (edge) stage.dataset.edge = edge;
    else delete stage.dataset.edge;
    stage.style.userSelect = gesturing ? 'none' : '';
  }
}
