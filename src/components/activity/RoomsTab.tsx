import { useEffect, useMemo, useState } from 'react';
import { newRoomId } from '../../shared/room';
import { playAllUrl, stashTitles } from '../../lib/playAll';
import type { ListeningSession, SessionChatMessage, VisitStub } from '../../server/accounts/history';
import { thumbnailUrl } from '../../shared/youtube';
import { byMonth, formatMinutes, formatMusic, formatWhen, knownLengths, musicLength, totals } from '../../lib/activity';
import { Avatar } from '../Avatar';
import { ChevronIcon, CloseIcon, PlayIcon } from '../icons';
import { MonthGroup } from './MonthGroup';
import { QueueButton } from './ActivityOpener';

export const personId = (name: string) => `name:${name.toLowerCase()}`;

const time = (at: number) => new Date(at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false });

export type ChatLoader = (sessionId: string) => Promise<SessionChatMessage[]>;

/** Opens `room` with these songs queued in order; titles ride along. */
export function PlayAllLink({ room, tracks, label = 'Play all' }: { room: string; tracks: { videoId: string; title: string }[]; label?: string }) {
  return (
    <a
      href={playAllUrl(room, tracks)}
      onClick={() => stashTitles(tracks)}
      className="inline-flex h-7 items-center gap-1.5 rounded-md border border-line bg-sunken px-2.5 font-mono text-[11px] text-ink-2 transition hover:border-line-strong hover:text-ink"
      title="Play these in a new room, one after another"
    >
      <PlayIcon size={11} />
      {label}
    </a>
  );
}

/** That session's chat, loaded when opened. */
function SessionChat({ sessionId, loadChat }: { sessionId: string; loadChat: ChatLoader }) {
  const [chat, setChat] = useState<SessionChatMessage[] | null | 'error'>(null);
  useEffect(() => {
    let alive = true;
    loadChat(sessionId)
      .then((c) => alive && setChat(c))
      .catch(() => alive && setChat('error'));
    return () => {
      alive = false;
    };
  }, [sessionId, loadChat]);
  if (chat === null) return <p className="mt-3 font-mono text-[11px] text-faint">loading chat…</p>;
  if (chat === 'error') return <p className="mt-3 font-mono text-[11px] text-bad">Couldn’t load this chat.</p>;
  if (chat.length === 0) return <p className="mt-3 font-mono text-[11px] text-faint">No messages while you were there.</p>;
  return (
    <ol className="mt-3 space-y-2 rounded-lg border border-line bg-canvas p-3">
      {chat.map((m) => (
        <li key={m.id} className="flex gap-2.5">
          <Avatar id={personId(m.name)} name={m.name} size={20} className="mt-0.5" />
          <div className="min-w-0 flex-1">
            <p className="flex items-baseline gap-2">
              <span className={`text-[12px] font-semibold ${m.mine ? 'text-brand' : 'text-ink'}`}>{m.mine ? 'you' : m.name}</span>
              <span className="font-mono text-[10px] text-faint">{time(m.at)}</span>
            </p>
            {/* Plain text: React escapes it. */}
            <p className="text-[13px] leading-relaxed whitespace-pre-wrap text-ink-2 [overflow-wrap:anywhere]">{m.text}</p>
          </div>
        </li>
      ))}
    </ol>
  );
}

interface RowProps {
  session: ListeningSession;
  room: string;
  known: Map<string, number>;
  onRemove: () => void;
  loadChat: ChatLoader;
}

