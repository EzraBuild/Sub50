import { useRef, useState, type FormEvent } from 'react';
import type { SearchResult } from '../../server/search';
import { parseYouTubeId, thumbnailUrl } from '../../shared/youtube';
import { searchEnabled, searchSongs } from '../../lib/songSearch';
import { formatTime } from '../Scrubber';
import { CheckIcon, CloseIcon, LinkIcon, PlusIcon, SearchIcon } from '../icons';

export type NewSong = { videoId: string; title: string };

type Found = { state: 'loading' } | { state: 'done'; q: string; results: SearchResult[] } | { state: 'error'; message: string };

interface Props {
  /** A pasted link comes with no title: the server looks it up. */
  onAdd: (song: NewSong) => void;
  /** Songs already in the playlist: their results show ✓. */
  have: ReadonlySet<string>;
  autoFocus?: boolean;
}

/** Search a song or paste a YouTube link, straight into a playlist. Results stay open to add several. */
export function SongAdder({ onAdd, have, autoFocus = false }: Props) {
  const canSearch = searchEnabled();
  const [value, setValue] = useState('');
  const [invalid, setInvalid] = useState(false);
  const [found, setFound] = useState<Found | null>(null);
  const asked = useRef(0);
  const text = value.trim();
  const linkId = parseYouTubeId(text);
  const searching = canSearch && !!text && !linkId;

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

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!text) return;
    if (linkId) {
      onAdd({ videoId: linkId, title: '' });
      setValue('');
      return;
    }
    if (searching) return void search();
    setInvalid(true);
  };

  return (
    <div>
      <form onSubmit={submit} className="flex gap-2">
        <div className="relative min-w-0 flex-1">
          {searching ? (
            <SearchIcon size={14} className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-faint" />
          ) : (
            <LinkIcon size={14} className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-faint" />
          )}
          <input
            autoFocus={autoFocus}
            type="text"
            inputMode={canSearch ? 'search' : 'url'}
            enterKeyHint={searching ? 'search' : 'done'}
            autoComplete="off"
            spellCheck={false}
            value={value}
            onChange={(e) => {
              setValue(e.target.value);
              if (invalid) setInvalid(false);
            }}
            placeholder={canSearch ? 'Search a song, or paste a YouTube link' : 'Paste a YouTube link'}
            aria-label={canSearch ? 'Search a song or paste a YouTube link to add' : 'YouTube link to add'}
            aria-invalid={invalid}
            className={`h-10 w-full rounded-lg border bg-canvas pr-3 pl-9 font-mono text-[12.5px] text-ink placeholder:text-faint focus:outline-none ${invalid ? 'border-bad/70' : 'border-line-strong focus:border-ink/40'}`}
          />
        </div>
        <button type="submit" disabled={!text || found?.state === 'loading'} className="btn h-10 shrink-0 px-3 text-[13px]">
          {searching ? <SearchIcon size={13} /> : <PlusIcon size={14} />}
          {searching ? (found?.state === 'loading' ? 'Searching…' : 'Search') : 'Add'}
        </button>
      </form>
      {invalid && <p className="mt-1.5 font-mono text-[11px] text-bad">not a YouTube link{canSearch ? '' : ' (search isn’t set up here)'}</p>}

      {found && found.state !== 'loading' && (
        <div className="mt-2 overflow-hidden rounded-lg border border-line" role="region" aria-label="Search results">
          <div className="flex items-center justify-between border-b border-line px-3 py-1.5">
            <p className="truncate font-mono text-[11px] text-muted">{found.state === 'done' ? `${found.results.length ? 'results' : 'nothing'} for “${found.q}”` : 'search'}</p>
            <button type="button" onClick={() => setFound(null)} className="inline-flex size-7 items-center justify-center rounded text-faint hover:bg-sunken hover:text-ink" aria-label="Close results">
              <CloseIcon size={13} />
            </button>
          </div>
          {found.state === 'error' ? (
            <p className="px-3 py-3 text-[13px] text-muted">{found.message}</p>
          ) : found.results.length === 0 ? (
            <p className="px-3 py-3 text-[13px] text-muted">No videos found. Try other words, or paste a link.</p>
          ) : (
            <ol className="max-h-[min(360px,50dvh)] divide-y divide-line overflow-y-auto">
              {found.results.map((r) => {
                const added = have.has(r.videoId);
                return (
                  <li key={r.videoId} className="flex items-center gap-3 px-3 py-2">
                    <img src={thumbnailUrl(r.videoId)} alt="" loading="lazy" className="h-9 w-16 shrink-0 rounded-md object-cover ring-1 ring-line" />
                    <div className="min-w-0 flex-1">
                      <p className="line-clamp-2 text-[13px] leading-snug text-ink">{r.title || r.videoId}</p>
                      <p className="truncate font-mono text-[11px] text-muted">
                        {r.channel}
                        {r.seconds ? ` · ${formatTime(r.seconds)}` : ''}
                      </p>
                    </div>
                    <button
                      type="button"
                      disabled={added}
                      onClick={() => onAdd({ videoId: r.videoId, title: r.title })}
                      className="btn h-9 shrink-0 px-2.5 text-xs disabled:opacity-60"
                      aria-label={added ? `${r.title} is in the playlist` : `Add ${r.title} to the playlist`}
                      title={added ? 'In the playlist' : 'Add to the playlist'}
                    >
                      {added ? <CheckIcon size={13} /> : <PlusIcon size={13} />}
                    </button>
                  </li>
                );
              })}
            </ol>
          )}
        </div>
      )}
    </div>
  );
}
