'use client';

import { SignInButton, useAuth } from '@clerk/nextjs';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import type { PlaylistSummary } from '../server/accounts/playlists';
import { authEnabled } from '../lib/auth-config';
import { playlistApi } from '../lib/playlistApi';
import { useAccountName } from './Account';
import { ListPlusIcon, PlusIcon } from './icons';

interface Props {
  videoId: string;
  title: string;
  notify: (message: string) => void;
  /** deck: bordered square next to ❤️ · row: quiet icon in a list. */
  variant?: 'deck' | 'row';
}

const BUTTON = {
  deck: 'inline-flex size-9 shrink-0 items-center justify-center rounded-lg border border-line bg-sunken text-muted transition hover:border-line-strong hover:text-ink active:scale-90',
  row: 'flex size-8 shrink-0 items-center justify-center rounded-md text-muted transition hover:bg-line hover:text-ink',
} as const;

function Picker({ videoId, title, notify, variant = 'row' }: Props) {
  const { isSignedIn } = useAuth();
  const ownerName = useAccountName();
  const [open, setOpen] = useState(false);
  const [lists, setLists] = useState<PlaylistSummary[] | null>(null);
  const [name, setName] = useState('');
  const root = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    let alive = true;
    playlistApi
      .mine()
      .then((l) => alive && setLists(l))
      .catch((e: Error) => alive && (setLists([]), notify(e.message)));
    const away = (e: Event) => !root.current?.contains(e.target as Node) && setOpen(false);
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('pointerdown', away);
    document.addEventListener('keydown', esc);
    return () => {
      alive = false;
      document.removeEventListener('pointerdown', away);
      document.removeEventListener('keydown', esc);
    };
  }, [open, notify]);

  const label = `Add ${title || 'this song'} to a playlist`;
  const button = (
    <button type="button" onClick={isSignedIn ? () => setOpen((o) => !o) : undefined} aria-expanded={open} aria-label={label} title={isSignedIn ? 'Add to a playlist' : 'Sign in to make playlists'} className={BUTTON[variant]}>
      <ListPlusIcon size={variant === 'deck' ? 17 : 15} />
    </button>
  );
  if (!isSignedIn) return <SignInButton mode="modal">{button}</SignInButton>;

  const add = (p: PlaylistSummary) => {
    setOpen(false);
    playlistApi
      .patch(p.id, { op: 'add', videoId, title })
      .then((r) => notify(r.already ? `Already in “${p.name}”.` : `Added to “${p.name}”.`))
      .catch((e: Error) => notify(e.message));
  };

  const create = (e: FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    setOpen(false);
    playlistApi
      .create({ name, ownerName: ownerName ?? undefined, tracks: [{ videoId, title }] })
      .then((p) => notify(`Made “${p.name}” with this song.`))
      .catch((err: Error) => notify(err.message));
    setName('');
  };

  return (
    <div ref={root} className="relative">
      {button}
      {open && (
        <div role="menu" aria-label="Your playlists" className="rise absolute top-full right-0 z-40 mt-1.5 w-64 overflow-hidden rounded-xl border border-line bg-panel shadow-2xl shadow-shade">
          <p className="label border-b border-line px-3 py-2">add to playlist</p>
          <div className="max-h-56 overflow-y-auto py-1">
            {!lists ? (
              <p className="px-3 py-2 font-mono text-[11px] text-faint">loading…</p>
            ) : lists.length === 0 ? (
              <p className="px-3 py-2 text-[12.5px] text-muted">No playlists yet. Name one below.</p>
            ) : (
              lists.map((p) => (
                <button key={p.id} type="button" role="menuitem" onClick={() => add(p)} className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-[13px] text-ink transition-colors hover:bg-sunken">
                  <span className="min-w-0 truncate">{p.name}</span>
                  <span className="shrink-0 font-mono text-[10.5px] text-faint">{p.count}</span>
                </button>
              ))
            )}
          </div>
          <form onSubmit={create} className="flex gap-1.5 border-t border-line p-2">
            <input value={name} onChange={(e) => setName(e.target.value)} maxLength={60} placeholder="New playlist" aria-label="New playlist name" className="h-8 min-w-0 flex-1 rounded-md border border-line-strong bg-canvas px-2 text-[12.5px] text-ink placeholder:text-faint focus:border-ink/40 focus:outline-none" />
            <button type="submit" disabled={!name.trim()} className="btn-primary inline-flex size-8 items-center justify-center" aria-label="Create playlist with this song">
              <PlusIcon size={14} />
            </button>
          </form>
          <a href="/me#playlists" className="block border-t border-line px-3 py-2 font-mono text-[10.5px] text-muted hover:text-ink">
            manage playlists →
          </a>
        </div>
      )}
    </div>
  );
}

/** "+ playlist" for a song: pick one of your playlists or start a new one with it. Hidden without accounts. */
export function AddToPlaylist(props: Props) {
  return authEnabled ? <Picker {...props} /> : null;
}