function SessionRow({ session, room, known, onRemove, loadChat }: RowProps) {
  const [open, setOpen] = useState(false);
  const [chatOpen, setChatOpen] = useState(false);
  const music = formatMusic(musicLength(session.tracks, known));
  const songs = session.tracks.length;
  const shown = session.people.slice(0, 6);
  return (
    <li className="group">
      <div className="flex items-center gap-2 px-4 py-3 sm:px-6">
        <button type="button" onClick={() => setOpen((o) => !o)} aria-expanded={open} className="flex min-w-0 flex-1 items-center gap-2.5 text-left">
          <ChevronIcon size={13} className={`shrink-0 text-faint transition-transform ${open ? 'rotate-90' : ''}`} />
          <span className="min-w-0 flex-1">
            <span className="block truncate text-[13.5px] font-medium text-ink">{session.roomId}</span>
            <span className="block truncate font-mono text-[11px] text-muted">
              {formatWhen(session.startedAt)} · {formatMinutes(session.minutes)}
              {songs > 0 && ` · ${songs} ${songs === 1 ? 'song' : 'songs'}`}
            </span>
          </span>
          {session.people.length > 0 && (
            <span className="flex shrink-0 -space-x-1.5" aria-label={`with ${session.people.map((p) => p.name).join(', ')}`}>
              {session.people.slice(0, 3).map((p) => (
                <Avatar key={p.name} id={personId(p.name)} name={p.name} size={20} className="ring-2 ring-panel" />
              ))}
            </span>
          )}
        </button>
        <button
          type="button"
          onClick={onRemove}
          className="flex size-8 shrink-0 items-center justify-center rounded-md text-faint transition hover:bg-sunken hover:text-ink sm:opacity-0 sm:group-hover:opacity-100 sm:focus-visible:opacity-100"
          aria-label="Remove this session (and its chat) from your activity"
          title="Remove"
        >
          <CloseIcon size={14} />
        </button>
      </div>
      {open && (
        <div className="px-4 pb-4 pl-[39px] sm:px-6 sm:pl-[47px]">
          <p className="text-[13px] text-ink-2">
            {session.people.length === 0 ? <span className="text-muted">Just you</span> : <>With {shown.map((p) => p.name).join(', ')}</>}
            {session.people.length > shown.length && <span className="font-mono text-[11px] text-muted"> +{session.people.length - shown.length}</span>}
            {music && <span className="text-muted"> · {music} of music</span>}
          </p>
          {session.tracks.length > 0 && (
            <ol className="mt-3 flex flex-wrap gap-2">
              {session.tracks.map((t) => (
                <li key={t.videoId} className="flex max-w-full items-center gap-2 rounded-md border border-line bg-canvas py-1 pr-2.5 pl-1">
                  <img src={thumbnailUrl(t.videoId)} alt="" loading="lazy" className="h-6 w-10 shrink-0 rounded object-cover" />
                  <span className="min-w-0 truncate text-[12px] text-ink-2">{t.title || t.videoId}</span>
                  <QueueButton videoId={t.videoId} title={t.title} className="-my-1 -mr-1.5 inline-flex size-7 shrink-0 items-center justify-center rounded text-faint transition hover:bg-sunken hover:text-ink" />
                </li>
              ))}
            </ol>
          )}
          <div className="mt-3 flex flex-wrap items-center gap-3">
            {session.tracks.length > 0 && <PlayAllLink room={room} tracks={session.tracks} label={session.tracks.length === 1 ? 'Play' : `Play all ${session.tracks.length}`} />}
            <a href={`/?room=${session.roomId}`} className="font-mono text-[11px] text-muted underline decoration-line-strong underline-offset-4 hover:text-ink">
              open room
            </a>
            <button
              type="button"
              onClick={() => setChatOpen((o) => !o)}
              aria-expanded={chatOpen}
              className="font-mono text-[11px] text-muted underline decoration-line-strong underline-offset-4 hover:text-ink"
            >
              {chatOpen ? 'hide chat' : 'show chat'}
            </button>
          </div>
          {chatOpen && <SessionChat sessionId={session.id} loadChat={loadChat} />}
        </div>
      )}
    </li>
  );
}

/** A row of stats: 2×2 on phones, one row from sm up, hairlines between. */
export const STAT_GRID =
  'grid grid-cols-2 border-b border-line sm:grid-cols-4 [&>*]:border-line max-sm:[&>*:nth-child(-n+2)]:border-b max-sm:[&>*:nth-child(odd)]:border-r sm:[&>*:not(:last-child)]:border-r';

export function Stat({ label, value, hint }: { label: string; value: string; hint: string }) {
  return (
    <div className="px-4 py-4 sm:px-6" title={hint}>
      <p className="label">{label}</p>
      <p className="mt-1.5 text-[22px] leading-none font-semibold tracking-[-0.02em] text-ink">{value}</p>
    </div>
  );
}

/** Rooms, time listened, songs and music, added up. */
function TotalsRow({ sessions, stubs }: { sessions: ListeningSession[]; stubs: VisitStub[] }) {
  const t = totals(sessions, stubs);
  return (
    <div className={STAT_GRID}>
      <Stat label="rooms" value={String(t.rooms)} hint="Visits of a minute or more" />
      <Stat label="listened" value={formatMinutes(t.minutes)} hint="Time the room was playing while you were in it" />
      <Stat label="songs" value={String(t.songs)} hint={stubs.length ? 'Different songs in the rooms listed below' : 'Different songs you’ve heard'} />
      <Stat
        label="music"
        value={formatMusic(t.music) ?? '—'}
        hint={t.music.unknown ? 'Every room’s songs, lengths added up. Songs from before lengths were kept count once you hear them again.' : 'Every room’s songs, lengths added up'}
      />
    </div>
  );
}

interface RoomsTabProps {
  sessions: ListeningSession[];
  /** Older visits: counted in the totals, not listed. */
  stubs: VisitStub[];
  onRemove: (id: string) => void;
  loadChat: ChatLoader;
}

export function RoomsTab({ sessions, stubs, onRemove, loadChat }: RoomsTabProps) {
  const [room] = useState(newRoomId); // "Play all" opens this fresh room
  const known = useMemo(() => knownLengths(sessions), [sessions]);
  return (
    <>
      <TotalsRow sessions={sessions} stubs={stubs} />
      {/* By month, the latest open; each room one line until you open it. */}
      <ol className="divide-y divide-line">
        {byMonth(sessions, (s) => s.startedAt).map((m, i) => (
          <MonthGroup
            key={m.key}
            at={m.at}
            defaultOpen={i === 0}
            meta={`${m.items.length} ${m.items.length === 1 ? 'room' : 'rooms'} · ${formatMinutes(m.items.reduce((n, s) => n + s.minutes, 0))}`}
          >
            {m.items.map((s) => (
              <SessionRow key={s.id} session={s} room={room} known={known} onRemove={() => onRemove(s.id)} loadChat={loadChat} />
            ))}
          </MonthGroup>
        ))}
      </ol>
    </>
  );
}
