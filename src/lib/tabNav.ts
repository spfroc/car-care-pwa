/** Bottom-nav root routes (order = swipe order). Nested routes are not swipeable. */
export const ROOT_TAB_PATHS = ['/', '/stats', '/settings'] as const;

export type RootTabPath = (typeof ROOT_TAB_PATHS)[number];

export function normalizePath(pathname: string): string {
  if (!pathname) return '/';
  const trimmed = pathname.replace(/\/+$/, '');
  return trimmed === '' ? '/' : trimmed;
}

export function isRootTabPath(pathname: string): boolean {
  return (ROOT_TAB_PATHS as readonly string[]).includes(normalizePath(pathname));
}

export function rootTabIndex(pathname: string): number {
  return (ROOT_TAB_PATHS as readonly string[]).indexOf(normalizePath(pathname));
}

/** Next/prev tab path, or null at ends / when not on a root tab. */
export function adjacentTabPath(pathname: string, direction: -1 | 1): string | null {
  const i = rootTabIndex(pathname);
  if (i < 0) return null;
  const next = i + direction;
  if (next < 0 || next >= ROOT_TAB_PATHS.length) return null;
  return ROOT_TAB_PATHS[next]!;
}

/** True if `el` or an ancestor can scroll horizontally (don't steal swipe). */
export function hasHorizontalScrollAncestor(el: EventTarget | null): boolean {
  let node: Element | null = el instanceof Element ? el : null;
  while (node && node !== document.documentElement) {
    if (node instanceof HTMLElement) {
      const { overflowX } = getComputedStyle(node);
      if (
        (overflowX === 'auto' || overflowX === 'scroll' || overflowX === 'overlay') &&
        node.scrollWidth > node.clientWidth + 1
      ) {
        return true;
      }
    }
    node = node.parentElement;
  }
  return false;
}

export const TAB_SWIPE_MIN_DX = 56;
export const TAB_BAR_SHOW_SCROLL_PX = 56;
export const TAB_BAR_HIDE_DELAY_MS = 1000;
