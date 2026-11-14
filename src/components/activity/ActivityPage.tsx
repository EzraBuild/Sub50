'use client';

import { SignInButton, useAuth } from '@clerk/nextjs';
import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import type { ListeningSession, PersonSummary } from '../../server/accounts/history';
import { thumbnailUrl } from '../../shared/youtube';
import { newRoomId } from '../../shared/room';
import { authEnabled } from '../../lib/auth-config';
import { formatMinutes, formatWhen, listenUrl, summarizeTracks } from '../../lib/activity';
import { FavoritesProvider } from '../../hooks/useFavorites';
import { Avatar } from '../Avatar';
import { FavoriteButton } from '../FavoriteButton';
import { ToastView } from '../Gate';
import { PlayIcon } from '../icons';
import { PlaylistsTab } from './PlaylistsTab';
import { RoomsTab, personId } from './RoomsTab';
import { TopBar } from './TopBar';

interface HistoryData {
  sessions: ListeningSession[];
  people: PersonSummary[];
}

const TABS = ['rooms', 'songs', 'playlists', 'people'] as const;
type Tab = (typeof TABS)[number];
const tabFromHash = (): Tab => (TABS as readonly string[]).includes(location.hash.slice(1)) ? (location.hash.slice(1) as Tab) : 'rooms';

function Empty({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="p-4 sm:p-6">
      <div className="rounded-lg border border-dashed border-line-strong px-4 py-10 text-center">
        <p className="label">{title}</p>
        <div className="mt-2 text-[13px] text-muted">{children}</div>
      </div>
    </div>
  );
}

function SongsTab({ sessions }: { sessions: ListeningSession[] }) {
  const songs = useMemo(() => summarizeTracks(sessions), [sessions]);
  const [room] = useState(newRoomId); // "Listen" opens this fresh room
  if (songs.length === 0) return <Empty title="no songs yet">Songs played while you’re in a room show up here.</Empty>;
  return (
    <ol className="divide-y divide-line">
      {songs.map((s) => (
        <li key={s.videoId} className="flex items-center gap-3 px-4 py-3 sm:px-6">
          <img src={thumbnailUrl(s.videoId)} alt="" loading="lazy" className="h-10 w-[72px] shrink-0 rounded-md object-cover ring-1 ring-line" />
          <div className="min-w-0 flex-1">
            <p className="truncate text-[13.5px] font-medium text-ink">{s.title || s.videoId}</p>
            <p className="truncate font-mono text-[11px] text-muted">
              {s.plays}× · last {formatWhen(s.lastAt)} · {s.lastRoom}
            </p>
          </div>
          <FavoriteButton videoId={s.videoId} title={s.title} />
          <a
            href={listenUrl(room, s.videoId)}
            className="inline-flex size-9 shrink-0 items-center justify-center rounded-lg border border-line bg-sunken text-muted transition hover:border-line-strong hover:text-ink"
            aria-label={`Listen to ${s.title || s.videoId} in a new room`}
            title="Listen in a new room"
          >
            <PlayIcon size={14} />
          </a>
        </li>
      ))}
    </ol>
  );
}

function PeopleTab({ people }: { people: PersonSummary[] }) {
  if (people.length === 0) return <Empty title="no one yet">People you listen with show up here.</Empty>;
  return (
    <ol className="divide-y divide-line">
      {people.map((p) => (
        <li key={p.name} className="flex items-center gap-3 px-4 py-3 sm:px-6">
          <Avatar id={personId(p.name)} name={p.name} size={34} />
          <div className="min-w-0 flex-1">
            <p className="truncate text-[13.5px] font-medium text-ink">{p.name}</p>
            <p className="font-mono text-[11px] text-muted">
              {formatMinutes(p.minutes)} together · {p.sessions} {p.sessions === 1 ? 'session' : 'sessions'} · last {formatWhen(p.lastAt)}
            </p>
          </div>
        </li>
      ))}
    </ol>
  );
}

