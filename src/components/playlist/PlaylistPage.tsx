'use client';

import { SignInButton, useAuth } from '@clerk/nextjs';
import { useCallback, useEffect, useState, type ReactNode } from 'react';
import type { PublicPlaylist, Visibility } from '../../server/accounts/playlists';
import { thumbnailUrl } from '../../shared/youtube';
import { newRoomId } from '../../shared/room';
import { authEnabled } from '../../lib/auth-config';
import { playInRoomUrl, playlistApi, playlistPath, type PlaylistOp } from '../../lib/playlistApi';
import { useAccountName } from '../Account';
import { TopBar } from '../activity/TopBar';
import { ToastView } from '../Gate';
import { ArrowDownIcon, ArrowUpIcon, CheckIcon, CloseIcon, LinkIcon, PlayIcon } from '../icons';

function Notice({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="p-4 sm:p-6">
      <div className="rounded-lg border border-dashed border-line-strong px-4 py-10 text-center">
        <p className="label">{title}</p>
        {children && <div className="mt-2 text-[13px] text-muted">{children}</div>}
      </div>
    </div>
  );
}

const iconBtn = 'inline-flex size-8 shrink-0 items-center justify-center rounded-md text-muted transition hover:bg-sunken hover:text-ink disabled:opacity-30';

