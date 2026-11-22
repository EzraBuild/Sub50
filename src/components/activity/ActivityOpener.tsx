'use client';

import { createContext, useContext, type AnchorHTMLAttributes } from 'react';
import { PlusIcon } from '../icons';

/** Opens your activity over the room (on a tab), so the music keeps playing. */
export type OpenActivity = (tab?: string) => void;

const Opener = createContext<OpenActivity | null>(null);
/** Provided by the room; absent elsewhere, where /me links just navigate. */
export const ActivityOpenerProvider = Opener.Provider;
export const useActivityOpener = () => useContext(Opener);

/** In a room: adds songs to its queue in order (the first plays if nothing is on). */
export type QueueSong = (songs: { videoId: string; title: string }[]) => void;
const Queuer = createContext<QueueSong | null>(null);
/** Provided around the panel over a room; absent on /me. */
export const RoomQueueProvider = Queuer.Provider;
export const useRoomQueue = () => useContext(Queuer);

/** "+" that adds a song from your history to the room you're in; nothing outside a room. */
export function QueueButton({ videoId, title, className }: { videoId: string; title: string; className: string }) {
  const queue = useContext(Queuer);
  if (!queue) return null;
  return (
    <button type="button" onClick={() => queue([{ videoId, title }])} className={className} aria-label={`Add ${title || videoId} to this room's queue`} title="Add to this room's queue">
      <PlusIcon size={14} />
    </button>
  );
}

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
