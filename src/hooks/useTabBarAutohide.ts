import { useMemo } from 'react';
import { tabBarVisibleFromPreference } from '../lib/tabNav';

/**
 * PR #32 scroll auto-hide is gated off. This hook does not listen for scroll
 * or touch; `hideBottomNav` (Settings 「隐藏底栏」) is the only visibility input.
 * `false` / omitted → bar stays visible. `true` → bar stays hidden.
 */
export function useTabBarAutohide(hideBottomNav = false): { tabBarVisible: boolean } {
  return useMemo(
    () => ({ tabBarVisible: tabBarVisibleFromPreference(hideBottomNav) }),
    [hideBottomNav],
  );
}
