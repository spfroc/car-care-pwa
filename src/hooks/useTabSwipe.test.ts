/**
 * @vitest-environment jsdom
 */
import { act, createElement, useRef } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useTabSwipe } from './useTabSwipe';

function LocationProbe() {
  const { pathname } = useLocation();
  return createElement('div', { id: 'loc' }, pathname);
}

function Harness() {
  const stageRef = useRef<HTMLDivElement>(null);
  useTabSwipe(true, stageRef);
  return createElement(
    'div',
    { ref: stageRef, className: 'tab-stage' },
    createElement('div', { className: 'tab-edge-wash' }),
    ['/', '/stats', '/settings'].map((path) =>
      createElement('div', { key: path, className: 'tab-pane', 'data-tab': path }, path),
    ),
  );
}

function dispatchTouch(type: 'touchstart' | 'touchmove' | 'touchend', x: number, y: number) {
  const point = { clientX: x, clientY: y, identifier: 1 };
  const event = new Event(type, { bubbles: true, cancelable: true });
  Object.defineProperty(event, 'touches', {
    value: type === 'touchend' ? [] : [point],
  });
  Object.defineProperty(event, 'changedTouches', { value: [point] });
  window.dispatchEvent(event);
}

describe('useTabSwipe', () => {
  let root: Root | null = null;
  let host: HTMLDivElement | null = null;
  let frames: FrameRequestCallback[] = [];
  let now = 0;

  beforeEach(() => {
    frames = [];
    now = 0;
    vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
      frames.push(cb);
      return frames.length;
    });
    vi.stubGlobal('cancelAnimationFrame', () => {});
  });

  afterEach(() => {
    act(() => {
      root?.unmount();
    });
    host?.remove();
    root = null;
    host = null;
    vi.unstubAllGlobals();
  });

  function flushFrames() {
    for (let i = 0; i < 50; i++) {
      const batch = frames;
      frames = [];
      now += 32;
      for (const cb of batch) cb(now);
      if (frames.length === 0) return;
    }
  }

  async function mount(path = '/') {
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
    await act(async () => {
      root!.render(
        createElement(
          MemoryRouter,
          { initialEntries: [path] },
          createElement(Harness),
          createElement(LocationProbe),
        ),
      );
    });
    const stage = document.querySelector('.tab-stage') as HTMLElement;
    Object.defineProperty(stage, 'clientWidth', { configurable: true, value: 360 });
  }

  function offset(): number {
    return Number((document.querySelector('.tab-stage') as HTMLElement).dataset.offset ?? '0');
  }

  function transform(path: string): string {
    return (document.querySelector(`[data-tab="${path}"]`) as HTMLElement).style.transform;
  }

  function opacity(path: string): number {
    return Number((document.querySelector(`[data-tab="${path}"]`) as HTMLElement).style.opacity);
  }

  function washVisible(): boolean {
    const wash = document.querySelector('.tab-edge-wash') as HTMLElement;
    return wash.style.visibility === 'visible';
  }

  function pathname(): string {
    return document.getElementById('loc')?.textContent ?? '';
  }

  it('slides and crossfades into the next tab, then settles there', async () => {
    await mount('/');
    await act(async () => {
      dispatchTouch('touchstart', 200, 40);
      dispatchTouch('touchmove', 120, 40);
    });
    expect(offset()).toBe(-80);
    expect(transform('/')).toContain('-80px');
    expect(transform('/stats')).toContain('280px');
    expect(opacity('/')).toBeCloseTo(1 - 80 / 360, 5);
    expect(opacity('/stats')).toBeCloseTo(80 / 360, 5);
    expect(opacity('/settings')).toBe(0);
    expect(washVisible()).toBe(false);

    await act(async () => {
      dispatchTouch('touchend', 120, 40);
      flushFrames();
    });
    expect(pathname()).toBe('/stats');
    expect(offset()).toBe(0);
    expect(opacity('/stats')).toBe(1);
    expect(opacity('/')).toBe(0);
  });

  it('rubber-bands on Home and springs back without navigating', async () => {
    await mount('/');
    await act(async () => {
      dispatchTouch('touchstart', 40, 30);
      dispatchTouch('touchmove', 340, 32);
    });
    expect(document.querySelector('.tab-stage')?.getAttribute('data-edge')).toBe('left');
    expect(offset()).toBeGreaterThan(120);
    expect(offset()).toBeLessThan(134.4);
    expect(opacity('/')).toBe(1);
    expect(washVisible()).toBe(true);
    const wash = document.querySelector('.tab-edge-wash') as HTMLElement;
    expect(wash.style.transform).not.toContain('scaleX(-1)');

    await act(async () => {
      dispatchTouch('touchend', 340, 32);
      flushFrames();
    });
    expect(pathname()).toBe('/');
    expect(offset()).toBe(0);
    expect(washVisible()).toBe(false);
    expect(document.querySelector('.tab-stage')?.hasAttribute('data-edge')).toBe(false);
  });

  it('rubber-bands on Settings toward the right edge', async () => {
    await mount('/settings');
    await act(async () => {
      dispatchTouch('touchstart', 300, 20);
      dispatchTouch('touchmove', 40, 20);
    });
    expect(document.querySelector('.tab-stage')?.getAttribute('data-edge')).toBe('right');
    expect(offset()).toBeLessThan(-120);
    expect(offset()).toBeGreaterThan(-134.4);
    const wash = document.querySelector('.tab-edge-wash') as HTMLElement;
    expect(wash.style.transform).toContain('scaleX(-1)');
    expect(pathname()).toBe('/settings');

    await act(async () => {
      dispatchTouch('touchend', 40, 20);
      flushFrames();
    });
    expect(pathname()).toBe('/settings');
    expect(offset()).toBe(0);
  });

  it('does not steal a vertical drag', async () => {
    await mount('/');
    await act(async () => {
      dispatchTouch('touchstart', 30, 30);
      dispatchTouch('touchmove', 34, 90);
      dispatchTouch('touchend', 34, 90);
      flushFrames();
    });
    expect(pathname()).toBe('/');
    expect(offset()).toBe(0);
    expect(transform('/')).toContain('0px');
  });

  it('cuts over immediately when reduced motion is requested', async () => {
    vi.stubGlobal('matchMedia', (query: string) => ({
      matches: query.includes('reduce'),
      media: query,
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => false,
    }));
    await mount('/');
    await act(async () => {
      dispatchTouch('touchstart', 200, 10);
      dispatchTouch('touchmove', 100, 10);
      dispatchTouch('touchend', 100, 10);
      flushFrames();
    });
    expect(pathname()).toBe('/stats');
    expect(offset()).toBe(0);
  });
});
