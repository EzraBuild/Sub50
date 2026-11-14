import { useEffect, useState } from 'react';
import type { ListeningSession, SessionChatMessage } from '../../server/accounts/history';
import { thumbnailUrl } from '../../shared/youtube';
import { formatMinutes, formatWhen } from '../../lib/activity';
import { Avatar } from '../Avatar';
import { CloseIcon } from '../icons';

export const personId = (name: string) => `name:${name.toLowerCase()}`;

const time = (at: number) => new Date(at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false });

/** That session's chat, fetched when opened. */
function SessionChat({ sessionId }: { sessionId: string }) {
  const [chat, setChat] = useState<SessionChatMessage[] | null | 'error'>(null);
  useEffect(() => {
    let alive = true;
    fetch(`/api/history?sessionId=${encodeURIComponent(sessionId)}`, { cache: 'no-store' })
      .then((r) => (r.ok ? (r.json() as Promise<{ chat: SessionChatMessage[] }>) : Promise.reject(new Error())))
      .then((d) => alive && setChat(d.chat))
      .catch(() => alive && setChat('error'));
    return () => {
      alive = false;
    };
  }, [sessionId]);
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

function SessionRow({ session, onRemove }: { session: ListeningSession; onRemove: () => void }) {
  const [open, setOpen] = useState(false);
  const shown = session.people.slice(0, 6);
  return (
    <li className="group px-4 py-4 sm:px-6">
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <p className="font-mono text-[11px] tracking-[0.04em] text-faint">
            {formatWhen(session.startedAt)} · room{' '}
            <a href={`/?room=${session.roomId}`} className="text-ink-2 underline decoration-line-strong underline-offset-4 hover:text-ink">
              {session.roomId}
            </a>{' '}
            · {formatMinutes(session.minutes)}
          </p>
          <div className="mt-2 flex items-center gap-2">
            {session.people.length === 0 ? (
              <span className="text-[13px] text-muted">Just you</span>
            ) : (
              <>
                <span className="flex -space-x-1.5">
                  {shown.map((p) => (
                    <Avatar key={p.name} id={personId(p.name)} name={p.name} size={22} className="ring-2 ring-panel" />
                  ))}
                </span>
                <span className="min-w-0 truncate text-[13px] text-ink-2">{shown.map((p) => p.name).join(', ')}</span>
                {session.people.length > shown.length && <span className="shrink-0 font-mono text-[11px] text-muted">+{session.people.length - shown.length}</span>}
              </>
            )}
          </div>
        </div>
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
      {session.tracks.length > 0 && (
        <ol className="mt-3 flex flex-wrap gap-2">
          {session.tracks.map((t) => (
            <li key={t.videoId} className="flex max-w-full items-center gap-2 rounded-md border border-line bg-canvas py-1 pr-2.5 pl-1">
              <img src={thumbnailUrl(t.videoId)} alt="" loading="lazy" className="h-6 w-10 shrink-0 rounded object-cover" />
              <span className="min-w-0 truncate text-[12px] text-ink-2">{t.title || t.videoId}</span>
            </li>
          ))}
        </ol>
      )}
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="mt-3 font-mono text-[11px] text-muted underline decoration-line-strong underline-offset-4 hover:text-ink"
      >
        {open ? 'hide chat' : 'show chat'}
      </button>
      {open && <SessionChat sessionId={session.id} />}
    </li>
  );
}

export function RoomsTab({ sessions, onRemove }: { sessions: ListeningSession[]; onRemove: (id: string) => void }) {
  return (
    <ol className="divide-y divide-line">
      {sessions.map((s) => (
        <SessionRow key={s.id} session={s} onRemove={() => onRemove(s.id)} />
      ))}
    </ol>
  );
}
