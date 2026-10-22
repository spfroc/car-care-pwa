import { describe, expect, it } from 'vitest';
import { TAB_SWIPE_MIN_DX } from './tabNav';
import {
  TAB_EDGE_LIMIT_RATIO,
  commitDurationMs,
  createCommitAnimator,
  createSpringAnimator,
  edgeForOffset,
  paneOpacity,
  paneShiftPx,
  rubberBandDistance,
  shouldCommitTabSwipe,
  tabSwipeReleasePlan,
  visualDragOffset,
} from './tabSwipeMotion';

const W = 390;

describe('visualDragOffset', () => {
  it('follows the finger toward a neighbor and stops at one page', () => {
    expect(visualDragOffset(-80, W, 0, 3)).toEqual({ offset: -80, edge: null });
    expect(visualDragOffset(-900, W, 0, 3)).toEqual({ offset: -W, edge: null });
    expect(visualDragOffset(120, W, 1, 3).edge).toBeNull();
    expect(visualDragOffset(-120, W, 1, 3).edge).toBeNull();
  });

  it('tracks the finger until one-third of the width on an end tab, then resists', () => {
    const limit = W * TAB_EDGE_LIMIT_RATIO;
    expect(visualDragOffset(limit, W, 0, 3)).toEqual({ offset: limit, edge: 'left' });
    expect(visualDragOffset(-limit, W, 2, 3)).toEqual({ offset: -limit, edge: 'right' });

    const past = visualDragOffset(limit + W, W, 0, 3);
    expect(past.edge).toBe('left');
    expect(past.offset).toBeGreaterThan(limit);
    expect(past.offset).toBeLessThan(limit * 1.12);
    const extraFinger = W;
    const extraVisual = past.offset - limit;
    expect(extraVisual).toBeLessThan(extraFinger * 0.2);

    const right = visualDragOffset(-(limit + 220), W, 2, 3);
    expect(right.edge).toBe('right');
    expect(right.offset).toBeLessThan(-limit);
    expect(Math.abs(right.offset)).toBeLessThan(limit * 1.12);
  });
});

describe('rubberBandDistance', () => {
  it('is linear up to the limit and asymptotic after it', () => {
    const limit = 100;
    const width = limit / TAB_EDGE_LIMIT_RATIO;
    expect(rubberBandDistance(0, width)).toBe(0);
    expect(rubberBandDistance(40, width)).toBe(40);
    expect(rubberBandDistance(limit, width)).toBe(limit);
    const far = rubberBandDistance(limit + 5000, width);
    expect(far).toBeGreaterThan(limit);
    expect(far).toBeLessThanOrEqual(limit * 1.12 + 0.001);
  });
});

describe('shouldCommitTabSwipe', () => {
  it('uses the existing distance threshold and a fast flick', () => {
    expect(shouldCommitTabSwipe(-TAB_SWIPE_MIN_DX, 0)).toBe(1);
    expect(shouldCommitTabSwipe(TAB_SWIPE_MIN_DX, 0)).toBe(-1);
    expect(shouldCommitTabSwipe(-(TAB_SWIPE_MIN_DX - 1), 0)).toBe(0);
    expect(shouldCommitTabSwipe(-30, -0.7)).toBe(1);
    expect(shouldCommitTabSwipe(30, 0.7)).toBe(-1);
    expect(shouldCommitTabSwipe(-30, -0.1)).toBe(0);
  });
});

describe('tabSwipeReleasePlan', () => {
  it('springs back on an end tab even when the drag is long', () => {
    expect(tabSwipeReleasePlan({ offsetX: 140, velocityX: 1, index: 0, tabCount: 3 }).action).toBe(
      'spring-back',
    );
    expect(
      tabSwipeReleasePlan({ offsetX: -140, velocityX: -1, index: 2, tabCount: 3 }).action,
    ).toBe('spring-back');
  });

  it('commits only when a neighbor exists', () => {
    expect(tabSwipeReleasePlan({ offsetX: -80, velocityX: 0, index: 0, tabCount: 3 })).toEqual({
      action: 'commit',
      direction: 1,
    });
    expect(tabSwipeReleasePlan({ offsetX: 80, velocityX: 0, index: 2, tabCount: 3 })).toEqual({
      action: 'commit',
      direction: -1,
    });
    expect(tabSwipeReleasePlan({ offsetX: -20, velocityX: 0, index: 1, tabCount: 3 }).action).toBe(
      'spring-back',
    );
  });
});

describe('pane placement', () => {
  it('slides the neighbor in from the side and crossfades', () => {
    expect(paneShiftPx(0, 0, W, -40)).toBe(-40);
    expect(paneShiftPx(1, 0, W, -40)).toBe(W - 40);
    expect(paneOpacity({ shiftPx: 0, viewportWidth: W, edge: null, isActive: true })).toBe(1);
    expect(paneOpacity({ shiftPx: W / 2, viewportWidth: W, edge: null, isActive: false })).toBeCloseTo(
      0.5,
    );
    expect(paneOpacity({ shiftPx: 40, viewportWidth: W, edge: 'left', isActive: true })).toBe(1);
    expect(paneOpacity({ shiftPx: W, viewportWidth: W, edge: 'left', isActive: false })).toBe(0);
  });

  it('reports the empty side only while an end tab is pulled outward', () => {
    expect(edgeForOffset(0, 12, 3)).toBe('left');
    expect(edgeForOffset(2, -12, 3)).toBe('right');
    expect(edgeForOffset(0, -12, 3)).toBeNull();
    expect(edgeForOffset(1, 12, 3)).toBeNull();
  });
});

describe('animators', () => {
  it('glides a commit to the target without passing it', () => {
    const anim = createCommitAnimator(-40, -W, commitDurationMs(-40, -W, W));
    let x = -40;
    let done = false;
    for (let i = 0; i < 40 && !done; i++) {
      const tick = anim.step(32);
      x = tick.x;
      done = tick.done;
      expect(x).toBeLessThanOrEqual(-40 + 0.001);
      expect(x).toBeGreaterThanOrEqual(-W - 0.001);
    }
    expect(done).toBe(true);
    expect(x).toBe(-W);
  });

  it('springs an end-tab release back to rest without crossing into the neighbor', () => {
    const anim = createSpringAnimator(120, 0, 0.2, { min: 0 });
    let x = 120;
    let done = false;
    let moved = false;
    for (let i = 0; i < 50 && !done; i++) {
      const tick = anim.step(16);
      x = tick.x;
      done = tick.done;
      if (x < 120) moved = true;
      expect(x).toBeGreaterThanOrEqual(0);
    }
    expect(moved).toBe(true);
    expect(done).toBe(true);
    expect(x).toBe(0);
  });
});
