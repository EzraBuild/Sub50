'use client';

import { createContext, useContext, type AnchorHTMLAttributes } from 'react';

/** Opens your activity over the room (on a tab), so the music keeps playing. */
export type OpenActivity = (tab?: string) => void;

const Opener = createContext<OpenActivity | null>(null);
/** Provided by the room; absent elsewhere, where /me links just navigate. */
export const ActivityOpenerProvider = Opener.Provider;
export const useActivityOpener = () => useContext(Opener);

/** Inside the in-room panel: the tab it opened on. Its tabs then leave the room's URL alone. */
export const PanelTab = createContext<string | null>(null);

/**
 * A link to /me. In a room, a plain click opens your activity over the room
 * instead of leaving it; Ctrl/Cmd/Shift-click still opens the page itself.
 */
export function ActivityLink({ tab, onClick, ...props }: AnchorHTMLAttributes<HTMLAnchorElement> & { tab?: string }) {
  const open = useActivityOpener();
  return (
    <a
      href={tab ? `/me#${tab}` : '/me'}
      {...props}
      onClick={(e) => {
        onClick?.(e);
        if (!open || e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
        e.preventDefault();
        open(tab);
      }}
    />
  );
}
