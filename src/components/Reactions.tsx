import { REACTIONS, type Reaction } from '../shared/protocol';

export interface FloatingReaction {
  id: string;
  emoji: Reaction;
  name: string;
  /** Horizontal start, 0–100%. */
  x: number;
  /** Sideways drift in px, so a burst fans out instead of stacking. */
  sway: number;
}

export function ReactionBar({ onReact, disabled }: { onReact: (emoji: Reaction) => void; disabled: boolean }) {
  return (
    <div className="flex items-center justify-center gap-1.5" role="group" aria-label="React">
      {REACTIONS.map((emoji, i) => (
        <button
          key={emoji}
          type="button"
          disabled={disabled}
          onClick={() => onReact(emoji)}
          title={`React ${emoji}  (${i + 1})`}
          aria-label={`React ${emoji}`}
          className="flex size-9 items-center justify-center rounded-lg border border-line bg-sunken text-[17px] transition hover:-translate-y-0.5 hover:border-line-strong active:scale-90 disabled:opacity-40 disabled:hover:translate-y-0"
        >
          {emoji}
        </button>
      ))}
    </div>
  );
}

/** Reactions from everyone in the room, drifting up over the deck. */
export function FloatingReactions({ reactions }: { reactions: FloatingReaction[] }) {
  return (
    <div aria-hidden className="pointer-events-none absolute inset-0 z-10 overflow-hidden">
      {reactions.map((r) => (
        <span
          key={r.id}
          className="reaction-float absolute bottom-28 flex flex-col items-center"
          style={{ left: `${r.x}%`, ['--sway' as string]: `${r.sway}px` }}
        >
          <span className="text-[30px] leading-none drop-shadow-sm">{r.emoji}</span>
          <span className="mt-1 rounded-full bg-panel/90 px-1.5 font-mono text-[9.5px] text-ink-2 ring-1 ring-line">{r.name.split(' ')[0]}</span>
        </span>
      ))}
    </div>
  );
}
