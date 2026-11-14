'use client';

import { SignInButton, useAuth } from '@clerk/nextjs';
import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import type { ListeningSession, PersonSummary, SessionChatMessage } from '../../server/accounts/history';
import { thumbnailUrl } from '../../shared/youtube';
import { newRoomId } from '../../shared/room';
import { authEnabled } from '../../lib/auth-config';
import { formatMinutes, formatWhen, listenUrl, summarizePeople, summarizeTracks } from '../../lib/activity';
import { loadLocal, removeLocal } from '../../lib/localHistory';
import { FavoritesProvider } from '../../hooks/useFavorites';
import { Avatar } from '../Avatar';
import { FavoriteButton } from '../FavoriteButton';
import { ToastView } from '../Gate';
import { PlayIcon } from '../icons';
import { PlaylistsTab } from './PlaylistsTab';
import { RoomsTab, personId, type ChatLoader } from './RoomsTab';
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

const apiChat: ChatLoader = (sessionId) =>
  fetch(`/api/history?sessionId=${encodeURIComponent(sessionId)}`, { cache: 'no-store' })
    .then((r) => (r.ok ? (r.json() as Promise<{ chat: SessionChatMessage[] }>) : Promise.reject(new Error())))
    .then((d) => d.chat);

const localChat: ChatLoader = async (sessionId) => loadLocal().chats[sessionId] ?? [];

interface TabsProps {
  data: HistoryData | null;
  onRemove: (sessionId: string) => void;
  loadChat: ChatLoader;
  /** The playlists tab body; null hides the tab (no accounts on this server). */
  playlists: ReactNode | null;
  notice?: ReactNode;
}

/** Rooms / songs / playlists / people, from whichever history (account or this device). */
function ActivityTabs({ data, onRemove, loadChat, playlists, notice }: TabsProps) {
  const tabs = TABS.filter((t) => t !== 'playlists' || playlists !== null);
  const [tab, setTab] = useState<Tab>(() => {
    const t = tabFromHash();
    return tabs.includes(t) ? t : 'rooms';
  });
  const choose = (t: Tab) => {
    setTab(t);
    history.replaceState(null, '', `#${t}`);
  };
  const counts: Partial<Record<Tab, number>> | null = data ? { rooms: data.sessions.length, songs: summarizeTracks(data.sessions).length, people: data.people.length } : null;

  return (
    <>
      {notice}
      <div className="flex items-center gap-1 overflow-x-auto border-b border-line px-4 py-2 sm:px-6" role="tablist" aria-label="Activity">
        {tabs.map((t) => (
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
        playlists
      ) : !data ? (
        <p className="label p-6">loading…</p>
      ) : tab === 'rooms' ? (
        data.sessions.length ? (
          <RoomsTab sessions={data.sessions} onRemove={onRemove} loadChat={loadChat} />
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

function SignedInActivity({ notify }: { notify: (message: string) => void }) {
  const [data, setData] = useState<HistoryData | null>(null);
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

  const remove = (sessionId: string) => {
    setData((prev) => (prev ? { ...prev, sessions: prev.sessions.filter((s) => s.id !== sessionId) } : prev));
    fetch(`/api/history?sessionId=${encodeURIComponent(sessionId)}`, { method: 'DELETE' })
      .then((r) => {
        if (!r.ok) throw new Error();
      })
      .catch(() => notify('Could not remove that session.'));
  };

  return <ActivityTabs data={data} onRemove={remove} loadChat={apiChat} playlists={<PlaylistsTab notify={notify} />} />;
}

const fromDevice = (): HistoryData => {
  const { sessions } = loadLocal();
  return { sessions, people: summarizePeople(sessions) };
};

/** Signed out, or a server without accounts: what this browser remembers. */
function DeviceActivity({ canSignIn }: { canSignIn: boolean }) {
  const [data, setData] = useState<HistoryData>(fromDevice);
  const remove = (sessionId: string) => {
    removeLocal(sessionId);
    setData(fromDevice());
  };
  const signIn = (
    <SignInButton mode="modal">
      <button type="button" className="btn h-8 shrink-0 px-3 text-xs">
        Sign in
      </button>
    </SignInButton>
  );
  const notice = (
    <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line bg-sunken px-4 py-3 sm:px-6">
      <p className="text-[12.5px] text-muted">
        <span className="font-medium text-ink-2">Saved on this device only.</span>{' '}
        {canSignIn ? 'Sign in to keep it on every device; what’s here comes with you.' : 'Clearing your browser data clears it.'}
      </p>
      {canSignIn && signIn}
    </div>
  );
  const playlists = canSignIn ? (
    <Empty title="playlists">
      <p>Sign in to make playlists, keep them private or share the link with friends.</p>
      <div className="mt-4 flex justify-center">{signIn}</div>
    </Empty>
  ) : null;
  return <ActivityTabs data={data} onRemove={remove} loadChat={localChat} playlists={playlists} notice={notice} />;
}

function Activity({ notify }: { notify: (message: string) => void }) {
  const { isLoaded, isSignedIn } = useAuth();
  if (!isLoaded) return <p className="label p-6">checking account…</p>;
  return isSignedIn ? <SignedInActivity notify={notify} /> : <DeviceActivity canSignIn />;
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
          <DeviceActivity canSignIn={false} />
        )}
      </main>
      {toast && <ToastView message={toast} />}
    </div>
  );
}
