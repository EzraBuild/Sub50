import { useEffect, useRef } from 'react';
import { REACTIONS, type Reaction } from '../shared/protocol';
import { CloseIcon } from './icons';

export interface ShortcutHandlers {
  togglePlay: () => void;
  resync: () => void;
  voteSkip: () => void;
  react: (emoji: Reaction) => void;
  focusLink: () => void;
  toggleHelp: () => void;
  closeHelp: () => void;
}

/** Typing anywhere (link box, chat, name) must never trigger a shortcut. */
function isTyping(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  if (!el) return false;
  return el.isContentEditable || el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT';
}

export function useShortcuts(enabled: boolean, handlers: ShortcutHandlers): void {
  // Read the latest handlers without re-binding the listener on every render.
  const ref = useRef(handlers);
  ref.current = handlers;

  useEffect(() => {
    if (!enabled) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') return ref.current.closeHelp();
      if (e.ctrlKey || e.metaKey || e.altKey || e.repeat || isTyping(e.target)) return;
      const h = ref.current;
      if (e.key === ' ' || e.code === 'Space') {
        // A focused button already handles Space itself.
        if ((e.target as HTMLElement)?.tagName === 'BUTTON') return;
        e.preventDefault();
        h.togglePlay();
      } else if (e.key === 'r' || e.key === 'R') h.resync();
      else if (e.key === 'n' || e.key === 'N') h.voteSkip();
      else if (e.key === '/') {
        e.preventDefault();
        h.focusLink();
      } else if (e.key === '?') h.toggleHelp();
      else if (/^[1-6]$/.test(e.key)) h.react(REACTIONS[Number(e.key) - 1]!);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [enabled]);
}

const ROWS: [string, string][] = [
  ['Space', 'Play / pause for everyone'],
  ['N', 'Vote to skip'],
  ['R', 'Resync this device'],
  ['1 – 6', `React  ${REACTIONS.join(' ')}`],
  ['/', 'Focus the link box'],
  ['?', 'Show / hide shortcuts'],
];

export function ShortcutSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  if (!open) return null;
  return (
    <div role="dialog" aria-label="Keyboard shortcuts" className="rise fixed right-4 bottom-4 z-50 w-[300px] rounded-xl border border-line bg-panel shadow-2xl shadow-shade">
      <div className="flex h-10 items-center justify-between border-b border-line pr-1.5 pl-4">
        <p className="label">keyboard</p>
        <button type="button" onClick={onClose} aria-label="Close" className="inline-flex size-7 items-center justify-center rounded-md text-muted hover:bg-sunken hover:text-ink">
          <CloseIcon size={14} />
        </button>
      </div>
      <ul className="space-y-2 p-4">
        {ROWS.map(([key, what]) => (
          <li key={key} className="flex items-center justify-between gap-3 text-[13px] text-ink-2">
            <span>{what}</span>
            <kbd className="min-w-7 shrink-0 rounded-md border border-line-strong bg-sunken px-1.5 py-0.5 text-center font-mono text-[11px] text-ink shadow-[0_1px_0_var(--line-strong)]">
              {key}
            </kbd>
          </li>
        ))}
      </ul>
    </div>
  );
}
