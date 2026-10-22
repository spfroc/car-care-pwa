/**
 * Remember the first pointer/key gesture so heavy work can wait until the
 * user actually touches the app, without missing a tap that happened while
 * IndexedDB was still opening.
 */

type Waiter = () => void;

let happened = false;
let attached = false;
const waiters: Waiter[] = [];

function mark(): void {
  if (happened) return;
  happened = true;
  const pending = waiters.splice(0, waiters.length);
  for (const cb of pending) cb();
}

/** Register window listeners once. Safe to call from main before paint. */
export function armFirstInteraction(): void {
  if (attached || typeof window === 'undefined') return;
  attached = true;
  window.addEventListener('pointerdown', mark, { capture: true, passive: true });
  window.addEventListener('keydown', mark, { capture: true });
}

/** Run `cb` now if the user already interacted, otherwise on the next gesture. */
export function afterFirstInteraction(cb: () => void): () => void {
  armFirstInteraction();
  if (happened) {
    cb();
    return () => {};
  }
  waiters.push(cb);
  return () => {
    const i = waiters.indexOf(cb);
    if (i >= 0) waiters.splice(i, 1);
  };
}

/** Test helper. */
export function resetFirstInteractionForTests(): void {
  happened = false;
  attached = false;
  waiters.splice(0, waiters.length);
}
