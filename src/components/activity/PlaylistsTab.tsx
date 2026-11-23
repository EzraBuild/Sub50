import { useEffect, useState, type FormEvent } from 'react';
import type { PlaylistSummary, PublicPlaylist } from '../../server/accounts/playlists';
import { thumbnailUrl } from '../../shared/youtube';
import { newRoomId } from '../../shared/room';
import { formatWhen } from '../../lib/activity';
import { playInRoomUrl, playlistApi, playlistPath, type PlaylistOp } from '../../lib/playlistApi';
import { useAccountName } from '../Account';
import { SongAdder, type NewSong } from '../playlist/SongAdder';
import { QueueButton, useRoomQueue } from './ActivityOpener';
import { PlayAllLink } from './RoomsTab';
import { ChevronIcon, CloseIcon, PlusIcon } from '../icons';

const summaryOf = (p: PublicPlaylist): PlaylistSummary => ({
  id: p.id,
  name: p.name,
  visibility: p.visibility,
  count: p.tracks.length,
  updatedAt: p.updatedAt,
  cover: p.tracks[0]?.videoId ?? null,
});

const songBtn = 'flex size-8 shrink-0 items-center justify-center rounded-md text-faint transition hover:bg-sunken hover:text-ink';

/** One playlist folded to a line. Open it to add, remove and play songs without leaving. */
function PlaylistRow({ summary, fresh, notify }: { summary: PlaylistSummary; fresh?: PublicPlaylist; notify: (message: string) => void }) {
  const [open, setOpen] = useState(!!fresh);
  const [p, setP] = useState<PublicPlaylist | null>(fresh ?? null);
  const [room] = useState(newRoomId);
  const inRoom = !!useRoomQueue();

  useEffect(() => {
    if (!open || p) return;
    let alive = true;
    playlistApi
      .get(summary.id)
      .then((pl) => alive && setP(pl))
      .catch((e: Error) => {
        if (!alive) return;
        notify(e.message);
        setOpen(false);
      });
    return () => {
      alive = false;
    };
  }, [open, p, summary.id, notify]);

  // Show it now, roll back if the server says no.
  const edit = (op: PlaylistOp, optimistic: PublicPlaylist) => {
    if (!p) return;
    const before = p;
    setP(optimistic);
    playlistApi
      .patch(p.id, op)
      .then((r) => setP(r.playlist))
      .catch((e: Error) => {
        setP(before);
        notify(e.message);
      });
  };
  const add = (s: NewSong) => {
    if (!p) return;
    if (p.tracks.some((t) => t.videoId === s.videoId)) return notify('Already in this playlist.');
    edit({ op: 'add', ...s }, { ...p, tracks: [...p.tracks, { ...s, addedAt: Date.now() }] });
  };
  const remove = (videoId: string) => p && edit({ op: 'remove', videoId }, { ...p, tracks: p.tracks.filter((t) => t.videoId !== videoId) });

  const s = p ? summaryOf(p) : summary;
  return (
    <li>
      <button type="button" onClick={() => setOpen((o) => !o)} aria-expanded={open} className="flex w-full items-center gap-2.5 px-4 py-3 text-left transition-colors hover:bg-sunken sm:px-6">
        <ChevronIcon size={13} className={`shrink-0 text-faint transition-transform ${open ? 'rotate-90' : ''}`} />
        <span className="h-11 w-[78px] shrink-0 overflow-hidden rounded-md bg-sunken ring-1 ring-line">
          {s.cover && <img src={thumbnailUrl(s.cover)} alt="" loading="lazy" className="size-full object-cover" />}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[13.5px] font-medium text-ink">{s.name}</span>
          <span className="block truncate font-mono text-[11px] text-muted">
            {s.count} {s.count === 1 ? 'song' : 'songs'} · {s.visibility === 'link' ? 'shared' : 'private'} · updated {formatWhen(s.updatedAt)}
          </span>
        </span>
      </button>
      {open && (
        <div className="px-4 pb-4 pl-[39px] sm:px-6 sm:pl-[47px]">
          {!p ? (
            <p className="label py-2">loading…</p>
          ) : (
            <>
              <SongAdder onAdd={add} have={new Set(p.tracks.map((t) => t.videoId))} autoFocus={!!fresh} />
              {p.tracks.length === 0 ? (
                <p className="mt-3 text-[13px] text-muted">No songs yet. Search or paste a link above.</p>
              ) : (
                <ol className="mt-3 divide-y divide-line rounded-lg border border-line">
                  {p.tracks.map((t, i) => (
                    <li key={t.videoId} className="flex items-center gap-2.5 py-1.5 pr-1.5 pl-3">
                      <span className="w-5 shrink-0 font-mono text-[10.5px] text-faint tabular-nums">{i + 1}</span>
                      <img src={thumbnailUrl(t.videoId)} alt="" loading="lazy" className="h-8 w-14 shrink-0 rounded object-cover ring-1 ring-line" />
                      <span className="min-w-0 flex-1 truncate text-[13px] text-ink">{t.title || t.videoId}</span>
                      <QueueButton videoId={t.videoId} title={t.title} className={songBtn} />
                      <button type="button" onClick={() => remove(t.videoId)} className={songBtn} aria-label={`Remove ${t.title || t.videoId} from the playlist`} title="Remove from the playlist">
                        <CloseIcon size={13} />
                      </button>
                    </li>
                  ))}
                </ol>
              )}
              <div className="mt-3 flex flex-wrap items-center gap-3">
                {p.tracks.length > 0 && <PlayAllLink room={room} tracks={p.tracks} label="Play in a room" href={playInRoomUrl(room, p.id)} />}
                <a
                  href={playlistPath(p.id)}
                  // Over a room, the page opens in a new tab so the music keeps going.
                  target={inRoom ? '_blank' : undefined}
                  rel={inRoom ? 'noopener' : undefined}
                  className="font-mono text-[11px] text-muted underline decoration-line-strong underline-offset-4 hover:text-ink"
                >
                  open page {inRoom ? '↗' : '→'}
                </a>
              </div>
            </>
          )}
        </div>
      )}
    </li>
  );
}

