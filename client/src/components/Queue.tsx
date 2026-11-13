import type { QueueItem } from '../../../shared/protocol';
import { thumbnailUrl } from '../../../shared/youtube';
import { CloseIcon, PlayIcon } from './icons';

interface Props {
  queue: QueueItem[];
  disabled: boolean;
  onPlay: (id: string) => void;
  onRemove: (id: string) => void;
}

export function Queue({ queue, disabled, onPlay, onRemove }: Props) {
  return (
    <section className="card" aria-label="Shared queue">
      <div className="flex items-center justify-between border-b border-line px-4 py-3">
        <h3 className="label">Up next</h3>
        <span className="font-mono text-[11px] text-zinc-600 tabular-nums">{queue.length}</span>
      </div>

      {queue.length === 0 ? (
        <p className="px-4 py-8 text-center text-xs text-zinc-500">
          Queue is empty. Paste a link and hit <span className="text-zinc-300">Queue</span>.
        </p>
      ) : (
        <ol className="max-h-[420px] divide-y divide-line overflow-y-auto">
          {queue.map((item, i) => (
            <li key={item.id} className="group flex items-center gap-3 px-3 py-2.5 hover:bg-zinc-800/40">
              <button
                type="button"
                disabled={disabled}
                onClick={() => onPlay(item.id)}
                className="flex min-w-0 flex-1 items-center gap-3 text-left"
                title="Play now for everyone"
              >
                <span className="w-4 shrink-0 text-right font-mono text-[11px] text-zinc-600 tabular-nums">{i + 1}</span>
                <span className="relative h-10 w-[71px] shrink-0 overflow-hidden rounded-md bg-zinc-800">
                  <img src={thumbnailUrl(item.videoId)} alt="" loading="lazy" className="size-full object-cover" />
                  <span className="absolute inset-0 flex items-center justify-center bg-black/55 text-white opacity-0 transition-opacity group-hover:opacity-100">
                    <PlayIcon size={16} />
                  </span>
                </span>
                <span className="min-w-0">
                  <span className="block truncate text-[13px] text-zinc-200">{item.title || item.videoId}</span>
                  <span className="block truncate text-[11px] text-zinc-500">added by {item.addedBy}</span>
                </span>
              </button>
              <button
                type="button"
                disabled={disabled}
                onClick={() => onRemove(item.id)}
                className="flex size-8 shrink-0 items-center justify-center rounded-md text-zinc-500 hover:bg-zinc-800 hover:text-zinc-200 sm:opacity-0 sm:group-hover:opacity-100 sm:focus-visible:opacity-100"
                aria-label={`Remove ${item.title || item.videoId} from queue`}
              >
                <CloseIcon size={15} />
              </button>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