function Playlist({ id, notify }: { id: string; notify: (m: string) => void }) {
  const { isSignedIn } = useAuth();
  const ownerName = useAccountName();
  const [p, setP] = useState<PublicPlaylist | null | 'missing'>(null);
  const [room] = useState(newRoomId);
  const [renaming, setRenaming] = useState(false);
  const [draft, setDraft] = useState('');
  const [copied, setCopied] = useState(false);
  const [armDelete, setArmDelete] = useState(false);

  useEffect(() => {
    let alive = true;
    playlistApi
      .get(id)
      .then((pl) => alive && setP(pl))
      .catch(() => alive && setP('missing'));
    return () => {
      alive = false;
    };
  }, [id, isSignedIn]);

  if (p === null) return <p className="label p-6">loading…</p>;
  if (p === 'missing')
    return (
      <Notice title="playlist not found">
        It doesn’t exist, or it’s private.{' '}
        {!isSignedIn && (
          <SignInButton mode="modal">
            <button type="button" className="underline decoration-line-strong underline-offset-4 hover:text-ink">
              Sign in
            </button>
          </SignInButton>
        )}
      </Notice>
    );

  // Optimistic edit: show it now, roll back if the server says no.
  const edit = (op: PlaylistOp, optimistic: PublicPlaylist) => {
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

  const setVisibility = (visibility: Visibility) => visibility !== p.visibility && edit({ op: 'update', visibility }, { ...p, visibility });
  const move = (from: number, to: number) => {
    const tracks = [...p.tracks];
    const [t] = tracks.splice(from, 1);
    tracks.splice(to, 0, t!);
    edit({ op: 'move', from, to }, { ...p, tracks });
  };
  const removeTrack = (videoId: string) => edit({ op: 'remove', videoId }, { ...p, tracks: p.tracks.filter((t) => t.videoId !== videoId) });
  const saveName = () => {
    setRenaming(false);
    const name = draft.trim();
    if (name && name !== p.name) edit({ op: 'update', name }, { ...p, name });
  };

  const copyLink = async () => {
    if (p.visibility !== 'link') return notify('It’s private. Switch it to “Anyone with the link” to share it.');
    try {
      await navigator.clipboard.writeText(new URL(playlistPath(p.id), location.origin).toString());
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      notify('Couldn’t copy. Copy the address bar instead.');
    }
  };

  const saveCopy = () =>
    playlistApi
      .copy(p.id, ownerName ?? undefined)
      .then((c) => location.assign(playlistPath(c.id)))
      .catch((e: Error) => notify(e.message));

  const deletePlaylist = () => {
    if (!armDelete) {
      setArmDelete(true);
      setTimeout(() => setArmDelete(false), 3000);
      return;
    }
    playlistApi
      .remove(p.id)
      .then(() => location.assign('/me#playlists'))
      .catch((e: Error) => notify(e.message));
  };

  const songs = `${p.tracks.length} ${p.tracks.length === 1 ? 'song' : 'songs'}`;

  return (
    <>
      <section className="border-b border-line px-4 pt-9 pb-6 sm:px-6 sm:pt-12">
        <p className="label">{p.owned ? (p.visibility === 'link' ? 'your playlist · shared' : 'your playlist · private') : `playlist by ${p.ownerName}`}</p>
        {renaming ? (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              saveName();
            }}
            className="mt-3"
          >
            <input
              autoFocus
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onBlur={saveName}
              maxLength={60}
              aria-label="Playlist name"
              className="w-full rounded-lg border border-line-strong bg-canvas px-3 py-1.5 text-[26px] font-semibold tracking-[-0.03em] text-ink focus:border-ink/40 focus:outline-none sm:text-[32px]"
            />
          </form>
        ) : (
          <h1 className="mt-3 text-[30px] leading-[1.1] font-semibold tracking-[-0.03em] break-words text-ink sm:text-[38px]">
            {p.name}
            {p.owned && (
              <button
                type="button"
                onClick={() => {
                  setDraft(p.name);
                  setRenaming(true);
                }}
                className="ml-3 align-middle font-mono text-[11px] font-normal tracking-normal text-muted underline decoration-line-strong underline-offset-4 hover:text-ink"
              >
                rename
              </button>
            )}
          </h1>
        )}
        <p className="mt-2 font-mono text-[11.5px] text-muted">
          {songs}
          {p.description && <span className="text-ink-2"> · {p.description}</span>}
        </p>

        <div className="mt-5 flex flex-wrap items-center gap-2">
          <a href={playInRoomUrl(room, p.id)} aria-disabled={p.tracks.length === 0} className={`btn-primary inline-flex h-10 items-center gap-2 px-4 text-[13px] ${p.tracks.length === 0 ? 'pointer-events-none opacity-40' : ''}`}>
            <PlayIcon size={14} />
            Play in a room
          </a>
          <button type="button" onClick={copyLink} className="btn inline-flex h-10 items-center gap-2 px-3 text-[13px]">
            {copied ? <CheckIcon size={14} /> : <LinkIcon size={14} />}
            {copied ? 'Copied' : 'Copy link'}
          </button>
          {!p.owned &&
            (isSignedIn ? (
              <button type="button" onClick={saveCopy} className="btn h-10 px-3 text-[13px]">
                Save to my playlists
              </button>
            ) : (
              <SignInButton mode="modal">
                <button type="button" className="btn h-10 px-3 text-[13px]">
                  Sign in to save it
                </button>
              </SignInButton>
            ))}
        </div>

        {p.owned && (
          <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-0.5 rounded-md border border-line p-0.5 font-mono text-[11px]" role="radiogroup" aria-label="Who can see it">
              {(
                [
                  ['private', 'Private'],
                  ['link', 'Anyone with the link'],
                ] as const
              ).map(([v, label]) => (
                <button
                  key={v}
                  type="button"
                  role="radio"
                  aria-checked={p.visibility === v}
                  onClick={() => setVisibility(v)}
                  className={`rounded px-2 py-1 uppercase transition-colors ${p.visibility === v ? 'bg-ink text-canvas' : 'text-muted hover:text-ink'}`}
                >
                  {label}
                </button>
              ))}
            </div>
            <button type="button" onClick={deletePlaylist} className={`font-mono text-[11px] underline underline-offset-4 ${armDelete ? 'text-bad decoration-bad' : 'text-muted decoration-line-strong hover:text-ink'}`}>
              {armDelete ? 'tap again to delete' : 'delete playlist'}
            </button>
          </div>
        )}
      </section>

      {p.tracks.length === 0 ? (
        <Notice title="no songs yet">{p.owned ? 'Add songs from any room with “+ playlist”, or from your activity.' : 'Nothing in here yet.'}</Notice>
      ) : (
        <ol className="divide-y divide-line">
          {p.tracks.map((t, i) => (
            <li key={t.videoId} className="flex items-center gap-3 px-4 py-2.5 sm:px-6">
              <span className="w-6 shrink-0 font-mono text-[11px] text-faint tabular-nums">{String(i + 1).padStart(2, '0')}</span>
              <img src={thumbnailUrl(t.videoId)} alt="" loading="lazy" className="h-9 w-16 shrink-0 rounded-md object-cover ring-1 ring-line" />
              <span className="min-w-0 flex-1 truncate text-[13px] text-ink">{t.title || t.videoId}</span>
              {p.owned && (
                <span className="flex shrink-0 items-center">
                  <button type="button" className={iconBtn} disabled={i === 0} onClick={() => move(i, i - 1)} aria-label={`Move ${t.title || t.videoId} up`}>
                    <ArrowUpIcon size={14} />
                  </button>
                  <button type="button" className={iconBtn} disabled={i === p.tracks.length - 1} onClick={() => move(i, i + 1)} aria-label={`Move ${t.title || t.videoId} down`}>
                    <ArrowDownIcon size={14} />
                  </button>
                  <button type="button" className={iconBtn} onClick={() => removeTrack(t.videoId)} aria-label={`Remove ${t.title || t.videoId}`}>
                    <CloseIcon size={14} />
                  </button>
                </span>
              )}
            </li>
          ))}
        </ol>
      )}
    </>
  );
}

/** /p/[id]: a playlist. Owners edit it; anyone with the link of a shared one can play or save it. */
export default function PlaylistPage({ id }: { id: string }) {
  const [toast, setToast] = useState<string | null>(null);
  const notify = useCallback((message: string) => {
    setToast(message);
    setTimeout(() => setToast(null), 3500);
  }, []);
  return (
    <div className="min-h-dvh pb-[env(safe-area-inset-bottom)]">
      <TopBar />
      <main className="mx-auto max-w-[900px] border-line min-[901px]:border-x">
        {authEnabled ? <Playlist id={id} notify={notify} /> : <Notice title="accounts are off">This server runs without accounts, so there are no playlists.</Notice>}
      </main>
      {toast && <ToastView message={toast} />}
    </div>
  );
}
