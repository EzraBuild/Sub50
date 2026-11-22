import { NextIcon } from './icons';

interface Props {
  /** Who asked to skip. */
  names: string[];
  /** Yeses so far and how many it takes. */
  votes: number;
  needed: number;
  onAccept: () => void;
  onKeep: () => void;
}

const who = (names: string[]) =>
  names.length === 0 ? 'Someone' : names.length === 1 ? names[0] : names.length === 2 ? `${names[0]} and ${names[1]}` : `${names[0]} and ${names.length - 1} others`;

/**
 * Someone asked to skip this song, like a draw offer: skip it, or keep it playing.
 * Sits under the header, above the room (and the activity panel), until you answer
 * or the song changes.
 */
export function SkipRequest({ names, votes, needed, onAccept, onKeep }: Props) {
  return (
    <div className="pointer-events-none fixed inset-x-0 top-16 z-40 flex justify-center px-4">
      <div role="alertdialog" aria-label="Skip request" className="rise pointer-events-auto w-full max-w-[420px] rounded-xl border border-line-strong bg-panel p-4 shadow-2xl shadow-shade">
        <p className="flex items-center gap-2 text-[14px] font-medium text-ink">
          <NextIcon size={15} className="text-muted" />
          {who(names)} {names.length > 1 ? 'want' : 'wants'} to skip this song
        </p>
        {needed > 2 && (
          <p className="mt-1 font-mono text-[11px] text-muted">
            {votes} of {needed} needed
          </p>
        )}
        <div className="mt-3 flex gap-2">
          <button type="button" onClick={onAccept} className="btn h-9 flex-1 border-ink bg-ink text-xs text-canvas hover:bg-ink-2">
            Skip it
          </button>
          <button type="button" onClick={onKeep} className="btn h-9 flex-1 text-xs">
            Keep playing
          </button>
        </div>
      </div>
    </div>
  );
}
