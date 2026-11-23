import { useEffect, useRef, useState, type FormEvent } from 'react';
import { parseYouTubeId, thumbnailUrl } from '../shared/youtube';
import type { SearchResult } from '../server/search';
import { formatTime } from './Scrubber';
import { searchSongs } from '../lib/songSearch';
import { CloseIcon, LinkIcon, PlayIcon, PlusIcon, SearchIcon } from './icons';

interface Props {
  disabled: boolean;
  onPlayNow: (url: string) => void;
  onQueue: (url: string) => void;
  /** The server has a YouTube key: typing a song name searches. */
  searchEnabled?: boolean;
  /** A picked search result. */
  onQueueTrack?: (videoId: string, title: string) => void;
}

type Found = { state: 'loading' } | { state: 'done'; q: string; results: SearchResult[] } | { state: 'error'; message: string };

export function UrlBar({ disabled, onPlayNow, onQueue, searchEnabled = false, onQueueTrack }: Props) {
  const [value, setValue] = useState('');
  const [invalid, setInvalid] = useState(false);
  const [found, setFound] = useState<Found | null>(null);
  const root = useRef<HTMLFormElement>(null);
  const asked = useRef(0);
  const text = value.trim();
  const isLink = !!parseYouTubeId(text);
  const searching = searchEnabled && !!text && !isLink;

  // Results close on Esc or a click elsewhere.
  useEffect(() => {
    if (!found) return;
    const away = (e: Event) => !root.current?.contains(e.target as Node) && setFound(null);
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && setFound(null);
    document.addEventListener('pointerdown', away);
    document.addEventListener('keydown', esc);
    return () => {
      document.removeEventListener('pointerdown', away);
      document.removeEventListener('keydown', esc);
    };
  }, [found]);

  const search = async () => {
    const id = ++asked.current; // only the latest search may show
    setFound({ state: 'loading' });
    try {
      const results = await searchSongs(text);
      if (id === asked.current) setFound({ state: 'done', q: text, results });
    } catch (e) {
      if (id === asked.current) setFound({ state: 'error', message: (e as Error).message });
    }
  };

  const submit = (mode: 'play' | 'queue') => {
    if (searching) return void search();
    if (!isLink) {
      setInvalid(true);
      return;
    }
    (mode === 'play' ? onPlayNow : onQueue)(text);
    setValue('');
    setInvalid(false);
  };

  const pick = (r: SearchResult, mode: 'play' | 'queue') => {
    if (mode === 'play') onPlayNow(`https://youtu.be/${r.videoId}`);
    else if (onQueueTrack) onQueueTrack(r.videoId, r.title);
    else onQueue(`https://youtu.be/${r.videoId}`);
    setFound(null);
    setValue('');
  };

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    submit('play');
  };

  return (
    <form ref={root} onSubmit={onSubmit} className="relative flex flex-col gap-2 sm:flex-row">
      <div className="relative flex-1">
        {searching ? (
          <SearchIcon size={16} className="pointer-events-none absolute top-1/2 left-3.5 -translate-y-1/2 text-faint" />
        ) : (
          <LinkIcon size={16} className="pointer-events-none absolute top-1/2 left-3.5 -translate-y-1/2 text-faint" />
        )}
        <input
          type={searchEnabled ? 'text' : 'url'}
          inputMode={searchEnabled ? 'search' : 'url'}
          enterKeyHint={searching ? 'search' : 'go'}
          autoComplete="off"
          spellCheck={false}
          value={value}
          onChange={(e) => {
            setValue(e.target.value);
            if (invalid) setInvalid(false);
          }}
          placeholder={searchEnabled ? 'Search a song, or paste a YouTube link' : 'youtube.com/watch?v=… · youtu.be/… · shorts · music'}
          id="link-input"
          aria-label={searchEnabled ? 'Search a song or paste a YouTube link' : 'YouTube URL'}
          aria-invalid={invalid}
          className={`h-12 w-full rounded-lg border bg-panel pr-3.5 pl-10 font-mono text-[13px] text-ink shadow-sm shadow-shade/30 transition-colors placeholder:text-faint focus:outline-none ${
            invalid ? 'border-bad/70' : 'border-line-strong focus:border-ink/40'
          }`}
        />
        {invalid && <p className="absolute -bottom-5 left-1 font-mono text-[11px] text-bad">not a YouTube link</p>}
      </div>
      <div className={`flex gap-2 ${invalid ? 'mt-4 sm:mt-0' : ''}`}>
        {searching ? (
          <button type="submit" className="btn-primary h-12 flex-1 px-4 sm:flex-none" disabled={disabled || found?.state === 'loading'}>
            <SearchIcon size={14} />
            {found?.state === 'loading' ? 'Searching…' : 'Search'}
          </button>
        ) : (
          <>
            <button type="submit" className="btn-primary h-12 flex-1 px-4 sm:flex-none" disabled={disabled || !text}>
              <PlayIcon size={14} />
              Play now
            </button>
            <button type="button" className="btn h-12 flex-1 px-4 sm:flex-none" disabled={disabled || !text} onClick={() => submit('queue')}>
              <PlusIcon size={15} />
              Queue
            </button>
          </>
        )}
      </div>

      {found && found.state !== 'loading' && (
        <div className="absolute inset-x-0 top-full z-20 mt-2 overflow-hidden rounded-lg border border-line-strong bg-panel shadow-2xl shadow-shade" role="region" aria-label="Search results">
          <div className="flex items-center justify-between border-b border-line px-3 py-2">
            <p className="truncate font-mono text-[11px] text-muted">{found.state === 'done' ? `${found.results.length ? 'results' : 'nothing'} for “${found.q}”` : 'search'}</p>
            <button type="button" onClick={() => setFound(null)} className="inline-flex size-7 items-center justify-center rounded text-faint hover:bg-sunken hover:text-ink" aria-label="Close results">
              <CloseIcon size={13} />
            </button>
          </div>
          {found.state === 'error' ? (
            <p className="px-3 py-4 text-[13px] text-muted">{found.message}</p>
          ) : found.results.length === 0 ? (
            <p className="px-3 py-4 text-[13px] text-muted">No videos found. Try other words, or paste a link.</p>
          ) : (
            <ol className="max-h-[min(420px,60dvh)] divide-y divide-line overflow-y-auto">
              {found.results.map((r) => (
                <li key={r.videoId} className="flex items-center gap-3 px-3 py-2.5">
                  <img src={thumbnailUrl(r.videoId)} alt="" loading="lazy" className="h-10 w-[72px] shrink-0 rounded-md object-cover ring-1 ring-line" />
                  <div className="min-w-0 flex-1">
                    <p className="line-clamp-2 text-[13px] leading-snug font-medium text-ink">{r.title || r.videoId}</p>
                    <p className="truncate font-mono text-[11px] text-muted">
                      {r.channel}
                      {r.seconds ? ` · ${formatTime(r.seconds)}` : ''}
                    </p>
                  </div>
                  <button type="button" disabled={disabled} onClick={() => pick(r, 'play')} className="btn h-9 shrink-0 px-2.5 text-xs" aria-label={`Play ${r.title} now`} title="Play now for everyone">
                    <PlayIcon size={12} />
                  </button>
                  <button type="button" disabled={disabled} onClick={() => pick(r, 'queue')} className="btn h-9 shrink-0 px-2.5 text-xs" aria-label={`Queue ${r.title}`} title="Add to the queue">
                    <PlusIcon size={13} />
                  </button>
                </li>
              ))}
            </ol>
          )}
        </div>
      )}
    </form>
  );
}
