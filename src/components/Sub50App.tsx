'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRoom } from '../hooks/useRoom';
import { useYouTubeSync } from '../hooks/useYouTubeSync';
import { loadName, saveName, shareUrl } from '../lib/identity';
import { AudioDeck } from './AudioDeck';
import { Cross } from './Frame';
import { BlockedOverlay, Gate, ToastView } from './Gate';
import { Header } from './Header';
import { Peers } from './Peers';
import { Queue } from './Queue';
import { UrlBar } from './UrlBar';

const VIDEO_PREF_KEY = 'sub50:showVideo';

/**
 * Phones default to audio-only: the hidden player drops to YouTube's smallest
 * stream, which means fewer stalls on mobile data and Wi-Fi. A saved choice wins.
 */
function loadVideoPref(): boolean {
  try {
    const saved = localStorage.getItem(VIDEO_PREF_KEY);
    if (saved !== null) return saved !== '0';
  } catch {
    /* storage unavailable */
  }
  return !matchMedia('(pointer: coarse)').matches;
}

/** The whole player. Browser-only: rendered through ClientShell with SSR off. */
export default function Sub50App({ roomId }: { roomId: string }) {
  const [name, setName] = useState(loadName);
  const [entered, setEntered] = useState(false);
  const [showVideo, setShowVideo] = useState(loadVideoPref);

  const { client, state, peers, connection, rttMs, selfId, lanAddresses, toast, notify, actions } = useRoom(roomId, name);
  const sync = useYouTubeSync(client, state);
  const connected = connection === 'open';

  const [visibleToast, setVisibleToast] = useState<string | null>(null);
  useEffect(() => {
    if (!toast) return;
    setVisibleToast(toast.message);
    const t = setTimeout(() => setVisibleToast(null), 3500);
    return () => clearTimeout(t);
  }, [toast]);

  const link = useMemo(() => shareUrl(roomId, lanAddresses), [roomId, lanAddresses]);

  // Runs inside the gate's tap: unlock audio synchronously, then reveal the app.
  const enter = useCallback(
    (chosen: string) => {
      sync.unlock();
      setName(chosen);
      saveName(chosen);
      setEntered(true);
    },
    [sync],
  );

  const send = (ok: boolean) => {
    if (!ok) notify('Not connected to the sync server. Retrying…');
  };

  const togglePlay = () => {
    if (!state?.videoId) return;
    if (state.isPlaying) {
      send(actions.pause(sync.getPosition()));
    } else {
      // Replaying a finished track starts it from the top.
      const atEnd = sync.duration > 0 && state.lastTimestamp >= sync.duration - 1;
      send(actions.play(atEnd ? 0 : state.lastTimestamp));
    }
  };

  const toggleVideo = () => {
    setShowVideo((v) => {
      try {
        localStorage.setItem(VIDEO_PREF_KEY, v ? '0' : '1');
      } catch {
        /* ignore */
      }
      return !v;
    });
  };

  const status = connected ? sync.telemetry.status : 'offline';

  return (
    <div className="min-h-dvh pb-[env(safe-area-inset-bottom)]">
      <Header roomId={roomId} status={status} driftMs={sync.telemetry.driftMs} rttMs={rttMs} peerCount={peers.length} shareUrl={link} />

      <div className="relative mx-auto max-w-[1200px] border-line min-[1201px]:border-x">
        {/* Hero band: dotted paper, one line of intent, the link input. */}
        <section className="relative border-b border-line">
          <div aria-hidden className="dot-grid fade-edges pointer-events-none absolute inset-0 opacity-80" />
          <div className="relative px-4 pt-9 pb-8 sm:px-8 sm:pt-14 sm:pb-11">
            <p className="label rise flex flex-wrap items-center gap-2">
              <span className="chip">
                <span className={`size-1.5 rounded-full ${connected ? 'bg-lock' : 'bg-bad'}`} />
                {connected ? 'live' : 'offline'}
              </span>
              room {roomId} · {peers.length} listening
            </p>
            <h1
              className="rise mt-4 max-w-3xl text-[32px] leading-[1.08] font-semibold tracking-[-0.035em] text-ink sm:text-[46px]"
              style={{ animationDelay: '60ms' }}
            >
              Listen in lockstep.
              <span className="text-faint"> Every device, one beat, under 50ms.</span>
            </h1>
            <div className="rise mt-7 max-w-3xl" style={{ animationDelay: '120ms' }}>
              <UrlBar disabled={!connected} onPlayNow={(url) => send(actions.changeVideo(url))} onQueue={(url) => send(actions.queueAdd(url))} />
            </div>
          </div>
          <Cross at="bl" className="hidden min-[1201px]:block" />
          <Cross at="br" className="hidden min-[1201px]:block" />
        </section>

        <main className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_380px]">
          <div className="rise min-w-0 border-line lg:border-r" style={{ animationDelay: '160ms' }}>
            <AudioDeck
              hostRef={sync.hostRef}
              room={state}
              duration={sync.duration}
              error={sync.error}
              showVideo={showVideo}
              connected={connected}
              getPosition={sync.getPosition}
              getLoadedFraction={sync.getLoadedFraction}
              onToggleVideo={toggleVideo}
              onTogglePlay={togglePlay}
              onSeek={(t) => send(actions.seek(t))}
              onResync={sync.resync}
              onNext={() => state?.queue[0] && send(actions.queuePlay(state.queue[0].id))}
            />
          </div>
          <aside className="rise relative min-w-0 border-t border-line lg:border-t-0" style={{ animationDelay: '220ms' }}>
            <Cross at="tl" className="hidden lg:block" />
            <Queue
              queue={state?.queue ?? []}
              disabled={!connected}
              onPlay={(id) => send(actions.queuePlay(id))}
              onRemove={(id) => send(actions.queueRemove(id))}
            />
            <Peers peers={peers} selfId={selfId} hostId={state?.hostId ?? null} />
          </aside>
        </main>

        <footer className="relative flex flex-wrap items-center justify-between gap-x-4 gap-y-1 border-t border-line px-4 py-3 font-mono text-[10.5px] tracking-[0.04em] text-faint sm:px-5">
          <Cross at="tl" className="hidden min-[1201px]:block" />
          <Cross at="tr" className="hidden min-[1201px]:block" />
          <span>
            clock {Math.round(client.clock.offset)}ms · rate {sync.telemetry.rate.toFixed(2)}× · {connection}
          </span>
          <span>sub50 · youtube in lockstep</span>
        </footer>
      </div>

      {!entered && <Gate roomId={roomId} name={name} connected={connected} onEnter={enter} />}
      {entered && sync.blocked && <BlockedOverlay onTap={sync.unlock} />}
      {visibleToast && <ToastView message={visibleToast} />}
    </div>
  );
}
