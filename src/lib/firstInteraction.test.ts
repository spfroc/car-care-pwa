import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  afterFirstInteraction,
  armFirstInteraction,
  resetFirstInteractionForTests,
} from './firstInteraction';

describe('first interaction', () => {
  afterEach(() => {
    resetFirstInteractionForTests();
    vi.unstubAllGlobals();
  });

  it('runs queued callbacks on the first keydown and not again', () => {
    const target = new EventTarget();
    vi.stubGlobal('window', target);
    armFirstInteraction();
    const calls: string[] = [];
    afterFirstInteraction(() => calls.push('a'));
    target.dispatchEvent(new Event('keydown'));
    target.dispatchEvent(new Event('keydown'));
    expect(calls).toEqual(['a']);
  });

  it('runs immediately when a gesture already happened', () => {
    const target = new EventTarget();
    vi.stubGlobal('window', target);
    armFirstInteraction();
    target.dispatchEvent(new Event('pointerdown'));
    const calls: string[] = [];
    afterFirstInteraction(() => calls.push('b'));
    expect(calls).toEqual(['b']);
  });
});
