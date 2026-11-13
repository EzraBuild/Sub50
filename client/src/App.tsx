import { useCallback, useEffect, useMemo, useState } from 'react';
import { AudioDeck } from './components/AudioDeck';
import { BlockedOverlay, Gate, ToastView } from './components/Gate';
import { Header } from './components/Header';
import { Peers } from './components/Peers';
import { Queue } from './components/Queue';
import { UrlBar } from './components/UrlBar';
import { useRoom } from './hooks/useRoom';
import { useYouTubeSync } from './hooks/useYouTubeSync';
import { loadName, resolveRoomId, saveName, shareUrl } from './lib/identity';

const VIDEO_PREF_KEY = 'sub50:showVideo';

function loadVideoPref(): boolean {
  try {
    return localStorage.getItem(VIDEO_PREF_KEY) !== '0';
  } catch {
    return true;
  }
}

export default function App() {
  const [roomId] = useState(resolveRoomId);
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
      <Header
        roomId={roomId}
        status={status}
        driftMs={sync.telemetry.driftMs}
        rttMs={rttMs}
        peerCount={peers.length}
        shareUrl={link}
      />

      <main className="mx-auto max-w-6xl space-y-5 px-4 py-5 sm:px-6 sm:py-6">
        <UrlBar disabled={!connected} onPlayNow={(url) => send(actions.changeVideo(url))} onQueue={(url) => send(actions.queueAdd(url))} />

        <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_340px]">
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

          <div className="space-y-5">
            <Queue
              queue={state?.queue ?? []}
              disabled={!connected}
              onPlay={(id) => send(actions.queuePlay(id))}
              onRemove={(id) => send(actions.queueRemove(id))}
            />
            <Peers peers={peers} selfId={selfId} hostId={state?.hostId ?? null} />
          </div>
        </div>

        <footer className="pt-2 pb-6 text-center font-mono text-[10px] tracking-wide text-zinc-700">
          clock offset {Math.round(client.clock.offset)}ms · playback rate {sync.telemetry.rate.toFixed(2)}× · {connection}
        </footer>
      </main>

      {!entered && <Gate roomId={roomId} name={name} connected={connected} onEnter={enter} />}
      {entered && sync.blocked && <BlockedOverlay onTap={sync.unlock} />}
      {visibleToast && <ToastView message={visibleToast} />}
    </div>
  );
}