function SignedInActivity({ notify }: { notify: (message: string) => void }) {
  const [data, setData] = useState<HistoryData | null>(null);
  const [tab, setTab] = useState<Tab>(tabFromHash);

  useEffect(() => {
    let alive = true;
    fetch('/api/history', { cache: 'no-store' })
      .then((r) => (r.ok ? (r.json() as Promise<HistoryData>) : Promise.reject(new Error())))
      .then((d) => alive && setData(d))
      .catch(() => {
        if (!alive) return;
        setData({ sessions: [], people: [] });
        notify('Could not load your activity.');
      });
    return () => {
      alive = false;
    };
  }, [notify]);

  const choose = (t: Tab) => {
    setTab(t);
    history.replaceState(null, '', `#${t}`);
  };

  const remove = (sessionId: string) => {
    setData((prev) => (prev ? { ...prev, sessions: prev.sessions.filter((s) => s.id !== sessionId) } : prev));
    fetch(`/api/history?sessionId=${encodeURIComponent(sessionId)}`, { method: 'DELETE' })
      .then((r) => {
        if (!r.ok) throw new Error();
      })
      .catch(() => notify('Could not remove that session.'));
  };

  const counts: Partial<Record<Tab, number>> | null = data ? { rooms: data.sessions.length, songs: summarizeTracks(data.sessions).length, people: data.people.length } : null;

  return (
    <>
      <div className="flex items-center gap-1 overflow-x-auto border-b border-line px-4 py-2 sm:px-6" role="tablist" aria-label="Activity">
        {TABS.map((t) => (
          <button
            key={t}
            type="button"
            role="tab"
            aria-selected={tab === t}
            onClick={() => choose(t)}
            className={`rounded-md px-2.5 py-1.5 font-mono text-[11.5px] tracking-[0.04em] uppercase transition-colors ${tab === t ? 'bg-ink text-canvas' : 'text-muted hover:bg-sunken hover:text-ink'}`}
          >
            {t}
            {counts?.[t] !== undefined && <span className="ml-1.5 opacity-60">{counts[t]}</span>}
          </button>
        ))}
      </div>
      {tab === 'playlists' ? (
        <PlaylistsTab notify={notify} />
      ) : !data ? (
        <p className="label p-6">loading…</p>
      ) : tab === 'rooms' ? (
        data.sessions.length ? (
          <RoomsTab sessions={data.sessions} onRemove={remove} />
        ) : (
          <Empty title="nothing yet">Rooms you listen in for a minute or more show up here, with who was there, the songs and the chat.</Empty>
        )
      ) : tab === 'songs' ? (
        <SongsTab sessions={data.sessions} />
      ) : (
        <PeopleTab people={data.people} />
      )}
    </>
  );
}

function Activity({ notify }: { notify: (message: string) => void }) {
  const { isLoaded, isSignedIn } = useAuth();
  if (!isLoaded) return <p className="label p-6">checking account…</p>;
  if (!isSignedIn)
    return (
      <Empty title="your activity">
        <p>Sign in to keep every room, the people, the songs and the chat — on all your devices.</p>
        <SignInButton mode="modal">
          <button type="button" className="btn mt-4 h-9 px-3 text-xs">
            Sign in
          </button>
        </SignInButton>
      </Empty>
    );
  return <SignedInActivity notify={notify} />;
}

/** /me: everything you've done in Sub50. */
export default function ActivityPage() {
  const [toast, setToast] = useState<string | null>(null);
  const notify = useCallback((message: string) => {
    setToast(message);
    setTimeout(() => setToast(null), 3500);
  }, []);

  return (
    <div className="min-h-dvh pb-[env(safe-area-inset-bottom)]">
      <TopBar />
      <main className="mx-auto max-w-[900px] border-line min-[901px]:border-x">
        <section className="border-b border-line px-4 pt-9 pb-7 sm:px-6 sm:pt-12">
          <p className="label">activity</p>
          <h1 className="mt-3 text-[30px] leading-[1.1] font-semibold tracking-[-0.03em] text-ink sm:text-[38px]">
            Your listening.
            <span className="text-faint"> Rooms, songs, playlists, people and chat.</span>
          </h1>
        </section>
        {authEnabled ? (
          <FavoritesProvider onError={notify}>
            <Activity notify={notify} />
          </FavoritesProvider>
        ) : (
          <Empty title="accounts are off">This server runs without accounts, so there’s no activity to show.</Empty>
        )}
      </main>
      {toast && <ToastView message={toast} />}
    </div>
  );
}
