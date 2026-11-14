import { SignInButton } from '@clerk/nextjs';
import { useState } from 'react';
import { useFavorites } from '../hooks/useFavorites';
import type { PlayedItem, QueueItem } from '../shared/protocol';
import { thumbnailUrl } from '../shared/youtube';
import { SectionHead } from './Frame';
import { CloseIcon, HeartIcon, PlayIcon, PlusIcon } from './icons';

interface Props {
  queue: QueueItem[];
  played: PlayedItem[];
  /** Video currently on the deck: the newest "played" entry is that track, not history. */
  nowPlayingId: string | null;
  disabled: boolean;
  onPlay: (id: string) => void;
  onRemove: (id: string) => void;
  onRequeue: (item: PlayedItem) => void;
  /** Play a saved track now / add it to the queue. */
  onPlayTrack: (videoId: string) => void;
  onQueueTrack: (videoId: string, title: string) => void;
}

/** Compact 24h time so the column never wraps ("15:58", not "03:58 PM"). */
const time = (at: number) => new Date(at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false });

function Thumb({ videoId }: { videoId: string }) {
  return (
    <span className="relative h-9 w-16 shrink-0 overflow-hidden rounded-md bg-sunken ring-1 ring-line">
      <img src={thumbnailUrl(videoId)} alt="" loading="lazy" className="size-full object-cover" />
    </span>
  );
}

export function Queue({ queue, played, nowPlayingId, disabled, onPlay, onRemove, onRequeue, onPlayTrack, onQueueTrack }: Props) {
  const [tab, setTab] = useState<'next' | 'played' | 'saved'>('next');
  const fav = useFavorites();
  // The first played entry is the track on the deck right now; history starts after it.
  const history = played[0]?.videoId === nowPlayingId ? played.slice(1) : played;

  const tabs = (
    <div className="flex items-center gap-0.5 rounded-md border border-line p-0.5" role="tablist" aria-label="Queue view">
      {(
        [
          ['next', `next ${queue.length}`],
          ['played', `played ${history.length}`],
          ...(fav.enabled ? ([['saved', `saved${fav.signedIn ? ` ${fav.items.length}` : ''}`]] as const) : []),
        ] as const
      ).map(([key, label]) => (
        <button
          key={key}
          type="button"
          role="tab"
          aria-selected={tab === key}
          onClick={() => setTab(key)}
          className={`rounded px-1.5 py-0.5 uppercase transition-colors ${tab === key ? 'bg-ink text-canvas' : 'hover:text-ink'}`}
        >
          {label}
        </button>
      ))}
    </div>
  );

  return (
    <section aria-label="Shared queue">
      <SectionHead index="03" title={tab === 'next' ? 'Up next' : tab === 'played' ? 'Played' : 'Saved'} meta={tabs} />

      {tab === 'next' &&
        (queue.length === 0 ? (
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
                  <span className="relative">
                    <Thumb videoId={item.videoId} />
                    <span className="absolute inset-0 flex items-center justify-center rounded-md bg-black/55 text-white opacity-0 transition-opacity group-hover:opacity-100">
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
        ))}

      {tab === 'played' &&
        (history.length === 0 ? (
          <div className="p-4 sm:p-5">
            <div className="rounded-lg border border-dashed border-line-strong px-4 py-7 text-center">
              <p className="label">nothing played yet</p>
              <p className="mt-2 text-[13px] text-muted">Tracks land here once the room moves past them.</p>
            </div>
          </div>
        ) : (
          <ol className="max-h-[420px] divide-y divide-line overflow-y-auto">
            {history.map((item) => (
              <li key={`${item.videoId}-${item.at}`} className="group flex items-center gap-3 px-3 py-2.5 transition-colors hover:bg-sunken sm:px-4">
                <span className="w-10 shrink-0 font-mono text-[10.5px] whitespace-nowrap text-faint tabular-nums">{time(item.at)}</span>
                <Thumb videoId={item.videoId} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[13px] font-medium text-ink">{item.title || item.videoId}</span>
                  <span className="block truncate font-mono text-[10.5px] text-muted">by {item.addedBy}</span>
                </span>
                <button
                  type="button"
                  disabled={disabled}
                  onClick={() => onRequeue(item)}
                  className="flex size-8 shrink-0 items-center justify-center rounded-md text-muted transition hover:bg-line hover:text-ink"
                  aria-label={`Queue ${item.title || item.videoId} again`}
                  title="Queue again"
                >
                  <PlusIcon size={15} />
                </button>
              </li>
            ))}
          </ol>
        ))}
      {tab === 'saved' &&
        (!fav.signedIn ? (
          <div className="p-4 sm:p-5">
            <div className="rounded-lg border border-dashed border-line-strong px-4 py-7 text-center">
              <p className="label">your saved tracks</p>
              <p className="mt-2 text-[13px] text-muted">Sign in and ❤️ tracks; they follow you to every device.</p>
              <SignInButton mode="modal">
                <button type="button" className="btn mt-4 h-9 px-3 text-xs">
                  Sign in
                </button>
              </SignInButton>
            </div>
          </div>
        ) : fav.items.length === 0 ? (
          <div className="p-4 sm:p-5">
            <div className="rounded-lg border border-dashed border-line-strong px-4 py-7 text-center">
              <p className="label">nothing saved yet</p>
              <p className="mt-2 text-[13px] text-muted">Tap the ❤️ next to a track to keep it here.</p>
            </div>
          </div>
        ) : (
          <ol className="max-h-[420px] divide-y divide-line overflow-y-auto">
            {fav.items.map((item) => (
              <li key={item.videoId} className="group flex items-center gap-3 px-3 py-2.5 transition-colors hover:bg-sunken sm:px-4">
                <button type="button" disabled={disabled} onClick={() => onPlayTrack(item.videoId)} className="flex min-w-0 flex-1 items-center gap-3 text-left" title="Play now for everyone">
                  <span className="relative">
                    <Thumb videoId={item.videoId} />
                    <span className="absolute inset-0 flex items-center justify-center rounded-md bg-black/55 text-white opacity-0 transition-opacity group-hover:opacity-100">
                      <PlayIcon size={14} />
                    </span>
                  </span>
                  <span className="min-w-0">
                    <span className="block truncate text-[13px] font-medium text-ink">{item.title || item.videoId}</span>
                    <span className="block truncate font-mono text-[10.5px] text-muted">saved {new Date(item.at).toLocaleDateString()}</span>
                  </span>
                </button>
                <button
                  type="button"
                  disabled={disabled}
                  onClick={() => onQueueTrack(item.videoId, item.title)}
                  className="flex size-8 shrink-0 items-center justify-center rounded-md text-muted transition hover:bg-line hover:text-ink"
                  aria-label={`Queue ${item.title || item.videoId}`}
                  title="Add to queue"
                >
                  <PlusIcon size={15} />
                </button>
                <button
                  type="button"
                  onClick={() => fav.toggle(item.videoId, item.title)}
                  className="flex size-8 shrink-0 items-center justify-center rounded-md text-bad transition hover:bg-bad/10"
                  aria-label={`Remove ${item.title || item.videoId} from favorites`}
                  title="Remove from favorites"
                >
                  <HeartIcon size={15} filled />
                </button>
              </li>
            ))}
          </ol>
        ))}
    </section>
  );
}
