import { createContext, useContext } from 'react';

/** Pane element that should host position:fixed UI while the pane is translated. */
export const TabPanePortalContext = createContext<HTMLElement | null>(null);

export function useTabPanePortal(): HTMLElement | null {
  return useContext(TabPanePortalContext);
}