/** Your playlists, plus a one-line form to start a new one. A new one opens right here, ready for songs. */
export function PlaylistsTab({ notify }: { notify: (message: string) => void }) {
  const [lists, setLists] = useState<PlaylistSummary[] | null>(null);
  const [fresh, setFresh] = useState<PublicPlaylist | null>(null);
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const ownerName = useAccountName();

  useEffect(() => {
    let alive = true;
    playlistApi
      .mine()
      .then((l) => alive && setLists(l))
      .catch((e: Error) => {
        if (!alive) return;
        setLists([]);
        notify(e.message);
      });
    return () => {
      alive = false;
    };
  }, [notify]);

  const create = (e: FormEvent) => {
    e.preventDefault();
    if (!name.trim() || busy) return;
    setBusy(true);
    playlistApi
      .create({ name, ownerName: ownerName ?? undefined })
      .then((p) => {
        setLists((l) => [summaryOf(p), ...(l ?? [])]);
        setFresh(p);
        setName('');
      })
      .catch((err: Error) => notify(err.message))
      .finally(() => setBusy(false));
  };

  return (
    <div>
      <form onSubmit={create} className="flex gap-2 border-b border-line px-4 py-3 sm:px-6">
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          maxLength={60}
          placeholder="New playlist name"
          aria-label="New playlist name"
          className="h-10 min-w-0 flex-1 rounded-lg border border-line-strong bg-canvas px-3 text-[13px] text-ink placeholder:text-faint focus:border-ink/40 focus:outline-none"
        />
        <button type="submit" disabled={!name.trim() || busy} className="btn-primary inline-flex h-10 items-center gap-1.5 px-3 text-[13px]">
          <PlusIcon size={14} />
          Create
        </button>
      </form>
      {!lists ? (
        <p className="label p-6">loading…</p>
      ) : lists.length === 0 ? (
        <div className="p-4 sm:p-6">
          <div className="rounded-lg border border-dashed border-line-strong px-4 py-10 text-center">
            <p className="label">no playlists yet</p>
            <p className="mt-2 text-[13px] text-muted">Make one above, then add songs right here or from any room. Keep it private or share the link with friends.</p>
          </div>
        </div>
      ) : (
        <ol className="divide-y divide-line">
          {lists.map((s) => (
            <PlaylistRow key={s.id} summary={s} fresh={fresh?.id === s.id ? fresh : undefined} notify={notify} />
          ))}
        </ol>
      )}
    </div>
  );
}
