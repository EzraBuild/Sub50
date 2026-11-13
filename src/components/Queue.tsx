import type { QueueItem } from '../shared/protocol';
import { thumbnailUrl } from '../shared/youtube';
import { SectionHead } from './Frame';
import { CloseIcon, PlayIcon, PlusIcon } from './icons';

interface Props {
  queue: QueueItem[];
  disabled: boolean;
  onPlay: (id: string) => void;
  onRemove: (id: string) => void;
}

export function Queue({ queue, disabled, onPlay, onRemove }: Props) {
  return (
    <section aria-label="Shared queue">
      <SectionHead index="02" title="Up next" meta={`${queue.length} queued`} />

      {queue.length === 0 ? (
        <div className="p-4 sm:p-5">
          <div className="rounded-lg border border-dashed border-line-strong px-4 py-7 text-center">
            <p className="label">queue empty</p>
            <p className="mt-2 text-[13px] text-muted">
              Paste a link and hit{' '}
              <span className="inline-flex translate-y-px items-center gap-1 rounded-md border border-line bg-sunken px-1.5 py-px font-mono text-[11px] text-ink-2">
                <PlusIcon size={11} />
                queue
              </span>
            </p>
          </div>
        </div>
      ) : (
        <ol className="max-h-[420px] divide-y divide-line overflow-y-auto">
          {queue.map((item, i) => (
            <li key={item.id} className="group flex items-center gap-3 px-3 py-2.5 transition-colors hover:bg-sunken sm:px-4">
              <button
                type="button"
                disabled={disabled}
                onClick={() => onPlay(item.id)}
                className="flex min-w-0 flex-1 items-center gap-3 text-left"
                title="Play now for everyone"
              >
                <span className="w-5 shrink-0 font-mono text-[11px] text-faint tabular-nums">{String(i + 1).padStart(2, '0')}</span>
                <span className="relative h-9 w-16 shrink-0 overflow-hidden rounded-md bg-sunken ring-1 ring-line">
                  <img src={thumbnailUrl(item.videoId)} alt="" loading="lazy" className="size-full object-cover" />
                  <span className="absolute inset-0 flex items-center justify-center bg-black/55 text-white opacity-0 transition-opacity group-hover:opacity-100">
                    <PlayIcon size={14} />
                  </span>
                </span>
                <span className="min-w-0">
                  <span className="block truncate text-[13px] font-medium text-ink">{item.title || item.videoId}</span>
                  <span className="block truncate font-mono text-[10.5px] text-muted">by {item.addedBy}</span>
                </span>
              </button>
              <button
                type="button"
                disabled={disabled}
                onClick={() => onRemove(item.id)}
                className="flex size-8 shrink-0 items-center justify-center rounded-md text-muted transition hover:bg-line hover:text-ink sm:opacity-0 sm:group-hover:opacity-100 sm:focus-visible:opacity-100"
                aria-label={`Remove ${item.title || item.videoId} from queue`}
              >
                <CloseIcon size={14} />
              </button>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
