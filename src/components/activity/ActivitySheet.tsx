'use client';

import { useEffect, useRef } from 'react';
import { CloseIcon } from '../icons';
import { PanelTab } from './ActivityOpener';
import { ActivityBody } from './ActivityPage';

interface Props {
  /** The tab it opens on. */
  tab: string;
  roomId: string;
  notify: (message: string) => void;
  onClose: () => void;
}

/**
 * Your activity over the room: the same as /me, but the room (and its player)
 * stays mounted underneath, so the music keeps going. Esc or "Back" closes it.
 * Sits under the room's toasts and tap-to-play overlay.
 */
export default function ActivitySheet({ tab, roomId, notify, onClose }: Props) {
  const back = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    const root = document.documentElement;
    const overflow = root.style.overflow;
    root.style.overflow = 'hidden'; // the room behind doesn't scroll
    const before = document.activeElement as HTMLElement | null;
    back.current?.focus();
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => {
      root.style.overflow = overflow;
      window.removeEventListener('keydown', onKey);
      before?.focus?.();
    };
  }, [onClose]);

  return (
    <div role="dialog" aria-modal="true" aria-label="Your activity" className="fixed inset-0 z-[35] overflow-y-auto overscroll-contain bg-canvas pb-[env(safe-area-inset-bottom)]">
      <div className="sticky top-0 z-30 border-b border-line bg-canvas/80 backdrop-blur-md">
        <div className="mx-auto flex h-14 max-w-[900px] items-center gap-3 border-line px-2 sm:px-3 min-[901px]:border-x">
          <button
            ref={back}
            type="button"
            onClick={onClose}
            className="inline-flex h-9 items-center gap-2 rounded-md px-2.5 text-[13px] font-medium text-ink transition-colors hover:bg-sunken"
          >
            <CloseIcon size={14} />
            Back to the room
          </button>
          <span className="ml-auto truncate pr-2 font-mono text-[11px] text-faint">
            still playing in <span className="text-ink-2">{roomId}</span>
          </span>
        </div>
      </div>
      <PanelTab.Provider value={tab}>
        <main className="mx-auto max-w-[900px] border-line min-[901px]:border-x">
          <ActivityBody notify={notify} />
        </main>
      </PanelTab.Provider>
    </div>
  );
}
