'use client';

import { useEffect } from 'react';
import { useHistory } from '../hooks/useHistory';
import type { ListeningSession } from '../server/accounts/history';
import { thumbnailUrl } from '../shared/youtube';
import { Avatar } from './Avatar';
import { useScrollLock } from './Gate';
import { CloseIcon, PlusIcon } from './icons';

/** "42 min", "1 h 05". */
function duration(minutes: number): string {
  const m = Math.round(minutes);
  if (m < 60) return `${Math.max(1, m)} min`;
  return `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, '0')}`;
}

function when(at: number): string {
  const d = new Date(at);
  const today = new Date();
  const yesterday = new Date(today.getTime() - 86_400_000);
  const time = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false });
  if (d.toDateString() === today.toDateString()) return `today ${time}`;
  if (d.toDateString() === yesterday.toDateString()) return `yesterday ${time}`;
  return `${d.toLocaleDateString([], { month: 'short', day: 'numeric' })} ${time}`;
}

const personId = (name: string) => `name:${name.toLowerCase()}`;

function Session({ session, disabled, onQueue, onRemove }: { session: ListeningSession; disabled: boolean; onQueue: (videoId: string, title: string) => void; onRemove: () => void }) {
  const shown = session.people.slice(0, 5);
  return (
    <li className="group px-4 py-3.5 sm:px-5">
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <p className="font-mono text-[10.5px] tracking-[0.04em] text-faint">
            {when(session.startedAt)} · room <span className="text-ink-2">{session.roomId}</span> · {duration(session.minutes)}
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
          className="flex size-7 shrink-0 items-center justify-center rounded-md text-faint transition hover:bg-sunken hover:text-ink sm:opacity-0 sm:group-hover:opacity-100 sm:focus-visible:opacity-100"
          aria-label="Remove this session from your history"
          title="Remove"
        >
          <CloseIcon size={13} />
        </button>
      </div>
      {session.tracks.length > 0 && (
        <ol className="mt-2.5 space-y-1">
          {session.tracks.map((t) => (
            <li key={t.videoId} className="flex items-center gap-2.5">
              <img src={thumbnailUrl(t.videoId)} alt="" loading="lazy" className="h-6 w-10 shrink-0 rounded object-cover ring-1 ring-line" />
              <span className="min-w-0 flex-1 truncate text-[12.5px] text-ink-2">{t.title || t.videoId}</span>
              <button
                type="button"
                disabled={disabled}
                onClick={() => onQueue(t.videoId, t.title)}
                className="flex size-7 shrink-0 items-center justify-center rounded-md text-muted transition hover:bg-sunken hover:text-ink disabled:opacity-40"
                aria-label={`Queue ${t.title || t.videoId}`}
                title="Add to this room's queue"
              >
                <PlusIcon size={14} />
              </button>
            </li>
          ))}
        </ol>
      )}
    </li>
  );
}

function Panel({ disabled, onQueue }: { disabled: boolean; onQueue: (videoId: string, title: string) => void }) {
  const { data, close, remove } = useHistory();
  useScrollLock();
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && close();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [close]);

  const top = data?.people.slice(0, 8) ?? [];
  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <button type="button" aria-label="Close history" onClick={close} className="absolute inset-0 bg-canvas/60 backdrop-blur-[2px]" />
      <div role="dialog" aria-label="Listening history" className="rise relative flex h-full w-full max-w-[420px] flex-col border-l border-line bg-panel shadow-2xl shadow-shade">
        <div className="flex h-14 shrink-0 items-center justify-between border-b border-line pr-2 pl-4 sm:pl-5">
          <p className="label">
            <span className="text-ink-2">Listening history</span>
          </p>
          <button type="button" onClick={close} aria-label="Close" className="inline-flex size-9 items-center justify-center rounded-md text-muted hover:bg-sunken hover:text-ink">
            <CloseIcon size={15} />
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto pb-[env(safe-area-inset-bottom)]">
          {!data ? (
            <p className="label p-5">loading…</p>
          ) : data.sessions.length === 0 ? (
            <div className="p-4 sm:p-5">
              <div className="rounded-lg border border-dashed border-line-strong px-4 py-7 text-center">
                <p className="label">nothing yet</p>
                <p className="mt-2 text-[13px] text-muted">Rooms you listen in for a minute or more show up here, with who was there.</p>
              </div>
            </div>
          ) : (
            <>
              {top.length > 0 && (
                <section className="border-b border-line px-4 py-4 sm:px-5" aria-label="Listened with most">
                  <p className="label">listened with most</p>
                  <ul className="mt-3 flex flex-wrap gap-x-4 gap-y-3">
                    {top.map((p) => (
                      <li key={p.name} className="flex items-center gap-2">
                        <Avatar id={personId(p.name)} name={p.name} size={28} />
                        <span className="leading-tight">
                          <span className="block max-w-[9rem] truncate text-[13px] font-medium text-ink">{p.name}</span>
                          <span className="block font-mono text-[10.5px] text-muted">
                            {duration(p.minutes)} · {p.sessions}×
                          </span>
                        </span>
                      </li>
                    ))}
                  </ul>
                </section>
              )}
              <ol className="divide-y divide-line">
                {data.sessions.map((s) => (
                  <Session key={s.id} session={s} disabled={disabled} onQueue={onQueue} onRemove={() => remove(s.id)} />
                ))}
              </ol>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

/** Slide-over listing your past sessions. Renders only while open. */
export function HistoryPanel(props: { disabled: boolean; onQueue: (videoId: string, title: string) => void }) {
  const { isOpen } = useHistory();
  return isOpen ? <Panel {...props} /> : null;
}
