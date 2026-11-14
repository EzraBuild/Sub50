import { useEffect, useState, type FormEvent } from 'react';
import type { PlaylistSummary } from '../../server/accounts/playlists';
import { thumbnailUrl } from '../../shared/youtube';
import { formatWhen } from '../../lib/activity';
import { playlistApi, playlistPath } from '../../lib/playlistApi';
import { useAccountName } from '../Account';
import { PlusIcon } from '../icons';

/** Your playlists, plus a one-line form to start a new one. */
export function PlaylistsTab({ notify }: { notify: (message: string) => void }) {
  const [lists, setLists] = useState<PlaylistSummary[] | null>(null);
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
      .then((p) => location.assign(playlistPath(p.id)))
      .catch((err: Error) => {
        notify(err.message);
        setBusy(false);
      });
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
            <p className="mt-2 text-[13px] text-muted">Make one above, then add songs from any room. Keep it private or share the link with friends.</p>
          </div>
        </div>
      ) : (
        <ol className="divide-y divide-line">
          {lists.map((p) => (
            <li key={p.id}>
              <a href={playlistPath(p.id)} className="flex items-center gap-3 px-4 py-3 transition-colors hover:bg-sunken sm:px-6">
                <span className="h-11 w-[78px] shrink-0 overflow-hidden rounded-md bg-sunken ring-1 ring-line">
                  {p.cover && <img src={thumbnailUrl(p.cover)} alt="" loading="lazy" className="size-full object-cover" />}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[13.5px] font-medium text-ink">{p.name}</span>
                  <span className="block truncate font-mono text-[11px] text-muted">
                    {p.count} {p.count === 1 ? 'song' : 'songs'} · {p.visibility === 'link' ? 'shared' : 'private'} · updated {formatWhen(p.updatedAt)}
                  </span>
                </span>
              </a>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
