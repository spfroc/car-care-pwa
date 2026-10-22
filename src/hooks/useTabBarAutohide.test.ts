/**
 * @vitest-environment jsdom
 */
import { act, createElement, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useTabBarAutohide } from './useTabBarAutohide';

function Probe({ hidden }: { hidden: boolean }) {
  const { tabBarVisible } = useTabBarAutohide(hidden);
  return createElement('div', { id: 'vis', 'data-visible': String(tabBarVisible) });
}

function Harness() {
  const [hidden, setHidden] = useState(false);
  return createElement(
    'div',
    null,
    createElement('button', { type: 'button', id: 'toggle', onClick: () => setHidden((v) => !v) }, 'toggle'),
    createElement(Probe, { hidden }),
  );
}

describe('useTabBarAutohide', () => {
  let root: Root | null = null;
  let host: HTMLDivElement | null = null;

  afterEach(() => {
    act(() => {
      root?.unmount();
    });
    host?.remove();
    root = null;
    host = null;
  });

  async function mount() {
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
    await act(async () => {
      root!.render(createElement(Harness));
    });
  }

  function visible(): string | null {
    return document.getElementById('vis')?.getAttribute('data-visible') ?? null;
  }

  function fireGestureNoise() {
    window.dispatchEvent(new Event('scroll'));
    window.dispatchEvent(new Event('touchstart'));
    window.dispatchEvent(new Event('touchmove'));
    window.dispatchEvent(new Event('touchend'));
    document.dispatchEvent(new Event('scroll'));
  }

  it('stays visible by default and does not subscribe to scroll/touch', async () => {
    const add = vi.spyOn(window, 'addEventListener');
    await mount();
    expect(visible()).toBe('true');
    const types = add.mock.calls.map((call) => call[0]);
    expect(types).not.toContain('scroll');
    expect(types).not.toContain('touchstart');
    expect(types).not.toContain('touchmove');
    expect(types).not.toContain('touchend');
    add.mockRestore();
    await act(async () => {
      fireGestureNoise();
    });
    expect(visible()).toBe('true');
  });

  it('stays hidden when the preference is on, and gestures do not show it', async () => {
    await mount();
    const toggle = document.getElementById('toggle');
    expect(toggle).toBeTruthy();
    await act(async () => {
      toggle!.click();
    });
    expect(visible()).toBe('false');
    await act(async () => {
      fireGestureNoise();
    });
    expect(visible()).toBe('false');
    await act(async () => {
      toggle!.click();
    });
    expect(visible()).toBe('true');
    await act(async () => {
      fireGestureNoise();
    });
    expect(visible()).toBe('true');
  });
});
